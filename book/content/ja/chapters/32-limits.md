---
title: "32 Limits: quota、throttling、retry、負荷試験、費用の内訳"
revision: 1
---

# 32 Limits: quota、throttling、retry、負荷試験、費用の内訳

04章から、どの API にも「1 秒に 10 件まで」のスロットリングを付けてきました。これは自分で置いた上限です。AWS の側にも、頼んでいない上限が最初からあります。Lambda が同時に動かせる数も、API Gateway が 1 秒に受ける数も、テーブルが 1 秒に読み書きできる量も、アカウントごとに決まっていて、超えたぶんは断られます。

この章では、上限を 3 つの面から扱います。1 つ目は、どこにどんな上限があり、どう調べて、どう引き上げを頼むかです。2 つ目は、断られた側の振る舞いです。再試行は書き方しだいで障害を大きくするので、その様子を乱数の種を固定したシミュレーションで再現し、待ち方と、再試行の総量に付ける予算で抑えます。3 つ目は費用で、上限まで使われたときの請求を、どのアプリのぶんかに分けて見られるようにします。

題材は [05章](/ja/chapters/05-dynamodb.md)のノート API です。アプリのコードは変えず、DynamoDB のクライアントの設定と、外側のスタックだけをこの章で持ちます。前提は [04章](/ja/chapters/04-http-api.md)、[14章](/ja/chapters/14-kv-cache.md)、[19章](/ja/chapters/19-observability.md)です。コードは `examples/32-limits/` にあります。

## 全体像

<!-- section: 32.overview -->

```figure
caption: リクエストが関数に届くまでに通る上限。数字は既定値か、この章のスタックが決めた値
node client: Client | 再試行、バックオフ、予算
node account: API Gateway のアカウントの上限 | 10,000 req/s、全 API の合計
node stage: ステージのスロットリング | 10 req/s、POST /notes は 2 req/s
node concurrency: Lambda の同時実行数 | アカウントで 1,000、予約は任意
node fn: Lambda | 05章のアプリ
node table: DynamoDB テーブル | 読み取り 150、書き込み 40 unit/s
edge client -> account: HTTPS
edge account -> stage
edge stage -> concurrency
edge concurrency -> fn
edge fn -> table: SDK は 3 回まで試行
edge stage --x client: 429
group aws: AWS account = account, stage, concurrency, fn, table
mark stage
```

```figure
caption: タグは、キーを請求用に有効にしてはじめて、費用のデータに現れる
direction: right
node stack: AihLimits stack | project = aih-notes
node billing: 請求のデータ | コスト配分タグ
node explorer: Cost Explorer | タグとサービスで集計
node budget: Budget | タグで絞った月の予算
edge stack --> billing: 使用量とタグ
edge billing -> explorer
edge billing -> budget
```

上限には、置いた人の違う 2 種類があります。

1 つは AWS が置いた上限で、クォータ（quota）と呼びます。サービスは多くの利用者で共有されているので、1 つのアカウントが使える量には最初から枠があります。Lambda のドキュメントは、この枠を、あなたのアカウントとほかの利用者のワークロードを守るためのものだと説明しています。枠の大きさは、こちらの都合とは関係なく決まっています。

もう 1 つは、自分で置く上限です。ステージのスロットリング、予約済み同時実行数（reserved concurrency）、テーブルの request unit の上限、14章のレート制限、05章のノート 100 件がこれにあたります。守っているのは自分の請求と、後ろにある自分のリソースです。クォータよりずっと低いところに置くので、ふだん先に当たるのはこちらです。

この 2 種類は、断り方は同じでも、当たったときにすることが違います。クォータに当たったら、設計を変えるか、引き上げを申請します。自分で置いた上限に当たったら、その数字が今の利用に合っているかを見直します。どちらの場合も、呼び出す側は「断られることがある」前提で書いておく必要があります。

### この章のスタック

スタックは 19章のものとほぼ同じ形で、テーブル、関数、HTTP API を持ちます。足したのは、書き込みのルートだけに付けた厳しいスロットリング、任意で付ける予約済み同時実行数、Lambda が関数を断ったときのアラーム、すべてのリソースに付けたタグ、そのタグで絞った予算です。

<<< @/examples/32-limits/infra/lib/limits-stack.ts{bounds}

ここにある数字は、どれも自分で決めた値です。それぞれの後ろにあるクォータと、どちらが先に効くかは、[しくみと実装](/ja/chapters/32-limits/build.md)の最後で計算します。

## クォータ

<!-- section: 32.quotas -->

クォータを見る場所は Service Quotas です。コンソールでサービスを選ぶと、そのサービスのクォータが並び、引き上げを申請できるかどうか（adjustable）が列に出ます。値には 2 つあって、AWS が最初に決めた値が default value、引き上げのあとにアカウントに適用されている値が applied quota です。ドキュメントに載っているのは既定値のほうなので、自分のアカウントの値は、自分で見るまでわかりません。

