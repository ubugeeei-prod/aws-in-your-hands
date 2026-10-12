---
title: "22 Backup: 手元で動かす"
---

# 22 Backup: 手元で動かす

## 手元で動かす

<!-- section: 22.local -->

AWS のアカウントがなくても、流れは見られます。

```bash
vp run recovery:demo
```

メモリの上の table と bucket で、事故から修復までを通します。出力は、こうなります。

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

table だけ戻した時点で、食い違いが 4 件。bucket を同じ時刻に戻すと、0 件になります。修復の出番は、ありませんでした。

これが、おすすめの順序です。**まず 2 つを、できるだけ同じ時刻に戻す。修復は、それでも残ったものにだけ使う。** 修復を先にやると、検査の記録を「上書きされたバイト」に合わせて書き直した後で、bucket を戻すことになり、もう一度食い違います。

最後の行も見てください。復元の時刻より後に書かれた日記は、どの検査にも出てきません。失ったデータは、検査ではなく、差分が教えてくれます。

テストは、いつもと同じです。

```bash
vp run test:unit
```

この 2 つが再現しないものも、書いておきます。復元にかかる時間。`LatestRestorableDateTime` の遅れ。S3 の時刻の粒度。delete marker を消したときや、version をコピーしたときに、S3 が出すイベント。IAM。どれも、実物でしか確かめられません。
