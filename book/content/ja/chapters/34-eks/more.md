---
title: "34 Kubernetes: 実装のつづき"
---

# 34 Kubernetes: 実装のつづき

[前のページ](/ja/chapters/34-eks/build.md)で、AWS の側に作るものが決まりました。このページでは、クラスターに適用するマニフェストを書きます。アプリの本体、入口、止められるときの振る舞い、同時に欠けてよい Pod の数、そしてクラスターの外に置くものを扱います。

## マニフェストを、型のあるコードで書く

<!-- section: 34.manifests -->

Kubernetes のマニフェストは、ふつう YAML で書きます。この章では TypeScript の関数で組み立て、JSON で出力します。`kubectl apply` は JSON も読むので、YAML を書くための依存を足さずに済みます。出力したものは `examples/34-eks/k8s/` に置いてあり、コードを動かさなくても読めます。

コードで書く理由は、値のつながりです。Pod の大きさは 12章のタスクと同じ値から、秒数は 12章のサーバーと同じ値から、namespace と service account の名前はスタックと同じ定数から決まります。YAML に写すと、片方だけを直す誤りを誰も止められません。

Deployment は次のとおりです。

<<< @/examples/34-eks/src/manifests.ts{deployment}

12章のタスク定義と比べると、同じことを別の名前で書いている場所がいくつもあります。

- `resources.requests` は、タスク定義の `cpu` と `memoryLimitMiB` に当たります。ただし意味が少し違います。`requests` は、Kubernetes が Pod をどのノードに置くかを決めるための予約です。Pod が実際に使える量の上限は `limits` で、メモリだけに付けました。CPU に上限を付けると、ノードに余裕があっても Pod が絞られるからです
- `securityContext` の `readOnlyRootFilesystem` は、タスク定義の `readonlyRootFilesystem` です。`runAsUser: 1000` は、Dockerfile の `USER node` に当たります。`runAsNonRoot` は名前で書かれたユーザーを確かめられないので、Node.js のイメージが `node` に割り当てている番号を書きました
- `readinessProbe` と `livenessProbe` は、kubelet がノードの中から `/health` を呼ぶ確認です。readiness に失敗した Pod は、Service の届け先から外れます。liveness に失敗し続けた Pod は、再起動されます。12章には、ALB が外から呼ぶ確認しかありませんでした。この章では両方があります
- `topologySpreadConstraints` は、Pod を AZ に均等に置く指定です。書かなければ、2 つの Pod が同じノードに載ることがあります
- `nodeSelector` は、arm64 のノードにだけ置く指定です。タスク定義の `runtimePlatform` に当たります

`serviceAccountName` は、前のページの Pod Identity の関連付けが指している名前です。

### スキーマで確かめる

組み立てたマニフェストは、Valibot のスキーマに通します。スキーマは、この章が書くオブジェクトの、この章が使うフィールドだけを持っています。

<<< @/examples/34-eks/src/k8s/schema.ts{workload}

どのオブジェクトも `v.strictObject` にしてあるので、スキーマに無いフィールドは拒否されます。`readinessProbe` を `readinesProbe` と書くような誤りが、手元のテストで落ちます。

<<< @/examples/34-eks/test/manifests.test.ts{refused}

**このスキーマは、API サーバーの検査ではありません。** Kubernetes の API は、ここに書いた何十倍ものフィールドを持ち、フィールドどうしの制約も多くあります。スキーマを通ったマニフェストを API サーバーが受け取る保証はなく、スキーマが拒否するフィールドの大半は、Kubernetes では正しいフィールドです。確かめているのは、この章のジェネレーターと `k8s/` のファイルが、この章の決めた形から外れていないことだけです。NodeClass と IngressClassParams は EKS の独自の種類で、スキーマはドキュメントの例から書きました。

### オブジェクトどうしのつながり

Kubernetes のオブジェクトは、名前とラベルで互いを見つけます。Service は、セレクターに合うラベルを持つ Pod へ送ります。PodDisruptionBudget は、セレクターに合う Pod を守ります。このつながりが切れていても、Kubernetes はどれもエラーにしません。Service は届け先が 0 のまま存在し、PodDisruptionBudget は何も守らないまま存在します。

