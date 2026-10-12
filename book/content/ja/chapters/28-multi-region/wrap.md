---
title: "28 Multi-Region: 費用、注意点、片付け"
---

# 28 Multi-Region: 費用、注意点、片付け

章の最後のページです。リージョンを選ばないプラットフォームとの違い、料金、つまずきやすいところ、本番で足すもの、片付けの順に書きます。

## リージョンを選ばないプラットフォームから来た人へ

<!-- section: 28.platforms -->

Cloudflare Workers を使ってきた人は、この章の前提そのものに違和感があったはずです。Workers のコードは、リクエストを受けた拠点で動きます。どの拠点で動かすかを開発者は選びませんし、1 つの拠点が使えなくなったときの行き先を、自分で設計することもありません。この章が Route 53 でしていた仕事は、プラットフォームの中にあります。以下は、2026-10-13 に各社のドキュメントを読んで確かめた範囲の話です。

ただし、場所がないのはコードだけで、データには置き場所があります。

- **D1。** データベースには、1 つの場所にあるプライマリがあります。既定では、作成のリクエストを出した場所の近くに置かれます。read replication（ドキュメントでは Beta）を有効にすると、各地に読み取り専用のレプリカができますが、複製は非同期で、書き込みはすべてプライマリに送られます
- **Durable Objects。** オブジェクトは、最初のリクエストの近くに作られ、その後は場所を変えないとドキュメントにあります
- **KV。** データは少数の中央の拠点に書かれ、読んだ拠点にキャッシュされます。変更がほかの拠点で見えるまでに、60 秒かそれ以上かかることがあります
- **R2。** バケットの場所は、作成時に自動で、またはヒントで決まります。オブジェクトは、1 つの地域の中の複数のデータセンターに置かれます

D1 の形は、この章の言葉で言えば「書き込みは 1 か所、読み取りは各地」です。書き込みが 1 か所に集まるので、05章のような version の検査は、利用者がどこにいても働きます。この章のテストで見た、2 つの `200` と 1 つの編集は起きません。その代わり、書き込みの速さと可用性は、プライマリのある場所で決まります。プライマリのある場所が使えなくなったときに D1 がどう動くかは、読んだページには書かれておらず、確かめていません。R2 にリージョンをまたぐ複製の機能があるかどうかも、調べていません。

Vercel では、Functions が動くリージョンを設定で選びます。新しいプロジェクトの既定は `iad1`（ワシントン D.C.）です。複数のリージョンに置けるのは Pro（5 つまで）と Enterprise で、障害のときの切り替え先（`functionFailoverRegions`）を指定できるのは Enterprise です。この章が Route 53 とヘルスチェックで組み立てたものが、プランに含まれる設定 1 つになっています。Vercel のドキュメントは、関数を、データベースなどのデータの置き場所の近くで動かすよう勧めています。データの複製と衝突の話は、そのデータベースの側にそのまま残ります。

どちらのプラットフォームでも、コードの置き場所について考えることは、AWS よりずっと少なくて済みます。利用者の近くで答えたいだけ、あるいは 1 か所が止まっても別の場所が答えてほしいだけなら、そこから動く理由はありません。

AWS で 2 つのリージョンを自分で持つと、できるようになるのは、選ぶことです。2 つの写しをどの国のどこに置くか。書き込みを、速さを取って非同期に複製するか、遅くなっても失わないようにするか。何をもって異常とみなし、いつ切り替えるか。その代わりに、このページまでに出てきたものをすべて、自分で持つことになります。2 つのスタック、複製の設定、ヘルスチェック、目標の数字、そして、片方にしかないリソースの一覧です。

## 料金

<!-- section: 28.cost -->

金額は USD、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

既定の 2 つのスタックには、時間で課金されるリソースがありません。テーブルもバケットも空で、リクエストが 1 つもなければ、下の単価から計算した金額は 0.00 です。小さな量に最小の課金があるかどうかは、確かめていません。

金額の見当がつく大きさとして、テーブルが 1 GB、画像が 10 GB、書き込みが月 10 万回の場合を計算します。下の表は、大阪を足したことで上乗せされる料金で、東京の側にもともとかかっていたものは入れていません。

| 対象 | 月額 |
| --- | --- |
| 大阪のレプリカへの書き込み（10 万 replicated write request unit） | 0.07 |
| 大阪のレプリカの保存（1 GB） | 0.00 |
| 大阪のレプリカの PITR（1 GB） | 0.23 |
| 大阪のバケットの保存（10 GB） | 0.25 |
| 複製の PUT（1 万回） | 0.05 |
| 東京から大阪へのデータ転送（1 GB） | 0.09 |
| 小計 | **0.69** |

グローバルテーブルでは、書き込みの単位が replicated write request unit に変わります。1 回の書き込み（1 KB まで）が、レプリカごとに 1 単位かかります。単価は、東京でも大阪でも 100 万単位あたり USD 0.715 で、ふつうの write request unit と同じです。つまり、東京に書いた 1 回が、東京で 1 単位、大阪で 1 単位になり、書き込みの料金は 2 倍になります。リージョンのあいだの複製に、DynamoDB はデータ転送の料金をかけないと、ドキュメントにあります。

保存が 0.00 なのは、DynamoDB の保存料の最初の 25 GB が、リージョンごとに USD 0 の段だからです。PITR は、CDK が両方のレプリカで有効にするので、大阪のぶんが増えます。

S3 の複製では、大阪での保存、大阪への PUT、東京から大阪へのデータ転送に料金がかかります。データ転送は 1 GB あたり USD 0.09 で、この表の中ではいちばん量に比例して伸びる項目です。複製の PUT は、大阪の通常の PUT と同じ単価として計算しました。

次の表は、指定したときだけ増える料金です。

| 構成 | 月額 |
| --- | --- |
| `-c domain=...`（HTTPS のヘルスチェック 2 つ、ホストゾーン 1 つ） | 2.50 |
| `-c rtc=on`（1 GB を複製、メトリクス 4 つ） | 1.22 |

ヘルスチェックは、AWS のエンドポイント向けの最初の 50 個が基本料金 USD 0 の段に入ります。HTTPS は追加機能の扱いで、1 つにつき月 USD 1.00 です。ホストゾーンは月 USD 0.50 で、すでに持っているゾーンを使うなら増えません。この 2.50 は、リクエストが 1 つもなくてもかかります。エイリアスレコードへのクエリは無料です。ACM の証明書と API Gateway のカスタムドメインに料金がかかるかどうかは、調べていません。

RTC は、複製したデータ 1 GB あたり USD 0.015 と、複製のメトリクスの料金がかかります。メトリクスは CloudWatch のカスタムメトリクスと同じ単価で課金されるとドキュメントにあり、1.22 のうち 1.20 は、4 つのメトリクスが 1 か月ずっと課金されると仮定した数字です。ルール 1 つあたりの実際の本数と、複製するものがない月にも課金されるかどうかは、確かめていません。カスタムメトリクスの無料枠（10 個）をほかで使っていなければ、この行は 0.02 になります。

replicated write request unit、リージョン間のデータ転送、RTC に無料枠があるかどうかは、調べていません。どの表でも引いていません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `mr:infra:deploy` が、バケットの複製の設定で失敗する | 宛先の大阪のバケットがまだありません。`mr:standby:infra:deploy` を先に実行します |
| 大阪の `/health/region` が `503` を返す | テーブルは東京のスタックが作ります。東京のデプロイが終わり、`mr:status` で大阪のレプリカが `ACTIVE` になるまで待ちます |
| `mr:conflict --apply` で、片方が `409` になる | 失敗ではありません。2 つの `PUT` の間隔が、複製の遅れより長かったということです |
| 東京で書いたノートが、大阪で読めない | 複製の遅れです。続くなら、CloudWatch の `ReplicationLatency` を見ます |
| 東京で消した画像が、大阪に残っている | 既定では、削除マーカーは複製されません。仕様どおりです |
| デプロイより前に置いた画像が、大阪にない | 複製されるのは、ルールを作ったあとのオブジェクトだけです |
| 逆向きの複製が、次のデプロイで消えた | `-c back=on` を付け忘れています。コンテキストは毎回付けるか、`cdk.json` に書きます |
| synth が「domain, zoneId and zoneName go together」と言う | 3 つは一緒に渡します |
| synth が「Invalid type」で止まる | コンテキストの値の書き間違いです。使える値は `infra/bin/app.ts` にあります |
| 東京の API がエラーを返しているのに、切り替わらない | ヘルスチェックが見ているのは `/health/region` だけです。この経路が `200` を返すかぎり、行き先は変わりません |
| `destroy` が、バケットを消せない | バージョンが残っています。先に `mr:empty --apply` を実行します |
| デプロイが、バケットやテーブルの名前がすでにあると言う | この章は名前を固定しています。前回の片付けで残ったものがないかを確かめます |

## 本番にするなら

