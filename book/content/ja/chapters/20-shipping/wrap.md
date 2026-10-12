---
title: "20 CI/CD: 費用、注意点、片付け"
---

# 20 CI/CD: 費用、注意点、片付け

## Workers から来た人へ

<!-- section: 20.workers -->

Cloudflare Workers のデプロイと比べると、違いは次のあたりです。

| | Cloudflare Workers | この章 |
| --- | --- | --- |
| デプロイ | `wrangler deploy` が version を作り、すぐ 100% に切り替える | synth して、CloudFormation が template の差分を 1 つずつ反映する |
| 版と切り替え | version と deployment。2 つの version に割合で振り分けられる | Lambda の version と alias。重み付けはできるが、この章では未実装 |
| 戻す | `wrangler rollback`。直近 100 個の version まで | 失敗時は CloudFormation が自動で戻す。あとから戻すなら、コードを戻してデプロイ |
| CI の認証 | ドキュメントの手順は、API token を CI の secret に置く | OIDC で、1 時間だけ有効な認証情報を受け取る。保存する秘密は無い |
| 戻らないもの | KV、R2、D1 などの中身は version に含まれない | データ、schema、外に出たもの |

Workers のほうが、ずっと短い手順で済みます。Worker は 1 つの単位で、version の切り替えは一瞬です。この章が長いのは、API Gateway、Lambda、role、log group という別々のリソースを、順番に更新しているからで、「途中で止まる」という話も、そこから出てきます。

戻らないものについては、どちらも同じでした。

## お金の話

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

この章が足したもの自体には、ほとんど料金がかかりません。CloudFormation は、`AWS::` で始まる種類のリソースについては追加料金なし。IAM の role と OIDC provider も、IAM の一部として追加料金なしです。stack の中身（HTTP API と Lambda）は、04章と同じで、呼ばれなければ 0 です。drift の検出にも、CloudFormation の料金はかかりません。

増えていくのは、CDK の asset の bucket です。デプロイのたびに、関数のコードの zip が 1 つ増えます。1 日 1 回のデプロイを 1 年続けて、一度も片付けなかったとして、月あたりの保存料金は 1 セント未満でした（USD 0.001192。zip は 1 つ 137 KB、S3 Standard が 1 GB あたり月 USD 0.025 という仮定）。137 KB は、この章の bundle を手元で圧縮した大きさで、CLI が実際に作る zip を量ったものではありません。コンテナイメージを使う stack だと、桁が変わります。

GitHub Actions の料金は、AWS の請求ではありません。GitHub のドキュメントによると、public repository で標準の runner を使うぶんには無料、private repository には、プランごとに毎月の無料の分数があります（GitHub Free で 2,000 分）。この章の workflow が 1 回に何分かかるかは、実行していないので分かりません。

preview の stack の料金は、中身しだいです。上の節に書いたとおりです。

叩かれたときの話もしておきます。この章の API は、dev も prod も preview も、認証なしで誰でも呼べます。歯止めは stage の流量制限で、stack 1 つにつき毎秒 10 件（burst 20）。超えたぶんは 429 です。30 日張り付かれて最大 2,592 万件、04章と同じ計算で **stack 1 つあたり月 52.43**（API Gateway 33.44、Lambda 9.50、ログ 9.49）。dev と prod に preview が 3 つ開いていれば、5 倍の 262 ほどです。使っていない stack を消す理由が、ここにもあります。

ノートは 04章のメモリ上の repository なので、実行環境 1 つにつき 100 件で止まります。レスポンスの大きさも 04章のままで、一覧は要約 20 件で 20 KiB まで、ノート 1 件は 64 KiB までです。データ転送がいくらまで届くかは、04章の「叩かれ続けたら」に書いた計算（月に USD 180 ほどまで）がそのまま当てはまります。本物の利用者を迎える前に足すものも同じで、認証（06章）と、CloudFront を前に置いたうえでの AWS WAF（21章。web ACL は月 8.00）です。

## ハマりどころ

