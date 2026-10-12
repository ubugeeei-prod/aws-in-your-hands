---
title: "25 Events: デプロイ"
---

# 25 Events: デプロイ

## スタックを読む

<!-- section: 25.stack -->

このページでは、[しくみと実装のページ](/ja/chapters/25-events/build.md)で読んだ部品を AWS にのせるスタックを読み、デプロイの手順と、イベントが届かなかったときの調べ方、リプレイの手順を説明します。スタックは 08章のものを継承しているので、読むのは増えた部分だけです。

### stream とバス

<<< @/examples/25-events/infra/lib/events-stack.ts{stream}

ノートのテーブルに足す設定は、この 1 行だけです。`NEW_AND_OLD_IMAGES` は、変更の前と後の両方のアイテムをレコードに入れる指定です。更新でバージョンが変わったかを見るのにも、削除されたノートの ID を知るのにも、前の中身が要ります。

ドキュメントには注意が 1 つあります。stream を無効にすると、もう一度有効にしても、その stream を読んでいた pipe は使えなくなります。有効にし直した stream には新しい ARN が付くからです。stream の設定は、一度入れたら触らないものとして扱ってください。

<<< @/examples/25-events/infra/lib/events-stack.ts{bus}

バスには名前を付けるだけです。archive は、保持日数を必ず書きます。書かなければ、イベントは無期限に保存され、保存料金も無期限にかかります。

`AWS::Events::Archive` は、cdkd 0.296.28 に専用の実装がない種類です。cdkd は、そうした種類を Cloud Control API 経由で作ります。この経路で archive が作れて消せることは、確かめていません。

<<< @/examples/25-events/infra/lib/events-stack.ts{dead-letters}

届けられなかったものを置くキューは、1 つにまとめました。送り手は 4 種類あります。pipe、3 つのルール、Timeline の関数を呼んでいる Lambda、それに counter のキューです。まとめたのは、人が見にいく場所を 1 つにするためです。メッセージの形は送り手ごとに違うので、見分け方をこのページの後半で扱います。

<<< @/examples/25-events/infra/lib/events-stack.ts{projections}

コンシューマーが書くテーブルは、ノートのテーブルと分けました。分けておけば、コンシューマーのロールにノートのテーブルの権限を渡さずに済みますし、コンシューマーの書き込みが stream に現れて、また pipe を通ることもありません。同じテーブルに書くなら、pipe の filter がその輪を断つ唯一のものになります。EventBridge のドキュメントも、ルールが自分自身を起動し続ける輪に注意するよう書いています。

このテーブルの中身は、ノートから作り直せるものです。だからスタックと一緒に消える設定のままにしてあります。

### pipe

<<< @/examples/25-events/infra/lib/events-stack.ts{shape}

<<< @/examples/25-events/infra/lib/events-stack.ts{pipe}

pipe は、自分のロールで stream を読み、関数を呼び、バスにイベントを載せます。ロールに許しているのは、その 3 つと、デッドレターキューへの送信だけです。

このスタックで、リソースを `*` にしているステートメントは 1 つだけで、ここにあります。`dynamodb:ListStreams` は、IAM がリソースの種類を定義していない操作で、`*` より狭く書く方法がありません。Pipes のドキュメントが必要な操作に挙げているので、入れてあります。

ロールの信頼ポリシーには、`pipes.amazonaws.com` が引き受けられる、とだけ書きました。08章の Scheduler のロールでは、引き受けられる場面を `aws:SourceArn` で絞りました。Pipes のドキュメントの権限のページには、同じ条件の例が見当たらなかったので、ここでは付けていません。

`startingPosition` の `TRIM_HORIZON` は、stream に残っているいちばん古いレコードから読む指定です。`LATEST` にすると、pipe を作っている数分の間の変更を読み落とすことがある、とドキュメントにあります。`TRIM_HORIZON` には別の面もあります。すでに stream が動いているテーブルに後から pipe を足すと、stream に残っている最大 24 時間ぶんのレコードが一度に流れます。このスタックは stream と pipe を同時に作るので、関係ありません。

### 3 つのルールと、その先

<<< @/examples/25-events/infra/lib/events-stack.ts{timeline}

Timeline の関数には、再試行が 2 段あります。この 2 つは別のもので、設定する場所も違います。

ルールのターゲットに書いた `retryPolicy` は、EventBridge が関数を呼び出せなかったときのものです。Lambda がスロットリングしている、権限が無い、といった場合です。既定では 24 時間、185 回まで再試行するところを、1 時間、8 回にしました。それでも渡せなければ、ターゲットの `deadLetterConfig` のキューに入ります。ドキュメントによると、権限が無い、ターゲットが存在しない、といったエラーは再試行されず、すぐにキューに入ります。

