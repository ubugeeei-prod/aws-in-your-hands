---
title: "18 Live Streaming: IVS"
revision: 1
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

`authorized: false` は、「playback URL を知っていれば誰でも見られる」という意味です。この章の配信は公開です。見られる人を絞りたくなったら「本番にするなら」へ。

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

## 手元で確かめられること

<!-- section: 18.local -->

ライブ配信は、手元だけでは完結しません。映像を受ける場所が AWS にしかないからです。それでも、かなりの部分は手元で確かめられます。

```bash
vp run test:unit
vp run stream:infra:synth
vp run dev:stream:web
```

`dev:stream:web` で <http://localhost:5183> に視聴ページが立ち上がります。channel をまだ作っていないので、「No channel is configured」と出るだけです。それで正しい動きです。

テストが見ているのは、こういうところです。

| どこ | ファイル | 見ているもの |
| --- | --- | --- |
| channel の設定 | `test/channel.test.ts` | bitrate と解像度が type の上限に収まるか。サーバーの URL に鍵が混ざらないこと |
| 配信の状態 | `test/stream.test.ts` | 「オフライン」と「わからない」を混ぜないこと。入力時間の数え方 |
| イベント | `test/events.test.ts`、`test/timeline.test.ts` | イベントの形の検証。順序が入れ替わっても、重複しても、結論が変わらないこと |
| 視聴ページ | `web/src/viewer.test.ts` | 404 をオフラインとして扱うこと。再試行の間隔。設定の検証 |
| インフラ | `infra/test/live-stack.test.ts` | 鍵の値が template に現れないこと。権限、録画なし、削除の設定、リソースの種類 |

手元で再現しないものも、はっきりさせておきます。

- **実際の配信と視聴。** 映像が届くか、何秒遅れるか、player が本当に再生するか
- **IVS の API の実際の応答。** `GetStream` の応答とイベントの形は、ドキュメントの例をもとに schema を書いています
- **IAM。** script はあなたの権限で動きます
- **OBS の設定。** 手作業です

正直に言うと、この章は実機でまだ一度も配信していません。手元で確かめた範囲は章末にまとめました。

## 配信してみる

<!-- section: 18.broadcast -->

ここからは AWS のアカウントが要ります。そして、ここから料金が発生します。

```bash
vp run stream:infra:diff
vp run stream:infra:deploy
```

channel、stream key、イベントを受ける Lambda と rule ができます。この時点では、まだ何も流れていないので、IVS の料金はかかっていません。

### 配信ソフトの設定

OBS Studio を例にします。IVS のドキュメントは 30.2 以降を前提に書かれています。

```bash
vp run stream:key --show
```

1. OBS の Settings > Stream を開いて、Service に「Amazon IVS」を選ぶ
2. Stream Key に、いま表示された `sk_` で始まる値を貼る
3. Settings > Output で Output Mode を Advanced にして、Streaming タブの Keyframe Interval を 2 にする
4. Video Bitrate を、`stream:key` が表示した上限より低くする。720p なら 3,500 kbps 未満。余裕をみて 2,500 くらいから
5. Settings > Video の Output (Scaled) Resolution を 1280x720 にする
6. メイン画面で Start Streaming

Service の一覧に Amazon IVS がなければ、「Custom」を選んで、Server に `stream:key` が表示した `rtmps://...:443/app/` を入れます。

OBS を使わず、動画ファイルを FFmpeg で送る方法も、IVS のドキュメントに例があります。

### 見る

別の端末で、playback URL をページに渡して、開きます。

```bash
vp run stream:config
vp run preview:stream:web
```

`stream:config` は、ページをビルドして、stack の output から取った playback URL を `web/dist/config.json` に書きます。`preview:stream:web` がそれを <http://localhost:4183> で配ります。

配信を始めてから見えるようになるまで、少しかかります。ドキュメントによると、keyframe の間隔が 2 秒なら、6〜7 秒ほど。ページは「offline」のまま待って、自分で再接続します。

このページを人に見せるなら、`web/dist` を [03章](/ja/chapters/03-spa.md)の方法で S3 と CloudFront に置けば済みます。この章の stack には入れていません。レシピの主題は channel のほうなので。

### 終わったら、止める

OBS の Stop Streaming を押します。そして、次の節へ。

## 止まっている？