1 つのオブジェクトだけを見るスキーマでは、この誤りを見つけられないので、別の検査を書きました。

<<< @/examples/34-eks/src/k8s/check.ts{references}

<<< @/examples/34-eks/test/manifests.test.ts{silent}

テストは、つながりを 1 か所ずつ切って、それぞれが報告されることを確かめています。最後のテストは、アプリのマニフェストだけを見ると namespace が無い、という報告です。`k8s/cluster.json` を先に適用する順番は、この検査が教えてくれます。

`k8s/` のファイルは、手で書き換えるものではありません。

```bash
vp run eks:render
vp run eks:render --write
```

1 つ目は、ファイルがジェネレーターの出力と違っていれば失敗します。2 つ目が書き直します。ファイルの中のロールの名前、セキュリティグループの ID、イメージの URI は、見本の値です。実際の値は、デプロイのときにスタックの出力から入れます。

<<< @/examples/34-eks/src/rendered.ts{example}

## 入口

<!-- section: 34.traffic -->

12章では、ALB、リスナー、ターゲットグループをスタックに書きました。この章では、次の 2 つをマニフェストに書くと、Auto Mode が同じものを作ります。

<<< @/examples/34-eks/src/manifests.ts{traffic}

**Service** は、ラベルの合う Pod の集まりに `notes-api` という名前と 80 番のポートを付けます。**Ingress** は、外から来た HTTP をこの Service に送ると書いています。Auto Mode はこれを見て、ALB を作り、Pod の IP アドレスをターゲットグループに直接登録します。12章のターゲットグループが `target type: ip` だったのと同じ形です。

どのコントローラーが Ingress を受け持つかは、IngressClass で決まります。

<<< @/examples/34-eks/src/manifests.ts{cluster}

`controller` が `eks.amazonaws.com/alb` なので、受け持つのは Auto Mode に組み込まれた機能です。Auto Mode を使わないクラスターでは、AWS Load Balancer Controller を自分でクラスターに入れ、IAM の権限を渡し、バージョンを上げていきます。

ALB を置くサブネットは、`IngressClassParams` で選びます。Auto Mode は、既定ではサブネットの `kubernetes.io/role/elb` タグを見てパブリックサブネットを探しますが、11章のサブネットにはこのタグがありません。11章のスタックを書き換えるかわりに、`Name` タグで名指ししました。

Ingress の annotation は、12章のターゲットグループと同じヘルスチェックと deregistration delay を指定しています。値は 12章と同じファイルから来ています。annotation の名前は AWS Load Balancer Controller のもので、Auto Mode のドキュメントは、Ingress に付けた annotation でロードバランサーを設定できるとし、使えない annotation の一覧を載せています。この章の 7 つはその一覧にありません。Auto Mode で実際に効くことは、確かめていません。

リスナーは 12章と同じ HTTP の 80 番だけで、通信は暗号化されません。HTTPS にするには、証明書の ARN を `IngressClassParams` の `certificateARNs` に書きます。

Ingress のかわりに Gateway API を使う道もあります。AWS Load Balancer Controller は 2.14.0 から Gateway を見て ALB を作るとドキュメントにあります。Auto Mode の組み込みの機能が Gateway API を扱うかどうかは、読んだ範囲のドキュメントに記述が見つからなかったので、この章は Ingress を使いました。

## 止められるとき

<!-- section: 34.shutdown -->

12章のサーバーは、SIGTERM を受けたら新しいリクエストを受けるのをやめ、進行中のリクエストに答え、25 秒で諦める作りでした。イメージは同じなので、サーバーの振る舞いは変わりません。変わるのは、SIGTERM が届くまでの順序です。

ECS は、タスクを先にロードバランサーから外し、deregistration delay が過ぎてから SIGTERM を送りました。Kubernetes は、**Pod を届け先から外す処理と、SIGTERM を送る処理を、同時に始めます**。ロードバランサーが外し終わる前に、サーバーが接続を受けるのをやめることがありえます。その間に届いたリクエストは失敗します。

