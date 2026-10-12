---
title: "12 Containers: 実装のつづき"
---

# 12 Containers: 実装のつづき

## role は 2 つ

<!-- section: 12.roles -->

04章の Lambda には、実行 role が 1 つありました。ECS の task には 2 つあります。名前が紛らわしいので、ここで整理します。

<<< @/examples/12-containers/infra/lib/containers-stack.ts{roles}

**task execution role** は、あなたのコードが動き出す**前**に、ECS の agent が使います。image を ECR から取る。ログの stream を開く。それだけです。コンテナの中のコードからは使えません。

**task role** は、コンテナの中のコードが AWS を呼ぶときに使います。Lambda の実行 role に当たるのは、こちらです。

04章と並べると、こうなります。

| | Lambda（04章） | ECS の task |
| --- | --- | --- |
| コードが AWS を呼ぶ権限 | 実行 role | task role |
| コードの取得とログの送信 | Lambda 自身がやる（ログは実行 role の権限で書く） | task execution role |

このアプリは AWS を 1 つも呼ばないので、task role は空です。05章の table につなぐなら、`table.grantReadWriteData(taskRole)` と書きます。execution role に付けても、アプリからは使えません。逆に、execution role の権限を task role に付けると、アプリが要らない権限を持つことになります。

execution role の中身は、CDK が組み立てています。`ecs.ContainerImage.fromEcrRepository` がこの repository からの pull を、`ecs.LogDrivers.awsLogs` がこの log group への書き込みを足します。

<<< @/examples/12-containers/infra/lib/containers-stack.ts{task}

テストは、policy が execution role にしか付いていないこと、許可が 6 つの操作ちょうどであることを見ています。1 つだけ、`ecr:GetAuthorizationToken` の対象が `*` になります。04章から続けてきた「`*` を使わない」の例外で、この操作は repository を指定できないためです。stack の中の `*` がこれ 1 つであることも、テストで固定しました。

`readonlyRootFilesystem` は、コンテナのファイルシステムを読み取り専用にします。このアプリはディスクに何も書かないので、誰にも書かせない、というだけです。

## service と ALB

<!-- section: 12.service -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{service}

<<< @/examples/12-containers/infra/lib/containers-stack.ts{load-balancer}

listener は HTTP の 80 番だけです。HTTPS には証明書が要り、証明書にはドメイン名が要ります。この章はドメイン名を持っていないので、通信は暗号化されません。06章の token のような、見られて困るものを流さないでください。

### health check

ALB は、target group に登録された task に、決まった間隔で `GET /health` を送ります。失敗が続いた task には、リクエストを送らなくなります。

既定の間隔は 30 秒ですが、10 秒にしました。新しく登録された task は、**1 回**成功すれば健全と見なされます（`healthyThresholdCount` の 2 は、不健全になった task が復帰するときの回数です）。逆に、2 回続けて失敗すると外されるので、壊れた task にリクエストが届く時間は、長くて 20 秒ほどになります。

知っておきたいのは、全部の task が不健全になったときの挙動です。ALB は「送り先がない」とはせず、全部の task に送ります（fail open）。health check が厳しすぎて全滅するくらいなら、動いているかもしれない task に送るほうがまし、という判断です。

### 時間の関係

この章には、互いに関係し合う「秒数」がたくさん出てきます。ばらばらに書くとずれるので、1 か所にまとめました。サーバーも stack も、ここを読みます。

<<< @/examples/12-containers/src/timing.ts{timing}

ずれると何が起きるかも、関数にしてあります。

<<< @/examples/12-containers/src/timing.ts{rules}

1 つ目が、さっきの 65 秒の話です。ALB は、task との接続を使い回して、60 秒使わなかったら閉じます。Node.js のサーバーは、既定では 5 秒で閉じます。サーバーのほうが先に閉じると、ALB が「まだ使える」と思っている接続にリクエストを流して、行き場のないリクエストが 502 になります。AWS のドキュメントも、アプリ側の時間を ALB より長くするように勧めています。なので 65 秒。

<<< @/examples/12-containers/test/timing.test.ts{broken}

型は、この関係を守ってくれません。`serverKeepAlive: 5` も `number` です。テストは、いまの値の組み合わせに問題がないことと、1 つ崩すと何が報告されるかを見ています。stack のテストは、template に入った値が、この表の値と同じであることを見ています。

## 更新中に起きること

<!-- section: 12.rollout -->

`-c imageTag=v2` を付けて deploy すると、task definition が新しくなり、service が task を入れ替え始めます。これが rolling update です。

```figure
caption: desired count 2、minimumHealthyPercent 100、maximumPercent 200 の rolling update では、新しい task が health check に通ってから古い task が止まる
type: sequence
actor old: 古い task (v1)
actor new: 新しい task (v2)
actor req: リクエスト | 誰が答えるか
note old: 1: 2 つ running
step req -> old: 1: v1 v1
note new: 2: 最大 2 つ起動中 (pull, boot)
step req -> old: 2: v1 v1
note new: 3: running, 最初の health check に合格
step req -> old: 3: v1 v1
step req -> new: 3: v2 v2 (両方の版が答える)
note old: 4: 2 つ draining
note old: v1 は進行中の分を終える
note new: 4: 2 つ running
step req -> new: 4: v2 v2
note old: 5: stopped
note new: 5: 2 つ running
step req -> new: 5: v2 v2
```

