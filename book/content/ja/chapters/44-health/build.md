---
title: "44 Health: しくみと実装"
---

# 44 Health: しくみと実装

[前のページ](/ja/chapters/44-health.md)では、Health が知らせること、知らせないこと、種類ごとの動き方を整理しました。このページでは、Health イベントを受け取って通知にするスタックを作ります。順番は、ルールを置くリージョン、イベントの形、分類、重複の排除、スタック、手元での再生です。

## ルールを置くリージョン

<!-- section: 44.regions -->

AWS のサービスは、イベントを自分のリージョンの default event bus に出します。Health も同じで、EventBridge のルールは、受け取りたいリージョンごとに作ります。ユーザーガイドが書いている決まりは次の 4 つです。

- あるリージョンのイベントは、そのリージョンに届く。東京の障害は東京の bus に届く
- IAM のように、リージョンを持たないサービスのイベント（グローバルなイベント）は、バージニア北部（us-east-1）にだけ届く
- 信頼性のために、イベントは控えのリージョンにも送られる。控えはオレゴン（us-west-2）で、オレゴン自身の控えだけがバージニア北部になる。控えに届いた写しは `detail.backupEvent` が `true` になる
- オレゴンにルールを 1 つ置くと、全リージョンのアカウント固有のイベントをまとめて受け取れる（simplified integration）。ただし public イベントは届かない

```figure
caption: この本のスタックが使うリージョンと、そこへ届く Health イベント。オレゴンに届く写しは受け取らない
node tokyo: ap-northeast-1 のイベント | アカウント固有と public
node global: グローバルなイベント | IAM など
node virginia: us-east-1 のイベント
node oregon: us-west-2 のイベント
node busT: default event bus | ap-northeast-1
node busV: default event bus | us-east-1
node busO: default event bus | us-west-2
node stackT: AihHealth
node stackV: AihHealthGlobal
edge tokyo -> busT
edge tokyo --> busO: 写し
edge global -> busV
edge virginia -> busV
edge oregon --> busV: 写し
edge busT -> stackT
edge busV -> stackV: backupEvent が false のものだけ
```

この本のスタックは、ほとんどが東京にあります。CloudFront のために us-east-1 に置いたものもあります（[10章](/ja/chapters/10-edge.md)の Lambda@Edge、[21章](/ja/chapters/21-security.md)の web ACL）。IAM はどの章でも使っています。そこで、東京と us-east-1 の 2 か所に、同じスタックを 1 つずつ置くことにしました。受け取るリージョンは、1 つの一覧にまとめてあります。

<<< @/examples/44-health/src/watch.ts{watch}

オレゴンの simplified integration を使わなかったのは、public イベントが届かないからです。この章の最初の問い（アラームが鳴ったとき、AWS 側の障害かどうか）に答えるのは、public イベントです。

us-east-1 のルールから東京の bus へイベントを転送し、関数を 1 つにまとめる構成も考えました。採らなかった理由は 2 つあります。東京に障害があるときに、グローバルなイベントまで届かなくなること。それから、同じアカウントの別リージョンの bus へ転送するときに要る権限を、ドキュメントからは読み切れなかったことです。スタックを 2 つ置くほうが、部品は増えますが、依存は減ります。

オレゴンに 3 つ目のスタックを置けば、東京の EventBridge 自体が止まっているときにも、東京のイベントの写しを受け取れます。この章では置いていません。置く場合の注意は[最後のページ](/ja/chapters/44-health/wrap.md)に書きます。

ルールのパターンは、この一覧から作ります。

<<< @/examples/44-health/src/watch.ts{patterns}

ルールは 2 つで、どちらも同じ関数を呼びます。`Events` は通常の Health イベント、`Abuse` は abuse のイベントです。abuse のイベントは `detail` の形が分からないので、`detail` には条件を付けていません。

`page` の条件は、ページ分けへの対応です。影響を受けるリソースが多くて 1 件が 256 KB を超えるとき、Health はイベントを複数のページに分け、別々のメッセージとして出します。どのページも、リソースの一覧のほかは同じ内容です。人が読む通知なら 1 ページ目だけを通すように、とドキュメントが勧めています。

### サービスでは絞らない