新しいアカウントでは、既定値より低い値から始まることがあります。Lambda のドキュメントには、新しいアカウントは同時実行数とメモリのクォータが減らされていて、利用に応じて AWS が自動で引き上げる、とあります。どこまで減らされているかは書かれていません。

この本の章が頼っている既定値を、出典つきで 1 つのファイルにまとめました。

```bash
vp run limits:quotas:book
```

```text
Lambda: Concurrent executions
  default 1,000 per Region (adjustable)
  chapters 04, 09, 17, 21, 29; read 2026-10-12, source "limits-lambda-quotas"
Lambda: Concurrency that must stay unreserved
  default 100 (fixed)
  chapters 09, 17, 21; read 2026-10-12, source "limits-lambda-reserved-concurrency"
Lambda: Function timeout
  default 900 seconds (fixed)
```

表にすると次のとおりです。値は 2026 年 10 月 12 日に読んだもので、変わることがあります。

| サービス | クォータ | 既定値 | 引き上げ | 頼っている章 |
| --- | --- | --- | --- | --- |
| Lambda | 同時実行数（リージョンごと、全関数の合計） | 1,000 | できる | 04、09、17、21、29 |
| Lambda | 予約せずに残しておく同時実行数 | 100 | できない | 09、17、21 |
| Lambda | 関数のタイムアウト | 900 秒 | できない | 08、12、16、23 |
| Lambda | 同期呼び出しのペイロード | リクエスト、レスポンスとも 6 MB | できない | 07、09 |
| API Gateway | アカウントのスロットリング（リージョンごと、全 API の合計） | 毎秒 10,000 件、バケットは 5,000 | できる | 04、05、06、13、14、19 |
| API Gateway | HTTP API の統合のタイムアウト | 30 秒 | できない | 12 |
| DynamoDB | オンデマンドのテーブル 1 つのスループット | 読み取り、書き込みとも毎秒 40,000 unit | できる | 05、08、19 |

2 行目は、09章、17章、21章が「新しいアカウントでは予約がデプロイで断られることがある」と書いていた理由です。予約できるのは、アカウントの同時実行数から 100 を引いた数までです。残りの 100 は、予約を持たない関数のために空けておく決まりになっています。そのため、同時実行数のクォータが 100 以下に減らされているアカウントでは、1 つも予約できません。

15章の SES のサンドボックス、16章の Step Functions の入出力の大きさ、17章の Bedrock のモデルごとの上限、18章の IVS の同時視聴数もクォータです。この 4 つは、それぞれの章に出典があるので、ここでは読み直していません。

自分のアカウントの値は、サービスを指定して読みます。

```bash
vp run limits:quotas --service lambda
vp run limits:quotas --service apigateway
```

このタスクは `aws service-quotas list-service-quotas` を呼び、返ってきた一覧を次のスキーマで確かめてから、引き上げを申請できるものを先に並べます。この章では実行していません。

<<< @/examples/32-limits/src/quotas.ts{listed}

`--service` に渡すのは、Service Quotas が使うサービスのコードです。`lambda` と `apigateway` は、ドキュメントにあるコンソールの URL で確かめました。ほかのサービスのコードは `aws service-quotas list-services` で調べます。

### 引き上げの申請

引き上げは、コンソールでクォータを選んで申請するか、`aws service-quotas request-service-quota-increase` にサービスのコード、クォータのコード、希望する値を渡します。API Gateway のアカウントのスロットリングなら、コードは `L-8A5B8E43` です。

申請について、ドキュメントからわかることは次のとおりです。小さな引き上げはたいてい自動で承認され、大きなものは Support に回って、審査と反映に時間がかかります。申請は承認されることも、断られることも、一部だけ認められることもあります。引き上げの申請は、優先して扱われるサポートの対象ではありません。

急いでも早くはならないので、申請は足りなくなる前に出します。大きな配信やキャンペーンの前に、見込みの流量から必要な値を出し、余裕をもって頼んでおきます。必要な値の出し方は、[最初に当たる上限](/ja/chapters/32-limits/build.md)で扱います。

この章でも申請は出していないので、承認までの実際の時間はわかりません。

## この章が要らない場合

呼び出す側の話、つまり 429 を受け取ったときの待ち方と再試行の予算は、どの基盤の上でも同じように役に立ちます。Cloudflare Workers から外部の API を呼ぶコードにも、そのまま当てはまります。

一方、クォータの調べ方と費用の内訳は、AWS のアカウントを運用する人のための話です。アプリが Workers や Vercel の上で足りていて、AWS のリソースを持っていないなら、この 2 つは読み飛ばしてかまいません。あちらにも上限はありますが、数は少なく、多くはプランで決まります。違いは[最後のページ](/ja/chapters/32-limits/wrap.md)に並べました。
