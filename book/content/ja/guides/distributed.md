---
title: 分散システムの案内
revision: 3
---

# 分散システムの案内

この本のサンプルは小さなものばかりですが、どれも複数の場所にまたがって動きます。ブラウザ、CDN の各拠点、関数の実行環境、データベース。それぞれが別の時点の状態を持っていて、別々に失敗します。

このページでは、その話題が本のどこに出てくるかをまとめます。分散データベースの章だけの話ではないんです。

## どの章でも聞く 8 つの問い

状態を持つ例では、次の問いに答えていきます。

1. 状態の持ち主は誰か。どこにあるデータが正しいのか
2. 読み書きはどの経路を通るか
3. 整合性の保証は何で、どの範囲で成り立つか。1 回の読み取り、1 つの session、1 つのリージョン、全体のどれか
4. 同時に更新されたらどうなるか
5. 同じメッセージが 2 回届いたらどうなるか
6. 応答が返る前に接続が切れたら、処理は済んだのか済んでいないのか
7. 一部だけ成功して止まったら、どう戻すか
8. そのために追加でかかる料金は何か

そのうえで、守りたい性質（invariant）を平易な 1 文で書いて、それを壊そうとするテストを付けます。

サービスの名前から保証を推測することはしません。global、serverless、durable、exactly-once。こういう言葉は、それだけでは何も約束してくれないからです。

## 章ごとの答え

状態を持つ章を、まとまりごとに並べます。テストのファイルは、どれもこのリポジトリにあるものです。

### 土台と、ノートの API（02〜06章）

| 章 | 状態の持ち主 | invariant | 壊れ方と、それを見るテスト |
| --- | --- | --- | --- |
| [02](/ja/chapters/02-toolchain.md) | CDK のコード（とそこから作る template）、cdkd の state、AWS の実物 | 3 つは一致している | 誰かがコンソールで設定を変える。`tools/src/drift/report.test.ts` が、drift、削除、未比較、検出の失敗を別々に判定する |
| [03](/ja/chapters/03-spa.md) | S3 bucket。edge の cache と読者のブラウザは写し | 読者が持っている `index.html` が指すファイルは、必ず取得できる | 公開の途中で止まる。古いページを開いたままの読者がいる。`tools/src/site/plan.test.ts` が、アップロードの順序と古い asset の保持を確かめる |
| [04](/ja/chapters/04-http-api.md) | Lambda の個々の実行環境（複数あり、いつか消える） | この章では「共有されない」ことを仕様として固定する | 同時のリクエストが別の実行環境に届く。`examples/04-http-api/test/app.test.ts` が、2 つのインスタンスがノートを共有しないことを確かめる |
| [05](/ja/chapters/05-dynamodb.md) | DynamoDB の table | 保存に成功するたびに version はちょうど 1 増え、古い version に基づく更新は拒否される | 2 つの書き込みが同じ version を持つ。書き込み後に応答が失われて再試行する。`examples/05-dynamodb/test/repository-contract.ts` と `test/app.test.ts` が、通るのが 1 つだけであること、再試行で version が 2 つ進まないことを確かめる。作成の再試行で重複することも、仕様として記録している |
| [06](/ja/chapters/06-auth.md) | 「誰か」は token、「無効にされたか」は Cognito。API Gateway は token だけを見る | リクエストが読み書きできるのは、その token の `sub` を持ち主とするノートだけである | 別の利用者が ID を指定する、持ち主をリクエストに書き込む。`examples/06-auth/api/test/app.test.ts` が拒否を確かめる。失効した token が期限まで通ることは、テストではなく本文で説明している |

### 2 つの置き場所、queue、cache、edge（07〜10章）

| 章 | 状態の持ち主 | invariant | 壊れ方と、それを見るテスト |
| --- | --- | --- | --- |
| [07](/ja/chapters/07-uploads.md) | 添付の記録は DynamoDB、バイトは S3。2 つをまたぐ transaction はない | 添付の記録があるなら、その object は存在していて、自動削除の対象から外れている | 2 つの書き込みの間で止まる。`examples/07-uploads/api/test/partial-failure.test.ts` が、止める場所ごとに残るものを確かめる。完了後に同じ form を再送すると破れる穴は、この章では閉じておらず、テストがそのまま記録している |
| [08](/ja/chapters/08-async.md) | 検査の記録は DynamoDB。queue のメッセージは「仕事があるらしい」という合図 | 1 つの object key に対して、検査の記録は高々 1 つで、worker が処理したいちばん新しい作成イベントのものである | 同じメッセージが 2 回届く、古いイベントが後から届く、2 つの worker が同じイベントを持つ、書く前後で止まる。`examples/08-async/test/worker.test.ts`。batch の一部の失敗と DLQ は `test/queue.test.ts`、掃除の二重実行と中断は `test/housekeeping.test.ts` |
| [09](/ja/chapters/09-ssr.md) | 応答を作るのは Lambda。CloudFront の cache は edge location ごとの写し | 誰かの cookie や `Authorization` を見て作った応答は、共有 cache に入らない | 雑な共有 cache 越しに Alice、Bob の順で読む。`examples/09-ssr/test/cache-control.test.ts` が、全部に `public` を付ける origin では漏れること、この章の判定では漏れないこと、公開ページの古さが決めた秒数までであることを確かめる |
| [10](/ja/chapters/10-edge.md) | `edge-data.json` が正で、KeyValueStore はその写し。edge location はさらにその写し | sync は、自分が読んでいない変更を上書きしない。どこで失敗しても、もう一度実行すれば `edge-data.json` に収束する | 誰かが先に書く、応答だけが失われる、複数のリクエストの途中で止まる、競合し続ける。`examples/10-edge/test/sync.test.ts`。edge への反映の遅れは、テストではなく本文の話 |

