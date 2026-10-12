---
title: "18 Live Streaming: 費用、注意点、片付け"
---

# 18 Live Streaming: 費用、注意点、片付け

## お金の話

<!-- section: 18.cost -->

金額は USD、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

IVS の料金は 2 階建てです。

- **入力**: 映像を送っていた時間。channel の type で単価が決まる。`BASIC` は 1 時間 0.20、`STANDARD` は 2.00。分単位に切り上げ
- **出力**: 視聴者に届けた時間の合計。解像度と、どの地域から配ったかで単価が決まる。日本を含む地域の最初の段階で、1 時間あたり SD（480 以下）0.046、HD（720 以下）0.092、Full HD（1080 以下）0.184。秒単位に切り上げ

出力は「視聴者の数 × 見ていた時間」です。100 人が 1 時間ずつ見たら 100 時間。

**配信していない月は、IVS の料金は 0 です。** 料金ページにも Price List にも、置いてあるだけの channel にかかる料金は載っていません。この点が、あとで触れる MediaLive との違いです。

### 使ったとき

月に 4 回、2 時間ずつ配信する。`BASIC` の channel に 720p で送る。各回、視聴者が平均で配信の半分を見る（IVS のドキュメントが目安として挙げている割合です）。

| | 各回 100 人 | 各回 1,000 人 |
| --- | --- | --- |
| 入力: 8 時間 | 1.60 | 1.60 |
| 出力: HD で 400 時間 / 4,000 時間 | 36.80 | 368.00 |
| 小計 | **38.40** | **369.60** |

見てのとおり、料金のほとんどは出力です。そして出力は、視聴者の数に比例します。サーバーを何台立てるかではなく、**何人が何分見たか**で請求が決まる。人気が出るほど高くなる、という当たり前の話ですが、見積もりのときは視聴者数と視聴時間の仮定を必ず書いてください。

無料枠について。料金ページには、新規の AWS アカウントに最初の 12 か月、毎月 `BASIC` の入力 5 時間と SD の出力 100 時間が付くとあります。期限つきで、すべてのアカウントに当てはまるわけではないので、上の表では引いていません。

EventBridge、Lambda、CloudWatch Logs の料金は、この表に入れていません（0 という意味ではなく、未算入です）。視聴ページの配信も同じです。

### 止め忘れたとき

視聴者は 0 人。配信ソフトだけが動き続けた場合です。

| | `BASIC` | `STANDARD` |
| --- | --- | --- |
| 48 時間（週末） | 9.60 | - |
| 730 時間（1 か月） | 146.00 | 1,460.00 |

`BASIC` を選んだ理由が、ここにあります。同じ止め忘れで、桁が 1 つ違います。

01章で作った予算の通知は、ここでも役に立ちます。ただ、あれは通知であって、止めてはくれません。止めるのは `stream:stop` と `streamKey=off` です。

### 消した後

stack を消せば、channel も stream key も消えて、IVS の料金は発生しなくなります。イベントのログも一緒に消えます。

## 録画は、要るようになってから

この章の channel は録画しません。テストも、template に録画の設定と S3 の bucket がないことを見ています。

必要になったら、IVS に S3 への自動録画（auto-record to S3）があります。`AWS::IVS::RecordingConfiguration` を作って、channel の `RecordingConfigurationArn` に渡すと、配信のたびに bucket へ書き出されます。

足す前に知っておくことは 3 つです。

- **料金。** 録画の機能そのものに IVS の料金はかかりません。かかるのは S3 です。保存、IVS があなたの代わりに行う書き込みのリクエスト、そして録画を誰かに配るときの配信の料金
- **残るもの。** 録画は、あなたの bucket のオブジェクトです。channel を消しても、bucket の中身はそのままのはずです（IVS が消してくれるという記述は見つかりませんでした）。配信のたびに、HLS の映像、サムネイル、メタデータの JSON が `ivs/v1/<アカウント ID>/<channel ID>/<日時>/...` の下に増えていきます。lifecycle を設定しなければ、保存料金は増え続けます
- **使えるようになる時点。** ドキュメントは、録画を再生したり加工したりするのは `Recording End` のイベントの後にするよう勧めています。そしてそのイベントも、さっきの話のとおり「だいたい届く」ものです

映っている人がいる映像を保存する、ということの重さも忘れずに。消す手段と期限を、足すときに一緒に決めてください。

## Cloudflare Stream から来た人へ

Cloudflare でライブ配信をやったことがあるなら、Stream の Live が近い体験です。違いを、Cloudflare のドキュメントで確かめられた範囲で並べます。

