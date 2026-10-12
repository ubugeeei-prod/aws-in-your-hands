---
title: "47 Step Functions: 状態機械、retry と catch、Map、待ち合わせ、saga"
revision: 1
---

# 47 Step Functions: 状態機械、retry と catch、Map、待ち合わせ、saga

ワークフローが覚えているのは「どこまで進んだか」だけです。進んだぶんを取り消すことまでは面倒を見てくれないので、取り消し方は定義に自分で書きます。この章は、その書き方を中心に、Step Functions そのものを端から見ていきます。

[16章](/ja/chapters/16-long-jobs.md)は Step Functions を、止まっても続きから再開できる 1 本の仕事に使いました。出てきたのは `Task`、`Choice`、`Retry`、`Catch`、redrive までで、ステップはどれも自分で書いた Lambda の関数でした。この章はその先を扱います。Lambda を挟まずにサービスの API を直接呼ぶこと、外からの返事を待つこと、いくつかのサービスにまたがる変更を途中で失敗しても半端に残さないこと、そして Standard と Express の使い分けです。

題材は 2 つあります。1 つ目はノートの取り込みで、ノートを DynamoDB に書き、添付ファイルを S3 に置き、スキャンの結果を待ち、公開して、通知します。途中で失敗したら、済んだところを逆順に取り消します。2 つ目は照会で、ノート ID をいくつか受け取り、それぞれが読める状態かどうかを 1 回のリクエストで答えます。

前提は [08章](/ja/chapters/08-async.md)（冪等性、キュー）と 16章です。コードは `examples/47-step-functions/` にあります。このスタックは、置いてあるだけなら料金がかかりません。使ったときの金額は[費用のページ](/ja/chapters/47-step-functions/wrap.md)にまとめました。

AWS に対しては、この章のどの手順も実行していません。手元で動かしたのは、同じ定義を歩く自作の実行器と、そのテストです。実行器は Step Functions ではなく、この章が使うステートだけを扱うモデルです。どこまでがモデルで、本物とどう突き合わせるかは、[手元で動かすページ](/ja/chapters/47-step-functions/local.md)に書きました。

## 全体像

<!-- section: 47.overview -->

```figure
caption: 取り込みは、取り消せるステップ、スキャンの待ち合わせ、取り消せない Publish、やり直すだけの Notify の順に進む
node create: CreateNote | DynamoDB PutItem, phase = pending
node attach: AttachFile | S3 CopyObject
node scan: WaitForScan | SQS SendMessage、トークンを待つ
node verdict: Verdict | Choice
node publish: Publish | DynamoDB UpdateItem, phase = ready
node notify: Notify | SNS Publish
node imported: Imported | Succeed
edge create -> attach
edge attach -> scan
edge scan -> verdict
edge verdict -> publish: verdict = clean
edge publish -> notify
edge notify -> imported
mark publish
```

```figure
caption: 失敗したステップ自身の取り消しから始めて、逆順にたどる
node create: CreateNote
node attach: AttachFile
node scan: WaitForScan
node verdict: Verdict
node removeAttachment: RemoveAttachment | S3 DeleteObject
node removeNote: RemoveNote | DynamoDB DeleteItem
node rolledBack: RolledBack | Fail
node taken: NoteIdTaken | Fail
edge create -x removeNote: Catch
edge create -x taken: ID が使われている
edge attach -x removeAttachment: Catch
edge scan -x removeAttachment: Catch
edge verdict -> removeAttachment: clean 以外
edge removeAttachment -> removeNote
edge removeNote -> rolledBack
```

```figure
caption: 照会は、ノート ID ごとに GetItem を 1 回ずつ呼び、結果を 1 つにまとめて返す
node caller: 呼び出し元 | StartSyncExecution
node map: EachNote | Map, MaxConcurrency 5
node get: GetNote | DynamoDB GetItem
edge caller -> map: {owner, noteIds}
edge map -> get: ノート ID ごと
edge get --> map: {noteId, found, title}
group express: Step Functions (Express) = map, get
```

ステートマシンは 2 つです。取り込みは Standard ワークフローで、11 個のステートのうち 7 個が `Task` です。照会は Express ワークフローで、`Map` の中に `Task` が 1 つあります。どちらにも Lambda の関数はありません。`Task` はどれも、DynamoDB、S3、SQS、SNS の API を Step Functions から直接呼びます。

ほかに、[05章](/ja/chapters/05-dynamodb.md)と同じ形のテーブル、ファイルを置くバケット、スキャンの依頼を入れるキュー、通知のトピック、Express ワークフローのログを受けるロググループを、このスタックの中に作ります。

取り込みのステートは、役割で 4 つに分かれます。`CreateNote` と `AttachFile` は、あとから取り消せるステップです。`WaitForScan` は、ファイルのスキャンを外の誰かに頼み、返事が来るまで止まります。`Publish` は、ノートを読者に見える状態に変えるステップで、いったん実行したら取り消しません。`Notify` は通知を送るだけで、失敗しても取り込みは成功のままです。この並びの理由は、[実装のページ](/ja/chapters/47-step-functions/build.md)の saga の節で説明します。

### Step Functions を使わないほうがよい場合

