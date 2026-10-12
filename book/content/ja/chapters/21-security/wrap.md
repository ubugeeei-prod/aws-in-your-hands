---
title: "21 Security: 費用、注意点、片付け"
---

# 21 Security: 費用、注意点、片付け

## Workers から来た人へ

<!-- section: 21.workers -->

Cloudflare の Workers から来ると、この章の長さに驚くと思います。

```text
                 Cloudflare Workers                           this chapter
secret           an encrypted binding on the Worker           a separate resource, read over the network at run time
who may read it  the Worker it is bound to                    whoever IAM allows, per secret
rotation         not examined in this chapter                 a new version; the previous one stays readable by label
web firewall     a free managed ruleset on all plans          a web ACL you create, attach, and pay for by the month;
                                                              only on some kinds of entry point
audit trail      not examined in this chapter                 CloudTrail event history, 90 days, always on
```

Workers の secret は、Worker に付く binding です。暗号化された値が Worker に結び付いていて、コードが取りに行く処理を書きません。だから、この章の cache も、cache と rotation のずれも、同じ形では出てきません。Workers で secret を入れ替えたときに何が起きるかは、この章では調べていません。

AWS のやり方が長いのは、secret が関数とは別のリソースだからです。別だから、権限を secret ごとに決められて、複数の関数や、Lambda ではないものからも読めて、version を label で持てます。そのかわり、読みに行くコードと、読みに行く権限と、読めなかったときの扱いを、自分で書くことになります。

WAF は、立ち位置が違います。Cloudflare では、無料の managed ruleset がすべてのプランで使えます。rate limiting の rule も、機能に差はありますが無料プランから使えます。AWS では、web ACL を作って、付けられる種類の入口に付けて、月額を払います。「まず無料で入っているもの」は、AWS にはありません。

Cloudflare 側の監査ログや、アカウントをまたぐ統制の仕組みは、この章では調べていません。

## お金の話

<!-- section: 21.cost -->

金額は USD、東京リージョン（CloudFront と WAF は global）、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

置いてあるだけでかかるもの。

- 既定の stack: 月 USD 0.40。secret 1 つのぶんです。CloudFront、Lambda、IAM の role は、呼ばれなければ 0
- `-c cmk=on` を足すと: 月 USD 1.40。鍵が月 USD 1。1 年後の最初の自動 rotation から、さらに増えます
- web ACL（`AihSecurityWaf`）: 月 USD 8.00。既定の stack とは別に、distribution に付けていなくても

どれも時間割りです。既定の stack を午後のあいだだけ試して消すなら、1 セントに届きません。逆に、消し忘れた web ACL は、1 年で USD 96 です。

使ったとき。token の発行と検証を月 10 万回ずつ、という仮定で、定価の小計は月 USD 0.86、無料枠を引くと USD 0.49 でした。引いたあとに残るのは、secret の月額と、Secrets Manager の API 呼び出しです。実行環境 1 つが 5 分ごとに鍵を読み直すと、月に 17,520 回で USD 0.09。cache をやめて、リクエストのたびに 1 回読むと、20 万回で USD 1.00 になります。

GuardDuty、Inspector、Config は、使い方しだいで桁が変わるので、単価だけ書きます。

- GuardDuty: 分析した CloudTrail の event 100 万件あたり USD 4.72。ほかに、VPC flow log と DNS log の量、有効にした protection plan ごとの料金があります
- Inspector: Lambda standard scanning が、関数 1 つ 1 時間あたり USD 0.0005
- AWS Config: 連続記録で、configuration item 1 件あたり USD 0.003

桁をつかむための例を 1 つ。小さなアカウントで、event 10 万件、関数 1 つ、configuration item 500 件、と仮定すると、合わせて月 USD 2.34 です。この件数は仮定で、計った値ではありません。あなたのアカウントの数字は、試用期間中にコンソールが出す見積もりを見てください。

Organizations と SCP、CloudTrail の event history、IAM は、追加料金なしです。

確認できなかったこともあります。KMS の鍵が削除待ちの 7 日間に課金されるかどうか。CloudFront 用の web ACL が、請求のうえでどの usage type になるか。CloudFront の定額プランに WAF がどう含まれるか（この章は従量課金だけを見ています）。

