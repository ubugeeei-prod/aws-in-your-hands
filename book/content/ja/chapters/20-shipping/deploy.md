---
title: "20 CI/CD: デプロイ"
---

# 20 CI/CD: デプロイ

## 戻せるもの、戻せないもの

<!-- section: 20.rollback -->

「失敗したら rollback するから大丈夫」と言うとき、何が戻るのかを分けておきましょう。

戻せるのは、template に書いてあるものです。関数のコード、環境変数、メモリの設定、IAM の policy、route。CloudFormation が自動で戻すのも、`git revert` してデプロイし直して戻すのも、これです。

戻せないのは、その間に起きたことです。

- 書き込まれたデータ。新しいコードが保存した行や object は、コードを戻しても残ります
- 変えてしまった schema。列を消したあとで、消す前のコードには戻れません
- 消した bucket や table の中身。`RemovalPolicy.RETAIN` にしていなければ、戻す先がありません
- 外に出ていったもの。送ったメール（15章）、呼んだ外部の API

Cloudflare の Workers でも事情は同じで、公式ドキュメントは rollback について、Worker につながったリソースは変わらない、データの構造が版の間で変わっているとエラーになりうる、と注意しています。

### version と alias

コードを速く戻すための仕組みが、Lambda にはあります。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{version}

Lambda の version は、関数のコードと設定の、番号付きの写しです。発行したあとは変えられません。alias は、version を指す名前つきのポインタ。この stack では、API Gateway は関数そのものではなく `live` という alias を呼びます。デプロイで関数が変わると、新しい version が発行されて、`live` がそちらを指すようになります。

古い version は消さずに残しています（`RemovalPolicy.RETAIN`）。CloudFormation が更新を rollback するとき、`live` を前の version に戻せるように、です。そのぶん、version はデプロイのたびに増えていきます。stack を消して関数が消えるまで、残ります。

alias は、2 つの version に重みを付けて振り分けることもできます。新しい版に 10% だけ流して様子を見る、というやり方です。AWS のドキュメントによれば、振り分けは確率的で、リクエストが少ないと設定した割合から大きくずれることがあります。CodeDeploy には、これを時間をかけて自動で進める設定が用意されています。どちらも、この章では実装していません。エラー率のアラーム（[19章](/ja/chapters/19-observability.md)）につないで止める仕組みが無いまま段階的に切り替えても、問題に気づくのが遅くなるだけだからです。

急いでいるとき、コンソールで `live` を前の version に付け替えたくなるかもしれません。戻りはしますが、それは CloudFormation の外での変更、つまり drift です。template は新しい version を指したままなので、次のデプロイで、また新しいほうに向きます。戻すなら、コードを戻してデプロイする。緊急で手で戻したなら、あとで必ずコードを合わせる。後半の drift 検出は、これを見つけるためにもあります。

### schema は、古いコードが動く順に変える

コードと DB の schema は、同時には変わりません。そして、rollback で戻るのはコードだけです。

だから schema の変更は、「1 つ前の版のコードが、新しい schema でも動く」順番に分けます。

1. 足す。新しい列や table を足すだけ。古いコードは、それを知らなくても動く
2. 新しいコードを出す。ここで rollback しても、古いコードは 1. の schema で動く
3. 古い行を埋める
4. 古い列を、もう誰も読んでいないことを確かめてから消す。消すのは別のデプロイで

4 を 2 と同じデプロイに入れると、そのデプロイは戻せなくなります。[13章](/ja/chapters/13-sql.md)の「動いている DB の schema を変えるとき」は、この話の DSQL 版です。schema のない DynamoDB（[05章](/ja/chapters/05-dynamodb.md)）でも、item の形について同じことが言えます。コンテナで新旧の版が同時に動く時間をどう扱うかは、[12章](/ja/chapters/12-containers.md)で扱います。

## deploy は途中で止まる

<!-- section: 20.partial -->

デプロイを 1 つの出来事のように話してきましたが、実際は、何十回もの API 呼び出しの列です。その途中の、どこででも止まります。

