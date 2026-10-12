---
title: "51 Chime SDK: 費用、注意点、片付け"
---

# 51 Chime SDK: 費用、注意点、片付け

この章の最後のページです。通話の料金を計算し、録画と文字起こしという選択肢、つまずきやすい点、本番で足すものを確かめてから、作ったものを片付けます。

## 料金

<!-- section: 51.cost -->

金額は USD、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

Chime SDK のミーティングの料金は、アテンディーが接続している時間で決まります。東京リージョンの単価は、アテンディー 1 人 1 分あたり 0.0017 です（AWS Price List、2026-10-13 確認）。料金ページによると、音声だけでも映像つきでも単価は同じで、6 秒単位で計算され、最短は 6 秒です。映像を 1080p まで上げる high definition のセッションは別の単価で、この章では使いません。

**使っていないとき。** ミーティングもアテンディーも、作っただけでは課金されません。課金されるのは接続です。スタックのほかの部分にも、時間で課金されるものはありません。残るのは、テーブルに入っている部屋の数 KB と、7 日で消えるログの保存料くらいです。無料枠については、料金ページに WebRTC のメディアの無料枠は載っていなかったので、差し引いていません。

**使ったとき。** 仮定を 2 つ置いて計算しました。

| 仮定 | アテンディーの分 | 月額 |
| --- | ---: | ---: |
| 2 人で 1 時間を、月に 8 回 | 960 | 1.63 |
| 5 人で 30 分を、月に 20 回 | 3,000 | 5.10 |

どちらも、全員が最初から最後まで接続している前提です。API Gateway、Lambda、DynamoDB、Cognito の料金は含めていません。

**閉じ忘れたとき。** ミーティングは、誰かが接続しているあいだは終わりません。通話のあとでタブを 1 つ開いたままにすると、そのタブは接続を続け、ミーティングが上限の 24 時間に達するまでの 1,440 分が課金されます。金額は 2.45 です。18章の IVS の止め忘れに比べれば小さい額ですが、部屋の数だけ起こりえます。部屋を閉じる操作（`DELETE /rooms/{id}`）は `DeleteMeeting` を呼ぶので、全員の接続が切れ、課金も止まります。

**消したあと。** スタックを消すと、Chime SDK の料金が発生する道は残りません。ただし、消す前に始まっていたミーティングは、スタックと一緒には消えません。片付けの節で扱います。

## 録画と文字起こし

<!-- section: 51.options -->

ミーティングに足せるものを、この章では使いませんが、何があるかだけ書いておきます。どれもドキュメントを読んだだけで、動かしてはいません。

**録画**は、media pipelines という別の API で行います。メディアキャプチャのパイプラインが、ミーティングの音声と映像を 5 秒ごとの断片として S3 のバケットに保存します。断片を 1 本のファイルにつなぐのは、連結（concatenation）という別のパイプラインです。どちらも、アテンディーの料金とは別に、分単位で課金されます。ドキュメントは、録画が通信の録音に関する法律の対象になりうること、参加者への通知と同意の取得は作る側の責任であることを、はっきり書いています。

**文字起こし**は、`StartMeetingTranscription` で始めます。Chime SDK が、いま話している上位 2 人の音声を Amazon Transcribe へ送り、結果はデータメッセージとして参加者に届きます。Amazon Transcribe の通常の料金がかかります。もう 1 つ知っておくことがあります。Amazon Transcribe は、既定では、処理した音声を AWS の AI サービスの改善に使うことがあります。止めるには、AWS Organizations でオプトアウトのポリシーを設定します。通話の音声を外に出したくないアプリでは、文字起こしを入れる前に確かめてください。

このほか、Chime SDK にはチャットのためのメッセージングと、電話網につなぐ PSTN 音声があり、それぞれ別の API と別の料金です。

## つまずきやすい点

<!-- section: 51.failures -->

