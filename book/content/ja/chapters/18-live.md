---
title: "18 Live Streaming: IVS"
revision: 2
---

# 18 Live Streaming: IVS

この章は独立したレシピです。配信ソフトから映像を送って、Web のページで数秒遅れで見る。そこまでを、いちばん小さい構成で作ります。

使うのは Amazon IVS（Interactive Video Service）です。映像を受け取る、変換する、世界中へ配る、という重たい部分を全部やってくれるサービスで、こちらが書くのは channel の定義と、視聴ページと、状態を確かめる script くらいです。

先に 1 つだけ。IVS は、**映像が送られている間ずっと料金がかかります。視聴者が 0 人でも、です。** 配信ソフトを閉じ忘れて寝ると、朝まで課金されています。止まっていることの確かめ方は、この章の「止まっている？」の節に書きました。試したあとは、必ずそこまでやってくださいね。

前提は [04章](/ja/chapters/04-http-api.md)です（Lambda とログの話が出てきます）。コードは `examples/18-live/` にあります。

## 全体像

<!-- section: 18.overview -->

```figure
caption: channel が配信を 1 本受けて視聴者へ届け、状態の変化を event で知らせる
node encoder: Encoder | OBS, FFmpeg、stream key を提示する
node terminal: 自分の terminal | stream:status
node viewer: 視聴者の browser | player page（Vue + IVS player SDK）
node ingest: IVS ingest endpoint | global
node channel: IVS channel "aih-live" | ap-northeast-1, type BASIC, latency mode LOW, stream key は 1 つまで
node rule: EventBridge rule | この channel だけ: stream state, stream health, limit breach
node playback: IVS playback URL | HTTPS、global に配信
node fn: Lambda | 検証して、1 行 log に書く
node logs: CloudWatch Logs | 7 日
edge encoder -> ingest: RTMPS :443
edge ingest -> channel
edge terminal -> channel: GetStream:「いま配信中か」の答え
edge channel --> rule: event（best effort）
edge channel -> playback
edge viewer -> playback: /config.json から playbackUrl を読む
edge rule -> fn
edge fn -> logs
mark channel
```

真ん中にいるのが **channel** です。配信を 1 本受けて、視聴者に届ける単位ですね。channel は 2 つの住所を持っています。配信ソフトが送る先の ingest endpoint と、視聴者が見にいく playback URL です。

送る側は、**stream key** という秘密の文字列を添えて送ります。これを持っている人は、誰でもこの channel に配信できます。パスワードだと思ってください。

おもしろいのは場所の話です。channel というリソースは東京リージョンに作りますが、映像の受け取りと配信は世界中で行われます。公式ドキュメントの言い方では、control plane（API とリソース）は regional、data plane（配信と視聴）は global。東京に作った channel に、どこからでも送れて、どこからでも見られます。

下半分は、配信が始まった・終わったを知るための仕組みです。あとで詳しく話しますが、ここに届くイベントは「だいたい届く」ものでしかありません。いま配信中かどうかの答えは、右下の `GetStream` に聞きます。

## IVS は 2 つある

<!-- section: 18.products -->

IVS という名前の下に、別の製品が 2 つあります。作る前に、どちらの話をしているのかを決めておきましょう。

| | low-latency streaming | real-time streaming |
| --- | --- | --- |
| リソース | channel | stage |
| 遅延（公式の表現） | 5 秒未満 | 300 ミリ秒未満になりうる |
| 送り方 | RTMPS、RTMP、SRT。OBS がそのまま使える | IVS の broadcast SDK など |
| 規模の既定値 | 同時視聴 15,000（リージョン全体、引き上げ可） | 1 つの stage に配信者 12、視聴者 10,000（引き上げ可） |
| 課金の単位 | 入力の時間と、視聴の時間 | 参加者ごとの時間 |
| 東京リージョン | endpoint あり | endpoint あり |

この章は左、low-latency streaming です。1 人が配信して、大勢が数秒遅れで見る。配信ソフトは OBS、見る側は Web のページ。いちばん素直な形です。

右を選ぶのは、**会話が成り立たないと困るとき**です。視聴者をステージに上げて話す、オークションで声を掛け合う、といった場面では、数秒の遅れが致命的になります。そのかわり、送る側も SDK を組み込んだアプリになって、作るものが増えます。

「遅延は小さいほどいい」で右を選ばないのがコツです。一方通行の配信なら、3 秒遅れていても誰も困りません。

