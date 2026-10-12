---
title: "37 CloudShell と Cloud9: 手元で動かす"
---

# 37 CloudShell と Cloud9: 手元で動かす

## 手元で動かす

<!-- section: 37.local -->

この章のコードは、CloudShell が無くても、AWS のアカウントが無くても、手元で確かめられます。

```bash
vp test run examples/37-cloudshell
```

テストは 3 つの層に分かれています。

1 つ目は、判断だけを確かめるテストです。予算の状態の分け方、state のキーの読み方、料金がかかる種類の拾い方、1,000 個ずつの分け方、3 つのポリシーが通すアクションがこれに当たります。

2 つ目は、バケットを空にする繰り返しのテストです。メモリの上にバージョニングの有効なバケットを作り、失敗を決まった順序で起こします。確かめているのは次のことです。

- 2,501 個のバージョンと削除マーカーが、1 回 1,000 個以下のリクエストで、すべて消える
- S3 が 1 つのキーを断ったら、その周で止まり、断られたキーを返す。原因を取り除いて同じ処理をもう一度呼ぶと、残りが消える
- 一覧を取ったあとに書き込まれたオブジェクトも、次の周で消える
- 削除が成功を返すのに何も消えないときは、回り続けずにエラーで止まる

3 つ目は、ビルドしたファイルをそのまま動かすテストです。テストの中で `aih-cloudshell.mjs` をビルドし、`aws` という名前の偽物の実行ファイルを PATH の先頭に置いて、読者が CloudShell で打つのと同じコマンドを実行します。偽物の `aws` は、決まった答えを返し、呼ばれた引数をすべて記録します。そのおかげで、次のことを確かめられます。

- `--yes` を付けないかぎり、`delete-objects` は 1 回も呼ばれない
- `--yes` を付けても、`--account` が無いか、サインインしているアカウントと違えば、バケットに触る前に止まる
- 環境変数 `AWS_REGION` が別のリージョンを指していても、呼び出しは東京に向かう
- cdkd の state のバケットを指定すると、`aws` を 1 回も呼ばずに断る
- ビルドしたファイルが import するのは、Node.js に組み込みのモジュールだけである

偽物の `aws` が返す答えは、手で書いたものです。実際のアカウントから記録したものではありません。項目の名前は API リファレンスと、固定した版の AWS CLI のヘルプと、cdkd の型定義から取りました。値は架空です。

同じ偽物を使って、スクリプトの出力を眺めるタスクもあります。

```bash
vp run cloudshell:demo
```

```text
The answers below are fixtures. Nothing here reached AWS.

$ node aih-cloudshell.mjs whoami
action:  identify credentials (reads AWS)
account: 111111111111
region:  ap-northeast-1
caller:  arn:aws:iam::111111111111:user/aih-dev
(exit 0)

$ node aih-cloudshell.mjs left
action:  list what cdkd still records (reads AWS)
account: 111111111111
region:  ap-northeast-1
caller:  arn:aws:iam::111111111111:user/aih-dev
AihEc2 (region not recorded): 2 resources
  billed while idle (chapter 23): AWS::EC2::Volume vol-0example
  billed while idle (chapter 23): AWS::EC2::Instance i-0123456789abcdef0
AihHello (ap-northeast-1): 1 resources
  bucket: aihhello-practicebucket-example
AihNetwork (ap-northeast-1): 5 resources
  billed while idle (chapter 11): AWS::EC2::NatGateway nat-0example
  billed while idle (chapter 11): AWS::EC2::EIP eipalloc-0example
  billed while idle (chapter 11): AWS::EC2::VPCEndpoint vpce-0interface
3 stacks recorded in cdkd-state-111111111111; 5 resources of a kind that is billed while idle.
This is cdkd's record, not a look at the resources. A stack deployed another way is not in it.
(exit 0)
```

上は `vp run cloudshell:demo` の出力から、`whoami` と `left` の部分を抜き出したものです。1 行目に書いてあるとおり、アカウントもスタックも ID も架空で、AWS には届いていません。

ポリシーの JSON は、次のタスクで出力します。引数は `use`、`use-no-files`、`deny`、`vpc-only` のどれかです。

```bash
vp run cloudshell:policy use-no-files
```

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "UseCloudShell",
      "Effect": "Allow",
      "Action": [
        "cloudshell:CreateEnvironment",
        "cloudshell:CreateSession",
        "cloudshell:GetEnvironmentStatus",
        "cloudshell:PutCredentials",
        "cloudshell:StartEnvironment"
      ],
      "Resource": "*"
    }
  ]
}
```

`Resource` が `*` なのは、手を抜いたからではありません。ドキュメントに、`cloudshell:CreateEnvironment` は `Resource` に `*` しか受け付けないと書かれています。このタスクは JSON を出力するだけで、ポリシーを作りも付けもしません。

手元で確かめられないことも、はっきりしています。偽物の `aws` が返す形が本物と同じかどうか、CloudShell の Node.js でこのファイルが動くかどうか、実際の IAM がこのポリシーをどう評価するかは、手元のテストではわかりません。どれも、[デプロイ](/ja/chapters/37-cloudshell/deploy.md)のページの手順を実際の CloudShell で実行して、はじめて確かめられます。