- **送り方は同じ。** どちらも RTMPS と SRT を受けます。OBS がそのまま使えます
- **見る側。** Stream は、付属の player か、HLS か DASH に対応した任意の player で再生できる、としています。IVS は、数秒の遅延を出すには IVS の player が必須です
- **録画。** Stream は、すべてのライブ配信を自動で録画します。IVS は、頼まないかぎり録画しません
- **課金の軸。** Stream は「録画した分数」と「配信した分数」で、エンコードの料金は別にかからない、としています。IVS は「入力の時間」と「視聴の時間（解像度ごと）」です。Stream は録画した分数に課金するので、流しっぱなしが料金になる点は似ています

遅延については、Cloudflare のそのページに数値が書かれていなかったので、比べていません。どちらが安いかも、視聴者数と画質と録画の要否で変わるので、ここでは言いません。

## ハマりどころ

| こうなったら | ここを見る |
| --- | --- |
| OBS が「Failed to connect to server」 | OBS が古いと RTMPS に対応していません。更新を。鍵を作り直した後なら、古い鍵のままになっていませんか |
| つながった直後に切れる | bitrate か解像度が type の上限を超えています。`BASIC` は 720p で 3.5 Mbps まで。`stream:status --events` に `Ingest Bitrate` が出ていれば、それです |
| ページがずっと「offline」 | `stream:status` で配信中か確認。配信中なら、`web/dist/config.json` の playback URL が古い channel のものでは。404 は「オフライン」と「URL が違う」の見分けがつきません |
| 映像は出るが、何十秒も遅れる | keyframe の間隔が 2 秒になっていますか。iOS のブラウザは低遅延に対応していません |
| ビルドした視聴ページで player が動かない | `.wasm` のファイルが `application/wasm` で配られていますか。自分で配るときの条件です |
| `stream:key` が `StreamKeyArn` を見つけられない | `streamKey=off` でデプロイした状態です。もう一度ふつうにデプロイを |
| `stream:infra:destroy` が失敗する | 配信中の channel は消せません（409）。止めて、`stream:status --expect-offline` が通ってから |
| `stream:status --events` が「DISAGREE」 | イベントが遅れているか、消えています。表示のとおり、`GetStream` のほうが答えです |

## 本番にするなら

- **見られる人を絞る。** いまは URL を知っていれば誰でも見られます。IVS には、署名つきの token がないと再生できない private channel（`authorized: true`）と、国や origin で絞る playback restriction policy があります。この章では扱っていません
- **type を選び直す。** 視聴者の回線がばらばらなら、複数の rendition を作る `STANDARD` か `ADVANCED` に。入力の単価と相談です
- **止め忘れを仕組みで防ぐ。** 予定の時間を過ぎても配信中なら通知する、鍵を配信のたびに発行して終わったら消す、など。「気をつける」は仕組みではありません
- **stream key の置き場所を決める。** 配信者に渡す経路、作り直す手順、state の bucket を読める人
- **上限を確かめる。** 同時視聴は、リージョン全体で既定 15,000、同時配信は 100。大きな配信の前に Service Quotas で引き上げを
- **視聴ページを CDN に置く。** 03章の構成で。`.wasm` の Content-Type を忘れずに
- **反映の経路を AWS CDK CLI と CloudFormation にする。** 02章で話したとおり、cdkd は開発・テスト向けです

### MediaLive や MediaPackage が要るとき

IVS は、決まった形の配信を、決まった形で配るためのサービスです。入力は H.264 と AAC、画質の段階は type ごとに決まっていて、自分では組めません。

その「決まった形」から外れたくなったら、AWS Elemental MediaLive の出番です。MediaLive は、ライブの映像を別の形式や package に変換するサービスで、出力を自分で設計できます。MediaPackage は、その出力を視聴用に package して配信元になるサービスです。出力の形式や画質の段階を自分で決めたい、ほかの映像サービスとつなぎたい。そういうときに、MediaLive、MediaPackage、CDN を自分で組み合わせます。

引き換えに、部品と料金の軸が増えます。MediaLive の channel は、入力に何も届いていなくても、動いている間は課金されます。止めてあっても、一部のリソースには待機の料金があります。IVS のように「流していなければ 0」ではありません。

数秒の遅延で、OBS から送って、Web で見せる。それで足りるうちは、IVS のままで十分です。

## 片付け

<!-- section: 18.cleanup -->

順番があります。配信中の channel は消せないので、先に止めます。

```bash
vp run stream:status --expect-offline
vp run stream:infra:destroy
```