ルールのパターンに、サービスの条件は入れませんでした。「この本が使うサービスの障害だけを通す」と書きたくなるところですが、やめた理由が 2 つあります。

1 つは、`detail.service` に入るコードの一覧が、ドキュメントに無いことです。`EC2`、`LAMBDA`、`ELASTICLOADBALANCING` はサンプルに出てきますが、DynamoDB や API Gateway のコードは確かめられませんでした。推測で書いたコードが違っていると、ルールは何も通さず、エラーにもなりません。障害の最中に通知が来ない理由が「綴りが違った」では困ります。

もう 1 つは、大きな障害が、個別のサービスではなく `MULTIPLE_SERVICES` というコードで公表されることがある点です。2026-10-13 に Service health のページのデータを見たところ、そのコードのイベントが載っていました。サービス名で絞ったルールは、いちばん大きな障害を落とします。

1 つのリージョンの public イベントは、数が多くありません。そこで、ルールは値の決まっている項目（`source`、`detail-type`、`page`、`backupEvent`）だけで絞り、サービスの判断は関数の中に置きました。一覧に無いサービスの障害も「知らせるだけ」の通知として届き、件名にコードが出ます。届いたコードを見て、一覧に足していけます。

### パターンを手元で確かめる

デプロイせずにパターンを確かめるために、EventBridge の照合のうち、このルールが使う部分だけを書きました。

<<< @/examples/44-health/src/pattern.ts{matcher}

実装しているのは、文字列の完全一致、ネストしたオブジェクト、複数の項目の AND の 3 つです。前方一致、`anything-but`、数値の比較、`exists`、ワイルドカード、`$or` は実装していません。パターンの書き方そのものは [25章](/ja/chapters/25-events.md)が扱います。

テストでは、この照合に fixture を通して、東京向けの 1 ページ目がちょうど 1 つのルールに一致すること、2 ページ目では関数が呼ばれないこと、us-east-1 のルールが写しを落とすこと、1 件のイベントが同じリージョンの 2 つのルールに一致しないことを見ています。スタックのテストは、テンプレートに入ったパターンがこの一覧と同じであることを確かめます。手元で照合したパターンと、デプロイされるパターンがずれないようにするためです。

## イベントの形

<!-- section: 44.event-shape -->

関数が受け取る JSON は、型の外から来る値なので、入口で Valibot と照合します。スキーマは、ユーザーガイドの「AWS Health events Amazon EventBridge schema」の表から書きました。

<<< @/examples/44-health/src/event.ts{schema}

表とサンプルを突き合わせると、食い違いが見つかります。スキーマはサンプルが通る側に寄せました。

- `lastUpdatedTime` は表では必須ですが、5 つのサンプルのうち 2 つには入っていません。任意にしています
- `resources` が無いサンプルがあります。無ければ空の配列として読みます
- persona の値は、表では `OPERATIONAL`、サンプルと概念のページでは `OPERATIONS` です。関数は persona を使わないので、文字列の配列として受け取るだけにしました
- `page`、`totalPages`、`backupEvent` は、数値や真偽値ではなく文字列で届きます

`eventRegion` と `region` は別のものです。`region` はイベントが配送されたリージョンで、障害が起きているリージョンは `detail.eventRegion` に入ります。写しを受け取ると、この 2 つが違う値になります。

時刻は `Fri, 27 Jan 2023 06:02:51 GMT` の形で届きます。`Date.parse` に任せず、形を決めて読みます。

<<< @/examples/44-health/src/event.ts{time}

曜日を検査していないのは、ドキュメントのサンプルの曜日が日付と合っていないからです（2026 年 1 月 27 日は火曜ですが、サンプルには `Thu` とあります）。

カテゴリや状態が知らない値だったときは、照合に失敗させます。失敗したイベントは捨てません。封筒にあたる部分だけを読み直して、「読めないイベントが届いた」という通知にします。

<<< @/examples/44-health/src/event.ts{envelope}

知らない項目が増えたときは、失敗させずに読み飛ばします。項目が増えるのはよくあることで、そのたびに通知が「読めない」になるのは避けたいからです。

