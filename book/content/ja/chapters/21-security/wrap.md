---
title: "21 Security: 費用、注意点、片付け"
---

# 21 Security: 費用、注意点、片付け

章の最後に、Workers との違い、料金、つまずきやすいところ、本番に進めるときに足すもの、片付けをまとめます。検証した範囲と一次情報は、ページ末尾の検証メモにあります。

## Workers から来た人へ

<!-- section: 21.workers -->

Cloudflare の Workers を使ってきた人には、この章は長く感じられると思います。違いを表にすると、次のとおりです。

```text
                 Cloudflare Workers                           this chapter
secret           an encrypted binding on the Worker           a separate resource, read over the network at run time
who may read it  the Worker it is bound to                    whoever IAM allows, per secret
rotation         not examined in this chapter                 a new version; the previous one stays readable by label
web firewall     a free managed ruleset on all plans          a web ACL you create, attach, and pay for by the month;
                                                              only on some kinds of entry point
audit trail      not examined in this chapter                 CloudTrail event history, 90 days, always on
```

Workers の secret は、Worker に付く binding です。暗号化された値が Worker に結び付いているので、値を取りに行く処理をコードに書く必要がありません。そのため、この章で扱ったキャッシュも、キャッシュとローテーションのずれも、同じ形では現れません。Workers で secret を入れ替えたときに何が起きるかは、この章では調べていません。

AWS のやり方が長くなるのは、シークレットが関数とは別のリソースだからです。別のリソースなので、権限をシークレットごとに決められ、複数の関数や Lambda 以外のものからも読め、バージョンをラベルで持てます。その代わり、読みに行くコードと、読みに行く権限と、読めなかったときの扱いを、自分で書くことになります。

WAF は位置づけが違います。Cloudflare では、無料の managed ruleset がすべてのプランで使えます。rate limiting のルールも、機能に差はありますが無料プランから使えます。AWS では、web ACL を作り、付けられる種類の入口に付けて、月額を払います。最初から無料で入っている防御は、AWS にはありません。

Cloudflare 側の監査ログや、アカウントをまたぐ統制の仕組みは、この章では調べていません。

## 料金

<!-- section: 21.cost -->

金額は USD、東京リージョン（CloudFront と WAF はグローバル）、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

置いてあるだけでかかる料金は、次のとおりです。

- 既定のスタック: 月 USD 0.40。シークレット 1 つのぶんです。CloudFront、Lambda、IAM のロールは、呼ばれなければ 0 です
- `-c cmk=on` を足した場合: 月 USD 1.40。鍵が月 USD 1 で、1 年後の最初の自動ローテーションから、さらに増えます
- web ACL（`AihSecurityWaf`）: 月 USD 8.00。既定のスタックとは別にかかり、ディストリビューションに付けていなくてもかかります

どれも時間割りです。既定のスタックを午後のあいだだけ試して消すなら、1 セントに届きません。一方、消し忘れた web ACL は、1 年で USD 96 になります。

使ったときの料金は、トークンの発行と検証を月 10 万回ずつと仮定すると、定価の小計が月 USD 0.86、無料枠を引くと USD 0.49 でした。無料枠を引いたあとに残るのは、シークレットの月額と、Secrets Manager の API 呼び出しです。実行環境 1 つが 5 分ごとに鍵を読み直すと、月に 17,520 回で USD 0.09 です。キャッシュをやめて、リクエストのたびに 1 回読むと、20 万回で USD 1.00 になります。

### 叩かれたら

既定のスタックには流量の歯止めが無いので、最大でいくらになるかは書けません。書けるのは単価です。使ったときと同じ仮定（応答 0.5 KB、Lambda 50 ms、ログ 0.3 KB）で、**リクエスト 100 万件あたり USD 1.84** です。内訳は、CloudFront のリクエストが 1.20、データ転送が 0.05、Lambda が 0.37、ログが 0.22 です。仮に毎秒 1,000 件のリクエストが 1 日続くと、8,640 万件で USD 159 になります。01章の予算の通知は 8〜12 時間おきにしか更新されないので、気づいたときには、請求がすでにかなり増えています。

シークレットの読み取りも増えます。鍵のキャッシュは実行環境ごとにあるので、フラッドで実行環境が増えると、そのぶん読み直しも増えます。でたらめなバージョン id を送り続けられると、読み直しの間隔は最短の 30 秒まで詰まります。1 回の読み直しは `GetSecretValue` 2 回なので、実行環境 1 つにつき 30 日で 172,800 回、USD 0.86 です。実行環境が同時実行数の既定の上限 1,000 まで増えると、USD 864 になります。30 秒の下限が無ければ、この読み取りはリクエストの数に比例して増えていました。