```figure
caption: 新しい task が 3 を越えられないと、circuit breaker が deployment を失敗と判定して、最後に COMPLETED になった状態へ戻す
type: sequence
actor old: 古い task (v1)
actor new: 新しい task (v2)
note old: 3': 2 つ running
step new -x new: 3': 起動か health check に 3 回失敗
note old: 4': 2 つ running
note new: 4': circuit breaker: deployment FAILED
step new --> old: 4': 最後の COMPLETED へ rollback
```

`minimumHealthyPercent: 100` は「健全な task を、2 つより減らさない」。`maximumPercent: 200` は「入れ替えの間、4 つまで動かしていい」。この 2 つで、古い task を止める前に新しい task を起動する、という順序が決まります。50 と 100 にすれば、先に 1 つ止めてから 1 つ起動する形になって、余分な task は要らないかわりに、途中の処理能力が半分になります。

**deployment circuit breaker** は、3' と 4' のためのものです。新しい task が起動できない、あるいは health check に通らないことが続くと、更新を失敗と判定します。何回で諦めるかは、task の数の半分（最低 3、最高 200）。task 2 つなら 3 回です。`rollback: true` にしてあるので、最後に成功した状態へ自動で戻します。

有効にしていないと、更新は失敗と判定されないまま続きます。

1 つ、できないことを覚えておいてください。circuit breaker が見るのは、task が起動したかと、health check に通ったかです。`/health` には 200 を返すのに `/notes` が 500 になる、という壊れ方は見つけられません。次の節で、まさにそれを起こします。

### task が止まるとき

4 の「draining」の中身を、もう少し細かく見ます。

```figure
caption: task を止めるとき、ECS は先に load balancer から外し、それから SIGTERM を送り、まだ残っていれば SIGKILL を送る
type: sequence
actor ecs: ECS と load balancer
actor srv: task の中の server
step ecs -> ecs: t0: ECS が task を止めると決める
note ecs: task: DEACTIVATING, target: draining
note ecs: 新しいリクエストはこの target に来ない
note srv: 進行中の分にはまだ答える
step ecs -> ecs: t0+?: 接続が無くなるか、30 秒経つ
note ecs: deregistrationDelay = 30
step ecs -> srv: t1: task: STOPPING, SIGTERM
step srv -> srv: "draining" とログ、listen をやめる
step srv -> srv: idle な keep-alive 接続を閉じる
step srv -> srv: 進行中の分を終える
step srv -> srv: "stopped" とログ、exit 0
step srv -> srv: t1+25: deadline、残りを切って exit 1
step ecs -> srv: t1+30: まだ居れば SIGKILL
note ecs: stopTimeout = 30
```

先に ALB から外して、それから SIGTERM。この順序のおかげで、SIGTERM が届く頃には、新しいリクエストはもう来ていないはずです。

**deregistration delay** は、ALB が「外す」と決めた task について、進行中のリクエストが終わるのを待つ時間です。既定は 300 秒。task を 1 つ止めるたびに最大 5 分待つことになるので、30 秒に縮めました。このアプリのリクエストは長くても 10 秒、という前提です。ファイルの upload や streaming のような長いリクエストがあるなら、縮めすぎると途中で切れます。

「じゃあ graceful shutdown は要らないのでは？」と思うかもしれません。要ります。deregistration delay より長いリクエストは残りますし、さっき見たとおり、keep-alive の接続を片付けないとプロセスが終われません。ALB を通らない仕事（[08章](/ja/chapters/08-async.md)の、queue の処理など）には、そもそも前半がありません。

正直に言うと、この順序は、ECS のドキュメントが書いている task の状態の並び（DEACTIVATING で登録解除、そのあと STOPPING で SIGTERM）から読み取ったものです。実際に動かして、ログの時刻で確かめてはいません。確かめるためのタスクは用意してあります。

```bash
vp run ecs:watch
```

`/health` を 1 秒に 1 回呼んで、どの版が答えたかを表示し続けます。別のターミナルで動かしたまま deploy すれば、v1 と v2 が混ざる時間と、エラーが 1 件も出ないこと（出ないはず、です）が見えます。

## 新旧が同時に動く

<!-- section: 12.versions -->

さっきの図の 3 行目に戻ります。v1 と v2 が、同時に応答している時間があります。数十秒かもしれないし、task が多ければ数分かもしれない。rollback が起きれば、v2 が書いたものを v1 が読む時間も来ます。

task の外にデータがあるなら、それを両方の版が読み書きします。

この章の invariant を 1 文で書くと、こうです。**「同時に動いているどの版も、同時に動いているどの版が書いた record でも読める」。**

具体的にやってみます。v2 で、ノートに `pinned` という項目を足すとしましょう。

<<< @/examples/12-containers/src/compat.ts{formats}