実行して出会ったものではなく、ドキュメントとコードから「ここで詰まりそう」と分かっているものです。

| こうなったら | ここを見る |
| --- | --- |
| `cdk deploy` が、bootstrap されていない、role を assume できない、と言う | `vp run ship:cfn:bootstrap` は、このアカウントとリージョンで済んでいますか。cdkd の bootstrap では代わりになりません |
| GitHub Actions で `AssumeRoleWithWebIdentity` が拒否される | token の `sub` と trust policy の文字列が、1 文字でも違うと通りません。job に `environment` はありますか。repository は ID 入りの形（`owner@123/repo@456`）ではありませんか |
| `AihShipCi` のデプロイが、OIDC provider が既にある、と失敗する | アカウントに登録済みです。`-c existingOidcProviderArn=...` を付けます |
| 最初のデプロイが失敗して、stack が `ROLLBACK_COMPLETE` で残っている | CloudFormation はこの stack を更新できません。次の `ship:cfn:deploy` で CLI が消して作り直します。先に、イベントで失敗の原因を |
| `ship:cfn:drift` が `failed` で、理由に `not authorized` と出る | DriftRole に、その resource type を読む権限が足りません。`ci-stack.ts` に足します |
| `ship:cfn:drift` が毎回 11 で終わる | 未検査の種類が、`drift-coverage.ts` の一覧にありません。本当に検査できない種類なのか、対応表で確かめてから足します |
| `ship:cfn:diff` が空なのに、動きが違う | diff は template どうしの比較です。`vp run ship:cfn:drift` を |
| prod の stack を消せない | termination protection です。本当に消すなら、コンソールで解除してから |

## 本番にするなら

- **cfn-exec role を絞る。** 既定は `AdministratorAccess` です。bootstrap のときに、必要な policy だけを渡し、permissions boundary も付けます。deploy role を使える job は、どれもこの権限まで届きます
- **アカウントを分ける。** dev、preview、prod を同じアカウントに置くかぎり、名前でしか分かれていません
- **preview は、信用できる branch だけに。** 上の 2 つのどちらも無いまま preview を有効にすると、branch を push できる人の全員が、アカウントの管理者になれます
- **`production` environment に保護を付ける。** デプロイできる branch を main に限り、承認を必須にします。trust policy が信用しているのは、この environment の名前です
- **エラー率で止める仕組みを足してから、段階的に切り替える。** alias の重み付けと CodeDeploy は、アラーム（[19章](/ja/chapters/19-observability.md)）と組にして使います
- **drift の report を、人が見る場所に流す。** 落ちた job の通知だけに頼らない。定期実行は止まることがあります
- **asset を片付ける。** 固定した版の CLI には `cdk gc` があります。この章では試していません
- **OIDC provider と CI の role も、drift を見る。** この章の DriftRole は、`AihShipApi` で始まる stack しか読めません。`AihShipCi` を誰かが書き換えても、気づけません

## 片付け

<!-- section: 20.cleanup -->

```bash
vp run ship:preview:list
vp run ship:cfn:destroy
vp run ship:ci:destroy
```

preview の stack が残っていたら、1 つずつ `vp run ship:cfn:destroy -c stage=pr-<番号>` で消します。prod を作っていたら、termination protection を解除してから `-c stage=prod` で。prod の log group は、stack を消しても残ります。

`ship:ci:destroy` で、OIDC provider と 4 つの role が消えます。GitHub の repository の variables と、`.github/workflows/` にコピーした workflow は、自分で消してください。workflow が残っていると、存在しない role を assume しようとして、毎日失敗し続けます。

最後に残るのが、CDK の bootstrap です。`CDKToolkit` stack は CloudFormation のコンソールから消せますが、asset の bucket は残る設定なので、空にしてから別に消します。ほかの CDK アプリが同じアカウントで `cdk deploy` を使っているなら、消さないでください。この片付けに対応するタスクは用意していません。