歯止めを付けると、次のように変わります。

- `-c reservedConcurrency=5`（無料）を付けた場合。実行環境は同時に 5 つまでになります。シークレットの読み取りは最大で月 USD 4.32、Lambda の実行時間は、5 つが 30 日動き続けても USD 43.20 です。CloudFront のリクエスト料金（100 万件あたり 1.20）には、天井ができません
- web ACL（月 USD 8.00）を付けた場合。1 つの IP アドレスから届くのは 5 分で 300 件、ならして毎秒 1 件までになります。30 日張り付かれても 1 つの IP につき 259 万件で、USD 4.77 です。検査の料金（100 万件あたり 0.60）は、止めたぶんにもかかります。多くの IP アドレスから来るフラッドは、IP の数だけ通ります。そのため、この 2 つを両方付けるのがいちばん堅い構成です

AWS WAF がブロックしたリクエストには、CloudFront のリクエスト料金もデータ転送の料金もかかりません。2024 年 10 月 25 日からの扱いで、AWS の告知を 2026-10-13 に読んで確かめました（[46章](/ja/chapters/46-shield/build.md)も同じ告知を引いています）。AWS WAF の検査の料金は、止めたぶんにもかかります。

GuardDuty、Inspector、Config は、使い方によって金額の桁が変わるので、単価だけを書きます。

- GuardDuty: 分析した CloudTrail のイベント 100 万件あたり USD 4.72。ほかに、VPC flow log と DNS log の量、有効にした保護プランごとの料金があります
- Inspector: Lambda standard scanning が、関数 1 つ 1 時間あたり USD 0.0005
- AWS Config: 連続記録で、configuration item 1 件あたり USD 0.003

桁をつかむための例を 1 つ挙げます。小さなアカウントで、イベント 10 万件、関数 1 つ、configuration item 500 件と仮定すると、合わせて月 USD 2.34 です。この件数は仮定で、計った値ではありません。自分のアカウントの金額は、試用期間中にコンソールが出す見積もりで確かめてください。

Organizations と SCP、CloudTrail のイベント履歴、IAM には、追加料金がかかりません。

確認できなかったこともあります。KMS の鍵が削除待ちの 7 日間に課金されるかどうか、CloudFront 用の web ACL が請求のうえでどの usage type になるか、の 2 点です。CloudFront の定額プラン（flat-rate pricing plan）は、ドキュメントによると、プランに入れたディストリビューションの web ACL、ルール、リクエストの料金を月額に含みます（2026-10-13 確認。プランの条件は [46章](/ja/chapters/46-shield/build.md)にあります）。この章の金額は、従量課金だけを見ています。

## つまずきやすいところ

次の表は、実行して出会ったものではなく、ドキュメントとコードから詰まりそうだと分かっているものです。

| こうなったら | ここを見る |
| --- | --- |
| `sec:waf:infra:deploy` が、スコープやリージョンのエラーで失敗する | CloudFront 用の web ACL は us-east-1 にしか作れません。スタックの `env` を変えていないか確かめます |
| `-c webAclArn=...` で synth が止まる | ARN が `arn:aws:wafv2:us-east-1:<アカウント>:global/webacl/<名前>/<id>` の形か確かめます。`regional` の ARN は CloudFront に付けられません |
| `-c reservedConcurrency=5` を付けたデプロイが、同時実行数のエラーで断られる | アカウントの同時実行数の上限が低い状態です。Service Quotas で確かめます。外してデプロイし、歯止めを web ACL に任せる方法もあります |
| `reservedConcurrency` を付けたあと、ときどき 429 か 5xx が返る | 同時に動ける数を使い切っています。CloudFront がどのステータスで返すかは、確かめていません |
| `/token` が 503 を返し続ける | 関数のログに `SecretAccessDenied` が出ていれば、ロールの権限が原因です。`-c cmk=on` なら `kms:Decrypt` も要ります。デプロイ直後なら、少し待ってもう一度試します |
| CloudFront 経由のリクエストが 403 になる | 関数 URL のリソースポリシーに、このディストリビューションからの `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` の両方があるか確かめます（09章） |
| `Authorization` ヘッダーでトークンを送ったら通らない | `Authorization` ヘッダーは CloudFront が署名に使います。トークンは `x-aih-token` で送ります |
| ローテーションのあと、検証が 401 になる | 2 回続けてローテーションしていないか確かめます。`vp run sec:secret:versions` で、トークンの `keyVersion` が `AWSCURRENT` か `AWSPREVIOUS` にあるかを見ます |
| `sec:trail:iam` に、直前の変更が出ない | IAM のイベントは us-east-1 に記録されます。記録されるまでに遅れがあるかどうかは、この本では確かめていません |
| `sec:iam:lint` が、例外が「何にも一致しない」と言う | ポリシーが直って、例外が要らなくなっています。`iam-lint-exceptions.json` から消します |
| 同じ名前のシークレットを作り直したら、関数が読めない | シークレットの ARN の末尾にはランダムな 6 文字が付くので、作り直すと ARN が変わります。このスタックは名前を固定していないので、再デプロイすれば新しい ARN に追従します |