**`POST /rooms/{id}/join` が 503 `media_unavailable` を返す。** Chime の呼び出しが、見つからない以外の理由で失敗しています。関数のログに、原因の例外の名前が 1 行出ます。`ThrottlingException` なら、アカウントの毎秒 10 リクエストの上限に当たっています。このとき join token は渡っておらず、席も記録されていません。

**409 `join_in_progress` が返る。** 同じ利用者が複数の場所から同時に参加しようとして、3 回続けて負けました。もう一度押せば通ります。

**参加した直後に「The call has ended.」と出る。** ライブラリーが `MeetingEnded` を報告しています。席を受け取ってから接続するまでのあいだに、ミーティングが終わりました。部屋の持ち主が閉じたか、全員が抜けて 5 分経ったかのどちらかです。もう一度参加すると、API が新しいミーティングを作ります。

**「This seat was taken over somewhere else」と出る。** 同じ join token で、別の場所から接続されました。自分で別のタブを開いたのでなければ、join token が漏れています。参加し直せば、古いほうは無効になります。

**マイクの許可を求める表示が出ない。** ページが安全なコンテキストで開かれていません。`getUserMedia` は、HTTPS か `localhost` でしか使えません。`http://192.168.x.x:4173` のように、同じネットワークの別の端末から開くと動きません。

**サインインはできるのに、API がすべて失敗する。** ページを開いているオリジンが `http://localhost:4173` ではありません。スタックの CORS と、ユーザープールのコールバック URL は、このオリジンだけを許可しています。

**接続中のまま進まない。** 利用者のネットワークが、Chime のメディアサービスへの通信を止めているかもしれません。ドキュメントによると、行き先は `*.chime.aws` で、ポートは TCP の 443 と UDP の 3478 です。UDP が通らなければ TLS に切り替わると書かれていますが、この章では確かめていません。

## 本番にするなら

<!-- section: 51.production -->

**黙って消えた参加者を片付ける。** この章の API は、ブラウザーが退出を伝えてこなかった場合を検知しません。Chime SDK は、ミーティングのイベントを EventBridge、SNS、SQS へ送れます。接続が切れると `chime:AttendeeDropped` が、ふつうに抜けると `chime:AttendeeLeft` が届くので、それを受けてアテンディーを消す関数を足せます。ドキュメントは、パケットが 10〜15 秒届かないと切断とみなすことと、ネットワークの切り替えでは切断と参加が続けて起きることを説明しています。切れた直後に消すと、戻ってこようとした人まで締め出すので、少し待ってから消す設計になります。

**関数が触れるミーティングを絞る。** [しくみと実装のページ](/ja/chapters/51-chime-sdk/build.md)に書いたとおり、タグと条件キーで、このアプリが作ったミーティングだけに権限を限れます。

**ページを HTTPS で配る。** この章のページは `localhost` でしか動きません。ほかの人に使ってもらうには、03章と 06章のやり方で S3 と CloudFront に置き、そのオリジンをスタックの CORS とコールバック URL に足します。

**上限に備える。** 毎秒 10 リクエストの上限は、通話の開始時刻に人が集まると届きます。引き上げを申請するか、参加のリクエストを少しずつ遅らせるかを、[32章](/ja/chapters/32-limits.md)の考え方で決めます。

**メディアリージョンを選ぶ。** 参加者が東京から遠いなら、`-c mediaRegion=us-west-2` のように、メディアだけを近いリージョンに置けます。参加者ごとに違うなら、部屋を作る人のブラウザーで、いちばん近いリージョンを調べて渡す方法があります。

**録画や文字起こしを入れるなら、先に同意の取り方を決める。** 技術の問題より前に、参加者に何を知らせるかの問題です。

**アクセストークンの寿命を考える。** API Gateway は、取り消されたアクセストークンを、期限が切れるまで受け付けます（06章）。部屋から外すことは、テーブルを見るのですぐに効きます。利用者そのものを止めたいときは、名簿から外すほうが確実です。

## 片付け

<!-- section: 51.cleanup -->

スタックを消す前に、動いているミーティングを終わらせます。ミーティングはスタックのリソースではなく、ID はテーブルの中にしかないので、テーブルを先に消すと、止める手段が無くなります。

```bash
vp run calls:end
vp run calls:end --yes
```

1 行目は、ミーティングの ID が記録されている部屋を一覧するだけです。`--yes` を付けると、それぞれに `DeleteMeeting` を呼びます。記録されているミーティングが、すでに自分で終わっていることもあります。その場合も、削除は成功として扱います。

そのあとで、ユーザーとスタックを消します。

```bash
vp run calls:user:delete alice@example.com
vp run calls:user:delete bob@example.com
vp run calls:infra:destroy
```

ユーザープール、テーブル、関数、API、ロググループが消えます。ユーザーはユーザープールと一緒に消えるので、`calls:user:delete` は省いても構いません。

`calls:end` を飛ばしてスタックを消した場合でも、ミーティングは、全員が切断してから 5 分で終わります。誰かが接続したままなら、24 時間の上限まで続きます。テーブルが無くなったあとでは、ミーティングの ID を知る方法がありません。接続しているブラウザーを閉じるのが、残された方法です。

残るのは、cdkd の bootstrap で作った保存場所（02章）と、手元の `web/dist/config.json` です。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 69 件（誰に join token が渡るか、席の順序と失敗の再現、メモリー上のテーブルの条件、DynamoDB と Chime への呼び出しの形、ページの判断、スタックのアサーション）。席の処理を 6 通りに壊して、それぞれテストが落ちることも確かめました（記録の失敗を無視して join token を返す、退出で `DeleteAttendee` を呼ばない、再参加で古い席を消さない、閉じる前に印を付けない、競争に負けたミーティングを消さない、負けたアテンディーを消さない）。型検査（サンプル全体と、Vize によるページ）。テンプレートの lint。`calls:infra:synth`（esbuild のバンドル込み。AWS への問い合わせなし）と、できたバンドルを Node.js で読み込めること。ページのビルド。開発用の API を起動して、[手元で動かすのページ](/ja/chapters/51-chime-sdk/local.md)の curl の流れを実行したこと。開発用のページをブラウザーで開き、サインイン、部屋の作成、参加、退出、部屋を閉じる操作が画面に反映されることと、`amazon-chime-sdk-js` を含むモジュールがブラウザーで読み込めること。ポートの 5173 番が別の用途で使われていたので、ページは 5193 番で動かしました。

