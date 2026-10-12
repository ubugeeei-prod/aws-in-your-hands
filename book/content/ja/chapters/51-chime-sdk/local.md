---
title: "51 Chime SDK: 手元で動かす"
---

# 51 Chime SDK: 手元で動かす

[前のページ](/ja/chapters/51-chime-sdk/build.md)で作った API とページを、AWS に触れずに動かします。手元で確かめられるのは、誰に席が渡るかという部分です。音声と映像は、手元では流れません。

## 手元で確かめられること

<!-- section: 51.local -->

テストと型検査は、認証情報なしで動きます。

```bash
vp test run examples/51-chime-sdk
vp run typecheck
vp run typecheck:calls:web
vp run lint:calls:web
vp run calls:infra:synth
```

テストは 69 件あります。認可（誰に join token が渡るか）、席の順序（割り込みと失敗を決まった位置で起こすもの）、テーブルの条件、Chime への呼び出しの形、ページの判断、スタックのアサーションです。

API を動かすには、設定の見本を写してから起動します。

```bash
cp examples/51-chime-sdk/.env.example examples/51-chime-sdk/.env
vp run dev:calls:api
```

サインインは 06章の開発用のもので、ユーザー名を送るとトークンが返ります。ミーティングの API は、前のページの模型が代わりを務めます。Chime への呼び出しは 1 回も起きません。

別の端末で、Alice として部屋を作り、Bob を入れて、Bob が席を取るところまでを試します。`<id>` には、1 つ目の応答に入っている部屋の ID を入れます。

```bash
B=http://localhost:8787
token() { curl -s -X POST $B/local/token -H 'content-type: application/json' -d "{\"user\":\"$1\"}" | jq -r .accessToken; }
ALICE=$(token alice); BOB=$(token bob)

curl -s -X POST $B/rooms -H "authorization: Bearer $ALICE"
ID=<id>
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/rooms/$ID/join -H "authorization: Bearer $BOB"
curl -s -o /dev/null -w '%{http_code}\n' -X PUT $B/rooms/$ID/members/local-bob -H "authorization: Bearer $ALICE"
curl -s -i -X POST $B/rooms/$ID/join -H "authorization: Bearer $BOB"
```

この章を書くときに実行した結果です。ID は実行のたびに変わります。join token の後ろは伏せ、日付と接続に関するヘッダーは省きました。

```text
{"id":"94d35dcd-51dc-4413-9a53-6770c8716c50","owner":"local-alice","members":["local-alice"],"seated":[]}
404
204
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:5193
cache-control: no-store
content-type: application/json
vary: Origin
x-request-id: b4e81f23-16a0-4d53-851f-1acaf397b511

{"meeting":{"MeetingId":"d96c471f-234e-421f-bd1e-30719d6aad9f","MediaRegion":"local","MediaPlacement":{"AudioHostUrl":"fake-media.invalid:3478","SignalingUrl":"wss://fake-media.invalid/control/d96c471f-234e-421f-bd1e-30719d6aad9f","TurnControlUrl":"https://fake-media.invalid/turn"}},"attendee":{"AttendeeId":"c83ed2d1-8f85-4fcb-bd47-eeb610c93044","ExternalUserId":"local-bob","JoinToken":"fake-join-token-<redacted>"}}
```

メンバーになる前の Bob には 404 が返り、入れてもらったあとは席が返ります。`access-control-allow-origin` が 5193 になっているのは、執筆時に 5173 番のポートが別の用途で使われていたので、ページを 5193 番で動かし、API の `ALLOWED_ORIGIN` もそれに合わせたためです。見本の設定のままなら 5173 になります。

ページも動かせます。

```bash
vp run dev:calls:web
```

`http://localhost:5173` を開き、ユーザー名でサインインし、部屋を作って「Join」を押すと、席を持っていることと、この API には接続先が無いことが表示されます。「Leave」で席が消えます。2 人ぶんを試すには、タブを 2 つ開いて、別々のユーザー名でサインインします。サインインの状態はメモリーにしか置いていないので、タブごとに別の利用者になれます。

### 手元では確かめられないこと

メディアの経路は、手元では一度も通りません。マイクとカメラの許可、音声の再生、映像のタイル、接続が切れたときの再接続、join token を実際のメディアサービスが受け付けるかどうかは、どれも AWS のミーティングが無いと動きません。模型が返す接続先は `.invalid` のホストで、ブラウザーがつなごうとしても名前の解決で止まります。

もう 1 つ、DynamoDB の条件式も手元では実行されません。手元の API は部屋をメモリーに置きます。

次は[デプロイ](/ja/chapters/51-chime-sdk/deploy.md)です。