## 本番にするなら

- GuardDuty を有効にします。守るものができたら、最初に足すのはこれです。試用期間の見積もりを見て、要らない保護プランは切ります
- 検出結果を、人が見る場所に流します。有効にしただけの検出は、誰も見ません。19章の通知の経路につなぎます
- 証跡を作ります。90 日より前のことを調べる必要は、たいてい 90 日を過ぎてから出てきます。Access Analyzer の policy generation にも要ります
- **入口に歯止めを付けてから公開します。** web ACL と `reservedConcurrency` の両方を付け、`/token` の前に認証を置きます。いまの `/token` は、誰にでも署名します
- web ACL のログを取ります。`count` の結果を見て、ブロックに切り替えるかを決めます。この章のスタックはログを設定していません
- シークレットの削除に猶予を持たせます。この章のシークレットはスタックと一緒にすぐ消えます。本番では `RemovalPolicy.RETAIN` にして、消すときは Secrets Manager の復旧期間（7〜30 日）を使います
- シークレットを読んだ記録を見ます。`GetSecretValue` は CloudTrail に残るので、想定していないロールが読んでいないかを確かめられます
- アカウントを分けて、SCP を付けます。先に練習用の OU で試します
- この章の lint を、すべてのスタックのテストに入れます。いまは、この章のスタックと 20章の CI のロールにだけ当てています

## 片付け

<!-- section: 21.cleanup -->

web ACL を付けていたら、先に外します。

```bash
vp run sec:infra:deploy
vp run sec:waf:infra:destroy
vp run sec:infra:destroy
```

1 行目は、`-c webAclArn=...` を付けずにデプロイして、ディストリビューションから web ACL を外すためのものです。web ACL を付けていなければ、3 行目だけで構いません。

シークレットは、スタックと一緒に消えます。固定した版の cdkd は、復旧期間なしで削除します（ソースで確かめました）。Secrets Manager の「削除予定」の一覧にも残らないはずです。

`-c cmk=on` で作った鍵は、すぐには消えません。削除待ちの状態で 7 日間残り、その間は使えません。7 日たつと消えます。

この章のタスクが作っていないものは、消えません。コンソールで有効にした GuardDuty や Inspector は、コンソールで無効にします。無効にするまで、試用期間が終わったあとは料金がかかります。何が有効なまま残っているかは、`vp run sec:posture` で確かめてください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（トークンの署名と検証、ローテーションをまたぐ鍵のキャッシュ、ローテーションの手順、SDK のクライアントを差し替えたシークレットの読み取り、ワイルドカードの lint と例外、SCP の JSON と評価のモデル、IAM の変更が行き渡るまでの待ち、posture の判定、2 つのスタックのアサーション）。型検査。固定した cdkd での synth（`-c cmk=on`、`-c webAclArn=...`、形の違う ARN も）。synth された関数のバンドルを、テストランナーの外の Node.js で読み込んで `/health` を呼ぶこと。`vp run dev:sec` で起動した手元のサーバーへの `/health`、`/token`、`/verify`。`vp run sec:iam:lint` を、この本のすべての章の `cdk.out`（21 個のテンプレート）に対して実行。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** AWS に触るものは、すべて未実行です。`sec:infra:diff`、`sec:infra:deploy`、`sec:smoke`、`sec:infra:drift`、`sec:infra:destroy`、`sec:waf:infra:*`、`sec:secret:versions`、`sec:secret:rotate`、`sec:posture`、`sec:trail:iam`。とくに次の点は、実環境での確認待ちです。