- **片方にしかないものを、1 つずつ決める。** [概要のページ](/ja/chapters/28-multi-region.md)の一覧にあるサインイン、シークレット、デプロイの仕組み、キュー、アラームについて、複製するのか、大阪にも作るのか、止まることを受け入れるのかを決めます。テーブルとバケットは、いちばん簡単な部分です
- **複製の遅れにアラームを付ける。** RPO は、遅れを見張っていて初めて守れます。テーブルは `ReplicationLatency`、バケットは複製のメトリクスです。アラームは、見張る相手とは別のリージョンにも届くようにします
- **切り替えを、ふだんから実行する。** 一度も切り替えたことのない構成が、障害の日に初めて正しく動くことは期待できません。DynamoDB のドキュメントは、書き込みのリージョンを毎日移している利用者の例を挙げ、切り替えのコードが日々試される利点を書いています
- **切り替えを、コントロールプレーンに頼らない。** レコードを手で書き換える手順は、障害の最中に使えるとは限りません。Route 53 のドキュメントは、ヘルスチェックか、Amazon Application Recovery Controller の routing control を勧めています。後者は調べていません
- **書き込みの形を見直す。** 利用者ごとに書き込み先のリージョンを決めておく方法（ドキュメントの言う write to your Region）なら、active-active の速さと、アイテムごとの単一の書き手を両立できます。ただし、利用者をリージョンに割り当てる仕組みを自分で持つことになります
- **失ってはいけないデータには、MRSC を検討する。** RPO は 0 になりますが、3 つのリージョン、遅くなる書き込み、使えなくなる機能と引き換えです。固定した版の cdkd では作れないと見ているので、AWS CDK CLI を使うことになります
- **テーブルとバケットを守る設定にする。** `RemovalPolicy.RETAIN` と削除保護です。削除保護は、レプリカごとに有効にします
- **切り替えのあとの検査を、手順に入れる。** 22章の `check` を大阪で実行し、画像のない添付の記録を見つけます
- **バックアップをやめない。** 複製は、間違った書き込みも 1 秒で運びます。この章のスタックが両方のレプリカで PITR を有効にしているのは、そのためです

## 片付け

<!-- section: 28.cleanup -->

```bash
vp run mr:empty
vp run mr:empty --apply
vp run mr:infra:destroy
vp run mr:standby:infra:destroy
```

まず、2 つのバケットを空にします。バージョニングが有効なバケットは、すべてのバージョンと削除マーカーを消すまで空になりません。`mr:empty` は数を表示するだけで、`--apply` を付けると消します。消したものは戻せません。

次に、東京のスタックを消します。グローバルテーブルは東京のスタックのリソースなので、大阪のレプリカも、このときに一緒に消えるはずです。最後に、大阪のスタックを消します。デプロイとは逆の順序です。

コンテキストを付けてデプロイしたスタックは、同じコンテキストを付けて消します。`-c domain=...` を付けていたなら、`destroy` にも付けます。ホストゾーンは、この章のスタックのものではないので残ります。検証用のレコードがゾーンに残るかどうかは、確かめていません。

22章で読んだとおり、PITR が有効だったテーブルを消すと、DynamoDB がシステムバックアップを 35 日残します。グローバルテーブルのレプリカごとに残るのかどうかは、確かめていません。

2 つのリージョンにまたがるスタックの削除は、一度も実行していません。cdkd がグローバルテーブルのレプリカをどの順序で消すか、途中で失敗したときに何が残るかは、わかりません。片付けのあとに、両方のリージョンのコンソールで、テーブルとバケットが残っていないことを確かめてください。

## 分散システムとして見ると

状態の持ち主が、2 つになりました。東京のレプリカと大阪のレプリカは、どちらも自分が正しいと考えて書き込みを受け付けます。05章の不変条件は「更新は、読んだ version がいまも最新のときだけ通る」でした。この「いまも最新」を確かめられるのは、1 つのレプリカの中だけです。

不変条件をリージョンの外まで広げる方法は、この章で 2 つ見ました。書き手を 1 つにするか、書くたびに合意を取るかです。前者はルーティングで、後者は MRSC で実現します。どちらも、リージョンが切り離されたときに、どこかが書けなくなることと引き換えです。MREC のまま両方が書き続ける構成は、切り離されても止まりませんが、あとで食い違いを last writer wins で片付けます。**切り離されたときに、止まるか、食い違うか。** 選べるのはどちらかで、この章は、短い時間だけ食い違うほうを選びました。

