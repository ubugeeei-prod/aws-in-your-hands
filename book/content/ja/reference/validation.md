---
title: "検証記録"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/validation.json (tools/src/book/generate.ts) -->

# 検証記録

「書いたこと」と「動かして確かめたこと」を分けて記録します。ローカルで通ったことは、AWS 上で動くことの証拠ではありません。

実行環境: macOS 26 (Darwin 25.6.0), arm64 (aarch64-darwin), Nix 2.25.3 (2026-10-11)

| 対象 | コマンド | 種別 | 結果 | 実行日 | 補足 |
| --- | --- | --- | --- | --- | --- |
| toolchain | `nix develop` | ローカル | 成功 | 2026-10-11 | Node.js 24.21.0、pnpm 10.34.5、AWS CLI 2.35.11、vp 1.1.0 が入り、vp env which node が Nix の Node.js を指すことを確認 |
| toolchain | `vp install --frozen-lockfile` | ローカル | 成功 | 2026-10-11 | pnpm-lock.yaml を書き換えずに導入できた |
| toolchain | `clean checkout: nix develop → vp install --frozen-lockfile → vp run check:all` | ローカル | 成功 | 2026-10-11 | stage した内容だけを別ディレクトリに書き出して実行。事前生成ファイルや global のツールには依存していない |
| toolchain | `vp の初回セットアップと shell 設定 / vp first-run setup and shell profiles` | ローカル | 成功 | 2026-10-11 | 仮の HOME で実験。何も指定しないと ~/.zshrc、~/.zshenv、~/.bashrc、~/.profile に追記され、VP_SELF_SETUP_NO_MODIFY_PATH=1 では追記されないことを確認 |
| all | `vp run check:all` | ローカル | 成功 | 2026-10-11 | format と lint、Vize による Vue の lint と型検査、tsc による型検査、テスト 218 件（1 件は DynamoDB Local が無いため skip）、生成ページの同期、日英とソース対応の整合、6 つの CDK アプリの synth、本と 2 つの SPA のビルド、リンク検査 |
| all | `vp run typecheck / tsc x12 (parallel)` | ローカル | 成功 | 2026-10-11 | pnpm がハードリンクで置いた同一内容の index.d.ts（aws-cdk-lib に 3,501 個、同じ inode）を TypeScript 7 が取り違えていたのが、型検査がときどき落ちる原因だった。packageImportMethod: clone-or-copy にしてから、並列の tsc が 12 回中 12 回、aws-cdk-lib を含む vize check が 4 回中 4 回通った |
| book | `vp run build:book / vp run links:check` | ローカル | 成功 | 2026-10-11 | 日英 34 ページずつと 404、検索インデックスを生成。cache hit のとき出力が復元されること、取り込み元のコードや本文を変えると再実行されることを確認 |
| book | `vp run book:infra:synth` | ローカル | 成功 | 2026-10-11 | 5 リソース、3 output。AWS への変更なし |
| 02 | `vp run hello:infra:synth -c stage=prod / vp run hello:infra:synth:cdk` | ローカル | 成功 | 2026-10-11 | context が cdkd に渡り、prod で bucket が Retain になることを template で確認。CDK CLI でも synth できた |
| 03 | `vp run build:spa / vp run typecheck:vue` | ローカル | 成功 | 2026-10-11 | Vize の Vite plugin でビルド。出力は 152 KB。vize check は 8 回とも成功し、わざと入れた型エラーを検出した |
| 04 | `vp run dev:api + curl` | ローカル | 成功 | 2026-10-11 | 本文の 4 つの curl を実行し、/health、作成、一覧、不正な入力の 400 を確認 |
| 04 | `vp run api:infra:synth` | ローカル | 成功 | 2026-10-11 | esbuild による bundle（Docker なし）を含む。17 リソース |
| 05 | `vp run test:unit (examples/05-dynamodb)` | ローカル | 成功 | 2026-10-11 | repository の contract（メモリ）、DynamoDB へのリクエストの検査、409、ページ送り、応答喪失後の再試行、インフラの assertion |
| 05 | `vp run dev:notes + curl (NOTES_STORE=memory)` | ローカル | 成功 | 2026-10-11 | 作成、更新、古い version での更新の 409、一覧を確認 |
| 05 | `vp run notes:infra:synth` | ローカル | 成功 | 2026-10-11 | AWS SDK を含む bundle を esbuild で作成 |
| 06 | `vp run test:unit (examples/06-auth)` | ローカル | 成功 | 2026-10-11 | 認証（401）、認可（他人のノートは 404、持ち主は token からのみ）、監査ログ、identity の読み取り、開発用サインイン、PKCE の一時保存、インフラの assertion |
| 06 | `vp run dev:app:api + vp run dev:app:web + ブラウザの自動操作 / browser automation` | ローカル | 成功 | 2026-10-11 | ローカルのサインイン、ノートの作成、別の利用者からの取得が 404、token なしが 401、競合の表示と保存し直し、再読み込み後にサインインを求められることを確認 |
| 06 | `vp run app:infra:synth / build:app:web / typecheck:app:web / lint:app:web` | ローカル | 成功 | 2026-10-11 | 19 種類のリソース。Cognito 用のコードは型検査のみ |
| 01 | `vp run account:whoami` | AWS | 未実行 | - | 認証情報が必要 |
| 01 | `vp run account:budget:create / account:budget:delete` | AWS | 未実行 | - | AWS を変更する |
| 02 | `vp run infra:bootstrap` | AWS | 未実行 | - | cdkd の保存場所を作る |
| 02 | `vp run hello:infra:diff / deploy / drift / drift:revert:preview / drift:revert / drift:accept / destroy` | AWS | 未実行 | - | drift の実験を含む |
| 03 | `vp run spa:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | CloudFront distribution を作る |
| 03 | `vp run spa:publish:plan / publish / smoke / invalidate / unpublish` | AWS | 未実行 | - | 公開と実 URL の確認 |
| 04 | `vp run dev:api:cdkd` | ローカル | 未実行 | - | Docker の daemon が必要。実行していない |
| 04 | `vp run api:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | Lambda と API Gateway を作る |
| 04 | `vp run api:smoke / api:logs` | AWS | 未実行 | - | デプロイ済みの API が必要 |
| book | `vp run book:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | 本のサイトは未デプロイ |
| book | `vp run book:publish:plan / publish / smoke / invalidate / unpublish` | AWS | 未実行 | - | 公開 URL はまだ無い |
| pricing | `vp run pricing:refresh` | AWS | 未実行 | - | 公開 API を読む。data/pricing/unit-prices.json は同じ API から一度だけ手で抽出した |
| distribution | `vp run sources:pack` | ローカル | 未実行 | - | commit が無いので実行できない |
| 05 | `vp run db:local:start / db:migrate:local / db:seed:local / db:reset:local / test:local:dynamodb` | ローカル | 未実行 | - | Docker の daemon が使えなかった。DYNAMODB_ENDPOINT が無いと test:local:dynamodb が失敗することだけ確認した |
| 05 | `vp run notes:infra:diff / deploy / drift / destroy, vp run notes:smoke` | AWS | 未実行 | - | DynamoDB の table を作る |
| 06 | `vp run app:infra:diff / deploy / drift / destroy, app:user:create, app:publish, app:smoke:web, app:smoke:api, app:unpublish` | AWS | 未実行 | - | user pool、distribution、table を作る |
| 18 | `vp run test:unit (examples/18-live)` | ローカル | 成功 | 2026-10-11 | GetStream の解釈、イベントの検証と順序によらない集計、エンコーダー設定の検査、ページの表示の判断、stack の assertion |
| 18 | `vp run typecheck / typecheck:stream:web / lint:stream:web` | ローカル | 成功 | 2026-10-11 | サンプル全体と player ページの型検査、template の lint |
| 18 | `vp run stream:infra:synth` | ローカル | 成功 | 2026-10-11 | esbuild の bundle 込みで template を生成。AWS には問い合わせない |
| 18 | `vp run build:stream:web / dev:stream:web` | ローカル | 成功 | 2026-10-11 | ビルドに player の worker と wasm が含まれることを確認。開発サーバーで、channel が未設定のときの表示を確認 |
| 18 | `vp run stream:infra:diff / deploy / drift / destroy, stream:key, stream:config, stream:status, stream:stop` | AWS | 未実行 | - | IVS の channel と stream key を作る。実際の配信と視聴は AWS が無いと確かめられない |
| 11 | `vp run test:unit (examples/11-network)` | ローカル | 成功 | 2026-10-11 | CIDR の計算、設定の検証、経路のモデル、料金の入力、stack の assertion、import の対応 |
| 11 | `vp run net:infra:synth` | ローカル | 成功 | 2026-10-11 | 既定の構成と、`-c egress=nat-per-az -c interfaceEndpoints=ecr.api,ecr.dkr,logs` の両方で synth した |
| 11 | `vp run net:plan` | ローカル | 成功 | 2026-10-11 | 既定、`egress=nat`、`egress=nat-per-az`、`interfaceEndpoints=ecr.api,ecr.dkr,logs`、不正な設定で実行した |
| 11 | `vp run net:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | VPC を作る。context によっては NAT Gateway と interface endpoint（時間課金）も作る |
| 15 | `vp run test:unit (examples/15-email)` | ローカル | 成功 | 2026-10-11 | ヘッダー injection の拒否、記録を先に取る送信の冪等性（8 か所の障害注入、同時依頼、応答喪失）、SES イベントの検証と重複・順序の入れ替わり、DynamoDB と SES へ送るリクエストの検査、インフラの assertion |
| 15 | `vp run dev:mail + curl` | ローカル | 成功 | 2026-10-11 | 本文の curl を実行。同じ通知の 2 回目が duplicate になること、改行入りの題名の 400、bounce の fixture を流した後の suppressed を確認 |
| 15 | `vp run mail:infra:synth` | ローカル | 成功 | 2026-10-11 | 2 つの関数を AWS SDK ごと esbuild で bundle。AWS には問い合わせない |
| 15 | `vp run mail:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | SES の identity と configuration set、SNS の topic、DynamoDB の table、Lambda、HTTP API を作る。identity を作ると確認メールが送られる |
| 15 | `vp run mail:send / mail:status / mail:dns / mail:logs` | AWS | 未実行 | - | デプロイ済みの stack が必要。mail:send は実際にメールを送り、課金される |
| 15 | `aws sesv2 get-account / get-email-identity / put-account-details / put-account-suppression-attributes` | AWS | 未実行 | - | sandbox の確認、identity の確認状況、production access の申請。申請は人が行う手作業 |
| 10 | `vp test run examples/10-edge` | ローカル | 成功 | 2026-10-11 | 関数（node:vm で実ファイルを実行）、KeyValueStore の計画と同期、SDK adapter、Lambda@Edge の handler、2 つの stack |
| 10 | `vp run edge:infra:synth` | ローカル | 成功 | 2026-10-11 | AihEdge は 6 リソース、AihEdgeBodyDigest は 4 リソース（esbuild の bundle 込み、Docker なし）。-c bodyDigestVersionArn を付けた synth も確認 |
| 10 | `vp run dev:edge + curl` | ローカル | 成功 | 2026-10-11 | 本文の curl（redirect、query string の引き継ぎ、書き換え、404）と、edge-data.json の maintenance / newHome の切り替えを確認 |
| 10 | `vp run dev:edge:cdkd + curl` | ローカル | 成功 | 2026-10-11 | cdkd local start-cloudfront（--kvs-file、--origin）。Docker の daemon が無い状態で起動し、dev:edge と同じ応答を確認。認証情報は使っていない |
| 10 | `vp run typecheck (examples/10-edge)` | ローカル | 成功 | 2026-10-11 | 型検査 |
| 10 | `vp run edge:infra:diff / deploy / drift / destroy, edge:publish / unpublish` | AWS | 未実行 | - | S3、CloudFront の distribution、Function、KeyValueStore を作る |
| 10 | `vp run edge:kvs:plan / edge:kvs:sync` | AWS | 未実行 | - | デプロイ済みの KeyValueStore が必要。API 操作は 1,000 回あたり USD 1 |
| 10 | `vp run edge:body:infra:deploy / destroy` | AWS | 未実行 | - | us-east-1 に Lambda 関数と version、IAM role を作る |
| 13 | `vp run test:unit (examples/13-sql)` | ローカル | 成功 | 2026-10-11 | transaction の再試行、PGlite 上の repository（quota、version、owner の分離、制約）、COMMIT の競合の注入、migration の lint と中断からの再開、grant 文の検査、API、インフラの assertion |
| 13 | `vp run sql:db:reset:local / sql:db:migrate:local / sql:db:seed:local, vp run dev:sql + curl (NOTES_DB=pglite)` | ローカル | 成功 | 2026-10-11 | migration と seed の適用、2 回目の実行で何も変わらないこと、作成、更新、古い version の 409、UUID でない id の 404、削除、開発サーバーの起動中に reset が拒否されることを確認 |
| 13 | `vp run sql:infra:synth` | ローカル | 成功 | 2026-10-11 | node-postgres と AWS SDK の署名を含む CommonJS の bundle を esbuild で作成。bundle を Node.js 24 で読み込み、DB に触れない route（GET /health と UUID でない id）が応答することを確認 |
| 13 | `vp run sql:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | Aurora DSQL の cluster を作る。cdkd は AWS::DSQL::Cluster を Cloud Control API 経由で扱う |
| 13 | `vp run sql:db:migrate / sql:db:grant / sql:db:seed` | AWS | 未実行 | - | admin として cluster に接続し、schema、database role、seed を作る |
| 13 | `vp run sql:smoke / sql:logs, vp run dev:sql (NOTES_DB=dsql)` | AWS | 未実行 | - | デプロイ済みの API と cluster が必要 |
| 07 | `vp run test:unit (examples/07-uploads)` | ローカル | 成功 | 2026-10-11 | 認可（他人のノートは 404、key は token からのみ）、許可証の中身、完了と期限と上限、途中で止めた場合の S3 と DynamoDB の状態、掃除、同じ form の再送、SDK が作る POST policy と presigned GET（偽の認証情報で署名のみ）、DynamoDB へのリクエストの形、インフラの assertion |
| 07 | `vp run dev:uploads:api + vp run dev:uploads:web + ブラウザの自動操作 / browser automation` | ローカル | 成功 | 2026-10-11 | サインイン、ノートの作成、ファイルを選んで画像が表示されること、別の利用者の許可・一覧・完了が 404、大きすぎるファイル・違う種類・違う key の拒否、完了の再実行、削除とノートの削除の後に画像の URL が読めないことを確認。相手はメモリ上の実装で、S3 ではない |
| 07 | `vp run uploads:infra:synth / build:uploads:web / typecheck:uploads:web / lint:uploads:web / typecheck` | ローカル | 成功 | 2026-10-11 | 06章と同じ 19 種類のリソース。Cognito 用のコードと scripts/ は型検査のみ |
| 07 | `S3 互換のローカル実装での確認 / a run against an S3-compatible local implementation` | ローカル | 未実行 | - | タスクを用意していない。Docker の daemon が要り、執筆環境では動いていなかった |
| 07 | `vp run uploads:infra:diff / deploy / drift / destroy, uploads:user:create, uploads:publish, uploads:smoke:web, uploads:smoke:api, uploads:sweep, uploads:empty, uploads:unpublish` | AWS | 未実行 | - | bucket を 2 つ、user pool、distribution、table を作る。S3 への presigned POST、lifecycle rule、CORS、DynamoDB への添付の記録は、どれも実環境で未確認 |
| 09 | `vp run test:unit (examples/09-ssr)` | ローカル | 成功 | 2026-10-11 | cache の判定、共有 cache 越しの漏れの再現、session、publish の計画、smoke の判定、CDK の assertion |
| 09 | `vp run typecheck / typecheck:ssr / lint:ssr` | ローカル | 成功 | 2026-10-11 | tsc で core、server、infra、scripts、test。Vize で app の .vue。わざと入れた型エラーで vize check が失敗することも確認 |
| 09 | `vp run ssr:check:output (runs build:ssr first)` | ローカル | 成功 | 2026-10-11 | Nuxt 4.6.1 と nitropack 2.13.4 の buffered な Lambda handler を function URL の形の event で呼び、ヘッダー、サインイン、共有 cache 越しの再現を確認。/feed は 1 回、HTML は 1 回で書かれた。Lambda では実行していない |
| 09 | `vp run ssr:check:output:stream (runs build:ssr:stream first)` | ローカル | 成功 | 2026-10-11 | awslambda を記録用の偽物に差し替えて streaming の handler を呼んだ。/feed は 3 回（約 300 ms おき）、HTML は 1 回で書かれた。Lambda の runtime、function URL、CloudFront は通していない |
| 09 | `vp run ssr:infra:synth` | ローカル | 成功 | 2026-10-11 | cdkd で synth。template に function URL（AWS_IAM）、OAC、2 つの Lambda::Permission、cache policy、response headers policy があることを確認 |
| 09 | `nuxt dev on port 3909 (the command behind dev:ssr, started directly) + HTTP requests` | ローカル | 成功 | 2026-10-11 | AIH_SSR_SIGN_IN=dev で起動し、公開ページ、404、/me、サインイン、サインアウト、よそからの POST の 403、/feed が 3 つに分かれて届くことを確認。ブラウザでの操作はしていない |
| 09 | `vp run ssr:infra:diff / deploy / drift / destroy, ssr:assets:plan, ssr:assets:publish, ssr:smoke, ssr:unpublish` | AWS | 未実行 | - | distribution、Lambda の関数と function URL、bucket を作る |
| 19 | `vp run test:unit (examples/19-observability)` | ローカル | 成功 | 2026-10-12 | 実際に書かれるログの形と大きさ、ログの query と metric filter の条件を本物のログ行で評価、traceparent と X-Ray の trace ID の変換、span とログの相互参照、属性の許可リスト、sampling されない要求と欠けた span の再現、アラームの条件、料金計算の入力、インフラの assertion |
| 19 | `vp run dev:obs + curl` | ローカル | 成功 | 2026-10-12 | 本文の curl を実行。ログの行に traceId が付くこと、span がコンソールに出ること、traceparent を付けた要求が同じ trace ID を引き継ぐこと、TRACE_SAMPLE_RATIO=0 で span が出ずログは残ることを確認 |
| 19 | `vp run obs:query:print` | ローカル | 成功 | 2026-10-12 | Logs Insights の query の文字列を出力するだけ。AWS には問い合わせない |
| 19 | `vp run obs:infra:synth` | ローカル | 成功 | 2026-10-12 | 関数を OpenTelemetry の API ごと esbuild で bundle。-c otelLayerArn を付けた場合も synth できることを確認。AWS には問い合わせない |
| 19 | `vp run obs:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | DynamoDB の table、Lambda、HTTP API、SNS の topic、アラーム 2 つ、ダッシュボード、metric filter を作る。ダッシュボードと metric filter は cdkd が Cloud Control API 経由で扱う |
| 19 | `vp run obs:smoke / obs:query / obs:alarms` | AWS | 未実行 | - | デプロイ済みの stack が必要。obs:smoke はノートを 1 件作って消す。obs:query は走査したログの量に課金される |
| 19 | `vp run obs:infra:deploy -c otelLayerArn=...` | AWS | 未実行 | - | AWS Lambda Layer for OpenTelemetry を付けた構成。Node.js 24 の runtime はこの layer の対応一覧に無い |
| 14 | `vp run test:unit (examples/14-kv-cache)` | ローカル | 成功 | 2026-10-12 | rate limiter の境界と同時実行、store の contract（メモリ）、DynamoDB と Valkey へ送るリクエストの形、TTL の読み取り側の判定、stale read、stampede、TTL の揺らぎ、IAM 認証 token の署名、アプリ、stack の assertion |
| 14 | `vp run kv:infra:synth` | ローカル | 成功 | 2026-10-12 | 既定の構成と `-c store=valkey` の両方で synth した（esbuild の bundle 込み） |
| 14 | `vp run dev:kv` | ローカル | 成功 | 2026-10-12 | KV_STORE を memory、valkey、dynamodb にして起動し、本文の curl を実行した。valkey と dynamodb は下の行の手元のサーバーに対して |
| 14 | `node scripts/test-local.ts (examples/14-kv-cache; the command behind vp run kv:test:local)` | ローカル | 成功 | 2026-10-12 | store の contract 22 件を、nixpkgs の valkey-server 9.1.2 と、AWS が配布する DynamoDB Local 3.3.1（jar を JRE 21 で起動）に対して実行した。Docker の daemon が無かったので、コンテナではなくプロセスとして起動している |
| 14 | `vp run kv:local:start / kv:local:stop` | ローカル | 未実行 | - | Docker の daemon が無く実行していない。valkey/valkey:9.0.6-alpine と amazon/dynamodb-local:3.3.1 の image は取得も起動もしていない |
| 14 | `vp run kv:infra:diff / deploy / drift / destroy, kv:smoke, kv:logs` | AWS | 未実行 | - | DynamoDB の table、Lambda、HTTP API を作る。`-c store=valkey` では、置いてあるだけで課金される ElastiCache Serverless の cache も作る |
| 20 | `vp run test:unit (examples/20-shipping, tools/src/drift)` | ローカル | 成功 | 2026-10-12 | CloudFormation の drift の polling・分類・gate（clean、drifted、deleted、未検査、nested stack、検出失敗、stack 不在、timeout、古い結果、矛盾、形の違う応答）、SDK の client を差し替えた呼び出し順、OIDC の trust policy と role の権限、stage ごとの stack、CDK CLI の引数、stack の状態ごとの次の一手、preview の洗い出し、workflow の YAML |
| 20 | `vp run ship:cfn:synth` | ローカル | 成功 | 2026-10-12 | 固定した AWS CDK CLI 2.1145.0 で synth。認証情報なし。AihShipApi と AihShipCi の template が cdk.out に出ること、AihShipApi に AWS::IAM::Policy と AWS::CDK::Metadata が無いことを確認。-c stage=prod、-c stage=pr-12 でも実行 |
| 20 | `vp run ship:cfn:deploy -c stage=staging / vp run ship:ci:deploy (no AWS call)` | ローカル | 成功 | 2026-10-12 | 知らない stage と、repository を指定しない CI role のデプロイが、AWS を呼ぶ前に止まることを確認 |
| 20 | `vp run check:all` | ローカル | 成功 | 2026-10-12 | format、lint、型検査、全テスト、全 CDK アプリの synth、本のビルドとリンク検査 |
| 20 | `vp run ship:cfn:bootstrap` | AWS | 未実行 | - | CDKToolkit stack の作成は未実行。作られるものの記述は、固定した CLI の `cdk bootstrap --show-template` による |
| 20 | `vp run ship:cfn:diff / ship:cfn:deploy / ship:smoke / ship:cfn:status / ship:cfn:destroy` | AWS | 未実行 | - | CloudFormation 経路でのデプロイと確認は未実行。alias 経由の integration が動くこと、失敗時の rollback の様子も未確認 |
| 20 | `vp run ship:ci:deploy -c githubRepository=<owner>/<repo>` | AWS | 未実行 | - | OIDC provider と 4 つの role の作成は未実行。trust policy を IAM が受け入れること、bootstrap の role を assume できることも未確認 |
| 20 | `vp run ship:cfn:drift (and the drift lab)` | AWS | 未実行 | - | 実際の stack での drift 検出は未実行。fixture は API リファレンスと SDK の型から書いたもので、実機の応答ではない |
| 20 | `vp run ship:preview:list` | AWS | 未実行 | - | preview stack の一覧は未実行 |
| 20 | `examples/20-shipping/workflows/*.yml on GitHub Actions` | AWS | 未実行 | - | 4 つの workflow は GitHub Actions で一度も実行していない。x86_64-linux の runner で Nix の devShell が入ることも未確認 |
| 20 | `cdkd export / cdkd import --migrate-from-cloudformation` | AWS | 未実行 | - | cdkd と CloudFormation の間で stack を移す手順は未実行。記述は固定した版のヘルプによる |
| 12 | `vp run test:unit (examples/12-containers)` | ローカル | 成功 | 2026-10-12 | SIGTERM を送る子プロセスのテスト、graceful shutdown、新旧の版の同居、時間の関係、設定、docker コマンドの組み立て、料金、stack の assertion |
| 12 | `vp run ecs:infra:synth` | ローカル | 成功 | 2026-10-12 | image tag なし、`-c imageTag=v1`、`-c imageTag=v1 -c taskSubnets=private` の 3 通りで synth した |
| 12 | `vp run ecs:bundle / ecs:bundle:check` | ローカル | 成功 | 2026-10-12 | dist/server.mjs を作り、node_modules の無い場所で起動して /health を呼び、SIGTERM で終了コード 0 になることを確かめた |
| 12 | `vp run dev:ecs` | ローカル | 成功 | 2026-10-12 | 起動して本文の curl を実行し、Ctrl-C（SIGINT）で draining、stopped のログが出て終了することを確かめた |
| 12 | `vp run ecs:image:build v1 --dry-run / ecs:image:run / ecs:image:push` | ローカル | 成功 | 2026-10-12 | --dry-run でコマンドを表示した。daemon なしで実行すると、理由を表示して終了コード 1 になることも確かめた |
| 12 | `vp run ecs:watch --url http://localhost:8099 --for 3` | ローカル | 成功 | 2026-10-12 | 手元で起動したサーバーに向けて実行し、版ごとの集計が出ることを確かめた。deploy した service には向けていない |
| 12 | `vp run ecs:image:build / ecs:image:run / ecs:image:push` | ローカル | 未実行 | - | Docker の daemon が動いていなかったため、image を一度も build していない |
| 12 | `vp run ecs:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | ECR の repository を作る。image tag を渡すと ALB と Fargate の task 2 つ（時間課金）も作る |
| 12 | `vp run ecs:watch / ecs:logs` | AWS | 未実行 | - | deploy した service を読むだけのタスク |
| 08 | `vp run test:unit (examples/08-async)` | ローカル | 成功 | 2026-10-12 | 重複配送（同じメッセージ、別の ID の同じイベント、2 つの worker の同時実行）、順序の入れ替わり（古い作成、遅れた削除）、途中での中断（記録の前、記録の後）、batch の一部の失敗、DLQ への移動と戻し、S3 の test event、07章の穴（form の再送）の修復、掃除の再実行・同時実行・中断、画像の種類と大きさの判定（sips と cwebp が書いた実ファイル）、DynamoDB と S3 へのリクエストの形、インフラの assertion。条件を 2 か所わざと壊して、テストが落ちることも確かめた |
| 08 | `vp run dev:async + スクリプトによる HTTP の操作 / driven over HTTP by a script` | ローカル | 成功 | 2026-10-12 | サインイン、ノートの作成、form でのアップロード、worker の記録（ok、1x1）、完了、同じ form で HTML を再送して記録が rejected に変わること、掃除の dry run、削除で記録が消えることを /local/queue で確認。相手はメモリ上の queue と bucket で、SQS でも S3 でもない |
| 08 | `vp run async:infra:synth / typecheck` | ローカル | 成功 | 2026-10-12 | 07章の 19 種類に 5 種類（SQS::Queue、SQS::QueuePolicy、Lambda::EventSourceMapping、Lambda::EventInvokeConfig、Scheduler::Schedule）を足した 24 種類。Custom:: のリソースはない。scripts/ は型検査のみ |
| 08 | `vp run async:infra:diff / deploy / drift / destroy, async:smoke, async:queue, async:logs, async:housekeeping, async:publish, async:smoke:web, async:user:create, async:empty, async:unpublish` | AWS | 未実行 | - | queue を 2 つ、関数を 2 つ、schedule を 1 つ、そして 07章の一式（bucket 2 つ、user pool、distribution、table）を作る。S3 の通知、SQS、event source mapping、Scheduler、DynamoDB の条件付き書き込みは、どれも実環境で未確認 |
| 23 | `vp run test:unit (examples/23-ec2)` | ローカル | 成功 | 2026-10-12 | file に書く repository を電源断の各段階で壊すテスト、SIGTERM のときの挙動（本物の socket）、user data と unit の生成と injection の拒否、data volume の script を bash で実行するテスト、Run Command の引数、SSM への経路のモデル、料金の入力、stack の assertion |
| 23 | `vp run ec2:infra:synth` | ローカル | 成功 | 2026-10-12 | 既定の構成と、`-c placement=public`、`-c dataOnDestroy=snapshot`、`-c dataSnapshotId=snap-0123456789abcdef0`、`-c amiId=ami-0123456789abcdef0` で synth した |
| 23 | `vp run ec2:plan / ec2:render / ec2:app:build` | ローカル | 成功 | 2026-10-12 | ec2:plan は既定、`placement=public`、endpoint の足りない設定、不正な設定で実行。ec2:render は deploy/ が生成結果と一致することを確認。ec2:app:build は 1 つの ESM の file を作る |
| 23 | `vp run dev:ec2 + curl, SIGTERM` | ローカル | 成功 | 2026-10-12 | ビルドした dist/server.mjs と src/server.ts の両方を Node.js 24 で起動。作成、一覧、再起動後も残ること、SIGTERM で exit code 0 で終わること、壊した notes.json では起動を拒否することを確認 |
| 23 | `vp run ec2:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | EC2 の instance（時間課金）、EBS volume、S3 bucket を作る。11章の stack が先に要る |
| 23 | `vp run ec2:status / ec2:session / ec2:forward / ec2:app:release / ec2:app:rollback / ec2:smoke / ec2:logs` | AWS | 未実行 | - | Systems Manager を通して instance に入る、release を配る、動作を確かめる。ec2:session と ec2:forward は Session Manager plugin が要る（devShell には入っていない） |
| 23 | `vp run ec2:patch:check / ec2:patch:apply / ec2:data:unmount / ec2:data:mount / ec2:releases:empty` | AWS | 未実行 | - | instance の上で dnf を実行する、data volume を unmount、mount する、release の object を消す |
| 23 | `aws ec2 create-snapshot / create-volume / detach-volume / attach-volume（snapshot と restore の手順）` | AWS | 未実行 | - | 本文の手順は実行していない。flag は devShell の AWS CLI 2.35.11 の help で確かめた |
| 16 | `vp run test:unit (examples/16-long-jobs)` | ローカル | 成功 | 2026-10-12 | step の再実行（同じ step の 2 回目、応答が失われた後に table が変わった場合、呼び出しの途中での失敗、読み取りの失敗）、2 つの worker（止まっていた worker が遅れて書く、同じ export の 2 つの実行が重なる）、checkpoint の大きさを変えても出力が同じこと、manifest と補償処理（欠けた part、途中で止まった破棄、完成した export を消さないこと）、workflow の定義を手元の実行器で動かす（応答の喪失、再試行の打ち切りと再開、最初からのやり直し、破棄）、S3 と DynamoDB へのリクエストの形、durable function 版（SDK の LocalDurableTestRunner）、stack の assertion。条件を 2 か所わざと壊して、どちらもテストが 2 つ落ちることも確かめた |
| 16 | `vp run export:local` | ローカル | 成功 | 2026-10-12 | 既定（250 件）、`--notes 450 --lose 2 --break 4`（応答の喪失と、再試行の打ち切りからの再開）、`--notes 1000 --pages-per-call 20` を実行し、manifest の行数と重複のない件数がノートの件数と一致することを確かめた。相手はメモリ上の store で、Step Functions でも S3 でも DynamoDB でもない |
| 16 | `vp run export:infra:synth / typecheck` | ローカル | 成功 | 2026-10-12 | 既定の構成と `-c durable=true` の両方で synth した（esbuild の bundle 込み。durable 版は SDK も bundle する）。既定は 9 種類で、どれも cdkd 0.296.28 に専用の実装がある。durable 版は Lambda::Version と Lambda::Alias が増え、この 2 つは Cloud Control API 経由。scripts/ は型検査のみ |
| 16 | `vp run export:infra:diff / deploy / drift / destroy, export:seed, export:start, export:status, export:logs, export:empty, export:durable:start` | AWS | 未実行 | - | bucket、table、関数 3 つ、state machine、schedule を作る。`-c durable=true` では durable function と version、alias が増える。Step Functions、Scheduler からの起動、S3 の条件付き書き込み、DynamoDB の Scan、durable function は、どれも実環境で未確認 |
| 22 | `vp run test:unit (examples/22-recovery)` | ローカル | 成功 | 2026-10-12 | table と bucket を別の時点に戻したときの検出と修復（同じ時点、table だけ、アップロードより前、上書きの後、version が残っていない場合）、修復の dry run・二重実行・途中での中断、08章の残った検査記録、object の復元計画と再実行、version 番号の巻き戻りと fence、PITR の計画、drill の記録、item の分類、05章の repository contract、DynamoDB と S3 へのリクエストの形、stack の assertion |
| 22 | `vp run recovery:demo` | ローカル | 成功 | 2026-10-12 | メモリ上の table と bucket で、事故、table の復元、検査（4 件）、bucket の復元、再検査（0 件）、fence までを実行した。本文に載せた出力はこの実行のもの |
| 22 | `vp run recovery:infra:synth` | ローカル | 成功 | 2026-10-12 | 既定の構成で synth した（esbuild の bundle 込み）。`-c table`、`-c protect=on`、`-c backup=on`、`-c replica=on` は、テストの中と、`node infra/bin/app.ts` に context を渡す形で synth した |
| 22 | `vp run recovery:drill new / mark / set / summary` | ローカル | 成功 | 2026-10-12 | 記録ファイルの作成、時刻と件数の記入、上書きの拒否、集計を手元で実行した。書いた値は動作確認用で、drill の実測ではない。ファイルは消した |
| 22 | `vp run recovery:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | PITR を有効にした DynamoDB の table、versioning を有効にした S3 bucket、Lambda 関数を作る。`-c backup=on` で AWS Backup の vault と plan、`-c replica=on` で 2 つ目の bucket と複製の設定が加わる |
| 22 | `vp run recovery:status / seed / accident / restore:table / restore:objects / diff / verify / repair / protect / audit / drop-table / empty` | AWS | 未実行 | - | drill の手順。AWS に対しては 1 つも実行していない。RPO と RTO の実測値はない |
| 24 | `vp run test:unit (examples/24-celld)` | ローカル | 成功 | 2026-10-12 | 更新の順序を決める関数に、各段階で失敗を差し込むテスト（待ち時間なし）、作り物の fleet に対する ledger の判定、probe の script を bash と curl で実行するテスト、install script の引数と checksum の拒否、unit と user data の生成、diagnose の出力の読み取り、backup と restore の計画、料金の入力、stack の assertion |
| 24 | `vp run celld:infra:synth` | ローカル | 成功 | 2026-10-12 | 既定（node なし）と、`-c nodes=1`、`-c nodes=3`、`-c nodes=2 -c stateOnDestroy=delete`、`-c nodes=2 -c dataSnapshots=a:snap-0123456789abcdef0` で synth した |
| 24 | `vp run celld:plan / vp run celld:render` | ローカル | 成功 | 2026-10-12 | node 数ごとの計画と固定費の表示、deploy/ が生成結果と一致することの確認 |
| 24 | `vp run celld:fetch` | ローカル | 成功 | 2026-10-12 | GitHub の release から v0.6.2 と v0.6.1 の Linux arm64 の archive を取得し、大きさと SHA-256 が固定した値と一致することを確かめた。展開も実行もしていない（`--host` は付けていない） |
| 24 | `celld の実行（celld dev、celld deploy、node の起動）` | ローカル | 未実行 | - | 取得した binary は一度も実行していない。celld の挙動についての記述はすべて、v0.6.2 の文書とソースを読んだもの |
| 24 | `vp run celld:infra:deploy と node への配置（artifacts、install、start、app-deploy）` | AWS | 未実行 | - | stack の deploy、S3 への archive の配置、node での install と起動、application の deploy は未実行 |
| 24 | `vp run celld:rollout / celld:drain / celld:stop-all` | AWS | 未実行 | - | drain と、v0.6.1 から v0.6.2 への rolling update は実機で未実行。順序の制御は手元の stand-in に対してだけ確かめた |
| 24 | `vp run celld:loss-check` | AWS | 未実行 | - | node を失わせて invariant を確かめる検査は、celld の実物には一度も当てていない |
| 24 | `vp run celld:backup / celld:restore` | AWS | 未実行 | - | 停止した fleet の backup と restore は未実行。bucket の copy と snapshot から戻した fleet が正しく起動するかは未確認 |
| 17 | `vp run test:unit (examples/17-ai)` | ローカル | 成功 | 2026-10-12 | 59 件。fixture の stream（完了、maxTokens、途中で切断、途中で throttling、開始時の throttling）、cancel と timeout、client、SSE の書式、awslambda の代役を渡した function URL のアダプター、CDK の assertion |
| 17 | `vp run typecheck (examples/17-ai)` | ローカル | 成功 | 2026-10-12 | scripts/ と infra/ を含む |
| 17 | `vp run ai:infra:synth` | ローカル | 成功 | 2026-10-12 | esbuild による bundle（Docker なし）を含む。5 リソース |
| 17 | `vp run dev:ai + curl` | ローカル | 成功 | 2026-10-12 | AI_BACKEND=fixture で起動。/health、要約の stream、不正な入力の 400、途中で切断したときの cancelled の log（curl を 0.5 秒で打ち切り、durationMs は 501）、AI_FIXTURE=truncated の error イベントを確認 |
| 17 | `vp run check:all` | ローカル | 成功 | 2026-10-11 | 17章を加えた状態で通過 |
| 17 | `vp run dev:ai (AI_BACKEND=bedrock)` | AWS | 未実行 | - | 手元のサーバーから実際の Bedrock を呼ぶ。課金される |
| 17 | `vp run ai:hello / ai:test:live` | AWS | 未実行 | - | 実際のモデルを呼ぶ。課金される。モデル ID、権限、実際のイベントの形はここでしか確かめられない |
| 17 | `vp run ai:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | Lambda、function URL、IAM role、log group を作る |
| 17 | `vp run ai:smoke / ai:logs` | AWS | 未実行 | - | デプロイ済みの function URL が必要。課金される |
| 21 | `vp run test:unit (examples/21-security)` | ローカル | 成功 | 2026-10-12 | token の署名と検証、rotation をまたぐ鍵の cache（古い cache の実行環境、2 回の rotation、でたらめな version id の連打、Secrets Manager の停止、同時リクエスト）、rotation の手順（応答の喪失後の再実行、早すぎる 2 回目、version id の使い回し）、SDK の client を差し替えた secret の読み取り、wildcard の lint と理由つきの例外、20章の CI role への適用、SCP の JSON と評価の model、IAM の伝播待ち、posture の判定、stack の assertion（既定で月額がかかるのは secret 1 つだけ、cmk と web ACL は opt-in） |
| 21 | `vp run sec:infra:synth` | ローカル | 成功 | 2026-10-12 | 固定した cdkd 0.296.28 で synth。認証情報なし。AihSecurity と AihSecurityWaf の template が cdk.out に出ること、-c cmk=on と -c webAclArn=... で template が変わること、形の違う webAclArn で synth が止まることを確認 |
| 21 | `vp run sec:iam:lint (own cdk.out, and every chapter's cdk.out)` | ローカル | 成功 | 2026-10-12 | この章の 2 つの template は例外なしで合格。`vp run infra:synth` のあとに全章の cdk.out を渡した結果は、本文の「本全体に当ててみる」に書いたとおり |
| 21 | `vp run dev:sec` | ローカル | 成功 | 2026-10-12 | 手元の server で /health、/token、/verify を curl で確認。鍵はメモリの中だけで、AWS は呼ばない |
| 21 | `vp run sec:infra:deploy / sec:smoke / sec:infra:drift / sec:infra:destroy` | AWS | 未実行 | - | 未実行。CloudFront、function URL、Secrets Manager を通した動作、デプロイ直後の 503 の有無、destroy 後に secret が残らないこと |
| 21 | `vp run sec:secret:versions / sec:secret:rotate` | AWS | 未実行 | - | 未実行。PutSecretValue 後の staging label の動き、同じ version id での再実行、rotation 後に古い cache の実行環境が新しい token を受け入れること |
| 21 | `vp run sec:waf:infra:deploy / sec:infra:deploy -c webAclArn=... / sec:waf:infra:destroy` | AWS | 未実行 | - | 未実行。us-east-1 への web ACL の作成、distribution への関連付け、rate-based rule が実際に block を始めるまでの時間、count にした rule group の記録 |
| 21 | `vp run sec:infra:deploy -c cmk=on` | AWS | 未実行 | - | 未実行。customer managed key での secret の暗号化、kms:ViaService の条件つきで関数が読めること、destroy 後の鍵の状態 |
| 21 | `vp run sec:posture / sec:trail:iam` | AWS | 未実行 | - | 未実行。6 つのサービスの読み取り API の実際の応答、権限が無いときの表示 |
| 30 | `vp run modeling:test:local (DynamoDB Local 3.3.1)` | ローカル | 成功 | 2026-10-13 | テーブルの操作の規則 14 件と、ノートブックの規則 21 件を、DynamoDB Local 3.3.1 に対して実行した。Docker ではなく、AWS が配布する jar を Java 21 で直接起動し（ポート 8030、-inMemory -sharedDb -disableTelemetry）、テーブルは `scripts/local-db.ts reset` で作った。ストリームを読む処理と移行は、DynamoDB Local では実行していない |
| 33 | `node examples/33-production-readiness/scripts/check.ts` | ローカル | 成功 | 2026-10-13 | `vp run ready:check` のスクリプトを、依存する `infra:synth` を通さずに直接実行した（ほかの章が同じ作業ツリーで書かれている最中で、全スタックの synth をやり直せなかったため）。読んだのは、すでに cdk.out にあった 02〜24章と本のサイトの 27 個のテンプレートと、この章の 2 個。本文の件数はこの実行のもので、25〜32章と 34〜36章のスタックは含まない |
| 46 | `node examples/46-shield/scripts/origins.ts --gate AihShield examples/46-shield/cdk.out` | ローカル | 成功 | 2026-10-13 | shield:origins:gate の中身。AihShield の function URL は closed |
| 46 | `node scripts/flood.ts (examples/46-shield)` | ローカル | 成功 | 2026-10-13 | shield:flood の中身。本文の表はこの出力 |
| 64 | `vp run isolates:infra:drift -c imageTag=<tag>` | AWS | 未実行 | - | 未実行 |
| 66 | `vp run distsql:local:start, then vp run distsql:local:verify (no TLS)` | ローカル | 成功 | 2026-10-13 | 127.0.0.1 の上で yb-master と yb-tserver を 3 組起動（PostgreSQL 15.12-YB-2025.2.7.0-b0）。13章のマイグレーション 4 つと repository を変えずに実行。上限 3 件に 12 件の作成を 3 ノードから同時に送り、作成 3、quota_exceeded 9、40001 による再試行 16 回、note_count と行数が 3 で一致。ノード b を SIGKILL した後も a と c が確認済みの 40 件をすべて返し、続く 20 件の作成は 1.1 秒で終わった。b と c を落とすと残る 1 ノードは 20 秒たっても書き込みを確認せず、戻すと確認済みの 40 件がすべて残っていた（この回は、確認されなかった 1 件も入っていた） |
| 66 | `vp run distsql:local:certs, vp run distsql:local:start --tls, then vp run distsql:local:verify` | ローカル | 成功 | 2026-10-13 | openssl（Homebrew の 3.6.1。Nix の shell には入っていない）で CA と 127.0.0.1 の証明書を作り、TLS とパスワード認証を有効にして同じ検証を 2 回実行。TLS なしのクライアントは断られた。40001 による再試行は 12 回。b を失った後の 20 件は 4.3 秒。2 ノードを失ったときの 1 件は、1 回は接続がタイムアウトし、1 回は 20 秒応答がなく、どちらも戻した後に入っていなかった。ysql_dump の出力を別のデータベースに ysqlsh で流し込み、確認済みの 40 件が揃った。yb-admin は --certs_dir_name を付けると list_all_masters と modify_placement_info に応え、付けないと 60 秒でリーダーを見つけられずに終わった |
| 66 | `vp run distsql:artifact / distsql:install / distsql:certs / distsql:configure / distsql:start / distsql:status / distsql:health / distsql:logs / distsql:stop` | AWS | 未実行 | - | ノードに触るタスクは実行していない |
| 25 | `vp test run examples/25-events` | ローカル | 成功 | 2026-10-13 | 7 ファイル、97 件。パターンの一致と不一致（スタックに入れるのと同じオブジェクトを、手元の matcher で評価）、matcher が実装していない演算子を断ること、stream のレコードからイベントへの変換と ID の安定性、契約と版（増えた欄は読める、次の版と欠けた欄は断る）、重複配送、順序の入れ替わり、失敗したターゲットの再試行と退避、archive からのリプレイを冪等なコンシューマーとそうでないコンシューマーに届けた結果、リプレイの計画、dead letter の読み分け、DynamoDB へのリクエストの形、インフラの assertion。相手はメモリ上のバスで、EventBridge ではない。条件を 4 か所わざと壊して、テストがそれぞれ 5 件、3 件、2 件、11 件落ちることも確かめた |
| 25 | `vp run events:demo` | ローカル | 成功 | 2026-10-13 | メモリ上のバスで、作成、更新、重複した publish、逆順の二重配送、リプレイを順に流し、ID を覚える counter が 1 のまま、覚えない counter が 3 になること、rejected の通知がリプレイの後も 1 通のままであることを出力で確認 |
| 25 | `vp run events:infra:synth / tsc --noEmit -p examples/25-events` | ローカル | 成功 | 2026-10-13 | 08章の 24 種類に 7 種類（Events::EventBus、Events::Rule、Events::Archive、Pipes::Pipe、SNS::Topic、SNS::TopicPolicy、SNS::Subscription）を足した 31 種類。Custom:: のリソースはない。scripts/ は型検査のみ |
| 25 | `vp run events:infra:diff / events:infra:deploy / events:smoke / events:status / events:replay / events:infra:drift / events:empty / events:infra:destroy` | AWS | 未実行 | - | AWS に対しては何も実行していない |
| 26 | `vp test run examples/26-analytics` | ローカル | 成功 | 2026-10-13 | 62 件。レコードのスキーマとテーブルの列の一致、記録に本文やパスが入らないこと、記録に失敗してもレスポンスが変わらないこと、本物の SDK で応答を失わせたときの二重書き込みとタイムアウト、日付の境目をまたぐオブジェクト、重複を 1 回と数えるクエリ、生成する SQL、Parquet の列ごとの大きさ、料金計算の入力、スタックのアサーション |
| 26 | `tsc --noEmit -p examples/26-analytics` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 26 | `vp run analytics:infra:synth` | ローカル | 成功 | 2026-10-13 | esbuild のバンドル込みで synth。-c format=parquet を付けた場合も |
| 26 | `vp run dev:analytics + curl + vp run analytics:query:local` | ローカル | 成功 | 2026-10-13 | 本文の curl を実行し、dist/lake にオブジェクトができること、手元のモデルで集計が出ることを確認。SQL は実行していない |
| 26 | `vp run analytics:query:print` | ローカル | 成功 | 2026-10-13 | Athena に送る SQL の文字列を出力するだけ。AWS には問い合わせない |
| 26 | `vp run analytics:sizes` | ローカル | 成功 | 2026-10-13 | サンプル 5,000 件を gzip の JSON と Parquet で書き、列ごとのバイト数を出力。Parquet は手元の JavaScript のライブラリが書いたもの |
| 26 | `vp run analytics:infra:deploy` | AWS | 未実行 | - | 未実行。Firehose、Glue、Athena のどのリソースも実際には作っていない |
| 26 | `vp run analytics:smoke` | AWS | 未実行 | - | 未実行 |
| 26 | `vp run analytics:query` | AWS | 未実行 | - | 未実行。生成した SQL を Athena が受け付けるかは確かめていない |
| 26 | `vp run analytics:infra:drift` | AWS | 未実行 | - | 未実行 |
| 26 | `vp run analytics:empty / analytics:infra:destroy` | AWS | 未実行 | - | 未実行 |
| 27 | `vp test run examples/27-search` | ローカル | 成功 | 2026-10-13 | 9 ファイル、80 件。トークン化と BM25、順位の合わせ込み、パッセージの切り分け、所有者の分離（絞り込みを無視するインデックス、偽の所有者、乱数で作った当たり 200 回）、テーブルとインデックスのずれ、索引の冪等性と削除、バッチの途中の失敗とやり直し、作り直しとストリームの競合、回答の出典と引用、API の入力の上限、S3 Vectors に渡すリクエストの形、スタックのアサーション |
| 27 | `tsc --noEmit -p examples/27-search` | ローカル | 成功 | 2026-10-13 | src、infra、test、scripts の型検査 |
| 27 | `vp run search:infra:synth` | ローカル | 成功 | 2026-10-13 | esbuild で 2 つの関数をバンドルし、14 リソースのテンプレートを出力した。AWS には問い合わせていない |
| 27 | `vp run dev:search` | ローカル | 成功 | 2026-10-13 | SEARCH_BACKEND=local で起動し、本文の curl（/health、所有者ごとの /search、所有者なしの 401、/answers、何も見つからない /answers）を実行した。本文に載せた出力はこの実行のもの |
| 27 | `vp run search:infra:deploy` | AWS | 未実行 | - | デプロイしていない。S3 Vectors のインデックスが Cloud Control 経由で作られること、イベントソースマッピングの作成が通ることは未確認 |
| 27 | `vp run search:seed` | AWS | 未実行 | - | 実行していない |
| 27 | `vp run search:smoke` | AWS | 未実行 | - | 実行していない。Titan の埋め込み、S3 Vectors の問い合わせ、回答のストリーミングは一度も実際に呼んでいない |
| 27 | `vp run search:reindex` | AWS | 未実行 | - | 実行していない |
| 27 | `vp run search:logs` | AWS | 未実行 | - | 実行していない |
| 27 | `vp run search:infra:drift` | AWS | 未実行 | - | 実行していない |
| 27 | `vp run search:infra:destroy` | AWS | 未実行 | - | 実行していない。ベクトルの入ったインデックスとバケットが削除できることは未確認 |
| 28 | `vp test run examples/28-multi-region` | ローカル | 成功 | 2026-10-13 | 85 件。2 つのリージョンをメモリ上に置いたモデルで、MREC の複製の遅れ、2 つのリージョンからの同時の編集で片方が消えること、書き込みを 1 つのリージョンに寄せると 05章の検査が効くこと、カウンターの取りこぼし、東京を切り離したあとの上書きと遅れて届く書き込み、MRSC での 409 と孤立したリージョンの拒否。S3 の複製の規則（ルールより前のオブジェクト、削除マーカー、バージョン指定の削除、双方向、テーブルとの速さの差）。ヘルスチェックの判定、フェイルオーバーとレイテンシーの応答、古い DNS の答えを持つクライアント、RTO の内訳。リージョンごとの API の包み（ヘッダー、ヘルスチェック、書き込みの拒否）。スタックのアサーション。05章のリポジトリのコントラクトテストを、2 つのモードのレプリカに対して |
| 28 | `tsc --noEmit -p examples/28-multi-region` | ローカル | 成功 | 2026-10-13 | 型検査。エラーなし |
| 28 | `vp run mr:infra:synth` | ローカル | 成功 | 2026-10-13 | 2 つのスタック（AihMultiRegionStandby が ap-northeast-3、AihMultiRegion が ap-northeast-1）のテンプレートを書き出した。AWS には問い合わせていない |
| 28 | `vp run mr:demo` | ローカル | 成功 | 2026-10-13 | メモリ上の 2 つのリージョンで、6 つの場面を実行した。本文に載せた出力はこの実行のもの |
| 28 | `mutation check (7 changes to examples/28-multi-region)` | ローカル | 成功 | 2026-10-13 | コードを 7 か所わざと壊し（last writer wins の比較、全レコード異常時の応答、書き込みの拒否、削除マーカーの複製、version の条件、EvaluateTargetHealth など）、そのたびにテストが落ちることを確かめた |
| 28 | `vp run mr:standby:infra:deploy / mr:infra:deploy / mr:infra:diff / mr:infra:drift / mr:infra:destroy / mr:standby:infra:destroy` | AWS | 未実行 | - | 実行していない。cdkd が AWS::DynamoDB::GlobalTable とレプリカを作れること、別リージョンのスタックを 1 つのアプリからデプロイできること、名前を固定したバケットへの複製の設定が通ることは、どれも実物で確かめていない |
| 28 | `vp run mr:status / mr:conflict / mr:empty` | AWS | 未実行 | - | 実行していない。実際のグローバルテーブルで 2 つのリージョンから同時に編集したときの結果は、ドキュメントの記述とモデルでしか確かめていない |
| 29 | `vp test run examples/29-lambda-tuning` | ローカル | 成功 | 2026-10-13 | REPORT 行と platform.report の読み取り（Lambda のドキュメントに載っている行で）、課金時間の計算、同時実行数の模型、タイムアウトの並びの検査、応答しないテーブルに対する締め切り、5 通りのバンドルの大きさと予算、デプロイするバンドルを素の Node.js で読み込んで DynamoDB の代役と通信させる検査、インフラのアサーション |
| 29 | `tsc --noEmit -p examples/29-lambda-tuning` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 29 | `vp run tune:infra:synth` | ローカル | 成功 | 2026-10-13 | esbuild のバンドル込みで template を生成。AWS には問い合わせない |
| 29 | `vp run tune:bundle` | ローカル | 成功 | 2026-10-13 | 5 通りのバンドルのバイト数、パッケージごとの内訳、新しい Node.js プロセスでの読み込み時間。時間は手元の Mac の値で、Lambda の値ではない |
| 29 | `vp run tune:plan` | ローカル | 成功 | 2026-10-13 | タイムアウトの並び、メモリごとの料金、provisioned concurrency の料金を表示。AWS には問い合わせない |
| 29 | `vp run tune:report:sample` | ローカル | 成功 | 2026-10-13 | Lambda のドキュメントから写した REPORT 行を集計して表示 |
| 29 | `vp run tune:infra:deploy` | AWS | 未実行 | - | 実行していない |
| 29 | `vp run tune:smoke` | AWS | 未実行 | - | 実行していない |
| 29 | `vp run tune:report` | AWS | 未実行 | - | 実行していない。Lambda 上の時間は 1 つも測っていない |
| 29 | `vp run tune:infra:drift` | AWS | 未実行 | - | 実行していない |
| 29 | `vp run tune:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 30 | `vp test run examples/30-data-modeling` | ローカル | 成功 | 2026-10-13 | 119 件が通り、1 件（DynamoDB Local 用）はスキップ。キーの範囲と並び、書き込みの計画、ページトークン、テーブルの規則とノートブックの規則（メモリ上のモデル）、インデックスの遅れと書き込みの回数、衝突したトランザクションの再試行、途中で止まった削除、重複して届いたストリームのバッチ、関数自身の書き込み、移行の各段階と再開と割り込み、DynamoDB へのリクエストの形、スタックのアサーション |
| 30 | `vp run modeling:db:reset:local && vp run modeling:test:local (DynamoDB Local 3.3.1)` | ローカル | 成功 | 2026-10-13 | テーブルの操作の規則 16 件と、ノートブックの規則 19 件を、DynamoDB Local 3.3.1 に対して実行した。Docker ではなく、AWS が配布する jar を Java 21 で直接起動し（ポート 8030、-inMemory -sharedDb -disableTelemetry）、タスクには環境変数 `DYNAMODB_ENDPOINT=http://localhost:8030` を渡した。ストリームを読む処理と移行は、DynamoDB Local では実行していない |
| 30 | `vp run modeling:demo` | ローカル | 成功 | 2026-10-13 | メモリ上のモデルで、すべての読み方と書き方を 1 回ずつ実行した。本文に載せた出力はこの実行のもの |
| 30 | `vp run modeling:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成を synth した（esbuild のバンドル込み、リソース 9 個）。`-c insights=on` はテストの中で synth した。バンドルは素の Node.js で import できることを確かめた |
| 30 | `tsc --noEmit -p examples/30-data-modeling` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 30 | `vp run modeling:infra:deploy` | AWS | 未実行 | - | AWS には一度もデプロイしていない |
| 30 | `vp run modeling:smoke` | AWS | 未実行 | - | 実際のテーブル、インデックス、ストリーム、関数では動かしていない |
| 30 | `vp run modeling:backfill / modeling:verify / modeling:remove-legacy` | AWS | 未実行 | - | 移行のタスクは実際のテーブルでは動かしていない |
| 30 | `vp run modeling:infra:drift / modeling:infra:destroy` | AWS | 未実行 | - | 未実行 |
| 31 | `vp test run examples/31-progressive-delivery` | ローカル | 成功 | 2026-10-13 | 切り替えの計画（CodeDeploy の既定の 9 つの名前）、アラームの状態からの判断、切り替えの実行（アラーム、応答の喪失、書き込みの失敗、他者による変更、中断と再開）、AppConfig への呼び出しの順序と停止の計画、フラグの定義ファイルの検査、フラグの評価と割合での公開、AppConfig に届かないときのフォールバック、アプリへの組み込み、2 つのバージョンが同じレコードを読むテスト、スタックのアサーション、CodeDeploy と ECS canary のテンプレート。12 ファイル 103 件 |
| 31 | `tsc --noEmit -p examples/31-progressive-delivery` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 31 | `vp run rollout:infra:synth` | ローカル | 成功 | 2026-10-13 | cdkd 0.296.28 での synth。AWS には問い合わせない |
| 31 | `vp run rollout:plan` | ローカル | 成功 | 2026-10-13 | 計画の表示。本文に載せた出力はこの実行のもの |
| 31 | `vp run flags:check` | ローカル | 成功 | 2026-10-13 | フラグの定義ファイルの検査。本文に載せた出力はこの実行のもの |
| 31 | `vp run dev:rollout` | ローカル | 成功 | 2026-10-13 | 手元のサーバーで、フラグのファイルを書き換えると次のリクエストから反映されること、ファイルを壊すと直前の値で動き続けること、probe がバージョンごとの件数を数えることを確かめた |
| 31 | `vp run rollout:infra:deploy` | AWS | 未実行 | - | 未実行。Cloud Control API 経由になる Lambda のエイリアスとバージョン、AppConfig の 4 種類が、cdkd から実際に作れるかは未確認 |
| 31 | `vp run rollout:start --apply` | AWS | 未実行 | - | 未実行 |
| 31 | `vp run rollout:status / rollout:rollback / rollout:probe` | AWS | 未実行 | - | 未実行 |
| 31 | `vp run flags:deploy --apply / flags:status / flags:stop / flags:clear` | AWS | 未実行 | - | 未実行 |
| 31 | `vp run rollout:infra:diff / rollout:infra:drift / rollout:infra:destroy` | AWS | 未実行 | - | 未実行 |
| 32 | `vp test run examples/32-limits` | ローカル | 成功 | 2026-10-13 | 12 ファイル 91 件。トークンバケット、バックオフとジッター、再試行の予算、再試行するクライアント、乱数の種を固定した 2 つのシミュレーション、導入済みの SDK が DynamoDB のスロットリングに何回試行するか（偽のハンドラーに対して）、開発サーバーの 2 つの制限、最初に当たる上限の計算、負荷の送り先の検査と集計、Cost Explorer の応答の読み取り、スタックのアサーション |
| 32 | `tsc --noEmit -p examples/32-limits` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 32 | `vp run limits:infra:synth` | ローカル | 成功 | 2026-10-13 | synth（esbuild のバンドル込み）。AWS には問い合わせない |
| 32 | `vp run limits:simulate` | ローカル | 成功 | 2026-10-13 | 2 つのシミュレーションの表。本文の数字はこの出力 |
| 32 | `vp run dev:limits + vp run limits:load` | ローカル | 成功 | 2026-10-13 | 開発サーバーを起動し、毎秒 5、10、20、40 件を 5 秒ずつ送った。CALLER_LIMIT が既定の 50 のときと 100000 のときの 2 回。本文の表はこの出力。localhost 以外の宛先を断ることも確認 |
| 32 | `vp run limits:cost:print / vp run limits:quotas:book` | ローカル | 成功 | 2026-10-13 | 実行するコマンドの表示と、本の中の上限の一覧。AWS は呼ばない。aws service-quotas と aws ce のヘルプで引数の名前を確認（AWS CLI 2.35.11） |
| 32 | `vp run limits:infra:deploy` | AWS | 未実行 | - | デプロイしていない |
| 32 | `vp run limits:quotas` | AWS | 未実行 | - | アカウントの実際のクォータは読んでいない |
| 32 | `vp run limits:cost` | AWS | 未実行 | - | Cost Explorer は呼んでいない（1 回 USD 0.01） |
| 32 | `vp run limits:infra:drift` | AWS | 未実行 | - | 実行していない |
| 32 | `vp run limits:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 33 | `vp test run examples/33-production-readiness` | ローカル | 成功 | 2026-10-13 | 5 ファイル、110 件。テンプレートの読み取り（テンプレートでないものの拒否、参照の辿り方、リテラルと組み込み関数の区別）、10 個のルールの通る例と落ちる例、例外（理由の必須、使われていない例外、21章の例外の取り込み）、判定（報告だけのスタックと通過を求めるスタック、読めなかった判定対象）、2 つのフィクスチャ、点検の項目（ルールの置き場所、タスクの実在）、練習用と本番向けの 2 つのスタックの synth と点検の結果、Aspect があとから足したテーブルに届くこと。コードを 11 か所わざと壊してテストが落ちることも確かめた（1 か所は最初は落ちず、バケットポリシーの配列を読み落とす誤りが見つかった） |
| 33 | `tsc --noEmit -p examples/33-production-readiness` | ローカル | 成功 | 2026-10-13 | サンプル、スクリプト、テスト、CDK のコードの型検査 |
| 33 | `vp run ready:infra:synth` | ローカル | 成功 | 2026-10-13 | AihReadyPractice と AihReadyProduction の 2 つのテンプレートを cdk.out に書いた。AWS には問い合わせない |
| 33 | `vp run ready:gate` | ローカル | 成功 | 2026-10-13 | 練習用のスタックは 7 件の指摘を報告し、本番向けのスタックは理由つきの例外 2 件を使って通過した。本文に載せた出力はこの実行のもの |
| 33 | `vp run ready:review` | ローカル | 成功 | 2026-10-13 | 8 つの分野、32 項目の一覧を表示した |
| 33 | `node examples/33-production-readiness/scripts/check.ts <cdk.out of chapters 02-24 and book/infra>` | ローカル | 成功 | 2026-10-13 | `vp run ready:check` のスクリプトを、依存する `infra:synth` を通さずに直接実行した（ほかの章が同じ作業ツリーで書かれている最中で、全スタックの synth をやり直せなかったため）。読んだのは、すでに cdk.out にあった 02〜24章と本のサイトの 27 個のテンプレート。結果は 81 件の指摘と 7 件の例外で、本文の件数はこの実行のもの。25〜32章と 34〜36章のスタックは含まない |
| 33 | `vp run ready:check` | ローカル | 未実行 | - | タスクとしては実行していない。`infra:synth` に依存していて、本のすべてのスタックを synth し直すため |
| 33 | `account:whoami, sec:posture, sec:trail:iam, sec:secret:versions, sec:secret:rotate, obs:alarms, ship:cfn:diff, ship:cfn:drift, recovery:status, account:budget:create` | AWS | 未実行 | - | 点検の項目が指している、アカウントを読む・変えるタスク。この章では 1 つも実行していない |
| 34 | `vp test run examples/34-eks` | ローカル | 成功 | 2026-10-13 | マニフェストのスキーマと参照の検査、k8s/ のファイルとジェネレーターの一致、ローリングアップデートと PodDisruptionBudget と drain の計算、時間の関係、サポート期間、料金、スタックのアサーション |
| 34 | `tsc --noEmit -p examples/34-eks` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 34 | `vp run eks:infra:synth` | ローカル | 成功 | 2026-10-13 | context なしと `-c deployRoleArn=arn:aws:iam::123456789012:role/aih-deploy` の 2 通りで synth した。AWS には問い合わせていない |
| 34 | `vp run eks:render` | ローカル | 成功 | 2026-10-13 | k8s/cluster.json と k8s/app.json がジェネレーターの出力と一致する |
| 34 | `vp run eks:manifests cluster --node-role ... --security-group ... ; vp run eks:manifests app --image ...` | ローカル | 成功 | 2026-10-13 | 値をすべてフラグで渡し、AWS を読まずにマニフェストを出力した |
| 34 | `vp run eks:infra:deploy` | AWS | 未実行 | - | クラスターを作っていない。cdkd 0.296.28 が Cloud Control API 経由で AWS::EKS::Cluster、AccessEntry、PodIdentityAssociation を作れるかは未確認 |
| 34 | `kubectl apply -f - (vp run eks:manifests cluster / app)` | AWS | 未実行 | - | kubectl は Nix の shell に無く、クラスターも無い。マニフェストは API サーバーに一度も渡していない |
| 34 | `vp run eks:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 35 | `vp test run examples/35-lambda-managed-instances` | ローカル | 成功 | 2026-10-13 | 8 ファイル、52 件。同時に処理中の 2 つのリクエストでリクエスト ID が入れ替わること（モジュールスコープ）と入れ替わらないこと（AsyncLocalStorage）を、関数の呼び出しと本物のソケットの両方で決まった順序で再現。ワーカースレッド 2 本で Map が別々になること。設定の検証、ログへの経路のモデル、料金の入力、損益分岐の計算、スタックのアサーション |
| 35 | `tsc --noEmit -p examples/35-lambda-managed-instances` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 35 | `vp run lmi:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の設定と、`-c instanceType=m7g.large`、`-c minExecutionEnvironments=0 -c maxExecutionEnvironments=0`、`-c maxVCpuCount=16` で synth した。esbuild がハンドラーをバンドルする。AWS には問い合わせない |
| 35 | `vp run lmi:plan` | ローカル | 成功 | 2026-10-13 | 既定、`instanceType=m7g.large`、`interfaceEndpoints=`（エンドポイントなし。終了コード 2）、`maxVCpuCount=8`（不正な設定。終了コード 1）で実行した |
| 35 | `vp run dev:lmi` | ローカル | 成功 | 2026-10-13 | タスクで手元のサーバーを起動し、`/health` と `POST /notes` に curl で応答を得た |
| 35 | `node src/dev.ts (the command behind vp run dev:lmi, without --watch)` | ローカル | 成功 | 2026-10-13 | 手元のサーバーを起動し、`/health` と `POST /notes` に curl で応答を得た。`SCOPE=module` でも起動した |
| 35 | `vp run net:infra:deploy -c interfaceEndpoints=logs` | AWS | 未実行 | - | 11章のネットワークに CloudWatch Logs のエンドポイントを足す。時間課金 |
| 35 | `vp run lmi:infra:diff` | AWS | 未実行 | - | 未実行 |
| 35 | `vp run lmi:infra:deploy` | AWS | 未実行 | - | 未実行。インスタンスが 3 台起動する想定で、時間課金 |
| 35 | `vp run lmi:smoke` | AWS | 未実行 | - | 未実行 |
| 35 | `vp run lmi:infra:drift` | AWS | 未実行 | - | 未実行 |
| 35 | `vp run lmi:infra:destroy` | AWS | 未実行 | - | 未実行 |
| 36 | `vp run test:unit (examples/36-bedrock)` | ローカル | 成功 | 2026-10-13 | 110 件。手で書いた応答の列（ツールを使って答える、存在しないツール、JSON でない入力、ガードレールの停止、ツールの要求の途中での切断、答えの途中での切断、スロットリング、ツールを求め続ける、ノートの指示に従う）、不変条件を壊すテスト、構造化出力と 1 回の修正、予算の確保と精算、cache point の配置、batch の入出力、評価、アプリ、function URL のアダプター、CDK の assertion |
| 36 | `tsc --noEmit -p examples/36-bedrock` | ローカル | 成功 | 2026-10-13 | scripts/ と infra/ を含む |
| 36 | `vp run bedrock:infra:synth` | ローカル | 成功 | 2026-10-13 | esbuild によるバンドル（Docker なし）を含む。9 リソース、8 種類 |
| 36 | `vp run dev:bedrock (AI_BACKEND=scripted) と curl` | ローカル | 成功 | 2026-10-13 | /health、トークンなしの 401、/assistant の SSE、/notes/:id/action-items の JSON、ログの 2 行。AI_TRANSCRIPT=runaway-tools で turn_limit |
| 36 | `vp run bedrock:eval` | ローカル | 成功 | 2026-10-13 | 4 件。偽のモデルが相手で、モデルは呼んでいない |
| 36 | `vp run bedrock:batch:plan` | ローカル | 成功 | 2026-10-13 | 100 件で通り、--records 40 で止まる。S3 には何も送らない |
| 36 | `vp run bedrock:eval:live` | AWS | 未実行 | - | 課金される。実際のモデルは一度も呼んでいない |
| 36 | `vp run bedrock:infra:deploy` | AWS | 未実行 | - | スタックはデプロイしていない |
| 36 | `vp run bedrock:smoke` | AWS | 未実行 | - | 課金される。デプロイが前提 |
| 36 | `vp run bedrock:logs` | AWS | 未実行 | - | デプロイが前提 |
| 36 | `vp run bedrock:infra:drift` | AWS | 未実行 | - | デプロイが前提 |
| 36 | `vp run bedrock:infra:destroy` | AWS | 未実行 | - | デプロイが前提 |
| 37 | `vp test run examples/37-cloudshell` | ローカル | 成功 | 2026-10-13 | 5 ファイル 50 件。3 つのポリシーが通すアクション、予算の状態、state のキーとリソース、料金がかかる種類の表と各章のサンプルの照合、1,000 個ずつの分割、メモリ上のバケットを空にする繰り返し（拒否、再実行、途中の書き込み、終わらない場合）、ビルドしたファイルを偽物の aws で実行するテスト |
| 37 | `tsc --noEmit -p examples/37-cloudshell` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 37 | `vp run cloudshell:build` | ローカル | 成功 | 2026-10-13 | dist/aih-cloudshell.mjs を出力。Node.js 24.21.0 で実行。Node.js 18 では実行していない |
| 37 | `vp run cloudshell:demo` | ローカル | 成功 | 2026-10-13 | 偽物の aws に対して whoami、budget、left、empty を実行。本文に載せた出力はこの実行のもの。AWS には届いていない |
| 37 | `vp run cloudshell:policy use-no-files` | ローカル | 成功 | 2026-10-13 | ポリシーの JSON を出力。本文に載せた JSON はこの実行のもの |
| 37 | `nix path-info -r (devShell の 5 つの道具) / du -sh node_modules` | ローカル | 成功 | 2026-10-13 | 166 個のパッケージで 1,968,352,824 バイト、node_modules は 1.9 GB。macOS（aarch64-darwin）での値 |
| 37 | `node aih-cloudshell.mjs whoami / budget / left (CloudShell)` | AWS | 未実行 | - | CloudShell を開いていない |
| 37 | `node aih-cloudshell.mjs empty <bucket> --yes --account <id> (CloudShell)` | AWS | 未実行 | - | 実行していない |
| 37 | `aws iam create-policy / attach (cloudshell:policy の出力)` | AWS | 未実行 | - | ポリシーを実際のロールに付けていない |
| 38 | `vp test run examples/38-data-movement` | ローカル | 成功 | 2026-10-13 | 63 件。計画（新規・変更・同じ、PRESERVE と REMOVE、ソースの一覧が空のときの全削除、フィルターで外したものは削除しない、アーカイブ側が新しいオブジェクトの上書きと OverwriteMode NEVER、TransferMode ALL、include と exclude、ALL と REMOVE の組み合わせの拒否、一覧のスキーマ）。フィルターのモデル（分割、エスケープ、フォルダー、ワイルドカード、include の制約）。実行のモデル（静かなソースでの収束と再実行、途中で止まった実行の続き、コピー後・一覧後の上書き、一覧後のアップロード、全体検証での ERROR、ソースの削除、アーカイブ側での書き込み）。イベントのスキーマと判断、ハンドラーの通知と失敗、遅れの上限、環境変数。2 つのスタックのアサーション |
| 38 | `tsc --noEmit -p examples/38-data-movement` | ローカル | 成功 | 2026-10-13 | src、infra、test、scripts の型検査 |
| 38 | `vp run move:demo` | ローカル | 成功 | 2026-10-13 | メモリ上の 2 つのバケットで、途中で止まる実行、続きの実行、ソースとアーカイブを変えたあとの実行、何も変わらない実行を動かした。本文に載せた出力はこの実行のもの |
| 38 | `vp run move:infra:synth` | ローカル | 成功 | 2026-10-13 | 2 つのスタックのテンプレートを書き出した。`-c sourceLocation=<ARN>` を付けた構成は、テストの中と、`node infra/bin/app.ts` にコンテキストを渡す形で synth した |
| 38 | `vp run move:infra:diff / deploy / drift / destroy, move:archive:infra:diff / deploy / destroy` | AWS | 未実行 | - | 東京にバケットと DataSync のロケーション、大阪にアーカイブのバケットとロケーションを作る。`-c sourceLocation=<ARN>` で、スケジュール付きのタスク、ロググループ、EventBridge のルール、関数、SNS のトピックが加わる。DataSync のリソースは Cloud Control API 経由 |
| 38 | `aws datasync start-task-execution / describe-task-execution, vp run move:empty` | AWS | 未実行 | - | タスクの実行と片付け。AWS に対しては 1 つも実行していない |
| 39 | `vp test run examples/39-database-migration` | ローカル | 成功 | 2026-10-13 | この章のモデル（PGlite 2 つ、トリガーによる変更の記録）の上で: 写している間の更新と削除、写しと記録の両方に入った変更、チェックポイントが進む前の停止からの再開、主キーのないテーブルの重複と運ばれない更新、外部キーを眠らせた写し、シーケンスの衝突と前進、件数とダイジェストの比較が見るものと見ないもの、切り替え後の遅れた書き込みと再開による上書き。テーブルマッピングのスキーマと当てはめ、事前の検査、切り替えの判定、スタックのアサーション。7 ファイル 56 件 |
| 39 | `tsc --noEmit -p examples/39-database-migration` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 39 | `vp run dbmig:demo` | ローカル | 成功 | 2026-10-13 | 2 つの PGlite の上で、事前の検査、準備、full load、変更の適用、書き込みの停止、比較、シーケンス、切り替えの判定までを実行した。本文に載せた出力はこの実行のもの。DMS ではなく、この章のモデル |
| 39 | `vp run dbmig:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成（存在しえないホスト名のプレースホルダー）で synth した。`-c accountRoles=existing` と容量の指定はテストの中で synth した |
| 39 | `vp run dbmig:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | DMS Serverless の設定、エンドポイント 2 つ、サブネットグループ、シークレット 2 つ、IAM ロール、セキュリティグループとルール、SNS のトピックと EventBridge のルールを作る。cdkd 0.296.28 には AWS::DMS の専用の実装がなく、Endpoint と ReplicationSubnetGroup は Cloud Control API の対応一覧にないので、最後まで進まない見込み |
| 39 | `aws dms start-replication / describe-replications / describe-replication-table-statistics / stop-replication` | AWS | 未実行 | - | レプリケーションの開始、監視、停止。DMS は一度も動かしていない。所要時間、遅れ、停止時間の実測値はない |
| 39 | `vp run dbmig:preflight / dbmig:verify / dbmig:sequences` | AWS | 未実行 | - | 2 つの PostgreSQL に直接つなぐ。本物のデータベースに対しては実行していない。同じ関数は PGlite の上でテストしている |
| 40 | `vp test run examples/40-disaster-recovery` | ローカル | 成功 | 2026-10-13 | 訓練の planner と判定、復旧の順序の途中失敗と再実行、2 拠点のモデルと split brain、DRS のイベントの検証、API の応答の形と「まだ課金されているもの」の一覧、source と経路の検査、料金の入力、stack の assertion |
| 40 | `tsc --noEmit -p examples/40-disaster-recovery` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 40 | `vp run dr:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成と、`-c placement=public`、`-c templates=declare`、`-c sourceRoleName=... -c sourceSecurityGroupId=sg-0123456789abcdef0` で synth した |
| 40 | `vp run dr:demo` | ローカル | 成功 | 2026-10-13 | 2 拠点の failover と failback、順序の再実行、訓練の集計を手元で表示した |
| 40 | `vp run dr:plan` | ローカル | 成功 | 2026-10-13 | 既定の引数では、kernel 6.18 が対象外として BLOCKER になり、終了コード 2 で終わることを確かめた。`kernel=6.1` と `placement=public` でも実行した |
| 40 | `vp run dr:infra:deploy` | AWS | 未実行 | - | デプロイしていない |
| 40 | `aws drs initialize-service / create-replication-configuration-template` | AWS | 未実行 | - | サービスの初期化とテンプレートの作成は実行していない |
| 40 | `vp run dr:status / dr:drill / dr:job / dr:terminate / dr:billed` | AWS | 未実行 | - | DRS の API は一度も呼んでいない。訓練も復旧も failback もしていない |
| 41 | `vp test run examples/41-fargate` | ローカル | 成功 | 2026-10-13 | 8 ファイル 89 件。大きさの表と選び方、strategy、target tracking のモデル（Application Auto Scaling ではない）、止められるタスクのリクエスト、12章のサーバーへの SIGTERM、ジョブの中断と再開、コマンドの組み立て、料金、スタックのアサーション |
| 41 | `tsc --noEmit -p examples/41-fargate` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 41 | `vp run fargate:infra:synth` | ローカル | 成功 | 2026-10-13 | タグなし、-c imageTag=f1、-c imageTag=f1 -c exec=true、-c imageTag=f1 -c taskSubnets=private で synth。-c exec=yes が拒否されることも確認 |
| 41 | `vp run fargate:bundle && vp run fargate:bundle:check` | ローカル | 成功 | 2026-10-13 | server.mjs と job.mjs を node_modules の無い場所で起動。サーバーは SIGTERM で 0、ジョブは完走で 0、中断で 75 |
| 41 | `vp run fargate:simulate` | ローカル | 成功 | 2026-10-13 | この章のモデルを朝の負荷の曲線で実行。Application Auto Scaling ではない |
| 41 | `vp run fargate:size --cpu 180 --memory 410` | ローカル | 成功 | 2026-10-13 | 表と data/pricing の単価から 0.5 vCPU、1 GB、USD 17.99 と表示 |
| 41 | `vp run fargate:job:run --dry-run / fargate:exec --dry-run / fargate:image:push --dry-run` | ローカル | 成功 | 2026-10-13 | AWS CLI と docker のコマンドを表示するだけ。フラグは AWS CLI 2.35.11 の help と照合 |
| 41 | `vp run fargate:image:build f1` | ローカル | 未実行 | - | Docker のデーモンが無いため未実行。イメージは一度もビルドしていない |
| 41 | `vp run fargate:image:push f1` | AWS | 未実行 | - | 実行していない |
| 41 | `vp run fargate:infra:diff` | AWS | 未実行 | - | 実行していない |
| 41 | `vp run fargate:infra:deploy` | AWS | 未実行 | - | 実行していない |
| 41 | `vp run fargate:job:run` | AWS | 未実行 | - | 実行していない |
| 41 | `vp run fargate:exec` | AWS | 未実行 | - | 実行していない |
| 41 | `vp run fargate:infra:drift` | AWS | 未実行 | - | 実行していない |
| 41 | `vp run fargate:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 42 | `vp test run examples/42-firewall-manager` | ローカル | 成功 | 2026-10-13 | 7 ファイル 94 件。範囲の判定（include と exclude の map、子の OU、タグの AND と OR、あとから作られたリソース、タグで範囲から外れるリソース、クォータ）、セキュリティグループの監査のルールと CIDR の包含、テンプレートからのルールの読み取り、2 つのポリシーの managed service data、web ACL の関連付けのモデルと種を固定した 2,000 手の検査、finding のイベントと通知、料金の計算、2 つのスタックのアサーションとコンテキスト。モデルの判定を緩めると不変条件のテストが落ちることも確かめた |
| 42 | `tsc --noEmit -p examples/42-firewall-manager` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 42 | `vp run fwm:infra:synth:example` | ローカル | 成功 | 2026-10-13 | AWS のドキュメントが例に使うアカウント ID と、形だけ合わせた OU の ID で synth した。スタック 2 つ（AihFirewallManager はリソース 11、AihFirewallManagerEdge は 1）。コンテキストなしの `vp run fwm:infra:synth` が止まることも確かめた。合成された通知用の関数のバンドルを、テストランナーの外の Node.js で読み込んだ |
| 42 | `vp run fwm:cost` | ローカル | 成功 | 2026-10-13 | data/pricing の単価から、アカウント 5 つの組織の例を計算した。定価で月 USD 226.04。本文に載せた出力はこの実行のもの |
| 42 | `vp run fwm:audit:templates` | ローカル | 成功 | 2026-10-13 | その時点で cdk.out があった 46 個のテンプレートを読んだ。セキュリティグループ 7 つのうち、準拠 4、準拠していない 0、評価しないルールを含むもの 3。本文に載せた出力はこの実行のもの。ほかの章のファイルは変更していない |
| 42 | `vp run fwm:infra:deploy / fwm:edge:infra:deploy` | AWS | 未実行 | - | 組織を持っていないので実行していない。Firewall Manager の管理者アカウント、すべての機能を有効にした Organizations、各アカウントの AWS Config が前提 |
| 42 | `vp run fwm:infra:diff / fwm:infra:drift / fwm:edge:infra:drift` | AWS | 未実行 | - | デプロイしていないので実行していない。Cloud Control API 経由の AWS::FMS::Policy をドリフト検出がどこまで比べられるかは未確認 |
| 42 | `vp run fwm:edge:infra:destroy / fwm:infra:destroy` | AWS | 未実行 | - | デプロイしていないので実行していない。ポリシーを消したあとにメンバーアカウントに残るものは未確認 |
| 43 | `vp test run examples/43-glue` | ローカル | 成功 | 2026-10-13 | 62 件。仕様の関数（日付の境目、重複）、フォルダーの置き方と再計算できる日の範囲、job の run のモデル（再実行、途中での中断、bookmark を使う設計との比較）、DQDL の文字列とルールの評価、スクリプトに写した列とルール、料金の数量、Parquet から読み戻した行の比較、スタックのアサーション |
| 43 | `tsc --noEmit -p examples/43-glue` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 43 | `vp run glue:infra:synth` | ローカル | 成功 | 2026-10-13 | synth。-c schedule=on を付けた場合も |
| 43 | `vp run glue:spec` | ローカル | 成功 | 2026-10-13 | サンプルの raw ファイル 11 個から、2026-10-10 に 401 行、2026-10-11 に 400 行。7 つのルールがどちらの日も Passed |
| 43 | `vp run glue:contract` | ローカル | 成功 | 2026-10-13 | スクリプトの生成ブロックが最新であること |
| 43 | `python3 -c 'ast.parse(...)' glue/curate.py` | ローカル | 成功 | 2026-10-13 | 構文の検査だけ。Nix の shell には Python が無いので、手元の Python 3.12.2 で実行した。awsglue も pyspark も import していない |
| 43 | `vp check --fix (chapter 43's paths)` | ローカル | 成功 | 2026-10-13 | サンプル、本文、断片の整形と lint（awscdk-lint を含む） |
| 43 | `node book/theme/figure-cli.ts (chapter 43's pages)` | ローカル | 成功 | 2026-10-13 | 日英の図 4 つ |
| 43 | `vp run glue:infra:deploy` | AWS | 未実行 | - | スタックを作っていない |
| 43 | `vp run glue:seed` | AWS | 未実行 | - | サンプルをアップロードしていない |
| 43 | `vp run glue:run` | AWS | 未実行 | - | job を実行していない。Spark のスクリプトは一度も動いていない |
| 43 | `vp run glue:verify` | AWS | 未実行 | - | job の出力を仕様と比べていない |
| 43 | `vp run glue:infra:drift` | AWS | 未実行 | - | ドリフトの検査をしていない |
| 43 | `vp run glue:empty` | AWS | 未実行 | - | バケットを空にしていない |
| 43 | `vp run glue:infra:destroy` | AWS | 未実行 | - | スタックを消していない |
| 44 | `vp test run examples/44-health` | ローカル | 成功 | 2026-10-13 | 89 件。ドキュメントのサンプル 5 件の読み取り、時刻の解釈、ルールのパターンと fixture の照合、分類、台帳の判定、重複・順序の入れ替わり・終了・publish の失敗・途中での中断・同時実行の再現、通知の文面、スタックの assertion（パターンがテストと同じであること、最小権限、トピックが公開されていないこと、使うリソースの種類） |
| 44 | `tsc --noEmit -p examples/44-health` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 44 | `vp run health:replay` | ローカル | 成功 | 2026-10-13 | fixture 12 件を届いた順に流し、8 通の文面が出ること、重複と古い更新が捨てられること、2 ページ目と us-west-2 に届いた写しでは関数が呼ばれないことを確認 |
| 44 | `vp run health:infra:synth` | ローカル | 成功 | 2026-10-13 | AihHealth と AihHealthGlobal の 2 つのテンプレートが、AWS に問い合わせずに生成されること（esbuild のバンドル込み） |
| 44 | `vp run health:infra:deploy / health:global:infra:deploy` | AWS | 未実行 | - | デプロイしていない。ルールが実際の Health イベントに一致すること、関数、台帳、通知のメールは AWS では確かめていない |
| 45 | `vp test run examples/45-infrastructure-composer` | ローカル | 成功 | 2026-10-13 | 5 ファイル 46 件。たどる 4 つの形とたどらない形、Fn::Sub の属性・リテラル・対応表、パラメーターと擬似パラメーター、テンプレートに無い名前、省いた種類、Type の無い項目と Fn::ForEach の拒否、要約（数、参照されないリソース、鎖、輪）、2 つのテンプレートの比較、文字と図の出力、本文の図と CLI の出力の一致、cdk.out からの選択 |
| 45 | `tsc --noEmit -p examples/45-infrastructure-composer` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 45 | `vp run composer:graph` | ローカル | 成功 | 2026-10-13 | fixture のグラフを表示。本文に載せた出力はこの実行のもの。--figure の出力を本文の図に貼った |
| 45 | `vp run composer:graph:hello` | ローカル | 成功 | 2026-10-13 | hello:infra:synth のあと AihHello を表示。2 リソース、1 つながり |
| 45 | `vp run composer:graph:ship` | ローカル | 成功 | 2026-10-13 | ship:cfn:synth のあと AihShipApi を表示。18 リソース、29 つながり、いちばん長い鎖は 7 |
| 45 | `node scripts/graph.ts <リポジトリにあった cdk.out のテンプレート 50 個>` | ローカル | 成功 | 2026-10-13 | 50 個すべてを読めた。テンプレートに無い名前と輪は 0。ほかの章が書きかけの時点の数 |
| 45 | `node book/theme/figure-cli.ts (45章の 4 ページ)` | ローカル | 成功 | 2026-10-13 | 図 4 つ、問題 0 |
| 45 | `Infrastructure Composer (AWS Toolkit for Visual Studio Code) で cdk.out のテンプレートを開く` | AWS | 未実行 | - | VS Code の Infrastructure Composer を開いていない |
| 45 | `CloudFormation コンソールの template studio でテンプレートを開く` | AWS | 未実行 | - | コンソールを開いていない |
| 46 | `vp test run examples/46-shield` | ローカル | 成功 | 2026-10-13 | 6 ファイル 64 件。オリジンの検査（CDK が実際に出力したテンプレートと手書きの JSON の両方）、キャッシュのヘッダー、乱数の種を固定した洪水のシミュレーション（レートベースのルール、キャッシュ、ブレーキ）、料金の行とシナリオの一致、2 つのスタックのアサーション |
| 46 | `tsc --noEmit -p examples/46-shield` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 46 | `vp run shield:infra:synth` | ローカル | 成功 | 2026-10-13 | AihShield と AihShieldEdge の 2 つのテンプレートを cdk.out に書き出した（esbuild のバンドル込み）。AWS への問い合わせなし |
| 46 | `vp run shield:origins:gate` | ローカル | 成功 | 2026-10-13 | AihShield の function URL は closed |
| 46 | `node examples/46-shield/scripts/origins.ts` | ローカル | 成功 | 2026-10-13 | 手元にあった 56 個のテンプレートを読んだ（28 個のうち direct が 22、closed が 6）。shield:origins はこの前に infra:synth を実行するが、ここでは既にある cdk.out に対して直接実行した。ほかの章の synth が進むと数は変わる |
| 46 | `vp run shield:flood` | ローカル | 成功 | 2026-10-13 | 本文の表はこの出力 |
| 46 | `node -e import(cdk.out/asset.*/index.mjs) with a function URL event` | ローカル | 成功 | 2026-10-13 | synth が作ったバンドルを Node.js 25.8.1 で読み込み、function URL の形のイベントで /health と /notes を呼んだ。cache-control は public, max-age=5 と no-store |
| 46 | `vp run shield:infra:deploy` | AWS | 未実行 | - | 実行していない |
| 46 | `vp run shield:edge:infra:deploy` | AWS | 未実行 | - | 実行していない。web ACL は作った時点から月額がかかる |
| 46 | `vp run shield:edge:infra:deploy -c shieldAdvanced=on -c distributionArn=<arn>` | AWS | 未実行 | - | 実行していない。Shield Advanced を契約したアカウントが要る |
| 46 | `vp run shield:infra:drift` | AWS | 未実行 | - | 実行していない |
| 46 | `vp run shield:infra:destroy / shield:edge:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 47 | `vp test run examples/47-step-functions` | ローカル | 成功 | 2026-10-13 | テスト 66 件。手元の実行器（Retry の数え方と待ち時間、エラー名の一致、値のない式、Catch の出力、Assign の評価順、コールバックのトークン、Map）、取り込みの saga（各ステップの失敗と、応答だけが失われた場合、2 回走ったステップ、スキャンの拒否、Publish の先での失敗、補償処理の失敗と redrive、同じノート ID の 2 つの取り込み、わざと壊した定義 2 つ）、照会（公開前のノートを見せないこと、2 回走っても同じ答え）、TestState に送る表と実行器の一致、スタックのアサーション。相手はすべてメモリ上の代役で、Step Functions でも DynamoDB でも S3 でもない |
| 47 | `tsc --noEmit -p examples/47-step-functions` | ローカル | 成功 | 2026-10-13 | src、test、scripts、infra の型検査 |
| 47 | `vp run sfn:local` | ローカル | 成功 | 2026-10-13 | 既定、`--infected --refuse RemoveAttachment --times 4 --redrive`、`--lose CreateNote` の 3 通りを実行し、通ったステート、残ったもの、不変条件の判定が本文の出力と同じであることを確かめた |
| 47 | `vp run sfn:infra:synth` | ローカル | 成功 | 2026-10-13 | AihStepFunctions のテンプレートが、AWS に問い合わせずに生成されること |
| 47 | `vp run sfn:infra:deploy / sfn:start / sfn:callback / sfn:status / sfn:digest / sfn:empty / sfn:infra:destroy` | AWS | 未実行 | - | デプロイしていない。2 つのステートマシンは、AWS では一度も動かしていない |
| 47 | `vp run sfn:test-state` | AWS | 未実行 | - | TestState API を呼んでいない（認証情報が要る）。手元の実行器と本物の Step Functions が同じ答えを出すかどうかは、確かめていない |
| 48 | `vp test run examples/48-sdk` | ローカル | 成功 | 2026-10-13 | 11 ファイル 104 件。本物のクライアントを、ループバックの HTTP サーバーにつないで観察。既定値のテストは別のプロセスで、環境変数と ~/.aws を切り離して実行 |
| 48 | `tsc --noEmit -p examples/48-sdk` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 48 | `vp check examples/48-sdk (format and lint)` | ローカル | 成功 | 2026-10-13 | 整形と lint。警告なし |
| 48 | `vp run sdk:tour` | ローカル | 成功 | 2026-10-13 | 2 回スロットリングしてから答える台本に対して 1 回呼び、試行ごとのログを 3 行出力。本文の出力はこの実行のもの |
| 48 | `vp run sdk:defaults` | ローカル | 成功 | 2026-10-13 | 環境変数なしと AWS_NEW_RETRIES_2026=true の 2 通り。この端末の ~/.aws/config を読む。本文の出力はこの実行のもの |
| 48 | `AWS_ACCESS_KEY_ID=<not real> AWS_SECRET_ACCESS_KEY=<not real> vp run sdk:credentials` | ローカル | 成功 | 2026-10-13 | 偽のキーを環境変数に入れ、AWS_PROFILE を外して実行。fromEnv で止まり、AWS には届いていない |
| 48 | `node book/theme/figure-cli.ts (48-sdk pages)` | ローカル | 成功 | 2026-10-13 | 日英 4 つの図に問題なし |
| 48 | `vp run sdk:credentials (with this machine's real profile)` | AWS | 未実行 | - | 実行していない。プロファイルによっては STS、IAM Identity Center、サインインのトークン更新で AWS に届く |
| 48 | `any call to a real AWS endpoint with the pinned SDK` | AWS | 未実行 | - | 実行していない。この章の観察はすべて手元のサーバーに対するもの |
| 49 | `vp test run examples/49-athena` | ローカル | 成功 | 2026-10-13 | 70 件。文の本文が利用者の値で変わらないこと、パラメーターの引用、DDL と MERGE に入れる値の検査、開始の重複・待ちの上限・取り消し・ページ送りを自作の API の代役で、読む量と料金の計算、ログのテーブル定義の穴埋め、スタックのアサーション。SQL は 1 つも実行していない |
| 49 | `tsc --noEmit -p examples/49-athena` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 49 | `vp run athena:infra:synth` | ローカル | 成功 | 2026-10-13 | synth。-c lakeBucketName=<名前> を付けた場合も。AWS には問い合わせない |
| 49 | `vp run athena:sql / vp run athena:logs:ddl` | ローカル | 成功 | 2026-10-13 | 10 個の文と 4 種類のログのテーブル定義を出力。文字列を出すだけで、何も実行しない |
| 49 | `vp run athena:infra:deploy` | AWS | 未実行 | - | 未実行。ワークグループ、保存したクエリ、ロール、バケットのどれも実際には作っていない |
| 49 | `vp run athena:run` | AWS | 未実行 | - | 未実行。この章の SQL を Athena が受け付けるかは確かめていない |
| 49 | `vp run athena:infra:drift` | AWS | 未実行 | - | 未実行 |
| 49 | `vp run athena:empty / athena:infra:destroy` | AWS | 未実行 | - | 未実行 |
| 50 | `vp test run examples/50-agentcore` | ローカル | 成功 | 2026-10-13 | 8 ファイル、51 件。HTTP の約束（/ping と /invocations）、文字列でないプロンプトや余分なキーの拒否、転送されたトークンからの利用者の読み取り（署名を検査しないことの固定を含む）、ほかの利用者のセッション ID の拒否（同じプロセスでも入れ替わったプロセスでも）、ノートの指示に従うモデルに対する不変条件、記憶の畳み込み（重複、欠け、順不同）、ストアが書き込みを断ったとき・同時に終わったとき・プロセスが入れ替わったときの一致、Memory のイベントとの対応、スタックのアサーション |
| 50 | `tsc --noEmit -p examples/50-agentcore` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 50 | `vp run agentcore:infra:synth` | ローカル | 成功 | 2026-10-13 | リソース 7 個、出力 7 個。esbuild が src/server.ts を app.js にまとめ、ZIP のアセットになる。AWS への問い合わせなし |
| 50 | `vp run agentcore:bundle:check` | ローカル | 成功 | 2026-10-13 | app.js（1,750.8 KiB）を package.json の無いディレクトリで Node.js 24 から起動。GET /ping が 200 Healthy、トークンの無い POST /invocations が 401。Runtime の Node.js 22 では動かしていない |
| 50 | `node src/dev.ts (vp run dev:agentcore) + curl` | ローカル | 成功 | 2026-10-13 | 36章の台本 tool-then-answer で /invocations が server-sent events を返すこと、Bob のトークンと Alice のセッション ID が 403、owner を足したボディが 400 になることを curl で確認 |
| 50 | `vp check --fix (chapter 50 paths)` | ローカル | 成功 | 2026-10-13 | フォーマットと lint（awscdk-lint を含む）。警告なし |
| 50 | `node book/theme/figure-cli.ts (chapter 50 pages)` | ローカル | 成功 | 2026-10-13 | 図 4 つ（日英 2 つずつ）、問題なし |
| 50 | `vp run agentcore:infra:deploy` | AWS | 未実行 | - | デプロイしていない |
| 50 | `vp run agentcore:invoke` | AWS | 未実行 | - | 実行していない（料金がかかる） |
| 50 | `vp run agentcore:infra:drift` | AWS | 未実行 | - | 実行していない |
| 50 | `vp run agentcore:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 51 | `vp test run examples/51-chime-sdk` | ローカル | 成功 | 2026-10-13 | 69 件。誰に join token が渡るか（未サインイン、部屋のメンバーでない人、持ち主だけの操作）、席の順序（同時の最初の参加、2 つのタブからの参加、参加の途中での除外と閉鎖、ミーティングの自然終了、Chime の失敗）、メモリー上のテーブルの条件、DynamoDB と Chime への呼び出しの形、ページの判断、スタックのアサーション（最小権限、公開ルートが /health だけ、使うリソースの種類）。席の処理を 6 通りに壊して、テストが落ちることも確認 |
| 51 | `tsc --noEmit -p examples/51-chime-sdk / vp run typecheck:calls:web / lint:calls:web` | ローカル | 成功 | 2026-10-13 | サンプル全体と、Vize によるページの型検査、テンプレートの lint |
| 51 | `vp run calls:infra:synth` | ローカル | 成功 | 2026-10-13 | esbuild のバンドル込みでテンプレートを生成（リソース 40、出力 8）。AWS には問い合わせない。できたバンドルを Node.js で読み込めることも確認 |
| 51 | `vp run build:calls:web` | ローカル | 成功 | 2026-10-13 | ページのビルド。amazon-chime-sdk-js を含むチャンクは 1,325.59 kB（gzip 294.80 kB）で、参加時にだけ読み込まれる |
| 51 | `node --env-file=.env.example api/src/dev.ts と vp dev --port 5193（dev:calls:api、dev:calls:web と同じコマンド）` | ローカル | 成功 | 2026-10-13 | 開発用の API に curl で、部屋の作成、メンバーでない人の 404、トークンなしの 401、追加、参加、退出、閉鎖を実行。ブラウザーで、サインイン、部屋の作成、参加、退出、閉鎖が画面に反映されることと、session.ts（amazon-chime-sdk-js）が読み込めることを確認。5173 番が使用中だったので 5193 番で起動 |
| 51 | `vp run calls:infra:diff / deploy / drift / destroy, calls:user:create, calls:config, preview:calls:web, calls:end` | AWS | 未実行 | - | ユーザープール、テーブル、関数、HTTP API を作り、Chime SDK のミーティングで通話する。実際の通話は AWS が無いと確かめられない |
| 52 | `vp test run examples/52-ecr` | ローカル | 成功 | 2026-10-13 | 60 件。参照の読み書き、ワイルドカード、タグの設定の 4 つの値、タグが動いたときの 2 つの壊れ方と 2 つの直し方（リポジトリのモデルの上で）、ドキュメントの 6 つの例の再現、この章のポリシー、スキーマが拒否するポリシー、デプロイの判定、describe-images の読み取り、preview との突き合わせ、スタックの assertion（テンプレートのライフサイクルポリシーがテストのものと同じであること、プッシュ用のロールの信頼ポリシーと許可した操作の一覧、消す操作と設定を変える操作が無いこと、使うリソースの種類） |
| 52 | `tsc --noEmit -p examples/52-ecr` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 52 | `vp run ecr:lifecycle:preview` | ローカル | 成功 | 2026-10-13 | fixture の 46 個のイメージに対して、ルール 1 が 2 個、ルール 2 が 1 個、ルール 3 が 8 個を消し、35 個が残ると表示されること。この章の evaluator の出力で、ECR の preview ではない |
| 52 | `vp run ecr:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成（リポジトリだけ）と、-c githubRepository=example/notes -c pullThroughCache=on を渡した構成のテンプレートが、AWS に問い合わせずに生成されること |
| 52 | `vp run ecr:infra:deploy` | AWS | 未実行 | - | デプロイしていない。リポジトリ、プッシュ用のロール、pull through cache のルールは AWS では作っていない |
| 52 | `docker build / docker push` | ローカル | 未実行 | - | Nix の shell には Docker のデーモンが無い。イメージは 1 つもビルドもプッシュもしていない |
| 52 | `vp run ecr:lifecycle:compare` | AWS | 未実行 | - | ECR の lifecycle policy preview を実行していない。evaluator と ECR の結果を比べていない |
| 52 | `vp run ecr:scan:gate` | AWS | 未実行 | - | 実際の検査結果を読んでいない |
| 53 | `vp test run examples/53-efs` | ローカル | 成功 | 2026-10-13 | 53 件。ノートを 1 件 1 ファイルで置くリポジトリを、書き込みの各段階で中断するテスト。実際のファイルシステム（macOS、APFS）の上で、その場での上書きが半分の内容を見せること、rename による置き換えではどの段階でも古い内容か新しい内容だけが見えること、23章のリポジトリを 2 つ開くと確認済みのノートが消えること、追記のモデル。04章の API を載せたテスト、パスを抜け出す ID の拒否、スタックの assertion |
| 53 | `tsc --noEmit -p examples/53-efs` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 53 | `vp run efs:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成と `-c dataOnDestroy=retain -c backup=true` で、AWS に問い合わせずにテンプレートを生成した（esbuild のバンドル込み） |
| 53 | `vp run dev:efs (two processes, one directory)` | ローカル | 成功 | 2026-10-13 | 同じディレクトリを指す 2 つのサーバーを別のポートで起動し、片方に POST したノートがもう片方の一覧に出ること、`/notes/..%2F..%2Fetc%2Fpasswd` が 404 になることを curl で確かめた |
| 53 | `vp run efs:infra:deploy / efs:infra:drift / efs:infra:destroy` | AWS | 未実行 | - | AWS では何も実行していない |
| 54 | `vp test run examples/54-kinesis` | ローカル | 成功 | 2026-10-13 | 7 ファイル、76 件。partition key から shard への割り当て（MD5）、shard の中の順序、2 つの読み手が同じレコードを読むこと、位置を指定した読み直し、保持期間、shard ごとの書き込み上限と hot key、shard の split、PutRecords の部分的な失敗で順序が入れ替わることとその対策、応答を失った書き込みの重複、ハンドラーの適用と poison record の報告、失敗した batch の再配送で二重に数えないこと、poison record が shard を止めることと設定ごとの違い、partial batch response を返しても mapping が聞いていなければ読み飛ばされること、親より先に子の shard を読んだときの欠け、あとから足したコンシューマーの読み直し、DynamoDB と Kinesis へのリクエストの形、ドキュメントの例にある失敗の記録の読み取り、スタックの assertion。相手はメモリ上の stream と event source mapping のモデルで、Kinesis でも Lambda でもない。条件を 6 か所わざと壊して、テストがそれぞれ 4 件、5 件、7 件、8 件、3 件、1 件落ちることも確かめた |
| 54 | `vp run kinesis:demo` | ローカル | 成功 | 2026-10-13 | メモリ上の stream で 4 つの場面を流し、出力を読んだ。応答を失った batch の再配送で、版を比べるコンシューマーは 5 件のまま、比べないコンシューマーは 10 件になる。poison record は、Lambda の既定値では 500 回試しても後ろの b が適用されず、スタックの設定では 1 件だけが諦められて b は 2 件適用される。PutRecords で 1 件目だけ断られると、断られたぶんを送り直す書き方では版 2 に対してリビジョン 1 件、ノートごとに 1 件ずつ送る書き方では 2 件。1 時間あとに足したコンシューマーは、最初のコンシューマーと同じ履歴になる |
| 54 | `vp run kinesis:infra:synth / tsc --noEmit -p examples/54-kinesis` | ローカル | 成功 | 2026-10-13 | テンプレートは AWS に問い合わせずに生成された（関数のバンドル込み）。リソースは 12 種類で、どれも cdkd 0.296.28 が専用の実装を持つ。Custom:: のリソースはない。scripts/ は型検査のみ |
| 54 | `vp check --fix (examples/54-kinesis, the chapter's pages, data/fragments/54.json)` | ローカル | 成功 | 2026-10-13 | 自分のファイルだけにかけた。awscdk-lint を含めて警告なし |
| 54 | `vp run kinesis:infra:diff / kinesis:infra:deploy / kinesis:put / kinesis:history / kinesis:replay / kinesis:failures / kinesis:infra:drift / kinesis:infra:destroy` | AWS | 未実行 | - | AWS に対しては何も実行していない |
| 55 | `vp test run examples/55-grafana` | ローカル | 成功 | 2026-10-13 | 定義が 19章のテンプレートのダッシュボードと完全に一致すること、ずれたダッシュボードを断ること、生成した Grafana の JSON がこの章のスキーマを通り 19章と同じメトリクスだけを読むこと、スキーマが壊れた入力を断ること、Grafana の HTTP API の呼び出し（偽の fetch）、トークンの送り先、料金計算の入力、スタックの assertion |
| 55 | `tsc --noEmit -p examples/55-grafana` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 55 | `vp run grafana:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定（ロールだけ）と、-c authentication=AWS_SSO を付けた場合の synth。AWS には問い合わせない |
| 55 | `vp run grafana:render` | ローカル | 成功 | 2026-10-13 | Grafana のダッシュボード JSON と、--cloudwatch での CloudWatch のボディを出力 |
| 55 | `aws grafana <command> help` | ローカル | 成功 | 2026-10-13 | AWS CLI 2.35.11 のヘルプで、scripts/push.ts が使うコマンドと引数の名前を確認。AWS は呼んでいない |
| 55 | `vp run grafana:infra:deploy -c authentication=AWS_SSO` | AWS | 未実行 | - | ワークスペースの作成。月額の課金が始まる |
| 55 | `vp run grafana:push` | AWS | 未実行 | - | 19章のダッシュボードを読み、トークンを発行し、データソースとダッシュボードを反映し、トークンを消す |
| 55 | `vp run grafana:infra:destroy` | AWS | 未実行 | - | ワークスペースとロールの削除 |
| 56 | `vp test run examples/56-nova` | ローカル | 成功 | 2026-10-13 | 98 件。一覧と終了したモデルの扱い、料金の計算、リクエストの組み立てと上限、説明文を作る処理（同時のリクエスト、リースを超えた実行、止まった実行の引き継ぎ、失敗、切れた答え、ほかの利用者）、アプリ、S3 に送るリクエストの形、CDK の assertion |
| 56 | `tsc --noEmit -p examples/56-nova` | ローカル | 成功 | 2026-10-13 | src、test、infra、scripts を含む |
| 56 | `vp run nova:infra:synth` | ローカル | 成功 | 2026-10-13 | esbuild による bundle（Docker なし）を含む。7 リソース、出力 4 つ |
| 56 | `vp run nova:catalog` | ローカル | 成功 | 2026-10-13 | カタログを今日の日付と照らして表示する。AWS は呼ばない |
| 56 | `vp run dev:nova (NOVA_BACKEND=scripted)` | ローカル | 成功 | 2026-10-13 | curl で PUT を 2 つ重ねて 202 と 200 を確かめ、3 回目の PUT が reused: true を返すこと、ログの billed を確かめた。終了したモデルの ID では起動しないことも確かめた |
| 56 | `vp run nova:models` | AWS | 未実行 | - | アカウントに ListFoundationModels と ListInferenceProfiles を問い合わせる。認証情報が要る |
| 56 | `vp run nova:hello` | AWS | 未実行 | - | 実際のモデルに画像を 1 枚渡す。課金される |
| 56 | `vp run nova:infra:deploy` | AWS | 未実行 | - | スタックをデプロイする |
| 56 | `vp run nova:smoke` | AWS | 未実行 | - | デプロイした function URL を通して 1 枚を説明させる。課金される |
| 56 | `vp run nova:empty / nova:infra:destroy` | AWS | 未実行 | - | バケットを空にしてスタックを消す |
| 57 | `vp test run examples/57-polly` | ローカル | 成功 | 2026-10-13 | 72 件。SSML のエスケープとタグの混入、長いノートの分割、キャッシュのキー、同時に届いた 2 件と 10 件・合成の失敗・印を置いたままの停止・古い印の同時の引き継ぎの再現、ルートと入力の検査、ログにノートの文章が出ないこと、再生の順序、S3 と Polly へのリクエストの形、スタックの assertion（最小権限、バケットが公開されていないこと、ライフサイクルルール、タイムアウトと印の期限の大小、使うリソースの種類） |
| 57 | `tsc --noEmit -p examples/57-polly` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 57 | `vp run polly:infra:synth` | ローカル | 成功 | 2026-10-13 | AihPolly のテンプレートが、AWS に問い合わせずに生成される（esbuild のバンドル込み） |
| 57 | `SPEECH_BACKEND=fake node src/dev.ts (examples/57-polly) と curl` | ローカル | 成功 | 2026-10-13 | POST /speech が 2 つの部分の URL を返し、同じノートの 2 回目は billedCharacters が 0 で source が cache になること、URL から WAV（RIFF）が返ること、一覧に無い声が 400 になることを確認 |
| 57 | `vp check --fix (examples/57-polly and the chapter's pages)` | ローカル | 成功 | 2026-10-13 | 自分のファイルだけにかけ、awscdk-lint を含めて警告が出ないことを確認 |
| 57 | `vp run polly:infra:deploy` | AWS | 未実行 | - | デプロイしていない |
| 57 | `vp run polly:listen` | AWS | 未実行 | - | 実行していない。Polly を 1 回も呼んでいない。課金される（1 回およそ 70 文字） |
| 57 | `vp run polly:empty --yes` | AWS | 未実行 | - | 実行していない |
| 57 | `vp run polly:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 58 | `vp test run examples/58-ledger` | ローカル | 成功 | 2026-10-13 | 83 件が通り、1 件（DynamoDB Local 用）はスキップ。ハッシュの固定値、行の読み戻し、追記の番号の取り合いと応答の喪失、ジャーナルの規則（メモリ上のモデル）、ダイジェストの作成と拒否、過去の記録の変更・削除・入れ替え・末尾の切り落としの検出、ダイジェストへの攻撃、Object Lock のモデル、DynamoDB と S3 へのリクエストの形、関数、片付けの計画、スタックのアサーション |
| 58 | `tsc --noEmit -p examples/58-ledger` | ローカル | 成功 | 2026-10-13 | 型検査。エラーなし |
| 58 | `vp run ledger:demo` | ローカル | 成功 | 2026-10-13 | メモリ上で、追記、ダイジェスト、履歴の書き換え、監査を実行。本文の出力はこの実行のもの |
| 58 | `vp run ledger:db:reset:local && vp run ledger:test:local (DynamoDB Local 3.3.1)` | ローカル | 成功 | 2026-10-13 | ジャーナルの規則 5 件を PartiQL の INSERT と条件付きの PutItem の両方で、加えて追記からダイジェスト、監査までの 1 件を、DynamoDB Local 3.3.1 に対して実行した（11 件）。Docker ではなく、AWS が配布する jar を Java 21 で直接起動し（ポート 8058、-inMemory -sharedDb -disableTelemetry）、タスクには環境変数 `DYNAMODB_ENDPOINT=http://localhost:8058` を渡した。重複した INSERT への応答の名前は `DuplicateItem` だった。ダイジェストの保存先はメモリ上のモデル |
| 58 | `vp run ledger:infra:synth` | ローカル | 成功 | 2026-10-13 | テンプレートを生成。リソース 12 個、AWS SDK を含む関数のバンドル込み。AWS には問い合わせない |
| 58 | `vp run ledger:infra:deploy` | AWS | 未実行 | - | デプロイしていない |
| 58 | `vp run ledger:append / ledger:digest / ledger:verify` | AWS | 未実行 | - | 実行していない |
| 58 | `vp run ledger:infra:destroy / ledger:purge` | AWS | 未実行 | - | 実行していない |
| 59 | `vp test run examples/59-rds` | ローカル | 成功 | 2026-10-13 | 48 件。LSN の解析と比較、PGlite が返す実際の位置、プライマリとレプリカのモデルの上での read-your-writes と読み取りが巻き戻らないこと、遅れたレプリカの昇格で書き込みが失われること、API のヘッダーと CORS、運用用の関数（ロールの作成、13章のマイグレーション、notes_api の権限、冪等性、入力の検査）、設定と環境変数、スタックのアサーション 15 件（3 通りの synth） |
| 59 | `tsc --noEmit -p examples/59-rds` | ローカル | 成功 | 2026-10-13 | src、infra、test、scripts の型検査 |
| 59 | `vp run rds:infra:synth` | ローカル | 成功 | 2026-10-13 | テンプレート（リソース 32、出力 8）と 2 つのバンドルを cdk.out に出力。AWS には問い合わせない。2 つのバンドルを Node.js 24.21.0 で読み込み、API の関数が GET /health に 200 を返すことと、運用用の関数が知らないコマンドを接続の前に断ることを確かめた |
| 59 | `vp run dev:rds + curl` | ローカル | 成功 | 2026-10-13 | REPLICA_LAG_MS=1500 で起動し、作成、ヘッダーなしの読み取り（レプリカから 404）、x-notes-seen つきの読み取り（プライマリから 200）、2 秒後のヘッダーなしの読み取り（レプリカから 200）、/health を確かめた |
| 59 | `vp run rds:infra:deploy` | AWS | 未実行 | - | RDS のインスタンス、パラメーターグループ、サブネットグループ、セキュリティグループ、関数 2 つ、HTTP API、アラームを作る。時間課金 |
| 59 | `vp run rds:db:bootstrap` | AWS | 未実行 | - | マスターユーザーのシークレットを読み、運用用の関数を呼んで 2 つのデータベースロールを作る |
| 59 | `vp run rds:db:migrate` | AWS | 未実行 | - | 13章のマイグレーションを運用用の関数に渡して流す |
| 59 | `vp run rds:db:status` | AWS | 未実行 | - | 接続しているロール、PostgreSQL の版、TLS かどうかを表示する |
| 59 | `vp run rds:smoke` | AWS | 未実行 | - | API を通して作成、読み戻し、削除 |
| 59 | `vp run rds:infra:drift` | AWS | 未実行 | - | cdkd の state と実物を比べる |
| 59 | `vp run rds:infra:destroy` | AWS | 未実行 | - | スタックを消す。インスタンスと自動バックアップも消える |
| 60 | `vp test run examples/60-aurora` | ローカル | 成功 | 2026-10-13 | PGlite の上で、追記の 5 つの文それぞれの前と後で接続を落とし、どの場合も 1 回だけ適用されること。キーのない再試行が 2 回適用すること。キーの持ち主ごとの分離、記録の掃除。SQLSTATE の分類。Data API の adapter（パラメーターと行の変換、例外の仕分け、PGlite で作った代役のサービスに対する commit の応答の喪失）。Standard と I/O-Optimized の損益分岐。スタックのアサーション。5 ファイル 54 件 |
| 60 | `tsc --noEmit -p examples/60-aurora` | ローカル | 成功 | 2026-10-13 | src、infra、test、scripts の型検査。node-postgres の adapter（src/pg.ts）と scripts/cloud.ts は、型検査だけで、実行していない |
| 60 | `vp run aurora:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成のテンプレートを cdk.out に書き出した。AWS には問い合わせない |
| 60 | `vp run aurora:infra:deploy / aurora:db:schema / aurora:smoke / aurora:infra:drift / aurora:infra:destroy` | AWS | 未実行 | - | クラスターを作っていない。Data API も、auto-pause も、フェイルオーバーも、実物では見ていない |
| 61 | `vp test run examples/61-sqs` | ローカル | 成功 | 2026-10-13 | 8 ファイル、75 件。キューの模型の決まり（必須の ID、5 分の重複排除、グループの順序と、受け取られたままのグループから返さないこと、receipt handle、可視性タイムアウトの延長と 12 時間の限度、DLQ への移動と同じバッチの巻き添え、redrive）、ワーカーと台帳の不変条件（5 分後の送り直し、可視性タイムアウトを過ぎたワーカーとの競争、バッチの途中の失敗、読めないメッセージをよけること、長い障害の後の redrive）、バッチの組み立て、大きなメッセージ、料金の数え方、DynamoDB と SQS へのリクエストの形、インフラのアサーション。相手はメモリ上の模型で、SQS ではない。コードを 4 か所わざと壊して、テストがそれぞれ 3 件、4 件、2 件、3 件落ちることも確かめた |
| 61 | `vp run sqs:demo` | ローカル | 成功 | 2026-10-13 | 模型のキューとデプロイするワーカーのコードで、すぐの送り直し、5 分後の送り直し、可視性タイムアウトを過ぎたワーカー、読めないメッセージを順に流し、目印を覚える台帳が 3 行、覚えない台帳が 5 行で終わること、読めないメッセージがどちらでも DLQ に入ることを出力で確認 |
| 61 | `vp run sqs:infra:synth / tsc --noEmit -p examples/61-sqs` | ローカル | 成功 | 2026-10-13 | リソースの種類は 9 つ（SQS::Queue、SQS::QueuePolicy、Lambda::Function、Lambda::EventSourceMapping、DynamoDB::Table、CloudWatch::Alarm、Logs::LogGroup、IAM::Role、IAM::Policy）で、どれも cdkd 0.296.28 に専用の実装がある。Custom:: のリソースはない。scripts/ は型検査のみ |
| 61 | `vp run sqs:infra:diff / sqs:infra:deploy / sqs:send / sqs:status / sqs:infra:drift / sqs:infra:destroy` | AWS | 未実行 | - | AWS に対しては何も実行していない |
| 62 | `vp test run examples/62-ci-runners` | ローカル | 成功 | 2026-10-13 | 9 ファイル 95 件。署名（GitHub のドキュメントの検算用の値を含む）、判定、受信の処理（偽の署名、フォーク、重複と同時の配送、起動の失敗と再送、途中で止まった受信）、GitHub の API に送るリクエスト（fetch は代役）、RunTask の入力、見回り、設定、ワークフロー、料金、スタックのアサーション |
| 62 | `tsc --noEmit -p examples/62-ci-runners` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 62 | `vp run runners:infra:synth` | ローカル | 成功 | 2026-10-13 | コンテキストなしと、-c repositories=example-org/notes -c appClientId=Iv23example つきで synth。-c repositories='example-org/*' が拒否されることも確認 |
| 62 | `vp run runners:decide` | ローカル | 成功 | 2026-10-13 | 手書きの配送 7 件を本物の受信処理に通した。GitHub、ECS、DynamoDB は代役 |
| 62 | `vp run runners:infra:deploy` | AWS | 未実行 | - | AWS に対しては何も実行していない |
| 62 | `GitHub App の作成、webhook の配送、ジョブの実行` | AWS | 未実行 | - | GitHub App は作っていない。GitHub の API は認証つきでは一度も呼んでいない。ランナーは登録しておらず、ジョブは 1 件も動かしていない |
| 63 | `vp test run examples/63-agent-sandbox` | ローカル | 成功 | 2026-10-13 | 12 ファイル 103 件。ランチャーの判断、許可リストの評価、上限とリーパー、GitHub App の JWT とトークンの検査、エージェントのコマンドと設定と環境変数、タスクの手順（偽のコマンド実行で）、ポリシーの評価器、コマンドの組み立て、料金、スタックのアサーション |
| 63 | `tsc --noEmit -p examples/63-agent-sandbox` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 63 | `vp run sandbox:infra:synth` | ローカル | 成功 | 2026-10-13 | タグなし、-c imageTag=a1 -c repositories=acme/notes、それに -c modelEndpoint=true、-c exec=true を足した構成で synth。-c exec=yes と -c model=jp.amazon.nova-2-lite-v1:0 が拒否されることも確認 |
| 63 | `vp run sandbox:plan / sandbox:policy / sandbox:bundle` | ローカル | 成功 | 2026-10-13 | 判断と RunTask の入力、エージェントのコマンドと設定、Network Firewall のルールの出力。各ロールのステートメントと、エージェントのロールへの問い合わせの出力。dist/entry.mjs と dist/settings.json の生成 |
| 63 | `node scripts/ops.ts <image-build\|image-push\|launch\|logs\|exec> --dry-run` | ローカル | 成功 | 2026-10-13 | コマンドの表示だけ。docker も aws も呼んでいない |
| 63 | `vp run sandbox:image:build / sandbox:image:push` | AWS | 未実行 | - | Docker のデーモンが無く、イメージは一度もビルドしていない |
| 63 | `vp run sandbox:infra:deploy / sandbox:launch / sandbox:infra:destroy` | AWS | 未実行 | - | AWS には何も作っていない。エージェントは一度も起動しておらず、モデルも呼んでいない |
| 64 | `vp test run examples/64-isolates` | ローカル | 成功 | 2026-10-13 | 5 ファイル、45 件。そのうち test/workerd.test.ts は、npm で入れた workerd 1.20261012.1（darwin-arm64）の実物を Nix の devShell の中で起動する。04章のアプリがコントラクトどおりに答えること、同じコードの worker 2 つが 1 つのプロセスの中で状態を共有しないこと、処理中の 2 つのリクエストでモジュールスコープのリクエスト ID が入れ替わり AsyncLocalStorage では入れ替わらないこと、binding が環境変数から届くこと。ほかに、設定の検証と描画、アダプター、料金、スタックのアサーション |
| 64 | `tsc --noEmit -p examples/64-isolates` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 64 | `vp run isolates:bundle` | ローカル | 成功 | 2026-10-13 | notes.mjs、scoped.mjs、spin.mjs と、イメージ用の config.capnp を dist/ に書いた |
| 64 | `vp run dev:isolates` | ローカル | 成功 | 2026-10-13 | 手元の workerd で 04章のアプリを起動し、curl で /health、POST /notes、GET /notes を呼んだ |
| 64 | `vp run isolates:observe` | ローカル | 成功 | 2026-10-13 | macOS（arm64）の workerd で 4 つの観察を実行した。2000 ms の CPU ループは打ち切られず、同じプロセスの別の worker の /health は 1807 ms 待たされた。SIGTERM のとき、処理中のリクエストには 201 を返してから終了コード 0 で終了し、その間に来た新しいリクエストには答えなかった。処理中のものが無ければ 2 ms で終了した |
| 64 | `vp run isolates:fetch` | ローカル | 成功 | 2026-10-13 | Linux arm64 用の配布物（39,889,339 バイト）を npm のレジストリから取得し、固定した SHA-512 と一致することを確かめて、バイナリを展開した。バイナリは実行していない |
| 64 | `vp run isolates:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定（リポジトリだけ）と、`-c imageTag=v1`、`-c imageTag=v1 -c taskSubnets=private` で synth した。AWS には問い合わせない |
| 64 | `vp run isolates:image:build v1 --dry-run` | ローカル | 成功 | 2026-10-13 | docker のコマンドを表示するだけで、実行しない。`isolates:image:push v1 --dry-run` も同じ |
| 64 | `vp run isolates:image:build <tag>` | ローカル | 未実行 | - | 未実行。Nix のシェルに Docker のデーモンが無い。イメージは一度もビルドしていない |
| 64 | `vp run isolates:image:push <tag>` | AWS | 未実行 | - | 未実行 |
| 64 | `vp run isolates:infra:diff -c imageTag=<tag>` | AWS | 未実行 | - | 未実行 |
| 64 | `vp run isolates:infra:deploy -c imageTag=<tag>` | AWS | 未実行 | - | 未実行 |
| 64 | `vp run isolates:smoke` | AWS | 未実行 | - | 未実行 |
| 64 | `vp run isolates:infra:drift` | AWS | 未実行 | - | 未実行 |
| 64 | `vp run isolates:infra:destroy` | AWS | 未実行 | - | 未実行 |
| 66 | `vp test run examples/66-distributed-sql` | ローカル | 成功 | 2026-10-13 | フラグファイルの生成と検査、接続先の切り替え、過半数のモデル（1 ノードの喪失を全通り、2 ノードの喪失、非同期の複製で失われる書き込み）、PGlite の上で 13章の再試行ループに YugabyteDB のエラーを渡した結果、ノードに置くファイル、証明書の引数、料金、スタックのアサーション。7 ファイル 73 件 |
| 66 | `tsc --noEmit -p examples/66-distributed-sql` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 66 | `vp run distsql:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の設定（ノードなし、リソース 10 個）と `-c nodes=3`（19 個）で synth。AWS には問い合わせない |
| 66 | `vp run distsql:render` | ローカル | 成功 | 2026-10-13 | deploy/ のファイルが、生成したものと一致する |
| 66 | `vp run distsql:fetch` | ローカル | 成功 | 2026-10-13 | macOS 26.6（arm64）で、yugabyte-2025.2.7.0-b107-darwin-arm64.tar.gz（130,180,590 バイト）を software.yugabyte.com から取得。SHA-256 が、隣に公開されている .sha の値（4a6a23f6…edde49）と一致した。.yugabyte/ に展開 |
| 66 | `vp run distsql:local:start, then vp run distsql:local:verify (no TLS, 2 runs)` | ローカル | 成功 | 2026-10-13 | 127.0.0.1 の上で yb-master と yb-tserver を 3 組起動（PostgreSQL 15.12-YB-2025.2.7.0-b0）。13章のマイグレーション 4 つと repository を変えずに実行。上限 3 件に 12 件の作成を 3 ノードから同時に送り、2 回とも作成 3、quota_exceeded 9、note_count と行数が 3 で一致。40001 による再試行は 16 回と 4 回。ノード b を SIGKILL した後も a と c が確認済みの 40 件をすべて返し、続く 20 件の作成は 1.1 秒と 0.9 秒で終わった。b と c を落とすと残る 1 ノードは書き込みを確認せず（20 秒の無応答、接続のタイムアウト）、戻すと確認済みの 40 件がすべて残っていた。確認されなかった 1 件は、1 回目は入っていて、2 回目は入っていなかった。2 回目は ysql_dump の出力を別のデータベースに流し込み、40 件が揃った |
| 66 | `vp run distsql:local:certs, vp run distsql:local:start --tls, then vp run distsql:local:verify (TLS, 5 runs, 1 failed)` | ローカル | 成功 | 2026-10-13 | openssl（Homebrew の 3.6.1。Nix の shell には入っていない）で CA と 127.0.0.1 の証明書を作り、TLS とパスワード認証を有効にして同じ検証を 5 回実行。TLS なしのクライアントは断られた。40001 による再試行は 12、12、12、26、29 回。b を失った後の 20 件は 1.1 秒から 4.3 秒。2 ノードを失ったときの 1 件は確認されず、戻した後に入っていたのは 5 回のうち 2 回。3 回目の実行は、2 ノードを戻した直後の CREATE DATABASE が『current transaction is expired or aborted』で失敗し、検証が失敗で終わった。バックアップの段に再試行を入れた後の 2 回は通った。ysql_dump の出力は 4 回、別のデータベースに揃って入った。yb-admin は --certs_dir_name を付けると list_all_masters と modify_placement_info に応え、付けないと 60 秒でリーダーを見つけられずに終わった。検証の後、distsql:local:destroy で全プロセスを止めた |
| 66 | `vp run distsql:fetch --nodes` | ローカル | 未実行 | - | ノード用のアーカイブ（el8-aarch64、479,462,171 バイト）は取得していない。SHA-256 は公開されている .sha の値を写しただけ |
| 66 | `vp run distsql:infra:deploy -c nodes=3` | AWS | 未実行 | - | AWS には何も作っていない |
| 66 | `vp run distsql:artifact / distsql:install / distsql:certs / distsql:configure / distsql:start / distsql:status / distsql:health / distsql:logs / distsql:stop / distsql:session` | AWS | 未実行 | - | ノードに触るタスクは実行していない |
| 66 | `vp run distsql:infra:destroy` | AWS | 未実行 | - | 実行していない |
| 67 | `vp test run examples/67-firecracker` | ローカル | 成功 | 2026-10-13 | 5 ファイル 67 件。仕様との照合、設定の検証、リクエストの順序、Unix ドメインソケット越しのクライアント、設定を断られたときに起動しないこと、InstanceStart の応答の喪失、スナップショットの前提、起動時間の測り方、スタックのアサーション |
| 67 | `tsc --noEmit -p examples/67-firecracker` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 67 | `vp run firecracker:plan` | ローカル | 成功 | 2026-10-13 | 起動の 5 つのリクエストを curl の形で表示。本文に載せた出力はこの実行のもの |
| 67 | `vp run firecracker:spec` | ローカル | 成功 | 2026-10-13 | GitHub から v1.17.0 の仕様を取得し、SHA-256 を確かめ、切り出した結果がリポジトリの JSON と一致 |
| 67 | `vp run firecracker:kit:build` | ローカル | 成功 | 2026-10-13 | dist/kit に guest-server.mjs、plan.mjs、boot.mjs、deploy/ を出力 |
| 67 | `PORT=18067 ALLOWED_ORIGIN=http://localhost:5173 node dist/kit/guest-server.mjs; curl /health` | ローカル | 成功 | 2026-10-13 | macOS の上でバンドルを起動し、/health が 200 と {"status":"ok","stage":"local"} を返した。microVM の中ではない |
| 67 | `vp run firecracker:boot (macOS)` | ローカル | 成功 | 2026-10-13 | 何も送らず、Linux と KVM が要ると表示して終了コード 69 で終わった |
| 67 | `vp run firecracker:infra:synth` | ローカル | 成功 | 2026-10-13 | 7 リソース、出力 1 つ（フラグなし）。AWS への問い合わせなし |
| 67 | `bash -n deploy/prepare.sh deploy/tap.sh` | ローカル | 成功 | 2026-10-13 | 構文の検査だけ。実行はしていない |
| 67 | `node book/theme/figure-cli.ts (67章の図のある 4 ページ)` | ローカル | 成功 | 2026-10-13 | 図 6 つ、問題 0 |
| 67 | `bash deploy/prepare.sh; sudo bash deploy/tap.sh up; sudo work/firecracker --api-sock ...; sudo work/node/bin/node boot.mjs` | ローカル | 未実行 | - | macOS には KVM が無く、Firecracker を起動していない |
| 67 | `vp run firecracker:infra:deploy -c run=true / firecracker:kit:publish / firecracker:kit:empty / firecracker:infra:destroy` | AWS | 未実行 | - | AWS に対しては何も実行していない |
| 68 | `vp test run examples/68-nitro` | ローカル | 成功 | 2026-10-13 | インスタンスタイプの名前の読み取り、ボリューム ID からのデバイスの特定、PCR3 と PCR4 の計算（ユーザーガイドの例の値と一致）、キーポリシーとその評価器、親・エンクレーブ・KMS のモデルと不変条件、料金の入力、スタックのアサーション |
| 68 | `tsc --noEmit -p examples/68-nitro` | ローカル | 成功 | 2026-10-13 | 型検査 |
| 68 | `vp run nitro:infra:synth` | ローカル | 成功 | 2026-10-13 | 既定の構成と、`-c measurement=<96 桁>`、`-c instanceType=m6g.large` で synth した |
| 68 | `vp run nitro:demo` | ローカル | 成功 | 2026-10-13 | モデルの上で、ノートの封印と開封、親による直接の Decrypt の拒否、ドキュメントの再送、デバッグモードの拒否を通した |
| 68 | `vp run nitro:names` | ローカル | 成功 | 2026-10-13 | 既定の 6 つの名前を読んだ |
| 68 | `vp run nitro:prices` | ローカル | 成功 | 2026-10-13 | arm64 と x86 の単価の差と、スタックの置いてあるだけの料金を表示した |
| 68 | `vp run nitro:infra:deploy` | AWS | 未実行 | - | デプロイしていない |
| 68 | `nitro-cli build-enclave / run-enclave` | AWS | 未実行 | - | エンクレーブのイメージを作っていないし、エンクレーブを起動していない。この機械は macOS で、Docker も無い |
| 68 | `vp run nitro:infra:destroy` | AWS | 未実行 | - | デプロイしていないので、片付けも実行していない |

## 未解決事項と再開手順

### bundles-on-lambda

AWS SDK を含む ESM の Lambda bundle（05・06・07・08・15・16・17・19・21・22章）は、先頭で `require` を用意する banner を足してある。`vp run bundles:check` が素の Node.js で読み込めることは確かめたが、Lambda の runtime（Node.js 24）で初期化が通ることは確かめていない。banner を足す前は、手元の Node.js で `Dynamic require of "node:https" is not supported` で落ちていた。

再開手順: `vp run notes:infra:deploy` のあと `vp run notes:smoke`（または関数を 1 回呼ぶ）を実行し、CloudWatch Logs に初期化のエラー（`Runtime.ImportModuleError` など）が無いことを見る。通れば、同じ形のほかの章も同じ理由で通るはずだが、章ごとに 1 回は呼んで確かめる。

### aws-validation

AWS 上での検証を一切行っていない。この依頼ではリソースの作成・変更・削除を実行しないため。

再開手順: docs/CONTINUATION.md の「最初に実行する実環境検証」の順で、許可された学習用アカウントで実行する。結果をこのファイルに記録し、data/section-map.json の verification を更新する。

### cdkd-cloudfront-function

cdkd 0.296.28 は AWS::CloudFront::Function を Cloud Control API 経由で扱う。作成、更新、drift の読み戻しが実際に動くかは未確認。本のサイトと 03章が依存している。

再開手順: vp run spa:infra:deploy と vp run spa:infra:drift を実行する。失敗する場合は、失敗の内容を記録し、著者に判断を仰ぐ（別のツールへは置き換えない）。

### cdkd-state-outputs

tools/src/infra/outputs.ts は cdkd state show --json の出力を { state: { outputs } } と仮定している。output のキーの形（素の名前か stack 名付きか）は実出力で未確認で、両方を受け付ける実装にしてある。

再開手順: デプロイ後に cdkd state show AihHello --json の実出力を保存し、tools/src/infra/outputs.test.ts の fixture を実物に置き換える。

### drift-fixtures

tools/src/drift/fixtures/ は cdkd の型定義と文書化された終了コードから手で書いたもので、実際の出力ではない。

再開手順: 02章の drift の実験を実行し、clean、drifted、stack 不在の実出力を fixture として追加する。

### dynamodb-conditional-writes

05章の中心である「条件付き書き込みが同時の更新を 1 つだけ通す」ことを、DynamoDB Local でも実際の DynamoDB でも確かめていない。確かめたのは、送っている条件式と、メモリの実装が同じ規則に従うことだけ。

再開手順: Docker を起動して vp run db:local:start、db:migrate:local、test:local:dynamodb を実行する。続けて notes:infra:deploy と notes:smoke を実行し、実環境で同時更新を試す script を examples/05-dynamodb/scripts/ に加える。

### cognito-sign-in

06章の Cognito でのサインイン（authorization code と PKCE、token の交換）を一度も実行していない。web/src/auth/cognito.ts は型検査のみ。JWT authorizer が ID token を拒否すること、token endpoint をブラウザから呼べること、config.json の Issuer と AuthDomain の形が合うことも未確認。cdkd が AWS::Cognito::UserPoolClient と UserPoolDomain を Cloud Control API 経由で扱えるかも未確認。

再開手順: vp run app:infra:deploy、app:user:create、app:publish を実行し、ブラウザでサインインする。access token を AIH_ACCESS_TOKEN に入れて app:smoke:api を実行する。ID token を送って 403 になることを確かめる。

### sdk-aws-login

AWS SDK for JavaScript v3 3.1149.0 が aws login の認証情報（login_session）を読めるかは未確認。

再開手順: aws login のあと vp run account:whoami を実行する。読めなければ、公式ドキュメントの credential_process の profile を 01章に手順として加える。

### platforms

検証したのは aarch64-darwin だけ。nix/vp.nix の Linux 用の autoPatchelf と、x86_64-darwin は未実行。

再開手順: 各 platform で nix develop、vp install --frozen-lockfile、vp run check:all を実行し、data/toolchain.json の verifiedPlatforms を更新する。

### ox-content-peer-range

@ox-content/vite-plugin 3.2.14 の vite の peer 範囲に vite-plus-core 1.1.0 が含まれない。pnpm-workspace.yaml の peerDependencyRules で許可している。ビルドは通っている。

再開手順: Ox Content か Vite+ を上げるときに、この許可がまだ必要かを確かめる。

### custom-domain

独自ドメイン（Route 53、ACM）は未実装。siteUrl が無いので、canonical と hreflang のリンクは出力されていない。

再開手順: ドメインが決まったら book/infra/ に hosted zone と us-east-1 の証明書を追加し、AIH_BOOK_SITE_URL を設定してビルドする。cdkd が複数リージョンの stack を扱えるかを先に確かめる。

### cloudformation-drift

CloudFormation の drift detection（検出の開始、完了までの polling、結果の parser、gate）は未実装。20章の範囲。現在の gate は cdkd 管理の stack だけを対象にする。

再開手順: 20章で tools/src/drift/ に CloudFormation 用の検出を追加し、同じ report の形と gate に流す。

### unverified-sources

data/sources.json の checkedAt が null の出典は、調査の出発点として載せただけで、執筆時に読み直していない。01章と 02章は、IAM、CDK bootstrap、CloudFormation drift について、そうした出典に基づく一般的な説明を含む。

再開手順: 該当する出典を読み直し、checkedAt と supports を更新する。本文と食い違えば日本語を先に直す。

### unverified-prices

AWS Budgets の料金、API Gateway HTTP API と S3 の無料枠、どの章が Free plan で実行できるかは未確認。計算では不明として扱い、何も引いていない。

再開手順: 公式の料金ページを確認し、data/pricing/allowances.json の unknown を解消する。

### publication

リポジトリの公開 URL、配布物の公開先、ライセンスが未定。CI の設定例（docs/examples/）は一度も実行していない。

再開手順: 著者が決める。決まったら README と本文に実在する URL だけを書く。

### 18-live-broadcast

18章: 実際の配信と視聴を一度も通していない。OBS からの配信、player での再生、遅延の実測、GetStream とイベントの実際の形、Cloud Control API 経由の IVS リソースの作成と削除、cdkd の state に stream key の値が入るかどうか、streamKey=off を挟んだ作り直しが未確認。

再開手順: AIH_AWS_ACCOUNT_ID を設定し、vp run stream:infra:deploy、stream:key --show、OBS で配信、stream:config と preview:stream:web で視聴、stream:status --events、stream:stop、stream:status --expect-offline、stream:infra:destroy の順に実行する。state は `cdkd state show AihLive --json` で StreamKey の attributes を確認する。

### 11-deploy

11章の stack を AWS に一度も deploy していない。cdkd 0.296.28 が VPC の一式を作って消せること、AWS::EC2::VPCEndpoint が Cloud Control API 経由で作れること、gateway endpoint と interface endpoint を通る実際の到達性、drift の検査結果が未確認。

再開手順: `vp run net:infra:deploy` を既定の構成で実行し、`vp run net:infra:drift`、`vp run net:infra:destroy` まで通す。続けて `-c egress=nat` と `-c interfaceEndpoints=logs` で deploy し、private subnet に置いたリソースから到達性を確かめ、すぐ destroy する（時間課金）。

### 11-cross-stack

別の CDK アプリの stack から `Fn::ImportValue` で 11章の output を読む経路を、cdkd で実行していない。export が残っている間 destroy が拒否されることも、ドキュメントとソースで読んだだけ。

再開手順: 11章の stack を deploy し、`importNetwork` を使う小さな stack（security group 1 つ）を別のアプリから deploy する。その状態で `vp run net:infra:destroy` が `StackHasActiveImportsError` で止まることを確かめ、利用側を先に消してからもう一度実行する。

### 11-zone-names

既定の AZ 名（ap-northeast-1a と ap-northeast-1c）が、すべてのアカウントで subnet を作れる AZ かどうかは確認していない。

再開手順: `aws ec2 describe-availability-zones --region ap-northeast-1` で自分のアカウントの AZ 名と AZ ID を確かめ、違っていれば `-c availabilityZones=...` で渡す。

### ses-send-and-events

15章は SES を一度も呼んでいない。identity の確認、送信 role の policy（ses:FromAddress の条件、identity と configuration set の 2 つの resource）で SendEmail が通ること、sandbox で宛先の identity にも権限が要るかどうか、実際のイベントが fixture と同じ形であること、SNS から関数への配送、configuration set の suppression の動きは未確認。

再開手順: 自分のアドレスで vp run mail:infra:deploy -c fromAddress=... を実行して確認メールのリンクを踏み、vp run mail:send --to 自分のアドレス、続けて --to bounce@simulator.amazonses.com と complaint@simulator.amazonses.com を実行する。mail:status と mail:logs --events で状態とイベントを確かめ、届いたイベントの JSON を test/fixtures と比べる。AccessDenied が出たら、エラーに出た resource の ARN を記録する。

### ses-cdkd-cloud-control

cdkd 0.296.28 は AWS::SES::EmailIdentity、ConfigurationSet、ConfigurationSetEventDestination に専用の実装を持たず、Cloud Control API 経由になる。この経路での作成、更新、drift の検出、削除は一度も動かしていない。DKIM の token を output として読めるかも未確認。

再開手順: vp run mail:infra:deploy、mail:infra:drift、mail:infra:destroy を実行する。ドメインの identity では vp run mail:dns が DkimName1〜3 と DkimValue1〜3 を読めることを確かめる。

### email-dynamodb-claim

15章の「同じ通知は 1 通」は、条件付きの PutItem が同時の依頼を 1 つだけ通すことに依存する。確かめたのは、送っている条件式と、メモリの実装が同じ規則に従うことだけで、DynamoDB Local でも実際の DynamoDB でも動かしていない。

再開手順: デプロイ後、同じ notificationId の依頼を並行で送る script を examples/15-email/scripts/ に加え、届いたメールが 1 通であることを受信箱と mail:status で確かめる。

### edge-function-on-real-runtime

10章の edge-router.js を CloudFront Functions の runtime 2.0 で実行していない。構文、10 KB、2 MB、実行時間（compute utilization）、cf.kvs() を ID なしで呼ぶ形、存在しないキーで get() が reject することは、ドキュメントと Node.js 上のテストでしか確かめていない。

再開手順: vp run edge:infra:deploy の後、aws cloudfront test-function（stage DEVELOPMENT、本文の event）で結果と ComputeUtilization を記録する。続けて edge:publish、edge:kvs:sync を実行し、本文の curl を試す。

### kvs-stale-etag-error

KeyValueStore API が古い If-Match に対して返すエラーの種類を確認していない。API リファレンスは ConflictException（409）を載せているが、どの条件で返るかは書いていない。10章の adapter は ConflictException だけを競合として扱う。それ以外のエラーは、5xx と状態コードの無いものを 5 回まで再試行し、ほかはその場で止まる。

再開手順: デプロイ後、aws cloudfront-keyvaluestore put-key を古い ETag の --if-match で実行し、エラー名と状態コードを記録する。ConflictException でなければ examples/10-edge/src/kvs/store.ts の translate と test/store.test.ts を直す。

### kvs-propagation-time

KeyValueStore の更新が edge に届くまでの時間を計測していない。Developer Guide に数値はなく、AWS News Blog の「a few seconds」だけが手がかり。

再開手順: edge-data.json の maintenance を true にして edge:kvs:sync を実行し、完了時刻から、curl が 503 を返し始めるまでを複数回計る。計った場所と回数を添えて記録する（保証値としては書かない）。

### cdkd-kvs-and-lambda-edge

cdkd 0.296.28 で AWS::CloudFront::KeyValueStore（Cloud Control API 経由、stateful 扱い）と、us-east-1 の stack にある Lambda@Edge 用の関数と AWS::Lambda::Version を実際に作成・更新・削除できるかは未確認。ソースからは、stack 自身のリージョンが使われることと、us-east-1 にも cdkd の asset 置き場が要りそうなことまでしか読み取れていない。Node.js 24 が Lambda@Edge で使えることも個別には確認していない。

再開手順: AIH_AWS_REGION=us-east-1 vp run infra:bootstrap の後に vp run edge:body:infra:deploy を実行する。出力の BodyDigestVersionArn を -c bodyDigestVersionArn=... で vp run edge:infra:deploy に渡し、curl -X POST で /digest を確かめる。失敗したら内容を記録し、著者に判断を仰ぐ（別のツールへは置き換えない）。

### dsql-real-cluster

13章のコードを実際の Aurora DSQL に一度もつないでいない。未確認: 4 つの migration の SQL が受け付けられること（CREATE SCHEMA IF NOT EXISTS、外部キー、CHECK、CREATE INDEX ASYNC IF NOT EXISTS）、CREATE INDEX ASYNC の応答から job_id を読めて sys.jobs を polling できること、AWS IAM GRANT と schema への GRANT で notes_api が読み書きできること、node-postgres の password に渡した関数で token が通ること、競合が node-postgres のエラーの code に 40001 として現れること、凍結から戻った実行環境で切れた接続がどう見えるか。手元の代用は PGlite（PostgreSQL 18.3）で、DSQL（PostgreSQL 16 互換）とは版も違う。

再開手順: 学習用アカウントで vp run sql:infra:deploy、sql:db:migrate、sql:db:grant、sql:smoke を順に実行する。同じ note を同時に更新する負荷をかけ、sql:logs で "transaction retry" の行と 40001 を確認する。15 分以上あけて呼び、接続の張り直しを見る。結果を data/validation.json に記録し、vp run sql:infra:destroy で消す。

### cdkd-dsql-cluster

cdkd 0.296.28 は AWS::DSQL::Cluster に専用の実装を持たず、Cloud Control API 経由で扱う。作成、Ref が cluster の identifier を返すこと、drift の読み戻し、削除が実際に動くかは未確認。13章の stack は Ref から endpoint と ARN を組み立てている。

再開手順: vp run sql:infra:deploy の後、output の ClusterEndpoint が <26 文字の id>.dsql.ap-northeast-1.on.aws の形であること、関数の環境変数と IAM policy の Resource が同じ cluster を指すことを確認する。vp run sql:infra:drift と sql:infra:destroy の結果も記録する。

### dsql-dpu-estimate

13章の料金のシナリオは、1 リクエストあたりの DPU を公式ドキュメントの計算例から借りた仮定で、この章の query を測った値ではない。

再開手順: デプロイした cluster で EXPLAIN ANALYZE VERBOSE を使うか、CloudWatch の ComputeDPU、ReadDPU、WriteDPU を見て、作成、更新、一覧の 1 件あたりの DPU を測る。data/fragments/13.json の scenarios を直して apply し直す。

### uploads-s3-post-policy

07章: presigned POST を実物の S3 に送っていない。とくに、form の tagging の欄を S3 が policy の条件 {"tagging": ...} で受け付けるかは、POST policy の条件の表に tagging が載っていないため未確認。content-length-range と Content-Type による拒否、bucket の CORS、POST 直後の HeadObject も未確認。

再開手順: vp run uploads:infra:deploy、uploads:user:create、uploads:publish の後、サインインして得た access token を AIH_ACCESS_TOKEN に入れて vp run uploads:smoke:api を実行する。tagging で拒否された場合は、アップロード先を別の接頭辞にして完了時に CopyObject する設計に替える。

### uploads-lifecycle

07章: pending の tag が付いた object を lifecycle rule が消すこと、tag を外した object は消さないこと、cdkd が lifecycle と CORS の設定を作成・読み戻しできることは未確認。

再開手順: デプロイ後、完了を呼ばないアップロードと完了したアップロードを 1 つずつ作り、2 日後に vp run uploads:sweep と vp run uploads:infra:drift で確かめる。

### uploads-credential-lifetime

07章: Lambda の実行 role の一時認証情報の寿命を、一次情報で確認できなかった。presigned URL が期限前に切れる頻度は不明。

再開手順: Lambda の公式ドキュメントで数値を探す。見つからなければ、デプロイした関数で認証情報の Expiration を記録して観測値として書く。

### uploads-form-replay

07章: 完了した後、許可証の期限内（5 分）に同じ form を再送すると、object が pending に戻り、1 日後に記録だけが残る。invariant の穴として本文とテストに書いたが、閉じていない。

再開手順: presigned PUT と If-None-Match に替える（Content-Length の署名で大きさを固定できるかを先に実機で確かめる）か、許可証の期限後に tag をもう一度外す処理を足す。

### ssr-aws-path

09章の構成を AWS で一度も動かしていない。Nitro の handler が Node.js 24 の runtime と function URL で動くこと、OAC の署名を function URL が受け入れ直接のリクエストを断ること、cache policy と response headers policy が意図どおり働くこと、smoke が見る x-cache と age ヘッダーの実際の値、許可していない method への応答が未確認。

再開手順: vp run build:ssr、ssr:infra:deploy、ssr:assets:publish、ssr:smoke の順に実行する。smoke が落ちたら、判定（examples/09-ssr/scripts/smoke-spec.ts）と実際のヘッダーのどちらが違うのかを記録してから直す。終わったら ssr:unpublish --yes と ssr:infra:destroy。

### ssr-streaming-path

response streaming が、Lambda、function URL（RESPONSE_STREAM）、CloudFront、ブラウザまで通して少しずつ届くかは未確認。stream した応答を CloudFront が圧縮しないこと、handler の形と InvokeMode が食い違ったときの応答も未確認。手元で確かめたのは Nitro の handler が書き込む回数と間隔だけ。

再開手順: vp run ssr:check:output:stream、ssr:assets:publish、ssr:infra:deploy のあと、curl -sN で /feed を、curl -s -o /dev/null -D - --compressed で / を取得し、行が届く間隔と content-encoding を記録する。function URL を直接ではなく distribution 経由で見ること。

### ssr-cdkd-cloudfront-policies

cdkd 0.296.28 は AWS::CloudFront::CachePolicy と AWS::CloudFront::ResponseHeadersPolicy に専用の実装を持たず、Cloud Control API 経由で扱う。作成、更新、drift の読み戻し、削除が実際に動くかは未確認。minTtl と defaultTtl が 0、maxTtl が 60 の cache policy で圧縮の設定を有効にできるかも未確認。

再開手順: vp run ssr:infra:deploy と ssr:infra:drift を実行する。失敗する場合は内容を記録し、著者に判断を仰ぐ（別のツールへは置き換えない）。

### ssr-bff-deployed

09章の BFF（サインイン、session、token の保持）は手元でしか動かない。session がプロセスのメモリにあり、サインインが POST で、function URL と OAC の組み合わせがブラウザの form からの POST をそのままでは通さないため。デプロイした環境で「cookie を持つ人にその人のページが返る」ことは確かめていない。

再開手順: 著者が方針を決める（session を DynamoDB に置き、POST の入口を API Gateway にする、など）。決まったら examples/09-ssr に実装し、ssr:smoke に本物の session での検査を足す。

### obs-lambda-json-log-shape

Lambda の JSON ログ形式で、アプリが console.log に渡した JSON の行が、そのままの形で CloudWatch Logs に入るかを実機で確かめていない。metric filter の JSON pattern と Logs Insights の項目名がこれに依存する。

再開手順: vp run obs:infra:deploy、vp run obs:smoke の後、vp run obs:query --name request --id <x-request-id> を実行する。行が見つかり、status などの項目が取れること、NoteConflicts にデータ点が出ることを確かめる。形が違えば、src/compose.ts の出力先を process.stdout に替えるか、query の項目名を直す。

### obs-otel-layer-node24

AWS Lambda Layer for OpenTelemetry を Node.js 24 の関数に付けた構成を動かしていない。ADOT のドキュメントの対応 runtime は Node.js 22 まで。esbuild で bundle した ESM の関数で、手書きの span が layer の SDK に届くか、AWS SDK の自動計装が効くか、実行 role の権限が xray:PutTraceSegments で足りるかも未確認。

再開手順: ADOT のドキュメントの Node.js の表から東京リージョンの layer の ARN を取り、vp run obs:infra:deploy -c otelLayerArn=<ARN> を実行する。vp run obs:smoke の後、X-Ray の画面で notes.* の span が Lambda の segment の下に出るか確かめる。出なければ、関数のログで layer のエラーを探し、runtime を nodejs22.x にして比べる。

### obs-alarm-behavior

アラームの実際の状態遷移を確かめていない。metric math の IF の式が受け付けられること、リクエストが無い間に 5xx と Count のデータ点が欠損になること、SNS の通知が届くことは、ドキュメントからの読み取り。

再開手順: vp run obs:infra:deploy -c alarmEmail=<自分のアドレス> の後、届いた確認メールを承認し、vp run obs:alarms で状態を見る。5xx を起こすには、table の権限を一時的に外す変更を別の branch で deploy するなど、練習用アカウントで行う。

### obs-cdkd-cloud-control

cdkd 0.296.28 は AWS::CloudWatch::Dashboard と AWS::Logs::MetricFilter を Cloud Control API 経由で扱う。作成、更新、drift の読み戻しが実際に動くかは未確認。

再開手順: vp run obs:infra:deploy と vp run obs:infra:drift を実行する。失敗する場合は内容を記録し、著者に判断を仰ぐ（別のツールへは置き換えない）。

### obs-pricing-gaps

ダッシュボードの単価（4 つ目から）、Lambda が JSON 形式で書くシステムログの大きさ、layer 経由で送った span が X-Ray の trace として課金されるのかを確認できていない。

再開手順: 料金ページを JavaScript が動くブラウザで開いてダッシュボードの単価を読む。デプロイ後、Logs Insights で 1 リクエストあたりの @message の合計バイト数を測り、data/fragments/19.json の仮定を直す。数日後に Cost Explorer の usage type を見る。

### 14-deploy

14章の stack を AWS に一度も deploy していない。DynamoDB の条件付き `ADD` が実物で同時の増分を失わないこと、TTL で item が消えるまでの実際の時間、Lambda の実行環境が増えたときの memory 版の振る舞い、cdkd 0.296.28 での作成と削除が未確認。

再開手順: `vp run kv:infra:deploy` のあと `vp run kv:smoke` を実行し、6 回目が 429 になることを確かめる。`vp run kv:infra:drift` を実行し、最後に `vp run kv:infra:destroy`。

### 14-elasticache

ElastiCache Serverless（public endpoint）には一度もつないでいない。未確認: CloudFormation と Cloud Control API が `ConnectionType: public` と `UserGroupId: default.iam-user-group` を受け付けること、`CacheUsageLimits` の ECPU の上限 1,000 が有効な値であること、自作の SigV4 token を ElastiCache が受け付けること、iovalkey の `Cluster` が public endpoint で cluster の構成を読めること、TLS 1.3 での接続、script（EVAL）の ECPU 消費、cache の作成と削除にかかる時間。

再開手順: 料金がかかることを承知のうえで `vp run kv:infra:deploy -c store=valkey` を実行する。`vp run kv:smoke` で store が `elasticache` と表示され、6 回目が 429 になることを確かめる。失敗したら `vp run kv:logs` で `valkey connection error`、`cache store failed`、`rate limiter failed` を探し、公式の「Connect to a cache with a public endpoint」の Troubleshooting と照らす。終わったらすぐ `vp run kv:infra:destroy -c store=valkey`。

### 14-docker

`vp run kv:local:start` と `kv:local:stop`（Docker のコンテナで Valkey と DynamoDB Local を起動・停止する）を実行していない。contract test そのものは、同じ版の DynamoDB Local と、Valkey 9.1.2 のプロセスに対して通っている。

再開手順: Docker の daemon を起動し、`examples/14-kv-cache/.env.example` を `.env` にコピーして、`vp run kv:local:start`、`vp run kv:local:migrate`、`vp run kv:test:local`、`vp run kv:local:stop` の順に実行する。

### 20-cfn-deploy

CloudFormation 経路（bootstrap、diff、deploy、smoke、status、destroy）を実環境で通していない

再開手順: `vp run ship:cfn:bootstrap` のあと、`vp run ship:cfn:diff`、`ship:cfn:deploy`、`ship:smoke`、`ship:cfn:status`、`ship:cfn:destroy` を順に実行する。`ship:smoke` が alias 経由で 200 を返すこと、`cdk diff --method template` が lookup role だけで通ることを記録する。CDKToolkit stack に作られたリソースを、本文の表と照合する

### 20-oidc-roles

OIDC の role を GitHub Actions から assume していない

再開手順: `vp run ship:ci:deploy -c githubRepository=<owner>/<repo>` を実行し、出力の 4 つの ARN と アカウント ID を repository の variables に入れる。workflows/ の 4 ファイルを .github/workflows/ にコピーして、pull request、main への push、手動実行の drift を 1 回ずつ流す。別の branch や別の repository から assume が拒否されること、repository の sub が immutable 形式かどうか、fork の pull request で plan job が走らないことを記録する

### 20-drift-role-permissions

DriftRole の読み取り権限は resource type の schema から導いたもので、実際の検出で足りるかは未確認

再開手順: DriftRole で `vp run ship:cfn:drift -c stage=prod` を実行する。`failed` や `incomplete` になったら report の理由に出た action を examples/20-shipping/infra/lib/ci-stack.ts に足し、テストの一覧も直す。足りていたら、使われなかった action を CloudTrail で確かめて削る

### 20-drift-live

CloudFormation の drift 検出の応答を実機で採取していない。検出範囲（Integration が未検査になるか、inline policy の変更が Role の drift として出るか）も未確認

再開手順: 本文の「わざとずらしてみる」の手順を実行する。各段階の reports/drift/AihShipApi.json と、同じ時点の `aws cloudformation describe-stack-resource-drifts` の出力を採り、tools/src/drift/fixtures/cloudformation/ の fixture と形を比べる。存在しない stack 名で実行し、エラーの name と message が `ValidationError` と `does not exist` であることを確かめる。未検査になった resource type を examples/20-shipping/src/drift-coverage.ts の 2 つの一覧と照合する

### 20-rollback-live

失敗したデプロイの rollback、alias の付け替え、`cdk rollback` を実環境で観察していない

再開手順: わざと失敗する変更（たとえば Lambda の memorySize を上限より大きくする）をデプロイし、`vp run ship:cfn:status` が UPDATE_ROLLBACK_COMPLETE を返すまでの状態の移り変わりを記録する。正常なデプロイを 2 回行い、古い version が残っていること、stack を消したときに version も消えることを確かめる

### 20-tool-migration

cdkd と CloudFormation の間で stack を移す手順（`cdkd export`、`cdkd import --migrate-from-cloudformation`）は未実行

再開手順: 練習用の stack を cdkd でデプロイし、`cdkd export <stack> --dry-run` の計画を読んでから実行する。import できない resource type で止まるかどうか、成功後に cdkd の state が消え、CloudFormation の stack として `cdk diff` が空になることを記録する。逆方向も同じ stack で試す

### 12-image-build

12章の Dockerfile で image を一度も build していない。`.dockerignore` の例外指定で dist/server.mjs だけが context に入ること、node:24-bookworm-slim の arm64 版で起動すること、`--read-only` で動くこと、image の大きさが未確認。

再開手順: Docker の daemon を起動し、`vp run ecs:bundle`、`vp run ecs:image:build v1`、`vp run ecs:image:run v1` を実行する。別のターミナルで `curl http://localhost:8080/health` を呼び、Ctrl-C で `stopped` のログと終了コード 0 を確かめる。`docker image ls aih-notes` で大きさを見る。

### 12-deploy

12章の stack を AWS に一度も deploy していない。cdkd 0.296.28 が ECR、ECS、ALB を作って消せること、`Fn::ImportValue` で 11章の VPC を読めること、Cloud Control API 経由になる 3 種類（ScalableTarget、ScalingPolicy、SecurityGroupEgress）が通ること、public subnet の task が image を取得できること、ALB の DNS 名で応答することが未確認。

再開手順: `vp run net:infra:deploy`、`vp run ecs:infra:deploy`、`vp run ecs:image:push v1`、`vp run ecs:infra:deploy -c imageTag=v1` の順に実行し、output の `ServiceUrl` に `curl` する。`vp run ecs:infra:drift` を通したら、`vp run ecs:infra:destroy`、`vp run net:infra:destroy` で消す（時間課金）。

### 12-rolling-update

rolling update を実環境で観察していない。更新中にエラーが出ないこと、新旧の版が交互に応答すること、target の登録解除が終わってから SIGTERM が届くという順序、壊れた image を渡したときに circuit breaker が元に戻すこと、そのとき cdkd の `--full-wait` が何を報告するかが未確認。

再開手順: v1 を deploy した状態で `vp run ecs:watch` を別のターミナルで動かし、`vp run ecs:image:push v2`、`vp run ecs:infra:deploy -c imageTag=v2` を実行する。`ecs:watch` の集計と、`vp run ecs:logs` の `draining`、`stopped` の行の時刻を見る。続けて、存在しない tag で deploy し、`aws ecs describe-services` の `rolloutState` と cdkd の終了コードを記録する。

### 12-private-subnets

`-c taskSubnets=private` の構成を実環境で動かしていない。NAT Gateway 経由、interface endpoint 経由のどちらでも image を取得してログを送れること、443 番だけの egress で足りることが未確認。

再開手順: 11章を `-c egress=nat` で deploy し、12章を `-c imageTag=v1 -c taskSubnets=private` で deploy して `ServiceUrl` を確かめる。次に 11章を `-c interfaceEndpoints=ecr.api,ecr.dkr,logs` で deploy し直し、task を入れ替えて（新しい tag で deploy）同じことを確かめる。終わったらすぐ destroy する。

### 12-alb-idle-lcu

リクエストが無いときに ALB の LCU がいくらになるか（health check が LCU に数えられるか）を一次情報で確認できていない。料金の表では LCU を未算入としている。

再開手順: deploy して 1 日置き、Cost Explorer か請求書で `APN1-LCUUsage` の数量を確かめる。

### async-s3-event-shape

08章: form（POST Object）による作成のイベント（ObjectCreated:Post）と、lifecycle rule による削除のイベント（LifecycleExpiration:Delete）に sequencer が入るかを確認していない。公式ドキュメントは「PUT と DELETE のリクエストでだけ使われる」と書いている。worker は、sequencer のない作成イベントを失敗にして DLQ へ送り、sequencer のない削除イベントは何もせずに受け取る。

再開手順: vp run async:infra:deploy の後、AIH_ACCESS_TOKEN を入れて vp run async:smoke を実行する。form の経路で記録ができなければ vp run async:queue で DLQ を見る。POST のイベントに sequencer がなければ、eventTime と eTag を使う順序づけに替えるか、S3 の通知を EventBridge 経由に替える。

### async-notification-deploy

08章: bucket の名前を固定して queue policy との循環を避ける書き方が、cdkd で実際に通るかを確認していない。S3 が通知の設定時に queue へ送れるかを検証すること、SQS 管理の鍵で暗号化した queue（SSE-SQS）に S3 が送れること、event source mapping の作成時に role の権限が検証されること、If-Match に引用符つきの ETag を渡して 412 が返ることも未確認。

再開手順: vp run async:infra:deploy を実行する。bucket の作成が「Unable to validate the following destination configurations」で失敗したら、queue policy が先に作られているかを確かめる。その後 vp run async:smoke を実行する。

### async-idle-polling-cost

08章: Lambda が空の queue を long polling する頻度が公式ドキュメントに書かれておらず、使われていない月の SQS のリクエスト数を見積もれない。

再開手順: デプロイして 1 日置き、CloudWatch の SQS のメトリクス NumberOfEmptyReceives を読んで、観測値として書く。

### async-housekeeping-scale

08章: 掃除は 1 回の実行で bucket のすべての object を見て、1 枚ごとに DynamoDB を 4 回、順に読む。実行時間は計測していない。枚数が増えると、関数の timeout（15 分）と読み取りの料金の両方に当たる。

再開手順: vp run async:logs --function housekeeping で REPORT 行の実行時間を読む。枚数に対して長すぎるなら、実行の間隔を広げるか、新しい object だけを見るか、S3 Inventory を入力にする。

### async-inspection-orphans

08章: 検査の記録が、object のないまま残る経路が 2 つある。作成イベントを処理している worker が記録を書く直前に、別の worker が同じ key の削除イベントを処理し終えた場合。lifecycle rule による削除のイベントに sequencer がなかった場合。どちらも利用者には見えないが、記録は残る。

再開手順: 削除のときに記録を消すかわりに、sequencer つきの墓石（tombstone）を条件付きで書き、DynamoDB の TTL で消す。

### 23-deploy

23章の stack を AWS に一度も deploy していない。cdkd 0.296.28 が instance、instance profile、security group を専用の実装で、volume と volume attachment を Cloud Control API 経由で作れること、SSM 型の parameter から AMI の ID が解決されること、`Fn::ImportValue` で 11章の output を読めることが未確認。

再開手順: `vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages` の後に `vp run ec2:infra:deploy`、`vp run ec2:status`、`vp run ec2:infra:drift` を通す。終わったら「片付け」の順に消す（時間課金）。

### 23-first-boot

user data を本物の Amazon Linux 2023 で走らせていない。未確認: private subnet から S3 の gateway endpoint だけで dnf の repository に届くこと（repository が S3 にあることは、ドキュメントの出力例の host 名から読み取っただけ）、`nodejs24` と `xfsprogs` が入ること、`/dev/sdf` の link ができること、attach を待つ loop が足りること、unit の directive（`AssertPathIsMountPoint` など）が AL2023 の systemd で通ること、root volume の大きさ（料金は 8 GiB と仮定）。

再開手順: deploy 後に `vp run ec2:status` で cloud-init の結果、service の状態、mount を見る。失敗していたら `vp run ec2:session` で入り、`/var/log/cloud-init-output.log` を読む。root volume は `aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=<instance id>` で確かめ、8 GiB でなければ `src/cost.ts` の `ASSUMED_ROOT_GIB` と本文の金額を直す。

### 23-ssm-endpoints

interface endpoint が 3 つとも要るのかを確かめていない。Systems Manager のドキュメントは、SSM Agent 3.3.40.0 以降は ssmmessages を優先すると書いているが、ec2messages の endpoint を省けるとは書いていない。AMI に入っている agent の版も見ていない。

再開手順: 11章の stack を `-c interfaceEndpoints=ssm,ssmmessages` で deploy し直し、instance を再起動して `vp run ec2:status` が Online を返すか、`vp run ec2:smoke` が通るかを見る。通れば月 USD 20.44 減らせる。

### 23-release

release の経路（S3 への upload、Run Command、instance 上の `notes-release`、restart、`/health` の確認）と、restart のときに処理中のリクエストが完了することを、実機で通していない。Session Manager と port forwarding も未実行（plugin が devShell に無い）。

再開手順: `vp run ec2:app:release`、`vp run ec2:smoke`、`vp run ec2:logs` を通す。もう一度 release して、前の版を `vp run ec2:app:rollback <version>` で戻す。Session Manager plugin を入れて `vp run ec2:forward` を実行し、手元から `curl http://localhost:8787/health` を呼ぶ。

### 23-replace-and-restore

instance を作り直したときに data volume が残って付け直されること、snapshot からの restore、destroy のときの volume attachment の扱いを実行していない。cdkd のソースでは、`UserData` の変更は instance に反映されず、`ImageId` の変更は置き換えになる。置き換えのときに attachment がどう動くか（古い instance から外れて新しい instance に付くのか、途中で失敗するのか）は読み切れていない。

再開手順: ノートを 1 件作り、`vp run ec2:data:unmount` の後に `-c amiId=<1 つ前の AMI>` で deploy して置き換えを起こす。新しい instance で `vp run ec2:status` と `vp run ec2:app:release`、`vp run ec2:smoke` を実行し、ノートが残っているかを見る。続けて「snapshot と restore」の手順を通す。

### 23-patch

`ec2:patch:check` と `ec2:patch:apply` を実機で実行していない。Patch Manager（`AWS-RunPatchBaseline`）は手順を書いただけで、タスクも無い。

再開手順: 数週間前の AMI を `-c amiId=...` で指定して deploy し、`vp run ec2:patch:check` で新しい release が出ることを確かめ、`vp run ec2:patch:apply <releasever>` を実行する。kernel が更新されたら `aws ec2 reboot-instances` で再起動し、`vp run ec2:smoke` を通す。

### 16-deploy

16章の stack を AWS に一度も deploy していない。未確認: cdkd 0.296.28 が inline の DefinitionString（Fn::Join）で state machine を作れること。state machine の role の trust policy の条件が通ること。Scheduler が `<aws.scheduler.scheduled-time>` を置き換えた入力で StartExecution を呼ぶこと。関数の ARN を Resource に直接書いた Task の入出力。Lambda の例外の name が Catch の `ExportCorrupt` に一致すること。S3 が `If-None-Match: *` に 412 を返し、SDK がそれを status 412 の例外として投げること。HeadObject の metadata のキーが小文字で返ること。Task の timeout の後も Lambda が動き続けるかどうか。state transition の実際の数。

再開手順: `vp run export:infra:deploy`、`vp run export:seed --notes 250`、`vp run export:start --id check-1 --wait` の順に実行し、`vp run export:status` で manifest と history の件数を見る。同じ ID でもう一度 `export:start` を実行して ExecutionAlreadyExists になることを確かめる。失敗の経路は、実行中に S3 の console で part を 1 つ消すか、ExportPages の関数の timeout を一時的に短くして確かめる。終わったら `vp run export:empty --yes` と `vp run export:infra:destroy`。

### 16-durable

Lambda durable function は一度も deploy していない。未確認: ap-northeast-1 で使えること（根拠は Price List に東京の SKU があることだけ）。cdkd 0.296.28 が DurableConfig つきの関数を作れること、Lambda::Version と Lambda::Alias を Cloud Control API 経由で作れること。実行 role の権限（`function:<名前>:*` への CheckpointDurableExecution と GetDurableExecutionState）で足りること。esbuild で bundle した SDK 2.6.0 が nodejs24.x で動くこと。`DurableExecutionName` による重複起動の抑止。1 回の呼び出しが関数の timeout に当たったときの実際の動き。durable operation の実際の数と料金。

再開手順: `vp run export:infra:deploy -c durable=true` のあと `vp run export:seed`、`vp run export:durable:start --id check-1` を実行し、Lambda の console の Durable executions タブと `vp run export:logs --function durable` で経過を見る。同じ ID でもう一度起動して、新しい実行が増えないことを確かめる。`vp run export:status` で manifest を確かめる。終わったら `vp run export:empty --yes` と `vp run export:infra:destroy -c durable=true`。

### 16-containers

step を ECS task（`ecs:runTask.sync`）や AWS Batch の job にする構成は、本文で説明しただけで、コードもテストもない。必要な IAM、ネットワーク、task の終了コードの扱い、料金の実測は未確認。

再開手順: 12章の image の扱い（tag は immutable、`fromAsset` を使わない）で export の worker を image にし、state machine の ExportPages を `arn:aws:states:::ecs:runTask.sync` に置き換える。進捗は task の戻り値ではなく S3 に置く必要がある。Docker の daemon が要る。

### 22-drill

22章の復旧 drill を AWS で一度も実行していない。未確認: PITR の復元にかかる時間、`LatestRestorableDateTime` の実際の遅れ、復元した table に引き継がれる設定と引き継がれない設定（削除保護と PITR を含む）、S3 で delete marker を消した後と version を上書きコピーした後の ETag・`LastModified`・通知、`ListObjectVersions` の時刻が同じ version の並び、RPO と RTO の実測値。

再開手順: `vp run recovery:infra:deploy` のあと、本文「drill を実行する」の順に `recovery:drill new`、`recovery:seed --apply`、`recovery:accident --apply`、`recovery:restore:table --apply`、`recovery:restore:objects --at <時刻> --apply`、`recovery:verify --table <復元した table> --frozen`、`recovery:repair` を実行し、`recovery:drill summary` の値を `examples/22-recovery/drill/TEMPLATE.md` の写しに記録する。最後に「片付け」の 3 つのタスク。

### 22-cutover

復元した table への切り替えを実機で確かめていない。未確認: `-c table=<名前>` での deploy が関数の環境変数と IAM policy だけを変えること、cdkd の drift 検査が復元した table を報告しないこと、`cdkd orphan` と `cdkd import --resource` で stack の table を入れ替えられること、`-c protect=on` の stack を cdkd で destroy したときの動き、`-c backup=on`（Cloud Control API 経由）と `-c replica=on` の作成と削除。

再開手順: drill の続きで `vp run recovery:infra:diff -c table=<復元した table>` の差分を読み、deploy して `vp run recovery:audit` と `vp run recovery:infra:drift` を実行する。import を試すなら、`examples/22-recovery` で `cdkd orphan AihRecovery/Notes --dry-run` と `cdkd import AihRecovery --resource <logical ID>=<復元した table> --dry-run` の出力を先に読む。

### 24-deploy

24章の stack を AWS に一度も deploy しておらず、celld を EC2 で一度も起動していない。未確認: cdkd 0.296.28 がこの template を作れること、private subnet の node が S3 の gateway endpoint だけで fleet bucket に届くこと、celld が instance role（IMDSv2 必須）から credentials を得られること、この章の IAM の action の一覧で足りること、systemd の sandbox（ProtectSystem=strict）の下で celld が動くこと、t4g.small で足りること。

再開手順: `vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages`、`vp run celld:fetch --host`、`vp run celld:infra:deploy -c nodes=1`、`vp run celld:artifacts`、`vp run celld:install`、`vp run celld:app-deploy`、`vp run celld:start`、`vp run celld:status`、`vp run celld:smoke`、`vp run celld:diagnose` の順に通す。celld が起動しなければ `vp run celld:logs` を読む。終わったら「片付け」の順に消す（時間課金）。

### 24-fleet-operations

fleet（2〜3 台）での drain、rolling update、node の喪失、backup と restore を実機で一度も通していない。未確認: `celld diagnose --json` の出力がこの章の parser の想定どおりであること、health の gate が実際に閉じて開くこと、`--skip-os-shutdown` での停止の後に残った node が cell を引き継ぐこと、`aws s3 sync` と EBS snapshot から戻した fleet が起動すること。

再開手順: `vp run celld:infra:deploy -c nodes=3` の後、`vp run celld:install v0.6.1`、`vp run celld:app-deploy`、`vp run celld:start`、`vp run celld:rollout v0.6.2`、`vp run celld:loss-check b`、`vp run celld:revive b`、`vp run celld:stop-all`、`vp run celld:backup`、`vp run celld:restore <id>`（dry-run）を通し、それぞれの出力を検証メモに記録する。

### 24-recheck-celld

celld は beta で、調査から執筆までの間にも 1 週間に 1 回ほどの間隔で release が出ている。この章が写した upgrade notes、既定値、CLI の flag、diagnose の出力形式は v0.6.2 のもの。

再開手順: 新しい release を使う前に、その tag の `docs/README.md`（Upgrade notes、Shut down and roll out a node、Environment variables）、`docs/guarantees.md`、`docs/security.md`、`docs/limitations.md` を読み直し、`examples/24-celld/src/celld.ts` の版、digest、upgrade notes、既定値を更新してテストを通す。

### bounds-applied-by-cdkd

公開の入口に入れた上限（HTTP API の stage の `DefaultRouteSettings`、DynamoDB の `OnDemandThroughput`、opt-in の `ReservedConcurrentExecutions`）は、template に出ることをテストで固定しただけで、cdkd 0.296.28 が実際に適用するかは確かめていない。固定した版のコードを読んだ限りでは、3 つとも AWS の API に渡している。

再開手順: 04章をデプロイし、`aws apigatewayv2 get-stage` で `DefaultRouteSettings` を、05章をデプロイして `aws dynamodb describe-table` で `OnDemandThroughput` を見る。そのうえで毎秒 10 件を超えるリクエストを送り、429 が返ることを確かめる。

### throttle-scope-and-billing

stage の既定のスロットリングが API 全体で 1 つの枠なのか、route ごとの枠なのかを確かめていない。route ごとなら、本文の「毎秒 10 件」は route の数だけ増える（06章で 7 倍、07・08章で 11 倍）。スロットリングで返した 429 や、authorizer が拒否したリクエストが課金されるかも確かめていない。

再開手順: デプロイした API の 2 つの route に同時に毎秒 10 件ずつ送り、合計で 10 件に抑えられるかを見る。翌日以降の請求明細で、429 の分の課金を確かめる。

### worst-case-amounts-computed

各章の「叩かれたら」に書いた最悪額は、リポジトリ内の単価と章の前提から計算した値で、請求から得た値ではない。レスポンスの転送量は別枠で、インターネット向けの転送単価が API Gateway のレスポンスに当てはまるかは確かめていない。

再開手順: 負荷をかけたあとの Cost Explorer を、章の表と項目ごとに突き合わせる。

### limits-under-real-concurrency

05章の 1 人あたりの件数上限と 07章の 1 日あたりの許可証の上限は、条件付き書き込みで数えている。メモリと DynamoDB Local では、同時に作成しても上限を超えないことを確かめたが、実際の DynamoDB では確かめていない。table の上限に達したときに SDK がどう再試行し、どの時点で 500 になるかも未確認。

再開手順: デプロイした 05章の API に、上限の手前から同時に作成を送り、101 件目が 409 になることを見る。

### reserved-concurrency-on-new-accounts

09・17・21章の `-c reservedConcurrency=N` は、template に出ることしか確かめていない。新しいアカウントは同時実行の枠が小さく、予約するとデプロイが拒否されるかもしれないので、既定にはしていない。上限に達したときに関数 URL と CloudFront が何を返すかも未確認。

再開手順: `aws service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384` で枠を見てから、`-c reservedConcurrency=2` でデプロイする。

### edge-and-cache-bounds

09章で cache の鍵からクエリ文字列を外したこと（`QueryStringBehavior: none`）と、10章で `/digest` への POST 以外を CloudFront Function が 405 で返すことは、template と Node.js 上のテストでしか確かめていない。CloudFront Functions が `allow` ヘッダー付きの 405 を受け付けるか、その場合に Lambda@Edge が動かないかは未確認。

再開手順: デプロイ後に `curl -i 'https://<domain>/?x=1'` を 2 回送って 2 回目が cache から返ることを見る。10章は `curl -i https://<domain>/digest` が 405 を返すことを見る。

### ivs-viewer-flood

18章の「URL が広まったとき」の最悪額は、既定の同時視聴の上限（15,000）と視聴時間あたりの単価から計算した。上限を超えたときに IVS が何をするか、`StopStream` のあと課金がどれだけ早く止まるかは確かめていない。

再開手順: 配信中に `vp run stream:stop` を実行し、`vp run stream:status` で視聴数が 0 になるまでの時間を見る。

### alarm-topic-tls

19章のアラームの通知先に TLS 必須（`enforceSSL`）を入れ、CloudWatch からの publish を許可する文を足した。この policy で CloudWatch のアラームが実際に publish できるかは確かめていない。

再開手順: デプロイ後に `aws cloudwatch set-alarm-state` でアラームを ALARM にし、購読先に通知が届くことを見る。

### list-response-size

ノートの一覧は、本文を返さず、多くて 20 件の要約だけを返す。契約が受け付ける最大のノートで組んでも 20 KiB 以下になることをテストで確かめたが、デプロイした API のレスポンスでは確かめていない。06・07章の SPA は型検査と既存のテストを通しただけで、この変更のあとブラウザで操作していない。

再開手順: デプロイした API に最大のノートを 20 件作り、`curl -s <url>/notes | wc -c` が 20,480 以下であることを見る。`vp run dev:app` で SPA を開き、一覧からノートを開けることを確かめる。

### 17-live-inference

17章は実際の Bedrock を一度も呼んでいない。モデル ID（jp.amazon.nova-2-lite-v1:0 など）が東京から呼べること、実際の ConverseStream のイベントが src/converse-stream.ts の schema に合うこと、fixture の形が実物と一致することは未確認。

再開手順: examples/17-ai/.env を用意して vp run ai:hello、続けて vp run ai:test:live を実行する（課金される）。イベントの形が違えば schema と fixture を直す。

### 17-deployed-streaming

17章の stack はデプロイしていない。この章のアダプター（src/function-url.ts）のレスポンスが Node.js 24 の Lambda で function URL（RESPONSE_STREAM、AWS_IAM）を通して少しずつ届くこと、awslambda.HttpResponseStream.from に渡す key（statusCode、headers、cookies）を Lambda がそのとおりに読むこと、切断でレスポンスストリームへの書き込みが失敗するかどうか、署名なしのリクエストが 403 になること、inference profile に絞った IAM policy で ConverseStream が通ること、cdkd が AWS::Lambda::Url の InvokeMode を反映することは未確認。

再開手順: vp run ai:infra:deploy、vp run ai:smoke（delta の到着時刻が表示される）、vp run ai:logs、vp run ai:infra:drift、vp run ai:infra:destroy の順に実行する。

### 17-bedrock-billing-details

途中で中断した ConverseStream に、どこまでの token が課金されるかを一次情報で確認できていない。Bedrock の無料枠、東京リージョンでの quota の値も未確認。

再開手順: Bedrock の料金ページと Service Quotas を確認する。中断時の課金は、ai:test:live を途中で止めて請求と CloudWatch の metrics を見比べる。

### 21-deploy

既定の stack（CloudFront、function URL、Secrets Manager）を実環境で通していない

再開手順: `vp run sec:infra:deploy` のあと、すぐに `vp run sec:smoke` を実行し、「after N refusals」の N を記録する。function URL を直接 curl して 403 になること、`vp run sec:infra:drift` の結果、`vp run sec:infra:destroy` のあとに Secrets Manager のコンソールで secret が「削除予定」としても残っていないことを確かめる

### 21-rotation

secret の rotation を実環境で試していない

再開手順: デプロイ後に `vp run sec:smoke`、`vp run sec:secret:rotate`、もう一度 `vp run sec:smoke` の順に実行する。rotation の直後に、古い key version で発行した token が検証を通ること、`sec:secret:versions` の表示が AWSCURRENT と AWSPREVIOUS になっていること、同じ `--version-id` での再実行が already-rotated になること、10 分以内の 2 回目が too-soon で止まることを記録する。AWSPREVIOUS が無い secret に GetSecretValue したときのエラー名が ResourceNotFoundException かどうかも確かめる

### 21-waf

web ACL を作っていない。rate-based rule の動きも見ていない

再開手順: `vp run sec:waf:infra:deploy` の出力 WebAclArn を `vp run sec:infra:deploy -c webAclArn=<ARN>` に渡す。5 分間に 300 回を超えるリクエストを 1 つの IP から送り、403 が返り始めるまでの時間と回数を記録する。WAF のコンソールで AwsCommonRules が count として記録していることを確かめる。請求で usage type が Global-* か USE1-* かを確かめる。終わったら `sec:infra:deploy`（webAclArn なし）で外してから `vp run sec:waf:infra:destroy`

### 21-cmk

customer managed key を使う構成を実環境で試していない

再開手順: `vp run sec:infra:deploy -c cmk=on` のあと `vp run sec:smoke`。関数が kms:ViaService の条件つきの kms:Decrypt だけで secret を読めることを確かめる。`vp run sec:infra:destroy` のあと、KMS のコンソールで鍵が「削除保留中」で、7 日後に消える予定になっていること、その間の請求に鍵の料金が載るかどうかを記録する

### 21-iam-propagation

IAM の変更が伝わるまでの遅れを、実際には観測していない

再開手順: デプロイ直後の `vp run sec:smoke` で refusals が 0 かどうかを数回記録する。次に、コンソールで HandlerRole の ReadSigningKey を消し、実行環境が新しくなるのを待ってから `/token` を繰り返し呼び、503 になるまでの時間と、一度 503 になったあとに 200 が混ざるかどうかを記録する。終わったら `vp run sec:infra:drift` で差を確かめ、revert する

### 21-posture

`sec:posture` と `sec:trail:iam` を実アカウントで動かしていない。GuardDuty、Inspector、Config、trail、Organizations も有効にしていない

再開手順: `vp run sec:posture` を実行し、6 つの読み取りがすべて read できること、Organizations に入っていないアカウントで AWSOrganizationsNotInUseException が返ることを確かめる。GuardDuty をコンソールで有効にして表示が on に変わること、30 日の試用期間中にコンソールの使用量ページが出す見積もりを記録する。`vp run sec:trail:iam` で、デプロイのときの CreateRole が us-east-1 の event history に出ることを確かめる。SCP は、練習用の organization と OU を用意できる場合にだけ、`policies/scp-guardrails.json` を OU に付けて試す

### events-pipe-to-bus

25章: pipe が DynamoDB の stream を読み、enrichment の関数が返した配列の要素を、そのまま event bus のイベントの detail にすること、DetailType に書いた `$.type` が enrichment の出力から解決されること、batch を 1 件にしたときも関数に配列で渡ることを、実物で確かめていない。信頼ポリシーに条件を付けていない pipe のロールで pipe が作れることも同じ。

再開手順: vp run events:infra:deploy の後、vp run events:smoke を実行する。timeline の記録ができなければ、Shape と Timeline のロググループと vp run events:status の dead letter を見る。shape のログに `shaped` があるのにバスに届いていなければ、pipe の target parameters を疑う。

### events-archive-cloud-control

25章: cdkd 0.296.28 は AWS::Events::Archive に専用の実装を持たず、Cloud Control API 経由で作る。作成、更新、削除が通ることを確かめていない。

再開手順: vp run events:infra:deploy と vp run events:infra:destroy を実行する。archive で止まるなら、スタックから archive を外し、`aws events create-archive` で手で作って、消すのも手で行う。

### events-replay-shape

25章: リプレイされたイベントが、関数の入力と SQS のメッセージの本文で `replay-name` を持つこと、元の id と time を保つかどうか、リプレイが指定したルールだけに届くこと、`replay-name` が無いことを条件にしたルール（rejections）がリプレイされたイベントに一致しないことを、実物で確かめていない。コンシューマーは EventBridge の id に頼っていない。

再開手順: events:smoke の 10 分後に vp run events:replay -- --minutes 30 --rule timeline --yes を実行し、Timeline のログの `replay` の欄と、timeline の記録が変わらないことを見る。

### events-delivery-permissions

25章: 次の組み合わせを実物で確かめていない。SQS が管理する鍵で暗号化したキューへの、EventBridge のルール、Pipes の dead-letter、Lambda の on-failure destination、SNS からの配送。条件のないトピックポリシーでの EventBridge から SNS への publish。input transformer の出力が SNS のメッセージになり、raw message delivery でそのままキューに入ること。

再開手順: vp run events:smoke の最後の手順（画像でないファイルを置いて、inbox に通知が届くのを待つ）が通るかを見る。通らなければ vp run events:status で、どのルールの dead letter かと ERROR_CODE を読む。

### events-streams-read-billing

25章: pipe が stream を読みにいく GetRecords が、DynamoDB Streams の read request unit として請求されるかどうかを確かめていない。料金ページは Lambda のトリガーと global tables だけを無料としている。本文の「使っていない月 USD 1.83」は、請求される、shard は 1 つ、1 秒に 4 回、という仮定での計算。

再開手順: デプロイして数日置き、Cost Explorer で DynamoDB の usage type `APN1-Streams-Requests` の数量を見る。

### events-pattern-matcher-gap

25章: 手元の matcher（src/pattern.ts）は EventBridge の実装ではない。数値の一致は JSON.parse の後の値で比べる（EventBridge は書かれた文字列で比べる）、exists は leaf でない値を「無い」と扱う、イベントの中の配列は扱わない。スタックのパターンが EventBridge で同じ結果になることは確かめていない。

再開手順: 認証情報を用意して `aws events test-event-pattern --event-pattern <パターン> --event <イベント>` を、test/pattern.test.ts の一致する例と一致しない例で実行する。

### events-custom-event-bus-v2

25章: EventBridge の新しい Custom Event Bus（AWS::EventsV2）を使っていない。公式ドキュメントは新しいアプリケーションにこちらを勧めているが、cdkd 0.296.28 に実装がなく、2026-10-13 に読んだ Cloud Control API の対応一覧にも AWS::EventsV2 が無かった。Pipes のターゲットにできるかも確認していない。

再開手順: cdkd の版を上げるときに register-providers.ts と Cloud Control API の対応一覧を見直す。使えるなら、ルールと archive を subscriber と保持期間に置き換える（公式の移行ガイドの対応表）。

### analytics-athena-sql-not-executed

生成した SQL を Athena で実行していない。関数（substr、count(DISTINCT)、approx_percentile）、文字列の列 dt に対する BETWEEN でパーティションが絞られること、結果の形は、ドキュメントから読み取っただけ。手元のテストは同じクエリの構造を自前の関数で評価したもので、SQL のエンジンではない。

再開手順: vp run analytics:infra:deploy、vp run analytics:smoke の後、バッファーの間隔（60 秒）を待って vp run analytics:query --name actions --from <今日> --to <今日> を実行する。SUCCEEDED になること、行が smoke の内容と合うこと、scanned のバイト数がその日のオブジェクトの合計以下であることを確かめる。

### analytics-hive-json-serde-nulls

Athena の Hive JSON SerDe が、このレコード（JSON の null、整数、ISO 8601 の文字列）を表の列として読めるかを確かめていない。OpenX JSON SerDe を避けたのは、ドキュメントが結果の非決定性を注意しているため。

再開手順: デプロイして smoke の後、Athena のコンソールで SELECT * FROM "aih_analytics"."requests" WHERE dt = '<今日>' LIMIT 10 を実行する。action と note_id が NULL になる行、数値の列を確かめる。読めなければ、infra/lib/analytics-stack.ts の STORAGE.json.serializationLibrary を見直す。

### analytics-parquet-conversion

Firehose のフォーマット変換（-c format=parquet）を動かしていない。バッファーの最小サイズ（64 MB を指定）、OpenX のデシリアライザーが JSON の null と bigint の列を扱えること、Firehose が書く Parquet の実際の大きさ、Athena が読んだと報告するバイト数は未確認。本文の Parquet の数字は、手元のライブラリで書いたファイルの実測。

再開手順: vp run analytics:infra:deploy -c format=parquet でデプロイし、smoke の後 5 分待つ。requests_parquet/ に .parquet のオブジェクトができ、errors/format-conversion-failed/ が空であることを確かめる。同じクエリを json と parquet のスタックで実行し、scanned を比べる。

### analytics-cdkd-cloud-control

cdkd 0.296.28 が、AWS::Athena::WorkGroup と AWS::Logs::LogStream を Cloud Control API 経由で作成・更新・削除できるか、Firehose の専用プロバイダーが DataFormatConversionConfiguration と CloudWatchLoggingOptions をそのまま渡して作成に成功するかを確かめていない。

再開手順: vp run analytics:infra:deploy の出力で、リソースごとの経路と結果を確かめる。その後 vp run analytics:infra:drift と vp run analytics:infra:destroy まで実行する。

### analytics-s3-requests-per-query

Athena のクエリ 1 回が S3 に何回リクエストするかを確かめていない。料金のシナリオは、オブジェクトごとに GET を 1 回と仮定している。LIST と、Parquet のフッターや列ごとの読み取りは数えていない。

再開手順: クエリを数回実行した翌日以降に、Cost Explorer で S3 の Requests-Tier1 と Requests-Tier2 の使用量を、Athena を使わなかった日と比べる。

### analytics-put-latency

PutRecord を待つことで、レスポンスがどれだけ遅くなるかを測っていない。500 ms の上限は、測定にもとづく値ではない。

再開手順: デプロイ後、vp run analytics:smoke を数回実行し、vp run analytics:query --name routes で p95_ms を、19章のスタックの同じルートの値と比べる。

### 27-aws

27章のスタックを AWS に一度もデプロイしていない。未確認: cdkd 0.296.28 が AWS::S3Vectors::Index を Cloud Control 経由で作れること、Titan Text Embeddings V2 が東京から呼べて 1,024 次元を返すこと、S3 Vectors の実際の応答がアダプターのスキーマに合うこと、所有者のフィルターつきの問い合わせが通ること、存在しないキーを DeleteVectors に渡したときの振る舞い、DynamoDB Streams の実際のレコードがハンドラーのスキーマに合うこと、失敗したバッチがデッドレターキューに届くこと、function URL 経由で回答が少しずつ届くこと。

再開手順: `vp run search:infra:deploy`、`vp run search:seed`、`vp run search:smoke` の順に実行する。`vp run search:logs -- --indexer` で索引のログを、`vp run search:reindex` で表と索引の差を見る。存在しないキーの削除は、`search:seed` のあとノートを 1 件消し、同じ REMOVE を再配送させる代わりに `search:reindex -- --apply` を 2 回続けて実行して確かめる。最後に `vp run search:infra:destroy`。

### 27-distance

意味の検索で「無関係」とみなす距離のしきい値（`MAX_DISTANCE`、0.7）と、パッセージの長さ（800 文字）は、Titan の実際の埋め込みで調整していない。日本語 1 文字が何トークンになるかも測っていない。

再開手順: デプロイ後、`search:smoke` と自分のノートで検索し、ログの `embedded` 行の `tokens` と、S3 Vectors が返す距離を見て `examples/27-search/src/search.ts` の `MAX_DISTANCE` を決め直す。

### 27-opensearch-nextgen

OpenSearch Serverless の NextGen コレクションについて、東京リージョンで使えること、東京での OCU 単価が Classic と同じか、ゼロから戻るまでの時間は、開いた一次情報からは確認できなかった。Bedrock のマネージド型ナレッジベースの料金（1 GB あたり月 5 ドル、Retrieve 1,000 回あたり 1 ドル）は料金ページの値で、Price List の東京の行としては見つけていない。

再開手順: OpenSearch Serverless のコンソールで東京リージョンを選び、NextGen のコレクショングループを作れるかを見る。料金は請求書か Cost Explorer の usage type で確かめる。

### 28-two-regions

28章の 2 つのスタックを AWS に一度もデプロイしていない。未確認: cdkd 0.296.28 が AWS::DynamoDB::GlobalTable（レプリカごとの PITR を含む）を作れること、ap-northeast-3 のスタックを同じアプリからデプロイできること（東京で bootstrap した状態で足りるか）、名前を固定した別リージョンのバケットへの複製の設定、`-c back=on` の 2 回目のデプロイ、ReplicationLatency の実際の値、2 つのリージョンから同時に編集したときにどちらが残るか。

再開手順: `vp run mr:standby:infra:deploy`、`vp run mr:infra:deploy` の順にデプロイし、`vp run mr:status` で両方のレプリカが ACTIVE であることを見る。`vp run mr:conflict --apply` の出力（2 つの PUT のステータスと、5 秒後に両方のリージョンが持つタイトル）を記録する。CloudWatch で ReplicationLatency を見る。最後に `vp run mr:empty --apply`、`vp run mr:infra:destroy`、`vp run mr:standby:infra:destroy`。

### 28-failover

リージョンの障害もフェイルオーバーも、一度も起こしていない。未確認: Route 53 のヘルスチェックが異常と判定するまでの実際の時間、API Gateway のカスタムドメインを指すエイリアスレコードの TTL、切り替わりにクライアントが気づくまでの時間、cdkd が AWS::Route53::HealthCheck・AWS::ApiGatewayV2::DomainName・ApiMapping を Cloud Control API 経由で作れること、2 つのスタックが同じドメインの ACM の証明書をそれぞれ DNS で検証できること、RTO と RPO の実測値。

再開手順: ホストゾーンを用意し、`-c domain=<name> -c zoneId=<id> -c zoneName=<zone>` を付けて 2 つのスタックをデプロイする。`dig <name>` で TTL を記録する。東京のスタックを `-c drill=on` でデプロイしてヘルスチェックを落とし、`x-aih-region` が ap-northeast-3 に変わるまでの時間を計って、`examples/28-multi-region/src/objectives.ts` の数字と比べる。AWS FIS のグローバルテーブルのアクションで複製を止める実験は、別に計画する。

### 28-mrsc

MRSC のグローバルテーブルを、この章のスタックは作らない。固定した版の cdkd の GlobalTable の実装が扱うプロパティの一覧に MultiRegionConsistency と GlobalTableWitnesses がなく、3 つ目のリージョンも要るため。MRSC の動きはドキュメントとモデルだけで確かめた。孤立したリージョンで SDK が投げるエラーの名前は確認していない。

再開手順: 空のテーブルを AWS CDK CLI か AWS CLI で MRSC（東京、大阪、ウィットネスにソウル）として作り、2 つのリージョンから同じ version への更新を同時に送って、ConditionalCheckFailedException と ReplicatedWriteConflictException のどちらが返るかを記録する。

### tune-no-lambda-timings

Lambda 上の時間を 1 つも測っていない。初期化の時間、コールドスタートの割合、メモリを変えたときの実行時間は、この章のどこにも実測値がない。手元で測ったのはバンドルのバイト数と、Mac での読み込み時間だけ。

再開手順: vp run tune:infra:deploy、vp run tune:smoke の後、数分待って vp run tune:report を実行する。-c memorySize=512 などでデプロイし直して同じ手順を繰り返し、表を比べる。

### tune-json-report-shape

JSON ログ形式の platform.report が、ドキュメントの形のまま CloudWatch Logs に入り、aws logs filter-log-events の message として読めることを実機で確かめていない。

再開手順: vp run tune:report を実行する。「No reports found」になるか、形が違うというエラーになったら、aws logs tail でそのまま 1 行を見て src/report.ts のスキーマと比べる。

### tune-module-first-on-lambda

mainFields を module,main にしてミニファイしたバンドルを、Lambda では動かしていない。素の Node.js 24 で読み込み、DynamoDB の代役に GetItem を送るところまでは確かめた。

再開手順: vp run tune:infra:deploy の後、vp run tune:smoke が 201、200、204 を返すことを確かめる。500 が返ったら vp run tune:report とログで初期化の失敗を探す。

### tune-deadline-on-lambda

ハンドラーが自分で設ける締め切り（関数のタイムアウトの 1 秒前）が、Lambda の上で SDK の呼び出しを止め、500 の応答とログを残すことを確かめていない。関数がタイムアウトしたときに API Gateway が返すステータスも確かめていない。

再開手順: テーブルへの権限を一時的に外すのではなく、到達できないエンドポイントを環境変数 DYNAMODB_ENDPOINT に入れた関数を別に用意して呼び、応答と REPORT 行の Status を見る。

### tune-concurrency-options

-c reservedConcurrency と -c provisionedConcurrency を付けたデプロイを実行していない。cdkd 0.296.28 は AWS::Lambda::Version と AWS::Lambda::Alias を Cloud Control API 経由で扱う。新しいアカウントで予約が断られる条件、provisioned concurrency の割り当てにかかる時間も未確認。

再開手順: aws lambda get-account-settings で ConcurrentExecutions を確かめてから、vp run tune:infra:deploy -c reservedConcurrency=5 -c provisionedConcurrency=1 を実行する。確かめたら、-c を外してデプロイし直すか destroy して、時間課金を止める。

### tune-init-duration-contents

REPORT の Init Duration に、コードのダウンロードと実行環境の起動が含まれるかどうかを、ドキュメントから読み取れなかった。

再開手順: デプロイ後、最初の呼び出しについて、API Gateway の IntegrationLatency と、REPORT の Init Duration + Duration を比べる。

### 30-aws

30章のスタックを AWS で一度も動かしていない。未確認: トランザクションが実際に衝突したときのキャンセル理由と再試行の効き方（DynamoDB Local は衝突を報告しない）、GSI が実際にどれだけ遅れるか、ストリームの関数に同じレコードが再配送される頻度、イベントソースマッピングのフィルターが関数自身の書き込みを止めること、再試行が尽きたバッチがデッドレターキューに届くこと、TTL による目印の削除、ConditionCheck の課金のされ方、別のパーティションを指す ExclusiveStartKey への応答、テーブルとインデックスの上限に当たったときのエラー、cdkd がインデックス・ストリーム・フィルターつきのイベントソースマッピング・マネージドポリシーを実際に作れること。

再開手順: `vp run modeling:infra:diff`、`vp run modeling:infra:deploy`、`vp run modeling:smoke` の順に実行する。`modeling:smoke` は、一覧と件数が見えるまでの時間を表示する。関数のログは出力 `ProjectorLogGroupName` のロググループを見る。終わったら `vp run modeling:infra:destroy`。

### 30-migration

05〜08章のテーブルへの移行（GSI の追加、バックフィル、読み取りの切り替え、古いキーの削除）は、メモリ上のモデルでしか確かめていない。未確認: 既存のテーブルに GSI を足したときのバックフィルの時間と料金、アプリが動いている最中の `modeling:backfill` の挙動、05章の一覧の Query が新しいキーの添付を読んだときの実際の失敗の形。

再開手順: 05章か 07章のスタックのテーブルに `gsi1` を足してデプロイし、`vp run modeling:backfill --table <テーブル名>`（計画だけ）、`--apply` を付けて実行、`vp run modeling:verify --table <テーブル名>` の順に実行する。

### 30-docker

DynamoDB Local を Docker で起動する手順（05章の `db:local:start`）は実行していない。この章のタスクは、jar から直接起動した DynamoDB Local（ポート 8030）に向けて実行した。

再開手順: Docker のデーモンを起動し、`examples/30-data-modeling/.env.example` を `.env` にコピーして、`vp run db:local:start`、`vp run modeling:db:migrate:local`、`vp run modeling:test:local` の順に実行する。

### 31-shift-on-aws

31章のスタックと 2 つのスクリプトを AWS で一度も動かしていない。未確認: cdkd 0.296.28 が Cloud Control API 経由で `AWS::Lambda::Alias`、`AWS::Lambda::Version`、AppConfig の 4 種類を作れること、スタックの更新がエイリアスを動かさないこと、`UpdateAlias` の `RevisionId` が食い違ったときのエラーの名前、重みを空の map で消せること、重み付きエイリアスの実際の振り分け、`x-app-version` が示すバージョン番号、1 分のアラームが切り替えの間に `ALARM` になるまでの時間、cdkd のドリフト検査がエイリアスの変更をどう報告するか。

再開手順: `vp run rollout:infra:deploy` のあと `vp run rollout:probe`、`vp run flags:deploy --apply`、`vp run rollout:infra:deploy -c fault=50`、`vp run rollout:start --apply`（別の端末で `vp run rollout:probe --count 300`）を順に実行し、ロールバックされることを見る。続けて `-c fault=0` でデプロイし直して `rollout:start --apply` が完了することを見る。最後に `vp run rollout:infra:drift`、`vp run flags:clear --apply`、`vp run rollout:infra:destroy`。

### 31-appconfig-behaviour

AppConfig と拡張機能のふるまいのうち、ドキュメントで確認できなかったもの: 一度もデプロイしていない設定を拡張機能に問い合わせたときの応答、コールドスタートの直後に AppConfig に届かないときの応答と待ち時間、アラームの ARN に絞った `cloudwatch:DescribeAlarms` で AppConfig の自動ロールバックが動くか（ドキュメントの例は `*`）、保存したバージョンが残っている設定プロファイルを削除できるか、「Configuration Received」が数えられる単位。

再開手順: デプロイ直後、`flags:deploy` の前に `vp run rollout:probe` を実行して `x-flags-origin` が `defaults` になることとログの `flags` の行を見る。`flags:deploy --apply` の後、`-c fault=50` の版に切り替えてアラームを鳴らし、`flags:status` が `ROLLED_BACK` になるかを見る。`flags:clear` を実行せずに `rollout:infra:destroy` を試し、失敗するかを記録する。請求の `APN1-AppConfig-Deployments` の数量を、コールドスタートの回数と比べる。

### 31-ecs-and-codedeploy

ECS の canary と CodeDeploy の構成は、テンプレートを合成してテストで読んだだけで、デプロイするアプリには入っていない。ECS の circuit breaker が `BLUE_GREEN`、`LINEAR`、`CANARY` の方式でも働くか、12章のサービスを方式を変えて更新できるか、cdkd が `AdvancedConfiguration` と `DeploymentConfiguration.Strategy` を送るかは未確認。CodeDeploy の Lambda と ECS へのデプロイに料金がかからないことは、料金表に SKU が無いことしか確かめていない。

再開手順: 12章のスタックを練習用のアカウントにデプロイし、`examples/31-progressive-delivery/infra/lib/ecs-canary-sketch.ts` の設定を 12章のサービスに移して更新を試す。CodeDeploy は 20章の `ship:cfn:*` の経路で `codedeploy-sketch.ts` をスタックに足して試す。

### limits-stage-429-shape

API Gateway の HTTP API がスロットリングで返す 429 のボディと、Retry-After ヘッダーの有無を確かめていない。手元の代役は {"message":"Too Many Requests"} を返し、ヘッダーは付けない。

再開手順: vp run limits:infra:deploy のあと、スタックの出力 ApiUrl に対して curl -i を 1 秒に 30 回ほど続けて送り、429 のヘッダーとボディを記録する。違っていたら src/throttle.ts の代役と本文を直す。

### limits-route-throttle-cdkd

ルートごとのスロットリング（RouteSettings の "POST /notes"）と DependsOn を、cdkd 0.296.28 が反映するか動かしていない。ルートより先にステージが作られると失敗する、という前提も確かめていない。

再開手順: デプロイ後に aws apigatewayv2 get-stage --api-id <id> --stage-name '$default' で RouteSettings を読み、POST /notes を 1 秒に 10 回送って 429 が毎秒 2 件のあたりから返ることを確かめる。

### limits-lambda-throttle-status

Lambda が関数をスロットリングしたとき（予約済み同時実行数に当たったとき）、HTTP API が呼び出し元に返すステータスを確かめていない。

再開手順: -c reservedConcurrency=1 でデプロイし（アカウントの同時実行数が 101 以上あること）、同時に数件のリクエストを送って、返るステータスと Throttles のメトリクスを記録する。

### limits-budget-tag-filter

タグで絞った予算（FilterExpression の Tags）を cdkd が作れるか、キーを project と書くのか user:project と書くのか、有効化の前に作った予算が有効化のあとで数え始めるかを確かめていない。

再開手順: デプロイし、コンソールの Budgets で予算のフィルターを見る。project タグを有効化して 2 日ほど置き、予算の実績と vp run limits:cost の結果が同じ額を指すか比べる。

### limits-untagged-charges

このスタックの料金のうち、どれが project タグを運ぶかを請求で確かめていない（API Gateway のリクエスト、データ転送、CloudWatch のアラーム、税）。

再開手順: タグを有効化して数日使ったあと vp run limits:cost を実行し、(no tag) の行にどのサービスが残るかを記録する。

### limits-load-test-outside-aws

AWS の外（手元の端末）から自分の API に負荷をかける試験に、申請や上限が要るかを一次情報から読み取れなかった。EC2 のテストポリシーは EC2 からの試験についてのもので、ペネトレーションテストのポリシーはリクエストフラッディングを禁じている。この章の負荷生成スクリプトは localhost 以外を断る。

再開手順: 実環境で負荷試験をする前に、2 つのポリシーのページを読み直し、判断がつかなければ AWS Support に計画を伝えて確認する。

### 33-live-account

33章の点検は、合成したテンプレートだけを読んでいる。指摘の内容を、デプロイ済みのアカウントの実際の設定と突き合わせたことはない。AihReadyProduction はデプロイしておらず、Aspect が付けた PITR、削除保護、Retain、90 日の保持が実物でどう働くかも見ていない。CloudFormation と cdkd のどちらでも、スタックの削除や置き換えの更新を実行していない。

再開手順: 20章の経路（`ship:cfn:*` と同じ CDK CLI）で本番向けの設定を持つスタックを練習用のアカウントにデプロイし、`aws dynamodb describe-continuous-backups` と `aws logs describe-log-groups` で設定を確かめる。そのあとスタックを削除して、テーブルとロググループが残ることと、残ったものの消し方を記録する。

### 33-sibling-chapters

33章は 25〜32章と 34〜36章を、それぞれの章の範囲の説明だけをもとに参照している。本文は読んでおらず、それらの章のスタックを点検した結果も含んでいない。

再開手順: すべての章が揃ったあとで `vp run ready:check` を実行し、本文の「本の全スタックに当てた結果」の件数と、各分野の節が指している章の内容を照らし合わせる。

### 33-other-platforms

Cloudflare が Vercel の production checklist にあたる一覧を公開しているかは確認していない。Cloudflare について読んだのは Workers Logs の保持の上限だけ。AWS Config の管理ルール、cdk-nag、CloudFormation Guard は名前と説明を読んだだけで、動かしていない。

再開手順: Cloudflare の公式ドキュメントで公開前の確認事項にあたるページを探す。cdk-nag を 1 つのスタックに当てて、この章の 10 個のルールと重なる指摘、重ならない指摘を比べる。

### 34-cluster-deploy

34章のスタックを一度もデプロイしていない。cdkd 0.296.28 は AWS::EKS の種類に専用の実装を持たず、Cloud Control API を経由する。クラスターの作成と削除、アクセスエントリー、Pod Identity の関連付け、別のアプリのスタックからの Fn::ImportValue が通るかは未確認。

再開手順: `vp run net:infra:deploy`、`vp run eks:infra:diff`、`vp run eks:infra:deploy` の順に実行し、`aws eks describe-cluster --name aih-eks` で status が ACTIVE になること、computeConfig、accessConfig、upgradePolicy がテンプレートどおりであることを確かめる。終わったら `vp run eks:infra:destroy`。

### 34-manifests-on-a-cluster

k8s/ のマニフェストを API サーバーに渡したことがない。自前の NodeClass（パブリックサブネット、associatePublicIPAddress）でノードが起動してクラスターに参加するか、t4g.medium が選ばれるか、Name タグで ALB のサブネットを選べるか、Ingress の annotation が Auto Mode で効くか、preStop の 15 秒で足りるか、Pod Identity の認証情報が Pod に届くかは未確認。

再開手順: クラスターをデプロイし、kubectl を用意して `aws eks update-kubeconfig --name aih-eks --region ap-northeast-1`、`vp run eks:manifests cluster | kubectl apply -f -`、`vp run eks:manifests app --tag v1 | kubectl apply -f -` を実行する。`kubectl get nodes -o wide`、`kubectl -n notes get pods,ingress` を見て、Ingress のホスト名へ `curl -si .../health` を送る。`kubectl -n notes rollout restart deployment/notes-api` の間、12章の `vp run ecs:watch --url http://<host>` でエラーが出ないことを確かめる。

### 34-flake-kubectl

Nix の devShell に kubectl が無い。34章のデプロイの手順は、kubectl を別に用意する前提で書いてある。

再開手順: flake.nix の devShell に `pkgs.kubectl` を足すかどうかを著者が決める。足す場合は、クラスターのバージョン（1.37）と 1 マイナーバージョン以内であることを `kubectl version --client` で確かめ、34章の deploy のページの断り書きを直す。

### 35-deploy

35章のスタックを AWS に一度もデプロイしていない。cdkd 0.296.28 が `AWS::Lambda::CapacityProvider` と、`CapacityProviderConfig` を持つ `AWS::Lambda::Function` を Cloud Control API 経由で作れること、`$LATEST.PUBLISHED` が自動で公開されること、API Gateway が修飾子なしの関数を呼べること、デプロイする IAM identity に `lambda:PassCapacityProvider` と `iam:CreateServiceLinkedRole` が要ることが未確認。

再開手順: `vp run net:infra:deploy -c interfaceEndpoints=logs` の後に `vp run lmi:infra:deploy`、`vp run lmi:smoke`、`vp run lmi:infra:drift` を通す。終わったら `vp run lmi:infra:destroy`、`vp run net:infra:destroy` の順に消す（時間課金。1 日でおよそ USD 8.87）。

### 35-fleet

インスタンスの台数、EBS ボリュームの大きさと料金、2 つの AZ のサブネットに 3 台がどう配置されるか、`minExecutionEnvironments` を 3 未満にしたときの台数を確認していない。料金の計算は「3 台」という仮定に立っている。

再開手順: デプロイ後に、キャパシティプロバイダーのシステムログと CloudWatch のメトリクス（名前空間 `AWS/Lambda`、ディメンション `CapacityProviderName`）で台数を見る。EC2 の managed resource visibility を切り替えてインスタンスとボリュームを確かめ、数日後に請求の明細と突き合わせる。

### 35-runtime

Lambda の実行環境で、同時実行、ワーカースレッドの数、スケーリング、スロットリング（429）、インスタンスの入れ替え、タイムアウト後もコードが動き続けることを一度も観測していない。手元のテストが再現しているのは、1 つの Node.js プロセスと、自分で起こした worker_threads だけ。

再開手順: デプロイ後に `vp run lmi:smoke` を通し、負荷をかけて `ConcurrencyThrottles`、`CPUThrottles` と実行環境の数を見る。負荷試験は 32章の方針に従う。

### 35-network

インスタンスが VPC から届く必要のある宛先を、CloudWatch Logs と X-Ray のほかに確認できていない。CloudWatch Logs のインターフェースエンドポイントだけのプライベートサブネットで関数のバージョンが ACTIVE になるかは未確認。

再開手順: 既定の構成でデプロイし、関数のバージョンが ACTIVE になるかを見る。ならなければ `vp run net:infra:deploy -c egress=nat` で試し、VPC Flow Logs で拒否された宛先を調べる。

### 36-live-model

36章は実際の Bedrock を一度も呼んでいない。実際の ConverseStream がツールの要求をこの章のスキーマとフィクスチャの形で返すこと、実際のモデルの振る舞い（ツールをいつ呼ぶか、断られたあと、ノートの指示、名指ししたツールの入力がスキーマに合うか）、評価の 4 ケースが通るかは未確認。Nova 2 Lite で toolChoice の名指しと cache checkpoint が通ること、Claude Haiku 4.5 で outputConfig.textFormat が jp. の profile 経由で通ること、キャッシュに当たること、Price List で USD 0 の cache write が請求でどう数えられるかも未確認。

再開手順: examples/36-bedrock/.env を用意して vp run bedrock:eval:live を実行する（課金される）。BEDROCK_MODEL_ID を替えて両方のモデルで回す。イベントの形が違えば src/converse.ts と fixtures/transcripts を直す。

### 36-deployed-stack

36章のスタックはデプロイしていない。cdkd が Cloud Control API 経由で AWS::Bedrock::Guardrail と GuardrailVersion を作成、更新、削除できること、sensitive information filters だけのガードレールが作れること、bedrock:ApplyGuardrail を自分のガードレールに絞ったロールでガードレール付きの ConverseStream が通ること、function URL のイベントの requestContext.authorizer.iam.userId が引き受けたロールでどういう値になるか、DynamoDB の条件付き更新が同時のリクエストで予算を守ること、出力の途中でガードレールが止めたときに届く断片、往復のある呼び出しでの text unit の数え方は未確認。

再開手順: vp run bedrock:infra:deploy、vp run bedrock:smoke、vp run bedrock:logs、vp run bedrock:infra:drift、vp run bedrock:infra:destroy の順に実行する。-c promptAttackFilter=standard を付けたデプロイも一度確かめる。

### 36-batch-job

batch inference のジョブは作っていない。入力ファイルの形と上限の検査は手元で確かめたが、S3 のバケット、サービスロール、CreateModelInvocationJob、出力の実際の形は未確認。structured outputs が batch で使えるかは、ドキュメントの 2 つのページ（batch-inference と structured-output）が食い違っている。

再開手順: vp run bedrock:batch:plan の出力を S3 に置き、batch-iam-sr のとおりにサービスロールを作ってジョブを作成する。出力を src/batch.ts の parseOutputLine に通す。

### 36-agentcore

Amazon Bedrock AgentCore と Agents Classic は動かしていない。本文はドキュメントに書かれた構成の紹介だけ。

再開手順: AgentCore の Harness か Runtime で同じツールを動かし、呼び出した人の ID がツールまでどう届くかを確かめる。

### 37-cloudshell-node

CloudShell の Node.js の版はドキュメントに書かれておらず、aih-cloudshell.mjs（esbuild の target は node18）がそこで動くかは確かめていない。Node.js 18 でも実行していない。

再開手順: 手元で vp run cloudshell:build を実行し、CloudShell を東京リージョンで開いて Actions の Upload file で dist/aih-cloudshell.mjs を上げる。node --version を記録し、node aih-cloudshell.mjs whoami を実行する。

### 37-cloudshell-cli-shapes

偽物の aws が返す形が本物と同じかは確かめていない。空のプレフィックスに対する --query 'Contents[].Key' の出力、--max-items 付きの list-object-versions の NextToken、quiet モードの delete-objects の成功時の出力、cdkd が実際に書く state.json。

再開手順: 02章の hello スタックをデプロイしたアカウントで、CloudShell から left を実行する。07章のバケットに数個のオブジェクトを上書きと削除を交えて置き、empty を --yes なし、ありの順に実行して、数と結果を比べる。食い違えば src/stacks.ts と src/empty.ts のスキーマを直す。

### 37-cloudshell-policies

allowShell、denyShell、denyPublicEnvironments を実際のロールに付けたときの動作は確かめていない。src/policy.ts の allowedActions は IAM の評価ではない。

再開手順: vp run cloudshell:policy use-no-files の出力だけを付けたロールでコンソールを開き、CloudShell が開くこと、Actions の Upload file が断られること、aws sts get-caller-identity が通ることを見る。deny を足して開かなくなることを見る。IAM のポリシーシミュレーターでも 11 個のアクションを確かめる。

### 37-cloudshell-nix

CloudShell に Nix を入れられるか、入れた場合にセッションをまたいで残るかは試していない。ホームディレクトリの外の空き容量と CPU アーキテクチャもドキュメントから確認できなかった。

再開手順: CloudShell で uname -m と df -h / /home を記録する。Nix の公式インストーラを --no-daemon で実行して結果を記録し、Actions の Restart のあとに /nix が残っているかを見る。

### 37-cloudshell-vpc

VPC の中の CloudShell の環境は作っていない。11章の既定の構成（NAT なし）に置くと S3 と DynamoDB 以外の API に届かない、というのはドキュメントからの推論。

再開手順: net:infra:deploy のあと、CloudShell の + から Create VPC environment を選び、11章のプライベートサブネットとセキュリティグループを指定する。aws sts get-caller-identity と aws s3 ls の結果を比べ、使い終えたら環境を消してネットワークインターフェースが残っていないかを見る。

### 37-remote-editor

Session Manager を通した SSH と、AWS Toolkit for VS Code からの EC2 への接続は実行していない。23章のスタックは SSH の鍵を登録していない。Cloud9 を終える日付、CodeCatalyst が新規受付を閉じた日付、SageMaker Studio の Code Editor の前提と料金も確認していない。

再開手順: 23章のインスタンスに Session Manager で入り、ec2-user の authorized_keys に公開鍵を足してから、本文の ProxyCommand で ssh i-... を試す。Cloud9 と CodeCatalyst は、それぞれのユーザーガイドの告知と AWS Lifecycle Changes のページをブラウザで開いて読む。

### 38-datasync-run

38章の DataSync のタスクを AWS で一度も実行していない。未確認: cdkd 0.296.28 が `AWS::DataSync::LocationS3` と `AWS::DataSync::Task` を Cloud Control API 経由で作れること、`AWS::Logs::ResourcePolicy` の作成、大阪リージョンのスタックのデプロイに追加の準備が要るか、ロケーションの作成時にロールの権限が検査されること、別リージョンのロケーションの ARN を持つ Basic モードのタスクが動くこと、スケジュールでの実行、DataSync が何を「変わった」と判定するか（とくにタグだけの変更とマルチパートで書かれたオブジェクト）、実行中にソースが変わったときの結果、フィルターで外したオブジェクトが REMOVE で消えるかどうか、バージョニングを有効にしたアーカイブで削除が削除マーカーになること、EventBridge のイベントの実物の形と SUCCESS・ERROR 以外の状態の綴り、何もコピーしない実行の S3 リクエストの数と料金。

再開手順: `vp run move:infra:deploy` の出力の `SourceLocationArn` を控え、`vp run move:archive:infra:deploy -c sourceLocation=<ARN>` を実行する。本文「デプロイ」の順に、東京のバケットにオブジェクトを置き、`aws datasync start-task-execution --region ap-northeast-3 --task-arn <TaskArn>` で実行して `describe-task-execution` の数を読む。同じ実行をもう一度行い、コピーが 0 件になることと、請求の S3 リクエストを確かめる。最後に `vp run move:empty --yes`、`move:archive:infra:destroy`、`move:infra:destroy`。

### 38-cross-account

アカウントをまたぐコピーを試していない。`-c writerRole=<ARN>` はアーカイブのバケットポリシーに 1 つのステートメントを足すだけで、ソース側のアカウントでのロール、ロケーション、タスクの作成は、この章のスタックに含まれていない。R2 とのあいだのコピー（DataSync の object storage ロケーション、Super Slurper、Sippy）も実行していない。

再開手順: DataSync のユーザーガイドの「Transferring data between Amazon S3 buckets across AWS accounts」の手順に沿って、ソース側のアカウントでロールを作り、その ARN を `-c writerRole=` に渡してアーカイブのスタックをデプロイする。ロケーションは `aws datasync create-location-s3` で作る。

### 39-cdkd-dms

39章のスタックを cdkd 0.296.28 でデプロイできるかを確かめていない。インストールしたパッケージには AWS::DMS の専用の実装がなく、AWS::DMS::ReplicationInstance は作れない種類の一覧にある。Cloud Control API の対応一覧（最終更新 2025-12-23）に AWS::DMS::Endpoint と AWS::DMS::ReplicationSubnetGroup はない。

再開手順: `aws cloudformation describe-type --type RESOURCE --type-name AWS::DMS::Endpoint`（と ReplicationSubnetGroup）で `ProvisioningType` を読む。FULLY_MUTABLE か IMMUTABLE なら `vp run dbmig:infra:deploy` を試す。NON_PROVISIONABLE なら、このスタックは AWS CDK CLI だけで管理し、本文「cdkd でデプロイできる範囲」の表を直す。

### 39-dms-run

39章の移行を AWS で一度も実行していない。未確認: `text` の主キーが PostgreSQL どうしの移行で失敗するか、LobMaxSize 64 KB で 10,000 文字の本文が切り詰められないか、ターゲットのユーザーが `SET session_replication_role = replica` を実行できるか、HeartbeatSchema のスキーマを先に作る必要があるか、出ていく通信を 5432 番と VPC 内の 443 番に絞ったセキュリティグループで Serverless のレプリケーションが動くか、開始していない設定と止めた後のレプリケーションの課金、設定を消したときにソースのスロットが消えるか、DMS のロググループの保持期間、full load の所要時間・遅れ・停止時間。

再開手順: 本文「デプロイ」の順に進める。11章の VPC を `-c interfaceEndpoints=secretsmanager` でデプロイし、RDS for PostgreSQL と Aurora PostgreSQL を用意して、`vp run dbmig:preflight`、`aws dms start-replication`（premigration assessment つき）、`aws dms describe-replication-table-statistics`、`vp run dbmig:verify`、`aws dms stop-replication`、`vp run dbmig:sequences --apply` を実行し、所要時間と遅れを記録する。最後に「片付け」の順で消し、ソースの `pg_replication_slots` を確かめる。

### 39-other-sources

Neon を AWS DMS のソースにできるか、`wrangler d1 export` の出力を PostgreSQL に読み込めるかを試していない。DMS のソースの一覧に Neon と SQLite はなく、Neon のドキュメントは DMS を Neon をターゲットにする場合だけ扱っている。

再開手順: Neon のプロジェクトでロジカルレプリケーションを有効にし、DMS のソースのエンドポイントの接続テストと full load を試す。D1 は小さなデータベースを `wrangler d1 export` で書き出し、PGlite に読み込んで、直す必要のある型と構文を記録する。

### 40-deploy

40章の stack を AWS に一度もデプロイしていない。cdkd 0.296.28 が interface endpoint（drs、ec2）と `AWS::EC2::SecurityGroupEgress` を Cloud Control API 経由で作れること、別の stack のロールへ managed policy を付けられること、EventBridge の rule から関数が呼ばれることが未確認。

再開手順: 11章と 23章をデプロイした後に `vp run dr:infra:deploy -c sourceRoleName=<role> -c sourceSecurityGroupId=<sg>`、`vp run dr:infra:drift`、23章の `vp run ec2:infra:drift` を通す。終わったら「片付け」の順に消す（endpoint は時間課金）。

### 40-agent

AWS Replication Agent を一度も入れていない。Graviton の Amazon Linux 2023（kernel 6.12 以下）で installer が通ること、managed policy から cross-account と source network の権限を除いたこの章の policy で足りること、private DNS の interface endpoint を `--endpoint` なしで使えること、IMDSv2 必須で hop limit 1 の設定で動くこと、S3 gateway endpoint だけで installer と replication server のソフトウェアを取得できることが未確認。

再開手順: `-c amiId=` で kernel 6.12 以下の AMI を固定した 23章のインスタンスに、`vp run ec2:session` で入って installer を実行する。失敗したら、まず AWS 管理の `AWSElasticDisasterRecoveryEc2InstancePolicy` に付け替えて権限の不足かどうかを切り分ける。

### 40-drill

訓練、復旧、failback を一度も実行していない。したがって RPO と RTO の実測値は無い。`lagDuration` の実際の書式、`StartRecovery` の job が完了するまでの時間、起動した instance が SSM に現れること、data volume が同じ UUID でマウントされること、reversed replication と元の instance への launch、切り離してから課金が止まるまでの時間が未確認。

再開手順: 初期同期が終わったら `vp run dr:status`、`vp run dr:drill --apply`、`vp run dr:job --job <id>`。`drill/record.template.json` を写して時刻を埋め、確認が済んだら `vp run dr:terminate --apply`、最後に `vp run dr:billed`。

### 40-cfn-drs-types

2026-10-13 に取得した CloudFormation の resource provider schema では、`AWS::DRS::*` が us-east-1 と us-west-2 にあり、ap-northeast-1 など 5 リージョンには無かった。全リージョンを調べたわけではなく、registry への問い合わせ（認証情報が要る）もしていない。`-c templates=declare` は一度もデプロイしていない。

再開手順: `aws cloudformation describe-type --type RESOURCE --type-name AWS::DRS::ReplicationConfigurationTemplate --region ap-northeast-1` で確かめる。あれば `vp run dr:infra:deploy -c templates=declare` を試し、初期化の順序（先に `initialize-service` が要るか）を記録する。

### fargate-deploy

41章のスタックは一度もデプロイしていない。cdkd 0.296.28 が capacity provider strategy 付きのサービス、クラスターの CapacityProviders、EcsParameters を持つ Schedule、Cloud Control 経由の scaling policy 2 つを作れることは、ソースを読んだだけ。

再開手順: 11章の VPC をデプロイし、fargate:infra:deploy、fargate:bundle、fargate:image:build f1、fargate:image:push f1、fargate:infra:deploy -c imageTag=f1 の順に実行して、ecs describe-services の capacityProviderStrategy と、application-autoscaling describe-scaling-policies を確かめる。終わったら destroy する。

### fargate-spot-order

Spot の中断のとき、ALB からの登録解除と SIGTERM のどちらが先かを、読んだページから確定できなかった。本文とテストは、同時に届く最悪の場合を仮定している。Spot の東京の単価も Price List に無く、料金のページの表はスクリプトで埋まるため読めていない。

再開手順: Spot のタスクを動かし、aws ecs stop-task では再現できないので、EventBridge の ECS Task State Change（stopCode が SpotInterruption）と ALB のアクセスログの時刻を突き合わせる。単価は料金のページをブラウザで開いて読む。

### fargate-scaling-model

target tracking のアラームが何分で動くか（モデルでは増やす側 3 分、減らす側 15 分）と、スケールインで一度に何個減るかは、一次情報に数値が無く、モデルの仮定のまま。

再開手順: デプロイ後に aws application-autoscaling describe-scaling-policies の Alarms からアラームの名前を取り、aws cloudwatch describe-alarms で EvaluationPeriods と Period を読み、src/model-defaults.ts の数値を置き換える。負荷をかけて describe-scaling-activities と比べる。

### fargate-scheduler-input

Scheduler の ECS 用テンプレートターゲットで Target の Input が何として渡るか（RunTask の overrides なのか）を一次情報で確認できなかったため、サンプルは Input を使っていない。ジョブは予定時刻を受け取らない。

再開手順: デプロイ後に Input に containerOverrides の JSON を入れたスケジュールを 1 つ作り、起動したタスクの describe-tasks の overrides を見る。

### fargate-exec-session

ECS Exec は一度も実行していない。既定のログ設定（DEFAULT）でセッションの内容がタスクのロググループに出るのか、そのためにタスクロールへログの権限が要るのか、Nix の devShell の AWS CLI に Session Manager plugin が入っているのかは未確認。

再開手順: -c exec=true でデプロイし、aws ecs describe-tasks で ExecuteCommandAgent が RUNNING になるのを待って fargate:exec を実行する。CloudTrail の ExecuteCommand とロググループを確かめたら、exec なしでデプロイし直す。

### 42-firewall-manager-deploy

42章の 2 つのスタックを AWS に一度もデプロイしていない（組織が無い）。未確認: cdkd 0.296.28 が Cloud Control API 経由で `AWS::FMS::Policy` と `AWS::FMS::NotificationChannel` を作成・更新・削除できること、`IncludeMap` の `ORGUNIT` と文字列の `ManagedServiceData` が受け付けられること、Firewall Manager の実際の判定がこの章のモデル（範囲、タグ、「許された幅に収まる」、送信元がセキュリティグループのルール）と同じかどうか、`overrideCustomerWebACLAssociation` が false のときの既存の web ACL の扱い、リソースの作成から準拠の報告と web ACL の関連付けまでの時間、Security Hub に届く finding の実際のフィールドとアカウント、SNS の通知チャンネルに届くメッセージの内容、ポリシーの削除後にメンバーアカウントに残るもの、ポリシーの料金の日割りと usage type。

再開手順: 練習用の OU（アカウント 1〜2 個）を用意し、本文「デプロイして確かめる」の順に進める。Organizations のすべての機能、Firewall Manager の管理者アカウントの指定、対象のアカウントと管理者アカウントでの AWS Config（us-east-1 と ap-northeast-1、連続記録）、Security Hub CSPM を済ませたあと、`vp run fwm:infra:deploy -c adminAccountId=<ID> -c orgUnitIds=<ou-id>` と `vp run fwm:edge:infra:deploy`（同じコンテキスト）を実行し、コンソールで準拠の状態と違反の詳細を手元のモデルと比べる。次に `-c wafRemediation=on` と `-c sgRemediation=on` で再デプロイし、関連付けまでの時間、finding のイベントの実物（Notifier のログ）、SNS のメッセージを記録する。最後に 2 つの destroy を実行し、メンバーアカウントに残った web ACL と AWS Config のルールを確かめる。ポリシーは 1 つ月 USD 100。

### glue-script-not-executed

glue/curate.py を一度も実行していない。手元には Spark が無く、AWS にも触れていない。スクリプトが src/curate.ts の仕様どおりに動くことは、主張であって確認した事実ではない。とくに、user schema に dt STRING を足したときのパーティションの読み取り、FAILFAST が型の合わない項目で止まること、DataFrame.isEmpty、awsgluedq の process_rows が Glue 5.1 で同じ形の結果を返すこと、上書きで dt=<日>/ のフォルダーだけが置き換わること。

再開手順: vp run glue:infra:deploy、vp run glue:seed、vp run glue:run --days 2026-10-10,2026-10-11 の順に実行し、state が SUCCEEDED になることを確かめる。続けて vp run glue:verify を実行し、2 日とも identical to the specification と表示されることを確かめる。同じ glue:run をもう一度実行して、glue:verify の結果が変わらないことを確かめる。

### glue-role-minimum

job のロールが足りているかを確かめていない。ロールにあるのは、バケットの一覧、raw の読み取り、curated の読み書きと削除、スクリプト 1 つの読み取り、2 つのロググループへの書き込みだけで、glue: と cloudwatch: のアクションは 1 つも無い。Glue 5.1 の job が、bookmark を無効にし Data Quality の結果を公開しない設定でも Glue の API を呼ぶか、既にあるロググループに logs:CreateLogGroup を求めるか、S3 のコネクターが curated のプレフィックスの外にマーカーのオブジェクトを書くかは、ドキュメントから読み取れなかった。

再開手順: glue:run が AccessDenied で失敗したら、ロググループ /aih/glue/curate/error と CloudTrail で、拒否されたアクションとリソースを調べる。そのアクションだけを infra/lib/glue-stack.ts のロールに足し、テストの期待値を直す。

### glue-dq-model

src/quality.ts の evaluate は、DQDL のリファレンスを読んで書いたこの章のモデルで、AWS Glue Data Quality ではない。between が両端を含まないこと、ColumnValues で NULL が失敗になることはリファレンスの記述どおり。IsUnique が NULL をどう数えるか、行が 0 件のときの結果、数値の = の比較のしかたは確かめていない。

再開手順: デプロイ後、status が 600 の行を 1 つ含む raw ファイルを requests_json/dt=<日>/ に置いて glue:run を実行する。state が FAILED になり、エラーに ColumnValues "status" between 99 and 600 が出ることと、その日の curated のフォルダーが前のままであることを確かめる。

### glue-failure-signal

失敗の通知を確かめていない。Glue Job State Change の detail の項目名（jobName、state）は、AWS のドキュメントのページがリダイレクトになっていたため、aws-cdk の aws-glue-alpha のソースから取った。AWS/Events の MatchedEvents がこのルールで記録されること、アラームが 1 日のあいだ ALARM にとどまることも未確認。

再開手順: デプロイ後、トピックにメールを購読させる。JSON として読めない行を含むファイルを requests_json/dt=<日>/ に置き、その日を指定して glue:run を実行して失敗させる。メールに jobName と state が入っていること、CloudWatch のアラームが ALARM になることを確かめる。

### glue-cdkd-deploy

cdkd 0.296.28 でこのスタックをデプロイしていない。ソースから読み取っただけの点: スクリプトのファイルアセットが cdkd のアセット用バケットに置かれ、ScriptLocation とロールの ARN の中のバケット名がそこへ書き換えられること。Glue の trigger の更新で StartOnCreation が送られないこと（-c schedule=on をあとから付けても、既にある trigger は有効にならない）。

再開手順: vp run glue:infra:deploy の後、aws glue get-job --job-name aih-glue-curate で ScriptLocation のバケットを見て、aws s3 ls でそのオブジェクトがあることを確かめる。-c schedule=on を付けてもう一度デプロイし、aws glue get-trigger --name aih-glue-curate-daily の State を見る。CREATED のままなら aws glue start-trigger で有効にする。

### glue-run-duration

run にかかる時間を測っていない。料金の表は、最低の 1 分、仮定の 3 分、タイムアウトの 10 分の 3 通りを計算しただけ。起動にかかる時間が課金に入るかどうかも確かめていない。

再開手順: glue:run が表示する execution time を数回ぶん記録し、請求の ETL-DPU-Hour の数量と比べる。

### health-no-real-event

実際の Health イベントを 1 件も受け取っていない。イベントの形はドキュメントの表とサンプルから書いた。表とサンプルが食い違う項目（lastUpdatedTime の有無、persona の綴り）、AWS Health Abuse Event の detail の形、グローバルなイベントの eventRegion の値、表に無い項目の有無は未確認。

再開手順: vp run health:infra:deploy と vp run health:global:infra:deploy の後、イベントが届くのを待つ（障害は起こせない。予定された変更や通知は月に数件届くことがある）。届いたら関数のロググループで sent、ignored、unreadable の行を読み、UNREADABLE の通知が来た場合は本文の「What did not fit」に従って src/event.ts のスキーマを直し、届いた JSON を個人情報を除いて fixtures に足す。

### health-service-codes

detail.service に入るサービスのコードの一覧は、ドキュメントに無い。確認できたのは EC2、LAMBDA、ELASTICLOADBALANCING、VPC、AUTOSCALING、RDS（文中の例）、EBS と S3（イベントタイプコードからの読み取り）、MULTIPLE_SERVICES（公開ページのデータで観測）だけ。DynamoDB、API Gateway、CloudFront、Cognito、SQS、SNS などのコードは未確認で、SERVICES に入れていない。

再開手順: EventBridge のコンソールでルールを作る画面を開き、Service name に Health、Specific service(s) を選ぶと、コードの一覧が出る（ドキュメントの手順にある）。サポートプランがあれば aws health describe-event-types でも取れる。確かめたコードを src/watch.ts の SERVICES に足す。それまでは、一覧に無いサービスの public な障害は INFO として届き、件名にコードが出る。

### health-deploy-unverified

スタックを cdkd でデプロイしていない。us-east-1 への 2 つ目のスタックのデプロイ（bootstrap がそのリージョンに要るかどうかを含む）、ルールから関数への権限、関数の実行、TTL、デッドレターキュー、SNS の件名と本文がメールでどう見えるかは未確認。-c alarmTopicArn で 19章のトピックを渡したとき、関数のロールの許可だけで publish できるか（19章のトピックポリシーは CloudWatch だけを許可している）も確かめていない。

再開手順: vp run health:infra:diff、vp run health:infra:deploy -c alarmEmail=<address>、続けて vp run health:global:infra:deploy -c alarmEmail=<address> を実行し、確認メールを承認する。EventBridge のコンソールのルールの画面で「Use sample events provided」から Health のサンプルを選び、パターンに一致するかを見る（イベントは送られない）。関数のテスト実行に fixtures/documented.json の event を渡すと、台帳と SNS まで通して確かめられる。終わったら destroy する。

### health-support-plan-pages-disagree

Health API に要るサポートプランの名前が、ユーザーガイド（Business Support+、Enterprise Support、Unified Operations。移行前や提供の無いリージョンでは Business、Enterprise On-Ramp、Enterprise）と、API リファレンスの Welcome（Business、Enterprise On-Ramp、Enterprise のみ）で食い違っている。古いプランがいつまで有効かは、読んだページからは分からなかった。

再開手順: https://aws.amazon.com/premiumsupport/plans/ と AWS Health のユーザーガイドの冒頭を読み直す。自分のアカウントのプランは Support Center で確かめる。

### 45-composer-vscode

VS Code の Infrastructure Composer を開いていない。cdk.out の JSON のテンプレートを開けるか、どのリソースが enhanced component card になるか、開いて保存しただけでテンプレートがどう変わるか、図の表示に認証情報が要るかは確かめていない。

再開手順: VS Code に AWS Toolkit を入れ、vp run hello:infra:synth のあと examples/02-toolchain/cdk.out/AihHello.template.json を開いて Infrastructure Composer のボタンを押す。線を vp run composer:graph:hello の出力と比べる。ファイルを複製して図から何も変えずに保存し、vp run composer:graph ../02-toolchain AihHello --against <複製> と diff で元と比べる。

### 45-template-studio

template studio を開いていない。このモジュールのグラフが template studio の図と同じ線になるか、手元のファイルを読み込む手順があるかは確かめていない。template studio が告知の言う置き換えのエディタだというのは、以前の Infrastructure Composer のページの URL が template studio のページを返すことからの判断。

再開手順: CloudFormation のコンソールでナビゲーションの Template studio を開き、examples/20-shipping/cdk.out/AihShipApi.template.json の中身をエディタに貼り付ける。図の線を vp run composer:graph:ship の connections と 1 本ずつ比べ、違いがあれば src/graph.ts のたどり方を直す。保存はしない。

### 45-cfn-cycle

参照が輪になったテンプレートを CloudFormation がどう扱うかは、読んだページから確認できなかった。

再開手順: CloudFormation のユーザーガイドで circular dependency の記述を探す。見つからなければ、輪のある 2 リソースのテンプレートを aws cloudformation validate-template にかけて応答を記録する（読み取りだが認証情報が要る）。

### shield-deploy-not-run

AihShield と AihShieldEdge を実際の AWS にデプロイしていない。function URL を直接呼ぶと 403 になること、CloudFront 経由で /health がキャッシュされること、クエリ文字列を変えても同じオブジェクトになることは、ドキュメントとテンプレートから読んだだけ。

再開手順: vp run shield:infra:deploy のあと、出力 FunctionUrl に curl -i して 403 を、出力 Url の /health に curl -i を 2 回して 2 回目の x-cache が Hit from cloudfront で x-request-id が同じことを、/health?x=1 でも同じことを確かめる。

### shield-rate-rule-timing

レートベースのルールが実際に何秒で効き始めるかを計測していない。シミュレーションの 30 秒は、ドキュメントが「ふつうはそれ未満」と書く値を仮定に使ったもの。ブロックされたリクエストが数え続けられることも、ドキュメントの文面からの読み取り。

再開手順: AihShieldEdge を付けた AihShield に、自分の 1 アドレスから毎秒 10 件を 3 分送り、最初の 403 までの秒数と、送るのをやめてから通るまでの秒数を記録する。自分のリソースに自分で送る範囲に留める。

### shield-function-url-brake

予約済み同時実行数を付けた function URL が、毎秒 10 倍の件数で 429 を返し始めることと、CloudFront がその 429 をどう返すか（キャッシュするかどうかを含む）を確かめていない。モデルのバースト（予約 1 単位につき 1 件）は、この章の仮定。断られた呼び出しに Lambda の料金がかかるかどうかも確認していない。

再開手順: vp run shield:infra:deploy -c reservedConcurrency=1 のあと、/notes に毎秒 30 件ほどを 10 秒送り、429 の割合、ヘッダー、x-cache を記録する。翌日に請求の Lambda の Request 数と CloudWatch の Invocations、Throttles を比べる。

### shield-waf-metric-dimensions

アラームが見ている AWS/WAFV2 の BlockedRequests を、CloudFront 用の web ACL に対して WebACL と Rule の 2 つのディメンションだけで引けることを、実際のメトリクスで確かめていない。

再開手順: AihShieldEdge をデプロイしてルールを 1 度発動させ、us-east-1 で aws cloudwatch list-metrics --namespace AWS/WAFV2 --metric-name BlockedRequests を実行して、ディメンションの組を見る。違っていたら infra/lib/edge-stack.ts を直す。

### shield-advanced-not-subscribed

Shield Advanced は契約していない。AWS::Shield::Protection を cdkd 0.296.28（専用の実装が無く Cloud Control API 経由）で作れること、CloudFront の保護を us-east-1 のスタックに書いてよいこと、DDoSDetected のディメンション名が ResourceArn であること、契約前のデプロイがどう失敗するかは、どれも確かめていない。SRT、費用の保護、proactive engagement、health-based detection は、ドキュメントを読んだだけ。

再開手順: 契約済みのアカウントで vp run shield:edge:infra:deploy -c shieldAdvanced=on -c distributionArn=<AihShield の DistributionArn> を実行し、Shield のコンソールで保護を、us-east-1 の list-metrics --namespace AWS/DDoSProtection でディメンションを確かめる。契約は 1 年で USD 36,000 になるので、このためだけには行わない。

### shield-flat-rate-plan

CloudFront の flat-rate pricing plan は試していない。この章のディストリビューション（function URL のオリジン、OAC）がプランに入れられること、CloudFormation からプランを指定できるかどうか、許容量を超えたときの実際の挙動は確かめていない。

再開手順: デプロイしたディストリビューションを CloudFront のコンソールで開き、プランの選択画面で Free を選べるか、断られるなら理由を記録する。AWS Free Tier を使っているアカウントは対象外とドキュメントにある。

### shield-alb-closing-not-deployed

ALB を CloudFront だけに閉じる 3 つの形（infra/lib/alb-origin.ts）は、テンプレートを synth してこの章の検査にかけただけで、どのスタックにも入れていない。VPC origin と prefix list の ID の調べ方は実環境で試していない。

再開手順: 12章のスタックに prefixListLoadBalancer の形を入れ、aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing で ID を調べてデプロイし、ALB の DNS 名に直接 curl して届かないことを確かめる。ALB は時間課金。

### 47-test-state

47章の手元の実行器は自作のモデルで、本物の Step Functions と突き合わせていない。未確認: JSONata の式（`$merge`、`&` での連結、`$exists`、`$count`、要素が 1 つの配列の扱い）を Step Functions が同じ値に評価すること。Retry と Catch の選び方、`MaxAttempts: 0` の retrier の扱い。`Output` を省いたときの既定（仕様書の 2 か所で記述が食い違う）。

再開手順: 認証情報を用意して `vp run sfn:test-state` を実行する。スタックは要らず、モックを使うので他のサービスは呼ばれない。`DIFFERENT` と出た行が、モデルの誤りか、表の誤り。直したら `vp test run examples/47-step-functions` で表と実行器が一致することを確かめる。

### 47-deploy

47章のスタックを AWS に一度もデプロイしていない。未確認: cdkd 0.296.28 が、`Fn::Join` で組み立てた JSONata の `DefinitionString` と `LoggingConfiguration` つきの Express ステートマシンを作れること。ロールの信頼ポリシーの条件が通ること。各ステートの権限が足りること（特に、`aws-sdk:s3:copyObject` に `s3:GetObject` と `s3:PutObject` だけで足りるか）。DynamoDB の条件式が意図どおりに働くこと、エラー名が `DynamoDB.ConditionalCheckFailedException` であること。コピー元がないときのエラー名。`sqs:sendMessage.waitForTaskToken` が `MessageBody` のオブジェクトを JSON の文字列として送ること。ハートビートが途切れたときのエラー名（ドキュメントのページによって `States.Timeout` と `States.HeartbeatTimeout` に分かれる）。再試行で新しいトークンが配られること。redrive が補償処理のステートから再開すること。Express の実行時間と課金されるメモリ、状態遷移の実際の数（Map の繰り返しの数え方を含む）。

再開手順: `vp run sfn:infra:deploy`、`vp run sfn:start`、`vp run sfn:callback --verdict clean`、`vp run sfn:status`、`vp run sfn:digest --ids note-1,nope` の順に実行する。失敗の経路は、別のノート ID で `sfn:start` し、`sfn:callback --verdict infected` で確かめる。補償処理の失敗は、実行中にロールから `s3:DeleteObject` を一時的に外して起こし、戻してから `vp run sfn:status --redrive <ARN>` で再開する。終わったら `vp run sfn:empty --yes` と `vp run sfn:infra:destroy`。

### 48-real-service-errors

本物のサービスが返すエラーの形、ステータス、リクエスト ID、x-amz-retry-after の有無を確かめていない

再開手順: 05章か 32章のスタックをデプロイし、attemptLogPlugin を付けたクライアントでスロットリングを起こして、ログの status、error、awsRequestId を見る

### 48-https-and-connection-timeout

HTTPS のエンドポイントでの接続の挙動と connectionTimeout を確かめていない。手元のサーバーは平文の HTTP

再開手順: 自己署名証明書の HTTPS サーバーを examples/48-sdk に足すか、応答しないアドレスに connectionTimeout を設定したクライアントを向けて、TimeoutError になるまでの時間を計る

### 48-retries-2026-default-date

2026 年の再試行の動作がいつ既定になるかを確認できていない。DynamoDB Streams の 4 回、DynamoDB の 25 ミリ秒で実際に待つところも未確認

再開手順: リファレンスの Retry behavior が指している告知の記事を読む。SDK を上げるたびに vp test run examples/48-sdk を実行し、defaults.test.ts が落ちたら PINNED_DEFAULTS と本文の表を直す

### 48-adaptive-mode

adaptive モードを動かしていない

再開手順: retryMode: "adaptive" のクライアントをスロットリングだけ返す台本に向け、最初のリクエストが遅らされることを届いた時刻で確かめる

### 48-credential-sources

環境変数とプロファイルの静的なキー以外の取得元（Lambda、ECS、EC2、IAM Identity Center、aws login、ロールの引き受け、credential_process、Web identity）を通していない

再開手順: aws login を済ませた端末で vp run sdk:credentials を実行し、sources と tried を見る。Lambda では reportDefaultCredentials の結果をログに出す

### 48-presign-expiry

署名付き URL が認証情報の失効で切れるところ、Lambda の実行ロールの認証情報の残り時間、PutObject の署名付き URL の空のチェックサムが実際のアップロードに与える影響を確かめていない

再開手順: 07章のスタックで、関数の中で config.credentials() の expiration をログに出す。PutObject の URL に本文を PUT して、S3 の応答を見る

### 48-client-mock

aws-sdk-client-mock を固定している版の SDK と組み合わせて試していない

再開手順: examples/48-sdk に devDependency として足し、DynamoDBDocumentClient の send を置き換えるテストを 1 つ書いて通るかを見る

### 48-update-add-twice

DynamoDB の UpdateItem が同じ ADD を 2 度受け取って 2 度足すことを、本物でも DynamoDB Local でも確かめていない

再開手順: 05章の DynamoDB Local の手順で起動し、同じ UpdateItemCommand を 2 回送って値を読む

### 48-cloudflare-binding-retries

Cloudflare の binding が再試行とタイムアウトをどこまで受け持つかを確かめていない

再開手順: D1 と R2 の Workers API のページで、再試行とタイムアウトの記述を探す

### athena-sql-not-executed

この章の SQL（パラメーター付きの SELECT、CREATE EXTERNAL TABLE、INSERT INTO、CTAS、UNLOAD、Iceberg の CREATE TABLE、MERGE INTO、OPTIMIZE、VACUUM、FOR TIMESTAMP AS OF）を Athena で 1 つも実行していない。構文はドキュメントの書式に合わせただけ。パラメーターにした dt の条件でパーティションが絞られるか、GROUP BY に全列を並べる重複の除き方が通るかも未確認。

再開手順: 26章のスタックと、この章のスタックを -c lakeBucketName=<26章の LakeBucketName> でデプロイし、26章の analytics:smoke の後に vp run athena:run --name route、create-compact、compact、create-iceberg、merge、merge（2 回目）、yesterday、optimize、vacuum、scratch、unload の順で実行する。それぞれ SUCCEEDED になること、route の scanned がその日のオブジェクトの合計以下であること、merge の 2 回目で行が増えないことを確かめる。

### athena-execution-parameter-parsing

実行パラメーターの値を Athena がどう解釈するかを確かめていない。ドキュメントは、文字列として扱わせるには一重引用符で囲むことと、値に CAST(...) を書けることを述べているので、値は SQL のリテラルや式として読まれると考え、文字列は引用符を二重にして囲んでいる。引用符で囲んだ値が常に 1 つの文字列として扱われるかは未確認。

再開手順: デプロイ後、Athena のコンソールか CLI で SELECT ? AS v を実行し、実行パラメーターに 'O''Reilly'、'a'' OR ''1''=''1'、引用符なしの abc を順に渡して、返る値とエラーを見る。

### athena-enforced-workgroup-writes

結果の保存先を強制するワークグループで、location を指定した Iceberg の CREATE TABLE、TO を指定した UNLOAD、LOCATION を指定した CREATE EXTERNAL TABLE が通るかを確かめていない。ドキュメントが失敗すると明記しているのは、external_location を指定した CTAS だけ。CTAS のテーブルが results/tables/<クエリ ID>/ に置かれることも、ドキュメントの記述のまま。

再開手順: デプロイ後、vp run athena:run --name create-iceberg、--name unload、--name scratch を実行する。scratch の後で aws s3 ls s3://<OutputBucketName>/results/tables/ を見て、ファイルの場所を確かめる。

### athena-analyst-role-sufficient

アナリストのロールの権限で、この章の文がすべて実行できるかを確かめていない。Glue の操作は、ドキュメントの例（GetDatabase、GetTable、GetTables、GetPartitions、CreateTable）に、INSERT INTO と Iceberg のコミットに要ると考えた CreatePartition、BatchCreatePartition、UpdateTable、DeleteTable を足したもの。足りない操作があれば AccessDenied になる。

再開手順: AnalystRoleArn のロールを引き受けて（aws sts assume-role）、athena-sql-not-executed の手順を実行する。AccessDenied が出たら、メッセージの操作名を infra/lib/athena-stack.ts の該当するステートメントに足す。

### athena-result-header-row

GetQueryResults の最初の行が列の名前であることを、API リファレンスでは確認できなかった。クライアントは、最初のページの最初の行が列の名前と完全に一致するときだけ取り除く。1 行だけの結果がたまたま列の名前と同じ値だと、その行を落とす。

再開手順: デプロイ後、vp run athena:run --name route を実行し、表示される行と、コンソールの結果を比べる。

### athena-limit-and-cutoff

LIMIT だけのクエリが途中で読むのをやめるか、ワークグループの上限を超えたクエリがどれだけ読んでから取り消されるかを確かめていない。料金のシナリオは、並べ替えや集計のあるクエリは全体を読み、取り消されたクエリは上限ちょうどを読んだものとして計算している。

再開手順: 記録が数日ぶんたまった後、SELECT * FROM aih_analytics.requests LIMIT 10 と、ORDER BY duration_ms DESC LIMIT 10 を付けたものを実行して、scanned を比べる。上限は、--from を 2026-10-01 にした route のクエリが取り消されたときの scanned で見る。

### athena-cdkd-cloud-control

cdkd 0.296.28 が、AWS::Athena::WorkGroup（engineVersion と expectedBucketOwner を含む）と AWS::Athena::NamedQuery を Cloud Control API 経由で作成・更新・削除できるかを確かめていない。

再開手順: vp run athena:infra:deploy の出力で、リソースごとの経路と結果を確かめる。その後 vp run athena:infra:drift、vp run athena:empty --yes、vp run athena:infra:destroy まで実行する。

### athena-log-tables-not-created

CloudTrail、ALB、CloudFront、S3 のアクセスログのテーブル定義は、ドキュメントの文をそのまま保存したもので、どれも Athena で作っていない。この本のスタックは、これらのログを S3 に配送していない。

再開手順: ログの配送を有効にしたバケットがあれば、vp run athena:logs:ddl --kind <種類> --bucket <名前> --prefix <フォルダー> の出力を Athena のコンソールで実行し、SELECT * … LIMIT 10 で列が読めることを確かめる。

### 50-deploy

50章のスタックを AWS に一度もデプロイしていない。cdkd 0.296.28 が `AWS::BedrockAgentCore::Runtime`（`RequestHeaderConfiguration` を持つので Cloud Control API 経由）と `AWS::BedrockAgentCore::Memory` を作れること、direct code deployment の ZIP を cdkd のアセットとして置けて実行ロールが読めること、CommonJS の `app.js` が Node.js 22 で起動すること、X-Ray と `logs:PutResourcePolicy` を省いた実行ロールで足りること、MMDSv2 の既定（`CfnRuntime` に property が無い）が未確認。

再開手順: `vp run agentcore:infra:deploy` のあと、deploy のページの手順で利用者とトークンを作り、`AIH_ACCESS_TOKEN=... vp run agentcore:invoke`、`vp run agentcore:infra:drift` を通す。呼び出しが `ValidationException` なら `metadataConfiguration.requireMMDSV2` を疑う。終わったら `vp run agentcore:infra:destroy` と、`/aws/bedrock-agentcore/runtimes/` で始まるロググループの削除。

### 50-runtime-request

Runtime がエージェントに渡すリクエストの形を実機で見ていない。許可リストに入れた `Authorization` がその名前で届くこと、`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` が届くこと、server-sent events がそのまま流れること、エージェントの 4xx が 424 になること、microVM の中で AWS SDK が設定なしに実行ロールの認証情報を見つけること、`AdminInitiateAuth` で取った Cognito のアクセストークンが `allowedClients` の検査を通ることが未確認。

再開手順: デプロイしたうえで `vp run agentcore:invoke` を実行し、エージェントのロググループで `invocation` の行と `owner` を確かめる。届かないヘッダーがあれば、一時的に `LOG_LEVEL=debug` でヘッダー名だけを出して調べる（トークンの値は出さない）。

### 50-memory

AgentCore Memory を呼んでいない。`CreateEvent` がこの章のペイロード（会話 2 件とメタデータ `seq`）を受け付けること、`clientToken` の重複が無視されること、`ListEvents` が返す形、Cognito の `sub` とこの章のセッション ID（16 進 32 桁、ハイフン、UUID）を `actorId` と `sessionId` として受け付けること、短期記憶の東京の単価が未確認。API リファレンスは `eventExpiryDuration` の下限を 3、クォータのページは 7 と書いている（スタックは 30）。

再開手順: デプロイ後、同じセッションで 2 問聞いて 2 問目が 1 問目を踏まえること、5 分以上あけてからも踏まえることを確かめる。`aws bedrock-agentcore list-events` でイベントの形を見て `src/memory-events.ts` のスキーマと比べる。請求書か Cost Explorer で短期記憶の項目と単価を確かめ、`data/fragments/50.json` に単価を足す。

### 50-status

Runtime の Instances とプラットフォームバージョン V2 が一般提供かプレビューかを書いた一次情報を見つけられなかった。ドキュメントは CloudFormation と CDK が `platformVersion` に未対応と書くが、`aws-cdk-lib` 2.273.0 の `CfnRuntime` には property がある。

再開手順: リリースノートと What's New を読み直す。V2 を試すなら、`platformVersion: "V2"` を足して synth し、Cloud Control API が受け付けるかをデプロイで確かめる（作成に数分かかり、120 秒以内に `/ping` が Healthy を返す必要がある）。

### 51-chime-real-call

51章: 実際の通話を一度も行っていない。未確認: Chime の API の実際の応答の形、終わったミーティングへの GetMeeting と CreateAttendee が NotFoundException になること、IAM のポリシーが 5 つの呼び出しを通すこと（メディアリージョンが東京以外のときの ARN のリージョン）、ブラウザーでのマイク、カメラ、音声、映像、再接続、同じ join token での 2 台目の接続や DeleteAttendee のあとにライブラリーへ届く状態コード、タブを閉じたあと課金が止まる時点。

再開手順: AIH_AWS_ACCOUNT_ID を設定し、vp run calls:infra:deploy、calls:user:create を 2 人ぶん、calls:config、preview:calls:web の順に実行する。2 つのブラウザーで参加し、デプロイのページの 3 つの確認（Remove、Leave、別のタブからの Join）を行い、関数のログで MeetingsError が出ていないことを見る。終わったら calls:end --yes、calls:infra:destroy。

### 51-chime-dynamodb-conditions

51章: DynamoDbRoomStore の条件式（seats.#sub、contains(members, :sub)、size(members)、ADD と DELETE による文字列セットの更新）を DynamoDB に対して実行していない。テストは送る式の形を固定しているだけ。

再開手順: Docker が使える環境で vp run db:local:start（05章）を実行し、DYNAMODB_ENDPOINT と NOTES_STORE=dynamodb を設定して api/test/room-store.test.ts と同じ条件を DynamoDbRoomStore に対して流す。またはデプロイして、2 人で参加、除外、閉鎖を行う。

### 51-chime-idempotency

51章: CreateMeeting に同じ ClientRequestToken を 2 回送ったとき、CreateAttendee に同じ ExternalUserId を 2 回送ったときの応答が、API リファレンスから読み取れなかった。コードはどちらにも頼っていない。

再開手順: デプロイ後、aws chime-sdk-meetings create-meeting を同じ --client-request-token で 2 回呼び、MeetingId を比べる。create-attendee も同じ --external-user-id で 2 回呼び、AttendeeId と JoinToken を比べる。終わったら delete-meeting。

### ecr-lifecycle-not-previewed

ライフサイクルポリシーを ECR で評価していない。src/lifecycle.ts の evaluator は、ドキュメントの評価規則と 6 つの例から書いたもので、例の結果は再現するが、ECR の実装と同じである保証はない。「N 日より古い」の境界、プッシュ時刻が同じイメージの順序、manifest list と reference artifact の扱いは実装していないか、確かめていない。

再開手順: vp run ecr:infra:deploy の後、タグ付き・タグなしを混ぜて数十個のイメージをプッシュし、vp run ecr:lifecycle:compare を実行する。start-lifecycle-policy-preview の結果と evaluator の結果が、ダイジェストとルールの番号まで一致するかを報告する。食い違ったら src/lifecycle.ts を直し、その入力を test/lifecycle.test.ts に足す。

### ecr-nothing-pushed

イメージを 1 つもビルドもプッシュもしていない。immutable なリポジトリが同じタグの再プッシュを拒否すること、同じダイジェストに 2 つ目のタグを付けられること、イメージを消したあとで同じタグを付け直せるかどうか、プッシュ用のロールの権限で docker push が通ること、イメージの実際の大きさは、どれも確かめていない。

再開手順: Docker のデーモンがある環境で、12章の vp run ecs:image:build <tag> でイメージを作り、12章の deploy ページの手順で AihEcr の RepositoryUri にプッシュする。同じタグで別のイメージをプッシュして ImageTagAlreadyExistsException になること、aws ecr describe-images で imageSizeInBytes を読むこと、GitHub Actions からプッシュ用のロールでプッシュできることを確かめる。

### ecr-scan-not-observed

検査結果を 1 件も見ていない。scan on push が走ること、検査結果が無いときの findingSeverityCounts の形（空のオブジェクトか、項目が無いか）、検査が終わるまでの時間、12章のイメージ（node:24-bookworm-slim）が basic scanning の対応 OS に入っているかは確かめていない。

再開手順: イメージをプッシュした後、vp run ecr:scan:gate --digest <ダイジェスト> を実行する。スキーマが応答を拒否したら、応答の形に合わせて src/scan.ts を直す。

### ecr-cache-not-deployed

pull through cache のルールをデプロイしていない。cdkd 0.296.28 が AWS::ECR::PullThroughCacheRule を Cloud Control API 経由で作れること、キャッシュ経由の最初の取得でリポジトリが作られること、プッシュ用のロールの権限でそれが通ることは確かめていない。

再開手順: vp run ecr:infra:deploy -c pullThroughCache=on -c githubRepository=<owner/repo> でデプロイし、docker pull <registry>/ecr-public/docker/library/node:24-bookworm-slim を実行する。aws ecr describe-repositories に ecr-public/docker/library/node が現れることを確かめる。片付けでは、このリポジトリを手で消す。

### ecr-ecs-rollback-digest

ECS がタグをダイジェストに解決するのはデプロイごとだとドキュメントから読んだが、circuit breaker によるロールバックが、前のデプロイで解決したダイジェストを使うのか、タグを解決し直すのかは確認できていない。

再開手順: ECS のドキュメントで service revision の説明を読み、ロールバック先のリビジョンがダイジェストを持つかを確かめる。mutable なリポジトリで実際にタグを動かしてロールバックさせ、動いたタスクの imageDigest を aws ecs describe-tasks で見る。

### 53-deploy

53章のスタックを一度もデプロイしていない。cdkd 0.296.28 の EFS プロバイダーでファイルシステム、マウントターゲット、アクセスポイントが作れること、関数が作成時にマウントターゲットを見つけられること、Deny だけのファイルシステムポリシーが受け付けられること、その下で Lambda がマウントできること（Lambda が TLS でマウントするという記述は 2020 年の公式ブログにしか見つけていない）、アクセスポイントのルートディレクトリが初回のマウントで作られることが未確認。

再開手順: `vp run net:infra:deploy` の後に `vp run efs:infra:deploy`。出力の `ApiUrl` に POST と GET を送り、`aws efs describe-file-system-policy` と `aws efs describe-mount-targets` で設定を確かめ、`vp run efs:infra:drift` を通す。マウントに失敗したら、関数を呼んだときのエラーとログを読み、ポリシーの Deny を外して切り分ける。終わったら `vp run efs:infra:destroy`。

### 53-nfs-behaviour

NFS の上での挙動を一度も観測していない。テストはすべて手元のファイルシステム（macOS の APFS）で動かした。2 つの実行環境のあいだで、rename した直後のファイルや一覧がどれだけ遅れて見えるか（クライアントの属性キャッシュ）、Lambda がどのマウントオプションを使うか、追記の競合が実際にどう壊れるかは、ドキュメントと man ページから読んだだけ。

再開手順: デプロイした関数の同時実行数を 2 以上にして、片方の環境で書いた直後にもう片方で読むリクエストを繰り返し、古い内容が返る割合と時間を記録する。EC2 に同じアクセスポイントをマウントして `mount` の出力でオプションを確かめ、`examples/53-efs/test/two-writers.test.ts` をそのマウント先を `TMPDIR` にして実行する。

### 53-metering

Elastic スループットの計量を実際の請求で確かめていない。「データの操作は最初の 32 KiB のあと 1 KiB 刻み」というドキュメントの文を、32 KiB 以下の読み書き 1 回は 32 KiB として計量される、と読んで計算した。メタデータの操作の回数は数えていない。

再開手順: デプロイ後に決まった回数の書き込みと一覧を送り、CloudWatch の `MeteredIOBytes` と、翌日の Cost Explorer の使用量タイプ `APN1-ETDataAccess-Bytes` を、この章の仮定と比べる。

### 53-s3-files

Amazon S3 Files は概要のページを読んだだけ。料金、東京リージョンで使えるか、バケットとの同期の遅れ、cdkd と CloudFormation での扱いは確かめていない。

再開手順: S3 のユーザーガイドの S3 Files の章（synchronization、metering、quotas）と S3 の料金ページを読み、Price List の AmazonS3 の offer で SKU を探す。

### kinesis-mapping-on-aws

54章: event source mapping の動きは、ドキュメントから作ったモデルでしか確かめていない。実物で未確認なのは、partial batch response と bisect を両方有効にしたときに失敗した 1 件だけが諦められること、分割された batch で再試行の回数がどう数えられるか、失敗の記録が SQS にドキュメントの例どおりの形で届くこと、IteratorAge のメトリクスが詰まっているあいだ増え続けること。

再開手順: vp run kinesis:infra:deploy の後、vp run kinesis:put でリビジョンを書き、vp run kinesis:history で確かめる。次に vp run kinesis:put -- --poison で JSON ではないレコードを 1 件書き、続けて vp run kinesis:put -- --from 6 --count 3 を実行する。数分後に vp run kinesis:failures が 1 件の範囲を出し、vp run kinesis:history が版 8 を示せば、モデルと同じ動き。関数のログの `poison record` の回数が、試行の回数になる。

### kinesis-reshard-and-lambda

54章: shard を split または merge したあと、Lambda の event source mapping が親の shard を読み終えてから子を読むかどうかを、読んだ Lambda のドキュメントから確認できなかった。Kinesis のガイドは、読む側が親を先に読み切るよう求めている。この章のモデルは親を先に読む。

再開手順: デプロイした stream に 1 つのノートのリビジョンを書き続けながら `aws kinesis update-shard-count --target-shard-count 2 --scaling-type UNIFORM_SCALING` を実行し、vp run kinesis:history の missing が 0 のままかを見る。0 でなければ、関数のログで shard ごとの順序を確かめる。shard を 2 つにすると料金も 2 倍になるので、確かめたら 1 に戻す。

### kinesis-idle-bill

54章: 使っていない月の料金のうち、KMS のリクエスト（月に約 105,120 回）は Kinesis のガイドの目安をそのまま使った。AWS 管理のキーでこの回数が実際に請求されるか、関数が動いていないあいだも同じ頻度かは、請求書で確かめていない。

再開手順: デプロイして数日置き、Cost Explorer を usage type で分けて、`APN1-Storage-ShardHour` と `ap-northeast-1-KMS-Requests` を見る。

### kinesis-alarm-topic

54章: `-c alarmTopicArn` で 19章のトピックを渡したとき、この章の 3 つのアラームがそのトピックに publish できることを、実物で確かめていない。

再開手順: vp run kinesis:infra:deploy -c alarmTopicArn=<19章の AlarmTopicArn> のあと、`aws cloudwatch set-alarm-state` でアラームを ALARM にして、通知が届くかを見る。

### grafana-workspace-never-created

Amazon Managed Grafana のワークスペースを 1 つも作っていない。cdkd 0.296.28 が AWS::Grafana::Workspace を Cloud Control API 経由で作れるか、Endpoint と Id の属性を出力に読めるか、IAM Identity Center が無効なアカウントで AWS_SSO を指定したときに何が起きるか、SAML を指定して SamlConfiguration を渡さない作成が通るかは未確認。

再開手順: IAM Identity Center を有効にしたアカウントで vp run grafana:infra:deploy -c authentication=AWS_SSO を実行し、出力の WorkspaceId と WorkspaceEndpoint を確かめる。コンソールの Authentication タブで自分を割り当てて Admin にし、サインインできることを見る。終わったら vp run grafana:infra:destroy。

### grafana-dashboard-never-loaded

生成したダッシュボードの JSON を、本物の Grafana に読ませていない。この章のスキーマは Grafana の検証ではない。とくに、schemaVersion 41 の JSON をバージョン 13 のワークスペースが受け取って描画すること、式のクエリ（hide を付けた部品の合計）が線になること、jsonData.authType: default がワークスペースのロールを使うこと、ロールの 2 つのアクションだけでパネルが描けることは未確認。

再開手順: 19章と 55章のスタックをデプロイし、vp run obs:smoke の後に vp run grafana:push を実行する。ワークスペースで Notes API のダッシュボードを開き、7 つのパネルに CloudWatch のダッシュボードと同じ線が出ることを見比べる。権限のエラーが出たら、足りないアクションを infra/lib/grafana-stack.ts の WORKSPACE_ACTIONS に足してテストを直す。

### grafana-live-body-equality

aws cloudwatch get-dashboard が返すボディが、CDK が書いたものと JSON として等しいかを確かめていない。scripts/push.ts の一致の検査は、等しいことを前提にしている。WorkspaceEndpoint の出力がスキームを含むかも未確認（コードは両方を受け付ける）。

再開手順: vp run grafana:push を実行する。一致の検査で止まったら、返ってきたボディと vp run grafana:render --cloudwatch の出力を比べ、CloudWatch が足した項目があれば src/cloudwatch.ts の比較から外す。

### grafana-billing-details

料金のうち、月の途中で作って消したワークスペースの日割り、最低 1 ライセンスが無料トライアルの期間にどう扱われるか、GetMetricData に無料枠があるか、Grafana が 1 回の再読み込みで何個のメトリクスぶんを要求するかは確認できていない。

再開手順: ワークスペースを 1 か月置いたあと、Cost Explorer を usage type（APN1-Grafana:EditorUser、APN1-CW:GMD-Metrics）で分けて見て、reference/pricing の grafana-idle、grafana-small と比べる。

### 56-live-model

56章は実際の Bedrock を一度も呼んでいない。jp.amazon.nova-2-lite-v1:0 が S3 URI で渡した画像を読めること、実際の Converse の応答がフィクスチャの形に合うこと、画像 1 枚が usage に 230 トークンとして現れること、モデルが画像を断るときの応答（stopReason が content_filtered になるのか、別の形か）は未確認。画像のバケットが推論の行き先と別のリージョン（jp. の profile なら大阪）にあっても読めるかも、ドキュメントでは確認できなかった。

再開手順: vp run nova:hello に画像のパスを渡して実行する（課金される）。次に vp run nova:infra:deploy と vp run nova:smoke を実行する。応答の形が違えば fixtures/converse と src/describe.ts を直す。

### 56-catalog-against-account

src/catalog.ts はモデルカードとライフサイクルのページを 2026-10-13 に読んで書いたもので、アカウントに問い合わせた結果ではない。Nova Micro は、モデルカードの表では東京に Geo の印があるのに、載っている profile の ID が us. と eu. だけで、東京から呼ぶ ID を確認できていない。Price List にだけ行がある Nova 2.0 Pro、Nova 2.0 Omni、Nova 2.5 Sonic が呼べるのかも未確認。

再開手順: vp run nova:models を実行し、表示された profile とモデルの一覧で src/catalog.ts を直す。テスト（test/catalog.test.ts）が、直した内容に合わせて落ちる。

### 56-deployed-stack

56章のスタックはデプロイしていない。S3 の条件付き書き込み（If-None-Match と If-Match）がこの章のロールの権限で通ること、同時のリクエストで claim が 1 つしか作られないこと、function URL のイベントの requestContext.authorizer.iam.userId が引き受けたロールでどういう値になるか、Bedrock が画像を取りに行く S3 のリクエストが何回で、誰に課金されるかは未確認。

再開手順: vp run nova:infra:deploy、vp run nova:smoke、vp run nova:infra:drift、vp run nova:empty --yes、vp run nova:infra:destroy の順に実行する。

### polly-never-called

Polly を 1 回も呼んでいない。声の聞こえ方、合成にかかる時間、返ってくる MP3 の大きさとビットレート、x-amzn-RequestCharacters の値、SSML をエスケープした文字（&amp; など）や改行が何文字と数えられるか、日本語の声が英単語をどう読むかは、どれも未確認。

再開手順: vp run polly:infra:deploy の後、vp run polly:listen を実行する（課金される）。1 回目の billedCharacters を送った文章の文字数と比べ、2 回目が 0 であること、音声の Content-Type とバイト数、かかった時間を記録する。& と改行を含む文章でも試し、数え方を src/ssml.ts の billedSize のコメントと本文に反映する。

### polly-conditional-writes-on-s3

S3 の条件付き書き込みを実際の S3 で試していない。If-None-Match と If-Match の PutObject が同時に届いたときに 1 つだけが通ること、負けた側に返るエラー（412 と 409）の形、SDK が 409 を自動で再試行するかどうかは、ドキュメントと SDK の型から書いた。

再開手順: デプロイ後、同じ新しい文章で vp run polly:listen を 2 つの端末から同時に実行し、関数のログで synthesized が合わせて 1 件分であること、片方が waited になることを確かめる。関数のログに 412 や 409 以外のエラー名が出たら、src/s3-audio-cache.ts の refused を直す。

### polly-iam-resource

polly:SynthesizeSpeech を Resource "*" で許可している。Polly のリソースの種類はレキシコンだけで、レキシコンを使わないリクエストがどの ARN で評価されるかを確認できなかったため。

再開手順: デプロイ後、ロールのポリシーの Resource を arn:aws:polly:ap-northeast-1:<account>:lexicon/* に変えて vp run polly:listen を実行し、AccessDenied になるかどうかを見る。通るなら、スタックとテストをその ARN に変える。

### polly-player-in-a-browser

src/player.ts をブラウザで動かしていない。audio 要素の代わりのオブジェクトでテストしただけで、署名付き URL の音声が audio 要素で再生できること、部分のつなぎ目がどう聞こえるかは未確認。

再開手順: 06章の Web アプリのノートの画面にボタンを足し、requestSpeech と playInOrder(urls, (url) => new Audio(url)) を呼ぶ。2 つ以上の部分になる長さのノートで、つなぎ目の間を聞く。

### 58-aws

58章のスタックを AWS で一度も動かしていない。未確認: 実際の DynamoDB が重複した PartiQL の INSERT に DuplicateItemException を返すこと（DynamoDB Local 3.3.1 は DuplicateItem という名前で返した）、dynamodb:PartiQLInsert と dynamodb:Query だけの権限で追記が通り上書きが通らないこと、PartiQL の INSERT の課金単位、既定の保持期間だけのバケットへの PutObject が s3:PutObject の権限だけで通りロックがかかること、SDK が付けるチェックサムで Object Lock の PutObject が受け付けられること、If-None-Match の 412、ListObjectVersions の応答の形、ロック中のバージョンの削除が 403 になること、governance の解除、GetObjectRetention がロックのないバージョンに返すエラーの名前、1 時間ごとのルールの料金、cdkd が Object Lock つきのバケットとルールと Lambda の権限を実際に作れること、cdkd destroy が RETAIN のバケットを残すこと。QLDB の開発者ガイドは 404 で読めなかったので、QLDB の説明は AWS のブログ 2 本だけに基づく。

再開手順: `vp run ledger:infra:diff`、`vp run ledger:infra:deploy`、`vp run ledger:append`（2 回）、`vp run ledger:digest`、`vp run ledger:verify` の順に実行する。関数のログは出力 `DigestLogGroupName` のロググループを見る。出力 `DigestBucketName` を控えてから `vp run ledger:infra:destroy`。保持期間（既定は 1 日）が過ぎたら `vp run ledger:purge --bucket <名前> --apply` でバケットを消す。

### rds59-never-deployed

59章のスタックを一度もデプロイしていない。未確認: cdkd 0.296.28 が AWS::RDS::DBInstance を ManageMasterUserPassword つきで作り、MasterUserSecret.SecretArn と DbiResourceId と Endpoint.Address を解決できること。AWS::RDS::DBParameterGroup を Cloud Control API 経由で作れること。先に作ったロググループ /aws/rds/instance/aih-notes/postgresql に RDS がそのまま書くこと。PostgreSQL 18.3 がいまも新規のインスタンスに選べること。db.t4g.micro で IAM データベース認証のメモリが足りること。Database Insights の既定の状態。Fn::ImportValue を cdkd が 11章のスタックから解決すること。

再開手順: 学習用アカウントで vp run net:infra:deploy のあと vp run rds:infra:deploy を実行する。版で止まったら aws rds describe-db-engine-versions --engine postgres で選べる版を調べ、-c postgresVersion=<版> を付ける。終わったら vp run rds:infra:drift の結果を記録し、vp run rds:infra:destroy で消す。

### rds59-never-connected

実際の RDS に一度もつないでいない。未確認: NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem で Node.js 24 のランタイムが RDS の証明書を検証できること。@aws-sdk/rds-signer のトークンが node-postgres の password の関数を通って受け付けられること。RDS が管理するシークレットの JSON に username と password があること。notes_admin が rds_iam を GRANT でき、データベースと public スキーマへの CREATE を渡せること。notes_migrator が 13章のマイグレーションを流せること。呼び出しの payload でパスワードを渡す bootstrap が通ること。フェイルオーバーや再起動のあと、切れた接続が node-postgres でどう見えるか。

再開手順: デプロイのあと vp run rds:db:bootstrap、rds:db:migrate、rds:db:status、rds:smoke を順に実行する。status の tls が true であること、role が notes_migrator であることを見る。aws rds reboot-db-instance --db-instance-identifier aih-notes のあとにもう一度 rds:smoke を実行し、関数のログの idle connection lost の行と応答を記録する。

### rds59-replica-not-exercised

リードレプリカは手元のモデルでしか動かしていない。モデルはコミットされた文を順に流し直すもので、PostgreSQL のストリーミングレプリケーションではない。未確認: -c readReplica=true のスタックがデプロイできること（同じリージョンのレプリカに CloudFormation が受け付けるプロパティ）。レプリカで pg_last_wal_replay_lsn() が、プライマリの pg_current_wal_lsn() と比べられる値を返すこと。notes_api がレプリカにも IAM トークンでサインインできること。実際のラグの大きさ。

再開手順: vp run rds:infra:deploy -c readReplica=true のあと bootstrap と migrate を実行する。rds:smoke の出力で、作成直後の読み取りが primary か replica のどちらから返ったかを見る。CloudWatch の ReplicaLag を記録する。レプリカは時間課金なので、終わったらスタックを消す。

### rds59-operations-not-exercised

Multi-AZ のフェイルオーバー、ポイントインタイムリストア、スナップショットからの復元、マイナーとメジャーのバージョンアップ、blue/green deployment、RDS Proxy、ストレージの自動拡張、停止と 7 日後の自動起動は、どれも実行していない。本文の数値（60〜120 秒、35 秒未満、5 分、66% など）は公式ドキュメントの記述で、この本の測定ではない。料金は Price List の単価と仮定から計算しただけで、請求を見ていない。RDS が管理するシークレットに料金がかかるかどうか、無料枠がどう適用されるかは確認できていない。

再開手順: production のプロファイルでデプロイし、aws rds reboot-db-instance --force-failover のあいだ rds:smoke を繰り返して、失敗が続いた秒数を記録する。aws rds restore-db-instance-to-point-in-time で別名のインスタンスに戻し、エンドポイントが新しいこととパラメーターグループが既定に戻ることを見る。1 か月後に Cost Explorer で RDS と Secrets Manager の行を確かめる。

### aurora-real-cluster

60章のスタックを一度もデプロイしていない。未確認: エンジンの版 17.9 で東京に新しいクラスターを作れること。cdkd 0.296.28 が DBCluster を Cloud Control API 経由で作り、EnableHttpEndpoint と SecondsUntilAutoPause が効き、MasterUserSecret.SecretArn の出力が解決されること。インバウンドのルールが 1 つもないセキュリティグループのまま Data API が届くこと。Aurora が管理するシークレットを Data API の secretArn に使えること。$1 を :p1 に書き換えた SQL と CAST が通ること。UPDATE ... RETURNING の行が records と columnMetadata の label で返ること。止まっているインスタンスへの呼び出しが DatabaseResumingException になるのか、待たされて成功するのか。300 秒で実際に止まること、再開にかかる時間。

再開手順: 学習用アカウントで 11章の VPC をデプロイしたうえで、vp run aurora:infra:deploy、aurora:db:schema、aurora:smoke を順に実行する。10 分ほど置いて CloudWatch の ServerlessDatabaseCapacity が 0 になるのを確かめ、もう一度 aurora:smoke を実行して、再試行のログと所要時間を記録する。結果を data/validation.json に書き、vp run aurora:infra:destroy で消す。

### aurora-failover-not-exercised

フェイルオーバーを一度も起こしていない。接続の喪失は、PGlite の 1 本のセッションの上で、文を実行したあとに ROLLBACK して例外を投げることで模している。未確認: フェイルオーバーの最中に node-postgres が実際に返すエラー（SQLSTATE 57P01 か、SQLSTATE のない切断か）。降格した writer につながったままのセッションが書き込みに 25006 を返すこと。クラスターエンドポイントの名前が新しい writer を指すまでの時間。Data API がフェイルオーバー中に返す例外の種類。

再開手順: デプロイしたクラスターに 2 台目の db.serverless のインスタンスを別の AZ に足す（スタックに CfnDBInstance をもう 1 つ書く。起きている間は 2 台分の料金）。aurora:smoke を繰り返し実行しながら aws rds failover-db-cluster --db-cluster-identifier <ID> を実行し、出た例外と、同じキーが 1 回だけ適用されたことを記録する。VPC の中で src/pg.ts を使う場合も同じ手順で、エラーの code を記録する。

### aurora-concurrent-same-key

同じキーの 2 つのリクエストが別々のセッションで同時に走る場合を、実際の PostgreSQL では動かしていない。PGlite のセッションは 1 本なので、テストは「INSERT ... ON CONFLICT DO NOTHING が行を返さなかった」という応答を台本で与えているだけである。

再開手順: PostgreSQL のサーバー（デプロイした Aurora でよい）に 2 本の接続を張り、同じ owner と key で appendToNote を同時に実行する。片方が行ロックで待ち、もう片方のコミットのあとにやり直して、保存された結果を返すことを確かめる。

### sqs-fifo-on-aws

61章: 名前を固定した 2 本の FIFO キューが cdkd 0.296.28 で作れること、FIFO キューの重複排除（5 分）とメッセージグループの順序、FIFO キューのイベントソースマッピングでの maximum concurrency と partial batch response が、模型とドキュメントのとおりに動くことを、実物で確かめていない。

再開手順: vp run sqs:infra:deploy の後、vp run sqs:send と vp run sqs:status を実行する。ノートが題 Shopping、行 milk と eggs、適用 3 件になれば期待どおり。milk が 2 行あれば重複排除 ID を、順序が違えば message group ID を、ワーカーのロググループ（出力 WorkerLogGroupName）で確かめる。

### sqs-park-and-redrive

61章: ワーカーが読めないメッセージを FIFO のデッドレターキューに SendMessage で直接送れること、そのメッセージを DestinationArn を指定した StartMessageMoveTask で元のキューに戻せることを、実物で確かめていない。DestinationArn を省いたときに、SQS が移したのではないメッセージがどう扱われるかも確かめていない。

再開手順: vp run sqs:send --poison の後、vp run sqs:status でデッドレターキューに「parked by the worker」の 1 件があることを見る。vp run sqs:status --redrive を実行し、移動のタスクの状態と、戻ったメッセージがもう一度よけられることを見る。

### sqs-batch-mates

61章: 失敗し続けるメッセージと同じバッチで渡されたメッセージが、受信の回数を一緒に増やしてデッドレターキューに移ること。ドキュメントの 2 つの決まり（受信の回数はメッセージごと、maxReceiveCount を超えたら移る）から導き、模型で再現しただけで、実物では確かめていない。Lambda のポーラーが 1 回に何件受け取るかは、ドキュメントに書かれていない。

再開手順: ワーカーの park を一時的に例外を投げるものに替えてデプロイし、同じノートに読めないメッセージと正しいコマンド 2 件を続けて送る。5 分ほど後に vp run sqs:status で、デッドレターキューに 3 件あるか、1 件だけかを見る。

### sqs-ledger-on-dynamodb

61章: DynamoDB 用の台帳のトランザクション（list_append と if_not_exists を使う更新式、size の条件、CancellationReasons の並び）を、DynamoDB でも DynamoDB Local でも実行していない。DynamoDB Local は Docker が要り、Nix の shell には無い。TTL で目印が消えることも確かめていない。

再開手順: vp run sqs:infra:deploy の後、vp run sqs:send を 2 回実行する（コマンド ID は毎回変わるので、行は増える）。ワーカーのログに ValidationException が無いこと、vp run sqs:status の適用件数が増えることを見る。同じコマンドを 5 分後に送り直す確認は、scripts/send.ts のコマンド ID を固定して行う。

### sqs-empty-receives

61章: Lambda が空の FIFO キューを読む回数。料金の見積もりは「20 秒のロングポーリングが常に 5 本」という仮定（月 657,000 回）で、公式ドキュメントに回数は無い。ワーカーの実行時間（100 ミリ秒と仮定）も計測していない。

再開手順: デプロイして 1 日置き、CloudWatch でコマンドのキューの NumberOfEmptyReceives の合計を見る。30.4 倍して 657,000 と比べ、data/fragments/61.json の sqs-idle と sqs-small の数量を直す。

### sqs-cross-account-and-alarms

61章: senderAccountId を渡したときのキューポリシーで別のアカウントから送れること、alarmTopicArn を渡したときに 2 つのアラームがトピックに通知することを、実物で確かめていない。テンプレートの形をアサーションで確かめただけ。

再開手順: vp run sqs:infra:deploy -c alarmTopicArn=<19章の AlarmTopicArn> でデプロイし、vp run sqs:send --poison でデッドレターキューに 1 件入れて通知を待つ。別のアカウントからの送信は、2 つ目のアカウントがあるときに -c senderAccountId=<ID> で確かめる。

### ci-runners-end-to-end

62章の構成は一度も動かしていない。GitHub App からの配送を受け、JIT の設定を作り、Fargate のタスクがランナーとして登録され、ジョブを 1 件実行して消えるまでを、実物で確かめていない。

再開手順: 11章の VPC をデプロイし、runners:infra:deploy を -c repositories と -c appClientId つきで実行する。GitHub App を作って webhook の URL とシークレットを設定し、秘密鍵を AppPrivateKey のシークレットに入れる。workflows/ci.yml を練習用の非公開リポジトリの .github/workflows/ に置いて push し、ECS のタスク、ランナーの一覧、ジョブのログを確かめる。終わったら destroy する。

### ci-runners-jit-config-size

encoded_jit_config の長さを確認していない。RunTask の overrides は全体で 8,192 文字までで、これを超えると、この章の渡し方（コンテナの引数）は使えない。

再開手順: 実際に generate-jitconfig を呼び、応答の encoded_jit_config の文字数を見る。launcher.ts は超えたときに RunTask を呼ばずに失敗する。超えるなら、設定を S3 に置いて environmentFiles で渡す（ランナーは ACTIONS_RUNNER_INPUT_JITCONFIG を読む。actions/runner v2.338.0 の CommandSettings.cs で確認）か、タスクごとにタスク定義を登録する。

### ci-runners-runner-labels

JIT で登録したランナーに self-hosted などの既定のラベルが付くかどうかを確認していない。この章は自分で付けた 1 つのラベルだけを使う。runner_group_id の既定のグループが 1 であることも、API の例から読んだだけ。

再開手順: 登録したランナーを GET /repos/{owner}/{repo}/actions/runners で見て labels を確かめる。グループの ID は組織の runner groups の API で確かめ、違えば -c runnerGroupId で渡す。

### ci-runners-run-lookup

workflow_job の配送が届いた時点で、その run_id の workflow run を API で読めること、fork からのプルリクエストで head_repository が fork を指すことを、実物で確かめていない。

再開手順: 非公開リポジトリの fork からプルリクエストを出し（fork のワークフローを動かす設定にしたうえで）、受信の Lambda のログに reason: fork が出ることを確かめる。

### ci-runners-image-on-fargate

ghcr.io/actions/actions-runner のイメージを Fargate で起動していない。arm64 のイメージが含まれることはマニフェストで確かめたが、取得にかかる時間、run.sh が非特権のタスクで動くこと、ジョブが終わるとプロセスが終了してタスクが止まることは未確認。

再開手順: end-to-end の手順のあと、aws ecs describe-tasks で pullStartedAt、pullStoppedAt、startedAt、stoppedAt、終了コードを読む。

### ci-runners-function-url-policy

aws-cdk-lib 2.273.0 の addFunctionUrl が作るリソースベースのポリシーが、2025 年 10 月以降に必要な lambda:InvokeFunction も含むことは synth の結果で見た。cdkd 0.296.28 がそれを作れること、URL が実際に呼べることは未確認。

再開手順: デプロイ後に curl -X POST <WebhookUrl> を送り、401 と {"error":"bad_signature"} が返ることを確かめる。403 なら Lambda のリソースベースのポリシーを見る。

### ci-runners-other-platforms

CodeBuild のランナー、ARC、scale set client、GitLab Runner とその fleeting plugin は、どれもドキュメントを読んだだけで、動かしていない。CodeBuild の起動時間と、arm1.small の大きさが 2 vCPU、8 GB のタスクとどう違うかも確かめていない。

再開手順: それぞれの公式のチュートリアルに従う。CodeBuild は action-runner.html、GitLab は fleeting plugin の README と Instance executor のページ。

### agent-sandbox-deploy

63章のスタックは一度もデプロイしていない。イメージもビルドしていない。タスクが起動すること、読み取り専用のルートと 3 つのボリュームで Claude Code が動くこと、Fargate の中で bubblewrap によるサンドボックスが（enableWeakerNestedSandbox を付けても）起動できることは確かめていない。起動できなければ、failIfUnavailable により Claude Code は始まらない。

再開手順: Docker のある環境で sandbox:bundle、sandbox:image:build a1 を実行する。本番ではないアカウントに 11章の VPC を egress=nat でデプロイし、sandbox:infra:deploy、sandbox:image:push a1、sandbox:infra:deploy -c imageTag=a1 -c repositories=<owner/name> の順に実行する。GitHub App のシークレットを作り、sandbox:launch で 1 つ起動して sandbox:logs で system/init と結果の行を確かめる。終わったら destroy する。

### agent-sandbox-bare-settings

--bare を付けた claude が /etc/claude-code/managed-settings.json を読むかどうかは、ドキュメントからは確認できなかった。そのため同じファイルを --settings でも渡している。strictAllowlist が --settings 経由で効くことは設定リファレンスに書かれているが、実行して確かめてはいない。

再開手順: イメージの中で claude --bare -p を、--settings を付けた場合と外した場合で実行し、許可していないホストへの curl が拒否されるかを比べる。

### agent-sandbox-bedrock-permissions

タスクロールには bedrock:InvokeModel と InvokeModelWithResponseStream だけを付けた。Claude Code のドキュメントの IAM ポリシーには ListInferenceProfiles と GetInferenceProfile もある。プロファイルの検出ができないときは確認なしで進むと書かれているが、この 2 つが無い状態で起動できることは確かめていない。

再開手順: デプロイしたタスクのログで、起動時のモデル確認と最初の推論が通るかを見る。通らなければ、この 2 つを足した場合に限って通るかを確かめ、足すなら GetInferenceProfile はプロファイルの ARN に絞る。

### agent-sandbox-token-metrics

1 日の支出の見積もりは、AWS/Bedrock のトークンのメトリクスをディメンションなしで合計している。InputTokenCount がキャッシュのトークンを含むかどうか、推論プロファイルを呼んだときの ModelId の値、メトリクスが届くまでの遅れは、ドキュメントからは確認できなかった。

再開手順: タスクを 1 つ動かしたあと、CloudWatch の 4 つのメトリクスの合計を、ログの結果行にある usage と、翌日の Cost Explorer の Bedrock の金額と比べる。

### agent-sandbox-overrides-visibility

Git のトークンは RunTask の環境変数の上書きで渡している。DescribeTasks の応答に上書きが含まれることは API リファレンスの応答の形から読み取れるが、CloudTrail の RunTask のイベントに環境変数の値が残るかどうかは確かめていない。

再開手順: タスクを 1 つ起動し、CloudTrail の RunTask イベントの requestParameters を見る。値が残っていれば、タスクごとのシークレットに置き換えることを検討する。

### agent-sandbox-network-firewall

Network Firewall による許可リストは、ルールの形を出力するだけで、スタックには入れていない。ファイアウォール用のサブネットとルートの変更が 11章のスタックの持ち物だからである。

再開手順: 11章のスタックに、ファイアウォール用のサブネット、ファイアウォール、プライベートサブネットからファイアウォールのエンドポイントへのルートを足すモードを作り、sandbox:plan の出力をルールグループに入れる。

### 64-image

64章のコンテナイメージを一度もビルドしていない（Nix のシェルに Docker のデーモンが無い）。Linux arm64 の workerd は取得してダイジェストを確かめたが、実行していない。`debian:bookworm-slim` の上で起動すること、ユーザー `nobody` でポート 8080 を開けること、PID 1 として SIGTERM を受け取ること、イメージの大きさが未確認。

再開手順: Docker のデーモンを用意して `vp run isolates:fetch`、`vp run isolates:bundle`、`vp run isolates:image:build v1` を実行し、`docker run --rm --read-only -p 8080:8080 -e ALLOWED_ORIGIN=http://localhost:5173 aih-isolates:v1` で起動して `/health` を呼ぶ。`docker stop` で終了コードと所要時間を見る。

### 64-deploy

64章のスタックを AWS に一度もデプロイしていない。Fargate の上で workerd が起動すること、`readonlyRootFilesystem` のままで動くこと（macOS でファイルへの書き込みを禁じて起動できることだけ確かめた）、ヘルスチェックが通ること、入れ替えのあいだリクエストが失われないこと、ログが CloudWatch Logs に 1 行ずつ届くことが未確認。

再開手順: `vp run net:infra:deploy`、`vp run isolates:infra:deploy` でリポジトリを作り、イメージを push してから `vp run isolates:infra:deploy -c imageTag=<tag>`、`vp run isolates:smoke`、`vp run isolates:infra:drift` を通す。タスクが起動しなければ、タスクのログと停止理由を見て、`readonlyRootFilesystem` を外して切り分ける。終わったら `vp run isolates:infra:destroy`、`vp run net:infra:destroy` の順に消す（時間課金。1 日でおよそ USD 1.24）。

### 64-linux-behaviour

CPU のループが打ち切られないこと、同じプロセスの worker が待たされること、SIGTERM での動きは、macOS（arm64）の workerd 1.20261012.1 でだけ観察した。Linux で同じかどうか、処理中のリクエストをいつまで待つのか（上限があるのか）は確認していない。メモリの上限は試していない（設定のスキーマに項目が無いことと、サーバーのソースに「上限を課さない」実装があることを読んだだけ）。

再開手順: Linux のマシンかコンテナで `vp run isolates:observe` を実行して、出力を比べる。待ち時間の上限は、処理中のリクエストを `stopTimeout` より長く止めて確かめる。

### 64-install-script

`workerd` の npm パッケージには postinstall スクリプトがあり、pnpm 10 は許可が無いので実行しない。`vp install` のたびに「Ignored build scripts: workerd」と表示される。スクリプトが無くても、この章のコードはプラットフォーム別のパッケージからバイナリを直接見つけて動く。`pnpm-workspace.yaml` は共有ファイルなので、この章からは変更していない。

再開手順: `pnpm-workspace.yaml` の `ignoredBuiltDependencies` に `workerd` を足す（esbuild と同じ理由で、スクリプトは不要）。

### 66-nothing-on-aws

66章のスタックをデプロイしていない。EC2 の上では YugabyteDB を一度も起動していない。

再開手順: 11章のネットワークを 3 ゾーンで作り、`vp run distsql:infra:deploy -c nodes=3`、続けて deploy のページの順に `distsql:artifact`、`distsql:install`、`distsql:certs`、`distsql:configure`、`distsql:start`、`distsql:health` を実行する。終わったら `distsql:infra:destroy` とボリュームの削除まで行う。

### 66-linux-archive

ノード用のアーカイブ（el8-aarch64）を取得も実行もしていない。Amazon Linux 2023（arm64）の t4g.medium で動くこと、post_install.sh が通ること、systemd の設定と user data のスクリプトが実機で通ることは未確認。

再開手順: `vp run distsql:fetch --nodes` で取得して SHA-256 を照合し、デプロイしたノードで `vp run distsql:install` と `vp run distsql:status` を実行する。

### 66-operations-not-exercised

ローリングアップグレード、死んだノードの置き換え（新しいアドレスのマスターと tablet server を足して古いものを外す手順）、snapshot を使ったバックアップは、文書の手順を写しただけで、手元でも実行していない。

再開手順: 手元のクラスターで 4 つ目のノードを別のポートで起動し、文書の `change_master_config` と `change_blacklist` の手順を実行する。アップグレードは、v2025.2 の 1 つ前のパッチ版を取得して同じ手順で試す。

### 66-start-tservers-page

文書の「Start YB-TServers」のページを読めなかった（取得ツールが別のページの内容を返した）。yb-tserver のフラグは、固定した版のバイナリの --helpfull と、手元で起動できた事実で確かめた。

再開手順: https://docs.yugabyte.com/stable/deploy/manual-deployment/start-tservers/ をブラウザで開き、`src/topology.ts` のフラグと、起動後の配置の設定（`yb-admin modify_placement_info`）の説明を照らし合わせる。

### 66-openssl-not-in-nix

証明書を作る `distsql:local:certs` と `distsql:certs` は PATH の openssl を使う。Nix の devShell には openssl が入っていない（この作業では Homebrew の 3.6.1 が使われた）。

再開手順: flake の devShell に openssl を足すかどうかを決める。足さない場合は、macOS に付属の /usr/bin/openssl（LibreSSL）で同じ引数が通るかを確かめる。

### 66-deadlock-and-rotation

デッドロック（SQLSTATE 40P01）を実際のクラスターで起こしていない。13章の再試行ループは 40001 だけを再試行する。証明書の入れ替えの手順は、手動デプロイ向けの文書に見つけられなかった。

再開手順: 2 つのトランザクションに 2 つの行を逆の順で更新させて 40P01 を観測し、再試行の条件に足すかを決める。証明書は、同じ CA で作り直したものを 1 ノードずつ置いて再起動し、接続が保たれるかを手元のクラスターで確かめる。

### 66-transfer-not-measured

ゾーンをまたぐ転送量は、1 件 2,000 バイトという仮定からの計算で、測っていない。t4g.medium 3 台が毎秒 10 件の書き込みと 90 件の読み取りをさばけるかも測っていない。

再開手順: デプロイしたクラスターに負荷をかけ、各ノードの CloudWatch の NetworkOut と、Cost Explorer の DataTransfer-Regional-Bytes を読む。

### 67-firecracker-not-run

Firecracker を 1 度も起動していない。クライアントが本物の v1.17.0 と話せること、自作のサーバーの断り方が本物と一致すること、deploy/ のスクリプト、ゲストの中の Node.js とサーバー、起動時間、スナップショットは未確認。

再開手順: Linux と KVM のあるマシンで vp run firecracker:kit:build の dist/kit を置き、bash deploy/prepare.sh、sudo bash deploy/tap.sh up、sudo work/firecracker --api-sock /tmp/firecracker.socket、別の端末で sudo work/node/bin/node boot.mjs を順に実行する。断られたリクエストのステータスと fault_message を test/support/fake-firecracker.ts の規則と比べて直し、表示された 3 つの時間を記録する。続けて --snapshot を試す。

### 67-nested-virtualization

nested virtualization を有効にした c7i.large で /dev/kvm が現れ、Firecracker が動くことは未確認。Firecracker のプロジェクトがテストしているのは .metal だけで、手引きは EC2 では .metal でしか KVM を使えないと書いている（EC2 のガイドと食い違う）。

再開手順: vp run net:infra:deploy、vp run firecracker:infra:deploy -c run=true、vp run firecracker:kit:publish のあと Session Manager で入り、ls -l /dev/kvm の結果から記録する。動かなければ instanceType を変えるか、.metal で試した結果と並べる。終わったら firecracker:kit:empty と firecracker:infra:destroy。

### 67-cdkd-cloud-control

AWS::EC2::LaunchTemplate と、LaunchTemplate プロパティを使う AWS::EC2::Instance を、cdkd 0.296.28 が Cloud Control API 経由で作れるかは未確認。前者に専用の実装が無いこと、後者の実装が書くプロパティの一覧に LaunchTemplate が無いことは、導入済みのパッケージで確かめた。

再開手順: vp run firecracker:infra:diff -c run=true で計画を読み、デプロイして、インスタンスの CPU オプションに nested virtualization が入っていることを aws ec2 describe-instances で確かめる。

### 67-imds-from-guest

ホップ数 1 の設定と tap.sh の規則で、ゲストからインスタンスのメタデータに届かないことは未確認。

再開手順: ゲストに SSH で入り、curl -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' が応答を得られないことを確かめる。tap.sh の規則を外した場合も試し、どちらが効いているかを記録する。

### 67-fargate-whitepaper

ホワイトペーパー Security Overview of AWS Fargate を読めなかった（d1.awsstatic.com が 403）。いまの Fargate のタスクがすべて Firecracker の上にあるかは、読んだページからは確認できない。

再開手順: ECS のデベロッパーガイドの Fargate のセキュリティのページからホワイトペーパーへのリンクをブラウザで開き、Firecracker と EC2 インスタンスについての記述と改訂日を読んで、67.aws の節と sources を直す。

### 67-node-in-ci-rootfs

公式の Node.js のバイナリが Firecracker の CI のルートファイルシステム（Ubuntu）の中で動くかは、パッケージの一覧からの見込みで、未確認。

再開手順: prepare.sh のあと sudo chroot work/squashfs-root /opt/node/bin/node --version を実行する。動かなければ、足りないライブラリを ldd で調べ、apt で入れる手順を prepare.sh に足す。

### 68-deploy

68章のスタックを AWS に一度もデプロイしていない。cdkd 0.296.28 の EC2 のプロバイダーは `EnclaveOptions` を扱わず、指定があるとインスタンスを Cloud Control API 経由に回す、とインストールした版のコードにある。その経路でエンクレーブ対応のインスタンスが作れること、Principal だけで権限を与えるキーポリシーを KMS が受け付けること、明示した管理用のアクションだけで cdkd がキーを作って消せることが未確認。

再開手順: 11章をデプロイした後に `vp run nitro:infra:deploy`。`aws ec2 describe-instances --query 'Reservations[].Instances[].EnclaveOptions'` が `Enabled: true` を返すことを見て、`vp run nitro:infra:drift` を通す。終わったら `vp run nitro:infra:destroy`（インスタンスは時間課金）。

### 68-enclave

エンクレーブを一度も起動していない。Graviton の 2 vCPU のインスタンスで allocator を 1 vCPU にして hello のサンプルが動くこと、`--cpu-count 1` で起動できること、既定のルートボリュームに Docker のイメージとイメージファイルが収まること、hop limit 1 のままユーザーガイドの親側のコンテナが IMDSv2 から認証情報を取れるかどうかが未確認。

再開手順: デプロイの後、Session Manager で入り、本文「エンクレーブを起動するまで」の順に `dnf install`、allocator の設定、`docker build`、`nitro-cli build-enclave`、`run-enclave --debug-mode`、`console`、`terminate-enclave` を通す。

### 68-attestation

KMS のアテステーションを一度も通していない。この章のキーポリシーで、エンクレーブの中からの Decrypt と GenerateDataKey が通り、親からの同じ呼び出しが拒否されることは、ドキュメントの記述と自作の評価器でしか確かめていない。ノートを封印する TypeScript のコード（`src/enclave/vault.ts`）をエンクレーブのイメージにする部分（vsock の待ち受け、NSM からのドキュメントの取得、`kmstool_enclave_cli` の呼び出し）は、このリポジトリに無い。

再開手順: ユーザーガイドの「Connect the parent instance with an enclave by using virtio-vsock」と「Connect an enclave with AWS KMS」をそのまま通す。`nitro-cli build-enclave` が出した PCR0 を `vp run nitro:infra:deploy -c measurement=<PCR0>` で渡し、デバッグモードなしで起動したエンクレーブから `kmstool_enclave_cli decrypt` が通ること、親で `aws kms decrypt` が AccessDenied になること、CloudTrail の `additionalEventData.recipient` を確かめる。

### 68-lsblk

`lsblk --json --nodeps --output NAME,SERIAL` をインスタンスで実行していない。テストの入力は util-linux 2.40.2 のソースを読んで手で書いたもので、Amazon Linux 2023 が出す実際の JSON と突き合わせていない。

再開手順: 23章のインスタンスで `lsblk --json --nodeps --output NAME,SERIAL` を実行し、出力を `findDevice` に渡して、`vp run ec2:status` が示すボリューム ID のデバイスが返ることを確かめる。
