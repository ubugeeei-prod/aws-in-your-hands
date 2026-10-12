---
title: "09 SSR: デプロイ"
---

# 09 SSR: デプロイ

[手元で確かめた](/ja/chapters/09-ssr/local.md)ビルドを AWS に置き、キャッシュの境界が CloudFront でも守られていることを確かめます。

## デプロイして確かめる

<!-- section: 09.deploy -->

このページの手順は、まだ実際の AWS で通していません。手順とタスクは用意してあります。

初回は次の順で実行します。

```bash
vp run build:ssr
vp run ssr:infra:diff
vp run ssr:infra:deploy
vp run ssr:assets:plan
vp run ssr:assets:publish
```

`ssr:infra:deploy` は、いま `.output` にあるビルドをデプロイします。スタックを先に作るのは、アセットを置くバケットがまだないからです。そのため初回は、HTML が指す JavaScript が S3 にない状態が数十秒だけ生じます。

2 回目からは順番を逆にします。

```bash
vp run build:ssr
vp run ssr:assets:publish
vp run ssr:infra:deploy
```

新しいアセットを先に置いてから関数を入れ替えるので、新しい HTML が配られ始めた時点で、その HTML が指すファイルはもう S3 にあります。

<<< @/examples/09-ssr/scripts/asset-plan.ts{plan}

ハッシュ入りのファイルは、足すだけで上書きしません。古いビルドのファイルはすぐには消さず、7 日残します。残す理由は、このページの「許容する古さ」で説明します。

アセットを置いたら、動作を確かめます。

```bash
vp run ssr:smoke
```

<<< @/examples/09-ssr/scripts/smoke-spec.ts{spec}

確かめるのは次の 5 つです。

1. `/` を何度か開くと、レスポンスのヘッダーが `public, max-age=0, s-maxage=60` で、2 回目以降のどれかが CloudFront のキャッシュから返る
2. `/me` をでたらめなセッション cookie 付きと cookie なしで、`/me/api/viewer` を cookie 付きで、順に 3 回ずつ開いても、`private, no-store` で、一度もキャッシュから返らない
3. HTML が指す `/_nuxt/` のファイルが、`immutable` 付きで返る
4. function URL を直接開くと 403 が返る
5. POST は CloudFront が断る

2 が、この章の不変条件（invariant）を実環境で確かめる検査です。キャッシュから返ったかどうかは、レスポンスの `x-cache` ヘッダーと `age` ヘッダーで判定しています。CloudFront がこの 2 つを実際にどう返すかは、まだ確かめていません。

ドリフトの検査は 02章と同じです。

```bash
vp run ssr:infra:drift
```

## 許容する古さ

<!-- section: 09.stale -->

キャッシュは、古い内容を返す仕組みでもあります。速さと引き換えに、誰に、どれだけ古い内容を見せてよいかを、先に決めておく必要があります。

この章では次のように決めました。

- 公開ページ（`/`、`/notes/:id`、`/api/notes`）は、最大 60 秒古いものが、全員に届くことがある
- `/me` の下は、古いものを返さない。毎回 Lambda が答える

60 秒という値は `SHARED_SECONDS` の 1 か所にあり、アプリのヘッダーと CloudFront の `maxTtl` の両方がこの値から作られます。

```figure
caption: キャッシュはエッジロケーションごとに別々なので、新しいノートが見え始める時刻は読者によって違う
type: sequence
actor tokyo: 東京の読者
actor lambda: Lambda
actor london: ロンドンの読者
note lambda: t0 ノート "A" を公開 (デプロイ)
step tokyo -> lambda: t0+5 / を開く
step lambda --> tokyo: 描画する。キャッシュされる
step london -> lambda: t0+20 / を開く
step lambda --> london: 描画する。別のエッジにキャッシュされる
note lambda: t0+30 ノート "B" を公開 (デプロイ)
note tokyo: t0+40 再読み込み: まだ B がない
note london: t0+40 再読み込み: まだ B がない
step tokyo -> lambda: t0+65 再読み込み
step lambda --> tokyo: 描画する。B がある
step london -> lambda: t0+80 再読み込み
step lambda --> london: 描画する。B がある
```

キャッシュはエッジロケーションごとに別々です。そのため同じ瞬間に、東京の読者は新しい一覧を、ロンドンの読者は古い一覧を見ていることがあります。全員が同時に切り替わるとは言えません。言えるのは、どの読者も 60 秒を超えて古いものは見ない、ということまでです。

古い HTML が 60 秒残るなら、古い HTML が指す JavaScript も少なくとも 60 秒は必要です。タブを開いたままの人は、もっとあとになってから古いファイルを取りに来ます。`ssr:assets:publish` が古いビルドのファイルを 7 日残すのは、そのためです。HTML とアセットを別々の場所から配る構成では、この 2 つの寿命を合わせて考える必要があります。

60 秒を待てないときは、03章と同じ無効化（invalidation）が使えます。ただし無効化は、次のリクエストからオリジンに聞き直させる操作で、すべてのエッジで同時に効くことを保証するものではありません。

エラーもキャッシュされます。CloudFront は、オリジンが返した 404 や 5xx を既定で 10 秒保存します。アプリは 200 以外に `no-store` を付けていますが、その場合にこの 10 秒がどうなるのかは、ドキュメントからは読み切れませんでした。公開側には cookie が届かないので、保存されるとしても、誰のものでもないエラーページです。
