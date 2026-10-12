---
title: "18 Live Streaming: 手元で動かす"
---

# 18 Live Streaming: 手元で動かす

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
