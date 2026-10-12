---
title: "18 Live Streaming: IVS"
revision: 2
---

# 18 Live Streaming: IVS

この章は、ほかの章に続かない独立したレシピです。配信ソフトから送った映像を、Web のページで数秒遅れで見られるところまでを、いちばん小さい構成で作ります。

使うのは Amazon IVS（Interactive Video Service）です。映像を受け取り、変換し、世界中へ配るまでの重い部分は IVS が引き受けるので、こちらで書くのはチャンネル（channel）の定義と、視聴ページと、配信の状態を確かめるスクリプトくらいです。

作り始める前に、料金のことを 1 つだけ知っておいてください。IVS は、**映像が送られている間は、視聴者が 0 人でも料金がかかります。** 配信ソフトを閉じ忘れたまま寝れば、朝まで課金が続きます。配信が止まっていることの確かめ方は[デプロイのページ](/ja/chapters/18-live/deploy.md)の「止まっていることを確かめる」に書いたので、試したあとは必ずそこまで進めてください。

[04章](/ja/chapters/04-http-api.md)で扱った Lambda とログが出てくるので、04章を読んでいることを前提にします。コードは `examples/18-live/` にあります。

## 全体像

<!-- section: 18.overview -->

```figure
caption: チャンネルが配信を 1 本受けて視聴者へ届け、状態の変化をイベントで知らせる
node encoder: Encoder | OBS, FFmpeg、ストリームキーを添える
node terminal: 自分の端末 | stream:status
node viewer: 視聴者のブラウザ | 視聴ページ（Vue + IVS player SDK）
node ingest: IVS ingest endpoint | global
node channel: IVS channel "aih-live" | ap-northeast-1, type BASIC, latency mode LOW, ストリームキーは 1 つまで
node rule: EventBridge rule | このチャンネルだけ: stream state, stream health, limit breach
node playback: IVS playback URL | HTTPS、global に配信
node fn: Lambda | 検証して、ログに 1 行書く
node logs: CloudWatch Logs | 7 日
edge encoder -> ingest: RTMPS :443
edge ingest -> channel
edge terminal -> channel: GetStream:「いま配信中か」の答え
edge channel --> rule: イベント（best effort）
edge channel -> playback
edge viewer -> playback: /config.json から playbackUrl を読む
edge rule -> fn
edge fn -> logs
mark channel
```

図で強調してある箱が**チャンネル**で、配信を 1 本受けて視聴者に届ける単位です。チャンネルには住所が 2 つあります。配信ソフトが映像を送る先の取り込みエンドポイント（ingest endpoint）と、視聴者が見にいく再生 URL（playback URL）です。

映像を送る側は、**ストリームキー**（stream key）という秘密の文字列を添えて送ります。ストリームキーを持っていれば誰でもこのチャンネルに配信できるので、パスワードと同じものだと考えてください。

チャンネルというリソースは東京リージョンに作りますが、映像の受け取りと配信は世界中で行われます。公式ドキュメントは、API とリソースを扱うコントロールプレーン（control plane）はリージョンごとにあり、配信と視聴を担うデータプレーン（data plane）はグローバルだと説明しています。東京に作ったチャンネルには、どこからでも送れて、どこからでも見られます。

チャンネルから下へ、EventBridge のルール、Lambda、CloudWatch Logs と続く経路は、配信が始まったことと終わったことを知るための仕組みです。詳しくは[デプロイのページ](/ja/chapters/18-live/deploy.md)で扱いますが、この経路に届くイベントは「だいたい届く」ものでしかありません。いま配信中かどうかの答えは、端末からチャンネルへ伸びている矢印の `GetStream` で IVS に聞きます。

## IVS は 2 つある

<!-- section: 18.products -->

IVS という名前の下には、別々の製品が 2 つあります。作る前に、どちらを使うのかを決めておきます。

| | low-latency streaming | real-time streaming |
| --- | --- | --- |
| リソース | channel | stage |
| 遅延（公式の表現） | 5 秒未満 | 300 ミリ秒未満になりうる |
| 送り方 | RTMPS、RTMP、SRT。OBS がそのまま使える | IVS の broadcast SDK など |
| 規模の既定値 | 同時視聴 15,000（リージョン全体、引き上げ可） | 1 つの stage に配信者 12、視聴者 10,000（引き上げ可） |
| 課金の単位 | 入力の時間と、視聴の時間 | 参加者ごとの時間 |
| 東京リージョン | エンドポイントあり | エンドポイントあり |

この章で作るのは、表の左の low-latency streaming です。1 人が OBS で配信し、大勢が Web のページで数秒遅れで見る、いちばん素直な形です。

右の real-time streaming を選ぶのは、**会話が成り立たないと困るとき**です。視聴者を配信に参加させて話す場面や、オークションで声を掛け合う場面では、数秒の遅れで会話が噛み合わなくなります。そのかわり、送る側も SDK を組み込んだアプリになるので、作るものが増えます。

