---
title: "47 Step Functions: 手元で動かす"
---

# 47 Step Functions: 手元で動かす

[前のページ](/ja/chapters/47-step-functions/build.md)で書いた定義を、AWS に置く前に手元で歩かせます。16章の実行器は JSONPath の `Task` と `Choice` を扱うものでした。この章の定義は JSONata で、`Map` とコールバックがあるので、実行器を書き直しています。

## 手元で動かす

<!-- section: 47.local -->

```bash
vp run sfn:local
vp run sfn:local --infected --refuse RemoveAttachment --times 4 --redrive
vp run sfn:local --lose CreateNote
```

1 行目は、取り込みを最後まで通します。

```text
  CreateNote
  AttachFile
  WaitForScan
  Verdict
  Publish
  Notify
  Imported
SUCCEEDED {"owner":"user-1","noteId":"note-1","title":"Minutes","body":"What was said","upload":"inbox/user-1/minutes.pdf","verdict":"clean","notified":true}
left behind: ready note, an attachment
notices sent: 1, retries waited up to 0 s
invariant: holds
```

2 行目は、スキャンにファイルを断らせ、さらに `RemoveAttachment` を 4 回続けて失敗させます。最初の 1 回と 3 回の再試行がすべて失敗するので、実行は補償処理の途中で止まります。`--redrive` を付けると、失敗の原因を取り除いてから、止まったステートから続けます。

```text
  CreateNote
  AttachFile
  WaitForScan
  Verdict
  RemoveAttachment  ! Injected.Refused
  RemoveAttachment (attempt 2)  ! Injected.Refused
  RemoveAttachment (attempt 3)  ! Injected.Refused
  RemoveAttachment (attempt 4)  ! Injected.Refused
FAILED Injected.Refused: injected: RemoveAttachment was refused
left behind: pending note, an attachment
notices sent: 0, retries waited up to 14 s
invariant: holds

redrive from RemoveAttachment, with the fault gone:
  RemoveAttachment
  RemoveNote
  RolledBack
FAILED ImportRolledBack: A step failed or the scan refused the file. The note and its attachment are gone.
left behind: absent note, no attachment
notices sent: 0, retries waited up to 0 s
invariant: holds
```

止まった時点では、公開前のノートと添付ファイルが残っています。それでも不変条件が `holds` なのは、実行が補償処理のステートで失敗として終わっていて、そこから続けられるからです。前のページの 2 文目に書いた例外にあたります。

3 行目の `--lose` は、ステップに仕事をさせたうえで、応答だけを捨てます。`CreateNote` はノートを書きますが、ワークフローにはタイムアウトにしか見えません。4 回とも同じことが起きると、`Catch` が `RemoveNote` へ進め、書かれていたノートを消します。

```text
  CreateNote  ! States.Timeout
  CreateNote (attempt 2)  ! States.Timeout
  CreateNote (attempt 3)  ! States.Timeout
  CreateNote (attempt 4)  ! States.Timeout
  RemoveNote
  RolledBack
FAILED ImportRolledBack: A step failed or the scan refused the file. The note and its attachment are gone.
left behind: absent note, no attachment
notices sent: 0, retries waited up to 14 s
invariant: holds
```

どれも、AWS の認証情報も Docker も要りません。`retries waited` は、再試行の待ち時間を足した値で、実際には待っていません。

### 定義を歩く実行器

<<< @/examples/47-step-functions/src/interpreter.ts{run}

実行器は、デプロイするものと同じ定義を受け取り、`StartAt` から 1 つずつステートをたどります。扱うのは、JSONata の `Task`、`Choice`、inline の `Map`、`Succeed`、`Fail` の 5 種類です。`Pass`、`Wait`、`Parallel`、distributed の `Map`、JSONPath のフィールドは扱いません。この章の 2 つの定義が使うものだけを実装しました。

<<< @/examples/47-step-functions/src/interpreter.ts{evaluate}

