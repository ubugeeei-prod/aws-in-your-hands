---
title: "16 Workflow: しくみと実装"
---

# 16 Workflow: しくみと実装

## 最後の 1 個で、見えるようにする

<!-- section: 16.manifest -->

part が全部そろうまでの間、bucket には書きかけの export が置いてあります。それを誰かが読んだら、困ります。

<<< @/examples/16-long-jobs/src/steps.ts{finish}

なので、export を読む側との約束を 1 つ決めます。**manifest が無い export は、存在しない。** manifest は、part の key の一覧を書いた小さなファイルです。読む側は、まず manifest を読んで、そこに名前のある part だけを読みます。prefix の下を一覧して読んではいけません。

`Finish` は、manifest を書く前に、part が全部あるかを一覧で確かめます。無いものの名前を manifest に書くわけにはいかないからです。manifest の中身には、時刻を入れていません。同じ export を 2 つの実行が仕上げても、書こうとする bytes が同じになります。先に書いたほうが勝って、もう片方は 412 を受け取って、同じ結果を返します。

### 進めないときだけ、取り消す

part が欠けていたら、どうするか。ここが、この章の「補償処理」です。

データベースの transaction なら、途中で失敗したら rollback が全部を無かったことにしてくれます。workflow には、それがありません。step 1 が S3 に書いたものは、step 3 が失敗しても、そこに残ります。取り消したければ、取り消す step を自分で書きます。これが補償処理（compensation）です。

<<< @/examples/16-long-jobs/src/steps.ts{discard}

補償処理は、ふつうの step より難しい立場にいます。何かが壊れているときに呼ばれて、しかも自分も途中で止まります。なので、決まりが 3 つあります。

- **何度呼ばれてもよい。** 消えているものを消しても、エラーにしません。途中で止まったら、もう一度呼べば残りが消えます
- **完成したものには触らない。** manifest がある export は、消しません。「失敗した」という判断が古かった場合の保険です
- **取り消せないものは、取り消せない。** S3 の object は消せます。送ってしまったメールは消せません。取り消せない操作は、workflow のできるだけ後ろに置きます

そして、補償処理を呼ぶ場面は、思ったより少なくします。`ExportPages` が失敗しても、この workflow は part を消しません。書けた part は、次に再開するときの出発点だからです。消すのは、`Finish` が「part が欠けている」と言ったときだけ。再試行しても、欠けた part は戻ってこないからです。

**先へ進めるなら、再開する。進めないときだけ、取り消す。** 長い処理では、ここを最初に決めます。全部の失敗で取り消す workflow は、「続きから再開」を自分で捨てています。

再開も取り消しもされずに放っておかれた part は、どうなるでしょう。bucket の lifecycle rule が、7 日後に消します。完成した export も同じ 7 日で消えます。export は、取りに来る人のための一時的な置き場、という扱いです。

閉じていない穴を 1 つ、書いておきます。`Finish` の「一覧で確かめる」と「manifest を書く」は、2 つの操作です。その間に、別の実行の `Discard` が part を消したら、消えた part の名前が入った manifest ができます。同じ export の実行が 2 つ重なって、片方だけが「欠けている」と判断したときにしか起きませんが、起きえます。この章では閉じていません。

## 順番は、workflow に任せる

<!-- section: 16.workflow -->

step がそろったので、つなぎます。Step Functions の workflow は、state machine と呼ばれて、Amazon States Language（ASL）という JSON で書きます。

<<< @/examples/16-long-jobs/src/workflow.ts{definition}

この章は、定義を TypeScript の object として書いています。CDK にも construct がありますが、使いませんでした。同じ object を、手元の実行器（後で出てきます）と CDK の両方に渡したいからです。

state は 6 つです。`Task` が関数を呼び、`Choice` が分かれ道で、`Succeed` と `Fail` が終点です。

`Task` の `Resource` には、関数の ARN をそのまま書いています。こう書くと、state の入力がそのまま関数の event になり、関数の戻り値がそのまま state の出力になります。`ExportPages` が返した進捗が、`MorePages` を通って、次の `ExportPages` の入力になる。loop は、これだけで回ります。

### Retry と Catch

`Retry` は「この state を、同じ入力でもう一度」です。`ExportPages` は、どんなエラーでも 3 回までやり直します。間隔は 5 秒から始めて、倍にしていきます。`States.ALL` は、ほぼ全部のエラーに一致する名前です。関数の例外も、Lambda の一時的な障害も、timeout も入ります。

`Finish` だけ、`Retry` が 2 段になっています。`ExportCorrupt` は 0 回、つまり再試行しない。それ以外は 3 回。`ExportCorrupt` は、関数が投げる例外の `name` です。Lambda の関数が投げたエラーは、その `name` で Step Functions に届きます。

`Catch` は「再試行が尽きたら、失敗させるかわりに、この state へ」です。`ResultPath` を付けると、元の入力を残したまま、エラーの情報を横に足して渡します。`Discard` は、そこから export の ID を読みます。

`Catch` を付けたのは、`Finish` の `ExportCorrupt` だけです。ほかの失敗は、どこにも捕まらず、実行そのものが失敗します。わざとです。