<!-- section: 18.status -->

この章でいちばん大事な節です。

IVS の入力の料金は、映像が送られている時間に対してかかります。料金ページの言葉をそのまま引くと、「IVS に送られたすべての stream は、視聴されていなくても、入力の料金がかかる」。視聴者が帰ったあとも、OBS が動いていれば、課金は続きます。

OBS のウィンドウを閉じたつもりが最小化だった。配信用の PC をそのままにして帰った。ありそうですよね。

だから、確かめます。

```bash
vp run stream:status --expect-offline
```

IVS に「いま配信中ですか」と聞いて、配信中なら何分経ったかを表示して、終了コード 1 で終わります。止まっていれば 0 です。

この「聞く」の中身が `GetStream` という API なのですが、応答の読み方に癖があります。

<<< @/examples/18-live/src/stream.ts{status}

配信していない channel に `GetStream` を呼ぶと、「オフラインです」という応答は返ってきません。`ChannelNotBroadcasting` という**エラー**が返ります。API リファレンスにも、「`OFFLINE` という state には頼らないこと。返らないことがある」と書いてあります。

ここで怖いのは、エラーを全部「オフライン」に丸めてしまうことです。権限が足りない、ネットワークが切れた、流量制限に当たった。どれもエラーですが、配信が止まっている証拠ではありません。「わからない」を「止まっている」と表示したら、この script の意味がなくなります。なので、`ChannelNotBroadcasting` だけをオフラインと読んで、ほかは例外にしています。テストもそこを見ています。

`viewerCount` にも小さな癖があって、数え終わらなかったときは `-1` が返ります。「視聴者 -1 人」と出さないように、`null` に直しています。

### 止まらないとき

OBS に手が届かないなら、API で切れます。

```bash
vp run stream:stop
```

ただし、多くの配信ソフトは、切られると自動で再接続します。`StopStream` のドキュメントにも、そう注意書きがあります。確実に止めたいなら、鍵を取り上げます。

```bash
vp run stream:infra:deploy -c streamKey=off
vp run stream:stop
vp run stream:status --expect-offline
```

鍵を消してから切れば、再接続は通りません。

ちなみに、IVS の側にも歯止めが 2 つあります。配信ソフトからのデータが 30 秒途絶えると、IVS が切断します。そして 1 本の stream は最長 48 時間です。ただ、48 時間で切れても、再接続する設定の配信ソフトは新しい stream を始めます。当てにはできません。

## 状態の変化を受け取る

<!-- section: 18.events -->

「配信が始まったら通知したい」「終わったら何かしたい」となったら、毎秒 `GetStream` を呼ぶ……のではなく、IVS が EventBridge に送るイベントを受けます。

<<< @/examples/18-live/infra/lib/live-stack.ts{events}

rule は、`aws.ivs` から来たイベントのうち、この channel のものだけを Lambda に渡します。Lambda の権限は、自分の log group に書くことだけ。IVS の権限は持たせていないので、この関数は stream key を読めません。

届いたイベントは、まず形を確かめます。

<<< @/examples/18-live/src/events.ts{schema}

`event_name` を enum にせず、ただの文字列にしているのはわざとです。イベントの種類は、こちらの知らないうちに増えるかもしれません。知らない名前が来たら落とすのではなく、記録して先に進みたい。

形が合わないイベントでも、関数は失敗させません。

<<< @/examples/18-live/src/handler.ts{handle}

形が合わないのは、何度やり直しても合いません。ログに残して、正常に終わります。

### イベントは「だいたい届く」

さて、ここからが本題です。IVS のドキュメントは、イベントについてこう言っています。best effort で送る。つまり、

- 届かないことがある
- 数時間遅れて届くことがある
- 順序が入れ替わることがある。「Stream End が Stream Start より先に届く」こともある

めったに起きない、とも書いてあります。でも、起きたときに「配信中」の表示が永遠に消えないアプリは困りますよね。

なので、届いたイベントから「いま配信中か」を組み立てる関数を、**順序に頼らない**形で書きました。

<<< @/examples/18-live/src/timeline.ts{belief}

やっていることは単純です。stream ごとに、「どの名前のイベントを見たか」の集合を作る。終わりのイベントを見ていれば、その stream は終わり。集合なので、届いた順番も、同じイベントが 2 回届いたことも、結果に影響しません。