## ハマりどころ

実行して出会ったものではなく、ドキュメントとコードから「ここで詰まりそう」と分かっているものです。

| こうなったら | ここを見る |
| --- | --- |
| `sec:waf:infra:deploy` が、スコープやリージョンのエラーで失敗する | CloudFront 用の web ACL は us-east-1 にしか作れません。stack の `env` を変えていませんか |
| `-c webAclArn=...` で synth が止まる | `arn:aws:wafv2:us-east-1:<アカウント>:global/webacl/<名前>/<id>` の形ですか。`regional` の ARN は CloudFront に付けられません |
| `/token` が 503 を返し続ける | 関数のログに `SecretAccessDenied` が出ていれば、role の権限です。`-c cmk=on` なら `kms:Decrypt` も要ります。デプロイ直後なら、少し待ってもう一度 |
| CloudFront 経由のリクエストが 403 になる | function URL の resource policy に、この distribution からの `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` の両方がありますか（09章） |
| `Authorization` ヘッダーで token を送ったら通らない | そのヘッダーは CloudFront が署名に使います。`x-aih-token` で送ります |
| rotation のあと、検証が 401 になる | 2 回続けて rotation していませんか。`vp run sec:secret:versions` で、token の `keyVersion` が `AWSCURRENT` か `AWSPREVIOUS` にあるか見ます |
| `sec:trail:iam` に、さっきの変更が出ない | IAM の event は us-east-1 に記録されます。記録されるまでに遅れがあるかどうかは、この本では確かめていません |
| `sec:iam:lint` が、例外が「何にも一致しない」と言う | policy のほうが直って、例外が要らなくなっています。`iam-lint-exceptions.json` から消します |
| 同じ名前の secret を作り直したら、関数が読めない | secret の ARN の末尾には、ランダムな 6 文字が付きます。作り直すと ARN が変わります。この stack は名前を固定していないので、再デプロイで追従します |

## 本番にするなら

- **GuardDuty を有効にする。** 守るものができたら、最初に足すのはこれです。試用期間の見積もりを見て、要らない protection plan は切ります
- **finding を、人が見る場所に流す。** 有効にしただけの検出は、誰も見ません。19章の通知の経路につなぎます
- **trail を作る。** 90 日より前のことを調べる必要は、だいたい 90 日を過ぎてから出てきます。Access Analyzer の policy generation にも要ります
- **web ACL のログを取る。** `count` の結果を見て、block に切り替えるかを決めます。この章の stack はログを設定していません
- **secret の削除に猶予を持たせる。** この章の secret は stack と一緒にすぐ消えます。本番では `RemovalPolicy.RETAIN` にして、消すときは Secrets Manager の復旧期間（7〜30 日）を使います
- **secret を読んだ記録を見る。** `GetSecretValue` は CloudTrail に残ります。想定していない role が読んでいないか
- **アカウントを分けて、SCP を付ける。** 練習用の OU で試してから
- **この lint を、すべての stack のテストに入れる。** いまは、この章の stack と、20章の CI の role にだけ当てています

## 片付け

<!-- section: 21.cleanup -->

web ACL を付けていたら、先に外します。

```bash
vp run sec:infra:deploy
vp run sec:waf:infra:destroy
vp run sec:infra:destroy
```

1 行目は、`-c webAclArn=...` を付けずにデプロイして、distribution から web ACL を外すためのものです。付けていなければ、3 行目だけで構いません。

secret は、stack と一緒に消えます。固定した版の cdkd は、復旧期間なしで削除します（ソースで確かめました）。Secrets Manager の「削除予定」の一覧にも残らないはずです。

`-c cmk=on` で作った鍵は、すぐには消えません。7 日間、削除待ちの状態で残ります。その間は使えません。7 日たつと消えます。

