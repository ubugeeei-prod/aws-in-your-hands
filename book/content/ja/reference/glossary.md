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
| 一時認証情報 | temporary credentials | 01 | 期限付きで発行されるアクセスキー、シークレットキー、セッショントークンの組。 |
| リージョン | Region | 01 | AWS がサービスを提供する地理的な単位。東京は ap-northeast-1。 |
| 予算（AWS Budgets） | budget (AWS Budgets) | 01 | 支出がしきい値を超えた、または超えそうなときに通知する仕組み。支出を止める上限ではない。 |
| devShell | devShell | 02 | Nix の flake が定義する、固定した版のツールが入ったシェル環境。 |
| タスク | task | 02 | この本では vite.config.ts の run.tasks に定義し、vp run <名前> で実行するもの。 |
| コンストラクト（construct） | construct | 02 | CDK で 1 つ以上の AWS リソースを表す TypeScript のクラス。 |
| スタック | stack | 02 | まとめて作成・更新・削除するリソースの単位。 |
| synth（合成） | synth (synthesis) | 02 | CDK のコードを実行して CloudFormation テンプレートなどの cloud assembly を出力すること。AWS は変更しない。 |
| diff | diff | 02 | これから行う変更の予告。ソースから作ったテンプレートと、管理ツールが記録している状態との比較。 |
| ドリフト | drift | 02 | 管理ツールの記録と、実際の AWS の設定がずれていること。 |
| state | state | 02 | 管理ツールが「何を作ったか」を記録したもの。cdkd では S3 上の JSON。 |
| オリジン | origin | 03 | CDN が元のコンテンツを取りに行く先。この本では S3 バケットや API。 |
| origin access control (OAC) | origin access control (OAC) | 03 | CloudFront がオリジンへのリクエストに署名し、バケットがそのディストリビューションだけを許可する仕組み。 |
| ディストリビューション | distribution | 03 | CloudFront の配信設定 1 つ分。ドメイン名を 1 つ持つ。 |
| エッジロケーション | edge location | 03 | 利用者に近い場所でキャッシュを返す CloudFront の拠点。 |
| キャッシュの無効化（invalidation） | invalidation | 03 | エッジのキャッシュを期限前に捨てさせる操作。 |
| SPA フォールバック | SPA fallback | 03 | ファイルに対応しない URL に index.html を返し、クライアント側の router に処理させること。 |
| 実行環境 | execution environment | 04 | Lambda が関数を動かす隔離された環境。1 つが同時に処理するリクエストは 1 件で、再利用も破棄もされる。 |
| コールドスタート | cold start | 04 | 新しい実行環境の作成と初期化を伴う呼出し。 |
| 実行ロール | execution role | 04 | 関数が AWS 上で動くときに引き受ける IAM ロール。開発者自身の権限とは別物。 |
| HTTP API | HTTP API | 04 | API Gateway の API の種類の 1 つ。REST API、WebSocket API とは機能と料金が異なる。 |
| 統合（integration） | integration | 04 | API Gateway が route に届いたリクエストを渡す先。この本では Lambda 関数。 |
| runtime validation | runtime validation | 02 | 実行時に届いたデータをスキーマと照合すること。型注釈はこれを行わない。 |
| 不変条件 | invariant | 04 | どの時点でも成り立っていなければならない性質。テストと障害注入の対象。 |
| 冪等性 | idempotency | 05 | 同じ操作を複数回実行しても結果が 1 回と同じになる性質。 |
| パーティションキー | partition key | 05 | アイテムの置き場所を決めるキー。同じ値のアイテムはまとめて保存される。 |
| ソートキー | sort key | 05 | 同じパーティションキーの中でアイテムを並べ、区別するキー。 |
| 条件式（condition expression） | condition expression | 05 | 書き込みと一緒に送る条件。成り立たなければ、その書き込みは行われない。 |
| 楽観ロック | optimistic locking | 05 | 先に鍵をかけず、書き込む瞬間に「見ていた版のままか」を確かめるやり方。 |
| 結果整合の読み取り | eventually consistent read | 05 | 直前の書き込みが反映されていないことがある読み取り。DynamoDB の既定。 |
| 強整合の読み取り | strongly consistent read | 05 | 成功した書き込みがすべて反映されている読み取り。 |
| request unit | request unit | 05 | on-demand の DynamoDB が読み書きを数える課金の単位。 |
| 認証 | authentication | 06 | 呼び出しが誰からのものかを確かめること。 |
| 認可 | authorization | 06 | その人がその操作をしてよいかを決めること。 |
| ユーザープール | user pool | 06 | Amazon Cognito が持つ利用者の名簿。パスワードの検証とトークンの発行を行う。 |
| アクセストークン | access token | 06 | API を呼ぶためのトークン。 |
| ID トークン | ID token | 06 | サインインした事実と利用者の属性を、アプリ自身に伝えるトークン。API には送らない。 |
| PKCE | PKCE | 06 | authorization code を横取りされてもトークンと交換できないようにする仕組み。 |
| パブリッククライアント | public client | 06 | 秘密を保持できないアプリ。ブラウザで動く SPA がそう。 |
| JWT オーソライザー | JWT authorizer | 06 | API Gateway HTTP API が、関数を呼ぶ前にトークンを検証する機能。 |
| チャンネル | channel | 18 | IVS の low-latency streaming で、配信を 1 本受けて視聴者へ届ける単位。ingest endpoint と playback URL を持つ。 |
| ストリームキー | stream key | 18 | 配信ソフトがチャンネルへ送るときに示す秘密の文字列。持っている人は誰でもそのチャンネルに配信できる。 |
| ingest | ingest | 18 | 配信ソフトから送られてくる映像を、サービスが受け取ること。 |
| レンディション（rendition） | rendition | 18 | 同じ映像の、解像度と bitrate が違う版の 1 つ。プレイヤーは回線に合わせて切り替える。 |
| timed metadata | timed metadata | 18 | 映像の特定の位置に埋め込む小さなデータ。視聴者ごとの遅延にかかわらず、映像の同じ場面で届く。 |
| VPC | VPC | 11 | Virtual Private Cloud。1 つのリージョンの中に作る、自分専用の IP ネットワーク。アドレスの範囲を自分で決め、サブネットに分けて使う。 |
| CIDR | CIDR | 11 | `10.20.0.0/16` のように、先頭のアドレスと「先頭から何ビットが共通か」でアドレスの範囲を書く記法。/16 は 65,536 個、/20 は 4,096 個。 |
| サブネット | subnet | 11 | VPC のアドレス範囲の一部で、1 つの Availability Zone の中に置かれる。パブリックかプライベートかは、関連付けたルートテーブルで決まる。 |
| Availability Zone（AZ） | Availability Zone (AZ) | 11 | リージョンの中にある、電源とネットワークが独立したデータセンター群。同じリージョンの AZ どうしは同時に壊れにくいように作られているが、リージョン全体の障害からは守ってくれない。 |
| ルートテーブル | route table | 11 | 「この宛先はここへ送る」という規則の表。サブネットに関連付ける。インターネットへの経路があるかどうかは、この表だけで決まる。 |
| インターネットゲートウェイ | internet gateway | 11 | VPC とインターネットをつなぐ出入口。VPC に 1 つ取り付ける。これ自体に料金はかからない。 |
| NAT Gateway | NAT gateway | 11 | プライベートサブネットの中から外への接続だけを通す中継点。パブリックサブネットに置き、Elastic IP アドレスを 1 つ持つ。存在している時間と、通したデータ量の両方に料金がかかる。 |
| セキュリティグループ | security group | 11 | インスタンスなどのリソースに付ける、許可だけの通信規則。stateful で、許可した通信の返事は逆向きの規則がなくても通る。 |
| ネットワーク ACL | network ACL | 11 | サブネットの境界に付ける通信規則。許可と拒否を番号順に評価する。stateless で、返事の通信も別に許可が要る。 |
| ゲートウェイエンドポイント | gateway endpoint | 11 | S3 と DynamoDB へ、インターネットを通らずに届く経路。ルートテーブルに経路として入る。追加料金はない。 |
| インターフェースエンドポイント | interface endpoint | 11 | AWS のサービスへの入口を、サブネットの中にプライベート IP アドレスつきのネットワークインターフェースとして置くもの（AWS PrivateLink）。サービスごと、AZ ごとに時間課金される。 |
| 基盤モデル | foundation model | 17 | Bedrock が API として提供する学習済みのモデル。モデル ID で指定する。 |
| トークン | token | 17 | モデルが文章を読み書きする単位で、課金の単位でもある。文字数とは一致せず、数え方はモデルごとに違う。 |
| inference profile | inference profile | 17 | モデルと、リクエストを送ってよいリージョンの組に付いた ID。モデル ID の代わりに指定する。 |
| cross-Region inference | cross-Region inference | 17 | inference profile を通して、呼び出したリージョンとは別のリージョンで推論が処理され得る仕組み。 |
| レスポンスストリーミング | response streaming | 17 | Lambda が応答を最後まで溜めずに、できた分から呼び出し元へ送る方式。 |
| function URL | function URL | 17 | Lambda 関数に直接付く HTTPS のエンドポイント。API Gateway を挟まない。 |
| server-sent events（SSE） | server-sent events (SSE) | 17 | 1 つの HTTP 応答の中で、サーバーがイベントを順に送り続ける形式。content type は text/event-stream。 |
| SigV4 署名 | SigV4 signature | 17 | AWS の API が呼び出し元を確かめるためのリクエスト署名。認証情報から計算してヘッダーに付ける。 |
| identity（SES） | identity (SES) | 15 | SES に「自分のものだ」と確認してもらった送信元。ドメインか、メールアドレス 1 つ。リージョンごとに確認する。 |
| サンドボックス（SES） | sandbox (SES) | 15 | 新しいアカウントの SES が置かれる制限つきの状態。確認済みの宛先にしか送れない。production access を申請して出る。 |
| bounce | bounce | 15 | メールが届かずに戻ってくること。宛先が存在しないなどの恒久的なもの（hard）と、一時的なもの（soft）がある。 |
| complaint | complaint | 15 | 受信者がメールを「迷惑メール」と報告すること。 |
| 送信停止の一覧（suppression list） | suppression list | 15 | もう送らないと決めた宛先の一覧。bounce や complaint を出した宛先を入れる。 |
| configuration set | configuration set | 15 | SES で、送信時に指定する設定のまとまり。イベントの配送先や suppression の設定を持つ。 |
| SPF | SPF | 15 | 「このドメインの名前で送ってよいサーバー」を DNS の TXT レコードで公開する仕組み。見るのは封筒の差出人（MAIL FROM）のドメイン。 |
| DKIM | DKIM | 15 | メールに電子署名を付け、検証用の公開鍵を DNS で公開する仕組み。 |
| DMARC | DMARC | 15 | 受信者に見える From のドメインが、SPF か DKIM のどちらかで確かめられていることを求め、失敗したメールの扱いを DNS で指示する仕組み。 |
| CloudFront Functions | CloudFront Functions | 10 | CloudFront のエッジロケーションで、リクエストやレスポンスのたびに動く小さな JavaScript。ネットワークにもファイルにも触れず、URL やヘッダーの書き換えに使う。 |
| viewer request | viewer request | 10 | CloudFront が読者からリクエストを受け取った直後、キャッシュを調べる前のタイミング。 |
| KeyValueStore | KeyValueStore | 10 | CloudFront Functions から読める、キーと値の保存場所。関数からは読むだけで、書き換えは外から API で行う。 |
| Lambda@Edge | Lambda@Edge | 10 | us-east-1 に作った Lambda 関数のバージョンを CloudFront が各地に複製し、リクエストの途中で呼ぶ仕組み。 |
| ETag による条件付き更新 | ETag precondition | 10 | 読んだときの版（ETag）を書き込みに添え、その間に他の誰かが書き換えていたら拒否してもらう方法。 |
| マイグレーション | migration | 13 | スキーマの変更を順番つきのファイルにして、どこまで適用したかを DB 自身に記録するやり方。 |
| トランザクション | transaction | 13 | 複数の SQL を「全部反映する」か「何も反映しない」のどちらかにまとめる単位。 |
| snapshot isolation | snapshot isolation | 13 | トランザクションが、開始した時点のデータを最後まで読み続ける分離の方式。PostgreSQL の REPEATABLE READ がこれにあたる。 |
| 楽観的同時実行制御（OCC） | optimistic concurrency control (OCC) | 13 | ロックで待たせず、コミットのときに競合を調べて、負けたトランザクションを失敗させる方式。 |
| serialization failure | serialization failure | 13 | ほかのトランザクションと競合したのでコミットできなかった、という DB からの応答。SQLSTATE は 40001。何も反映されていないので、トランザクションを最初からやり直す。 |
| write skew | write skew | 13 | 2 つのトランザクションが同じデータを読んで判断し、別々の行に書いた結果、どちらか一方だけなら守れた条件が破れること。 |
| データベースロール | database role | 13 | DB の中の利用者。どのテーブルに何ができるかは、このロールへの GRANT で決まる。IAM のロールとは別のもの。 |
| 認証トークン（Aurora DSQL） | authentication token (Aurora DSQL) | 13 | 接続するときだけパスワードの代わりに渡す、IAM の認証情報で署名した期限つきの文字列。 |
| DPU | DPU | 13 | Distributed Processing Unit。Aurora DSQL が、SQL の実行にかかった計算、読み取り、書き込みをまとめて測る課金の単位。 |
| ACU | ACU | 13 | Aurora Capacity Unit。Aurora Serverless v2 の容量の単位で、1 ACU はおよそ 2 GiB のメモリと、それに見合う CPU とネットワーク。 |
| 署名付き URL | presigned URL | 07 | 署名を URL に含めた、期限つきの URL。持っている人は、署名した人の権限の範囲で、決められた 1 つの操作を実行できる。 |
| POST ポリシー | POST policy | 07 | ブラウザからのフォームによる S3 へのアップロードが満たすべき条件（キー、種類、大きさの範囲、期限）を書いた、署名付きの文書。 |
| オブジェクトキー | object key | 07 | バケットの中でオブジェクトを一意に指す名前。`/` を含められるが、フォルダーがあるわけではない。 |
| ベアラートークン | bearer token | 07 | 持っているだけで使える認証情報。誰が使っているかは確かめられない。 |
| ライフサイクルルール | lifecycle rule | 07 | 条件に合うオブジェクトを、作成から一定の日数の後に S3 自身が削除（または移動）する、バケットの設定。 |
| Block Public Access | Block Public Access | 07 | ACL やバケットポリシーでバケットやオブジェクトを公開する設定を、拒否または無効にする S3 の 4 つの設定。 |
| 孤立したオブジェクト | orphaned object | 07 | バケットにはあるが、それを指す記録がどこにも無いオブジェクト。誰にも見えないまま、保存料金だけがかかる。 |
| マルチパートアップロード | multipart upload | 07 | 大きなオブジェクトを複数のパートに分けて送る S3 の仕組み。完了も中止もされなかったパートは、保存されたまま残る。 |
| server-side rendering (SSR) | server-side rendering (SSR) | 09 | リクエストごとにサーバーで HTML を組み立てて返すこと。ブラウザは届いた HTML をまず表示し、そのあと JavaScript が引き継ぐ。 |
| 共有キャッシュ | shared cache | 09 | 1 つの応答を保存して、複数の利用者に返すキャッシュ。CDN がその例。ブラウザの中のキャッシュは 1 人のものなので private cache と呼ぶ。 |
| キャッシュキー | cache key | 09 | CloudFront が「同じリクエスト」とみなす基準。パスに加えて、キャッシュポリシーで選んだクエリ文字列、ヘッダー、cookie からできる。 |
| キャッシュポリシー | cache policy | 09 | cache key に入れる値と、TTL の下限・既定・上限をまとめた CloudFront の設定。 |
| backend for frontend (BFF) | backend for frontend (BFF) | 09 | ある画面のためだけに置くサーバー。ブラウザの代わりにトークンを持ち、裏の API を呼ぶ。 |
| 構造化ログ | structured log | 19 | 1 行が 1 つの JSON になっているログ。項目の名前で絞り込みや集計ができる。 |
| メトリクス | metric | 19 | 時刻ごとの数値の列。リクエスト数、エラー数、応答時間など。CloudWatch では名前、namespace、dimension の組が 1 つのメトリクスになる。 |
| アラーム | alarm | 19 | メトリクスが条件を満たし続けたときに状態を変え、通知などの操作を起こす CloudWatch の仕組み。状態は OK、ALARM、INSUFFICIENT_DATA。 |
| メトリクスフィルター | metric filter | 19 | ロググループに届くログの行を条件で数え、メトリクスにする CloudWatch Logs の設定。作成より前のログには効かない。 |
| embedded metric format（EMF） | embedded metric format (EMF) | 19 | 決まった形の JSON をログに書くと、CloudWatch がそこからメトリクスを取り出す仕組み。 |
| トレース | trace | 19 | 1 つのリクエストが通った処理の記録。トレース ID を共有するスパンの集まり。 |
| スパン | span | 19 | トレースの中の 1 区間。名前、開始と終了の時刻、親のスパン、属性を持つ。X-Ray では segment や subsegment になる。 |
| OpenTelemetry | OpenTelemetry | 19 | トレース、メトリクス、ログの計装と送信のための、ベンダーに依らない仕様とライブラリ。 |
| サンプリング | sampling | 19 | 全部のリクエストではなく、一部だけをトレースとして記録すること。 |
| trace context（traceparent） | trace context (traceparent) | 19 | トレース ID、呼び出し元のスパン ID、サンプリングの決定を次の処理へ渡すための W3C の仕様。HTTP では traceparent ヘッダー。 |
| RUM（real user monitoring） | RUM (real user monitoring) | 19 | 実際の利用者のブラウザで、ページの表示時間やエラーを計測して集めること。 |
| canary（Synthetics） | canary (Synthetics) | 19 | 決まった間隔で外から API やページを呼び、応答を確かめるスクリプト。利用者がいない時間にも動く。 |
| TTL | TTL | 14 | time to live。データに付ける有効期限。期限が来たデータをいつ実際に消すかは store によって違い、DynamoDB では数日後になることがある。 |
| レート制限 | rate limit | 14 | ある利用者が一定時間に呼べる回数の上限。数える場所が全員に共有されていて、数えて比べる操作が 1 ステップでないと守れない。 |
| 固定窓 | fixed window | 14 | 時間を決まった長さの区間に切り、区間ごとに回数を数えるレート制限の方式。区間の境目をまたぐと、短い時間に上限の 2 倍まで通る。 |
| 滑る窓 | sliding window | 14 | 直前の区間の回数を、いまの時刻から見てまだ窓に入っている割合だけ数に入れるレート制限の方式。境目での 2 倍を防ぐ。 |
| 原子的な加算 | atomic counter | 14 | 読んでから書くのではなく、「1 足す」を store の中の 1 ステップとして行う更新。同時に来た加算が失われない。 |
| Valkey | Valkey | 14 | メモリ上の key-value サーバー。Redis がライセンスを変える直前のオープンソース版から分かれたプロジェクトで、ElastiCache のエンジンの 1 つ。 |
| ECPU | ECPU | 14 | ElastiCache Processing Unit。ElastiCache Serverless のリクエストの課金単位。単純な読み書きは、転送した 1 KB あたり 1 ECPU。 |
| read-through cache | read-through cache | 14 | まずキャッシュを読み、無ければ元データを読んでキャッシュに入れる読み方。正しいのは常に元データで、キャッシュはその写し。 |
| stale read | stale read | 14 | 元データが変わったあとに、古い写しを読むこと。キャッシュを使うかぎり起きるので、どれだけ古くてよいかを先に決める。 |
| キャッシュスタンピード | cache stampede | 14 | キャッシュが切れた瞬間に、多数のリクエストが同時に miss して、全員が元データへ取りに行くこと。 |
| single flight | single flight | 14 | 同じキーの読み込みが進行中なら、新しく始めずにその結果を待つこと。効くのは 1 つのプロセスの中だけ。 |
| CloudFormation | CloudFormation | 20 | テンプレートを受け取ってリソースを作り、何を作ったかをスタックとして自分で記録する AWS のサービス。更新に失敗すると、既定では前の状態に戻す。 |
| CDK の bootstrap | CDK bootstrap | 20 | AWS CDK CLI でデプロイする前に、アカウントとリージョンごとに一度行う準備。CDKToolkit というスタックが、asset 用のバケット、ECR のリポジトリ、5 つの IAM ロールを作る。cdkd の bootstrap とは別物。 |
| 変更セット | change set | 20 | スタックの更新を、実行する前に「何が追加・変更・置き換え・削除されるか」の一覧にしたもの。実行するまで何も変わらない。成功を保証するものではない。 |
| OIDC（OpenID Connect） | OIDC (OpenID Connect) | 20 | あるサービスが発行した署名付きのトークンで「自分が誰か」を別のサービスに示す標準。この本では、GitHub Actions のジョブが AWS に入るために使う。 |
| 信頼ポリシー | trust policy | 20 | IAM ロールに付く「誰がこのロールを使えるか」の定義。ロールに何ができるかを決める権限のポリシーとは別。 |
| sub（subject）claim | sub (subject) claim | 20 | OIDC のトークンに入っている「このトークンは何のために発行されたか」を表す文字列。GitHub Actions ではリポジトリと、ブランチ、environment、プルリクエストのいずれかが入る。 |
| Lambda のバージョン | Lambda version | 20 | 関数のコードと設定の、番号付きの写し。発行したあとは変えられない。発行していない最新の状態は $LATEST と呼ばれる。 |
| Lambda のエイリアス | Lambda alias | 20 | バージョンを指す名前つきのポインタ。呼び出す側はエイリアスを呼び、指す先を変えることで版を切り替える。2 つのバージョンに重みを付けて振り分けることもできる。 |
| ロールバック | rollback | 20 | 変更を、変更の前の状態に戻すこと。CloudFormation が戻すのはテンプレートにあるリソースの設定で、その間に書かれたデータは戻らない。 |
| 削除保護（termination protection） | termination protection | 20 | スタックの削除を拒否する設定。解除するまで DeleteStack が失敗する。スタックの更新でリソースが消えることは防がない。 |
| プレビュー環境 | preview environment | 20 | プルリクエストごとに作る、一時的な環境。この本では PR ごとに 1 つのスタック。プルリクエストを閉じたら消す前提で作る。 |
| ネストしたスタック（nested stack） | nested stack | 20 | 別のスタックのリソース（AWS::CloudFormation::Stack）として作られるスタック。親のスタックでドリフトを検出しても、中は調べられない。 |
| コンテナイメージ | container image | 12 | アプリと、それが動くのに要るファイル一式を固めたもの。同じイメージからは、どこで起動しても同じ中身のコンテナができる。 |
| Docker のデーモン | Docker daemon | 12 | イメージの build とコンテナの実行を実際に行う常駐プログラム（dockerd）。`docker` コマンドは、これに頼みごとを送るクライアントにすぎない。 |
| イメージのタグ | image tag | 12 | リポジトリの中でイメージに付ける名前。`v1` やコミットの hash など。タグを immutable にすると、一度付けたタグは別のイメージを指せなくなる。 |
| ECR のリポジトリ | ECR repository | 12 | Amazon ECR の中の、イメージの置き場所。ECS はここからイメージを取ってくる。 |
| タスク定義 | task definition | 12 | 「どのイメージを、どれだけの CPU とメモリで、どのロールと環境変数で動かすか」を書いた設計書。変更のたびに新しい revision になり、既存の revision は書き換えられない。 |
| タスク（ECS） | task | 12 | タスク定義から起動された、動いている 1 つの実体。Fargate ではタスクごとにネットワークインターフェースとプライベート IP アドレスを 1 つ持つ。 |
| サービス（ECS） | service (ECS) | 12 | 「このタスク定義のタスクを、常に N 個動かしておく」という指示と、それを守り続ける仕組み。タスクが落ちれば補充し、タスク定義が変われば入れ替える。 |
| Fargate | Fargate | 12 | コンテナを動かすサーバーを自分で持たずに、タスクの CPU とメモリの大きさと時間だけで課金される実行基盤。 |
| Application Load Balancer（ALB） | Application Load Balancer (ALB) | 12 | HTTP のリクエストを受けて、後ろにいる複数のタスクへ振り分ける入口。存在している時間で課金される。 |
| ターゲットグループ | target group | 12 | ALB が振り分ける先の一覧。タスクの IP アドレスが登録され、ヘルスチェックの設定もここに持つ。 |
| ヘルスチェック | health check | 12 | ALB がターゲットに定期的に送る確認のリクエスト。失敗が続いたターゲットには、リクエストを送らなくなる。 |
| deregistration delay | deregistration delay | 12 | ターゲットグループから外すと決まったターゲットについて、進行中のリクエストが終わるのを ALB が待つ時間。既定は 300 秒。 |
| ローリングアップデート | rolling update | 12 | 新しいタスクを起動し、健全になったら古いタスクを止める、を繰り返して入れ替える更新方法。途中は新旧の版が同時に動く。 |
| deployment circuit breaker | deployment circuit breaker | 12 | 新しいタスクが起動できない、またはヘルスチェックに通らないことが続いたら、更新を失敗と判定する仕組み。設定すれば、最後に成功した状態へ自動で戻す。 |
| タスクロール | task role | 12 | コンテナの中のアプリが AWS を呼ぶときに使う IAM ロール。Lambda の実行ロールに当たる。 |
| タスク実行ロール | task execution role | 12 | アプリが起動する前に、ECS の agent がイメージの取得とログの送信に使う IAM ロール。アプリのコードからは使えない。 |
| グレースフルシャットダウン | graceful shutdown | 12 | 止まれと言われたプロセスが、新しい仕事を受けるのをやめ、進行中の仕事を終えてから終了すること。 |
| SIGTERM | SIGTERM | 12 | プロセスに「終了してほしい」と伝えるシグナル。受け取った側は後片付けができる。一定時間で終わらなければ、拒否できない SIGKILL が送られる。 |
| target tracking | target tracking | 12 | 「平均 CPU 使用率を 60% に保つ」のように指標と目標値だけを決め、タスクの数の増減を任せる auto scaling の方式。 |
| キュー | queue | 08 | 処理してほしいことをメッセージとして預かり、あとで取り出させる置き場所。送る側と処理する側が、同時に動いている必要がなくなる。 |
| at-least-once 配送 | at-least-once delivery | 08 | メッセージが少なくとも 1 回は届く、という保証。2 回以上届くことがある。「ちょうど 1 回」ではない。 |
| 可視性タイムアウト | visibility timeout | 08 | SQS で、受け取られたメッセージが他の受け手から隠される時間。この間に削除されなければ、メッセージはまた受け取れるようになる。 |
| デッドレターキュー（DLQ） | dead-letter queue (DLQ) | 08 | 決めた回数だけ受け取られても処理が終わらなかったメッセージを、よけておく別のキュー。人が調べるための場所。 |
| redrive | redrive | 08 | デッドレターキューのメッセージを、元のキューに戻してもう一度処理させること。 |
| イベントソースマッピング | event source mapping | 08 | Lambda がキューやストリームを自分で読みにいき、まとめて関数に渡す設定。バッチの大きさや同時実行の上限はここで決める。 |
| partial batch response | partial batch response | 08 | バッチのうち失敗したメッセージの ID だけを関数が返す仕組み。成功したメッセージまでやり直されるのを防ぐ。 |
| 冪等性の鍵 | idempotency key | 08 | 「同じ仕事かどうか」を見分けるための値。配送のたびに変わる値（メッセージ ID）ではなく、仕事の中身から決まる値を使う。 |
| sequencer | sequencer | 08 | S3 が作成と削除のイベントに付ける 16 進の文字列。同じキーのイベントどうしなら、大きいほうが後に起きた。 |
| backpressure | backpressure | 08 | 処理する側が追いつかないとき、その遅れを上流に伝えて流量を抑えること。キューはそれを「待ち行列が伸びる」という形で引き受ける。 |
| 突き合わせ | reconciliation | 08 | イベントを待たずに、2 つの置き場所の現在の中身を見比べて、ずれを直す処理。イベントが遅れたり失われたりしても効く。 |
| インスタンス（EC2） | instance (EC2) | 23 | EC2 で借りる仮想マシン 1 台。OS から上は自分で面倒を見る。動いている時間に対して課金され、止めてもボリュームの料金は続く。 |
| AMI | AMI | 23 | Amazon Machine Image。インスタンスの最初のディスクの中身になる雛形。OS と、最初から入っているソフトウェアが決まる。 |
| インスタンスプロファイル | instance profile | 23 | IAM ロールを EC2 のインスタンスに渡すための入れ物。1 つのプロファイルに入るロールは 1 つ。 |
| IMDS | IMDS | 23 | Instance Metadata Service。インスタンスの中からだけ届くアドレス（169.254.169.254）で、インスタンス自身の情報と、ロールの一時認証情報を返す。IMDSv2 は先にトークンを取ってから問い合わせる方式。 |
| ユーザーデータ | user data | 23 | インスタンスの起動時に渡すデータ。シェルスクリプトを渡すと、最初の起動のときに一度だけ、root で実行される。 |
| EBS ボリューム | EBS volume | 23 | インスタンスに取り付けるネットワーク越しのディスク。1 つの Availability Zone に属し、同じ AZ のインスタンスにしか付けられない。インスタンスとは別に生き残れる。 |
| スナップショット（EBS） | snapshot (EBS) | 23 | ある時点のボリュームの写し。差分で保存され、リージョン内のどの AZ にもボリュームとして復元できる。 |
| Session Manager | Session Manager | 23 | Systems Manager の機能。インスタンスの中の SSM Agent が外向きに張った接続を通してシェルを開く。インバウンドのポートも SSH の鍵も使わない。 |
| Run Command | Run Command | 23 | Systems Manager の機能。インスタンスにコマンドを送って実行させ、結果を受け取る。対話はしない。 |
| ユニット（systemd） | unit (systemd) | 23 | systemd に「何を、誰として、どう起動して、落ちたらどうするか」を伝える設定ファイル。サービスを定義するものは `.service` で終わる。 |
| ステータスチェック | status check | 23 | EC2 が 1 分ごとに行うインスタンスの検査。AWS 側の基盤の問題を見る system status check と、インスタンス自身の問題を見る instance status check がある。 |
| 単一障害点 | single point of failure | 23 | そこが止まると全体が止まる部品。1 台のインスタンスと、その 1 つのボリュームがそれにあたる。 |
| CPU クレジット | CPU credit | 23 | T 系のインスタンスが、baseline を超えて CPU を使うために貯めて使う持ち分。standard では使い切ると baseline に絞られ、unlimited では超過分が課金される。 |
| ワークフロー | workflow | 16 | 複数のステップを、決めた順序と条件で実行する処理。どのステップまで終わったかを、ステップの外にある仕組みが覚えている。 |
| ステートマシン | state machine | 16 | Step Functions でのワークフローの定義。state（Task、Choice など）と、そのつながりを JSON で書く。 |
| Amazon States Language | Amazon States Language | 16 | Step Functions のステートマシンを書く JSON の言語。ASL と略す。 |
| 状態遷移 | state transition | 16 | ステートマシンの実行が、ある state から次へ進むこと。Standard ワークフローの課金単位で、再試行も 1 回と数える。 |
| チェックポイント | checkpoint | 16 | 長い処理の途中で「ここまで終わった」を保存すること、またはその記録。やり直すときは、最後のチェックポイントから続ける。 |
| durable function | durable function | 16 | Lambda の関数で、ステップの結果を Lambda が保存し、中断の後に最初から実行し直して済んだステップを飛ばすもの。1 回の呼び出しは 15 分までだが、実行全体は最長 1 年。 |
| リプレイ | replay | 16 | 保存してあるステップの結果を使いながら、コードを最初から実行し直すこと。同じ入力から同じ順序でステップを呼ぶコードでなければ成り立たない。 |
| 補償処理 | compensation | 16 | 途中まで進んだ処理を取り消すために、済んだステップの効果を打ち消す別のステップを実行すること。データベースのロールバックと違い、自分で書き、それ自体も失敗しうる。 |
| マニフェスト | manifest | 16 | 出力を構成するファイルの一覧を書いた、小さなファイル。最後に書くことで、「全部そろった」ことの印になる。 |
| 条件付き書き込み | conditional write | 16 | 「まだ無ければ」「この版のままなら」といった条件を付けた書き込み。条件の検査と書き込みを、保存する側が 1 つの手順として実行する。 |
| Standard ワークフロー | Standard workflow | 16 | Step Functions のワークフローの種類の 1 つ。最長 1 年、state の間で状態を保存し、状態遷移の数で課金される。もう 1 つは最長 5 分の Express。 |
| AWS Batch | AWS Batch | 16 | コンテナのジョブをキューに積み、必要な計算資源（Fargate や EC2）を用意して実行するサービス。 |
| 最小権限 | least privilege | 21 | 仕事に必要なアクションを、必要なリソースに対してだけ許すこと。「あとで要るかもしれない」権限は足さない。 |
| シークレット | secret | 21 | 漏れたら困る値（署名鍵、API キー、パスワード）。Secrets Manager では、暗号化された値と、そのバージョン、誰が読めるかの設定をまとめた 1 つのリソース。 |
| ステージングラベル | staging label | 21 | Secrets Manager がシークレットのバージョンに付ける名札。AWSCURRENT（いまの値）、AWSPREVIOUS（1 つ前）、AWSPENDING（ローテーションの途中）の 3 つを Secrets Manager が管理する。 |
| ローテーション | rotation | 21 | シークレットの値を新しいものに入れ替えること。入れ替えた瞬間に全員が新しい値を持っているわけではないので、古い値もしばらく受け入れる期間を作る。 |
| KMS の鍵 | KMS key | 21 | AWS KMS が持つ暗号鍵。鍵そのものは取り出せず、API を呼んで暗号化・復号してもらう。自分で作る customer managed key は月額がかかり、サービスが作る AWS managed key は月額がかからない。 |
| web ACL | web ACL | 21 | AWS WAF の設定の単位。ルールを順番に並べたもので、CloudFront や ALB などに関連付けると、リクエストが届く前に検査する。置いてあるだけで月額がかかる。 |
| マネージドルールグループ | managed rule group | 21 | AWS や第三者が保守している WAF のルールのまとまり。中身は提供者が更新する。web ACL の中では 1 つのルールとして数える。 |
| 管理イベント | management event | 21 | リソースを作る・変える・消す、設定を読む、といった API 呼び出しの記録。CloudTrail が既定で 90 日ぶん持っている。S3 のオブジェクトの読み書きのような data event は含まない。 |
| SCP（service control policy） | SCP (service control policy) | 21 | AWS Organizations で、メンバーアカウントの IAM ユーザーとロールに許せる権限の上限を決めるポリシー。権限は与えない。管理アカウントには効かない。 |
| 管理アカウント | management account | 21 | organization を作ったアカウント。請求をまとめ、SCP を付ける側。SCP の制限を受けないので、ふだんの作業には使わない。 |
| PITR（point-in-time recovery） | PITR (point-in-time recovery) | 22 | 過去のある時点の状態に戻す機能。DynamoDB では、連続して取られたバックアップから、指定した秒の内容を持つ新しいテーブルを作る。元のテーブルは書き換えない。 |
| RPO（recovery point objective） | RPO (recovery point objective) | 22 | 事故のとき、どれだけ前までのデータを失ってよいか、という目標。時間で表す。実際に失った長さは、復元した時点から事故までの間隔。 |
| RTO（recovery time objective） | RTO (recovery time objective) | 22 | 事故から、サービスが元どおり使えるようになるまでにかけてよい時間、という目標。復元の API が返るまでではなく、利用者が正しいデータを読めるまでを測る。 |
| 削除マーカー | delete marker | 22 | バージョニングを有効にした S3 バケットで、バージョンを指定せずにオブジェクトを消したときに置かれる目印。中身は消えず、目印がいちばん新しいバージョンになる。目印を消すと、オブジェクトは戻る。 |
| cell（celld） | cell (celld) | 24 | celld での Durable Object。名前と、自分専用の SQLite データベースを持つ小さなサーバー。 |
| ノード（celld） | node (celld) | 24 | 1 台のマシンで動く celld のプロセス 1 つ。どのノードもどの cell でも担当できる。 |
| fleet | fleet | 24 | 同じバケットを共有する celld のノードの集まり。参加の手続きはなく、バケットの中のリースでお互いを見つける。 |
| 持ち主の記録（ownership record） | ownership record | 24 | cell ごとにバケットに 1 つある小さなオブジェクト。いまの持ち主（ノードのセッション）と fencing epoch が書いてある。条件付きの書き込みでしか更新されない。 |
| fencing epoch | fencing epoch | 24 | 持ち主が替わるたびに増える番号。古い持ち主の書き込みを、新しい持ち主の状態から切り離すために使う。 |
| リース（ノード） | lease (node) | 24 | ノードが生きていることを示す、期限つきの記録。期限までに更新できなかったノードは、自分から止まる。 |
| フォロワー | follower | 24 | 持ち主のノードから書き込みを受け取り、自分のディスクに保存する別のノード。celld では 1 台か 2 台。 |
| drain | drain | 24 | ノードを止める前に、担当している仕事をほかへ引き渡すこと。celld では SIGTERM がその合図。 |
| スーパーバイザー | supervisor | 24 | プロセスを起動し、落ちたら起動し直す仕組み。この章では systemd。 |
| セルフホスト | self-hosting | 24 | managed service を使わず、ソフトウェアを自分のマシンで動かして、更新や障害対応も自分で受け持つこと。 |
| operational readiness review（ORR） | operational readiness review (ORR) | 33 | サービスを公開する前に、運用できる状態かどうかを決まった質問の一覧で確かめる点検。AWS が自社の障害の教訓から作った仕組みで、Well-Architected Framework も勧めている。 |
| 対応手順（runbook） | runbook | 33 | 決まった結果を得るための手順を書いた文書。アラームが鳴ったときに最初に開くものと、試すことを書いておく。 |
| game day | game day | 33 | 障害をわざと起こして、手順、権限、アラームが実際に働くかを、本番で対応する人たちで確かめる訓練。 |
| Aspect（CDK） | aspect (CDK) | 33 | スタックの中のすべてのコンストラクトを 1 つずつ訪ねて、設定を調べたり書き換えたりする CDK の仕組み。あとから足したリソースにも同じ処理がかかる。 |
| パーティション（Athena） | partition (Athena) | 26 | テーブルのデータを、キーの値ごとに別のフォルダーへ分けたもの。条件にパーティションのキーがあるクエリは、該当するフォルダーだけを読む。 |
| partition projection | partition projection | 26 | Athena が、パーティションの一覧をカタログに問い合わせるかわりに、テーブルのプロパティに書いた規則から計算する機能。 |
| 列指向フォーマット | columnar format | 26 | Parquet や ORC のように、データを行ごとではなく列ごとにまとめて保存する形式。クエリは必要な列だけを読める。 |
| SerDe | SerDe | 26 | serializer/deserializer の略。ファイルの中身をテーブルの行として読む方法を決める部品で、テーブルの定義に名前を書く。 |
| ワークグループ（Athena） | workgroup (Athena) | 26 | Athena のクエリをまとめる単位。結果の保存先と、1 回のクエリが読んでよいバイト数の上限を持てる。 |
| Firehose ストリーム | Firehose stream | 26 | Amazon Data Firehose が受け取ったレコードをためて、まとめて宛先（この章では S3）へ書く入口。 |
| クォータ | service quota | 32 | サービスがアカウントやリージョンごとに決めている、リソースや操作の上限。引き上げを申請できるものと、変えられないものがある。 |
| スロットリング | throttling | 32 | 受け付ける量を超えたリクエストを、処理せずに断ること。HTTP では 429 で返ることが多い。 |
| トークンバケット | token bucket | 32 | 一定の速さでトークンがたまり、リクエスト 1 件が 1 つ使う数え方。ためられる数の上限がバーストになる。 |
| 指数バックオフ | exponential backoff | 32 | 再試行のたびに、待つ時間の上限を 2 倍にしていく待ち方。 |
| ジッター | jitter | 32 | 待つ時間に混ぜる乱数。同時に失敗したクライアントが、同時に戻ってこないようにする。 |
| 再試行の予算 | retry budget | 32 | 1 つのクライアントが出せる再試行の総量。成功すると少し戻り、失敗が続くと尽きて、再試行をやめる。 |
| リトライストーム | retry storm | 32 | 失敗への再試行が負荷を増やし、増えた負荷がさらに失敗を生む状態。 |
| 予約済み同時実行数 | reserved concurrency | 32 | 1 つの関数に取り分けた同時実行数。その関数の上限であり、ほかの関数が使えなくなる取り分でもある。 |
| コスト配分タグ | cost allocation tag | 32 | 請求の内訳に使うと決めて有効にしたタグのキー。有効にするまで、タグは料金のデータに現れない。 |
| 負荷試験 | load test | 32 | 決めた量のリクエストを送り、どの上限に最初に当たるかと、そのときの応答を確かめる試験。 |
| 埋め込み（embedding） | embedding | 27 | 文章を、決まった個数の数の並び（ベクトル）に変えたもの。意味の近い文章が近い向きのベクトルになるように、モデルが作る。 |
| ベクトルインデックス | vector index | 27 | ベクトルを保存し、与えたベクトルに近いものを返す入れ物。S3 Vectors では、ベクトルバケットの中に作る。 |
| RAG（retrieval-augmented generation） | RAG (retrieval-augmented generation) | 27 | 質問に関係する文章を先に検索し、その文章をモデルに渡して答えを書かせる方法。 |
| パッセージ | passage | 27 | 検索と引用の単位として切り出した、ノートの一部分。この本では 800 文字ごとに、100 文字ずつ重ねて切る。 |
| グローバルテーブル（global table） | Global table | 28 | DynamoDB のテーブルを複数のリージョンに置き、どのレプリカへの書き込みもほかのレプリカに届ける機能。レプリカはどれも読み書きできる。 |
| MREC（multi-Region eventual consistency） | MREC (multi-Region eventual consistency) | 28 | グローバルテーブルの既定の整合性モード。書き込みは受けたリージョンで確定し、ほかのリージョンには後から届く。 |
| MRSC（multi-Region strong consistency） | MRSC (multi-Region strong consistency) | 28 | グローバルテーブルの整合性モードの 1 つ。書き込みは、ほかのリージョンの少なくとも 1 つに届いてから成功を返す。3 つのリージョンが要る。 |
| last writer wins | Last writer wins | 28 | 同じアイテムへの書き込みが食い違ったとき、時刻の新しいほうを残し、古いほうを捨てる決め方。捨てられた書き込みは、どこにも記録されない。 |
| ウィットネス（witness） | Witness | 28 | MRSC のグローバルテーブルで、2 つのレプリカが合意するために使う 3 つ目のリージョン。読み書きはできない。 |
| クロスリージョンレプリケーション（CRR） | Cross-Region Replication (CRR) | 28 | S3 のバケットに書かれた新しいオブジェクトを、別のリージョンのバケットへ非同期にコピーする設定。 |
| フェイルオーバールーティング | Failover routing | 28 | Route 53 のルーティングポリシーの 1 つ。プライマリのレコードが正常なあいだはそれを返し、異常になるとセカンダリを返す。 |
| レイテンシールーティング | Latency routing | 28 | Route 53 のルーティングポリシーの 1 つ。問い合わせた利用者から遅延のいちばん小さいリージョンのレコードを返す。 |
| active-passive | Active-passive | 28 | ふだんは 1 つのリージョンだけがリクエストに答え、もう 1 つは切り替えに備えて待つ構成。両方が常に答える構成は active-active。 |
| 重み付きエイリアス（weighted alias） | weighted alias | 31 | 2 つのバージョンを指し、リクエストを割合で振り分ける Lambda のエイリアス。振り分けはリクエストごとの確率で決まる。 |
| canary デプロイ | canary deployment | 31 | 新しいバージョンにまず少ない割合のリクエストだけを送り、問題が無ければ残りを切り替えるやり方。19章の Synthetics の canary とは別のもの。 |
| blue/green デプロイ | blue/green deployment | 31 | 古い環境（blue）を動かしたまま新しい環境（green）を横に用意し、トラフィックを切り替えるやり方。戻すときは blue に切り替え直す。 |
| bake time | bake time | 31 | 切り替えが終わった後、アラームを見ながら古いバージョンをすぐ戻せる状態で待つ時間。 |
| フィーチャーフラグ | feature flag | 31 | デプロイ済みのコードのふるまいを、デプロイせずに切り替えるための設定値。 |
| version skew | version skew | 31 | クライアントとサーバー、あるいは同時に動く 2 つのバージョンのあいだで、前提にしている形式やふるまいが食い違うこと。 |
| Lambda Managed Instances | Lambda Managed Instances | 35 | Lambda の関数を、自分のアカウントの VPC にある EC2 インスタンスで動かす機能。インスタンスの起動、パッチ、ルーティング、スケーリングは Lambda が行い、料金はインスタンスの時間に対してかかる。 |
| キャパシティプロバイダー（Lambda） | capacity provider (Lambda) | 35 | Lambda Managed Instances で、関数を動かすインスタンスの置き場所と条件を決めるリソース。サブネット、セキュリティグループ、オペレーターロール、インスタンスの種類、vCPU の上限を持つ。同じキャパシティプロバイダーに載せた関数は、互いに信頼できるものとして扱われる。 |
| オペレーターロール | operator role | 35 | Lambda が、キャパシティプロバイダーのインスタンスを起動し管理するために引き受ける IAM ロール。関数が動くときの実行ロールとは別のもの。 |
| マルチコンカレンシー | multi-concurrency | 35 | 1 つの実行環境が、同時に複数のリクエストを処理すること。標準の Lambda は 1 つの実行環境で一度に 1 つしか処理しない。 |
| Init フェーズ | Init phase | 29 | 実行環境を作った直後に 1 回だけ走る段階。extension の起動、ランタイムの起動、ハンドラーの外に書いたコードの実行までを含む。 |
| Invoke フェーズ | Invoke phase | 29 | ハンドラーが 1 件のリクエストを処理する段階。関数のタイムアウトはこの段階全体にかかる。 |
| REPORT 行 | REPORT line | 29 | Lambda が呼び出しごとに 1 行書く記録。実行時間、課金された時間、メモリの設定と最大使用量、コールドスタートなら初期化の時間が入る。 |
| GB 秒 | GB-second | 29 | Lambda の実行時間の課金単位。メモリの設定（GB）に、課金された時間（秒）を掛けたもの。 |
| provisioned concurrency | provisioned concurrency | 29 | あらかじめ初期化しておく実行環境の数。バージョンかエイリアスに付け、使われなくても時間で課金される。 |
| tree shaking | tree shaking | 29 | バンドルするときに、どこからも使われていないコードを落とすこと。ES modules で書かれたコードにしか効かない。 |
| レイヤー | layer | 29 | 関数に追加で載せる .zip。中身は実行環境の /opt に展開される。 |
| extension | extension | 29 | 関数と同じ実行環境で動く別のプログラム。監視の道具などが使う。CPU とメモリを関数と分け合う。 |
| isolate | isolate | 29 | V8 が 1 つのプロセスの中に作る、互いにメモリを共有しない実行の単位。Cloudflare Workers はこの単位でコードを動かす。 |
| イベントバス | event bus | 25 | 「何が起きたか」を受け取って、それを知りたい相手に配る中継点。送る側は、誰が受け取るかを知らない。 |
| イベントパターン | event pattern | 25 | EventBridge のルールが、どのイベントを受け取るかを書く JSON。イベントと同じ形をしていて、欄ごとに「この値のどれか」を並べる。 |
| ファンアウト | fan-out | 25 | 1 つのメッセージを、複数の受け取り手それぞれに届けること。 |
| リプレイ（イベントの） | replay (of events) | 25 | 保存してあった過去のイベントを、もう一度コンシューマーに届け直すこと。届く側から見れば、同じイベントがもう一度来る。 |
| コントロールプレーン | control plane | 34 | Kubernetes の API サーバーと、クラスターの状態を持つ etcd など、クラスターを管理する側の部品。EKS では AWS が動かし、クラスター 1 つごとに時間で課金される。 |
| Pod | pod | 34 | Kubernetes が動かす最小の単位。1 つ以上のコンテナと、それらが共有するネットワークからなる。ECS のタスクに当たる。 |
| ノード | node | 34 | Pod を載せるマシン。EKS では EC2 のインスタンスで、Pod はノードの CPU とメモリを分け合う。 |
| EKS Auto Mode | EKS Auto Mode | 34 | ノードの起動と入れ替え、ロードバランサー、Pod のネットワーク、ブロックストレージを EKS が受け持つ動かし方。ノードは利用者のアカウントの EC2 インスタンスだが、ログインも AMI の指定もできない。 |
| ノードプール | node pool | 34 | Auto Mode（Karpenter）が起動してよいノードの条件と上限を書いた Kubernetes のオブジェクト。CPU アーキテクチャ、インスタンスタイプ、合計の vCPU などを決める。 |
| EKS Pod Identity | EKS Pod Identity | 34 | クラスター、namespace、service account の組に IAM ロールを結び付ける仕組み。結び付けは EKS の API に持ち、ロールの信頼ポリシーは pods.eks.amazonaws.com を許すだけで済む。 |
| アクセスエントリー | access entry | 34 | IAM のロールやユーザーに、Kubernetes の API で何をしてよいかを結び付ける EKS の設定。クラスターの中の ConfigMap ではなく EKS の API で管理する。 |
| PodDisruptionBudget | PodDisruptionBudget | 34 | ノードの drain のような意図した中断で、同時に欠けてよい Pod の数を決める Kubernetes のオブジェクト。ノードの故障は止められない。 |
| Ingress | Ingress | 34 | クラスターの外から来た HTTP を、どの Service へ送るかを書いた Kubernetes のオブジェクト。EKS では、これを見たコントローラーが Application Load Balancer を作る。 |
| 延長サポート | extended support | 34 | Kubernetes のマイナーバージョンが EKS の標準サポート（公開から 14 か月）を過ぎたあとの 12 か月。クラスターの時間料金が上がる。 |
| アクセスパターン | access pattern | 30 | アプリがデータをどう読み書きするかを 1 つずつ書いたもの。「ある持ち主のノートを更新の新しい順に 20 件」のように、条件と並び順まで含める。DynamoDB では、キーをこれに合わせて決める。 |
| single-table design | single-table design | 30 | 種類の違うデータを 1 つの DynamoDB テーブルに置き、キーの形で区別する設計。一緒に読むものを同じパーティションキーの下に並べて、1 回の Query で返せるようにする。 |
| アイテムコレクション | item collection | 30 | パーティションキーが同じアイテムの集まり。ソートキーの順に並んでいて、その一部を Query で範囲として読める。 |
| global secondary index（GSI） | global secondary index (GSI) | 30 | テーブルのアイテムを、別のキーで引けるようにした写し。DynamoDB がテーブルへの書き込みのあとに非同期で更新するので、読み取りは結果整合だけになる。書き込みのたびにインデックスへの書き込みも料金になる。 |
| sparse index | sparse index | 30 | テーブルの一部のアイテムだけが載っているインデックス。インデックスのキーにした属性を持たないアイテムは、載らない。 |
| プロジェクション | projection | 30 | テーブルのアイテムから、インデックスに写す属性の範囲。キーだけ、指定した属性、すべての 3 通り。写していない属性は、インデックスからは読めない。 |
| 非正規化 | denormalization | 30 | 同じ値を複数のアイテムに持たせること。読むときに結合しなくて済むかわりに、値が変わったときにすべての写しを書き直す責任がアプリに移る。 |
| トランザクション（DynamoDB） | transaction (DynamoDB) | 30 | TransactWriteItems で、最大 100 個のアイテムへの書き込みと条件を、すべて成功かすべて失敗かにまとめる操作。1 回のリクエストで完結し、途中で読んだ結果を見て続きを決めることはできない。料金は通常の書き込みの 2 倍。 |
| ストリーム（DynamoDB Streams） | stream (DynamoDB Streams) | 30 | テーブルのアイテムの変更を、起きた順に 24 時間保持する記録。変更 1 件が 1 レコードになる。Lambda がこれを読んで関数を呼ぶと、同じレコードが 2 回以上届くことがある。 |
| ホットパーティション | hot partition | 30 | 読み書きが集中して、パーティション 1 つの上限に当たっているパーティション。テーブル全体の容量が余っていても、そこへのリクエストだけがスロットリングされる。 |
| バックフィル | backfill | 30 | すでに保存されているデータに、あとから決めた形（新しい属性や新しいキー）を書き足していく作業。動いているアプリの書き込みと並行するので、何度実行しても同じ結果になり、途中から再開できるように作る。 |
| ページトークン | page token | 30 | 一覧の続きを読むために、API がクライアントに渡す値。クライアントから戻ってきたときは信用できない入力として扱い、形を確かめ、誰のデータを読むかはトークンではなく認証した利用者から決める。 |
| ロケーション（DataSync） | location (DataSync) | 38 | DataSync がコピーの元か先として扱う置き場所の登録。S3 なら、バケットと、DataSync がそのバケットに届くためのロールの組。作るだけでは何も動かない。 |
| タスク（DataSync） | task (DataSync) | 38 | ソースとデスティネーションのロケーション、コピーのしかたの設定、スケジュールをまとめたもの。ECS のタスクとは別のもの。 |
| タスク実行（task execution） | task execution | 38 | DataSync のタスクを 1 回動かしたもの。準備、転送、検証の段階を進み、SUCCESS か ERROR で終わる。 |
| エージェント（DataSync） | agent (DataSync) | 38 | 自分のネットワークの中に置く仮想マシンで、DataSync の代わりに NFS や SMB のストレージを読み書きする。S3 どうしのコピーには要らない。 |
| 混乱した代理（confused deputy） | confused deputy | 38 | 権限を持つサービスが、別の誰かの依頼で、依頼した人には触れないはずのリソースを操作してしまう問題。信頼ポリシーに `aws:SourceAccount` と `aws:SourceArn` の条件を書いて防ぐ。 |
| CloudShell | CloudShell | 37 | コンソールの中で開くシェル。サインインしている identity の認証情報を最初から持ち、AWS の側の環境（1 vCPU、2 GiB、ホームディレクトリ 1 GB）で動く。追加の料金はない。 |
| VPC 環境（CloudShell） | VPC environment (CloudShell) | 37 | VPC、サブネット、セキュリティグループを指定して作る CloudShell の環境。選んだサブネットの中から通信する。ホームディレクトリは残らず、画面からのファイルの上げ下ろしは使えない。 |
| Cloud9 | Cloud9 | 37 | ブラウザで使う統合開発環境。EC2 のインスタンスか自分のサーバーの上で動く。2024 年 7 月 25 日から新しい利用者を受け付けていない。 |
| Health イベント | Health event | 44 | AWS Health が、ほかの AWS サービスに代わって送る知らせ。サービスの障害、予定された変更、アカウントへの通知がある。 |
| public イベント | public event | 44 | アカウントに関係なく公開される Health イベント。そのサービスやリージョンを使っていなくても届く。 |
| アカウント固有のイベント | account-specific event | 44 | 自分のアカウントのリソースに関わる Health イベント。影響を受けるリソースの ID が付く。 |
| planned lifecycle event | planned lifecycle event | 44 | ランタイムやバージョンのサポート終了のように、利用者の対応が要る変更を前もって知らせる Health イベント。開始時刻が変更の日付になる。 |
| organizational view | organizational view | 44 | AWS Organizations の全アカウントの Health イベントを、管理アカウントか委任した管理者アカウントでまとめて見る機能。 |
| CDC（change data capture） | CDC (change data capture) | 39 | データベースに加えられた変更を、その記録（PostgreSQL では WAL）から順に読み出すこと。AWS DMS は、読み出した変更をターゲットに同じ順で適用する。 |
| full load | full load | 39 | AWS DMS が、ソースのテーブルにいまある行をすべてターゲットへ写す段階。テーブルごとに進み、順序は保証されない。 |
| レプリケーションスロット | replication slot | 39 | PostgreSQL が、ある読み手がどこまで WAL を読んだかを覚えておく仕組み。読み手が読み終えるまで WAL を消さないので、読み手がいなくなったスロットはディスクを埋めていく。 |
| 切り替え（cutover） | cutover | 39 | アプリケーションの接続先を、古いデータベースから新しいデータベースへ移す作業。書き込みを止め、残りの変更が届くのを待ち、確かめてから接続先を替える。 |
| DCU（DMS capacity unit） | DCU (DMS capacity unit) | 39 | AWS DMS Serverless の容量の単位。1 DCU はメモリ 2 GB。動いているレプリケーションが使っている DCU に、時間単位で課金される。 |
| source server | source server | 40 | Elastic Disaster Recovery が保護しているサーバー 1 台。agent を入れた時点で登録され、切り離すまで時間単位で課金される。 |
| AWS Replication Agent | AWS Replication Agent | 40 | source server の中で動き、disk への書き込みを block 単位で replication server に送り続けるプログラム。 |
| staging area | staging area | 40 | 複製先のリージョンで、replication server と複製された disk が置かれるサブネット。復旧するまでは、ここに起動済みのサーバーは無い。 |
| replication server | replication server | 40 | staging area で agent からデータを受け取り、staging 用の volume に書く EC2 インスタンス。サービスが起動し、入れ替える。 |
| recovery instance | recovery instance | 40 | 選んだ時点の snapshot から起動した EC2 インスタンス。訓練で起動したものは drill instance と呼ぶ。 |
| 復旧訓練（recovery drill） | recovery drill | 40 | 本番に触れずに、復旧と同じ手順でインスタンスを起動して確かめること。確かめ終えたら終了する。 |
| failover | failover | 40 | 利用者の通信の宛先を、元のシステムから復旧先に切り替えること。Elastic Disaster Recovery の外で、自分で行う。 |
| failback | failback | 40 | 復旧先で増えたデータを元の場所へ複製し直し、通信の宛先を戻すこと。 |
| split brain | split brain | 40 | 2 つの場所が、どちらも自分が本番だと思って書き込みを受け付けている状態。片方の書き込みは、あとで必ず捨てることになる。 |
| crash consistent | crash consistent | 40 | 電源が突然切れた瞬間の disk と同じ状態。メモリにあって disk に書かれていなかったデータは含まれない。 |
| Firewall Manager のポリシー | Firewall Manager policy | 42 | Firewall Manager の管理者アカウントに 1 つ作る設定で、保護の内容（WAF のルールグループや監査用のセキュリティグループなど）と、適用する範囲（アカウント、OU、リソースタイプ、タグ）を持つ。範囲に入るリソースには、あとから作られたものにも適用される。IAM のポリシーとは別のもの。 |
| OU（organizational unit） | OU (organizational unit) | 42 | AWS Organizations で、アカウントをまとめる入れ物。入れ子にできる。Firewall Manager のポリシーや SCP で OU を指定すると、その OU と子の OU にあるアカウントすべてが対象になる。 |
| 委任された管理者（delegated administrator） | delegated administrator | 42 | 組織の管理アカウントが、あるサービスの管理を任せたメンバーアカウント。Firewall Manager の管理者アカウントは、Organizations の委任された管理者として登録される。 |
| 自動修復（automatic remediation） | automatic remediation | 42 | Firewall Manager のポリシーの設定。無効なら、ポリシーに合っていないリソースを報告するだけで何も変えない。有効なら、web ACL を関連付ける、ルールを消すといった変更を Firewall Manager がメンバーアカウントで行う。 |
| Fargate Spot | Fargate Spot | 41 | AWS の空いている容量でタスクを動かす、割引された Fargate。AWS が容量を取り戻すとき、2 分前に SIGTERM が届いてタスクが止まる。 |
| capacity provider strategy | capacity provider strategy | 41 | タスクをどの capacity provider にどの割合で置くかの指定。`base` は最低限そこに置く数、`weight` は残りを分ける比。 |
| プラットフォームバージョン | platform version | 41 | Fargate がタスクを動かす実行環境（カーネルとコンテナランタイム）の版。Linux で選べるのは 1.4.0 で、`LATEST` もこれを指す。 |
| タスクのリタイア（task retirement） | task retirement | 41 | Fargate が、古くなったプラットフォームバージョンのリビジョンで動いているタスクを、予告のうえで止めること。サービスのタスクは置き換えられ、単発のタスクは止まるだけ。 |
| スケールイン | scale-in | 41 | タスクの数を減らすこと。増やすほうはスケールアウト。減らされるタスクが抱えているリクエストをどう終わらせるかが問題になる。 |
| ECS Exec | ECS Exec | 41 | 動いているコンテナの中でコマンドを実行する機能。Systems Manager の Session Manager を使い、コマンドは root で動く。新しく起動したタスクにしか有効にできない。 |
| エフェメラルストレージ | ephemeral storage | 41 | タスクが動いている間だけ使えるディスク。Fargate では 20 GiB が付き、200 GiB まで増やせる。イメージもここに展開される。 |
| Infrastructure Composer | Infrastructure Composer | 45 | CloudFormation と SAM のテンプレートを、カードと線の図として表示し、図からも編集できる AWS の道具。以前の名前は Application Composer。単独のコンソールは 2026 年 12 月 7 日に終わり、AWS Toolkit for Visual Studio Code の中のものが残る。 |
| template studio | template studio | 45 | CloudFormation のコンソールにあるテンプレートのエディタ。テンプレートの文字の横に、リソースと参照の図を表示する。正本は文字で、図からは編集できない。 |
| tool use | tool use | 36 | モデルが、アプリの用意した関数を名前と入力で指定して実行を求めること。実行するのはアプリで、モデルではない。 |
| tool result | tool result | 36 | tool use に対してアプリが返す結果。次のリクエストの user メッセージに入れてモデルへ渡す。 |
| 構造化出力 | structured output | 36 | モデルの出力を、指定した JSON Schema に合う JSON に限る機能。合った JSON でも、業務上の条件はアプリが検証する。 |
| ガードレール | guardrail | 36 | Bedrock Guardrails の設定の単位。入力と出力のテキストを決めたフィルターで調べ、該当すれば決めたメッセージに差し替える。 |
| text unit | text unit | 36 | Guardrails の課金単位。1,000 文字までが 1 unit。 |
| prompt caching | prompt caching | 36 | 毎回同じ内容で始まるプロンプトの先頭部分を、モデルの側で使い回す機能。読み出した分は入力より安い単価で課金される。 |
| cache checkpoint | cache checkpoint | 36 | プロンプトの中で、ここまでをキャッシュの対象にすると示す目印。Converse API では cachePoint ブロック。 |
| batch inference | batch inference | 36 | 多数のリクエストを S3 のファイルで渡し、結果をあとで S3 に受け取る推論。すぐには返らない代わりに安い。 |
| burndown rate | burndown rate | 36 | 出力 1 トークンが、分あたりのトークンのクォータを何トークン分減らすかの倍率。モデルごとに違う。 |
| Provisioned Throughput | Provisioned Throughput | 36 | モデルの処理能力を時間課金で確保する買い方。消すまで課金が続く。 |
| プロンプトインジェクション | prompt injection | 36 | モデルが読むデータの中に指示を書き、開発者の指示の代わりに従わせようとする攻撃。 |
| モデルのライフサイクル | model lifecycle | 36 | Bedrock のモデルの状態。Active、Legacy、End-of-Life の順に進み、終了日を過ぎると呼び出しが失敗する。 |
| DDoS | DDoS | 46 | 分散サービス拒否（distributed denial of service）。多数の送信元から通信を送りつけて、本来の利用者が使えない状態にする攻撃。回線を埋めるもの、プロトコルの状態を使い切らせるもの、正しい形のリクエストを大量に送るものがある。 |
| denial of wallet | denial of wallet | 46 | 従量課金のサービスに大量のリクエストを送り、止めるのではなく請求を膨らませる攻撃。サービスは動き続けるので、気づくのが請求書になりやすい。 |
| Shield Advanced | Shield Advanced | 46 | AWS Shield の有料の契約。指定したリソースに、より低い検知の閾値、専門チームへの連絡、攻撃による料金の一部への補填などを足す。月額と 1 年の約束がある。無料で全員に付くほうは Shield Standard。 |
| マネージドプレフィックスリスト | managed prefix list | 46 | AWS が中身を管理している IP アドレス範囲の一覧。セキュリティグループのルールで、CIDR の代わりに ID で指定できる。CloudFront がオリジンへ接続するサーバーの範囲をまとめたものがある。 |
| saga | saga | 47 | いくつかのサービスにまたがる変更を、1 つのトランザクションにまとめる代わりに、ステップごとに確定させていくやり方。後のステップが失敗したら、済んだステップを補償処理で打ち消す。途中の状態は外から見える。 |
| タスクトークン（task token） | task token | 47 | Step Functions が、外からの返事を待つタスクに付ける文字列。返事をする側は、このトークンを添えて SendTaskSuccess か SendTaskFailure を呼ぶ。 |
| JSONata | JSONata | 47 | JSON を選んで組み替えるための式の言語。Step Functions のステートの中では、`{% %}` で囲んだ文字列が JSONata の式として評価される。 |
| Express ワークフロー | Express workflow | 47 | Step Functions のワークフローの種類の 1 つ。最長 5 分で、途中の状態を保存せず、実行の回数と時間とメモリで課金される。同じ実行が 2 回走ることがある。 |
| ハートビート（heartbeat） | heartbeat | 47 | 長くかかるタスクが「まだ動いている」と知らせる合図。HeartbeatSeconds の間に届かなければ、Step Functions はそのタスクを失敗にする。 |
| 実行パラメーター（Athena） | execution parameter (Athena) | 49 | SQL の文に書いた `?` に、実行のときに順番に当てはめる値。文とは別の引数として Athena に渡す。 |
| CTAS | CTAS | 49 | CREATE TABLE AS SELECT の略。クエリの結果を S3 にファイルとして書き、それを指すテーブルを同時に作る文。 |
| Iceberg テーブル | Iceberg table | 49 | Apache Iceberg の形式で管理するテーブル。どのファイルがテーブルに属するかをメタデータが持つので、行単位の変更と、過去の時点の読み出しができる。 |
| クエリ結果の再利用 | query result reuse | 49 | 同じワークグループで同じクエリが最近実行されていれば、実行せずにその結果を返す Athena の機能。クエリごとに、許す古さを指定して有効にする。 |
| コマンド | command | 48 | AWS SDK for JavaScript v3 で、1 つの API 操作とその入力を表すオブジェクト。クライアントの send に渡して実行する。 |
| ミドルウェアスタック | middleware stack | 48 | SDK のクライアントが 1 回の呼び出しで順に通す処理の並び。initialize、serialize、build、finalizeRequest、deserialize の 5 つのステップに分かれ、再試行と署名は finalizeRequest にある。 |
| 認証情報プロバイダーチェーン | credential provider chain | 48 | 認証情報を明示しなかったときに、SDK が決まった順に試す取得元の並び。最初に認証情報を返したところで止まる。 |
| ページネーター | paginator | 48 | 続きを指すトークンやキーを次のリクエストに渡す処理を、非同期のイテレーターとして包んだ SDK の関数。 |
| ウェイター | waiter | 48 | リソースが目的の状態になるまで、間隔をあけて状態を問い合わせ続ける SDK の関数。待つ時間の上限は呼び出す側が決める。 |
| マーシャリング | marshalling | 48 | JavaScript の値と、DynamoDB の型つきの属性値（S、N、M など）を相互に変換すること。lib-dynamodb のドキュメントクライアントが送受信のたびに行う。 |
| サービス例外 | service exception | 48 | AWS のサービスが返したエラーを表す SDK のクラス。サービスごとの基底クラスを継承し、$fault、$metadata、name を持つ。 |
| リクエストハンドラー | request handler | 48 | SDK のクライアントの中で、実際に HTTP リクエストを送る部品。Node.js では node:http と node:https を使い、接続の再利用とタイムアウトをここで設定する。 |
| ファイルシステム（EFS） | file system (EFS) | 53 | EFS で作る、NFS でマウントする共有のディスク。容量を決めずに作り、置いた量と読み書きした量に課金される。同じリージョンの複数の実行環境から同時にマウントできる。 |
| NFS | NFS | 53 | Network File System。ネットワークの向こうのファイルシステムを、手元のディレクトリとしてマウントするプロトコル。EFS が話すのは 4.0 と 4.1。 |
| マウントターゲット | mount target | 53 | EFS のファイルシステムが、VPC のサブネットに出す NFS の接続先。AZ ごとに 1 つ作り、セキュリティグループはここに付く。 |
| アクセスポイント（EFS） | access point (EFS) | 53 | ファイルシステムへの、アプリケーションごとの入口。そこから入るクライアントに、決まったディレクトリをルートとして見せ、決まった POSIX のユーザーとして扱う。 |
| close-to-open の整合性 | close-to-open consistency | 53 | NFS の整合性の約束。あるクライアントがファイルを閉じたあとに別のクライアントが開けば、書いた内容が見える。開いたままのファイルについては約束しない。 |
| アドバイザリロック | advisory lock | 53 | ロックを確かめる側だけが従うロック。取っていないプロセスの読み書きは止まらない。EFS のロックはすべてこれ。 |
| rename による置き換え | rename into place | 53 | 新しい内容を別の名前のファイルに書き終えてから、rename で本来の名前に付け替える書き方。読む側には古い内容か新しい内容のどちらかだけが見える。 |
| Elastic スループット | Elastic throughput | 53 | EFS のスループットの方式の 1 つ。前もって量を決めず、読み書きしたバイト数に課金される。 |
| Data Catalog（Glue） | Data Catalog (Glue) | 43 | テーブルの定義を置く場所。S3 のどのフォルダーに、どんな列のファイルが、どの形式で入っているかを持つ。ファイルの中身は持たず、検査もしない。 |
| crawler | crawler | 43 | S3 などのデータを読んで形式と列を推測し、テーブルとパーティションを Data Catalog に書く Glue の機能。 |
| job（Glue） | job (Glue) | 43 | Glue が実行するスクリプト。Spark の job は、最小でも 2 DPU のワーカーの上で動き、動いた秒数に課金される。 |
| job bookmark | job bookmark | 43 | job がどの入力まで読んだかを Glue が覚えておく状態。job.commit() で保存される。覚えるのは入力だけで、出力は追跡しない。 |
| DQDL | DQDL | 43 | Data Quality Definition Language。AWS Glue Data Quality のルールを書く言語。 |
| ETL | ETL | 43 | extract、transform、load。データを読み、形を変え、別の場所に書く処理。 |
| AgentCore Runtime | AgentCore Runtime | 50 | Amazon Bedrock AgentCore のうち、エージェントのコードを預かって動かす部分。セッションごとに専用の microVM を用意し、`/invocations` と `/ping` を持つ HTTP サーバーとしてコードを呼ぶ。 |
| ランタイムセッション | runtime session | 50 | AgentCore Runtime が 1 つの microVM に割り当てる単位。呼び出す側が決めた 33 文字以上の ID で区別される。ID がだれのものかを AgentCore は確かめない。 |
| AgentCore Memory | AgentCore Memory | 50 | エージェントの記憶を預かる AgentCore のサービス。短期記憶は actor とセッションごとのイベントの列で、長期記憶はそこから非同期に取り出したレコード。 |
| ワークスペース（Grafana） | workspace (Grafana) | 55 | Amazon Managed Grafana が用意する、論理的に分かれた 1 つの Grafana サーバー。ダッシュボード、データソース、利用者の割り当てを持つ。 |
| データソース（Grafana） | data source (Grafana) | 55 | Grafana がクエリを送る先の設定。CloudWatch のデータソースは、ワークスペースのロールの権限で CloudWatch の API を呼ぶ。 |
| サービスアカウント（Grafana） | service account (Grafana) | 55 | 人ではなくプログラムが Grafana の HTTP API を呼ぶための利用者。期限つきのトークンを発行して使い、料金の上では利用者 1 人として数えられる。 |
| WebRTC | WebRTC | 51 | ブラウザーどうし、またはブラウザーとサーバーのあいだで、音声と映像を低い遅延でやり取りするための標準の仕組み。 |
| ミーティング | meeting | 51 | Chime SDK で、通話 1 つを表す一時的なリソース。API で作り、誰も接続していない時間が 5 分続くか、24 時間を超えると、Chime が終わらせる。 |
| アテンディー | attendee | 51 | ミーティングの参加者 1 人ぶんの席。サーバーが API で作り、作るたびに join token が 1 つ付く。 |
| join token | join token | 51 | アテンディーとしてメディアサービスに接続するための秘密の文字列。持っている人がそのアテンディーになる。アテンディーを消すかミーティングが終わると使えなくなる。 |
| メディアリージョン | media Region | 51 | Chime SDK のミーティングで、音声と映像を中継するリージョン。API を呼ぶ先のコントロールリージョンとは別に選べる。 |
| データストリーム | data stream | 54 | レコードを届いた順に並べて、決めた期間だけ保持する記録。読んでも消えず、読む側がそれぞれ自分の位置を持つ。 |
| shard | shard | 54 | Kinesis の stream を構成する 1 本の列。書き込みと読み取りの上限、順序の保証、料金は、どれも shard ごとに決まる。 |
| partition key（Kinesis） | partition key (Kinesis) | 54 | レコードに付ける文字列。MD5 のハッシュ値で shard が決まるので、同じ partition key のレコードは同じ shard に並ぶ。DynamoDB の partition key とは別のもの。 |
| sequence number | sequence number | 54 | Kinesis が、受け取ったレコードに付ける番号。shard の中で増えていく。数値型に収まらない桁数の 10 進の文字列で、連番ではない。 |
| iterator age | iterator age | 54 | コンシューマーが最後に受け取ったレコードが、stream に届いてからどれだけ経っているか。コンシューマーの遅れを表す。保持期間を超えると、読まれないままレコードが消える。 |
| poison record | poison record | 54 | 何度処理しても失敗するレコード。順序を守って読むコンシューマーでは、後ろに並んだレコードをすべて止める。 |
| enhanced fan-out | enhanced fan-out | 54 | コンシューマーを stream に登録して、shard ごとに専用の読み取り帯域（2 MB/秒）を持たせるしくみ。登録している時間と読んだ量に料金がかかる。 |
| resharding | resharding | 54 | shard を 2 つに分ける（split）、または 2 つを 1 つにまとめる（merge）操作。元の shard は閉じられ、中のレコードは保持期間が切れるまで読める。 |
| ダイジェスト | digest | 52 | イメージのマニフェストの SHA-256。中身から決まるので、同じダイジェストなら同じイメージで、あとから別のものを指すことはない。 |
| タグの immutability | tag immutability | 52 | すでにあるタグを別のイメージに付け替えるプッシュを、リポジトリが拒否する設定。 |
| ライフサイクルポリシー（ECR） | lifecycle policy (ECR) | 52 | リポジトリのイメージを、タグの有無や名前、数、プッシュからの日数で選んで消す規則の集まり。 |
| pull through cache | pull-through cache | 52 | 外のレジストリのイメージを、自分の ECR のレジストリ経由で取得し、写しを手元に残す仕組み。 |
| enhanced scanning | enhanced scanning | 52 | ECR のイメージを Amazon Inspector が検査する設定。OS に加えて言語のパッケージも見て、新しい脆弱性が出るたびに検査し直す。 |
| ハッシュチェーン | hash chain | 58 | 記録の 1 件ごとに、その内容と、1 つ前の記録のハッシュとを合わせて計算したハッシュを持たせた列。途中の 1 件を書き換えると、それより後ろのハッシュがすべて合わなくなる。 |
| ダイジェスト | digest | 58 | ある時点での台帳の末尾の番号とハッシュを書き留めたもの。ハッシュチェーンでは、末尾のハッシュがそれまでの記録すべてを代表する。台帳とは別の、消せない場所に置く。 |
| Object Lock | Object Lock | 58 | S3 のオブジェクトのバージョンを、決めた期間のあいだ削除も上書きもできなくする機能。governance モードは特別な権限で解除でき、compliance モードは root ユーザーにも解除できない。 |
| マルチモーダル | multimodal | 56 | 文章だけでなく、画像、動画、音声のような別の種類の入力も 1 つのリクエストで受け取れること。受け取れる種類はモデルごとに違う。 |
| モデルカード | model card | 56 | Bedrock のユーザーガイドにある、モデルごとのページ。入出力の種類、使える API、モデル ID と inference profile の ID、呼べるリージョン、終了の目安が載っている。 |
| claim（処理の先取り） | claim | 56 | 「この処理はいま自分がやっている」という、期限つきの記録。条件付き書き込みで作るので、同時に来た 2 つのリクエストのうち一方しか作れない。期限が過ぎたものは、ほかのリクエストが引き継げる。 |
| 代替テキスト | alternative text | 56 | 画像を見られない読者のために、画像の内容を文章で書いたもの。HTML では img 要素の alt 属性に入れる。 |
| speech-to-speech | speech-to-speech | 56 | 音声を受け取り、音声で答えるモデル。文字起こし、文章の生成、読み上げを 1 つのモデルが続けて行い、双方向のストリームで会話する。 |
| クラスターボリューム | cluster volume | 60 | Aurora のデータが入る 1 つの仮想ボリューム。3 つの AZ にまたがって複製され、インスタンスの数とは無関係に存在する。 |
| writer | writer | 60 | Aurora のクラスターで書き込みを受け付ける、ただ 1 つのインスタンス。primary instance とも呼ぶ。 |
| reader | reader | 60 | writer と同じクラスターボリュームを読む、読み取り専用のインスタンス。Aurora Replica とも呼ぶ。フェイルオーバーで writer に昇格する候補でもある。 |
| クラスターエンドポイント | cluster endpoint | 60 | いまの writer を指す DNS 名。フェイルオーバーのあと、同じ名前が新しい writer を指す。 |
| auto-pause | auto-pause | 60 | 最小容量を 0 ACU にした Aurora Serverless v2 のインスタンスが、接続のない時間が続くと止まり、次の接続で再開するしくみ。 |
| Data API | Data API | 60 | Aurora に HTTPS で SQL を送る API。接続を持たず、認証は IAM と Secrets Manager のシークレットで行う。 |
| クローン | clone | 60 | 元のクラスターとデータのページを共有して始まる、新しい Aurora のクラスター。どちらかがページを書き換えたときに、そのページだけが複製される。 |
| I/O-Optimized | I/O-Optimized | 60 | Aurora のストレージの料金構成の 1 つ。I/O の回数に課金しない代わりに、容量とストレージの単価が高い。もう 1 つは Standard。 |
| セルフホストランナー | self-hosted runner | 62 | CI のジョブを実行するプログラムを、CI のサービスではなく自分の計算資源で動かしたもの。ワークフローが書いたとおりのコマンドを、置かれた場所の権限で実行する。 |
| just-in-time runner | just-in-time runner | 62 | GitHub の API で登録を先に作り、その設定を渡して起動するランナー。ジョブを多くても 1 件実行すると、GitHub が登録を消す。 |
| runner manager | runner manager | 62 | GitLab Runner の常駐プロセス。GitLab にジョブを問い合わせ、executor を通してジョブを実行する。 |
| SSML | SSML | 57 | Speech Synthesis Markup Language。読み上げる文章に、間や読み方の指示をタグで書き込む XML の形式。 |
| 課金対象の文字 | billed characters | 57 | Polly が料金を数える文字。SSML のタグは含まれない。 |
| レキシコン | lexicon | 57 | 単語ごとの読み方を登録しておく発音辞書。Polly ではリージョンごとに保存し、合成のときに名前で指定する。 |
| Multi-AZ | Multi-AZ | 59 | RDS が別の Availability Zone に待機用の複製を持ち、障害のときにそちらへ切り替える構成。 |
| リードレプリカ | read replica | 59 | プライマリの変更を非同期に受け取る、読み取り専用のデータベースインスタンス。プライマリより古いことがある。 |
| レプリカラグ | replica lag | 59 | プライマリでコミットされた変更が、リードレプリカに反映されるまでの遅れ。 |
| LSN | LSN (log sequence number) | 59 | PostgreSQL の write-ahead log の中の位置。プライマリがどこまで書いたか、レプリカがどこまで再生したかを比べるのに使う。 |
| read-your-writes | read-your-writes | 59 | 書き込んだ本人が、そのあとの読み取りで自分の書き込みを必ず見られる、という保証。 |
| RDS Proxy | RDS Proxy | 59 | アプリと RDS の間に置く接続プール。多数のクライアント接続を、少数のデータベース接続にまとめる。 |
| パラメーターグループ | DB parameter group | 59 | データベースエンジンの設定値をまとめたもの。インスタンスに関連づけて使う。 |
| IAM データベース認証 | IAM database authentication | 59 | パスワードの代わりに、IAM の認証情報で署名した 15 分有効のトークンでデータベースにサインインする方法。 |
| RDS Extended Support | RDS Extended Support | 59 | 標準サポートが終わったメジャーバージョンを、vCPU 時間あたりの追加料金で使い続ける仕組み。 |
| コーディングエージェント | coding agent | 63 | モデルが自分で選んだコマンドを実行し、ファイルを読み書きしながら、頼まれた変更をリポジトリに加えるプログラム。Claude Code はその 1 つ。 |
| 出口の許可リスト | egress allowlist | 63 | 中から外へ出る通信の宛先を、列挙したものだけに限る決まり。載っていない宛先は、理由を問わず届かない。 |
| installation access token | installation access token | 63 | GitHub App が、インストール先のリポジトリを操作するために発行するトークン。作ってから 1 時間で失効し、発行のときにリポジトリと権限を絞れる。 |
| 非対話モード（claude -p） | non-interactive mode (claude -p) | 63 | Claude Code を、端末の画面なしで 1 回だけ実行するやり方。プロンプトを引数で受け取り、結果を標準出力に書いて、終了コードを返す。 |
| FIFO キュー | FIFO queue | 61 | SQS のキューの種類の 1 つ。メッセージグループの中では送った順に渡し、同じ重複排除 ID の送信を 5 分間は 1 件として扱う。 |
| メッセージグループ | message group | 61 | FIFO キューの中で、順序を保つ単位。同じ message group ID のメッセージは 1 件ずつ順に渡され、違うグループどうしは並行して進む。 |
| 重複排除 ID | deduplication ID | 61 | FIFO キューに送るメッセージに付ける名前（MessageDeduplicationId）。受け付けてから 5 分のあいだ、同じ名前の送信はキューに入らない。 |
| ロングポーリング | long polling | 61 | ReceiveMessage が、メッセージが来るまで最長 20 秒待ってから応答する受け取り方。空の応答の数が減り、そのぶんリクエストの料金も減る。 |
| workerd | workerd | 64 | Cloudflare が公開している、Workers と同じコードにもとづく JavaScript と Wasm のランタイム。1 つのプロセスの中に isolate を作り、設定ファイルで定義した worker を動かす。それだけでは堅牢なサンドボックスではないと、README に明記されている。 |
| compatibility date | compatibility date | 64 | Workers と workerd で、worker がどの日付までのランタイムの変更を受け入れるかを示す設定。ランタイムを新しくしても、古い日付を指定した worker の動きは変わらない。 |
| binding | binding | 64 | Workers と workerd で、worker が外のリソースや設定値に触れるための入口。設定に書いた binding だけが、worker の `env` に現れる。 |
| Firecracker | Firecracker | 67 | KVM の上で microVM を動かす、オープンソースの仮想マシンモニター。AWS が Lambda と Fargate のために作り、Apache 2.0 で公開している。プロセス 1 つが microVM 1 つを受け持つ。 |
| microVM | microVM | 67 | デバイスを最小限に絞った小さな仮想マシン。自分のカーネルを持つので、分離の境界はハードウェア仮想化になる。 |
| 仮想マシンモニター（VMM） | virtual machine monitor (VMM) | 67 | 仮想マシンにデバイスを見せ、ゲストが外に出ようとする操作を処理するプログラム。Firecracker や QEMU がこれにあたる。 |
| KVM | KVM | 67 | Linux カーネルの仮想化機能。CPU の仮想化支援機能を使い、/dev/kvm を通じて VMM に仮想マシンを作らせる。 |
| jailer | jailer | 67 | Firecracker に付属するプログラム。chroot、cgroup、名前空間を用意し、権限を落としてから Firecracker を起動する。 |
| nested virtualization | nested virtualization | 67 | 仮想マシンの中でさらに仮想マシンを動かすこと。EC2 では一部の Intel のインスタンスタイプで、CPU オプションとして有効にできる。 |
| Nitro System | Nitro System | 68 | いまの EC2 のインスタンスが載っている土台。ネットワークとストレージの入出力を専用のカード（Nitro Card）に移し、ホストの CPU には CPU とメモリを分けるだけのハイパーバイザーを残した構成。Nuxt のサーバーエンジンの Nitro とは別物。 |
| Nitro Hypervisor | Nitro Hypervisor | 68 | Nitro System のハイパーバイザー。CPU とメモリをインスタンスに割り当て、Nitro Card のデバイスを渡すだけで、ネットワークスタックもシェルも持たない、と AWS は説明している。 |
| Graviton | Graviton | 68 | AWS が設計した Arm（arm64）のプロセッサー。インスタンスタイプの名前では g の文字で表される。 |
| エンクレーブ | enclave | 68 | インスタンスの vCPU とメモリの一部を切り出して作る、隔離された仮想マシン。ネットワークも永続的なストレージも対話的な入口も持たず、親インスタンスとは vsock だけでつながる。 |
| 親インスタンス | parent instance | 68 | エンクレーブに vCPU とメモリを渡し、エンクレーブを起動して止める EC2 のインスタンス。 |
| エンクレーブイメージファイル | enclave image file | 68 | エンクレーブで起動する OS とアプリを 1 つにまとめたファイル（.eif）。Docker のイメージから nitro-cli build-enclave で作る。 |
| PCR | PCR | 68 | platform configuration register。エンクレーブのイメージや親インスタンスの素性から計算した SHA-384 のハッシュ。PCR0 はイメージファイル全体の計測値。 |
| アテステーションドキュメント | attestation document | 68 | Nitro Hypervisor が署名する文書。エンクレーブの PCR と、エンクレーブが渡した公開鍵が入っている。エンクレーブはこれを見せて、自分がどのイメージから起動したかを外に証明する。 |
| vsock | vsock | 68 | 仮想マシンとそのホストの間のソケット。アドレスは CID とポートの組で、エンクレーブと親インスタンスをつなぐ唯一の経路。 |
| Raft | Raft | 66 | 複数の写しのあいだで、書き込みの順序を 1 つに決めるための合意の手順。1 つがリーダーになって書き込みを受け、過半数の写しに記録されたものだけを確定とする。 |
| 過半数（quorum） | Quorum (majority) | 66 | 写しの半分より多い数。3 つなら 2 つ。過半数が生きているあいだだけ、リーダーを選べて、書き込みを確定できる。 |
| tablet | Tablet | 66 | YugabyteDB がテーブルを分けた 1 かけら。行は主キーでどれか 1 つの tablet に入り、tablet ごとに写しの組（Raft のグループ）がある。 |
| replication factor | Replication factor | 66 | 1 つの tablet の写しの数。3 なら、ノードを 1 つ失っても過半数が残る。 |
| 時刻のずれ（clock skew） | Clock skew | 66 | ノードどうしの時計の差。YugabyteDB は時刻をトランザクションの順序づけに使うので、差が上限（既定で 500 ミリ秒）を超えたノードは自分で止まる。 |
| Web Function | Web Function | 69 | Lambda の形のひとつ。コードはポートで待ち受ける HTTP サーバーで、1 つの実行環境が複数のリクエストを同時に処理する。 |
| Event Function | Event Function | 69 | これまで単に Lambda 関数と呼んできたもの。イベントを 1 つ受け取るハンドラーで、2026-10-12 に名前だけが変わった。 |
| リビジョン（revision） | revision | 69 | Web Function のコードと設定を、ある時点で固めたもの。作った後は変えられず、変えるときは新しいリビジョンを作る。 |
| エンドポイント（Web Function） | endpoint (Web Function) | 69 | Web Function の HTTPS の入口。ドメイン名、認証の方式、レート制限、環境数の上限を持ち、リクエストを 1 つか 2 つのリビジョンに振り分ける。 |
| アクティブな CPU 時間 | active CPU time | 69 | コードが実際に CPU を使っていた時間。データベースや外部の API の応答を待っている時間は入らない。 |