EventBridge は、関数を非同期で呼び出します。呼び出しを Lambda が受け付けた時点で、EventBridge から見た配送は成功です。その後で関数が例外を投げても、EventBridge は関与しません。そこから先は Lambda の仕事で、Lambda は 1 分後と、さらに 2 分後にやり直します。それでも失敗したら、`TimelineAsync` に書いた on-failure の送り先に、イベントと失敗の記録を送ります。

ルールの DLQ だけを設定して、関数の失敗もそこに入ると考えるのは、よくある思い違いです。関数の中で起きた失敗は、ルールの DLQ には入りません。

関数を呼んでよいのは、このルールだけです。`TimelineInvoke` が、関数のリソースポリシーにそう書きます。

<<< @/examples/25-events/infra/lib/events-stack.ts{counter}

counter の側は、ルールのターゲットがキューです。EventBridge の配送は、キューにメッセージを入れた時点で終わります。その先は 08章と同じ構成で、可視性タイムアウトは関数のタイムアウトの 6 倍、5 回受信されて削除されなければデッドレターキューに移ります。

<<< @/examples/25-events/infra/lib/events-stack.ts{send-from}

EventBridge がキューにメッセージを入れるには、キューポリシーが要ります。条件の `aws:SourceArn` にルールの ARN を書いて、このルールからの送信だけを許しています。条件が無ければ、どのアカウントのどのルールからでも、EventBridge を経由しさえすればこのキューに送れることになります。

<<< @/examples/25-events/infra/lib/events-stack.ts{rejections}

rejections のルールは、イベントをそのまま渡さず、input transformer で作り直してからトピックに渡します。`inputPathsMap` でイベントの中の 5 つの値に名前を付け、`inputTemplate` の `<名前>` に埋め込みます。トピックの購読者が受け取るのは、`kind`、`owner`、`noteId`、`attachmentId`、`reason`、`at` の 6 つの欄を持つ JSON です。

テンプレートで `<owner>` を引用符で囲んでいないのは、文字列の変数には EventBridge が引用符を付ける、とドキュメントにあるからです。もう 1 つ、パスがイベントの中に無い変数は作られず、出力からも消える、ともあります。`reason` が無いイベントが来ると、テンプレートは JSON として壊れます。イベントのスキーマで「rejected なら理由がある」と決めたのは、そのためです。

変換する理由は、契約を分けることです。トピックの購読者は、このアプリケーションのイベントの形を知らなくて済みます。イベントの形を変えるときに、直すのはこのテンプレートだけです。

トピックのポリシーは、EventBridge のドキュメントの例と同じ形で、条件がありません。キューのときのように `aws:SourceArn` で絞れるかは、ドキュメントからは読み取れなかったので、付けていません。

トピックの購読者は、いまは `RejectionInbox` というキューが 1 つです。知らせを受け取る別の仕組みを足すときは、購読を 1 つ足します。ルールも、テンプレートも、イベントを作る側も変わりません。`rawMessageDelivery` を有効にしているので、キューに入るのは上の JSON そのものです。無効だと、SNS が自分の欄で包んだ JSON になります。メールで受け取るなら、メールアドレスの購読を足して、届いた確認のメールのリンクを開きます。この章のスタックには入れていません。

<<< @/examples/25-events/infra/lib/events-stack.ts{dead-letter-policy}

### 08章のスタックと並べる

<<< @/examples/25-events/infra/lib/events-stack.ts{stand-apart}

08章は、バケット、スケジュール、サインインのドメインの 3 つに、固定した名前を付けていました。同じ名前では 2 つ目のスタックを作れないので、この章の名前に付け替えています。バケットの名前は、08章のキューポリシーの中にも書かれているので、そちらも合わせて上書きします。テストは、テンプレートのどこにも `aih-async` が残っていないことを確かめています。

<<< @/examples/25-events/src/timeline-lambda.ts{handler}

<<< @/examples/25-events/src/counter-lambda.ts{handler}

<<< @/examples/25-events/src/env.ts{env}

```bash
vp run events:infra:synth
```