**まだ確かめていないこと。** 実際の通話は、一度も行っていません。`calls:infra:diff`、`deploy`、`drift`、`destroy`、`calls:user:create`、`calls:config`、`calls:end` は AWS に対して実行していません。具体的には、次のことが未確認です。Chime の API の実際の応答の形（テストの応答は、API リファレンスの構文から手で書いたものです）。`GetMeeting` と `CreateAttendee` が、終わったミーティングに `NotFoundException` を返すこと。IAM のポリシーが 5 つの呼び出しを通すこと、とくにメディアリージョンを東京以外にしたときに、ミーティングの ARN に入るリージョンがどちらになるか。DynamoDB が条件式を受け付け、書いたとおりに働くこと。ブラウザーでのマイクとカメラ、音声の再生、映像のタイル、再接続。同じ join token での 2 台目の接続、`DeleteAttendee` のあとの切断、`DeleteMeeting` のあとの切断が、ライブラリーにどの状態コードとして届くか（ページの文言は、ライブラリーの型定義のコメントに基づきます）。タブを閉じたあと、アテンディーの課金がいつ止まるか。料金の表は、Price List の単価と仮定を掛けた計算です。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 部屋とメンバー | `examples/51-chime-sdk/api/src/room-store.ts`、`rooms.ts`、`app.ts`、`contract.ts`、`api/test/authorization.test.ts` | `test:unit` |
| 席を渡す、席を取り上げる | `examples/51-chime-sdk/api/src/rooms.ts`、`api/test/seats.test.ts`、`api/test/harness.ts` | `test:unit` |
| テーブルの条件 | `examples/51-chime-sdk/api/src/dynamodb-room-store.ts`、`api/test/dynamodb-room-store.test.ts`、`api/test/room-store.test.ts` | `test:unit` |
| Chime を呼ぶ部分 | `examples/51-chime-sdk/api/src/meetings.ts`、`chime-meetings.ts`、`fake-meetings.ts`、`api/test/chime-meetings.test.ts` | `test:unit` |
| スタック | `examples/51-chime-sdk/infra/lib/calls-stack.ts`、`infra/bin/app.ts`、`infra/test/calls-stack.test.ts`、`api/src/lambda.ts` | `test:unit`、`calls:infra:synth` |
| ブラウザーのページ | `examples/51-chime-sdk/web/src/session.ts`、`call.ts`、`config.ts`、`App.vue`、`call.test.ts` | `dev:calls:web`、`build:calls:web`、`typecheck:calls:web`、`lint:calls:web` |
| 手元で確かめられること | `examples/51-chime-sdk/api/src/dev.ts`、`.env.example` | `dev:calls:api`、`dev:calls:web` |
| デプロイして通話する | `examples/51-chime-sdk/scripts/write-config.ts`、`scripts/user.ts` | `calls:infra:deploy`、`calls:user:create`、`calls:config`、`preview:calls:web` |
| 料金 | `data/pricing/`、`tools/src/pricing/calc.ts` | `test:unit` |
| 片付け | `examples/51-chime-sdk/scripts/end-meetings.ts` | `calls:end`、`calls:infra:destroy` |

**cdkd がこのスタックのリソースをどう扱うか。** 固定した版（0.296.28）の npm の tarball で、`src/provisioning/register-providers.ts` にあたる部分を読みました。`AWS::ApiGatewayV2::Api`、`Authorizer`、`Integration`、`Route`、`Stage`、`AWS::Cognito::UserPool`、`AWS::DynamoDB::Table`、`AWS::IAM::Policy`、`AWS::IAM::Role`、`AWS::Lambda::Function`、`AWS::Lambda::Permission`、`AWS::Logs::LogGroup` には専用の実装があります。`AWS::Cognito::UserPoolClient` と `AWS::Cognito::UserPoolDomain` には無く、Cloud Control API 経由です（06章と同じ）。`AWS::Chime` で始まる種類は登録されていませんが、このスタックは使いません。

**一次情報**（確認日はすべて 2026-10-13）