cdkd の bootstrap（02章）と、04章の `AihHttpApi` は、この章では何も変えていません。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（drift の polling と分類と gate、SDK の client を差し替えた呼び出し順、trust policy と role の権限、stage ごとの stack、CDK CLI の引数、stack の状態ごとの次の一手、preview の洗い出し、workflow の YAML）。型検査。固定した CDK CLI での synth（`ship:cfn:synth`。stage を変えたものも）。知らない stage と、repository を指定しない CI role のデプロイが、AWS を呼ぶ前に止まること。いずれも macOS（Apple silicon）です。

**まだ確かめていないこと。** AWS と GitHub に触るものは、すべて未実行です。`ship:cfn:bootstrap`、`ship:cfn:diff`、`ship:cfn:deploy`、`ship:smoke`、`ship:cfn:status`、`ship:cfn:drift`、`ship:preview:list`、`ship:cfn:destroy`、`ship:ci:diff`、`ship:ci:deploy`、`ship:ci:destroy`、4 つの workflow、「わざとずらしてみる」の手順、`cdkd export` と `cdkd import --migrate-from-cloudformation`。とくに次の点は、実環境での確認待ちです。

- IAM が trust policy を受け入れ、想定した job だけが role を assume できること。fork からの pull request で token が出るかどうか
- GitHub 用の role から、bootstrap の role を assume して `cdk diff` と `cdk deploy` が通ること
- DriftRole の読み取り権限が、実際の検出に足りること
- CloudFormation の drift 検出の、実際の応答の形。fixture は API リファレンスと SDK の型から書いたものです。存在しない stack に対するエラーの名前とメッセージも想定です
- integration が未検査になること、inline の policy の変更が role の drift として出ること、結果の時刻が検出の開始時刻以降になること
- 失敗したデプロイの rollback の様子、古い version が残ること
- x86_64-linux の runner で、Nix の devShell に入れること
- stage の流量制限（`DefaultRouteSettings`。毎秒 10 件、burst 20）が CloudFormation 経由で反映され、超えたぶんが 429 になること。template にあることはテストで見ています。drift の検出がこの property を比べるかどうかも未確認です
- preview の節に書いた道筋（pull request の側の workflow が使われること、PreviewRole から cfn-exec role の権限まで届くこと）。GitHub と CDK のドキュメントと、この章の role の定義からの読み取りで、試してはいません。`--custom-permissions-boundary` は、固定した版の CLI にあることだけを確かめました

**cdkd との関係。** この章の 2 つの stack は cdkd ではデプロイしませんが、決まりなので確かめました。固定した版の cdkd（0.296.28）は、`AWS::Lambda::Alias`、`AWS::Lambda::Version`、`AWS::IAM::OIDCProvider` に専用の実装を登録していません。ほかの種類（`AWS::ApiGatewayV2::*`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup`）には登録があります。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 2 つの経路を、もう一度 | `examples/20-shipping/src/cdk-args.ts`、`scripts/cdk.ts`、`cdk.json` | `ship:cfn:bootstrap`、`ship:cfn:synth` |
| 環境は stack を分ける | `examples/20-shipping/infra/lib/config.ts`、`infra/lib/ship-api-stack.ts`、`infra/bin/app.ts`、`infra/test/ship-api-stack.test.ts` | `ship:cfn:synth`、`test:unit` |
| CloudFormation に渡す | `examples/20-shipping/src/cdk-args.ts`、`test/cdk-args.test.ts`、`scripts/smoke.ts`、`src/stack-info.ts` | `ship:cfn:diff`、`ship:cfn:deploy`、`ship:smoke` |
| 鍵を置かずに AWS に入る | `examples/20-shipping/infra/lib/ci-stack.ts`、`infra/lib/config.ts`、`infra/test/ci-stack.test.ts` | `ship:ci:diff`、`ship:ci:deploy`、`test:unit` |
| role に何を持たせるか | `examples/20-shipping/infra/lib/ci-stack.ts`、`infra/test/ci-stack.test.ts` | `test:unit` |
| workflow | `examples/20-shipping/workflows/`、`test/workflows.test.ts` | `test:unit` |
| pull request ごとの preview | `examples/20-shipping/workflows/preview.yml`、`src/previews.ts`、`scripts/previews.ts`、`test/previews.test.ts` | `ship:preview:list` |
| 戻せるもの、戻せないもの | `examples/20-shipping/infra/lib/ship-api-stack.ts` | `test:unit` |
| deploy は途中で止まる | `examples/20-shipping/src/stack-status.ts`、`test/stack-status.test.ts`、`scripts/status.ts` | `ship:cfn:status` |
| CloudFormation の drift を、同じ gate に通す | `tools/src/drift/cloudformation.ts`、`cloudformation-schema.ts`、`cloudformation.test.ts`、`fixtures/cloudformation/`、`examples/20-shipping/src/drift-client.ts`、`test/drift-client.test.ts`、`scripts/drift.ts` | `ship:cfn:drift`、`test:unit` |
| `IN_SYNC` は「全部一致」ではない | `examples/20-shipping/src/drift-coverage.ts`、`infra/test/ship-api-stack.test.ts` | `ship:cfn:drift`、`test:unit` |
| 片付け | `examples/20-shipping/scripts/cdk.ts` | `ship:cfn:destroy`、`ship:ci:destroy` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.test.ts` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-12）

