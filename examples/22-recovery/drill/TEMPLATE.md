# Recovery drill record / 復旧 drill の記録

One copy per drill. The times and counts live in `reports/drills/<name>.json`
(started with `vp run recovery:drill new <name>`); this page is for what a
number cannot say. Leave a line empty if the step did not happen.

drill ごとに 1 部。時刻と件数は `reports/drills/<name>.json` に入ります
（`vp run recovery:drill new <name>` で作成）。この用紙は、数字にならないことを書く場所です。
実施しなかった手順は、空欄のままにします。

## Who, when, where / 誰が、いつ、どこで

- Drill name / drill の名前:
- Date / 実施日:
- Operator / 実施者:
- AWS account (last 4 digits only) / AWS アカウント（下 4 桁だけ）:
- Region / リージョン:
- Commit of this repository / このリポジトリの commit:
- Stack options (`-c protect`, `-c backup`, `-c replica`) / stack のオプション:

## Targets set before starting / 始める前に決めた目標

- Recovery time we want (RTO) / 目標の復旧時間:
- Data loss we accept (RPO) / 許容するデータ損失:
- Why these numbers / その根拠:

## Measured / 実測

Copy from `vp run recovery:drill summary <name>`. Do not round, and do not fill in a number that was not measured.

`vp run recovery:drill summary <name>` の出力を写します。丸めない。測っていない数字を埋めない。

| | Seconds / 秒 |
| --- | --- |
| `rtoSeconds` (accident → service confirmed) | |
| `rpoSeconds` (table restore point → accident) | |
| `detectionSeconds` (accident → detected) | |
| `tableRestoreSeconds` (restore requested → table ACTIVE) | |
| `skewSeconds` (table point vs. object point) | |

- Table size at the time (items, bytes) / そのときの table の大きさ（item 数、バイト数）:
- Objects in the bucket (current, all versions) / bucket の object 数（現行、全 version）:

## What was lost / 失ったもの

- Notes that came back / 戻ったノート:
- Notes created after the restore point and lost / 復元時点より後に作られて失われたノート:
- Edits rolled back / 巻き戻った編集:
- Images that could not be brought back, and why / 戻せなかった画像と、その理由:

## Mismatches after the restore / 復元後の食い違い

- `recovery:verify` before repair (broken / leftover) / 修復前:
- `recovery:repair` actions / 修復の内容:
- `recovery:verify` after repair / 修復後:
- Findings left for a person, and what was decided / 人の判断に残したものと、決めたこと:

## Cutover / 切り替え

- How the function was pointed at the restored table / 関数を復元した table に向けた方法:
- What `recovery:infra:diff` showed before deploying / deploy 前の `recovery:infra:diff` の内容:
- What `recovery:infra:drift` showed after / deploy 後の `recovery:infra:drift` の内容:
- Settings re-applied to the restored table by hand (point-in-time recovery, deletion protection, tags, alarms) / 復元した table に手で付け直した設定:

## What surprised us / 想定と違ったこと

-

## What we change before the next drill / 次の drill までに変えること

-

## Cleanup / 片付け

- Restored tables deleted / 消した復元 table:
- Still running, and billed / まだ残っていて、料金がかかっているもの:
