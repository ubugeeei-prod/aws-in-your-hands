---
title: "68 Nitro: 手元で動かす"
---

# 68 Nitro: 手元で動かす

## 手元で動かす

<!-- section: 68.local -->

Nitro System のものは、手元では何も動きません。ハイパーバイザーも、エンクレーブも、KMS も、AWS の中にしかないからです。手元で動かすのは、親インスタンスとエンクレーブと KMS のあいだで、誰がどのバイト列を見られるかを写したモデルです。AWS のアカウントは要りません。

```bash
vp run nitro:demo
```

```text
PCR0 of the model image   23f63eab16c93e729ec3aed808d035b386c1063588b2cd537b7a7b7b15cd8a216e691570dccea78d03846d328d1e2494

parent asks the enclave to seal a note         sealed
parent asks the enclave to open it             "the note"
parent calls Decrypt with the same role        refused: kms:Decrypt: no statement allows this call
parent replays the enclave's document          answered
the same image in debug mode asks for a key    key-refused

Data keys issued: 1. In the parent's hands: none.
The note's text did pass through the parent. Only the key did not.
```

`refused` の行は、親がエンクレーブと同じロールで `Decrypt` を呼んで、拒否される場面です。その次の行では、親がエンクレーブの文書を横から写して付け直しています。KMS は答えますが、答えは文書の公開鍵に宛てた暗号文で、親には開けません。`key-refused` の行は、同じイメージをデバッグモードで起動したエンクレーブです。PCR0 が 0 になるので、鍵をもらえません。

モデルは 4 つの部品でできています。

1 つ目は、ハイパーバイザーの役です。イメージからエンクレーブを起動し、そのエンクレーブにだけ、文書を出す口を渡します。計測値を決めるのはイメージで、呼び出す側ではありません。

<<< @/examples/68-nitro/src/enclave/attestation.ts{hypervisor}

2 つ目は、KMS の役です。文書が付いていれば署名を確かめ、ポリシーを評価し、文書の公開鍵に宛てて答えます。

<<< @/examples/68-nitro/src/enclave/kms-model.ts{kms}

3 つ目は、キーポリシーの評価器です。

<<< @/examples/68-nitro/src/policy.ts{evaluate}

4 つ目が、エンクレーブと親です。エンクレーブは、起動のときに鍵の組を作り、前のページの `createVault` を動かします。親が持てるのは、バイト列を送って、バイト列を受け取る口だけです。

<<< @/examples/68-nitro/src/enclave/model.ts{enclave}

親の側は、手にしたバイト列をすべて記録します。エンクレーブとのやり取りも、エンクレーブのために中継した KMS とのやり取りもです。不変条件の判定は、その記録の中にデータキーがあるかどうかを見ます。

<<< @/examples/68-nitro/src/enclave/model.ts{invariant}

このモデルが本物と違うところを、はっきりさせておきます。

- 文書は JSON で、鍵 1 つで署名しています。本物は CBOR と COSE で、証明書の連なりが AWS のルート証明書までつながります
- PCR0 は、イメージの名前と版の文字列のハッシュです。本物はイメージファイルの中身から計算されるので、1 バイト変えれば値が変わります。モデルでは、版の文字列を変え忘れると同じ値になります
- `CiphertextForRecipient` は、公開鍵で直接暗号化したものです。本物の形式は別で、この章では扱っていません
- 評価器が読めるのは、`Allow` と `Deny`、省略のないプリンシパルとアクション、`Resource` が `"*"`、`StringEqualsIgnoreCase` と 2 種類の条件キーだけです。ワイルドカードや、ほかの演算子や条件キーに出会うと、制限なしと読む代わりに例外を投げます。IAM ポリシー、grant、SCP は知りません
- 本物の親は、KMS との通信を TLS のまま転送するので、中身を読めません。モデルの親は、平文で記録します。そのぶん、テストは厳しくなっています

評価器は KMS ではありません。この章のポリシーの形を読み違えていないか、条件を外したら結果が変わるかを確かめるためのものです。KMS が実際にどう答えるかは、[デプロイ](/ja/chapters/68-nitro/deploy.md)の手順でしか確かめられません。

テストは、不変条件を壊そうとします。

- 親が、エンクレーブと同じロールで `Decrypt` と `GenerateDataKey` を直接呼ぶ。拒否される
- 親が、中継のときに見えた文書を付け直して `Decrypt` を呼ぶ。暗号文しか返らない
- 親が、自分の鍵で署名した文書に正しい PCR0 を書いて出す。署名の検証で落ちる
- 親が、本物の文書の PCR0 だけを書き換える。署名が合わなくなる
- 親が、中身を変えたイメージからエンクレーブを起動する。PCR0 が違うので鍵をもらえない
- 親が、正しいイメージをデバッグモードで起動する。PCR0 が 0 なので鍵をもらえない
- 条件を書き忘れたポリシーにする。親が平文のデータキーを手にし、判定が破れる
- 鍵を外へ返してしまうイメージを、ポリシーに登録する。アテステーションは通り、判定が破れる

最後の 2 つは、破れることを確かめるテストです。判定が、破れた状態を本当に見つけられることを示しています。

そのほかのタスクは次のとおりです。

```bash
vp run test:unit
vp run nitro:names
vp run nitro:prices
vp run nitro:infra:synth
vp run nitro:infra:synth -c measurement=7fb5c55bc2ecbb68ed99a13d7122abfc0666b926a79d5379bc58b9445c84217f59cfdd36c08b2c79552928702efe23e4
```

`nitro:infra:synth` は、テンプレートを `examples/68-nitro/cdk.out/` に出します。AWS には問い合わせません。最後の行の値は、ドキュメントの例に載っている PCR0 です。スタックのテストは、合成したテンプレートのキーポリシーを同じ評価器に読ませて、文書なしでは拒否、0 の PCR0 でも拒否、指定した PCR0 でだけ許可、となることを確かめています。

手元では再現しないものがあります。ハイパーバイザーによる隔離、文書の本物の署名、KMS の本物の判定、vsock、エンクレーブの起動にかかる時間とメモリです。テストが通ることは、この章のポリシーと封印のコードが、モデルの上では書いたとおりに動く、ということしか示しません。