閉じていないところも書いておきます。切り替えの前後の窓では、同じノートへの 2 つの編集の片方が、記録なしに消えます。窓の長さは見積もっただけで、測っていません。05章のカウンターは、2 つのリージョンで同時に進むと取りこぼします。テーブルとバケットは別の速さで届くので、切り替えた直後の大阪には、画像のない添付の記録がありえます。どれも、テストで再現できる形にはしましたが、直してはいません。

::: details この章の検証メモ

**手元で確かめたこと。** 2 つのリージョンをメモリの上に置いたモデルで、MREC の複製の遅れ、2 つのリージョンからの同時の編集で両方に成功が返って片方が消えること、書き込みを東京に寄せると 05章の検査が働くこと、強い整合性の読み取りがほかのリージョンの更新を見ないこと、カウンターの取りこぼし、東京を切り離したあとの上書きと、遅れて届いて残る書き込み、両側が書き続けたあとの合流。MRSC のモードでの `409`、孤立したリージョンの拒否と結果整合性の読み取り、ウィットネスと一緒に書き続けること、戻ったあとの追いつき、3 つのうち 2 つに届かないときの停止、API が `500` を返すこと。S3 の複製の規則（バージョン ID を保った複製、ルールより前のオブジェクト、削除マーカーの既定と設定、バージョン指定の削除、止まっているあいだの保留、双方向で回り続けないこと、テーブルとの速さの差）。ヘルスチェックのチェッカーの判定と 18% の集計、フェイルオーバーとレイテンシーの応答、すべて異常なときの応答、RTO の内訳と RPO の判定、古い DNS の答えを持つクライアントによる上書き、読み取り専用の待機がそれを断ること。リージョンごとの API の包み（ヘッダー、ヘルスチェックの成功・失敗・時間切れ、訓練用の失敗、書き込みの拒否、環境変数）。05章のリポジトリのコントラクトテストを、2 つのモードのレプリカに対して。スタックのアサーション（種類の一覧、テーブルの定義が東京にだけあること、整合性モードを指定していないこと、両方のレプリカの PITR、削除ポリシー、バケットの公開設定、複製のルールと RTC、逆向きの複製、ロールの名前、ワイルドカードのない権限、関数が自分のリージョンのレプリカだけに届くこと、環境変数、ドメインを付けたときの 5 種類と、ヘルスチェック、レコード、証明書）。型検査、synth（既定と、すべてのコンテキストを付けた場合、書き間違えた値で止まること）、`mr:demo` の実行。加えて、コードを 7 か所わざと壊して、テストが落ちることを確かめました。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`mr:standby:infra:deploy`、`mr:infra:deploy`、`diff`、`drift`、`destroy`、`mr:status`、`mr:conflict`、`mr:empty` のどれもです。リージョンの障害もフェイルオーバーも、一度も起こしていません。したがって、RTO と RPO の実測値はありません。次も、実物では確かめていません。cdkd がグローバルテーブルとレプリカを作れること、大阪のスタックを同じアプリからデプロイできること、東京で済ませた bootstrap で足りること。名前を固定したバケットへの複製の設定と、逆向きの複製を足す 2 回目のデプロイ。2 つのリージョンから同時に編集したときに、実物でどちらが残るか。同じ時刻の書き込みの扱い。`ReplicationLatency` の実際の値。MRSC のテーブルの動きと、孤立したリージョンで SDK が投げるエラーの名前。ヘルスチェックが異常と判定するまでの時間、API Gateway のドメインを指すエイリアスレコードの TTL、クライアントが切り替わりに気づくまでの時間。Cloud Control API 経由の 3 種類の作成、同じドメインの証明書を 2 つのスタックが検証できること。06章の JWT オーソライザーが、東京に届かないあいだも検証を続けるか。複製のメトリクスの本数と課金。2 つのリージョンにまたがるスタックの削除と、あとに残るもの。モデルは、ドキュメントの規則を写しただけのものです。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| グローバルテーブルと 2 つの整合性モード | `examples/28-multi-region/infra/lib/region-stack.ts`、`src/global-table.ts`、`src/replica-repository.ts` | `test:unit` |
| 2 つのリージョンから同時に編集する | `examples/28-multi-region/test/global-table.test.ts` | `test:unit`、`mr:demo` |
| リージョンが切り離されたとき | `examples/28-multi-region/test/global-table.test.ts`、`test/failover.test.ts`、`src/regional-app.ts` | `test:unit`、`mr:demo` |
| バケットの複製 | `examples/28-multi-region/src/bucket-replication.ts`、`test/bucket-replication.test.ts`、`infra/lib/region-stack.ts` | `test:unit` |
| Route 53 のヘルスチェックと行き先 | `examples/28-multi-region/src/failover.ts`、`src/regional-app.ts`、`src/lambda.ts`、`src/env.ts`、`test/regional-app.test.ts` | `test:unit` |
| RTO と RPO を数字にする | `examples/28-multi-region/src/objectives.ts`、`test/failover.test.ts` | `test:unit`、`mr:demo` |
| 手元で動かす | `examples/28-multi-region/scripts/demo.ts`、`src/local.ts` | `mr:demo`、`test:unit` |
| AWS にのせる準備 | `examples/28-multi-region/infra/lib/region-stack.ts`、`infra/bin/app.ts`、`infra/test/region-stack.test.ts`、`src/regions.ts`、`cdk.json` | `mr:infra:synth`、`test:unit` |
| デプロイと確認 | `examples/28-multi-region/scripts/mr.ts` | `mr:standby:infra:deploy`、`mr:infra:deploy`、`mr:status`、`mr:conflict`、`mr:infra:drift` |
| 切り替えの訓練 | `examples/28-multi-region/infra/bin/app.ts`、`src/objectives.ts` | `mr:infra:deploy`、`mr:status` |
| 片付け | `examples/28-multi-region/scripts/mr.ts` | `mr:empty`、`mr:infra:destroy`、`mr:standby:infra:destroy` |
| 料金 | `data/pricing/` | `test:unit` |

