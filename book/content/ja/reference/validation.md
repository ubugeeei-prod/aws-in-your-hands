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
| 17 | `vp run test:unit (examples/17-ai)` | ローカル | 成功 | 2026-10-11 | 51 件。fixture の stream（完了、maxTokens、途中で切断、途中で throttling、開始時の throttling）、cancel と timeout、client、CDK の assertion |
| 17 | `vp run typecheck (examples/17-ai)` | ローカル | 成功 | 2026-10-11 | scripts/ と infra/ を含む |
| 17 | `vp run ai:infra:synth` | ローカル | 成功 | 2026-10-11 | esbuild による bundle（Docker なし）を含む。5 リソース |
| 17 | `vp run dev:ai + curl` | ローカル | 成功 | 2026-10-11 | AI_BACKEND=fixture で起動。/health、要約の stream、不正な入力の 400、途中で切断したときの cancelled の log、AI_FIXTURE=truncated の error イベントを確認 |
| 17 | `vp run check:all` | ローカル | 成功 | 2026-10-11 | 17章を加えた状態で通過 |
| 17 | `vp run dev:ai (AI_BACKEND=bedrock)` | AWS | 未実行 | - | 手元のサーバーから実際の Bedrock を呼ぶ。課金される |
| 17 | `vp run ai:hello / ai:test:live` | AWS | 未実行 | - | 実際のモデルを呼ぶ。課金される。モデル ID、権限、実際のイベントの形はここでしか確かめられない |
| 17 | `vp run ai:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | Lambda、function URL、IAM role、log group を作る |
| 17 | `vp run ai:smoke / ai:logs` | AWS | 未実行 | - | デプロイ済みの function URL が必要。課金される |
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
| 09 | `vp run dev:ssr + HTTP requests` | ローカル | 成功 | 2026-10-11 | AIH_SSR_SIGN_IN=dev で起動し、公開ページ、404、/me、サインイン、サインアウト、よそからの POST の 403、/feed が 3 つに分かれて届くことを確認。ブラウザでの操作はしていない |
| 09 | `vp run ssr:infra:diff / deploy / drift / destroy, ssr:assets:plan, ssr:assets:publish, ssr:smoke, ssr:unpublish` | AWS | 未実行 | - | distribution、Lambda の関数と function URL、bucket を作る |
| 19 | `vp run test:unit (examples/19-observability)` | ローカル | 成功 | 2026-10-12 | 実際に書かれるログの形と大きさ、ログの query と metric filter の条件を本物のログ行で評価、traceparent と X-Ray の trace ID の変換、span とログの相互参照、属性の許可リスト、sampling されない要求と欠けた span の再現、アラームの条件、料金計算の入力、インフラの assertion |
| 19 | `vp run dev:obs + curl` | ローカル | 成功 | 2026-10-12 | 本文の curl を実行。ログの行に traceId が付くこと、span がコンソールに出ること、traceparent を付けた要求が同じ trace ID を引き継ぐこと、TRACE_SAMPLE_RATIO=0 で span が出ずログは残ることを確認 |
| 19 | `vp run obs:query:print` | ローカル | 成功 | 2026-10-12 | Logs Insights の query の文字列を出力するだけ。AWS には問い合わせない |
| 19 | `vp run obs:infra:synth` | ローカル | 成功 | 2026-10-12 | 関数を OpenTelemetry の API ごと esbuild で bundle。-c otelLayerArn を付けた場合も synth できることを確認。AWS には問い合わせない |
| 19 | `vp run obs:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | DynamoDB の table、Lambda、HTTP API、SNS の topic、アラーム 2 つ、ダッシュボード、metric filter を作る。ダッシュボードと metric filter は cdkd が Cloud Control API 経由で扱う |
| 19 | `vp run obs:smoke / obs:query / obs:alarms` | AWS | 未実行 | - | デプロイ済みの stack が必要。obs:smoke はノートを 1 件作って消す。obs:query は走査したログの量に課金される |
| 19 | `vp run obs:infra:deploy -c otelLayerArn=...` | AWS | 未実行 | - | AWS Lambda Layer for OpenTelemetry を付けた構成。Node.js 24 の runtime はこの layer の対応一覧に無い |

## 未解決事項と再開手順

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

### 17-live-inference

17章は実際の Bedrock を一度も呼んでいない。モデル ID（jp.amazon.nova-2-lite-v1:0 など）が東京から呼べること、実際の ConverseStream のイベントが src/converse-stream.ts の schema に合うこと、fixture の形が実物と一致することは未確認。

再開手順: examples/17-ai/.env を用意して vp run ai:hello、続けて vp run ai:test:live を実行する（課金される）。イベントの形が違えば schema と fixture を直す。

### 17-deployed-streaming

17章の stack はデプロイしていない。Hono の streamHandle と streamSSE が Node.js 24 の Lambda で function URL（RESPONSE_STREAM、AWS_IAM）を通して少しずつ届くこと、streamSSE が付ける Transfer-Encoding などの header を Lambda が受け付けること、署名なしのリクエストが 403 になること、inference profile に絞った IAM policy で ConverseStream が通ること、cdkd が AWS::Lambda::Url の InvokeMode を反映することは未確認。

再開手順: vp run ai:infra:deploy、vp run ai:smoke（delta の到着時刻が表示される）、vp run ai:logs、vp run ai:infra:drift、vp run ai:infra:destroy の順に実行する。

### 17-bedrock-billing-details

途中で中断した ConverseStream に、どこまでの token が課金されるかを一次情報で確認できていない。Bedrock の無料枠、東京リージョンでの quota の値も未確認。

再開手順: Bedrock の料金ページと Service Quotas を確認する。中断時の課金は、ai:test:live を途中で止めて請求と CloudWatch の metrics を見比べる。

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

KeyValueStore API が古い If-Match に対して返すエラーの種類を確認していない。API リファレンスは ConflictException（409）を載せているが、どの条件で返るかは書いていない。10章の adapter は ConflictException だけを競合として扱い、それ以外は再試行せずに止まる。

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
