---
title: "18 Live Streaming: 費用、注意点、片付け"
---

# 18 Live Streaming: 費用、注意点、片付け

この章の最後のページです。配信にかかる料金を計算し、録画やほかのサービスとの違い、本番で足すものを確かめてから、作ったものを片付けます。

## 料金

<!-- section: 18.cost -->

金額は USD、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

IVS の料金は、入力と出力の 2 つからなります。

- 入力は、映像を送っていた時間にかかる料金です。単価はチャンネルの type で決まり、`BASIC` は 1 時間 0.20、`STANDARD` は 2.00 です。時間は分単位に切り上げられます
- 出力は、視聴者に届けた時間の合計にかかる料金です。単価は、解像度と、どの地域から配ったかで決まります。日本を含む地域の最初の段階では、1 時間あたり SD（480 以下）が 0.046、HD（720 以下）が 0.092、Full HD（1080 以下）が 0.184 です。時間は秒単位に切り上げられます

出力の時間は、視聴者の数に見ていた時間を掛けたものです。100 人が 1 時間ずつ見れば 100 時間になります。

**配信していない月は、IVS の料金は 0 です。** 料金ページにも Price List にも、置いてあるだけのチャンネルにかかる料金は載っていません。この点が、このページの終わりのほうで触れる MediaLive との違いです。

### 使ったとき

月に 4 回、2 時間ずつ、`BASIC` のチャンネルに 720p で配信するとします。各回の視聴者は、平均で配信の半分を見ると仮定します。IVS のドキュメントが目安として挙げている割合です。

| | 各回 100 人 | 各回 1,000 人 |
| --- | --- | --- |
| 入力: 8 時間 | 1.60 | 1.60 |
| 出力: HD で 400 時間 / 4,000 時間 | 36.80 | 368.00 |
| 小計 | **38.40** | **369.60** |

料金のほとんどは出力で、出力は視聴者の数に比例します。請求を決めるのは、サーバーを何台立てたかではなく、何人が何分見たかです。人気が出るほど高くなるのは当然のことですが、見積もるときには、視聴者数と視聴時間の仮定を必ず書いてください。

無料枠は、上の表では引いていません。料金ページには、新規の AWS アカウントに最初の 12 か月、毎月 `BASIC` の入力 5 時間と SD の出力 100 時間が付くとあります。ただし期限があり、すべてのアカウントに当てはまるわけでもないからです。

EventBridge、Lambda、CloudWatch Logs の料金は、この表に入れていません。0 という意味ではなく、算入していないという意味です。視聴ページを配る料金も同じく入れていません。

### 止め忘れたとき

視聴者が 0 人のまま、配信ソフトだけが動き続けた場合の料金です。

| | `BASIC` | `STANDARD` |
| --- | --- | --- |
| 48 時間（週末） | 9.60 | - |
| 730 時間（1 か月） | 146.00 | 1,460.00 |

`BASIC` を選んだ理由は、この表にあります。同じ止め忘れでも、金額の桁が 1 つ違います。

01章で作った予算の通知は、ここでも役に立ちます。ただし、予算の通知は知らせるだけで、配信を止めてはくれません。止めるのは `stream:stop` と `streamKey=off` です。

### URL が広まったとき

止め忘れとは逆に、配信ソフトではなく見る側が料金を増やす場合もあります。

この章のチャンネルは `authorized: false` なので、再生 URL を知っていれば誰でも再生できます。その URL は視聴ページの `config.json` に入っていて、ページを開いた人なら誰でも読めます。秘密ではありません。IVS から見れば、人が見ていても、スクリプトが映像を取り続けていても、同じ「届けた時間」です。

いちばん悪い場合を計算します。同時視聴の既定の上限は、リージョン全体で 15,000 です。その全員が HD で見続けると、1 時間で 15,000 視聴時間になります。最初の段階の単価 0.092 を掛けると、**1 時間あたり USD 1,380** です。SD なら 690、Full HD で送っていれば 2,760 になります。量が増えると単価は少し下がり、HD は月 10,000 時間を超えた分が 0.084 になりますが、桁は変わりません。2 時間の配信なら 2,600 です。各回 100 人のつもりなら 9.20 で済むはずだった回が、この金額になります。

上限に達したあと、15,001 人目がどうなるかは、ここでは確かめていません。また、この上限は引き上げられる値で、リージョンにあるすべてのチャンネルの合計です。「これ以上は行かない」という保証ではなく、桁の目安として読んでください。

