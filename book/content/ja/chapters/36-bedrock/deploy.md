---
title: "36 Bedrock: デプロイ"
---

# 36 Bedrock: デプロイ

[手元](/ja/chapters/36-bedrock/local.md)で動かしたアプリを、AWS にのせる準備をします。スタックは 17章のものが土台で、テーブル 2 つとガードレールが増えます。この章を書いている時点で、このスタックはデプロイしていません。

## AWS にのせる準備

<!-- section: 36.infra -->

### 呼び出した人を知る

入口は 17章と同じ、Lambda の function URL です。認証は `AWS_IAM` で、Lambda が関数を動かす前に SigV4 の署名を調べます。

17章では、署名は「呼んでよい相手かどうか」を決めるだけでした。この章では、もう 1 つの役目があります。署名を調べた Lambda は、誰が署名したかをイベントに書き込みます。ツールが読むノートの持ち主は、この値にします。

<<< @/examples/36-bedrock/src/identity.ts{function-url}

持ち主を、リクエストのヘッダーや本文からは決めません。そこに書かれた値は、呼び出した人が自由に書けます。イベントの `requestContext.authorizer.iam` は Lambda が書く場所で、呼び出した人には書けません。

この作りでは、利用者は「AWS の認証情報で署名できる人」です。06章のユーザープールの利用者ではありません。ブラウザの利用者を相手にするなら、アプリの `authenticate` を、06章のアクセストークンを確かめる実装に差し替えます。アプリの側は、入口ごとに実装を渡す 06章のインターフェースのままなので、ツールもループも変わりません。入口の作り方は、17章の「本番にするなら」に書いたとおりです。

17章のアダプターは、アプリに `Request` だけを渡します。この章はイベントも要るので、薄く包みます。

<<< @/examples/36-bedrock/src/function-url.ts{adapter}

<<< @/examples/36-bedrock/src/lambda.ts{handler}

### ガードレール

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{guardrail}

ガードレールは 2 つのリソースでできています。`AWS::Bedrock::Guardrail` が設定で、`AWS::Bedrock::GuardrailVersion` が、その時点の設定に番号を付けたものです。関数には ID と番号を環境変数で渡します。

既定の設定は sensitive information filters だけです。`-c promptAttackFilter=standard` を付けると、プロンプト攻撃のフィルターと、Standard の段階と、`apac.guardrail.v1:0` の profile が加わります。[実装のつづき](/ja/chapters/36-bedrock/more.md)に書いたとおり、この設定では、検査のために文章が日本の外へ出ることがあります。

### 権限

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{role}

モデルの権限は 17章と同じ形です。profile 1 つと、その行き先のモデルを、その profile 経由のときだけ許します。

17章から増えた権限は、次のとおりです。

`bedrock:ApplyGuardrail` は、ガードレールを付けた呼び出しに要る権限で、対象は自分のガードレール 1 つです。Standard の設定では、ガードレールの profile も、行き先の各リージョンについて書きます。モデルの profile と同じで、1 つでも書き忘れると、そのリージョンへ回されたときだけ失敗します。

ノートのテーブルには、`GetItem` と `Query` だけを許します。ツールは読むだけ、という決まりを、コードと IAM の両方に書いています。コードを書き換えて書き込むツールを足しても、このロールでは書けません。

使用量のテーブルには、`GetItem` と `UpdateItem` を許します。

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{usage-table}

1 日分のアイテムは、その日が終われば用済みです。`expiresAt` を TTL にして、35 日を過ぎたら DynamoDB が消すようにしています。

### 関数

<<< @/examples/36-bedrock/infra/lib/bedrock-stack.ts{function}

モデル ID、ガードレールの ID と番号、上限、予算は、すべて環境変数で渡します。関数のコードは、どのモデルを呼ぶかを知りません。モデルを替えるデプロイで変わるのは、環境変数の値と、IAM の ARN だけです。

### cdkd とリソースの種類

スタックのリソースは 9 個、種類は 8 つです。固定した版の cdkd（0.296.28）の配布物を読んで、扱いを確かめました。`AWS::IAM::Role`、`AWS::IAM::Policy`、`AWS::Lambda::Function`、`AWS::Lambda::Url`、`AWS::DynamoDB::Table`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::Bedrock::Guardrail` と `AWS::Bedrock::GuardrailVersion` には専用の実装がなく、Cloud Control API 経由になります。2 つとも、Cloud Control API が対応するリソースの一覧に載っています。実際にこの経路でガードレールが作れることは、デプロイしていないので確かめていません。

```bash
vp run bedrock:infra:synth
```

synth は AWS に問い合わせません。手元で実行して、テンプレートができることを確かめています。

## デプロイして確かめる

<!-- section: 36.deploy -->

ここからの手順は、実行していません。期待する結果として書いています。

```bash
vp run bedrock:infra:diff
vp run bedrock:infra:deploy
```

デプロイが終わると、出力に `FunctionUrl`、`NotesTableName`、`UsageTableName`、`GuardrailId`、`GuardrailVersion` が表示されます。

```bash
vp run bedrock:smoke
vp run bedrock:logs
```

`bedrock:smoke` は課金されます。次の順に確かめます。

1. 署名なしで呼び、403 で断られること
2. 署名付きで `GET /me` を呼び、関数が署名した人をどの ID として見ているかを受け取ること
3. その ID を持ち主にして、フィクスチャのノート 3 件をテーブルに書くこと。この書き込みは、関数ではなく、スクリプトがあなたの権限で行います
4. 署名付きで質問を 1 つ送り、ツールのイベントと答えが届いて、`done` が完成を伝えること

最後に、往復の回数と、入力、出力、キャッシュの読み書きのトークン数を表示します。`cacheReadInputTokens` が 0 でなければ、prompt caching に当たっています。

`bedrock:logs` では、質問ごとの 1 行が見られます。`costMicroUsd` が、その質問の見積もりの金額です。

モデルを替えるときは、`modelId` を指定します。

```bash
vp run bedrock:infra:deploy -c modelId=jp.anthropic.claude-haiku-4-5-20251001-v1:0
```

Anthropic のモデルには、17章に書いた手続き（用途のフォームと、Marketplace のサブスクリプション）が先に要ります。替えたら、`BEDROCK_MODEL_ID` を同じ値にして `vp run bedrock:eval:live` を回し、替える前の結果と比べてください。

ドリフトの検査は 02章と同じです。

```bash
vp run bedrock:infra:drift
```

ガードレールは、コンソールで下書きを編集できます。編集しても、関数が呼んでいるのは番号の付いたバージョンなので、動作は変わりません。ドリフトの検査がこの差をどう報告するかは、確かめていません。