fixture は 2 種類あります。`fixtures/documented.json` は、ドキュメントのサンプル 5 件をそのまま写したものです。`fixtures/written.json` は、表とサンプルをもとにこの章のために書いたもので、東京の Lambda の障害が始まり、更新され、終わるまでの 3 件、23章のインスタンスの退役、Lambda のランタイムのサポート終了などが入っています。どちらも AWS から受け取ったものではありません。実際のイベントは、まだ 1 件も受け取っていません。

## 分類

<!-- section: 44.classify -->

読めたイベントは、4 つのどれかに分けます。

<<< @/examples/44-health/src/classify.ts{kinds}

分け方は、純粋な関数 1 つです。

<<< @/examples/44-health/src/classify.ts{classify}

判断の向きは、迷ったら知らせる側に倒してあります。

- 無視するのは、控えのリージョンに届いた写しと、2 ページ目以降だけです。どちらもルールで落としているので、ここに来るのはルールを書き換えたときです
- アカウント固有の障害は、サービスが何であっても「障害」です。自分のリソースが名指しされているからです
- public の障害は、サービスが一覧にあれば「障害」、無ければ「知らせるだけ」です
- 予定された変更は「期日までに対応」で、期日はイベントの開始時刻です。`INFORMATIONAL` のラベルが付いているか、もう終わっているものは「知らせるだけ」に下げます
- アカウントへの通知は、`INFORMATIONAL` と明示されていないかぎり「期日までに対応」です。このカテゴリには急ぎのものが混じり、ラベルが付かないこともあるからです。期日は付けません
- abuse の報告は、カテゴリが issue でも「期日までに対応」にします

## 1 つの状態に 1 通

<!-- section: 44.dedup -->

この章の不変条件は、**1 つのイベントの意味のある状態の変化 1 つにつき、通知は 1 通。開いている障害について、通知が 0 通になることはない**、です。

壊しにくる要因は 3 つあります。Health から EventBridge への配送は「少なくとも 1 回」で、同じものが 2 回届きます。障害が続くあいだ、同じイベントが更新されて何度も届き、届く順序は保証されません。そして、EventBridge が関数を呼ぶのは非同期の呼び出しなので、関数が失敗すれば Lambda が同じイベントで呼び直します。

そこで、イベントごとに「最後に知らせた状態」を DynamoDB のテーブルに覚えておきます。この章ではこのテーブルを台帳と呼びます。

<<< @/examples/44-health/src/ledger.ts{entry}

キーは、アカウント ID とイベントの ARN の組です。イベントの ARN はアカウントをまたいで同じ値になることがある、とドキュメントにあります。

「意味のある変化」は、種類によって変えました。障害は、AWS が更新を書くたびに知らせます。状況が変わったことを知りたいからです。それ以外は、状態か日付が動いたときだけ知らせます。planned lifecycle event は、対応の済んだリソースが消し込まれるたびに更新されるので、そのたびにメールが来ると読まれなくなります。

順序は `lastUpdatedTime` で決めます。この項目が無いイベントでは、EventBridge に配送された時刻で代用します。

届いたイベントをどうするかは、台帳の内容と比べて決めます。

<<< @/examples/44-health/src/ledger.ts{decide}

同じ状態がもう一度届いたら捨てます。台帳より古い状態が届いたときも捨てます。障害が終わったあとに、遅れて届いた途中経過を知らせると、終わった障害が続いているように読めてしまいます。時刻が同じ秒なら、状態が進んでいるほう（`upcoming`、`open`、`closed` の順）を新しいとみなします。

### 送る前に書き、送ってからもう一度書く

台帳に書くのと SNS に送るのは別々の操作で、あいだで関数が落ちることがあります。先に送ってから書くと、書く前に落ちたときに同じ通知がもう一度出ます。先に書いてから送ると、送る前に落ちたときに通知が 1 通も出ず、呼び直されても「もう知らせた」と判断してしまいます。後者は不変条件の後半を破ります。

この章では、台帳に 2 回書きます。

```figure
type: sequence
caption: 通知を出す前に台帳で場所を取り、SNS が受け取ってから確定する。途中で落ちたら、呼び直しが取り直す
actor eb: EventBridge
actor fn: Lambda
actor ledger: 台帳
actor sns: SNS
step eb -> fn: イベント
step fn -> ledger: 読む
step fn -> ledger: 確保（notified: false）
step fn -> sns: Publish
step fn -> ledger: 確定（notified: true）
```