```figure
caption: stack が rollback を終えるまでのあいだに、API を呼ぶ側には新しいコードが応えている時間がある
type: sequence
actor cfn: CloudFormation stack
actor caller: API を呼ぶ側
note cfn: t1: UPDATE_IN_PROGRESS
note caller: 古いコード (alias live -> version 7)
step cfn -> cfn: t2: AWS::Lambda::Version 8 を作る
note caller: 古いコード
step cfn -> cfn: t3: alias live を version 8 に移す
note caller: 新しいコード
step cfn -x cfn: t4: 別の resource の更新が失敗
note caller: 新しいコード
note cfn: t5: UPDATE_ROLLBACK_IN_PROGRESS
note caller: 新しいコード、alias が戻ると古いコード
note cfn: t6: UPDATE_ROLLBACK_COMPLETE
note caller: 古いコード、t3..t5 に書かれたものは残る
```

これは一例です（どのリソースがどの順で更新されるかは、template の依存関係で決まります）。大事なのは t3 から t5 の間。この時間、新しいコードが本番のリクエストに応えています。そのあと stack は「元に戻りました」と言いますが、その間に書かれたデータは、戻っていません。

rollback 自体が失敗することもあります。戻す先のリソースが、誰かの手で消されていた、というような場合です。そうなると stack は `UPDATE_ROLLBACK_FAILED` になり、一部は新しく、一部は古いまま止まります。この状態の stack は、更新できません。

この章が守りたい invariant は 1 つです。**ほかの操作が動いている stack と、人が直さないと先へ進めない stack には、デプロイを始めない。**

<<< @/examples/20-shipping/src/stack-status.ts{next-step}

CloudFormation が返しうる状態のすべてに、「次に何をしていいか」を決めてあります。`switch` に `default` が無いので、SDK の型に新しい状態が増えたら、型検査が落ちます。

```bash
vp run ship:cfn:status
```

stack の状態と、次の一手を表示します。人が直さないと進めない状態のときだけ、終了コードが 1 になります。deploy の workflow が、デプロイの前にこれを呼んでいたのを思い出してください。

テストは、この invariant を壊しにいきます。名前が `_IN_PROGRESS` で終わる状態で、1 つでも「デプロイ可」になっていないか。更新が失敗して戻るまでの状態を順に並べて、途中で一度でも「デプロイ可」と答えないか。rollback にも失敗した stack を、「デプロイ可」と言っていないか。

`ROLLBACK_COMPLETE`（最初の作成に失敗した stack）は、少し特殊です。CloudFormation としては、この stack は消すことしかできません。でも、固定した版の CDK CLI は、次の `cdk deploy` のときに、この stack を自分で消してから作り直します（CLI のコードで確かめました）。なので「デプロイ可」にしてありますが、表示する文には「CloudFormation にできるのは削除だけ」と書いてあります。

進むか、戻るか。迷ったときの目安はこうです。stack が `UPDATE_ROLLBACK_COMPLETE` まで戻っているなら、もう戻っています。イベントで最初の失敗を探し、直して、もう一度デプロイします。`UPDATE_ROLLBACK_FAILED` なら、まず戻しきることを優先します（`cdk rollback`）。半分だけ新しい状態の上に、さらに変更を重ねないでください。

## CloudFormation の drift を、同じ gate に通す

<!-- section: 20.drift -->

02章で、drift の gate を作りました。「差が見つからなかった」と「全部比べて一致した」を区別して、後者のときだけ合格にするものでした。あれは cdkd 用です。CloudFormation で作った stack には、cdkd の state がありません。逆に、cdkd で作った stack を、CloudFormation の drift 検出は調べられません。調べる対象の stack が無いからです。

なので、CloudFormation の検出を呼んで、結果を同じ形の report にして、同じ gate に通します。

CloudFormation の drift 検出は、非同期です。

1. `DetectStackDrift` で検出を始める。返ってくるのは、検出の ID だけ
2. `DescribeStackDriftDetectionStatus` を、終わるまで繰り返し呼ぶ
3. `DescribeStackResourceDrifts` で、リソースごとの結果を読む

これに 4 つ目を足しました。`ListStackResources` で、stack にあるリソースを全部数えます。理由は次の節で。

<<< @/tools/src/drift/cloudformation.ts{api}

`tools/` のコードは、SDK を直接は知りません。4 つの呼び出しを持つ小さな interface だけを見ています。本物の client をつなぐのは、この数行です。

