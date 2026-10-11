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
| all | `vp run typecheck (6 回 / 6 times)` | ローカル | 成功 | 2026-10-11 | 単一スレッドの tsc で 6 回とも成功。既定の並列実行と vp check の型検査は、同じ入力でときどき失敗した |
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

### typescript7-parallel-check

TypeScript 7.0.2 の並列の型検査と vp check の型検査が、aws-cdk-lib の subpath import をときどき取り違える。回避として単一スレッドの tsc を使っている。上流へは未報告。

再開手順: 最小の再現を作って上流に報告する。修正版が出たら、vite.config.ts の lint.options と tools/src/checks/typecheck.ts を見直す。

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
