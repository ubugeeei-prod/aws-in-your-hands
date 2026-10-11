---
title: "用語集"
generated: true
---

<!-- 生成ファイル。編集しないこと。生成元: data/glossary.json (tools/src/book/generate.ts) -->

# 用語集

日英で同じ概念に同じ語を当てるための対訳表です。API 名、CLI、ファイル名、resource ID は翻訳しません。

| 日本語 | 英語 | 初出 | 意味 |
| --- | --- | --- | --- |
| アカウント | account | 01 | AWS のリソースと請求の入れ物。12 桁の ID を持つ。 |
| root ユーザー | root user | 01 | アカウント作成時のメールアドレスでサインインする、制限できない利用者。日常作業には使わない。 |
| 一時認証情報 | temporary credentials | 01 | 期限付きで発行される access key、secret key、session token の組。 |
| リージョン | Region | 01 | AWS がサービスを提供する地理的な単位。東京は ap-northeast-1。 |
| 予算（AWS Budgets） | budget (AWS Budgets) | 01 | 支出がしきい値を超えた、または超えそうなときに通知する仕組み。支出を止める上限ではない。 |
| devShell | devShell | 02 | Nix の flake が定義する、固定した版のツールが入った shell 環境。 |
| タスク | task | 02 | この本では vite.config.ts の run.tasks に定義し、vp run <名前> で実行するもの。 |
| construct | construct | 02 | CDK で 1 つ以上の AWS リソースを表す TypeScript の class。 |
| stack | stack | 02 | まとめて作成・更新・削除するリソースの単位。 |
| synth（合成） | synth (synthesis) | 02 | CDK のコードを実行して CloudFormation template などの cloud assembly を出力すること。AWS は変更しない。 |
| diff | diff | 02 | これから行う変更の予告。ソースから作った template と、管理ツールが記録している状態との比較。 |
| drift | drift | 02 | 管理ツールの記録と、実際の AWS の設定がずれていること。 |
| state | state | 02 | 管理ツールが「何を作ったか」を記録したもの。cdkd では S3 上の JSON。 |
| origin | origin | 03 | CDN が元のコンテンツを取りに行く先。この本では S3 bucket や API。 |
| origin access control (OAC) | origin access control (OAC) | 03 | CloudFront が origin へのリクエストに署名し、bucket がその distribution だけを許可する仕組み。 |
| distribution | distribution | 03 | CloudFront の配信設定 1 つ分。ドメイン名を 1 つ持つ。 |
| edge location | edge location | 03 | 利用者に近い場所で cache を返す CloudFront の拠点。 |
| invalidation | invalidation | 03 | edge の cache を期限前に捨てさせる操作。 |
| SPA fallback | SPA fallback | 03 | ファイルに対応しない URL に index.html を返し、client 側の router に処理させること。 |
| 実行環境 | execution environment | 04 | Lambda が関数を動かす隔離された環境。1 つが同時に処理するリクエストは 1 件で、再利用も破棄もされる。 |
| cold start | cold start | 04 | 新しい実行環境の作成と初期化を伴う呼出し。 |
| 実行 role | execution role | 04 | 関数が AWS 上で動くときに引き受ける IAM role。開発者自身の権限とは別物。 |
| HTTP API | HTTP API | 04 | API Gateway の API の種類の 1 つ。REST API、WebSocket API とは機能と料金が異なる。 |
| integration | integration | 04 | API Gateway が route に届いたリクエストを渡す先。この本では Lambda 関数。 |
| runtime validation | runtime validation | 02 | 実行時に届いたデータを schema と照合すること。型注釈はこれを行わない。 |
| invariant | invariant | 04 | どの時点でも成り立っていなければならない性質。テストと障害注入の対象。 |
| 冪等性 | idempotency | 08 | 同じ操作を複数回実行しても結果が 1 回と同じになる性質。 |
| partition key | partition key | 05 | item の置き場所を決める key。同じ値の item はまとめて保存される。 |
| sort key | sort key | 05 | 同じ partition key の中で item を並べ、区別する key。 |
| 条件式（condition expression） | condition expression | 05 | 書き込みと一緒に送る条件。成り立たなければ、その書き込みは行われない。 |
| 楽観ロック | optimistic locking | 05 | 先に鍵をかけず、書き込む瞬間に「見ていた版のままか」を確かめるやり方。 |
| 結果整合の読み取り | eventually consistent read | 05 | 直前の書き込みが反映されていないことがある読み取り。DynamoDB の既定。 |
| 強整合の読み取り | strongly consistent read | 05 | 成功した書き込みがすべて反映されている読み取り。 |
| request unit | request unit | 05 | on-demand の DynamoDB が読み書きを数える課金の単位。 |
| 認証 | authentication | 06 | 呼び出しが誰からのものかを確かめること。 |
| 認可 | authorization | 06 | その人がその操作をしてよいかを決めること。 |
| user pool | user pool | 06 | Amazon Cognito が持つ利用者の名簿。パスワードの検証と token の発行を行う。 |
| access token | access token | 06 | API を呼ぶための token。 |
| ID token | ID token | 06 | サインインした事実と利用者の属性を、アプリ自身に伝える token。API には送らない。 |
| PKCE | PKCE | 06 | authorization code を横取りされても token と交換できないようにする仕組み。 |
| public client | public client | 06 | 秘密を保持できないアプリ。ブラウザで動く SPA がそう。 |
| JWT authorizer | JWT authorizer | 06 | API Gateway HTTP API が、関数を呼ぶ前に token を検証する機能。 |