## channel を決める

<!-- section: 18.channel -->

channel の設定は 3 つだけです。

<<< @/examples/18-live/src/channel.ts{settings}

`type` が、料金と画質をいちばん左右します。4 種類あって、やることが違います。

| type | 入力 1 時間の料金（USD） | IVS がやること | 入力の上限 |
| --- | --- | --- | --- |
| `BASIC` | 0.20 | 送られた映像をそのまま 1 種類で配る | 480p 以下は 1.5 Mbps、それより大きければ 3.5 Mbps |
| `STANDARD`（既定） | 2.00 | 複数の画質に変換して配る。最高は 1080p | 8.5 Mbps |
| `ADVANCED_SD` | 0.50 | 複数の画質に変換。最高は 480p | 8.5 Mbps |
| `ADVANCED_HD` | 0.85 | 複数の画質に変換。最高は 720p | 8.5 Mbps |

「複数の画質」の 1 つ 1 つを **rendition** と呼びます。`STANDARD` の channel に 1080p を送ると、IVS が 720p、480p、360p、160p も作ってくれて、player が視聴者の回線に合わせて切り替えます。

この章は `BASIC` にしました。理由は値段です。何も指定しないと `STANDARD` になって、入力の料金が 10 倍になります。練習で 1 時間流すだけなら、差は USD 1.80 ですが、止め忘れたときの差は大きいですよ（あとで計算します）。

そのかわり、`BASIC` は rendition が 1 つしかありません。回線の細い視聴者に、低い画質へ逃げる先がない。送った bitrate を受けきれない人は、止まります。視聴者の回線がばらばらな本番の配信なら、`STANDARD` か `ADVANCED` を選ぶ理由になります。

`latencyMode` は `LOW`（コンソールでは Ultra-low）。`NORMAL` にする理由は、この章の用途にはありません。

### 上限を超えると、切られる

入力の上限は「画質が落ちる」ではなく、ドキュメントの言葉では「おそらく即座に切断される」です。OBS の設定ウィザードが選ぶ bitrate は、`BASIC` の上限より高いことがあります。

なので、送る前に確かめられるようにしておきました。

<<< @/examples/18-live/src/channel.ts{limits}

keyframe（IDR）の間隔も大事です。IVS の推奨は 2 秒。この間隔が、配信を始めてから見えるようになるまでの時間と、遅延そのものに効いてきます。5 秒を超える値は避けるように、と書かれています。

### CDK で書く

<<< @/examples/18-live/infra/lib/live-stack.ts{channel}

固定している版の aws-cdk-lib には、IVS の高レベルの construct がありません。なので、CloudFormation のリソースにそのまま対応する `CfnChannel` を使っています。property が少ないので、困りません。

`authorized: false` は、「playback URL を知っていれば誰でも見られる」という意味です。この章の配信は公開です。そして、見られた時間の料金を払うのは配信する側です。URL が広まるといくらになるかは「お金の話」で計算します。見られる人を絞りたくなったら「本番にするなら」へ。

`insecureIngest: false` は、暗号化なしの RTMP を受け付けない設定です。RTMP で送ると、stream key が平文でネットワークを流れます。

## stream key は鍵そのもの

<!-- section: 18.stream-key -->

stream key を持っている人は、あなたの channel に、あなたの料金で、好きな映像を流せます。扱いは API キーと同じです。

<<< @/examples/18-live/infra/lib/live-stack.ts{stream-key}

ここに、ちょっとした罠が 2 つあります。

1 つ目。IVS の API で channel を作ると（コンソールや `aws ivs create-channel`）、stream key も一緒に作られます。ところが CloudFormation の `AWS::IVS::Channel` は、stream key を作りません。`AWS::IVS::StreamKey` を別に書かないと、誰も配信できない channel ができあがります。

2 つ目。stream key は、1 つの channel に 1 つまでです。この上限は引き上げられません。

### 値をどこにも出さない

`CfnStreamKey` には `attrValue` という属性があって、これが鍵の値そのものです。`CfnOutput` に渡せば、デプロイのログにも、stack の output にも、鍵が出ます。Lambda の環境変数に渡せば、関数の設定を見られる人全員に見えます。

なので、この stack は `attrValue` に一切触りません。output に出すのは ARN だけ。テストも、template のどこにも `Value` への参照がないことを見張っています。

鍵が要るのは、配信ソフトに貼るときだけです。そのときに取りにいきます。