歯止めになることが 2 つあります。1 つは、この料金がかかるのは配信している間だけだということです。配信していなければ届ける映像がないので、URL に何万回アクセスされても出力は 0 のままです。もう 1 つは、配信を止めれば料金の増加も止まることです。`stream:status` は同時視聴の数も表示するので、心当たりのない数字が出ていたら、[デプロイのページ](/ja/chapters/18-live/deploy.md)の「止まっていることを確かめる」にある `stream:stop` と `streamKey=off` で、そのまま止められます。01章の予算の通知は 8〜12 時間おきにしか更新されないので、この場面では間に合いません。

人を集める配信をするなら、先に足しておくものがあります。見られる人を署名つきのトークンで絞る private channel、国やオリジンで絞る playback restriction policy、そして同時視聴の数を見張って知らせる仕組みです。「本番にするなら」に並べました。private channel の手順と料金は、この本では確かめていません。

### 消した後

スタックを消せば、チャンネルもストリームキーも消えて、IVS の料金は発生しなくなります。イベントのログも一緒に消えます。

## 録画は、要るようになってから

この章のチャンネルは録画しません。テストでも、テンプレートに録画の設定と S3 のバケットがないことを確かめています。

録画が必要になったら、IVS の S3 への自動録画（auto-record to S3）を使えます。`AWS::IVS::RecordingConfiguration` を作ってチャンネルの `RecordingConfigurationArn` に渡すと、配信のたびに映像がバケットへ書き出されます。

足す前に、料金、残るもの、録画が使えるようになる時点を知っておいてください。

- 録画の機能そのものに IVS の料金はかかりません。かかるのは S3 の料金で、保存、IVS があなたの代わりに行う書き込みのリクエスト、そして録画を誰かに配るときの配信が対象です
- 録画は、あなたのバケットのオブジェクトとして残ります。チャンネルを消しても、バケットの中身はそのままのはずです（IVS が消してくれるという記述は見つかりませんでした）。配信のたびに、HLS の映像、サムネイル、メタデータの JSON が `ivs/v1/<アカウント ID>/<channel ID>/<日時>/...` の下に増えていきます。ライフサイクルを設定しなければ、保存料金は増え続けます
- ドキュメントは、録画を再生したり加工したりするのは `Recording End` のイベントの後にするよう勧めています。そしてこのイベントも、[デプロイのページ](/ja/chapters/18-live/deploy.md)の「イベントは「だいたい届く」」で見たとおり、「だいたい届く」ものでしかありません

人が映っている映像を保存することの重さも忘れないでください。録画を足すときには、消す手段と期限を一緒に決めます。

## Cloudflare Stream から来た人へ

Cloudflare でライブ配信をしたことがあるなら、Stream の Live が近い体験です。違いを、Cloudflare のドキュメントで確かめられた範囲で並べます。

- 送り方は同じです。どちらも RTMPS と SRT を受けるので、OBS がそのまま使えます
- 見る側が違います。Stream は、付属の player か、HLS か DASH に対応した任意の player で再生できる、としています。IVS で数秒の遅延を出すには、IVS のプレイヤーが必須です
- 録画の既定が違います。Stream は、すべてのライブ配信を自動で録画します。IVS は、頼まないかぎり録画しません
- 課金の軸が違います。Stream は「録画した分数」と「配信した分数」に課金し、エンコードの料金は別にかからない、としています。IVS は「入力の時間」と、解像度ごとの「視聴の時間」に課金します。Stream は録画した分数に課金するので、流しっぱなしが料金になる点は似ています

遅延は比べていません。Cloudflare のそのページに数値が書かれていなかったからです。どちらが安いかも、視聴者数と画質と録画の要否で変わるので、ここでは述べません。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| OBS が「Failed to connect to server」 | 古い OBS は RTMPS に対応していないので、更新してください。鍵を作り直した後なら、古い鍵が設定に残っていないかを確かめます |
| つながった直後に切れる | ビットレートか解像度が type の上限を超えています。`BASIC` は 720p で 3.5 Mbps まで。`stream:status --events` に `Ingest Bitrate` が出ていれば、それが原因です |
| ページがずっと「offline」 | `stream:status` で配信中かを確認します。配信中なら、`web/dist/config.json` の再生 URL が古いチャンネルのものかもしれません。404 では「オフライン」と「URL が違う」を見分けられません |
| 映像は出るが、何十秒も遅れる | キーフレームの間隔が 2 秒になっているかを確かめます。iOS のブラウザは低遅延に対応していません |
| ビルドした視聴ページでプレイヤーが動かない | `.wasm` のファイルが `application/wasm` で配られているかを確かめます。自分で配るときの条件です |
| `stream:key` が `StreamKeyArn` を見つけられない | `streamKey=off` でデプロイした状態です。`-c streamKey=off` を付けずに、もう一度デプロイします |
| `stream:infra:destroy` が失敗する | 配信中のチャンネルは消せません（409）。配信を止めて、`stream:status --expect-offline` が通ってから消します |
| `stream:status --events` が「DISAGREE」 | イベントが遅れているか、届いていません。表示のとおり、`GetStream` のほうが答えです |

