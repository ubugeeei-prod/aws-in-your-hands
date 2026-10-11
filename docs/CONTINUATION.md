# 継続プロンプト / Continuation prompts

このリポジトリを編集できる agent に、そのまま渡せる指示です。`[CHAPTER_ID]` と `[SCENARIO_ID]` を置き換えて使います。どちらの言語で渡しても、作るのは日英両方です。

次に書く章は **05（DynamoDB）** です。04章の `NoteRepository` を DynamoDB の実装に差し替え、SPA を API につなぎます。

## 章を増やす

```text
このリポジトリの CONTRIBUTING.md、docs/EDITORIAL.md、data/chapters.json、data/sources.json、
既存の examples/ を読み、未完了の章 [CHAPTER_ID] を日英で完成させてください。

固定している構成を維持します: 本のサイトは Ox Content、インフラの定義は TypeScript の CDK、
リソースの管理は cdkd、環境とタスクは Nix と vp です。別のツールに置き換えないでください。

進め方は CONTRIBUTING.md の「章を書く順序」に従います。
一次情報の再確認 → 動くサンプルとテスト → vp タスク → 日本語の本文 → 英語 → 整合検査、の順です。

守ること:
- 既存の章が教えたことだけを前提にする。足りない前提は短い説明か、正しい章へのリンクで補う
- 既存のサンプル、章 ID、#region の名前、コードの取り込みを壊さない
- すべての説明に完全なソースを付ける。途中段階や別構成を説明するなら、それも取り出して動かせるようにする
- data/section-map.json と、日英のコード参照を更新する
- 型と runtime validation の境界、意味のあるテスト、短い手元の反復を、章の完了条件にする
- AWS を読む・変えるタスクは live(...) で定義し、キャッシュさせない
- diff と drift、比べたものと比べていないものを分ける
- 料金は、単価の出典、確認日、使用量の仮定を data/pricing/ に置き、定価と無料枠適用後を分ける。
  確認できないものは unknown とする
- 該当する場合は、Cloudflare（D1、Workers、Workers AI）から来た読者の経路と、
  分散システムの案内（状態の持ち主、invariant、失敗の再現テスト）を更新する
- 削除後に残るものを書く

AWS のリソースを作る、変える、消す操作は、この依頼では実行しません。手順とタスクを用意し、
実行していない検証は data/validation.json に未検証として記録してください。

最後に vp run check:all を通し、完成した範囲、編集上の判断、検証した範囲、
残る制約、次の章を報告してください。
```

```text
Read CONTRIBUTING.md, docs/EDITORIAL.md, data/chapters.json, data/sources.json, and the existing
examples/ in this repository. Complete the unfinished chapter [CHAPTER_ID] in Japanese and English.

Keep the fixed choices: Ox Content for the book site, TypeScript CDK for infrastructure
definitions, cdkd for resource management, and Nix plus vp for the environment and tasks.
Do not substitute other tools.

Follow "章を書く順序" in CONTRIBUTING.md: re-read primary sources, write the runnable example and its
tests, add vp tasks, write the Japanese prose, adapt it to English, then run the consistency checks.

Requirements:
- Assume only what earlier chapters taught; fill gaps with a short explanation or a link to the
  right chapter
- Do not break existing examples, chapter IDs, #region names, or snippet imports
- Ship complete source for every explanation, including any intermediate or alternative stage
- Update data/section-map.json and the snippet references in both languages
- Treat type and runtime-validation boundaries, meaningful tests, and a short local loop as
  completion requirements
- Define tasks that read or change AWS with live(...) so that they are never cached
- Keep diff apart from drift, and compared resources apart from uncompared ones
- Put price sources, checked dates, and usage assumptions in data/pricing/, separating list price
  from the price after free allowances; record anything unconfirmed as unknown
- Where relevant, update the reading paths for readers coming from Cloudflare (D1, Workers,
  Workers AI) and the distributed-systems guide (state owner, invariant, failure-reproducing tests)
- State what remains after cleanup

This request does not authorize creating, changing, or deleting AWS resources. Prepare the
procedures and tasks, and record every check that was not run as unverified in data/validation.json.

Finish by running vp run check:all, then report what is complete, the editorial decisions made,
what was verified, the remaining constraints, and the next chapter.
```

## 実環境の検証を準備する、または実行する

```text
[SCENARIO_ID] の実環境検証を準備してください。data/validation.json の open にある項目から始めます。

次を明示してください: 対象のアカウント、リージョン、stack、必要な権限、実行する vp タスクの順序、
期待する結果、概算の料金とその前提、作成・変更・削除するもの、片付けの手順と残るもの。

live のタスクはキャッシュさせません。drift は、比べた数と比べなかった数を残します。
分散の失敗条件と invariant を明示し、ローカルで通ったことと実環境で確かめたことを分けます。

この依頼で実行が許可されていない操作は、手順の準備までにしてください。
許可された環境で実行した場合は、実際の結果、実行日時、使ったコマンドを data/validation.json に
記録し、section-map の verification を更新し、想定と違った点があれば日本語の本文を先に直してから
英語に反映してください。
```

```text
Prepare the cloud validation for [SCENARIO_ID], starting from the entries under `open` in
data/validation.json.

State the target account, Region, stack, required permissions, the order of vp tasks to run,
the expected results, the estimated charges and their assumptions, what is created, changed, and
deleted, and the cleanup steps with what remains afterwards.

Live tasks are never cached. Drift results keep the number of resources compared and not compared.
Name the distributed failure conditions and the invariant, and keep local passes apart from what
was confirmed against the real service.

Prepare, but do not execute, anything this request does not authorize. When execution in an
authorized environment happens, record the actual results, timestamps, and commands in
data/validation.json, update `verification` in the section map, and where behavior differed from
the prose, correct the Japanese text first and then the English.
```

## 最初に実行する実環境検証（提案）

未検証の項目は互いに依存しています。次の順で進めると、後の検証が前の結果を使えます。

1. `account:whoami`: AWS SDK が `aws login` の認証情報を読めるか
2. `infra:bootstrap` → `hello:infra:deploy` → `hello:infra:drift`: cdkd の基本動作と、drift report の実際の形。採取した出力を `tools/src/drift/fixtures/` に加える
3. 02章の drift の実験（コンソールで versioning を止める → 検出 → 解消 → 再検出）
4. `spa:infra:deploy` → `spa:publish` → `spa:smoke` → `spa:infra:drift`: cdkd が `AWS::CloudFront::Function` を扱えるか、stack の output の読み取りが合っているか
5. `api:infra:deploy` → `api:smoke` → `api:logs`: Node.js 24 の runtime で bundle が動くか
6. `book:infra:deploy` → `book:publish` → `book:smoke`: 本のサイトの公開
7. 各 `*:unpublish`、`*:infra:destroy`: 片付けと、残るものの確認