```bash
vp run stream:key
vp run stream:key --show
```

1 行目は、配信ソフトに入れるサーバーの URL と bitrate の上限を表示します。鍵の値は出しません。`--show` を付けたときだけ、`GetStreamKey` で値を取って、その端末に 1 回表示します。ファイルには書きません。

正直に書いておくと、鍵のコピーがもう 1 か所にあるかもしれません。cdkd は IVS のリソースを Cloud Control API で作ります。固定した版のソースを読むかぎり、そのとき返ってきたリソースの中身を、属性として state（S3 の bucket）に記録します。`AWS::IVS::StreamKey` の中身には `Value` が含まれます。つまり、**cdkd の state を読める人は、stream key を読めるかもしれません**。実機ではまだ確かめていないので「かもしれない」ですが、state の bucket は秘密が入っている場所として扱ってください。

### 漏れたら、作り直す

stream key には「値だけ変える」操作がありません。消して、作り直します。1 つの channel に 1 つまでなので、順番は「消す、作る」です。

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:infra:deploy
```

1 回目で stream key が template から消えて、cdkd が削除します。2 回目で新しい鍵ができます。ARN も値も変わるので、配信ソフトの設定は入れ直しです。

1 回目だけで止めておく、という使い方もあります。鍵がない channel には、誰も配信できません。しばらく使わない channel に鍵をかけておく感じですね。

コンソールや CLI で鍵を作り直すこともできますが、そうすると stack の知らない鍵ができて、state とずれます。`vp run stream:infra:drift` が見つけてくれるはずですが、最初から stack 経由でやるほうが迷いません。

## 視聴ページ

<!-- section: 18.player -->

見る側です。IVS の playback URL は HLS の playlist（`.m3u8`）ですが、数秒の遅延で見るには IVS の player SDK が要ります。ドキュメントは「低遅延を実現するには IVS player が必須」と言い切っています。

SDK の入手方法は 2 つあります。`<script>` タグで CDN から読むか、npm の `amazon-ivs-player` を入れるか。この章は npm です。TypeScript の型が付いてくるのと、版を lockfile で固定できるからです。確認した時点の現行版は 1.57.0 でした。

ライセンスに 1 つ注意を。このパッケージは OSS ではありません。AWS Customer Agreement のもとで提供される「AWS Content」です。

<<< @/examples/18-live/web/src/player.ts{start}

`create` に渡している `wasmWorker` と `wasmBinary` が、npm 版ならではの部分です。player の本体は WebAssembly で、web worker の中で動きます。その 2 つのファイルの URL を、こちらから教える必要があるんです。ファイルの先頭で `?url` を付けて import しているのがそれで、Vite がビルドにファイルを含めて、URL を返してくれます。

最初は消音で始めています。音が出る動画の自動再生は、ブラウザが止めることがあるからです。

### 「配信していない」は失敗じゃない

視聴ページは、配信が始まる前から開かれます。そのとき player が何を返すかというと、エラーです。種類は `ErrorNotAvailable`、コードは 404。

これを「再生に失敗しました」と出すのは違いますよね。まだ始まっていないだけです。

<<< @/examples/18-live/web/src/viewer.ts{view}

404 は「オフライン」、429 は「視聴者数の上限に達した」、それ以外は失敗。この判断を player から切り離して、ふつうの関数にしてあります。SDK を読み込まないので、ブラウザなしでテストできます。

オフラインのときは、しばらく待ってもう一度聞きにいきます。

<<< @/examples/18-live/web/src/viewer.ts{retry}

5 秒から始めて、倍にしていって、1 分で頭打ち。開いているタブの数だけこの問い合わせが飛ぶので、配信の 1 時間前から 1,000 人が待っている、という状況を考えると、固定の 1 秒間隔にはしたくありません。

### playback URL はビルドに埋めない

playback URL は、デプロイするまでわかりません。なので [06章](/ja/chapters/06-auth.md)と同じく、ページが起動するときに `/config.json` を読みます。

<<< @/examples/18-live/web/src/config.ts{config}

playback URL は秘密ではありません。視聴者のブラウザに渡すものなので。ただ、URL の中に AWS のアカウント ID が入っています。視聴者全員に見えるので、知っておいてください。

もう 1 つ、動かしてみて気づいたこと。player は再生の統計を `player.stats.live-video.net` へ送ります。Content Security Policy を書いているサイトに組み込むなら、playback のドメインと合わせて許可が要ります。