### 失敗した実行は、続きから

失敗した Standard workflow の実行は、14 日以内なら redrive できます。失敗した state から、そのときの入力で、やり直す操作です。成功した state は、やり直しません。

`ExportPages` が 4 回続けて失敗して実行が止まったとします。原因（たとえば権限の誤り）を直してから redrive すると、`ExportPages` が、止まったときの進捗を入力にしてもう一度呼ばれます。part 1 から 30 まで書けていたなら、31 から続きます。厳密には、止まった呼び出しが途中まで書いた part も、412 で読み飛ばして先へ進みます。

ここで `Catch` を付けて `Fail` state に流していたら、redrive は効きません。ドキュメントによると、redrive は `Fail` state に入り直して、また失敗します。この workflow で `Discarded` まで行った実行は、もう再開できません。取り消したのだから、それで合っています。

### Standard と Express

state machine には 2 つの種類があって、作った後では変えられません。

| | Standard | Express |
| --- | --- | --- |
| 最長 | 1 年 | 5 分 |
| 状態 | state の間で保存される | 保存されない |
| 実行の保証 | exactly-once（`Retry` を除く） | 非同期は at-least-once |
| 課金 | state transition の数 | 実行の数、時間、メモリ |
| 失敗した実行の redrive | できる | 確認していません |

この章は Standard です。5 分で終わる保証がなく、途中から再開したいからです。

### timeout は、必ず書く

`Task` の `TimeoutSeconds` は、省くと 99,999,999 秒です。3 年を超えます。応答が永遠に返ってこない task があったら、実行はそこで止まったままになります。公式のベストプラクティスも、task には timeout を書くように、と言っています。

この章は、`Task` の timeout を、関数の timeout より 30 秒長くしました。先に Lambda が関数を止めて、エラーを返す。Step Functions は、それを受け取って再試行する。この順番にしておくと、「Step Functions はあきらめたのに、関数はまだ動いている」という状態を、ふつうは作らずに済みます。

「ふつうは」と書いたのは、作らずに済むとは言い切れないからです。ドキュメントは、timeout になった task を失敗として扱う、と書いています。動いている関数を止める、とは書いていません。それに、応答がネットワークの途中で失われることもあれば、同じ export の実行が 2 つ重なることもあります。前の節の `If-None-Match` は、そのためにあります。timeout の設定は、遅れてきた worker を減らします。無くすのは、書き込みの条件です。

## checkpoint の粒度

<!-- section: 16.checkpoint -->

「どこまで進んだか」を保存することを、checkpoint と呼びます。この workflow の checkpoint は、`ExportPages` が戻るたびに 1 つ作られます。では、どれくらいの頻度で戻るのがよいでしょう。

<<< @/examples/16-long-jobs/src/steps.ts{budget}

step の関数は、1 ページ書くたびに「もう 1 ページ行けるか」を外に聞きます。答えを誰が持っているかで、粒度が決まります。

<<< @/examples/16-long-jobs/src/export-pages-lambda.ts{handler}

Lambda で動くときの答えは、「関数の timeout まで、まだ 60 秒以上あるか」です。`getRemainingTimeInMillis()` は、Lambda が handler に渡す context の関数で、止められるまでの残り時間を返します。関数の timeout は 300 秒なので、1 回の呼び出しは、およそ 4 分ぶんのページを書いて戻ります。

<<< @/examples/16-long-jobs/src/env.ts{env}

両極端を考えてみましょう。

**1 ページごとに戻る。** 失敗したときにやり直す量は、1 ページで済みます。そのかわり、ページの数だけ workflow を通ります。Standard workflow は state transition の数で課金されるので、ページが増えれば、料金も一緒に増えます。もう 1 つ、上限があります。Standard workflow の 1 回の実行は、履歴が 25,000 イベントに達すると失敗します。loop を回すたびに、履歴は数件ずつ伸びます。

**全部を 1 回で。** state transition は最少です。でも、15 分で終わらない仕事では、そもそも選べません。

この章は、その間を取りました。時間の許すかぎり進めて、余裕を残して戻る。ノートが少ないうちは 1 回で終わり、増えたら自然に 2 回、3 回と割れていきます。

ここで、前の節までの設計が効いてきます。part は 1 ページごとに S3 に書かれていて、書かれた part は読み飛ばせます。つまり、**workflow の checkpoint が粗くても、やり直す量は増えません。** 4 分ぶん進んだところで関数が落ちても、再試行は、書けている part を 412 で確かめながら通り過ぎて、続きから書きます。読み直しの `Scan` は走りますが、書き込みは走りません。

checkpoint は、2 段になっているわけです。workflow が覚えている進捗は「どこから呼ぶか」の目安で、S3 にある part が「どこまで済んだか」の事実です。目安が古くても、事実のほうが正しい結果に連れていきます。テストは、1 ページごとに戻る場合と、1 回で全部書く場合で、出力が 1 バイトも違わないことを確かめています。

履歴の上限に近づくほど loop が長い仕事では、別の手が要ります。公式ドキュメントが挙げているのは、Distributed Map を使うか、途中で新しい実行を起動して続きを渡すか、です。この章では、どちらも試していません。