式の評価には、JSONata の参照実装である npm の `jsonata` を、2.0.6 に固定して使っています。Step Functions が「2.0.6 の仕様に基づく」と書いている版です。`$states` と変数を束縛して評価し、値がなければ `States.QueryEvaluationError` にします。Step Functions が足した `$uuid` などの関数は、束縛していません。

実行器の式の評価が Step Functions と同じ結果になるかどうかは、確かめていません。参照実装の版を合わせただけで、Step Functions の中の実装が同じものだという根拠は持っていません。

<<< @/examples/47-step-functions/src/interpreter.ts{retry-catch}

`Retry` と `Catch` の部分は、ドキュメントの記述をそのまま写しました。retrier は自分の再試行の回数を数え、その数は、同じステートの中でその retrier が受けたエラーすべてに共通です。成功したときは、`Output` と `Assign` の両方を、ステートに入った時点の値で評価します。エラーのときは、catcher の `Assign` だけを評価し、ステートの `Assign` は評価しません。

<<< @/examples/47-step-functions/src/interpreter.ts{task}

コールバックを待つ `Task` は、試行ごとに新しいトークンを作り、サービスを呼んだあと、その応答を捨てて、トークンへの返事を待ちます。

<<< @/examples/47-step-functions/src/interpreter.ts{map}

`Map` は、繰り返しを 1 つずつ、順番に実行します。本物は `MaxConcurrency` まで同時に走らせるので、繰り返しどうしが競合する定義は、この実行器では確かめられません。照会の繰り返しは読むだけなので、順番に動かしても結果は変わりません。

実行器が持っていないものは、ほかにもあります。時計がないので、`TimeoutSeconds` と `HeartbeatSeconds` は、代役が `States.Timeout` を投げることでしか表せません。256 KiB の上限、25,000 イベントの履歴の上限、スロットリング、IAM も扱いません。状態も保存しないので、実行の途中でプロセスが止まれば、何も残りません。

### サービスの代役

<<< @/examples/47-step-functions/src/interpreter.ts{world}

<<< @/examples/47-step-functions/src/local-world.ts{world}

ステートマシンの外側は、すべて `World` です。手元の `LocalWorld` は、テーブル、バケット、キュー、トピックを `Map` と配列で持ち、定義が呼ぶ 8 種類の `Resource` にだけ応えます。`fail` で、特定のステートの呼び出しを失敗させられます。`refused` は何もせずに断り、`lost` は仕事をしてから応答を捨てます。分散システムで区別しなければならないのは、この 2 つです。

<<< @/examples/47-step-functions/src/local-world.ts{conditions}

代役のテーブルは、DynamoDB の条件式を解釈しません。取り込みが使う 2 つの条件式を文字列として覚えていて、それぞれの意味を TypeScript の関数で持っています。知らない条件式が来たら、例外を投げます。つまり、条件式が意図どおりに働くかどうかは、このテストでは確かめられません。確かめているのは、条件がその意味で働くとしたら、定義の配線が不変条件を守るかどうかです。条件式そのものは、デプロイして確かめる項目に入れてあります。

## 壊しにいくテスト

<!-- section: 47.tests -->

<<< @/examples/47-step-functions/src/invariant.ts{invariant}

不変条件は関数にしてあります。実行が終わったあとのテーブルとバケットを見て、破れていれば、どう破れたかを文で返します。テストは、失敗を 1 つずつ決まった場所に入れて実行し、この関数が空の配列を返すことを確かめます。

<<< @/examples/47-step-functions/test/saga.test.ts{each-step}

取り消せるステップと待ち合わせの 3 つについて、「断られ続ける」と「仕事は済むが応答が届かない」の両方を試します。どちらの場合も、実行は `ImportRolledBack` で終わり、ノートも添付ファイルも残りません。2 つ目の場合が、前のページの「失敗したステップ自身も取り消す」を確かめています。

<<< @/examples/47-step-functions/test/saga.test.ts{twice}