1 行目が通らなければ（配信中なら）、OBS を止めるか `vp run stream:stop` を。

channel、stream key、rule、関数、role、log group が消えます。ログも一緒です。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、そこに置かれたデプロイ用のファイル。それと、手元の `web/dist/config.json` に、もう存在しない channel の playback URL が残ります。配信ソフトに貼った stream key も、もう使えませんが、設定には残っています。消しておきましょう。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（channel の設定、`GetStream` の解釈、イベントの検証と集計、視聴ページの判断、stack の assertion）。型検査（サンプル全体と、Vize による視聴ページ）。template の lint。synth（esbuild の bundle 込み。AWS への問い合わせなし）。視聴ページのビルドに player の worker と `.wasm` が含まれること。`dev:stream:web` を起動して、channel が未設定のときの表示をブラウザで確認。さらに、存在しない channel の playback URL を一時的に設定して、player が worker と WebAssembly を読み込み、IVS の配信ドメインから 404 を受け取って、ページが「offline」と表示し、再試行を予約するところまでを確認（認証情報は使っていません。確認後、設定は元に戻しました）。

**まだ確かめていないこと。** 実際の配信と視聴は、一度も行っていません。`stream:infra:diff`、`deploy`、`drift`、`destroy`、`stream:key`、`stream:config`、`stream:status`、`stream:stop` は AWS に対して実行していません。具体的には、Cloud Control API 経由での `AWS::IVS::Channel` と `AWS::IVS::StreamKey` の作成と削除、cdkd の state に stream key の値が入るかどうか、`streamKey=off` を挟んだ鍵の作り直し、OBS からの接続、player での再生と遅延の値、timed metadata の表示、`GetStream` の実際の応答と `ChannelNotBroadcasting` の名前、EventBridge のイベントの実際の形、Lambda のログの行から `stream:status --events` がイベントを読み戻せること、配信中の channel の削除が失敗すること。OBS の手順は IVS のドキュメントに基づくもので、画面では確かめていません。図の遅延の秒数は説明のための作り物です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| channel を決める | `examples/18-live/src/channel.ts`、`infra/lib/live-stack.ts`、`test/channel.test.ts` | `test:unit`、`stream:infra:synth` |
| stream key は鍵そのもの | `examples/18-live/infra/lib/live-stack.ts`、`infra/bin/app.ts`、`infra/test/live-stack.test.ts`、`scripts/key.ts` | `test:unit`、`stream:key` |
| 視聴ページ | `examples/18-live/web/src/player.ts`、`viewer.ts`、`config.ts`、`App.vue`、`viewer.test.ts` | `dev:stream:web`、`build:stream:web`、`typecheck:stream:web`、`lint:stream:web` |
| 配信してみる | `examples/18-live/scripts/key.ts`、`scripts/write-config.ts` | `stream:infra:diff`、`stream:infra:deploy`、`stream:key`、`stream:config`、`preview:stream:web` |
| 止まっている？ | `examples/18-live/src/stream.ts`、`src/ivs.ts`、`scripts/status.ts`、`scripts/stop.ts`、`test/stream.test.ts` | `stream:status`、`stream:stop` |
| 状態の変化を受け取る | `examples/18-live/src/events.ts`、`handler.ts`、`timeline.ts`、`logged-events.ts`、`test/events.test.ts`、`test/timeline.test.ts` | `test:unit`、`stream:status` |
| 視聴者ごとに「いま」が違う | `examples/18-live/web/src/player.ts`、`App.vue` | `preview:stream:web` |
| お金の話 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
| 片付け | `tools/src/infra/`、`examples/18-live/scripts/status.ts` | `stream:status`、`stream:infra:destroy` |

**cdkd がこの stack のリソースをどう扱うか。** 固定した版（0.296.28）の npm の tarball で、`src/provisioning/register-providers.ts` にあたる部分を読みました。`AWS::Events::Rule`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::IVS::Channel` と `AWS::IVS::StreamKey` には無く、Cloud Control API 経由です。

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

一次情報で確かめられなかった点: aws-cdk-lib に IVS の高レベル construct が無いことは、固定した版（2.273.0）の `aws-ivs` に `Cfn*` しか無いことで確認しました。別パッケージの construct があるかどうかは調べていません。private channel と playback restriction policy は、CloudFormation の property と quota の表で存在を確認しただけで、手順は読んでいません。録画が channel の削除後も残ることは、S3 のオブジェクトである以上そのはずですが、明記した記述は見つけていません。MediaPackage の説明は、MediaLive のドキュメントの「Related Services」の記述によります。

:::