```figure
caption: Kubernetes は届け先から外す処理と Pod を止める処理を同時に始める。preStop で 15 秒待つので、SIGTERM が届くころにはロードバランサーが新しいリクエストを送らなくなっている
type: sequence
actor cp: Kubernetes と ALB
actor pod: Pod の中のサーバー
step cp -> cp: t0: Pod の削除が決まる
note cp: 届け先から外し始める
step cp -> pod: t0: preStop, 15 秒待つ
note pod: まだ SIGTERM は来ていない
note pod: 届いたリクエストには答える
note cp: ALB が新しく送らなくなる
note cp: deregistrationDelay = 30
step cp -> pod: t0+15: SIGTERM
step pod -> pod: "draining" とログ、listen をやめる
step pod -> pod: 進行中の分を終えて exit 0
step pod -> pod: t0+40: deadline、残りを切って exit 1
step cp -> pod: t0+45: まだ居れば SIGKILL
note cp: terminationGracePeriodSeconds = 45
```

よく使われる対処は、SIGTERM の前に待つことです。Deployment の `preStop` に `sleep` を書くと、kubelet がその秒数だけ待ってから SIGTERM を送ります。待っている間、サーバーはふだんどおり答えます。

秒数は、12章のものにこの章のものを足して、1 つのオブジェクトにしてあります。

<<< @/examples/34-eks/src/timing.ts{timing}

`terminationGracePeriod` は、`preStop` の始まりから SIGKILL までの時間です。`preStop` で待った時間も、ここから引かれます。既定の 30 秒のままだと、15 秒待ったあとにサーバーに残るのは 15 秒で、サーバー自身の締め切りの 25 秒より先に SIGKILL が来ます。45 秒にしたので、SIGTERM のあとに残るのは 30 秒で、12章の `stopTimeout` と同じになります。

値の関係は、12章の規則をそのまま使い、この章のぶんを足して確かめています。

<<< @/examples/34-eks/src/timing.ts{rules}

<<< @/examples/34-eks/test/timing.test.ts{broken}

`deregistrationLag` の 10 秒は仮定です。コントローラーが Pod の削除に気づき、ALB がそのターゲットへ新しいリクエストを送らなくなるまでの時間を、この本では計っていません。`preStop` の 15 秒は、その仮定に余裕を足した値です。実際のクラスターで入れ替えの間にエラーが出るなら、最初に疑う値です。

`minReadySeconds` も、同じ種類の用心です。kubelet の readiness が通った時点では、ALB はまだその Pod のヘルスチェックを終えていないかもしれません。新しい Pod を 30 秒は利用可能と数えないことで、ALB が新しい Pod を使い始める前に古い Pod が止められるのを避けます。AWS Load Balancer Controller には、ALB の判定を Pod の readiness に反映する仕組み（readiness gate）があります。Auto Mode で同じものが使えるかどうかは、確かめていません。

## 同時に欠けてよい Pod の数

<!-- section: 34.disruption -->

Pod が減る理由は 3 つあります。新しい版への入れ替え、ノードの入れ替え、そして故障です。最初の 2 つには、それぞれ別の設定があります。

### 入れ替えのとき

Deployment の `maxSurge` と `maxUnavailable` は、12章の `maximumPercent` と `minimumHealthyPercent` に当たります。数え方が違うので、関数にしました。

<<< @/examples/34-eks/src/rollout.ts{rolling}

割合で書いたとき、`maxSurge` は切り上げ、`maxUnavailable` は切り捨てです。この章の値（`100%` と `0`）では、Pod は最大 4 つになり、利用できる Pod が 2 つを下回りません。12章の 200 と 100 と同じ動きです。

<<< @/examples/34-eks/test/rollout.test.ts{rolling}

Kubernetes の既定は、どちらも 25% です。Pod が 2 つなら、25% は 0.5 で、増やせるのは切り上げて 1、減らせるのは切り捨てて 0 になります。既定のままでも、2 つを下回りません。Pod の数が変わると結果も変わるので、既定に頼るより、数で書くほうが読み違えません。

`rolloutSteps` は、入れ替えの段階を並べる小さなモデルです。新しい Pod がすべて同時に利用可能になると仮定しているので、実際のクラスターの動きそのものではありません。

### ノードが入れ替わるとき

Auto Mode のノードは、長くても 21 日で入れ替わります。既定では 336 時間（14 日）で、新しい AMI がおよそ週に 1 度出るたびにも入れ替わります。Kubernetes のバージョンを上げたときも同じです。ノードを空にする操作を drain と呼び、ノードの上の Pod は 1 つずつ退去（eviction）を求められます。