<<< @/examples/44-health/src/notify.ts{announce}

1 回目の書き込みは「この状態の通知は自分が出す」という宣言で、`notified` は `false` です。SNS への publish が成功したら、`true` に書き換えます。publish が失敗すれば関数はエラーで終わり、Lambda が 1 分後に呼び直します。呼び直された関数は、同じ状態の、まだ確定していない記録を見つけます。宣言から 30 秒以上経っていれば、前の実行は終わっているとみなして、自分が通知を出します。30 秒は、関数のタイムアウト（10 秒）より長く、Lambda の最初の呼び直し（1 分後）より短い値です。この大小関係は、スタックのテストで固定しています。

書き込みには条件を付けます。台帳の記録が、読んだときから変わっていないことです。同じイベントの 2 つの配送がほぼ同時に来たとき、両方が「まだ無い」と読んで両方が書こうとしますが、通るのは片方だけです。負けたほうは、読み直して判断をやり直します。[05章](/ja/chapters/05-dynamodb.md)のバージョンの検査と同じやり方です。

<<< @/examples/44-health/src/dynamodb-ledger.ts{ledger}

この手順で保証できるのは「0 通にならない」ことまでです。publish が成功したあと、2 回目の書き込みの前に関数が落ちると、呼び直しがもう 1 通出します。「ちょうど 1 通」は保証していません。障害の通知では、重複は我慢できても欠落は困るので、こちらに倒しました。

最後に、入口から出口までをつなぐ関数です。

<<< @/examples/44-health/src/notify.ts{handle}

時計、台帳、publish、ログは引数で渡します。テストでは、台帳をメモリの上の実装に、publish を配列への追加に差し替えて、次の場面を決まった順序で再現しています。

- 同じイベントが 2 回届く。EventBridge の ID が違う別のメッセージとして届く場合も含む
- 更新が、それより後に起きた終了のあとに届く
- 最初に聞いたのが終了だった
- publish が 1 回失敗し、1 分後に呼び直される
- 前の実行が publish の前に落ち、10 秒後に別の配送が来る。30 秒経つまでは手を出さない
- publish のあと、2 回目の書き込みの前に落ちる。通知は 2 通になる
- 読んでから書くまでのあいだに、別の実行が同じイベントを最後まで処理する

## スタック

<!-- section: 44.stack -->

スタックは、ルール、関数、台帳、トピック、デッドレターキューでできています。

<<< @/examples/44-health/infra/lib/health-stack.ts{rules}

ルールは default event bus に置きます。`eventBusName` を指定しなければ default になります。パターンは、さきほどの一覧から作ったものをそのまま渡します。

<<< @/examples/44-health/infra/lib/health-stack.ts{function}

関数のロールに渡す権限は、台帳への `GetItem` と `PutItem`、トピックへの `Publish`、ロググループへの書き込み、デッドレターキューへの `SendMessage` だけです。どれもリソースを 1 つに絞ってあり、`*` はありません。

デッドレターキューには、3 回（最初の 1 回と呼び直し 2 回）失敗したイベントが入ります。ここに入ったイベントは、まだ誰にも知らされていません。本番では、このキューにメッセージが 1 件でも入ったら鳴るアラームを付けます。この章のスタックに付けなかったのは、アラームには置いてあるだけで料金がかかるからです。

ログの保持は 3 か月にしました。無視したイベントとその理由が 1 行ずつ残るので、「あの障害の通知がなぜ来なかったのか」を、ダッシュボードにイベントが残っている 90 日のあいだは調べられます。

<<< @/examples/44-health/infra/lib/health-stack.ts{topic}

トピックは、渡されなければスタックが作ります。`enforceSSL` が付けるポリシーは、TLS を使わない publish を拒否するステートメント 1 つだけで、誰かに許可を与えるステートメントはありません。publish できるのは、このアカウントの中で IAM の許可を持つもの、つまり関数のロールだけです。

19章のトピックにそのまま流したいときは、19章のスタックの出力 `AlarmTopicArn` を `-c alarmTopicArn=...` で渡します。アラームと Health の通知が同じ宛先に届くようになります。関数の SNS クライアントは ARN からリージョンを読むので、us-east-1 のスタックから東京のトピックへも送れます。ただしその場合、東京の SNS が使えないあいだは、グローバルなイベントの通知も止まります。

