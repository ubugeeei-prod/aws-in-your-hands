---
title: "09 SSR: デプロイ"
---

# 09 SSR: デプロイ

## デプロイして確かめる

<!-- section: 09.deploy -->

ここから先は、まだ実際の AWS で通せていません。手順とタスクは用意してあります。

初回はこの順です。

```bash
vp run build:ssr
vp run ssr:infra:diff
vp run ssr:infra:deploy
vp run ssr:assets:plan
vp run ssr:assets:publish
```

`ssr:infra:deploy` は、いま `.output` にあるビルドをデプロイします。先に stack を作るのは、asset を置く bucket がまだないからです。この数十秒だけ、HTML が指す JavaScript が S3 にない状態になります。

2 回目からは、順番を逆にします。

```bash
vp run build:ssr
vp run ssr:assets:publish
vp run ssr:infra:deploy
```

先に新しい asset を置いて、そのあとで関数を入れ替えます。新しい HTML が配られ始めたときには、それが指すファイルはもう S3 にあります。

<<< @/examples/09-ssr/scripts/asset-plan.ts{plan}

hash 入りのファイルは、足すだけで上書きしません。古いビルドのファイルは、すぐには消さずに 7 日残します。なぜ残すのかは、次の節で。

置けたら、確かめます。

```bash
vp run ssr:smoke
```

<<< @/examples/09-ssr/scripts/smoke-spec.ts{spec}

見ているのは 5 つです。

1. `/` を何度か開くと、応答のヘッダーが `public, max-age=0, s-maxage=60` で、2 回目以降のどれかが CloudFront の cache から返る
2. `/me` と `/me/api/viewer` を、でたらめな session cookie 付きと cookie なしで交互に何度開いても、`private, no-store` で、一度も cache から返らない
3. HTML が指す `/_nuxt/` のファイルが、`immutable` 付きで返る
4. function URL を直接開くと 403 が返る
5. POST は CloudFront が断る

2 が、この章の invariant を実環境で見る検査です。cache から返ったかどうかは、応答の `x-cache` ヘッダーと `age` ヘッダーで判定しています。CloudFront が実際にこの 2 つをどう返すかは、まだ自分の目で見ていません。

drift の検査は、02章と同じです。

```bash
vp run ssr:infra:drift
```

## 誰に、どれだけ古いものを見せるか

<!-- section: 09.stale -->

cache は、古い内容を返す仕組みでもあります。速さと引き換えに、誰に、どれだけ古いものを見せることを許すのか。決めておきましょう。

この章の答えはこうです。

- 公開ページ（`/`、`/notes/:id`、`/api/notes`）は、最大 60 秒古いものが、全員に届くことがある
- `/me` の下は、古いものを返さない。毎回 Lambda が答える

60 秒という数字は 1 か所（`SHARED_SECONDS`）にあって、アプリのヘッダーと、CloudFront の `maxTtl` の両方がそこから作られます。

```figure
caption: cache は edge location ごとに別々なので、新しいノートが見え始める時刻は読者によって違う
type: sequence
actor tokyo: 東京の読者
actor lambda: Lambda
actor london: ロンドンの読者
note lambda: t0 ノート "A" を公開 (deploy)
step tokyo -> lambda: t0+5 / を開く
step lambda --> tokyo: 描画する。cache される
step london -> lambda: t0+20 / を開く
step lambda --> london: 描画する。別の edge に cache される
note lambda: t0+30 ノート "B" を公開 (deploy)
note tokyo: t0+40 再読み込み: まだ B がない
note london: t0+40 再読み込み: まだ B がない
step tokyo -> lambda: t0+65 再読み込み
step lambda --> tokyo: 描画する。B がある
step london -> lambda: t0+80 再読み込み
step lambda --> london: 描画する。B がある
```

cache は edge location ごとに別々です。同じ瞬間に、東京の読者は新しい一覧を、ロンドンの読者は古い一覧を見ていることがあります。全員が同時に切り替わる、とは言えません。言えるのは、「どの読者も、60 秒を超えて古いものは見ない」までです。

古い HTML が 60 秒残るということは、古い HTML が指す JavaScript も、少なくとも 60 秒は要るということです。タブを開きっぱなしの人は、もっと長く古いファイルを取りに来ます。`ssr:assets:publish` が古いビルドのファイルを 7 日残すのは、そのためです。HTML と asset を別々の場所から配る構成では、この 2 つの寿命をそろえて考える必要があります。

待てないときは、03章と同じ invalidation が使えます。ただし、それは「次のリクエストから origin に聞き直す」であって、全部の edge で同時に効く保証ではありません。

エラーにも cache があります。CloudFront は、origin が返した 404 や 5xx を、既定で 10 秒保存します。アプリは 200 以外に `no-store` を付けていますが、その場合に 10 秒がどうなるのかは、ドキュメントからは読み切れませんでした。公開側には cookie が届かないので、保存されるとしても、誰のものでもないエラーページです。
