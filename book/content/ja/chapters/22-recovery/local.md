---
title: "22 Backup: 手元で動かす"
---

# 22 Backup: 手元で動かす

## 手元で動かす

<!-- section: 22.local -->

事故から修復までの流れは、AWS のアカウントがなくても手元で見られます。

```bash
vp run recovery:demo
```

このタスクは、メモリ上のテーブルとバケットを使って、事故から修復までを通します。出力は次のとおりです。

```text
09:04:00  two notes, one inspected image each. This is the point to return to.
09:09:00  since then: one edit, one note deleted by mistake, one image overwritten, one new note.

restored the table to 09:04:00. The bucket is still at 09:09:00.
cutting over gives back 1 note, loses 1, undoes edits to 1.

check: the restored table against the bucket as it is: 4 findings
  broken   attachment_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   attachment_size_mismatch  u/alice/0mv50wpxc0003/0mv50y0800004
  leftover inspection_without_object  u/alice/0mv50u5c00001/0mv50vfmo0002
  broken   inspection_for_other_bytes  u/alice/0mv50wpxc0003/0mv50y0800004

restored the bucket to 09:04:00: remove_delete_marker, copy_version

check again: 0 findings

repair: 0 actions, 0 findings left for a person
raised the version of 1 rolled-back note past the number the live table had reached.

not restored, and not found by any check: "diary, written after the point". It exists only in the old table.
```

テーブルだけを戻した時点では、食い違いが 4 件あります。バケットを同じ時刻に戻すと 0 件になり、修復がすることは残りませんでした。

この順序を勧めます。**まず 2 つをできるだけ同じ時刻に戻し、修復は、それでも残ったものにだけ使います。** 修復を先に実行すると、検査の記録を上書きされたバイトに合わせて書き直した後でバケットを戻すことになり、もう一度食い違います。

出力の最後の行にも注目してください。復元の時刻より後に書かれた日記は、どの検査にも出てきません。失ったデータを教えてくれるのは、検査ではなく差分です。

テストは、ほかの章と同じタスクで実行します。

```bash
vp run test:unit
```

`recovery:demo` とテストが再現しないものは、復元にかかる時間、`LatestRestorableDateTime` の遅れ、S3 の時刻の粒度、削除マーカーを消したときやバージョンをコピーしたときに S3 が出すイベント、そして IAM です。どれも、実物でしか確かめられません。