遅延は小さいほどよい、という理由だけで右を選ぶ必要はありません。一方通行の配信なら、3 秒遅れていても誰も困らないからです。

## チャンネルを決める

<!-- section: 18.channel -->

チャンネルに設定するのは 3 つだけです。

<<< @/examples/18-live/src/channel.ts{settings}

料金と画質をいちばん左右するのは `type` です。4 種類あり、種類ごとに IVS のすることが違います。

| type | 入力 1 時間の料金（USD） | IVS がやること | 入力の上限 |
| --- | --- | --- | --- |
| `BASIC` | 0.20 | 送られた映像をそのまま 1 種類で配る | 480p 以下は 1.5 Mbps、それより大きければ 3.5 Mbps |
| `STANDARD`（既定） | 2.00 | 複数の画質に変換して配る。最高は 1080p | 8.5 Mbps |
| `ADVANCED_SD` | 0.50 | 複数の画質に変換。最高は 480p | 8.5 Mbps |
| `ADVANCED_HD` | 0.85 | 複数の画質に変換。最高は 720p | 8.5 Mbps |

表の「複数の画質」の 1 つ 1 つを**レンディション**（rendition）と呼びます。`STANDARD` のチャンネルに 1080p を送ると、IVS が 720p、480p、360p、160p も作り、プレイヤーが視聴者の回線に合わせて切り替えます。

この章では、料金が安い `BASIC` を選びました。`type` を指定しないと `STANDARD` になり、入力の料金が 10 倍になります。練習で 1 時間流すだけなら差は USD 1.80 ですが、止め忘れたときの差は大きくなります。金額は[費用のページ](/ja/chapters/18-live/wrap.md)で計算します。

そのかわり、`BASIC` にはレンディションが 1 つしかありません。回線の細い視聴者には低い画質へ切り替える先がないので、送ったビットレートを受けきれない視聴者の再生は止まります。視聴者の回線がばらばらな本番の配信では、これが `STANDARD` か `ADVANCED` を選ぶ理由になります。

`latencyMode` は `LOW` にしています。コンソールでは Ultra-low と表示される設定です。この章の用途では、`NORMAL` にする理由がありません。

### 上限を超えると、切られる

入力の上限を超えたときに起きるのは、画質の低下ではありません。ドキュメントは「おそらく即座に切断される」と書いています。そして、OBS の設定ウィザードが選ぶビットレートは、`BASIC` の上限より高いことがあります。

そこで、送る前に設定が上限に収まるかを確かめる関数を用意しました。

<<< @/examples/18-live/src/channel.ts{limits}

キーフレーム（IDR）の間隔も確かめています。IVS の推奨は 2 秒です。この間隔は、配信を始めてから見えるようになるまでの時間と、遅延そのものの両方に影響します。ドキュメントには、5 秒を超える値は避けるように書かれています。

### CDK で書く

<<< @/examples/18-live/infra/lib/live-stack.ts{channel}

固定している版の aws-cdk-lib には IVS の高レベルの construct がないので、CloudFormation のリソースにそのまま対応する `CfnChannel` を使っています。プロパティが少ないので、これで困りません。

`authorized: false` は、再生 URL を知っていれば誰でも見られるという意味です。この章の配信は公開で、見られた時間の料金は配信する側が払います。URL が広まるといくらになるかは[費用のページ](/ja/chapters/18-live/wrap.md)の「URL が広まったとき」で計算し、見られる人を絞る方法は同じページの「本番にするなら」に挙げました。

`insecureIngest: false` は、暗号化なしの RTMP を受け付けない設定です。RTMP で送ると、ストリームキーが平文のままネットワークを流れてしまいます。

## ストリームキーは鍵そのもの

<!-- section: 18.stream-key -->

ストリームキーを持っている人は、あなたのチャンネルに、あなたの料金で、好きな映像を流せます。API キーと同じように扱ってください。

<<< @/examples/18-live/infra/lib/live-stack.ts{stream-key}

CloudFormation でストリームキーを作るときには、間違えやすい点が 2 つあります。

1 つ目は、チャンネルを作ってもストリームキーが付いてこないことです。コンソールや `aws ivs create-channel` のように IVS の API でチャンネルを作ると、ストリームキーも一緒に作られます。ところが CloudFormation の `AWS::IVS::Channel` はストリームキーを作らないので、`AWS::IVS::StreamKey` を別に書かないと、誰も配信できないチャンネルができあがります。

2 つ目は、ストリームキーが 1 つのチャンネルに 1 つまでで、この上限は引き上げられないことです。

### 値をどこにも出さない

`CfnStreamKey` の `attrValue` という属性が、鍵の値そのものです。`attrValue` を `CfnOutput` に渡せば、デプロイのログにもスタックの出力にも鍵が出ます。Lambda の環境変数に渡せば、関数の設定を見られる人全員に鍵が見えます。

