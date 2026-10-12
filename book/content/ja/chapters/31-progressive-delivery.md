---
title: "31 Progressive Delivery: alias、canary、blue/green、feature flag"
revision: 1
---

# 31 Progressive Delivery: alias、canary、blue/green、feature flag

[20章](/ja/chapters/20-shipping.md)のデプロイは、成功した瞬間にすべてのリクエストが新しいコードに届くものでした。戻す方法は、コードを戻してもう一度デプロイすることだけです。テストを通り抜けた不具合は、全員に届いてから見つかります。

この章では、変更をまず一部のリクエストにだけ届け、アラームが鳴らなければ残りに広げます。鳴ったら、人が気づく前に元へ戻します。あわせて、デプロイ済みのコードのふるまいを、デプロイせずに切り替えるフィーチャーフラグ（feature flag）を足します。題材は 04章のノート API です。

この章の AWS 側の手順は、まだ一度も実際には動かしていません。手元で確かめたのは、テスト、型検査、synth、手元のサーバーまでです。何が未確認かは、[章末の検証メモ](/ja/chapters/31-progressive-delivery/wrap.md)にまとめてあります。

前提は [20章](/ja/chapters/20-shipping.md)と [12章](/ja/chapters/12-containers.md)です。アラームは [19章](/ja/chapters/19-observability.md)のものと同じ考え方で作ります。コードは `examples/31-progressive-delivery/` にあります。

## 全体像

<!-- section: 31.overview -->

```figure
caption: リクエストはエイリアスを通って 2 つのバージョンのどちらかに届き、どちらのバージョンも同じフラグを読む
node client: Client
node api: API Gateway | HTTP API
node alias: alias live | weights
node old: version 3 | 90%
node new: version 4 | 10%
node extension: AppConfig extension | localhost:2772
node appconfig: AppConfig | flags
edge client -> api
edge api -> alias
edge alias -> old
edge alias -> new
edge old -> extension
edge new -> extension
edge extension --> appconfig: 45 秒ごとに確認
group aws: AWS account (ap-northeast-1) = api, alias, old, new, extension, appconfig
mark alias
```

```figure
caption: コード、エイリアス、フラグは別々のタスクが動かし、同じ 2 つのアラームが切り替えとフラグの両方を止める
direction: right
node deploy: rollout:infra:deploy | cdkd
node start: rollout:start
node flags: flags:deploy
node latest: $LATEST | 新しいコード
node alias: alias live | 重み
node config: AppConfig | フラグの版
node alarms: CloudWatch alarms | Errors, 5xx
edge deploy -> latest
edge start -> alias: UpdateAlias
edge flags -> config: StartDeployment
edge alarms --> start: 30 秒ごとに読む
edge alarms --> config: monitor
```

1 つ目の図が、リクエストの通り道です。API Gateway が呼ぶのは関数そのものではなく、`live` という名前のエイリアスです。エイリアスはふだん 1 つのバージョンを指していますが、切り替えの間だけ 2 つを指し、リクエストを割合で振り分けます。どちらのバージョンも、同じ実行環境の中で動く AppConfig の拡張機能にフラグを問い合わせます。

2 つ目の図は、誰が何を動かすかです。この章では、変更を届ける操作が 3 つに分かれます。

- `rollout:infra:deploy` は、新しいコードを `$LATEST` に置きます。エイリアスは動かないので、この時点では誰にも届きません
- `rollout:start` は、そのコードをバージョンとして固定し、エイリアスの重みを少しずつ移します。アラームが鳴れば元に戻します
- `flags:deploy` は、フラグの値を AppConfig に保存し、実行環境に少しずつ配ります

3 つとも、止める判断には同じ 2 つのアラームを使います。

## コードを出すことと、ふるまいを出すこと

<!-- section: 31.release-vs-deploy -->

20章までは、デプロイすることと、利用者のふるまいが変わることが同じ出来事でした。この章では、その 2 つを分けて、別々に動かせるようにします。