変更が 1 つの DynamoDB のテーブルに収まるなら、ワークフローは要りません。[30章](/ja/chapters/30-data-modeling.md)のトランザクションが、全部書くか何も書かないかを 1 回のリクエストで保証します。取り消しを自分で書くのは、DynamoDB と S3 のように、1 つのトランザクションにまとめられない相手をまたぐときだけです。

1 種類の仕事を順に処理するだけなら、08章や [61章](/ja/chapters/61-sqs.md)のキューで足ります。同じ出来事にいくつもの処理を反応させたいなら、[25章](/ja/chapters/25-events.md)のイベントバスのほうが向いています。ワークフローが役に立つのは、ステップの間に順序と分岐があり、「いまどこにいるか」を誰かが覚えていなければならないときです。

順序をふつうのコードで書きたい場合は、16章の Lambda durable functions があります。Step Functions の定義は JSON で、分岐もループも JSON で書くので、込み入った計算には向きません。その代わり、定義そのものが図になり、ステップごとの入出力が履歴に残り、ステップごとに権限を絞れます。

Cloudflare には Workflows があり、ステップを `step.do()` で囲んだコードとして書きます。再試行、スリープ、外からのイベントを待つ `step.waitForEvent()` があり、`step.do()` には取り消しのハンドラーを付けられます。ワークフローが失敗すると、登録したハンドラーがステップを始めた順の逆に走る、とドキュメントにあります（2026-10-13 時点）。Vercel にも、失敗したステップを再試行し、外からのイベントを待ち、デプロイをまたいで再開するコードを書く Workflows があります（同日時点）。どちらも動かしてはいません。Workers や Vercel の上でアプリを書いていて、呼ぶ相手もその中にあるなら、そちらで書くほうが部品は少なくて済みます。Step Functions が向いているのは、呼ぶ相手が AWS のサービスで、その API を関数なしで直接呼びたいときです。

## Standard と Express

<!-- section: 47.types -->

ステートマシンを作るときに、種類を Standard か Express のどちらかに決めます。あとから変えることはできません。定義の言語は同じですが、保証していることがまったく違います。

| | Standard | Express |
| --- | --- | --- |
| 最長の実行時間 | 1 年 | 5 分 |
| 実行の保証 | exactly-once（`Retry` を書かないかぎり） | 非同期は at-least-once、同期は at-most-once |
| ステートの間の状態 | 状態遷移のたびに保存される | 保存されない |
| 実行の履歴 | Step Functions が持ち、終了後 90 日まで API で読める | Step Functions は持たない。CloudWatch Logs に送る設定が要る |
| サービスの呼び出し方 | 3 つとも使える | 応答を待つだけの呼び方に限る |
| Distributed Map、redrive | 使える | 使えない |
| 同じ名前でもう一度起動する | 実行中なら、同じ実行を指す応答が返る | 別の実行が並んで走る |
| 課金 | 状態遷移の数 | 実行の回数、時間、メモリ |

「実行の保証」の行は、名前から中身を推測しないほうがよいところです。Standard の exactly-once は、Step Functions が同じステートを自分の都合で 2 回実行しない、という意味です。`Retry` を書けば、失敗したステップも、成功したのに応答が届かなかったステップも、もう一度走ります。16章で見たとおり、ステップを冪等にするのは自分の仕事のままです。

Express の非同期の実行は、実行そのものが 2 回走ることがあります。途中の状態を保存していないので、やり直すときは最初からです。したがって、Express に載せてよいのは、2 回走っても結果が変わらない仕事です。この章の照会は読むだけなので、何回走っても何も変わりません。

取り込みを Express にできない理由は、表の 3 つの行にあります。スキャンの返事を待つ呼び方が使えず、待ち時間が 5 分に収まらず、失敗した実行を redrive で続きから再開できません。

### 同じ仕事を両方で動かしたときの値段

照会を例に、10 件のノートを調べる実行 1 回の料金を、両方の種類で計算します。単価は東京リージョン、USD、税別で、AWS Price List の 2026-09-11 公開分です。

Express は、リクエスト 1 回が 0.000001、実行時間が 1 GB・秒あたり 0.00001667 です。時間は 100 ミリ秒単位に切り上げられ、メモリは 64 MB 単位で課金されます。1 回の実行が 300 ミリ秒、64 MB だとすると、次のようになります。300 ミリ秒は仮定で、計測した値ではありません。

```text
Express, one execution
  request     1 x 0.000001                           = 0.0000010
  duration    0.3 s x 0.0625 GB x 0.00001667         = 0.0000003
  total                                              = 0.0000013

Standard, one execution
  transitions 13 x 0.000025                          = 0.0003250
```

Standard は、状態遷移 1 回が 0.000025 です。実行 1 回を 13 回と数えました。`Map` が 1、10 回の `GetNote` が 10、開始と終了が 1 ずつです。開始と終了を数えるのは料金ページの例に合わせたもので、`Map` の繰り返しの数え方は料金ページに書かれていません。13 は見積もりです。

同じ仕事で、Standard は Express のおよそ 250 倍になります。月に 100,000 回なら、Express は DynamoDB の読み取りを含めて 0.20、Standard は 32.57 です。短くて回数の多い仕事を Standard に載せると、ステートの数がそのまま請求になります。

逆に、取り込みのように待ち時間の長い仕事は Standard のほうが安くなります。Standard は時間に課金されないので、スキャンを 30 分待っても、待つ前後の状態遷移の数は変わりません。