そのため、このスタックは `attrValue` を一切使わず、出力には ARN だけを出しています。テストでも、テンプレートのどこにも `Value` への参照がないことを確かめています。

鍵の値が必要になるのは配信ソフトに貼るときだけなので、そのときに取りにいきます。

```bash
vp run stream:key
vp run stream:key --show
```

1 行目は、配信ソフトに入れるサーバーの URL とビットレートの上限を表示し、鍵の値は出しません。`--show` を付けたときだけ、`GetStreamKey` で値を取り、その端末に 1 回表示します。ファイルには書きません。

ただし、鍵のコピーがもう 1 か所にあるかもしれません。cdkd は IVS のリソースを Cloud Control API で作ります。固定した版のソースを読むかぎり、cdkd はそのとき返ってきたリソースの中身を、属性として state（S3 のバケット）に記録します。そして `AWS::IVS::StreamKey` の中身には `Value` が含まれます。つまり、**cdkd の state を読める人は、ストリームキーを読めるかもしれません**。実機ではまだ確かめていないので「かもしれない」としか言えませんが、state のバケットは秘密が入っている場所として扱ってください。

### 漏れたら、作り直す

ストリームキーには、値だけを変える操作がありません。消してから作り直します。1 つのチャンネルに 1 つまでなので、先に消し、そのあとで作る順番になります。

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:infra:deploy
```

1 回目のデプロイでストリームキーがテンプレートから消え、cdkd が実物を削除します。2 回目で新しい鍵ができます。ARN も値も変わるので、配信ソフトの設定は入れ直しです。

1 回目だけで止めておく使い方もあります。鍵がないチャンネルには誰も配信できないので、しばらく使わないチャンネルに錠をかけておけます。

コンソールや CLI で鍵を作り直すこともできますが、そうするとスタックの知らない鍵ができて、state と実物がずれます。`vp run stream:infra:drift` で見つかるはずですが、最初からスタック経由で作り直すほうが迷いません。

## 視聴ページ

<!-- section: 18.player -->

次は見る側です。IVS の再生 URL は HLS のプレイリスト（`.m3u8`）ですが、数秒の遅延で見るには IVS の player SDK が要ります。ドキュメントは、低遅延を実現するには IVS のプレイヤーが必須だと言い切っています。

SDK は、`<script>` タグで CDN から読むか、npm の `amazon-ivs-player` を入れるかのどちらかで手に入ります。この章では、TypeScript の型が付いてきて、版を lockfile で固定できる npm を使いました。確認した時点の現行版は 1.57.0 でした。

ライセンスには注意が要ります。このパッケージは OSS ではなく、AWS Customer Agreement のもとで提供される「AWS Content」です。

<<< @/examples/18-live/web/src/player.ts{start}

`create` に渡している `wasmWorker` と `wasmBinary` は、npm 版を使うときに必要になる引数です。プレイヤーの本体は WebAssembly で、web worker の中で動くので、その 2 つのファイルの URL をこちらから教えなければなりません。ファイルの先頭で `?url` を付けて import しておくと、Vite がその 2 つをビルドに含め、URL を返します。

再生は消音で始めています。音が出る動画の自動再生は、ブラウザが止めることがあるからです。

### 「配信していない」は失敗ではない

視聴ページは、配信が始まる前から開かれます。そのときプレイヤーが返すのはエラーで、種類は `ErrorNotAvailable`、コードは 404 です。

このエラーを「再生に失敗しました」と表示するのは正しくありません。配信がまだ始まっていないだけだからです。

<<< @/examples/18-live/web/src/viewer.ts{view}

`viewFor` は、404 を「オフライン」、429 を「視聴者数の上限に達した」、それ以外のエラーを失敗と判断します。この判断はプレイヤーから切り離したふつうの関数にしてあり、SDK を読み込まないので、ブラウザなしでテストできます。

オフラインのときは、しばらく待ってからもう一度聞きにいきます。

<<< @/examples/18-live/web/src/viewer.ts{retry}

待ち時間は 5 秒から始めて倍にしていき、1 分で頭打ちにしています。この問い合わせは開いているタブの数だけ飛びます。配信の 1 時間前から 1,000 人が待っている状況を考えると、固定の 1 秒間隔にはできません。

### 再生 URL はビルドに埋めない

再生 URL はデプロイするまでわからないので、[06章](/ja/chapters/06-auth.md)と同じく、ページが起動するときに `/config.json` から読みます。

<<< @/examples/18-live/web/src/config.ts{config}

再生 URL は視聴者のブラウザに渡すものなので、秘密ではありません。ただし、URL の中には AWS のアカウント ID が入っていて、視聴者全員に見えます。

動かしてみて気づいたことがもう 1 つあります。プレイヤーは再生の統計を `player.stats.live-video.net` へ送ります。Content Security Policy を書いているサイトに組み込むなら、再生 URL のドメインと合わせて、このホストも許可する必要があります。