この章のタスクが作っていないものは、消えません。コンソールで有効にした GuardDuty や Inspector は、コンソールで無効にします。無効にするまで、試用期間のあとは料金がかかります。`vp run sec:posture` で、何が有効なまま残っているかを見てください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（token の署名と検証、rotation をまたぐ鍵の cache、rotation の手順、SDK の client を差し替えた secret の読み取り、wildcard の lint と例外、SCP の JSON と評価の model、IAM の伝播待ち、posture の判定、2 つの stack の assertion）。型検査。固定した cdkd での synth（`-c cmk=on`、`-c webAclArn=...`、形の違う ARN も）。synth された関数の bundle を、テストランナーの外の Node.js で読み込んで `/health` を呼ぶこと。`vp run dev:sec` で起動した手元の server への `/health`、`/token`、`/verify`。`vp run sec:iam:lint` を、この本の全章の `cdk.out`（21 個の template）に対して実行。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** AWS に触るものは、すべて未実行です。`sec:infra:diff`、`sec:infra:deploy`、`sec:smoke`、`sec:infra:drift`、`sec:infra:destroy`、`sec:waf:infra:*`、`sec:secret:versions`、`sec:secret:rotate`、`sec:posture`、`sec:trail:iam`。とくに次の点は、実環境での確認待ちです。

- CloudFront、署名つきの function URL、Secrets Manager を通した一連の動作。function URL を直接呼ぶと 403 になること
- デプロイ直後に、関数が secret を読めない時間があるのかどうか。権限を消したあと、いつまで読めるのか
- `PutSecretValue` のあとの staging label の動き。`AWSPREVIOUS` が無い secret を読んだときのエラー名
- web ACL の作成と関連付け。rate-based rule が block を始めるまでの時間。請求のうえでの usage type
- customer managed key を使った構成。削除待ちの 7 日間の課金
- `sec:posture` が呼ぶ 6 つの API の、実際の応答の形。権限が無いときのエラー名
- GuardDuty、Inspector、AWS Config、trail、Organizations、SCP。どれも有効にしていません。SCP の JSON は、Organizations に受け付けられることを確かめていません
- cdkd が生成した secret の値を、state やログに残さないこと。ソースを読んだ範囲では残していませんが、実行して確かめてはいません

