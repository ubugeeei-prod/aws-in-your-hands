---
title: "23 VM: 手元で動かす"
---

# 23 VM: 手元で動かす

## 手元で確かめる

<!-- section: 23.local -->

machine の話ばかりしてきましたが、ここまでのほとんどは手元で確かめられます。AWS のアカウントは要りません。

`examples/23-ec2/.env.example` を、同じ場所に `.env` という名前でコピーして、起動します。

```bash
vp run dev:ec2
```

```bash
curl -s -X POST http://localhost:8787/notes -H 'content-type: application/json' -d '{"title":"first note"}'
curl -s http://localhost:8787/notes
```

Ctrl+C で止めて、もう一度起動して、2 行目を呼んでみてください。ノートが残っています。04章の `dev:api` とは、そこが違います。ファイルは `examples/23-ec2/.data/notes.json` にできます。

テストと、そのほかのタスクです。

```bash
vp run test:unit
vp run ec2:plan
vp run ec2:render
vp run ec2:app:build
vp run ec2:infra:synth
```

`ec2:render` は、`deploy/` に置いてある unit や script が、いまのコードから生成されるものと一致しているかを調べます。ずれていたら、`vp run ec2:render --write` で書き直して、差分を読みます。instance の上で root として走るものが、review できる形で repository に入っている、という状態を保つためのタスクです。

`ec2:app:build` は、API を 1 つの JavaScript のファイル（`dist/server.mjs`）にまとめます。instance の上には `node_modules` を置きません。

テストが見ているものと、見ていないものを並べておきます。

| どこ | 見ているもの | 見ていないもの |
| --- | --- | --- |
| `test/file-notes.test.ts` | 書き込みの各段階で止まったときの、ファイルとメモリ | 本物の disk と、本物の電源断 |
| `test/shutdown.test.ts` | SIGTERM の後の順序。本物の socket | systemd が signal を送ること |
| `test/machine.test.ts` | unit と user data の中身、injection の拒否、bash として読めること | Amazon Linux 2023 の上で動くこと |
| `test/data-volume.test.ts` | script の判断。format するか、しないか | 本物の `blkid` と `mkfs` |
| `test/remote.test.ts` | instance に送るコマンドの組み立て | Systems Manager が届けること |
| `infra/test/ec2-stack.test.ts` | inbound が空、IMDSv2、権限、volume の設定 | AWS が template どおりに動くこと |

右の列は、どれも実機でしか確かめられません。そして、この章はまだ実機を通していません。次の節のコマンドは、用意してあるだけです。