## 本番にするなら

- 見られる人を絞ります。いまは URL を知っていれば誰でも見られて、見られた時間はすべてあなたの請求になります（「URL が広まったとき」の計算です）。IVS には、署名つきのトークンがないと再生できない private channel（`authorized: true`）と、国やオリジンで絞る playback restriction policy があります。この章では扱っていません
- type を選び直します。視聴者の回線がばらばらなら、複数のレンディションを作る `STANDARD` か `ADVANCED` にします。入力の単価との兼ね合いで決めてください
- 止め忘れと見られすぎを仕組みで防ぎます。予定の時間を過ぎても配信中なら通知する、同時視聴が想定を超えたら通知する、鍵を配信のたびに発行して終わったら消す、といった方法があります。気をつけるだけでは仕組みになりません
- ストリームキーの置き場所を決めます。配信者に渡す経路、作り直す手順、state のバケットを読める人を決めておきます
- 上限を確かめます。既定では、同時視聴がリージョン全体で 15,000、同時配信が 100 です。大きな配信の前に、Service Quotas で引き上げを申請します
- 視聴ページを CDN に置きます。03章の構成が使えます。`.wasm` の Content-Type を忘れないでください
- 反映の経路を AWS CDK CLI と CloudFormation にします。02章で述べたとおり、cdkd は開発・テスト向けです

### MediaLive や MediaPackage が要るとき

IVS は、決まった形の配信を決まった形で配るためのサービスです。入力は H.264 と AAC で、画質の段階は type ごとに決まっていて、自分では組めません。

出力の形式や画質の段階を自分で決めたいときや、ほかの映像サービスとつなぎたいときには、AWS Elemental MediaLive を使います。MediaLive は、ライブの映像を別の形式やパッケージに変換するサービスで、出力を自分で設計できます。MediaPackage は、その出力を視聴用にパッケージして、配信のオリジンになるサービスです。この場合は、MediaLive、MediaPackage、CDN を自分で組み合わせることになります。

引き換えに、部品と料金の軸が増えます。MediaLive の channel は、入力に何も届いていなくても、動いている間は課金されます。止めてあっても、一部のリソースには待機の料金があります。IVS のように、流していなければ 0 というわけにはいきません。

OBS から送って、数秒の遅延で、Web で見せられれば足りるうちは、IVS のままで十分です。

## 片付け

<!-- section: 18.cleanup -->

配信中のチャンネルは消せないので、先に配信が止まっていることを確かめてから消します。

```bash
vp run stream:status --expect-offline
vp run stream:infra:destroy
```

1 行目が通らないとき、つまり配信中のときは、OBS を止めるか `vp run stream:stop` を実行します。

チャンネル、ストリームキー、ルール、関数、ロール、ロググループが消えます。ログも一緒に消えます。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイルです。手元の `web/dist/config.json` にも、もう存在しないチャンネルの再生 URL が残ります。配信ソフトに貼ったストリームキーは、もう使えませんが設定には残っているので、消しておいてください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（チャンネルの設定、`GetStream` の解釈、イベントの検証と集計、視聴ページの判断、スタックの assertion）。型検査（サンプル全体と、Vize による視聴ページ）。テンプレートの lint。synth（esbuild のバンドル込み。AWS への問い合わせなし）。視聴ページのビルドにプレイヤーの worker と `.wasm` が含まれること。`dev:stream:web` を起動して、チャンネルが未設定のときの表示をブラウザで確認。さらに、存在しないチャンネルの再生 URL を一時的に設定して、プレイヤーが worker と WebAssembly を読み込み、IVS の配信ドメインから 404 を受け取って、ページが「offline」と表示し、再試行を予約するところまでを確認（認証情報は使っていません。確認後、設定は元に戻しました）。

