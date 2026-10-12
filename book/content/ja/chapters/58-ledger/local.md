---
title: "58 Ledger: 手元で動かす"
---

# 58 Ledger: 手元で動かす

[しくみと実装](/ja/chapters/58-ledger/build.md)で書いた台帳を、手元で動かします。AWS の認証情報は要りません。料金もかかりません。

## 書き換えを再現する

<!-- section: 58.local -->

```bash
vp run ledger:demo
```

`scripts/demo.ts` は、30章のメモリ上のテーブルと、前のページで書いたバケットのモデルの上で、追記、ダイジェスト、書き換え、監査を順に実行します。次は、その出力です。

```text
append 1 to 4
  1  prev 000000000000  hash 7b6cf94ab47f  {"type":"note.updated","noteId":"n1","actor":"user-1","version":1}
  2  prev 7b6cf94ab47f  hash 3c5d6ea932a0  {"type":"note.updated","noteId":"n1","actor":"user-1","version":2}
  3  prev 3c5d6ea932a0  hash 43b831f1e561  {"type":"note.updated","noteId":"n1","actor":"user-1","version":3}
  4  prev 43b831f1e561  hash 55f68d58c945  {"type":"note.updated","noteId":"n1","actor":"user-1","version":4}

digest: {"kind":"written","digest":{"ledger":"notes","seq":4,"hash":"55f68d58c9450501bbae7cdcd1d5715afe1ec65d427dbe28ca2db26ed5725595","at":"2026-10-13T09:05:00.000Z"}}

append 5 and 6
  5  prev 55f68d58c945  hash de63561ff98f  {"type":"note.updated","noteId":"n1","actor":"user-1","version":5}
  6  prev de63561ff98f  hash 44570f14cb62  {"type":"note.updated","noteId":"n1","actor":"user-1","version":6}

audit, untouched
  entries 6, digests 1, not yet covered 2
  no findings

audit, after entries 2 to 6 were rewritten consistently
  entries 6, digests 1, not yet covered 2
  findings:
    {"kind":"digest_mismatch","seq":4,"versionId":"v1"}

delete the digest version, without the bypass permission: locked
```

各行の `prev` が、1 つ上の行の `hash` と同じ値になっています。4 件目まで書いたところでダイジェストを取り、さらに 2 件を足しました。最初の監査は何も見つけず、5 件目と 6 件目がまだどのダイジェストにも入っていないことを `not yet covered 2` で伝えています。

そのあと、2 件目の `actor` を別の人に書き換え、6 件目までのハッシュをすべて計算し直しました。テーブルの中に矛盾はありません。監査は、4 件目のハッシュがロックされたダイジェストと違うことを見つけます。最後の行は、権限なしでダイジェストのバージョンを消そうとして、モデルに断られたところです。

時刻は固定してあるので、何度実行しても同じハッシュが出ます。

### DynamoDB Local で確かめる

PartiQL の `INSERT` と `Query` を実際に DynamoDB の API に送るところは、DynamoDB Local で確かめられます。

```bash
cp examples/58-ledger/.env.example examples/58-ledger/.env
vp run db:local:start
vp run ledger:db:migrate:local
vp run ledger:test:local
```

`db:local:start` は、05章のタスクです。Docker の daemon が必要で、Nix の shell には含まれていません。`ledger:db:migrate:local` は、同じ DynamoDB Local の中に、この章のテーブルを作ります。接続先が手元のアドレスでなければ、タスクは何もせずに終わります。

Docker が無い場合は、AWS が配布している jar を Java で直接起動しても同じです。この章の確認はその方法で行い、環境変数 `DYNAMODB_ENDPOINT` で起動したポートを指しました。

S3 の Object Lock を手元で再現する手段は、用意していません。ダイジェストの側は、メモリ上のモデルだけです。

## テスト

<!-- section: 58.tests -->

```bash
vp run test:unit
vp run ledger:test:local
```

| 層 | ファイル | 見ているもの | 見られないもの |
| --- | --- | --- | --- |
| 記録とハッシュ | `test/entry.test.ts`、`test/events.test.ts` | ハッシュの固定値、値の区切り、キーの順番、形の合わない行の拒否、出来事のスキーマ | SHA-256 そのものの強さ |
| ジャーナルの規則 | `test/journal-contract.ts` | 空いた番号にだけ書けること、末尾、範囲の読み取り、台帳の分離。メモリ上のモデルと DynamoDB Local の両方で実行する | IAM、実際のサービスの分散した挙動 |
| 追記 | `test/ledger.test.ts` | 番号の取り合い、応答の喪失、負け続けたとき、読めない末尾 | 実物で取り合いがどれだけ起きるか |
| ダイジェスト | `test/digest.test.ts`、`test/digest-lambda.test.ts` | 前回から先だけを読むこと、合わない台帳への拒否、関数の失敗 | Lambda とスケジュールの実際の動き |
| 検証 | `test/verify.test.ts` | 過去の記録の変更、削除、入れ替え、切り落としの検出。検出できない範囲。ダイジェストへの攻撃 | S3 が実際にロックを守ること |
| バケットのモデル | `test/memory-digests.test.ts` | 条件付きの書き込み、削除マーカー、バージョンの積み重なり | モデルが S3 と一致すること |
| リクエストの検査 | `test/adapters.test.ts` | PartiQL の文とパラメーター、`PutItem` を送らないこと、`If-None-Match`、バージョンの一覧のページ送り | AWS がそのリクエストどおりに動くこと |
| 片付け | `test/purge.test.ts` | ロック中のバージョンを残す計画 | 実際の削除 |
| インフラ | `infra/test/ledger-stack.test.ts` | 権限、ロックの設定、削除の方針、スケジュール | AWS がそのテンプレートどおりに動くこと |

ジャーナルの規則は 1 回だけ書いて、メモリ上のモデルと DynamoDB Local の両方に対して実行します。DynamoDB Local では、PartiQL の `INSERT` を使う実装と、条件付きの `PutItem` を使う実装の両方を通します。

`ledger:test:local` は、`DYNAMODB_ENDPOINT` が無いと失敗します。テストファイル自体は、接続先が無いときに自分をスキップするので、`vp run test:unit` の出力には `1 skipped` と出ます。

DynamoDB Local（3.3.1）に対しては、11 件が通りました。確かめられたのは、PartiQL の文が受け付けられること、同じキーへの 2 回目の `INSERT` が断られること、強整合の `Query` が番号の順に返ることです。

確かめられていないことのほうが、この章では重要です。書き手のポリシーが上書きを止めること、S3 がロックされたバージョンの削除を断ること、`If-None-Match` と `ListObjectVersions` の実際の応答は、どれも AWS の上でしか確かめられません。手元で通ったのは、公式ドキュメントの決まりを写したモデルの上で、検証のコードが意図どおりに動くことです。