**一次情報**（確認日はすべて 2026-10-13）

- [How DynamoDB global tables work](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/V2globaltables_HowItWorks.html)、[Using DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.html)、[Write modes with DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.prescriptive-guidance.writemodes.html)、[Evacuation processes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-global-table-design.prescriptive-guidance.evacuation.html)、[Best practices for global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/globaltables-bestpractices.html)、[Understanding Amazon DynamoDB billing for global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/global-tables-billing.html)。MRSC に使えるリージョンの組み合わせは、最初の 2 つのページで説明が食い違っています。東京、大阪、ソウルは、どちらの説明でも使えます
- [Replicating objects within and across Regions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication.html)、[What does Amazon S3 replicate?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-what-is-isnot-replicated.html)、[Requirements and considerations for replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-requirements.html)、[S3 Replication Time Control](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-time-control.html)、[Replicating delete markers between buckets](https://docs.aws.amazon.com/AmazonS3/latest/userguide/delete-marker-replication.html)、[Getting replication status information](https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-status.html)、[Setting up permissions for live replication](https://docs.aws.amazon.com/AmazonS3/latest/userguide/setting-repl-config-perm-overview.html)、[Using S3 Replication metrics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/repl-metrics.html)
- [How Amazon Route 53 determines whether a health check is healthy](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html)、[Values that you specify when you create or update health checks](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html)、[Active-active and active-passive failover](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-types.html)、[How Amazon Route 53 averts failover problems](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-problems.html)、[Latency-based routing](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-latency.html)、[Choosing between alias and non-alias records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html)、[Best practices for Amazon Route 53 DNS](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/best-practices-dns.html)
- [AWS::Route53::RecordSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-recordset.html)、[AWS::Route53::HealthCheck HealthCheckConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-route53-healthcheck-healthcheckconfig.html)、[Configure custom health checks for DNS failover for an API Gateway API](https://docs.aws.amazon.com/apigateway/latest/developerguide/dns-failover.html)、[Set up a Regional custom domain name in API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-regional-api-custom-domain-create.html)、[Resource types that support Cloud Control API](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)
- [Amazon Cognito: Regional data considerations](https://docs.aws.amazon.com/cognito/latest/developerguide/security-cognito-regional-data-considerations.html)、[Replicate AWS Secrets Manager secrets across Regions](https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html)
- AWS Price List bulk API: DynamoDB（[東京](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-1/index.json)、[大阪](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/ap-northeast-3/index.json)）、S3（[東京](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-1/index.json)、[大阪](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-3/index.json)）、[AWS Data Transfer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/ap-northeast-1/index.json)、[Route 53](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRoute53/current/index.json)。[Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)（複製の段落）、[Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/)（ヘルスチェックの追加機能と、AWS のエンドポイントの定義）
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（インストールしたパッケージの dist）、[aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（型定義）
- Cloudflare: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)、[D1: Global read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)、[D1: Data location](https://developers.cloudflare.com/d1/configuration/data-location/)、[How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)、[Durable Objects: Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)、[R2: Data location](https://developers.cloudflare.com/r2/reference/data-location/)、[R2: Durability](https://developers.cloudflare.com/r2/reference/durability/)
- Vercel: [Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region)

:::