応答が 1 回だけ失われると、ステップは 2 回走ります。`CreateNote`、`AttachFile`、`Publish` は、2 回目が何も変えません。`Notify` は通知を 2 通送ります。テストは、2 通が同じ実行の名前を持っていることを確かめています。重複をなくしているのではなく、受け取る側が見分けられることを確かめているだけです。

<<< @/examples/47-step-functions/test/saga.test.ts{no-way-back}

`Publish` の応答が 4 回とも失われると、実行は `Publish` で失敗します。ノートはすでに公開されているので、補償処理には進みません。redrive は `Publish` をもう一度実行し、`Notify` へ進みます。

<<< @/examples/47-step-functions/test/saga.test.ts{compensation-fails}

<<< @/examples/47-step-functions/test/saga.test.ts{two-imports}

同じノート ID を別の取り込みが先に使っていた場合、あとの取り込みは `NoteIdTaken` で止まり、先のノートには触りません。補償処理を直接実行しても、条件が成り立たずに失敗し、他人のノートは消えません。

### 定義をわざと壊す

<<< @/examples/47-step-functions/test/saga.test.ts{broken}

不変条件の検査が飾りでないことを、定義を 2 か所壊して確かめます。1 つ目は、`CreateNote` の `Catch` を `RolledBack` へ直接つなぎます。「失敗したのだから消すものはない」という、もっともらしい間違いです。応答が失われ続けると、取り消したはずの取り込みが、公開前のノートを残します。2 つ目は、`Publish` に `Catch` を付けて補償処理へ進めます。公開が済んでいた場合、添付ファイルだけが消えて、公開されたノートが残ります。どちらも、検査の関数が文で報告します。

最初にこのテストを書いたとき、2 つ目の壊し方は、思っていたのと違う形で壊れました。catcher に `Output` を書き忘れたので、補償処理に渡ったのはエラーの情報だけになり、`'attachments/' & $states.input.owner` が空文字列をつないで、存在しないキーを「消して」成功しました。エラーは 1 つも出ません。前のページで `&` に気をつけると書いたのは、この経験からです。

## TestState

<!-- section: 47.test-state -->

実行器は自作のモデルなので、本物と突き合わせる手段が要ります。Step Functions には、ステートを 1 つだけ実行する TestState という API があります。2025 年 11 月から、呼び出す先のサービスの応答をモックにできるようになりました。モックを使うと、Step Functions は式の評価、`Retry`、`Catch` だけを実行し、サービスを呼びません。ロールも要りません。

<<< @/examples/47-step-functions/src/test-state-cases.ts{cases}

この表は、「このステートに、この入力と、この応答を与えたら、次はどのステートか」を並べたものです。`retries` は、すでに何回再試行したことにするかで、TestState の `retrierRetryCount` に渡します。TestState は 1 回の試行の結果だけを答えるので、まだ再試行が残っていれば `RETRIABLE`、尽きて catcher に進めば `CAUGHT_ERROR`、どの catcher にも一致しなければ `FAILED` を返します。

ユニットテストは、手元の実行器がこの表のとおりに動くことを確かめます。同じ表を本物に送るのが、次のタスクです。

```bash
vp run sfn:test-state
```

このタスクは実行していません。AWS の認証情報が要るからです。スタックは要らず、モックを使うので DynamoDB も S3 も呼ばれません。出力に `DIFFERENT` と出た行が、モデルか表のどちらかが間違っている場所です。

TestState で確かめられるのは、ステート 1 つの中のことだけです。`Map` に使うと、`ItemProcessor` の中は実行されず、`Map` 自身の入出力の加工だけが試されます。ステートをまたぐ流れ、つまりこの章の不変条件は、TestState では確かめられません。そこは、モデルで確かめたうえで、デプロイして確かめる範囲です。

手元で動かせる Step Functions としては、AWS が配っていた Step Functions Local があります。ドキュメントは現在、Step Functions Local を機能が揃っておらずサポート対象外としていて、代わりに TestState を勧めています。この章では使っていません。