Fargate では、タスクが止まるのは自分がデプロイしたときがほとんどでした。Auto Mode では、何もデプロイしていなくても、2 週間に 1 度は Pod が動かされます。

**PodDisruptionBudget** は、この退去を同時にいくつまで認めるかを決めます。

<<< @/examples/34-eks/src/manifests.ts{budget}

<<< @/examples/34-eks/src/rollout.ts{budget}

`maxUnavailable: 1` と Pod 2 つなら、健全な Pod が 2 つあるときに 1 つの退去が認められ、1 つになったら次は拒否されます（API は 429 を返します）。割合で書くと、`minAvailable` も `maxUnavailable` も切り上げです。`maxUnavailable: 30%` と Pod 7 つでは、2.1 が 3 になり、書いた割合より多く欠けます。

drain の進み方は、次の関数で順に追えます。

<<< @/examples/34-eks/src/rollout.ts{drain}

<<< @/examples/34-eks/test/rollout.test.ts{drain}

3 つのテストが、PodDisruptionBudget の 3 通りの結果です。

この章の設定では、同じノードに 2 つの Pod があっても、1 つずつ出ていき、常に 1 つは答えています。

PodDisruptionBudget が無いと、2 つとも同時に退去させられ、代わりの Pod が起動するまで、誰も答えません。Deployment の `maxUnavailable: 0` は入れ替えのときの設定で、drain には効きません。

`minAvailable` を Pod の数と同じにすると、退去は 1 つも認められず、drain は終わりません。Pod を守ったつもりの設定が、ノードの更新を止めます。Auto Mode のドキュメントは、21 日の上限までに介入が必要になる場合があると書いています。上限に達したときに Pod がどう扱われるかは、確かめていません。

### 2 つが重なったとき

入れ替えの最中に drain が始まることもあります。ドキュメントによると、入れ替えで減った Pod は PodDisruptionBudget の勘定に入りますが、Deployment の入れ替えそのものは PodDisruptionBudget に止められません。

<<< @/examples/34-eks/src/rollout.ts{floor}

<<< @/examples/34-eks/test/rollout.test.ts{floor}

この章の設定で、意図した中断だけなら、答えている Pod は 1 つを下回りません。これがこの章の不変条件です。

**ノードの故障は、この計算の外にあります。** PodDisruptionBudget が数えるのは、退去の API を通る中断だけです。ノードが突然止まれば、その上の Pod はすべて同時に消えます。AZ に分けて置く指定（`topologySpreadConstraints`）は、そのための別の備えです。2 つの Pod が別の AZ の別のノードにあれば、1 つのノードの故障で失うのは 1 つです。

## クラスターの外に置くもの

<!-- section: 34.data -->

12章の最後の節は、新旧の版が同じデータを同時に読み書きするときの決まりでした。その前提は、データがタスクの外にあることです。Kubernetes でも変わりません。

Kubernetes には、Pod にボリュームを付け、Pod ごとに名前とデータを保つ仕組み（StatefulSet と PersistentVolume）があります。Auto Mode は EBS のボリュームを扱う機能も組み込んでいます。データベースをクラスターの中で動かすこともできます。

この章は、そうしません。ノートを置くなら、05章の DynamoDB か 13章の Aurora に置き、Pod からは Pod Identity のロールで呼びます。理由は 3 つあります。

- Pod は、2 週間に 1 度は別のノードへ動かされます。EBS のボリュームは 1 つの AZ にあるので、データを持つ Pod は、その AZ のノードにしか戻れません
- バックアップ、リストア、暗号化、保持は、22章までで AWS のサービスの機能として組み立ててきました。クラスターの中に置くと、同じものを Kubernetes の道具で組み立て直すことになります
- クラスターにデータが無ければ、クラスターを消して作り直せます。バージョンを上げるのが怖いときに、新しいクラスターを横に作って切り替える道が残ります

このスタックにデータを持つリソースが 1 つも無いのは、そのためです。テストは、スタックのどのリソースにも残す設定が付いていないことを確かめています。消して困るものを、このスタックに足さないでください。
