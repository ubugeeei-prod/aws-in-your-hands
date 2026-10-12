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
