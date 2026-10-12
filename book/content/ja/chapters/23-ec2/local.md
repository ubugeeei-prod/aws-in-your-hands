---
title: "23 VM: 手元で動かす"
---

# 23 VM: 手元で動かす

## 手元で動かす

<!-- section: 23.local -->

ここまでマシンの上で動くものを作ってきましたが、そのほとんどは手元で確かめられます。AWS のアカウントは要りません。

`examples/23-ec2/.env.example` を、同じ場所に `.env` という名前でコピーして、起動します。

```bash
vp run dev:ec2
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
```

Ctrl+C で止めてからもう一度起動し、2 行目を呼ぶと、ノートが残っています。04章の `dev:api` と違うのは、この点です。ノートのファイルは `examples/23-ec2/.data/notes.json` にできます。

テストと、そのほかのタスクは次のとおりです。

```bash
vp run test:unit
vp run ec2:plan
vp run ec2:render
vp run ec2:app:build
vp run ec2:infra:synth
```

`ec2:render` は、`deploy/` に置いてあるユニットやスクリプトが、いまのコードから生成されるものと一致しているかを調べます。ずれていたら、`vp run ec2:render --write` で書き直して、差分を読みます。インスタンスの上で root として実行されるものを、レビューできる形でリポジトリに置いておくためのタスクです。

`ec2:app:build` は、API を 1 つの JavaScript のファイル（`dist/server.mjs`）にまとめます。インスタンスの上には `node_modules` を置きません。

テストが確かめていることと、確かめていないことを並べます。

| どこ | 見ているもの | 見ていないもの |
| --- | --- | --- |
| `test/file-notes.test.ts` | 書き込みの各段階で止まったときの、ファイルとメモリ | 本物のディスクと、本物の電源断 |
| `test/shutdown.test.ts` | SIGTERM の後の順序。本物のソケットを使う | systemd がシグナルを送ること |
| `test/machine.test.ts` | ユニットとユーザーデータの中身、インジェクションの拒否、bash として読めること | Amazon Linux 2023 の上で動くこと |
| `test/data-volume.test.ts` | スクリプトの判断。フォーマットするか、しないか | 本物の `blkid` と `mkfs` |
| `test/remote.test.ts` | インスタンスに送るコマンドの組み立て | Systems Manager が届けること |
| `infra/test/ec2-stack.test.ts` | インバウンドが空であること、IMDSv2、権限、ボリュームの設定 | AWS がテンプレートどおりに動くこと |

右の列は、どれも実機でしか確かめられません。そして、この章はまだ実機で動かしていません。[次のページ](/ja/chapters/23-ec2/deploy.md)のコマンドは用意してあるだけで、実行した結果ではありません。