<<< @/examples/44-health/infra/lib/health-stack.ts{ledger}

台帳はオンデマンドのテーブルで、イベントが届かなければ読み書きはありません。記録は、最後に書いてから 180 日で TTL により消えます。

<<< @/examples/44-health/infra/bin/app.ts{stacks}

アプリは、一覧にあるリージョンの数だけ同じスタックを作ります。

<<< @/examples/44-health/src/lambda.ts{handler}

Lambda のハンドラーは、本物の台帳と SNS を渡して、さきほどの関数を呼ぶだけです。

使っているリソースの種類は、`AWS::Events::Rule`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::DynamoDB::Table`、`AWS::SNS::Topic`、`AWS::SNS::TopicPolicy`、`AWS::SNS::Subscription`、`AWS::SQS::Queue`、`AWS::SQS::QueuePolicy`、`AWS::Logs::LogGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy` です。固定した版の cdkd（0.296.28）は、このすべてに専用の実装を持っています。Cloud Control API を経由するものはありません。

## 手元で動かす

<!-- section: 44.local -->

この章には、手元で立ち上げるサーバーがありません。Health イベントを自分で起こす方法が無いからです。代わりに、fixture を関数と同じコードに流して、送られるはずの文面を表示するタスクを用意しました。

```bash
vp run health:replay
```

AWS には触りません。台帳はメモリの上にあり、publish は数を数えるだけです。届く順序は、スクリプトの中に書いてあります。

<<< @/examples/44-health/scripts/replay.ts{order}

Lambda の障害の fixture は、始まり、重複、終了、遅れて届いた更新の順に並べてあります。次は出力の一部で、始まりの通知、捨てられた 2 件、関数まで届かなかった 1 件、最後の行を抜き出したものです。終了の通知など、あいだの出力は省いています。

```text
== tokyo-lambda-issue-open (delivered to ap-northeast-1)
   rule: AihHealth / Events
   sent (new)
   Subject: [AWS Health] INCIDENT LAMBDA ap-northeast-1 open: AWS_LAMBDA_OPERATIONAL_ISSUE
   | incident: a public issue of LAMBDA, which this app uses
   | What to do: Note it in the incident. Start no new deploy. Fail over only by your own criteria.
   |
   | Event: AWS_LAMBDA_OPERATIONAL_ISSUE (issue, PUBLIC)
   | Status: open
   | Region: ap-northeast-1, delivered to ap-northeast-1
   | Account: 123456789012
   | Started: 2026-10-13T17:48:00Z
   | Updated: 2026-10-13T18:04:00Z
   |
   | We are investigating increased error rates for Lambda invocations in the AP-NORTHEAST-1 Region.
   |
   | Dashboard: https://health.aws.amazon.com/health/home
   | Event ARN: arn:aws:health:ap-northeast-1::event/LAMBDA/AWS_LAMBDA_OPERATIONAL_ISSUE/AWS_LAMBDA_OPERATIONAL_ISSUE_EXAMPLE_0001

== tokyo-lambda-issue-open (delivered to ap-northeast-1)
   rule: AihHealth / Events
   skipped: duplicate

== tokyo-lambda-issue-update (delivered to ap-northeast-1)
   rule: AihHealth / Events
   skipped: stale

== docs-account-ec2-backup-copy (delivered to us-west-2)
   no stack in that Region: never seen

12 arrivals, 8 messages.
```

文面の中身は fixture のもので、AWS が書いた文章ではありません。イベントタイプコード `AWS_LAMBDA_OPERATIONAL_ISSUE` も、この章が fixture のために付けた名前です。

テストと型検査、synth は次のとおりです。

```bash
vp test run examples/44-health
vp run health:infra:synth
```

`health:infra:synth` は、2 つのスタックのテンプレートを `examples/44-health/cdk.out/` に書き出します。AWS には問い合わせません。

手元で確かめられないことも書いておきます。ルールが本物の Health イベントに一致するかどうか、本物のイベントがスキーマを通るかどうかは、イベントが届くまで分かりません。照合の関数は EventBridge そのものではなく、fixture はドキュメントから書いたものです。
