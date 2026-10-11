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
| 21 | `vp run test:unit (examples/21-security)` | ローカル | 成功 | 2026-10-12 | token の署名と検証、rotation をまたぐ鍵の cache（古い cache の実行環境、2 回の rotation、でたらめな version id の連打、Secrets Manager の停止、同時リクエスト）、rotation の手順（応答の喪失後の再実行、早すぎる 2 回目、version id の使い回し）、SDK の client を差し替えた secret の読み取り、wildcard の lint と理由つきの例外、20章の CI role への適用、SCP の JSON と評価の model、IAM の伝播待ち、posture の判定、stack の assertion（既定で月額がかかるのは secret 1 つだけ、cmk と web ACL は opt-in） |
| 21 | `vp run sec:infra:synth` | ローカル | 成功 | 2026-10-12 | 固定した cdkd 0.296.28 で synth。認証情報なし。AihSecurity と AihSecurityWaf の template が cdk.out に出ること、-c cmk=on と -c webAclArn=... で template が変わること、形の違う webAclArn で synth が止まることを確認 |
| 21 | `vp run sec:iam:lint (own cdk.out, and every chapter's cdk.out)` | ローカル | 成功 | 2026-10-12 | この章の 2 つの template は例外なしで合格。`vp run infra:synth` のあとに全章の cdk.out を渡した結果は、本文の「本全体に当ててみる」に書いたとおり |
| 21 | `vp run dev:sec` | ローカル | 成功 | 2026-10-12 | 手元の server で /health、/token、/verify を curl で確認。鍵はメモリの中だけで、AWS は呼ばない |
| 21 | `vp run sec:infra:deploy / sec:smoke / sec:infra:drift / sec:infra:destroy` | AWS | 未実行 | - | 未実行。CloudFront、function URL、Secrets Manager を通した動作、デプロイ直後の 503 の有無、destroy 後に secret が残らないこと |
| 21 | `vp run sec:secret:versions / sec:secret:rotate` | AWS | 未実行 | - | 未実行。PutSecretValue 後の staging label の動き、同じ version id での再実行、rotation 後に古い cache の実行環境が新しい token を受け入れること |
| 21 | `vp run sec:waf:infra:deploy / sec:infra:deploy -c webAclArn=... / sec:waf:infra:destroy` | AWS | 未実行 | - | 未実行。us-east-1 への web ACL の作成、distribution への関連付け、rate-based rule が実際に block を始めるまでの時間、count にした rule group の記録 |
| 21 | `vp run sec:infra:deploy -c cmk=on` | AWS | 未実行 | - | 未実行。customer managed key での secret の暗号化、kms:ViaService の条件つきで関数が読めること、destroy 後の鍵の状態 |
| 21 | `vp run sec:posture / sec:trail:iam` | AWS | 未実行 | - | 未実行。6 つのサービスの読み取り API の実際の応答、権限が無いときの表示 |
| 22 | `vp run test:unit (examples/22-recovery)` | ローカル | 成功 | 2026-10-12 | table と bucket を別の時点に戻したときの検出と修復（同じ時点、table だけ、アップロードより前、上書きの後、version が残っていない場合）、修復の dry run・二重実行・途中での中断、08章の残った検査記録、object の復元計画と再実行、version 番号の巻き戻りと fence、PITR の計画、drill の記録、item の分類、05章の repository contract、DynamoDB と S3 へのリクエストの形、stack の assertion |
| 22 | `vp run recovery:demo` | ローカル | 成功 | 2026-10-12 | メモリ上の table と bucket で、事故、table の復元、検査（4 件）、bucket の復元、再検査（0 件）、fence までを実行した。本文に載せた出力はこの実行のもの |
| 22 | `vp run recovery:infra:synth` | ローカル | 成功 | 2026-10-12 | 既定の構成で synth した（esbuild の bundle 込み）。`-c table`、`-c protect=on`、`-c backup=on`、`-c replica=on` は、テストの中と、`node infra/bin/app.ts` に context を渡す形で synth した |
| 22 | `vp run recovery:drill new / mark / set / summary` | ローカル | 成功 | 2026-10-12 | 記録ファイルの作成、時刻と件数の記入、上書きの拒否、集計を手元で実行した。書いた値は動作確認用で、drill の実測ではない。ファイルは消した |
| 22 | `vp run recovery:infra:diff / deploy / drift / destroy` | AWS | 未実行 | - | PITR を有効にした DynamoDB の table、versioning を有効にした S3 bucket、Lambda 関数を作る。`-c backup=on` で AWS Backup の vault と plan、`-c replica=on` で 2 つ目の bucket と複製の設定が加わる |
| 22 | `vp run recovery:status / seed / accident / restore:table / restore:objects / diff / verify / repair / protect / audit / drop-table / empty` | AWS | 未実行 | - | drill の手順。AWS に対しては 1 つも実行していない。RPO と RTO の実測値はない |

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

### 22-drill

22章の復旧 drill を AWS で一度も実行していない。未確認: PITR の復元にかかる時間、`LatestRestorableDateTime` の実際の遅れ、復元した table に引き継がれる設定と引き継がれない設定（削除保護と PITR を含む）、S3 で delete marker を消した後と version を上書きコピーした後の ETag・`LastModified`・通知、`ListObjectVersions` の時刻が同じ version の並び、RPO と RTO の実測値。

再開手順: `vp run recovery:infra:deploy` のあと、本文「drill を実行する」の順に `recovery:drill new`、`recovery:seed --apply`、`recovery:accident --apply`、`recovery:restore:table --apply`、`recovery:restore:objects --at <時刻> --apply`、`recovery:verify --table <復元した table> --frozen`、`recovery:repair` を実行し、`recovery:drill summary` の値を `examples/22-recovery/drill/TEMPLATE.md` の写しに記録する。最後に「片付け」の 3 つのタスク。

### 22-cutover

復元した table への切り替えを実機で確かめていない。未確認: `-c table=<名前>` での deploy が関数の環境変数と IAM policy だけを変えること、cdkd の drift 検査が復元した table を報告しないこと、`cdkd orphan` と `cdkd import --resource` で stack の table を入れ替えられること、`-c protect=on` の stack を cdkd で destroy したときの動き、`-c backup=on`（Cloud Control API 経由）と `-c replica=on` の作成と削除。

再開手順: drill の続きで `vp run recovery:infra:diff -c table=<復元した table>` の差分を読み、deploy して `vp run recovery:audit` と `vp run recovery:infra:drift` を実行する。import を試すなら、`examples/22-recovery` で `cdkd orphan AihRecovery/Notes --dry-run` と `cdkd import AihRecovery --resource <logical ID>=<復元した table> --dry-run` の出力を先に読む。
