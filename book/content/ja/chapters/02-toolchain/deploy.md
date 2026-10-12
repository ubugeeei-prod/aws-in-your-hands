---
title: "02 Toolchain: デプロイ"
---

# 02 Toolchain: デプロイ

## デプロイする

<!-- section: 02.deploy -->

```bash
vp run hello:infra:diff
vp run hello:infra:deploy
```

`diff` は、これから作られるものを表示します。初回は bucket と bucket policy の 2 つが「作成」として出るはずです。実際に作るのが `deploy`。どちらも、実行の前にアカウントとリージョンを表示して、`AIH_AWS_ACCOUNT_ID` と一致しなければ止まります。

デプロイが終わると、bucket の名前が出力されます。コンソールの S3 の画面でも確かめられます。

設定を変えてもう一度 diff を取ると、変更だけが出ます。

```bash
vp run hello:infra:diff -c noncurrentVersionDays=30
```

## diff と drift は別もの

<!-- section: 02.diff-drift -->

ここまでに、「bucket の設定」を表すものが 4 つ出てきました。

| | 何か | どこにあるか |
| --- | --- | --- |
| ソース | CDK のコード | リポジトリ |
| template | synth の出力 | `cdk.out/` |
| state | cdkd が「こう作った」と記録したもの | `cdkd-state-...` bucket |
| 実物 | いま AWS にある設定 | AWS |

diff は、template と state を比べます。「このコードをデプロイしたら何が変わるか」という予告です。実物は見ません。

drift は、state と実物を比べます。「記録どおりの設定が、いまも AWS にあるか」という確認です。誰かがコンソールで設定を変えると、ここに差が出ます。

だから、**diff が空でも、drift が無いとは言えません**。コンソールで bucket の versioning を止めても、コードも state も変わらないので、diff は「変更なし」と言います。

CloudFormation の経路にも、同じ区別があります。`cdk diff` は template どうしの比較で、実物との比較は CloudFormation の drift detection という別の機能です。そちらは [20章](/ja/chapters/20-shipping.md)で扱います。

## drift を見つける

<!-- section: 02.drift-gate -->

```bash
vp run hello:infra:drift
```

このタスクは `cdkd drift AihHello --json` を実行して、結果を `reports/drift/AihHello.json` に書き、最後に合否を出します。AWS を読みますが、変更はしません。

合否の判定は、cdkd の終了コードだけには任せていません。固定した版の cdkd は、次のときにも終了コード 0 を返すからです。

- 読み戻す手段がない種類のリソースがあり、比較していない
- 比較を省いたリソースがある

「差が見つからなかった」と「全部比べて一致した」は違いますよね。この本の gate は、すべてのリソースを比べて一致したときだけ合格にします。

<<< @/tools/src/drift/report.ts{gate}

状態は 7 つあります。

| 状態 | 意味 | gate の終了コード |
| --- | --- | --- |
| `clean` | すべて比べて一致した | 0 |
| `drifted` | 記録と違う設定がある | 10 |
| `deleted` | 記録にあるリソースが AWS に無い | 10 |
| `incomplete` | 読み出しに失敗するなどして、比べられなかったものがある | 11 |
| `unsupported` | 読み戻せない種類のリソースがあり、比べていない | 11 |
| `failed` | 検出そのものが結果を出さなかった | 12 |
| `missing-target` | 指定した stack の記録が無い | 12 |

終了コードを分けたのは、CI が「違いがある」と「分からない」を区別できるようにするためです。report には、実行した時刻、アカウント、リージョン、比べた数と比べなかった数が残ります。

report を読むのは、cdkd の出力を schema で検証してからです。cdkd の出力も、この本のコードから見れば、外から来るデータなので。出力が空だった、指定した stack が含まれていなかった、終了コードと中身が食い違っていた。そういうときは、良いほうに解釈せず、`failed` か `missing-target` にします。これらは `tools/src/drift/fixtures/` の 9 つの入力に対してテストしています。ただし fixture は cdkd の型定義から手で書いたもので、実際の AWS から採取した出力ではありません。

### drift が見つかったら

選択肢は 3 つあります。どれを選ぶかは、人が決めます。

- 実物を記録に戻す。`vp run hello:infra:drift:revert:preview` で内容を確かめてから、`vp run hello:infra:drift:revert`。置き換えが必要な変更では、データを持つリソースが作り直される場合があります。preview は必ず読んでください
- 実物の設定を正とする。`vp run hello:infra:drift:accept`。書き換わるのは state だけです。CDK のコードは変わらないので、次のデプロイで元に戻ります。コードも同じ値に直してください
- コードを直してデプロイし直す。コードを変更して `vp run hello:infra:deploy`。意図した変更なら、これが本来の手順です

どれを選んでも、最後にもう一度 `vp run hello:infra:drift` を実行します。解消のコマンドが成功したことは、stack が一致していることの証明にはなりません。

### 試してみる

デプロイした bucket で、次の順に試せます。

1. コンソールで bucket の「バージョニング」を「停止」に変える
2. `vp run hello:infra:diff` を実行する。変更なしと出るはず
3. `vp run hello:infra:drift` を実行する。`drifted` になり、終了コードが 10 になるはず
4. `vp run hello:infra:drift:revert:preview` で戻す内容を見て、`vp run hello:infra:drift:revert` で戻す
5. もう一度 `vp run hello:infra:drift` を実行し、`clean` を確かめる

「はず」と書いたのは、この手順をまだ実際の AWS アカウントで実行していないからです。