### ネットワーク、コンテナ、データの置き場所（11〜14章）

| 章 | 状態の持ち主 | invariant | 壊れ方と、それを見るテスト |
| --- | --- | --- | --- |
| [11](/ja/chapters/11-network.md) | 状態は持たない。持つのは「どの subnet がどの経路に頼るか」という依存 | 止まっていない AZ の private subnet は、ほかの AZ が止まっても、止まる前に届いていた先に届く | NAT Gateway が 1 つだけの構成で、その AZ が止まる。`examples/11-network/test/reach.test.ts`。壊しているのは計画のモデルで、本物の AZ ではない |
| [12](/ja/chapters/12-containers.md) | task の外にあるデータ。task は入れ替わり、更新中は新旧の版が同時に動く | 同時に動いているどの版も、同時に動いているどの版が書いた record でも読める | rolling update と rollback で、新旧が同じ record を読み書きする。`examples/12-containers/test/versions.test.ts`。処理の途中で SIGTERM が届く場合は `test/shutdown.test.ts` |
| [13](/ja/chapters/13-sql.md) | Aurora DSQL の cluster | transaction は、全体が commit されるか、全体がやり直されるかのどちらか。やり直しで結果が変わるのは、DB から読み直した値によってだけ | 最後の 1 枠を 2 つの transaction が取り合って、片方が commit で負ける。`examples/13-sql/test/notes-repository.test.ts` が commit の競合を注入し、`test/transaction.test.ts` が再試行を見る。migration の中断と再開は `test/migrate.test.ts` |
| [14](/ja/chapters/14-kv-cache.md) | rate limit の数は共有の store（DynamoDB か Valkey）。一覧は元データ。cache は誰の持ち主でもない | 1 つの区間で通るリクエストは、同時に何件来ても上限まで。写しの古さは TTL を超えない | 「読んでから書く」store に 2 件が同時に来る、期限切れの item が返る、cache が失敗する、詰め直しが殺到する。`examples/14-kv-cache/test/rate-limit.test.ts`、`test/read-through.test.ts`、`test/dynamodb-store.test.ts` |

13章の競合は、手元では起きません。PGlite は接続が 1 本だからです。テストは「DSQL がドキュメントどおりに `40001` を返したとき、このコードが正しく動く」ことを見ていて、DSQL がそう振る舞うことの証明ではありません。

### 外へ出る処理と、長い処理（15〜18章）

| 章 | 状態の持ち主 | invariant | 壊れ方と、それを見るテスト |
| --- | --- | --- | --- |
| [15](/ja/chapters/15-email.md) | 通知の記録を持つ DynamoDB の table。届いたかどうかは、SES から後で届くイベント | 同じ `notificationId` で、メールが 2 通以上送られることはない | 宛先の確認、先取り、送信、送信後の記録の 4 か所を、「実行前に失敗」と「実行後に応答を失う」の 2 通りで止める。`examples/15-email/test/notify.test.ts`。イベントの重複と順序の入れ替わりは `test/events.test.ts`。代償として、1 通も届かない経路がある |
| [16](/ja/chapters/16-long-jobs.md) | 書かれた part と manifest を持つ S3。workflow が持ち回る進捗は、そこから作り直せる | 1 つの export の part は、番号ごとに 1 回だけ書かれ、次の part は、書かれた part が終わったところから始まる。manifest が無い export は、存在しない | 同じ step が 2 回走る、応答が失われる、止まっていた worker が後から書く、同じ export の実行が 2 つ重なる。`examples/16-long-jobs/test/steps.test.ts`。再試行の打ち切りと、取り消しへ進む経路は `test/workflow.test.ts`、durable function 版は `test/durable.test.ts` |
| [17](/ja/chapters/17-ai.md) | 状態は持たない。持つのは、呼び出し元に届いた途中までの出力 | `done` を受け取っていない出力は、完了した要約として扱われない | stream が途中で切れる。`examples/17-ai/test/client.test.ts` が、完了する応答を 1 バイトずつ切り詰めて、どこで切っても `incomplete` になることを確かめる |
| [18](/ja/chapters/18-live.md) | 配信中かどうかは IVS。届いたイベントは合図 | イベントから組み立てた見立てが `GetStream` と食い違ったら、`GetStream` を信じる | イベントが 2 回届く、順序が入れ替わる、1 つ消える。`examples/18-live/test/timeline.test.ts`。視聴者ごとに映像の遅れが違うことは、テストではなく本文の話 |