synth は手元で実行しました。テンプレートに入るリソースの種類は、08章の 24 種類に 7 種類を足した 31 種類です。足した 7 種類のうち、cdkd 0.296.28 が専用の実装を持つのは、`AWS::Events::EventBus`、`AWS::Events::Rule`、`AWS::Pipes::Pipe`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SNS::Subscription` の 6 つです。残る `AWS::Events::Archive` は、Cloud Control API 経由になります。

## デプロイして確かめる

<!-- section: 25.deploy -->

ここから先の手順は、実行していません。用意したのは手順とタスクまでです。

```bash
vp run events:infra:diff
vp run events:infra:deploy
vp run events:smoke
```

`events:smoke` は、あなたの認証情報でノートのテーブルにノートを 1 件書き、timeline の記録と件数がテーブルに現れるのを待ちます。続けてノートを更新し、削除して、timeline が追いかけること、件数が 0 に戻ることを確かめます。最後に、画像でないファイルをアップロード用のバケットに置いて、知らせが `RejectionInbox` に届くのを待ちます。S3、08章のワーカー、stream、pipe、バス、SNS、SQS を 1 周する確認です。それぞれの段階で最大 120 秒待ちます。

この章で確かめられていないことの大半は、この実行でわかります。pipe が関数の返した配列をイベントにすること、`$.type` が `detail-type` になること、archive が Cloud Control API 経由で作れること、暗号化したキューに 4 種類の送り手が送れること、input transformer の出力がそのままキューに入ることです。

ドリフトの検査は、これまでの章と同じです。

```bash
vp run events:infra:drift
```

## 届かなかったとき、流し直すとき

<!-- section: 25.operate -->

### デッドレターキューを読む

```bash
vp run events:status
```

`events:status` は、archive に入っているイベントのおよその数、3 つのキューに溜まっているおよその件数、デッドレターキューの先頭 10 件までの出どころを表示します。メッセージは動かしません。

<<< @/examples/25-events/src/dead-letter.ts{dead-letter}

デッドレターキューには 4 種類の送り手がいて、残していく形がそれぞれ違います。

- ルールが渡せなかったイベントには、EventBridge がメッセージ属性を付ける。`RULE_ARN` でどのルールか、`ERROR_CODE` でなぜかがわかる
- Timeline の関数が 3 回とも失敗したイベントは、Lambda の記録に包まれている。`requestPayload` が元のイベントで、`requestContext` に試した回数がある
- counter のキューから移ってきたメッセージは、イベントそのままである
- pipe がよけたものは、上のどれでもない。Pipes のドキュメントは、送られるのは失敗した束の情報だと書いているが、その形はこの章では確かめていない

どの形も、ドキュメントの例を元に書いたもので、実物のメッセージを受け取って確かめたものではありません。

出どころがわかったら、08章と同じ順で考えます。理由が一時的でもう直っているのか、コードや設定の誤りでまだ直っていないのか、イベントそのものが読めないのか。流し直してよいのは、1 つ目と、直した後の 2 つ目です。

### リプレイする

流し直す手段は 2 つあります。counter のキューから移ってきたメッセージは、08章の `StartMessageMoveTask` で元のキューに戻せます。それ以外は、archive からリプレイします。

```bash
vp run events:replay -- --minutes 60 --rule timeline
vp run events:replay -- --minutes 60 --rule timeline --yes
vp run events:replay -- --describe <リプレイの名前>
```

1 行目は、何がリプレイされるかを表示するだけです。`--yes` を付けたときだけ、リプレイを始めます。

<<< @/examples/25-events/src/replay-plan.ts{plan}

リプレイの範囲を決める部分は、AWS を呼ばない関数にして、テストを付けました。archive の保持日数より古い幅は断り、直近 10 分を含むなら、まだ archive に入っていないかもしれないと知らせます。`--rule` を付けなければ、すべてのルールに流れます。

リプレイを始める前に確かめることがあります。

- 流す相手のコンシューマーは、すべて冪等か。この章の timeline と counter は冪等で、rejections はリプレイを受け取らない。あとから足したルールがあれば、それも見る
- 直したかったコンシューマーだけを `--rule` で指定したか。全部に流す理由があるか
- 幅は archive の保持日数に収まっているか。counter の印の期限（30 日）より短いか
- イベントの数はどのくらいか。リプレイされたイベントは、もう一度 custom event として課金され、コンシューマーももう一度動く

リプレイの進み具合は、`--describe` で見られます。ドキュメントによると、同時に動かせるリプレイは、アカウントとリージョンごとに 10 個までです（2026-10-13 に確認）。

リプレイが指定したルールにだけ届くこと、リプレイされたイベントが関数やキューに `replay-name` 付きで届くこと、rejections のルールがそれを通さないことは、どれも実物では確かめていません。`events:smoke` の 10 分後に、`--rule timeline` を付けたリプレイを実行して、Timeline のログの `replay` の欄に名前が入っていること、timeline の記録が変わらないことを見れば、最初の 2 つがわかります。3 つ目は、`--rule` を付けずにリプレイして、`RejectionInbox` に何も増えないことで確かめられます。