エイリアスの重みが変えるのは、どのコードがリクエストに答えるかです。新しいバージョンに 10% を送れば、10% のリクエストが新しいコードで処理されます。確かめたいのは、新しいコードが落ちないこと、遅くならないこと、古いデータを読めることです。振り分けはリクエストごとに決まるので、同じ利用者の続けて 2 回のリクエストが、別のバージョンに届くこともあります。

フラグが変えるのは、同じコードが何をするかです。新しい機能のコードは、フラグを切った状態で全員に届けておきます。機能を見せる相手は、あとからフラグで決めます。こちらは利用者の ID で決まるので、同じ利用者にはいつも同じ答えが返ります。

2 つを分けておくと、問題が起きたときに戻すものを選べます。新しいコードそのものが壊れていればエイリアスを戻し、新しい機能に問題があればフラグを切ります。フラグを切るのにデプロイは要りません。

分けたぶん、状態の組み合わせは増えます。新旧 2 つのコードと、フラグの入と切で、同時に 4 通りの組み合わせが動きます。データを読み書きするコードは、そのどれとも共存できなければなりません。これは 12章のローリングアップデートで見た不変条件と同じもので、[実装のつづき](/ja/chapters/31-progressive-delivery/more.md)でテストにします。

## この構成を選んだ理由

<!-- section: 31.choices -->

AWS には、Lambda のエイリアスを段階的に動かす既製の仕組みとして CodeDeploy があります。CloudFormation のテンプレートでは、エイリアスに `UpdatePolicy` という属性を付けておくと、エイリアスが指すバージョンが変わるときに、CloudFormation が CodeDeploy に切り替えを頼みます。

この本のスタックは cdkd でデプロイします。固定した版の cdkd（0.296.28）は、CloudFormation を通さずに各サービスの API を直接呼ぶので、`UpdatePolicy` を読む処理がありません。インストールした cdkd の中身を検索しても、`UpdatePolicy` と `CodeDeploy` はどちらも一度も出てきませんでした。そのため、この章では重みを動かす処理を自分で書きます。Lambda の API を呼ぶ小さなスクリプトで、判断の部分は純粋な関数にしてテストを付けました。

自分で書くと、CodeDeploy が隠している部分を読めます。何秒ごとにアラームを見るのか、アラームが読めなかったらどうするのか、途中でスクリプトが止まったらエイリアスはどうなるのか、といった点です。そのかわり、スクリプトを動かしている端末やジョブが止まれば、切り替えも見張りもそこで止まります。CodeDeploy なら AWS の側で動き続けます。本番で CloudFormation の経路（20章）を使っているなら、CodeDeploy を選ぶほうが素直です。その場合に書くものは、[しくみと実装](/ja/chapters/31-progressive-delivery/build.md)の最後に載せました。

フラグには AppConfig を使います。値を JSON で持ち、決めた速さで実行環境に配り、アラームが鳴ったら前の値に戻すところまでが 1 つのサービスに入っています。環境変数でも同じことはできそうに見えますが、Lambda の環境変数はバージョンに固定されるので、変えるにはバージョンを作り直すことになり、コードの切り替えと区別がつかなくなります。

### この構成が向かない場合

段階的な切り替えは、判断の材料になるだけのリクエストがあって初めて意味を持ちます。1 分に数件しか来ない API で 10% を新しいバージョンに送っても、canary の数分の間に、新しいバージョンへ 1 件も届かないことがあります。届いていないのにアラームが鳴らなかったことを、健全だった証拠にはできません。この計算は[しくみと実装](/ja/chapters/31-progressive-delivery/build.md)でします。リクエストが少ないうちは、20章のやり方に、デプロイ直後の動作確認を足すほうが確実です。

フラグも、増やすほど負債になります。使い終わったフラグを消さないと、誰も読んでいないスイッチがコードと設定の両方に残ります。この章のテストは、コードが読まないフラグが設定に残っていると失敗するようにしてあります。

Cloudflare Workers や Vercel を使っていて、割合での切り替えだけが欲しいなら、どちらにも同じ目的の機能があります。違いは[最後のページ](/ja/chapters/31-progressive-delivery/wrap.md)にまとめました。