- CloudFront、署名付きの関数 URL、Secrets Manager を通した一連の動作。関数 URL を直接呼ぶと 403 になること
- デプロイ直後に、関数がシークレットを読めない時間があるのかどうか。権限を消したあと、いつまで読めるのか
- `PutSecretValue` のあとのステージングラベルの動き。`AWSPREVIOUS` が無いシークレットを読んだときのエラー名
- web ACL の作成と関連付け。レートベースのルールがブロックを始めるまでの時間。請求のうえでの usage type
- `-c reservedConcurrency=N` を付けたデプロイ。cdkd 0.296.28 が `ReservedConcurrentExecutions` を反映すること（固定した版のソースには、作成後に `PutFunctionConcurrency` を呼ぶコードがあります。動かしてはいません）、上限に達したときに CloudFront が返すステータス、Lambda がスロットリングで断ったリクエストへの CloudFront の課金。予約がどの値から断られるかは、アカウントの同時実行数のクォータから 100 を引いた数が上限、という決まりで決まります（[32章](/ja/chapters/32-limits.md)）。「叩かれたら」の金額は、この章の単価と仮定からの計算で、実際にリクエストを流したことはありません
- カスタマーマネージドキーを使った構成。削除待ちの 7 日間の課金
- `sec:posture` が呼ぶ 6 つの API の、実際の応答の形。権限が無いときのエラー名
- GuardDuty、Inspector、AWS Config、証跡、Organizations、SCP。どれも有効にしていません。SCP の JSON は、Organizations に受け付けられることを確かめていません
- cdkd が、生成したシークレットの値を state やログに残さないこと。ソースを読んだ範囲では残していませんが、実行して確かめてはいません