### 運用（19〜24章）

| 章 | 状態の持ち主 | invariant | 壊れ方と、それを見るテスト |
| --- | --- | --- | --- |
| [19](/ja/chapters/19-observability.md) | 何が起きたかは table とログ。メトリクスは集計で、trace は標本 | sampling されたかどうかに関係なく、すべてのリクエストは、request ID の付いたログの行を 1 行残す | sampling を切る、呼び出し元が「記録しない」と伝えてくる、exporter が落ちる。`examples/19-observability/test/tracing.test.ts` |
| [20](/ja/chapters/20-shipping.md) | CloudFormation の stack。デプロイは何十回もの API 呼び出しの列で、途中で止まる | ほかの操作が動いている stack と、人が直さないと先へ進めない stack には、デプロイを始めない | 更新が失敗して戻る、rollback にも失敗する。`examples/20-shipping/test/stack-status.test.ts` が、状態を順に並べて、途中で一度も「デプロイ可」と答えないことを確かめる |
| [21](/ja/chapters/21-security.md) | 鍵は Secrets Manager。実行環境ごとの cache は、読んだ時刻がばらばらの写し | 期限内の token は、どの実行環境でも検証を通る。rotation の前に発行されたものも、後に発行されたものも | 2 つの実行環境が別の時刻に rotation を見る、でたらめな version id が大量に届く、Secrets Manager が応答しない。`examples/21-security/test/keyring.test.ts`。rotation の手順は `test/rotation.test.ts`、IAM の反映待ちは `test/propagation.test.ts` |
| [22](/ja/chapters/22-recovery.md) | ノートと記録は DynamoDB、バイトは S3。復元は、2 つを別々の時刻に戻す | 07章と 08章の invariant を、復元の後にも検査できて、破れていたら直せる | table だけを戻す、アップロードより前に戻す、上書きの後に戻す。`examples/22-recovery/test/skew.test.ts`。object の復元の再実行と中断は `test/object-restore.test.ts` |
| [23](/ja/chapters/23-ec2.md) | 1 台の instance に付けた data volume の上のファイル | 201 を返したノートは、プロセスが再起動しても、instance が作り直されても、読める | 書き込みの途中でプロセスが止まる、instance が作り直される。`examples/23-ec2/test/file-notes.test.ts` と `test/data-volume.test.ts` |
| [24](/ja/chapters/24-celld.md) | bucket、持ち主の node の disk、follower の disk の 3 か所 | cell の持ち主は同時に 1 台。応答済みの書き込みは失われない。守っているのは celld で、この章の受け持ちは、その前提を壊さない運用 | 更新の途中で失敗する、node を 1 台失う、応答のないリクエストが残る。`examples/24-celld/test/rollout.test.ts` と `test/ledger.test.ts` |

24章のテストが相手にしているのは、作り物の fleet です。celld そのものは、手元でも AWS でも、まだ一度も起動していません。

## ここまでは、どれもローカルのテストです

正直に言うと、上の表のテストは、どれも手元で動かしたものです。AWS の上では、どの章の検査も、まだ一度も実行していません。05章の条件付き書き込みを DynamoDB に送ったことも、08章の worker に本物の S3 のイベントを渡したことも、13章の transaction を本物の cluster で競合させたこともありません。

決まった順序で失敗を再現できるのは、いいところです。ただ、確かめているのはこの本のコードの判断であって、AWS のサービスの挙動ではありません。実際の反映の遅れ、実行環境の増え方、IAM の反映、イベントの実際の形、本物の障害のときの動きは、実環境でしか確かめられません。何が残っているかは、[検証記録](/ja/reference/validation.md)に章ごとに書いてあります。

最初の API からいきなり複数リージョン、という進め方はしません。小さなふつうの例、その失敗例、必要なら深いラボ、の順で進めます。

実環境で障害を起こす実験は、専用の環境と、明示的に実行するタスクに分けます。ふだんの `vp run check:all` は AWS に触りません。