終わりを「最終」として扱えるのは、stream の ID が使い回されないからです。channel が配信を始めるたびに、新しい `stream_id` が付きます。だから、「終わりのあとに始まりが届いた」ら、それは遅れて届いた昔の始まりであって、復活ではありません。

テストでは、4 つのイベントを 24 通りすべての順序で流して、結論が変わらないことを確かめています。

それでも、**届かなかったイベント**はどうしようもありません。終わりのイベントが消えたら、この関数は「配信中」と言い続けます。そこで、答え合わせをします。

<<< @/examples/18-live/src/timeline.ts{reconcile}

```bash
vp run stream:status --events
```

`GetStream` の答えと、ログに残ったイベントから組み立てた見立てを並べて、食い違っていれば、どちらを信じるかを表示します。信じるのは `GetStream` です。

設計の指針として持ち帰ってほしいのはここです。イベントは「何かが変わったらしい」という合図。状態の持ち主は IVS で、いまの状態は IVS に聞く。イベントだけで状態を組み立てて、それを正とするアプリは、イベントが 1 つ消えた日に壊れます。

## 視聴者ごとに「いま」が違う

<!-- section: 18.latency -->

ライブ配信には、分散システムとしておもしろい性質があります。**全員が同じ映像を見ているのに、同じ瞬間を見ていない**んです。

```figure
caption: 知らせは chat で 2 人に同時に届き、ゴールの映像は視聴者ごとに違う遅れで届く（時刻は説明のための作り物で、測った値ではない）
type: sequence
actor cam: カメラ
actor chat: chat | 別の経路
actor a: 視聴者 A | desktop
actor b: 視聴者 B | iOS の browser
step cam -> cam: 12:00:00 ゴールが決まる
step chat -> a: 12:00:00 "GOAL!"
step chat -> b: 12:00:00 "GOAL!"
step cam -> a: 12:00:03 ゴールの映像
step cam -> b: 12:00:08 ゴールの映像
```

A さんと B さんで遅延が違うのは、珍しいことではありません。ドキュメントによれば、遅延は配信者と視聴者の場所、回線、途中の部品で変わります。それに、iOS のブラウザは低遅延の再生に対応していなくて、通常の遅延になります。同じ配信を、同じ部屋で、PC と iPhone で開くと、ずれて聞こえるはずです。

視聴ページには、その視聴者の遅延を表示するようにしてあります。player の `getLiveLatency()` が返す値で、「サーバーから player まで」の遅延です。カメラからサーバーまでは含みません。

これが効いてくるのは、映像と**別の経路**で届くものを組み合わせたときです。チャット、投票の結果、スコアの表示、「配信が終わりました」の通知。図のとおり、チャットの「GOAL!」は、映像より先に全員へ届きます。ネタバレです。しかも、どれだけ先に届くかは視聴者ごとに違うので、サーバー側で「3 秒待ってから送る」と決めても、全員には合いません。

invariant として書くなら、こうです。**別の経路で届くものが、映像のどの場面と同時に見えるかは、保証されない。** 同期している前提で画面を作らないこと。

### 映像と一緒に届けたいもの

「クイズの問題を、映像のその場面で全員に出したい」のように、どうしても映像と合わせたいものには、IVS に専用の仕組みがあります。**timed metadata** です。

小さなデータ（1 KB まで）を `PutMetadata` で送ると、IVS が映像の中に埋め込みます。視聴者には、映像のその位置を再生したときに届く。遅延が 3 秒の人には 3 秒後、8 秒の人には 8 秒後。それぞれにとっての「同じ場面」で届くわけです。

視聴ページは、届いた timed metadata をそのまま表示します（`player.ts` の `TEXT_METADATA_CUE`）。配信中に、ドキュメントにある CLI のコマンドで試せます。

```bash
aws ivs put-metadata --channel-arn <ChannelArn> --metadata '{"question":"..."}'
```

ただし、万能ではありません。ドキュメントにあるとおり、送ってから埋め込まれるまでの時間に保証はなく、1 つの channel に毎秒 5 回まで、配信中にしか送れません。チャットの代わりにはなりません。「映像のこの場面で」と言いたいものだけに使います。

このコマンドと、ページでの表示は、実機では確かめていません。

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