<<< @/examples/20-shipping/src/drift-client.ts{adapter}

テストでは、この interface を、決まった応答を順に返すものに差し替えます。

<<< @/tools/src/drift/cloudformation.ts{detect}

待つ間隔と回数の上限は、引数です。`sleep` も引数なので、テストは実際には待ちません。上限まで待っても終わらなかったら、`timeout` を返して、そこでやめます。このとき、3 つ目の API を呼ばないのがポイントです。`DescribeStackResourceDrifts` は、前回の検出の結果を覚えていて、聞けば返してくれます。今回の検出が終わっていないのに、前回の「一致」を読んで合格にしてしまう。それを防いでいます。

応答は、Zod の schema に通してから使います。SDK の型は「こういう形のはず」としか言っていないので。使わない項目は捨てています。おかげで、リソースの実際の設定値（`ActualProperties`）は、report に入りません。report に残るのは、ずれた property の名前だけです。

結果は、02章と同じ 7 つの状態のどれかになります。

| CloudFormation が言うこと | この本の状態 | gate の終了コード |
| --- | --- | --- |
| stack のすべてのリソースに、今回の検出の `IN_SYNC` がある | `clean` | 0 |
| `MODIFIED` のリソースがある | `drifted` | 10 |
| `DELETED` のリソースがある | `deleted` | 10 |
| 結果が無いリソースがある（対応していない種類など） | `unsupported` | 11 |
| nested stack がある、結果が今回の検出より古い、`UNKNOWN` | `incomplete` | 11 |
| `DETECTION_FAILED`、上限まで待っても終わらない、API のエラー、stack の状態とリソースの結果が食い違う | `failed` | 12 |
| stack が無い | `missing-target` | 12 |

<<< @/tools/src/drift/cloudformation.ts{classify}

テストは `tools/src/drift/cloudformation.test.ts` にあって、入力は `tools/src/drift/fixtures/cloudformation/` の 12 個のファイルです。これは API リファレンスと SDK の型から書いたもので、実際の AWS から採った応答ではありません。たとえば、存在しない stack に対するエラーの名前とメッセージは、「こう返るはず」という想定です。違っていた場合でも、状態は `failed` になり、gate の終了コードは同じ 12 です。良いほうには倒れません。

定期実行の workflow です。

<<< @/examples/20-shipping/workflows/drift.yml

report は、gate が落ちたときこそ読みたいので、`if: always()` で保存します。

定期実行には、弱点もあります。GitHub のドキュメントによれば、schedule は混んでいる時間帯には遅れたり、実行が落とされたりします。public repository では、60 日間動きがないと自動で無効になります。「通知が来ない」は「drift が無い」を意味しません。report の日付が新しいことを、ときどき自分で見てください。

ちなみに、固定した版の CDK CLI には `cdk drift` というコマンドもあります。同じ CloudFormation の検出を呼んで、結果を表示してくれます。手元でさっと見るなら、それで十分です。この章がわざわざ自分で API を呼んでいるのは、「検査されなかったリソース」を数えたいからです。

## `IN_SYNC` は「全部一致」ではない

<!-- section: 20.drift-coverage -->

CloudFormation が stack を `IN_SYNC` と言うとき、それは何を言っているんでしょう。公式ドキュメントを読むと、範囲がかなり限られていることがわかります（確認日 2026-10-12）。

- **検査するのは、対応している種類のリソースだけ。** 対応していないものは、黙って飛ばされます。対応するリソースが 1 つも無い stack も、`IN_SYNC` になります
- **比べるのは、template で明示した property だけ。** 既定値のままにした設定を誰かが変えても、drift にはなりません
- **nested stack の中は見ない。** 親で検出しても、子は別に検出する必要があります
- **比べられない property がある。** Lambda 関数のコード、`KMSKeyId`、サービスが値を返さない項目（パスワードなど）
- **結果が古いことがある。** リソースごとの結果には、それぞれ検査した時刻が付いています

この章の gate は、これを 1 つずつ拾います。さっき `ListStackResources` を足したのは、1 つ目のためです。`DescribeStackResourceDrifts` は、検査したリソースしか返しません。stack にあるリソースの一覧と突き合わせて、結果が無いものを「未検査」として数えます。最後の点は、リソースの結果の時刻が、今回の検出の開始より前なら、検査済みに数えないことで拾っています。

