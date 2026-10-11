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
| channel | channel | 18 | IVS の low-latency streaming で、配信を 1 本受けて視聴者へ届ける単位。ingest endpoint と playback URL を持つ。 |
| stream key | stream key | 18 | 配信ソフトが channel へ送るときに示す秘密の文字列。持っている人は誰でもその channel に配信できる。 |
| ingest | ingest | 18 | 配信ソフトから送られてくる映像を、サービスが受け取ること。 |
| rendition | rendition | 18 | 同じ映像の、解像度と bitrate が違う版の 1 つ。player は回線に合わせて切り替える。 |
| timed metadata | timed metadata | 18 | 映像の特定の位置に埋め込む小さなデータ。視聴者ごとの遅延にかかわらず、映像の同じ場面で届く。 |
| VPC | VPC | 11 | Virtual Private Cloud。1 つのリージョンの中に作る、自分専用の IP ネットワーク。アドレスの範囲を自分で決め、subnet に分けて使う。 |
| CIDR | CIDR | 11 | `10.20.0.0/16` のように、先頭のアドレスと「先頭から何ビットが共通か」でアドレスの範囲を書く記法。/16 は 65,536 個、/20 は 4,096 個。 |
| subnet | subnet | 11 | VPC のアドレス範囲の一部で、1 つの Availability Zone の中に置かれる。public か private かは、関連付けた route table で決まる。 |
| Availability Zone（AZ） | Availability Zone (AZ) | 11 | リージョンの中にある、電源とネットワークが独立したデータセンター群。同じリージョンの AZ どうしは同時に壊れにくいように作られているが、リージョン全体の障害からは守ってくれない。 |
| route table | route table | 11 | 「この宛先はここへ送る」という規則の表。subnet に関連付ける。インターネットへの経路があるかどうかは、この表だけで決まる。 |
| internet gateway | internet gateway | 11 | VPC とインターネットをつなぐ出入口。VPC に 1 つ取り付ける。これ自体に料金はかからない。 |
| NAT Gateway | NAT gateway | 11 | private subnet の中から外への接続だけを通す中継点。public subnet に置き、Elastic IP アドレスを 1 つ持つ。存在している時間と、通したデータ量の両方に料金がかかる。 |
| security group | security group | 11 | instance などのリソースに付ける、許可だけの通信規則。stateful で、許可した通信の返事は逆向きの規則がなくても通る。 |
| network ACL | network ACL | 11 | subnet の境界に付ける通信規則。許可と拒否を番号順に評価する。stateless で、返事の通信も別に許可が要る。 |
| gateway endpoint | gateway endpoint | 11 | S3 と DynamoDB へ、インターネットを通らずに届く経路。route table に経路として入る。追加料金はない。 |
| interface endpoint | interface endpoint | 11 | AWS のサービスへの入口を、subnet の中に private IP アドレスつきの network interface として置くもの（AWS PrivateLink）。サービスごと、AZ ごとに時間課金される。 |
| 基盤モデル | foundation model | 17 | Bedrock が API として提供する学習済みのモデル。モデル ID で指定する。 |
| token | token | 17 | モデルが文章を読み書きする単位で、課金の単位でもある。文字数とは一致せず、数え方はモデルごとに違う。 |
| inference profile | inference profile | 17 | モデルと、リクエストを送ってよいリージョンの組に付いた ID。モデル ID の代わりに指定する。 |
| cross-Region inference | cross-Region inference | 17 | inference profile を通して、呼び出したリージョンとは別のリージョンで推論が処理され得る仕組み。 |
| response streaming | response streaming | 17 | Lambda が応答を最後まで溜めずに、できた分から呼び出し元へ送る方式。 |
| function URL | function URL | 17 | Lambda 関数に直接付く HTTPS の endpoint。API Gateway を挟まない。 |
| server-sent events（SSE） | server-sent events (SSE) | 17 | 1 つの HTTP 応答の中で、サーバーがイベントを順に送り続ける形式。content type は text/event-stream。 |
| SigV4 署名 | SigV4 signature | 17 | AWS の API が呼び出し元を確かめるためのリクエスト署名。認証情報から計算して header に付ける。 |
| identity（SES） | identity (SES) | 15 | SES に「自分のものだ」と確認してもらった送信元。ドメインか、メールアドレス 1 つ。リージョンごとに確認する。 |
| sandbox（SES） | sandbox (SES) | 15 | 新しいアカウントの SES が置かれる制限つきの状態。確認済みの宛先にしか送れない。production access を申請して出る。 |
| bounce | bounce | 15 | メールが届かずに戻ってくること。宛先が存在しないなどの恒久的なもの（hard）と、一時的なもの（soft）がある。 |
| complaint | complaint | 15 | 受信者がメールを「迷惑メール」と報告すること。 |
| suppression list | suppression list | 15 | もう送らないと決めた宛先の一覧。bounce や complaint を出した宛先を入れる。 |
| configuration set | configuration set | 15 | SES で、送信時に指定する設定のまとまり。イベントの配送先や suppression の設定を持つ。 |
| SPF | SPF | 15 | 「このドメインの名前で送ってよいサーバー」を DNS の TXT レコードで公開する仕組み。見るのは封筒の差出人（MAIL FROM）のドメイン。 |
| DKIM | DKIM | 15 | メールに電子署名を付け、検証用の公開鍵を DNS で公開する仕組み。 |
| DMARC | DMARC | 15 | 受信者に見える From のドメインが、SPF か DKIM のどちらかで確かめられていることを求め、失敗したメールの扱いを DNS で指示する仕組み。 |
| CloudFront Functions | CloudFront Functions | 10 | CloudFront の edge location で、リクエストやレスポンスのたびに動く小さな JavaScript。ネットワークにもファイルにも触れず、URL やヘッダーの書き換えに使う。 |
| viewer request | viewer request | 10 | CloudFront が読者からリクエストを受け取った直後、cache を調べる前のタイミング。 |
| KeyValueStore | KeyValueStore | 10 | CloudFront Functions から読める、キーと値の保存場所。関数からは読むだけで、書き換えは外から API で行う。 |
| Lambda@Edge | Lambda@Edge | 10 | us-east-1 に作った Lambda 関数の version を CloudFront が各地に複製し、リクエストの途中で呼ぶ仕組み。 |
| ETag による条件付き更新 | ETag precondition | 10 | 読んだときの版（ETag）を書き込みに添え、その間に他の誰かが書き換えていたら拒否してもらう方法。 |
| migration | migration | 13 | schema の変更を順番つきのファイルにして、どこまで適用したかを DB 自身に記録するやり方。 |
| transaction | transaction | 13 | 複数の SQL を「全部反映する」か「何も反映しない」のどちらかにまとめる単位。 |
| snapshot isolation | snapshot isolation | 13 | transaction が、開始した時点のデータを最後まで読み続ける分離の方式。PostgreSQL の REPEATABLE READ がこれにあたる。 |
| 楽観的同時実行制御（OCC） | optimistic concurrency control (OCC) | 13 | ロックで待たせず、commit のときに競合を調べて、負けた transaction を失敗させる方式。 |
| serialization failure | serialization failure | 13 | ほかの transaction と競合したので commit できなかった、という DB からの応答。SQLSTATE は 40001。何も反映されていないので、transaction を最初からやり直す。 |
| write skew | write skew | 13 | 2 つの transaction が同じデータを読んで判断し、別々の行に書いた結果、どちらか一方だけなら守れた条件が破れること。 |
| database role | database role | 13 | DB の中の利用者。どの table に何ができるかは、この role への GRANT で決まる。IAM の role とは別のもの。 |
| 認証 token（Aurora DSQL） | authentication token (Aurora DSQL) | 13 | 接続するときだけパスワードの代わりに渡す、IAM の認証情報で署名した期限つきの文字列。 |
| DPU | DPU | 13 | Distributed Processing Unit。Aurora DSQL が、SQL の実行にかかった計算、読み取り、書き込みをまとめて測る課金の単位。 |
| ACU | ACU | 13 | Aurora Capacity Unit。Aurora Serverless v2 の容量の単位で、1 ACU はおよそ 2 GiB のメモリと、それに見合う CPU とネットワーク。 |
| presigned URL | presigned URL | 07 | 署名を URL に含めた、期限つきの URL。持っている人は、署名した人の権限の範囲で、決められた 1 つの操作を実行できる。 |
| POST policy | POST policy | 07 | ブラウザからの form による S3 へのアップロードが満たすべき条件（key、種類、大きさの範囲、期限）を書いた、署名つきの文書。 |
| object key | object key | 07 | bucket の中で object を一意に指す名前。`/` を含められるが、フォルダーがあるわけではない。 |
| bearer token | bearer token | 07 | 持っているだけで使える認証情報。誰が使っているかは確かめられない。 |
| lifecycle rule | lifecycle rule | 07 | 条件に合う object を、作成から一定の日数の後に S3 自身が削除（または移動）する、bucket の設定。 |
| Block Public Access | Block Public Access | 07 | ACL や bucket policy で bucket や object を公開する設定を、拒否または無効にする S3 の 4 つの設定。 |
| 孤立した object | orphaned object | 07 | bucket にはあるが、それを指す記録がどこにも無い object。誰にも見えないまま、保存料金だけがかかる。 |
| multipart upload | multipart upload | 07 | 大きな object を複数の part に分けて送る S3 の仕組み。完了も中止もされなかった part は、保存されたまま残る。 |
| server-side rendering (SSR) | server-side rendering (SSR) | 09 | リクエストごとにサーバーで HTML を組み立てて返すこと。ブラウザは届いた HTML をまず表示し、そのあと JavaScript が引き継ぐ。 |
| 共有 cache | shared cache | 09 | 1 つの応答を保存して、複数の利用者に返す cache。CDN がその例。ブラウザの中の cache は 1 人のものなので private cache と呼ぶ。 |
| cache key | cache key | 09 | CloudFront が「同じリクエスト」とみなす基準。path に加えて、cache policy で選んだ query string、header、cookie からできる。 |
| cache policy | cache policy | 09 | cache key に入れる値と、TTL の下限・既定・上限をまとめた CloudFront の設定。 |
| backend for frontend (BFF) | backend for frontend (BFF) | 09 | ある画面のためだけに置くサーバー。ブラウザの代わりに token を持ち、裏の API を呼ぶ。 |
| 構造化ログ | structured log | 19 | 1 行が 1 つの JSON になっているログ。項目の名前で絞り込みや集計ができる。 |
| メトリクス | metric | 19 | 時刻ごとの数値の列。リクエスト数、エラー数、応答時間など。CloudWatch では名前、namespace、dimension の組が 1 つのメトリクスになる。 |
| アラーム | alarm | 19 | メトリクスが条件を満たし続けたときに状態を変え、通知などの操作を起こす CloudWatch の仕組み。状態は OK、ALARM、INSUFFICIENT_DATA。 |
| metric filter | metric filter | 19 | log group に届くログの行を条件で数え、メトリクスにする CloudWatch Logs の設定。作成より前のログには効かない。 |
| embedded metric format（EMF） | embedded metric format (EMF) | 19 | 決まった形の JSON をログに書くと、CloudWatch がそこからメトリクスを取り出す仕組み。 |
| trace | trace | 19 | 1 つのリクエストが通った処理の記録。trace ID を共有する span の集まり。 |
| span | span | 19 | trace の中の 1 区間。名前、開始と終了の時刻、親の span、属性を持つ。X-Ray では segment や subsegment になる。 |
| OpenTelemetry | OpenTelemetry | 19 | trace、メトリクス、ログの計装と送信のための、ベンダーに依らない仕様とライブラリ。 |
| sampling | sampling | 19 | 全部のリクエストではなく、一部だけを trace として記録すること。 |
| trace context（traceparent） | trace context (traceparent) | 19 | trace ID、呼び出し元の span ID、sampling の決定を次の処理へ渡すための W3C の仕様。HTTP では traceparent ヘッダー。 |
| RUM（real user monitoring） | RUM (real user monitoring) | 19 | 実際の利用者のブラウザで、ページの表示時間やエラーを計測して集めること。 |
| canary（Synthetics） | canary (Synthetics) | 19 | 決まった間隔で外から API やページを呼び、応答を確かめるスクリプト。利用者がいない時間にも動く。 |
| TTL | TTL | 14 | time to live。データに付ける有効期限。期限が来たデータをいつ実際に消すかは store によって違い、DynamoDB では数日後になることがある。 |
| rate limit | rate limit | 14 | ある利用者が一定時間に呼べる回数の上限。数える場所が全員に共有されていて、数えて比べる操作が 1 ステップでないと守れない。 |
| 固定窓 | fixed window | 14 | 時間を決まった長さの区間に切り、区間ごとに回数を数える rate limit の方式。区間の境目をまたぐと、短い時間に上限の 2 倍まで通る。 |
| 滑る窓 | sliding window | 14 | 直前の区間の回数を、いまの時刻から見てまだ窓に入っている割合だけ数に入れる rate limit の方式。境目での 2 倍を防ぐ。 |
| 原子的な加算 | atomic counter | 14 | 読んでから書くのではなく、「1 足す」を store の中の 1 ステップとして行う更新。同時に来た加算が失われない。 |
| Valkey | Valkey | 14 | メモリ上の key-value サーバー。Redis がライセンスを変える直前のオープンソース版から分かれたプロジェクトで、ElastiCache のエンジンの 1 つ。 |
| ECPU | ECPU | 14 | ElastiCache Processing Unit。ElastiCache Serverless のリクエストの課金単位。単純な読み書きは、転送した 1 KB あたり 1 ECPU。 |
| read-through cache | read-through cache | 14 | まず cache を読み、無ければ元データを読んで cache に入れる読み方。正しいのは常に元データで、cache はその写し。 |
| stale read | stale read | 14 | 元データが変わったあとに、古い写しを読むこと。cache を使うかぎり起きるので、どれだけ古くてよいかを先に決める。 |
| cache stampede | cache stampede | 14 | cache が切れた瞬間に、多数のリクエストが同時に miss して、全員が元データへ取りに行くこと。 |
| single flight | single flight | 14 | 同じ key の読み込みが進行中なら、新しく始めずにその結果を待つこと。効くのは 1 つのプロセスの中だけ。 |
| CloudFormation | CloudFormation | 20 | template を受け取ってリソースを作り、何を作ったかを stack として自分で記録する AWS のサービス。更新に失敗すると、既定では前の状態に戻す。 |
| CDK の bootstrap | CDK bootstrap | 20 | AWS CDK CLI でデプロイする前に、アカウントとリージョンごとに一度行う準備。CDKToolkit という stack が、asset 用の bucket、ECR repository、5 つの IAM role を作る。cdkd の bootstrap とは別物。 |
| change set | change set | 20 | stack の更新を、実行する前に「何が追加・変更・置き換え・削除されるか」の一覧にしたもの。実行するまで何も変わらない。成功を保証するものではない。 |
| OIDC（OpenID Connect） | OIDC (OpenID Connect) | 20 | あるサービスが発行した署名つきの token で「自分が誰か」を別のサービスに示す標準。この本では、GitHub Actions の job が AWS に入るために使う。 |
| trust policy | trust policy | 20 | IAM role に付く「誰がこの role を使えるか」の定義。role に何ができるかを決める権限の policy とは別。 |
| sub（subject）claim | sub (subject) claim | 20 | OIDC の token に入っている「この token は何のために発行されたか」を表す文字列。GitHub Actions では repository と、branch、environment、pull request のいずれかが入る。 |
| Lambda の version | Lambda version | 20 | 関数のコードと設定の、番号付きの写し。発行したあとは変えられない。発行していない最新の状態は $LATEST と呼ばれる。 |
| Lambda の alias | Lambda alias | 20 | version を指す名前つきのポインタ。呼び出す側は alias を呼び、指す先を変えることで版を切り替える。2 つの version に重みを付けて振り分けることもできる。 |
| rollback | rollback | 20 | 変更を、変更の前の状態に戻すこと。CloudFormation が戻すのは template にあるリソースの設定で、その間に書かれたデータは戻らない。 |
| termination protection | termination protection | 20 | stack の削除を拒否する設定。解除するまで DeleteStack が失敗する。stack の更新でリソースが消えることは防がない。 |
| preview 環境 | preview environment | 20 | pull request ごとに作る、一時的な環境。この本では PR ごとに 1 つの stack。pull request を閉じたら消す前提で作る。 |
| nested stack | nested stack | 20 | 別の stack のリソース（AWS::CloudFormation::Stack）として作られる stack。親の stack で drift を検出しても、中は調べられない。 |
