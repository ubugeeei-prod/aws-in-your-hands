---
title: "50 AgentCore: デプロイ"
---

# 50 AgentCore: デプロイ

このページの手順は、どれも実行していません。タスクとスクリプトは用意してあり、synth までは手元で通しています。期待する結果として書いていることは、ドキュメントからの見込みです。

## デプロイと動作確認

<!-- section: 50.deploy -->

先に、アカウントで Bedrock のモデルが使えること（17章）を確かめておきます。スタックは 1 つで、モデルは 17章と同じ推論プロファイルを既定にしています。

<<< @/examples/50-agentcore/infra/bin/app.ts

```bash
vp run agentcore:infra:synth
vp run agentcore:infra:diff
vp run agentcore:infra:deploy
```

synth は AWS に問い合わせません。`examples/50-agentcore/cdk.out/` に、テンプレートと、`app.js` を入れた ZIP ができます。デプロイを実行する IAM の identity には、スタックのリソースを作る権限のほかに、`AWSServiceRoleForBedrockAgentCoreRuntimeIdentity` というサービスリンクロールを作る権限（`iam:CreateServiceLinkedRole`）が要ると、ドキュメントにあります。

デプロイのまえに知っておくことが 2 つあります。

1 つは、cdkd がこの Runtime と Memory を Cloud Control API 経由で作る点です。cdkd 自身のドキュメントは cdkd を開発とテストの用途としていて、この 2 つの型を cdkd で作れることは確かめていません。

もう 1 つは、メタデータのサービスの版です。セキュリティの手引きには、2026 年 6 月 30 日以降、MMDSv2 を有効にしていない Runtime は呼び出せず、`ValidationException` になるとあります。API には `metadataConfiguration.requireMMDSV2` がありますが、固定した版の `aws-cdk-lib` の `CfnRuntime` には、これにあたる property がありません。新しく作った Runtime で既定がどうなるかも確かめられていません。呼び出しが `ValidationException` で断られたら、`aws bedrock-agentcore-control update-agent-runtime` で設定することになり、その差は `vp run agentcore:infra:drift` に出るはずです。

利用者を 1 人作り、トークンを取ります。スタックの出力（`UserPoolId` と `UserPoolClientId`）を使います。

```bash
aws cognito-idp admin-create-user --user-pool-id "$USER_POOL_ID" \
  --username you@example.com --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id "$USER_POOL_ID" \
  --username you@example.com --password "$PASSWORD" --permanent
export AIH_ACCESS_TOKEN=$(aws cognito-idp admin-initiate-auth \
  --user-pool-id "$USER_POOL_ID" --client-id "$USER_POOL_CLIENT_ID" \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters "USERNAME=you@example.com,PASSWORD=$PASSWORD" \
  --query AuthenticationResult.AccessToken --output text)
```

パスワードは 12 文字以上で、数字と小文字を含めます。トークンの有効期間は 1 時間です。

呼び出します。**料金がかかります。** 質問 2 つ分のモデルの呼び出しと、Runtime のセッション 1 つ分です。

```bash
vp run agentcore:invoke
```

スクリプトは、トークンから利用者を読み、36章の 3 つのノートをその利用者のものとしてテーブルに書いてから、同じセッションで 2 回質問します。

<<< @/examples/50-agentcore/src/invoke-request.ts{invoke-request}

JWT で入る Runtime は、AWS SDK の `InvokeAgentRuntime` では呼べません。SDK は SigV4 で署名するもので、ベアラートークンを送る入力がないからです。ドキュメントの例も HTTP クライアントで呼んでいます。URL の形は、その例のとおりです。

期待する結果は次のとおりです。

- でたらめなトークンでの呼び出しが、Runtime の手前で 401 になる
- 1 問目で、ツールの呼び出し（`list_notes`、`read_note`）のあとに答えが流れてくる
- 2 問目（「いまの答えを一文にまとめて」）が、1 問目の答えを踏まえた文になる。これが Memory とセッションの記憶が働いている証拠になる
- CloudWatch Logs の `/aws/bedrock-agentcore/runtimes/<Runtime の ID>-DEFAULT` に、`invocation` のログが 2 行出て、どちらも `remembered` が `true`

確かめたいことは、ほかにもあります。5 分以上あけてから同じセッション ID で呼び、答えが前のやりとりを踏まえていれば、microVM が入れ替わっても Memory から状態を作り直せています。別の利用者を作り、その人のトークンに最初の利用者のセッション ID を付けて呼ぶと、エージェントは 403 を返します。ドキュメントのとおりなら、クライアントに届くのは 424 です。

デプロイのあと、手で変えたものがないかは drift で見ます。

```bash
vp run agentcore:infra:drift
```

終わったら[片付け](/ja/chapters/50-agentcore/wrap.md)に進んでください。