**まだ確かめていないこと。** 実際の配信と視聴は、一度も行っていません。`stream:infra:diff`、`deploy`、`drift`、`destroy`、`stream:key`、`stream:config`、`stream:status`、`stream:stop` は AWS に対して実行していません。具体的には、Cloud Control API 経由での `AWS::IVS::Channel` と `AWS::IVS::StreamKey` の作成と削除、cdkd の state にストリームキーの値が入るかどうか、`streamKey=off` を挟んだ鍵の作り直し、OBS からの接続、プレイヤーでの再生と遅延の値、timed metadata の表示、`GetStream` の実際の応答と `ChannelNotBroadcasting` の名前、EventBridge のイベントの実際の形、Lambda のログの行から `stream:status --events` がイベントを読み戻せること、配信中のチャンネルの削除が失敗すること。OBS の手順は IVS のドキュメントに基づくもので、画面では確かめていません。同時視聴が上限の 15,000 に達したあとの挙動と、`StopStream` のあと出力の課金が止まるまでの時間も、確かめていません。「URL が広まったとき」の金額は、クォータの既定値と Price List の単価を掛けた計算です。図の遅延の秒数は説明のための作り物です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| チャンネルを決める | `examples/18-live/src/channel.ts`、`infra/lib/live-stack.ts`、`test/channel.test.ts` | `test:unit`、`stream:infra:synth` |
| ストリームキーは鍵そのもの | `examples/18-live/infra/lib/live-stack.ts`、`infra/bin/app.ts`、`infra/test/live-stack.test.ts`、`scripts/key.ts` | `test:unit`、`stream:key` |
| 視聴ページ | `examples/18-live/web/src/player.ts`、`viewer.ts`、`config.ts`、`App.vue`、`viewer.test.ts` | `dev:stream:web`、`build:stream:web`、`typecheck:stream:web`、`lint:stream:web` |
| 配信してみる | `examples/18-live/scripts/key.ts`、`scripts/write-config.ts` | `stream:infra:diff`、`stream:infra:deploy`、`stream:key`、`stream:config`、`preview:stream:web` |
| 止まっていることを確かめる | `examples/18-live/src/stream.ts`、`src/ivs.ts`、`scripts/status.ts`、`scripts/stop.ts`、`test/stream.test.ts` | `stream:status`、`stream:stop` |
| 状態の変化を受け取る | `examples/18-live/src/events.ts`、`handler.ts`、`timeline.ts`、`logged-events.ts`、`test/events.test.ts`、`test/timeline.test.ts` | `test:unit`、`stream:status` |
| 視聴者ごとに「いま」が違う | `examples/18-live/web/src/player.ts`、`App.vue` | `preview:stream:web` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
| 片付け | `tools/src/infra/`、`examples/18-live/scripts/status.ts` | `stream:status`、`stream:infra:destroy` |

**cdkd がこのスタックのリソースをどう扱うか。** 固定した版（0.296.28）の npm の tarball で、`src/provisioning/register-providers.ts` にあたる部分を読みました。`AWS::Events::Rule`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::IVS::Channel` と `AWS::IVS::StreamKey` には無く、Cloud Control API 経由です。

**一次情報**（確認日はすべて 2026-10-11）

- [What is Amazon IVS Low-Latency Streaming?](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html)、[What is Amazon IVS Real-Time Streaming?](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html)
- [Amazon IVS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ivs.html)
- [Amazon IVS Streaming Configuration](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/streaming-config.html)、[Set Up Streaming Software](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/getting-started-set-up-streaming.html)
- [Amazon IVS Pricing](https://aws.amazon.com/ivs/pricing/)、[IVS Costs](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/costs.html)、AWS Price List bulk API: [IVS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonIVS/current/index.json)（リージョン別のファイルは無く、`AP-` で始まる usage type が「Japan, Hong Kong, SEA」）
- CloudFormation: [AWS::IVS::Channel](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-channel.html)、[AWS::IVS::StreamKey](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ivs-streamkey.html)
- IVS API: [GetStream](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_GetStream.html)、[Stream](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_Stream.html)、[StopStream](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_StopStream.html)、[DeleteChannel](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_DeleteChannel.html)
- [Using Amazon EventBridge with IVS](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html)
- [IVS Player SDK](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html)、[Web Player SDK: Getting Started](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/web-getting-started.html)、[amazon-ivs-player 1.57.0](https://www.npmjs.com/package/amazon-ivs-player/v/1.57.0)（型定義と `package.json`）
- [Embedding Metadata within a Video Stream](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/metadata.html)、[Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html)
- [What Is MediaLive?](https://docs.aws.amazon.com/medialive/latest/ug/what-is.html)、[MediaLive: Related Services](https://docs.aws.amazon.com/medialive/latest/ug/related-services.html)、[AWS Elemental MediaLive Pricing](https://aws.amazon.com/medialive/pricing/)
- [Cloudflare Stream: Stream live video](https://developers.cloudflare.com/stream/stream-live/)
- [@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)

一次情報で確かめられなかった点を挙げます。aws-cdk-lib に IVS の高レベル construct が無いことは、固定した版（2.273.0）の `aws-ivs` に `Cfn*` しか無いことで確認しました。別パッケージの construct があるかどうかは調べていません。private channel と playback restriction policy は、CloudFormation のプロパティとクォータの表で存在を確認しただけで、手順は読んでいません。録画がチャンネルの削除後も残ることは、S3 のオブジェクトである以上そのはずですが、明記した記述は見つけていません。MediaPackage の説明は、MediaLive のドキュメントの「Related Services」の記述によります。

:::