**cdkd との関係。** 固定した版の cdkd（0.296.28）の npm の tarball を読んで確かめました。この章の 2 つのスタックが使うリソースタイプは、すべて専用の実装が登録されています。`AWS::CloudFront::Distribution`、`AWS::CloudFront::OriginAccessControl`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::SecretsManager::Secret`、`AWS::KMS::Key`（`-c cmk=on`）、`AWS::WAFv2::WebACL`。`AWS::GuardDuty::Detector` には登録がありません。シークレットは `GenerateSecretString` の値を cdkd の側で生成して `CreateSecret` に渡し、削除は `ForceDeleteWithoutRecovery` です。KMS の鍵の削除は `ScheduleKeyDeletion` で、日数はテンプレートの `PendingWindowInDays`（無ければ 7）です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 入れる順番 | `examples/21-security/src/posture.ts`、`scripts/posture.ts`、`test/posture.test.ts` | `sec:posture`、`test:unit` |
| 全体像 | `examples/21-security/infra/bin/app.ts`、`infra/lib/config.ts` | `sec:infra:synth` |
| 権限を絞る | `examples/21-security/infra/lib/security-stack.ts`、`infra/test/security-stack.test.ts` | `test:unit` |
| ワイルドカードを見つけるアサーション | `examples/21-security/src/iam-lint.ts`、`scripts/iam-lint.ts`、`policies/iam-lint-exceptions.json`、`test/iam-lint.test.ts` | `sec:iam:lint`、`test:unit` |
| シークレットを環境変数に置かない | `examples/21-security/src/secret-source.ts`、`src/secrets-manager-source.ts`、`src/env.ts`、`src/compose.ts`、`test/secrets-manager-source.test.ts` | `dev:sec`、`test:unit` |
| キャッシュとローテーションのあいだ | `examples/21-security/src/keyring.ts`、`src/token.ts`、`src/app.ts`、`test/keyring.test.ts`、`test/token.test.ts`、`test/app.test.ts` | `test:unit` |
| ローテーションの手順 | `examples/21-security/src/rotation.ts`、`scripts/rotate.ts`、`test/rotation.test.ts` | `sec:secret:versions`、`sec:secret:rotate` |
| 鍵の持ち主 | `examples/21-security/infra/lib/security-stack.ts`、`infra/test/security-stack.test.ts` | `sec:infra:synth`、`test:unit` |
| WAF を付けられる入口、付けられない入口 | `examples/21-security/infra/lib/waf-stack.ts`、`infra/lib/security-stack.ts`、`infra/test/waf-stack.test.ts` | `sec:waf:infra:deploy`、`sec:waf:infra:destroy` |
| IAM の変更が行き渡るまで | `examples/21-security/src/propagation.ts`、`test/propagation.test.ts`、`scripts/smoke.ts`、`scripts/trail.ts` | `sec:smoke`、`sec:trail:iam` |
| 検出と記録の 4 つのサービス | `examples/21-security/scripts/posture.ts`、`scripts/trail.ts` | `sec:posture`、`sec:trail:iam` |
| 組織になったら | `examples/21-security/policies/scp-guardrails.json`、`src/policy-model.ts`、`test/scp.test.ts` | `test:unit` |
| デプロイして確かめる | `examples/21-security/scripts/smoke.ts` | `sec:infra:deploy`、`sec:smoke`、`sec:infra:drift` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |
| 片付け | `examples/21-security/infra/lib/security-stack.ts` | `sec:infra:destroy`、`sec:waf:infra:destroy` |

**一次情報**（確認日は、断りのないかぎり 2026-10-12）

- IAM: [Troubleshoot IAM（eventual consistency）](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html)、[Security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)、[Access Analyzer の policy generation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html)、[Policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)、AWS service reference（[secretsmanager](https://servicereference.us-east-1.amazonaws.com/v1/secretsmanager/secretsmanager.json) ほか、アクションとリソースタイプの確認）
- AWS WAF: [保護できるリソース](https://docs.aws.amazon.com/waf/latest/developerguide/how-aws-waf-works-resources.html)、[レートベースのルール](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based.html)、[その注意点](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-caveats.html)、[baseline rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html)、[IP reputation rule groups](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html)、[WCU](https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html)、[テストと調整](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-testing.html)、[AWS::WAFv2::WebACL](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-wafv2-webacl.html)、[RateBasedStatement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html)
- CloudFront: [AWS WAF を使う](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-awswaf.html)、[関数 URL のオリジンへのアクセス制限](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
- 2026-10-13 に読んだもの: [Amazon CloudFront no longer charges for requests blocked by AWS WAF](https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-cloudfront-charges-requests-blocked-aws-waf/)、[CloudFront flat-rate pricing plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)、[Rate-based rule high-level settings](https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-rate-based-high-level-settings.html)、[RateBasedStatement](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-wafv2-webacl-ratebasedstatement.html)（再読）
- Secrets Manager: [シークレットの中身とバージョン](https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html)、[PutSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html)、[GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)、[DeleteSecret](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DeleteSecret.html)、[best practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)、[Lambda 関数によるローテーション](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html)、[AWS::SecretsManager::Secret](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)、[料金](https://aws.amazon.com/secrets-manager/pricing/)
- Lambda: [環境変数](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)、[Lambda で Secrets Manager を使う](https://docs.aws.amazon.com/lambda/latest/dg/with-secrets-manager.html)
- AWS KMS: [KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html)、[ローテーション](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html)、[鍵の削除](https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html)、[料金](https://aws.amazon.com/kms/pricing/)
- GuardDuty: [What is Amazon GuardDuty?](https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html)、[Getting started](https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_settingup.html)、[使用量と費用の見積もり](https://docs.aws.amazon.com/guardduty/latest/ug/monitoring_costs.html)
- Inspector: [What is Amazon Inspector?](https://docs.aws.amazon.com/inspector/latest/user/what-is-inspector.html)、[Lambda 関数の検査](https://docs.aws.amazon.com/inspector/latest/user/scanning-lambda.html)、[Getting started](https://docs.aws.amazon.com/inspector/latest/user/getting_started_tutorial.html)、[料金](https://aws.amazon.com/inspector/pricing/)
- CloudTrail: [event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html)、[concepts（global service events）](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)、[LookupEvents](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_LookupEvents.html)、[料金](https://aws.amazon.com/cloudtrail/pricing/)
- AWS Config: [What is AWS Config?](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html)、[料金](https://aws.amazon.com/config/pricing/)
- Organizations: [SCP](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)、[SCP の評価](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html)、[SCP の構文](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_syntax.html)、[quota](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html)、[組織の作成](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_org_create.html)、[FAQs](https://aws.amazon.com/organizations/faqs/)、[aws-samples の SCP の例](https://github.com/aws-samples/service-control-policy-examples)
- AWS Price List: [Secrets Manager](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ap-northeast-1/index.json)、[KMS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awskms/current/ap-northeast-1/index.json)、[WAF](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/awswaf/current/index.json)、[GuardDuty](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonGuardDuty/current/ap-northeast-1/index.json)、[Inspector](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json)、[Config](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSConfig/current/ap-northeast-1/index.json)
- cdkd: [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（tarball の `dist/`。プロバイダーの登録、シークレットと KMS の鍵の作成と削除）
- AWS SDK for JavaScript v3: [3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-secrets-manager/v/3.1149.0)（7 つのクライアントの型定義）
- Cloudflare: [Workers の secret](https://developers.cloudflare.com/workers/configuration/secrets/)、[WAF の managed rules](https://developers.cloudflare.com/waf/managed-rules/)、[rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)

:::