2 つ目だけは、gate では拾えません。report の `clean` は、「template に書いた property が、すべて一致した」という意味です。それ以上ではありません。逆に言うと、drift を見張りたい設定は、既定値と同じでも、CDK のコードに明示しておく価値があります。

ここは、cdkd との違いでもあります。cdkd のドキュメントによると、cdkd はデプロイのときに、AWS が返した property を全部 state に写しておきます。だから cdkd の drift は、コードに書かなかった property の変更も見つけます。どちらが優れているという話ではなく、比べているものが違う、ということです。

### この stack の場合

`AihShipApi` が使うリソースの種類を、公式の対応表と照らしました。

<<< @/examples/20-shipping/src/drift-coverage.ts{coverage}

API Gateway の integration（route と Lambda をつなぐ設定）は、対応表の drift の欄が「No」です。つまりこの stack は、何もずれていなくても、`clean` にはなりません。`unsupported` になって、gate は 11 を返します。

毎日 11 で落ちる検査は、3 日で誰も見なくなります。かといって、11 を「合格」と読み替えたら、02章の区別が台無しです。そこで、「検査できないと分かっていて、それを承知している種類」の一覧を、コードに置きました。

<<< @/tools/src/drift/cloudformation.ts{acknowledge}

未検査のリソースが、すべてこの一覧にある種類のときだけ、タスクは 0 で終わります。report の状態は `unsupported` のまま、gate も不合格のまま。表示にも「比べていない」と出ます。変わるのは、タスクの終了コードだけです。drift があった場合や、一覧にない種類が未検査だった場合は、何も変わらず落ちます。

一覧に種類を足すのは、コードの変更です。pull request で、理由と一緒にレビューされます。stack に新しい種類のリソースを足すと、「検査される」「承知のうえで検査されない」のどちらかの一覧に入れるまで、テストが落ちるようにしてあります。

設計の側でできることもあります。この stack は、関数の role の権限を、別のリソース（`AWS::IAM::Policy`）ではなく、role の中に inline で書いています。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{role}

04章の書き方（`grantWrite`）だと、権限は `AWS::IAM::Policy` という別のリソースになります。この種類は、対応表に載っていません。role の中に書けば、権限は role の property になり、role は検査の対象です。同じ理由で、`AWS::CDK::Metadata` というリソースも出さないようにしました。「未検査」を 1 つ減らすたびに、report が言えることが増えます。

とはいえ、対応表を読んだだけです。integration が本当に未検査になるのか、role の権限を手で変えたら drift として出るのかは、次の手順を実際に通すまで分かりません。

## わざとずらしてみる

<!-- section: 20.drift-lab -->

dev の stack（`AihShipApi`）をデプロイしてあれば、次の順に試せます。

1. `vp run ship:cfn:drift` を実行する。integration が未検査として表示され、状態は `unsupported`、タスクは 0 で終わるはず
2. コンソールの Lambda の画面で、関数のメモリを 256 MB から 512 MB に変える
3. `vp run ship:cfn:diff` を実行する。変更なしと出るはず。template も、CloudFormation が覚えている template も、変わっていないので
4. `vp run ship:cfn:drift` を実行する。`drifted` になり、`/MemorySize` が表示され、終了コードが 10 になるはず
5. 戻す。コードは 256 のままなので、コンソールで 256 に戻すか、`vp run ship:cfn:deploy --revert-drift` を試す
6. もう一度 `vp run ship:cfn:drift` を実行し、1 と同じ結果に戻ったことを確かめる

「はず」と書いたのは、この手順をまだ実際のアカウントで通していないからです。5 の `--revert-drift` は、固定した版の CLI のヘルプにある flag ですが、動作は確かめていません。なお、template が変わっていないとき、ふつうの `cdk deploy` は「変更なし」と判断して何もしません。drift は、デプロイし直すだけでは直らないことがあります。

02章の cdkd には、drift を解消するタスク（revert と accept）がありました。この章には用意していません。CloudFormation で「実物を正とする」には、コードを実物に合わせて直してデプロイする、が本来の手順です。