- CloudFormation: [drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)、[stack 全体の drift の検出](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/detect-drift-stack.html)、[resource type の対応表](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html)、[失敗時の扱い](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)、[stack の状態](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/view-stack-events.html)、[rollback の続行](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-continueupdaterollback.html)、[change set](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html)、[stack policy](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html)、[termination protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-protect-stacks.html)、[料金](https://aws.amazon.com/cloudformation/pricing/)
- CloudFormation API リファレンス: [DetectStackDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DetectStackDrift.html)、[DescribeStackDriftDetectionStatus](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackDriftDetectionStatus.html)、[DescribeStackResourceDrifts](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStackResourceDrifts.html)、[StackResourceDrift](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_StackResourceDrift.html)、[ListStackResources](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListStackResources.html)、[CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)
- AWS CDK: [bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)、[環境の bootstrap](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)、[cdk diff](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-diff.html)、[cdk drift](https://docs.aws.amazon.com/cdk/v2/guide/ref-cli-cmd-drift.html)、[aws-cdk 2.1145.0](https://www.npmjs.com/package/aws-cdk/v/2.1145.0)（ヘルプ出力、README、`cdk bootstrap --show-template`）
- IAM: [OIDC 用の role](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)、[OIDC provider の作成](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)、[IAM FAQs](https://aws.amazon.com/iam/faqs/)
- 権限の出典: [CloudFormation の resource type の schema](https://schema.cloudformation.ap-northeast-1.amazonaws.com/CloudformationSchema.zip)、AWS service reference（[CloudFormation](https://servicereference.us-east-1.amazonaws.com/v1/cloudformation/cloudformation.json)、[CloudWatch Logs](https://servicereference.us-east-1.amazonaws.com/v1/logs/logs.json)）
- GitHub: [OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)、[AWS での OIDC の設定](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)、[Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)、[workflow を起動するイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[environment](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[料金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- action: [aws-actions/configure-aws-credentials v6.3.0](https://github.com/aws-actions/configure-aws-credentials/tree/e1253824e5c10ff9df46874f81ed3ec929e19cfd)。`actions/checkout` v7.0.1、`cachix/install-nix-action` v31.11.1、`actions/upload-artifact` v7.0.2 は、GitHub の API で最新の release と commit を確認
- Lambda: [version](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)、[重み付きの alias](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)、[CodeDeploy の deployment configuration](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployment-configurations.html)
- cdkd: [Introduction](https://cdkd.dev/introduction/)、[Drift](https://cdkd.dev/drift/index.html)、[drift CLI reference](https://cdkd.dev/cli-drift/index.html)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（`export` と `import` のヘルプ、provider の登録）
- Cloudflare Workers: [Versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)、[Gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)、[Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)、[GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [@aws-sdk/client-cloudformation 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-cloudformation/v/3.1149.0)、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（型定義）

:::