**cdkd との関係。** 固定した版の cdkd（0.296.28）の npm の tarball を読んで確かめました。この章の 2 つの stack が使う resource type は、すべて専用の実装が登録されています。`AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::SecretsManager::Secret`、`AWS::KMS::Key`（`-c cmk=on`）、`AWS::WAFv2::WebACL`。`AWS::GuardDuty::Detector` には登録がありません。secret は `GenerateSecretString` の値を cdkd の側で生成して `CreateSecret` に渡し、削除は `ForceDeleteWithoutRecovery` です。KMS の鍵の削除は `ScheduleKeyDeletion` で、日数は template の `PendingWindowInDays`（無ければ 7）です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 何から入れるか | `examples/21-security/src/posture.ts`、`scripts/posture.ts`、`test/posture.test.ts` | `sec:posture`、`test:unit` |
| 全体像 | `examples/21-security/infra/bin/app.ts`、`infra/lib/config.ts` | `sec:infra:synth` |
| 権限を絞る | `examples/21-security/infra/lib/security-stack.ts`、`infra/test/security-stack.test.ts` | `test:unit` |
| wildcard を見つける assertion | `examples/21-security/src/iam-lint.ts`、`scripts/iam-lint.ts`、`policies/iam-lint-exceptions.json`、`test/iam-lint.test.ts` | `sec:iam:lint`、`test:unit` |
| secret を環境変数に置かない | `examples/21-security/src/secret-source.ts`、`src/secrets-manager-source.ts`、`src/env.ts`、`src/compose.ts`、`test/secrets-manager-source.test.ts` | `dev:sec`、`test:unit` |
| cache と rotation のあいだ | `examples/21-security/src/keyring.ts`、`src/token.ts`、`src/app.ts`、`test/keyring.test.ts`、`test/token.test.ts`、`test/app.test.ts` | `test:unit` |
| rotation の手順 | `examples/21-security/src/rotation.ts`、`scripts/rotate.ts`、`test/rotation.test.ts` | `sec:secret:versions`、`sec:secret:rotate` |
| 鍵は誰のものか | `examples/21-security/infra/lib/security-stack.ts`、`infra/test/security-stack.test.ts` | `sec:infra:synth`、`test:unit` |
| WAF を付けられる入口、付けられない入口 | `examples/21-security/infra/lib/waf-stack.ts`、`infra/lib/security-stack.ts`、`infra/test/waf-stack.test.ts` | `sec:waf:infra:deploy`、`sec:waf:infra:destroy` |
| IAM の変更は、すぐには届かない | `examples/21-security/src/propagation.ts`、`test/propagation.test.ts`、`scripts/smoke.ts`、`scripts/trail.ts` | `sec:smoke`、`sec:trail:iam` |
| 見張る道具は、それぞれ別のものを見ている | `examples/21-security/scripts/posture.ts`、`scripts/trail.ts` | `sec:posture`、`sec:trail:iam` |
| 組織になったら | `examples/21-security/policies/scp-guardrails.json`、`src/policy-model.ts`、`test/scp.test.ts` | `test:unit` |
| デプロイして確かめる | `examples/21-security/scripts/smoke.ts` | `sec:infra:deploy`、`sec:smoke`、`sec:infra:drift` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |
| 片付け | `examples/21-security/infra/lib/security-stack.ts` | `sec:infra:destroy`、`sec:waf:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-12）

- IAM: [Troubleshoot IAM（eventual consistency）](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html)、[Security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)、[Access Analyzer の policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html)、[Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)、AWS service reference（[secretsmanager](https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json) ほか、action と resource type の確認）
- AWS WAF: [保護できるリソース](https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html)、[rate-based rule](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)、[その注意点](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html)、[baseline rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)、[IP reputation rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html)、[WCU](https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html)、[テストと調整](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-testing.html)、[AWS::WAFv2::WebACL](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html)、[RateBasedStatement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html)
- CloudFront: [AWS WAF を使う](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-awswaf.html)、[function URL の origin へのアクセス制限](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- Secrets Manager: [secret の中身と version](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html)、[PutSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html)、[GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)、[DeleteSecret](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html)、[best practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)、[Lambda 関数による rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html)、[AWS::SecretsManager::Secret](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)、[料金](https://aws.amazon.com/secrets-manager/pricing/)
- Lambda: [環境変数](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Lambda で Secrets Manager を使う](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)
- AWS KMS: [KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html)、[rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html)、[鍵の削除](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html)、[料金](https://aws.amazon.com/kms/pricing/)
- GuardDuty: [What is Amazon GuardDuty?](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html)、[Getting started](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_settingup.html)、[使用量と費用の見積もり](https://docs.aws.amazon.com/guardduty/latest/ug/monitoring_costs.html)
- Inspector: [What is Amazon Inspector?](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html)、[Lambda 関数の検査](https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html)、[Getting started](https://docs.aws.amazon.com/inspector/latest/user/getting_started_tutorial.html)、[料金](https://aws.amazon.com/inspector/pricing/)
- CloudTrail: [event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html)、[concepts（global service events）](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)、[LookupEvents](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html)、[料金](https://aws.amazon.com/cloudtrail/pricing/)
- AWS Config: [What is AWS Config?](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html)、[料金](https://aws.amazon.com/config/pricing/)
- Organizations: [SCP](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)、[SCP の評価](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html)、[SCP の構文](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html)、[quota](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html)、[organization の作成](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_org_create.html)、[FAQs](https://aws.amazon.com/organizations/faqs/)、[aws-samples の SCP の例](https://github.com/aws-samples/service-control-policy-examples)
- AWS Price List: [Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json)、[KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json)、[WAF](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json)、[GuardDuty](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/ap-northeast-1/index.json)、[Inspector](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json)、[Config](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（tarball の `dist/`。provider の登録、secret と KMS の鍵の作成と削除）
- AWS SDK for JavaScript v3: [3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-secrets-manager/v/3.1149.0)（7 つの client の型定義）
- Cloudflare: [Workers の secret](https://developers.cloudflare.com/workers/configuration/secrets/)、[WAF の managed rules](https://developers.cloudflare.com/waf/managed-rules/)、[rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)

:::