- Amazon Chime の終了: [Update on Support for Amazon Chime](https://aws.amazon.com/blogs/messaging-and-targeting/update-on-support-for-amazon-chime/)、[What is Amazon Chime?](https://docs.aws.amazon.com/chime/latest/ag/what-is-chime.html)（管理者ガイドの告知。終了日を過ぎた 2026-10-13 に読んだ時点でも、文面は未来形のままでした）
- [What is the Amazon Chime SDK?](https://docs.aws.amazon.com/chime-sdk/latest/dg/what-is-chime-sdk.html)、[Using the Amazon Chime SDK](https://docs.aws.amazon.com/chime-sdk/latest/dg/meetings-sdk.html)、[Creating meetings](https://docs.aws.amazon.com/chime-sdk/latest/dg/create-mtgs.html)、[How meetings use WebRTC media](https://docs.aws.amazon.com/chime-sdk/latest/dg/webrtc-media.html)、[client libraries](https://docs.aws.amazon.com/chime-sdk/latest/dg/mtgs-sdk-client-lib.html)
- リージョンと上限: [Using meeting Regions](https://docs.aws.amazon.com/chime-sdk/latest/dg/chime-sdk-meetings-regions.html)、[Available AWS Regions](https://docs.aws.amazon.com/chime-sdk/latest/dg/sdk-available-regions.html)、[Amazon Chime SDK endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/chime-sdk.html)
- API: [CreateMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateMeeting.html)、[GetMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_GetMeeting.html)、[DeleteMeeting](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_DeleteMeeting.html)、[CreateAttendee](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_CreateAttendee.html)、[Attendee](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_Attendee.html)、[DeleteAttendee](https://docs.aws.amazon.com/chime-sdk/latest/APIReference/API_meeting-chime_DeleteAttendee.html)、[名前空間の移行](https://docs.aws.amazon.com/chime-sdk/latest/dg/meeting-namespace-migration.html)（`ListMeetings` が無いこと）
- [meeting lifecycle events](https://docs.aws.amazon.com/chime-sdk/latest/dg/using-events.html)、[Configuring your network](https://docs.aws.amazon.com/chime-sdk/latest/dg/network-config.html)、[media pipelines](https://docs.aws.amazon.com/chime-sdk/latest/dg/media-pipelines.html)、[live transcription](https://docs.aws.amazon.com/chime-sdk/latest/dg/meeting-transcription.html)
- IAM: [Service Authorization Reference の JSON（Amazon Chime）](https://servicereference.us-east-1.amazonaws.com/v1/chime/chime.json)。HTML のページは JavaScript なしでは表示されなかったので、元になっている JSON を読みました
- CloudFormation: [resource and property types reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-template-resource-type-ref.html)（Chime SDK が無いこと）
- 料金: [Amazon Chime SDK Pricing](https://aws.amazon.com/chime/chime-sdk/pricing/)、AWS Price List bulk API: [Amazon Chime、東京](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonChime/current/ap-northeast-1/index.json)、[IVS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonIVS/current/index.json)、[Amazon IVS Pricing](https://aws.amazon.com/ivs/pricing/)
- IVS: [What is Amazon IVS Real-Time Streaming?](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html)、[Amazon IVS endpoints and quotas](https://docs.aws.amazon.com/general/latest/gr/ivs.html)
- パッケージ: [amazon-chime-sdk-js 3.32.0](https://www.npmjs.com/package/amazon-chime-sdk-js/v/3.32.0)（README、型定義、`MeetingSessionConfiguration.js`）、[@aws-sdk/client-chime-sdk-meetings 3.1149.0](https://www.npmjs.com/package/@aws-sdk/client-chime-sdk-meetings/v/3.1149.0)、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare: [Realtime の概要](https://developers.cloudflare.com/realtime/)、[Realtime SFU の料金](https://developers.cloudflare.com/realtime/sfu/pricing/)
- Vercel: [Publish and subscribe to realtime data on Vercel](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel)
- MDN: [Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)

一次情報で確かめられなかった点を挙げます。`ClientRequestToken` を同じ値で 2 回送ったときの `CreateMeeting` の応答は、リファレンスに書かれていません。`ExternalUserId` は「冪等性のトークン」とも説明されていますが、同じ値で 2 回 `CreateAttendee` を呼んだときに何が起きるかは読み取れなかったので、この章のコードはどちらにも頼っていません。join token に時間の期限があるかどうかは、「ミーティングの終了か `DeleteAttendee` で失効する」という記述以外に見つけていません。接続しているアテンディーがいない時間が 5 分続いたときにミーティングが終わることは作成の手順のページに、クライアントライブラリーの README には「音声の接続が無い時間が 5 分を超えたとき」とあり、言い方が少し違います。Vercel に WebRTC のメディアのサービスが無いことは、ドキュメントの目次とガイドに記述が見当たらなかった、という確認にとどまります。Cloudflare の RealtimeKit の料金は、取得したページに表が文字として含まれていなかったので引用していません。`amazon-chime-sdk-js` が依存する `protobufjs` にはインストール時のスクリプトがあり、pnpm はそれを実行していません。ビルドと読み込みは通りましたが、通話での影響は確かめていません。

:::