`v1` と `v2` は、うまくいく組み合わせです。v1 は知らない項目を黙って捨て、v2 は無い項目を既定値で埋めます。

`v2Required` と `v1Strict` は、どちらも「きちんとしている」ように見えて、更新を壊す書き方です。

テストでは、task の外にあるデータの代わりを用意しました。

<<< @/examples/12-containers/src/compat.ts{store}

保存してあるのは JSON の文字列で、それぞれの task は、自分の版の schema を通して読み書きします。DynamoDB の item でも、SQL の行でも、キューのメッセージでも、起きることは同じです。

そして、本物の HTTP サーバーを 2 つ、同時に立てます。

<<< @/examples/12-containers/test/versions.test.ts{rollout}

```figure
caption: record はどの task よりも長く残るので、v1 と v2 は互いが書いた record を読むことになる
type: sequence
actor v1: v1 の task
actor rec: record | どの task よりも長く残る
actor v2: v2 の task
step v1 -> rec: t1 POST /notes
note rec: {id,title,body,createdAt}
step v2 -> rec: t2 POST /notes
note rec: {..., pinned:false}
step rec --> v1: t3 GET /notes: 両方読む
note v1: "pinned" を捨てる
step rec --> v2: t4 GET /notes: 両方読む
note v2: pinned=false で埋める
note v2: t5 rollback: v2 が止まる
step rec --> v1: t5 v2 が書いたものもまだ読む
```

壊れるほうの 2 つは、こう壊れます。

**新しい版が、古い record に無い項目を必須にした（`v2Required`）。** v2 の task に届いた `GET /notes` が 500 になります。v1 の task に届いたものは成功するので、利用者から見ると「2 回に 1 回失敗する」。そして `/health` は 200 のままです。ALB も circuit breaker も気づきません。テストは、health check が通ることと一覧が失敗することを、並べて確かめています。

**古い版が、知らない項目を拒否する（`v1Strict`）。** v2 が 1 件書いた瞬間から、v1 の task が読めなくなります。慌てて rollback しても直りません。v2 のコードは消えますが、v2 が書いた record は残るからです。

ここから、順序の決まりが出てきます。

- 項目を**足す**ときは、任意の項目として足し、読む側で既定値を埋める。古い版は、知らない項目を無視できるようにしておく
- 項目を**必須にする**のは、それを書かない版がどこにも動いていなくなり、古い record も埋め終わってから。足すのと必須にするのは、別の deploy にする
- 項目を**消す・名前を変える**のは、1 回ではやらない。新しい名前を足す、両方を書く、読む側を切り替える、古いほうを消す、と分ける

この決まりは、ECS に限った話ではありません。止めずに入れ替える仕組みなら、どこでも新旧が同居する時間があります。task を 2 つ並べて、順に入れ替えるようになって、それが目に見えるようになっただけです。

1 つ断っておくと、このサンプルを deploy しても、task どうしが共有するデータはありません（ノートはまだメモリの中です）。deploy した環境で新旧が同時に触るのは、いまのところ利用者だけ。`ecs:watch` で見える `x-app-version` の入れ替わりが、それです。テストが使っている `SharedRecords` は、05章や 13章のデータストアにつないだときに起きることを、手元で先に見るためのものです。

## task を増やす、減らす

<!-- section: 12.scaling -->

<<< @/examples/12-containers/infra/lib/containers-stack.ts{scaling}

**target tracking** という方式です。「service 全体の平均 CPU 使用率を 60% に保つ」とだけ決めて、task の数の増減は任せます。エアコンの設定温度みたいなものですね。

指標は、よく使われるものが 2 つあります。

**CPU 使用率。** このサンプルで使っているほうです。計算で忙しくなるアプリに向きます。Node.js は 1 つのスレッドでリクエストをさばくので、0.25 vCPU の task は CPU を使い切るとすぐ待ち行列ができます。早めに増やしたくて、目標を 60% にしました。

**target あたりのリクエスト数**（`ALBRequestCountPerTarget`）。ALB が数えた、task 1 つあたりのリクエスト数です。データベースや外部の API を待っている時間が長いアプリは、忙しくても CPU は暇なままなので、こちらのほうが実態に合います。このサンプルには入れていません。「task 1 つが何件さばけるか」を測らないと、目標の値を決められないからです。

両方付けることもできます。その場合、どちらか 1 つでも「増やす」と言えば増え、全部が「減らしていい」と言ったときだけ減ります。増やすのは速く、減らすのは慎重に、という作りです。

上限の 4 は、料金の上限でもあります。task が 1 つ増えると、public subnet なら月 USD 12.65。4 つで張り付くと、この stack の固定費は月 USD 75.62 になります。上限を決めずに auto scaling を付けるのは、上限のない請求を受け入れるのと同じです。

scale in で task が減るときも、止まり方は更新のときと同じです。ALB から外され、SIGTERM が届き、`stopTimeout` で SIGKILL。graceful shutdown が、ここでも効きます。ちなみに deploy が進んでいる間は、scale in は止まります（scale out は止まりません）。

正直に言うと、auto scaling は負荷をかけて試していません。template に入ることを確かめただけです。
