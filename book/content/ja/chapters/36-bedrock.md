---
title: "36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch"
revision: 1
---

# 36 Bedrock: tool use、構造化出力、Guardrails、prompt caching、inference profile、batch

[17章](/ja/chapters/17-ai.md)では、ノートを 1 件渡して要約を受け取りました。モデルを呼ぶのは 1 回で、返ってくるのは文章だけでした。

この章は、その先で必要になるものを扱います。モデルにノートを探させる tool use、決めた形の JSON を受け取る構造化出力、入力と出力を検査するガードレール、同じ先頭を使い回す prompt caching、利用者ごとの予算、急がない仕事を安く流す batch inference、そして変更のたびに回す評価です。題材は、自分のノートについて質問できるアシスタントです。

ノートを言葉や意味で探す検索、埋め込み、Knowledge Bases は [27章](/ja/chapters/27-search.md)で扱います。この章のツールは、ノートを一覧して 1 件ずつ読むだけです。

17章と同じく、手元ではモデルを呼びません。この章のテストと既定の開発サーバーは、手で書いた応答の列を再生するだけで、AWS には触れません。課金されるタスクは、出てくるたびにそう書きます。

Bedrock の機能は、使えるモデルとリージョンが月ごとに変わります。この章で「使える」「使えない」と書いていることは、すべて 2026-10-13 に公式ドキュメントで確かめた内容です。読むときには、モデルカードでもう一度確かめてください。

前提は 17章です。ノートの保存は [05章](/ja/chapters/05-dynamodb.md)、呼び出した人の確かめ方は [06章](/ja/chapters/06-auth.md)、ログの形は [19章](/ja/chapters/19-observability.md)のものを使います。コードは `examples/36-bedrock/` にあります。

## 全体像

<!-- section: 36.overview -->

```figure
caption: 関数はモデルを呼び、モデルが求めたツールを、呼び出した人の名義で実行する
node caller: Caller | 署名したリクエスト
node url: Lambda function URL | AWS_IAM, RESPONSE_STREAM
node fn: Lambda function | ループ、ツール、予算
node bedrock: Amazon Bedrock ConverseStream | inference profile とガードレール
node notes: DynamoDB Notes | 読むだけ
node usage: DynamoDB Usage | 利用者ごとの 1 日の使用額
edge caller -> url: HTTPS、SigV4
edge url -> fn: 署名した人の ID
edge fn -> bedrock: 質問、ツールの定義、結果
edge fn -> notes: その人のノートだけ
edge fn -> usage: 呼ぶ前に確保、あとで精算
mark fn
```

```figure
caption: モデルが文章で答えるまで、ツールの要求と結果が往復する
type: sequence
actor caller: Caller
actor fn: Lambda | ループ
actor bedrock: Bedrock
actor notes: Notes
step caller -> fn: 質問
step fn -> fn: 予算を確保
step fn -> bedrock: 質問とツールの定義
step bedrock --> fn: tool_use: read_note
step fn -> notes: 呼び出した人のノートを読む
step fn -> bedrock: 会話の全体と tool result
step bedrock --> fn: 文章の断片…, end_turn
step fn --> caller: delta…, done
step fn -> fn: 使った分で精算
```

17章の関数は、Bedrock から届くイベントを呼び出し元へ中継するだけでした。この章の関数は、モデルとのやり取りを何往復か続けます。モデルは「このノートを読みたい」と答えることがあり、そのときノートを読むのは関数です。読んだ結果を添えてもう一度モデルを呼ぶと、モデルは続きを考えます。この往復を、この章ではループと呼びます。

ループには、17章になかった心配があります。モデルが求めたとおりに動くコードなので、モデルに何を求めさせないかを決める必要があります。往復のたびに会話の全体を送り直すので、費用は回数に比例するより速く増えます。そして、何往復で終わるかはモデルが決めるので、止める条件をコードの側に持たなければなりません。

1 回呼んで文章を受け取るだけで足りるなら、17章の形のままにしてください。往復を増やすと、費用も、遅延も、失敗の種類も増えます。

## モデルごとに違うこと

<!-- section: 36.models -->

17章で、モデル ID の代わりに inference profile の ID を渡すこと、`jp.` で始まる profile なら推論が東京か大阪で動くことを見ました。この章でも同じ profile を使います。違うのは、使う機能が増えたことで、機能ごとに対応するモデルが違います。

17章で確かめた 2 つのモデルについて、この章の機能を並べます。確認日はすべて 2026-10-13 で、出典は各モデルのモデルカードと、機能ごとのページです。

| | Nova 2 Lite | Claude Haiku 4.5 |
| --- | --- | --- |
| 東京から呼ぶ経路 | Geo（`jp.`）と Global。In-Region は不可 | Geo（`jp.`）と Global。In-Region は不可 |
| ツール（client-side tool calling） | 対応 | 対応 |
| structured outputs | 非対応 | 対応 |
| Guardrails | 対応 | 対応 |
| prompt caching の下限と場所 | 1,000 トークン。`system` と `messages`。5 分 | 4,096 トークン。`system`、`messages`、`tools`。5 分か 1 時間 |
| CountTokens | 非対応 | 対応 |
| batch inference（東京） | cross-Region の profile 経由で対応 | cross-Region の profile 経由で対応 |
| 終了の目安（EOL no sooner than） | 2026-12-02 | 2026-10-16 |

表の中身は、コードではこう持っています。

<<< @/examples/36-bedrock/src/models.ts{profile}

<<< @/examples/36-bedrock/src/models.ts{profiles}

この表が必要になるのは、同じ `Converse` API でも、モデルによって送ってよいフィールドが違うからです。structured outputs に対応しないモデルには、JSON Schema を渡す頼み方が使えません。モデルを替えるときに変わるのは ID だけではないので、ID と一緒に、そのモデルでできることを 1 か所に書いておきます。

### リージョンの外へ出るもの

`jp.` の profile を使うと、リクエストは東京か大阪で処理されます。公式ドキュメントは、地域の profile について次のように書いています。データが保存されるのは既定では呼び出したリージョンだけですが、入力と出力は、推論のあいだ呼び出したリージョンの外へ動くことがあります。不正利用の検出のために保存される場合は、処理したリージョンに保存されます。リージョンのあいだの通信は AWS のネットワークの中で、暗号化されます。どのリージョンで処理されたかは、CloudTrail の `additionalEventData.inferenceRegion` に記録されます。

`global.` の profile は、世界中の商用リージョンのどれかで処理します。料金は地域の profile よりおよそ 10% 安くなります。日本の外へ出してよいデータかどうかを、先に決めてください。

行き先は、モデルだけの話ではありません。ガードレールにも同じ仕組みがあり、行き先のリージョンはモデルの profile と一致しません。[実装のつづき](/ja/chapters/36-bedrock/more.md)で扱います。

### モデル ID をコードに書かない

モデルにはライフサイクルがあります。状態は Active、Legacy、End-of-Life の 3 つで、Legacy になると新しい利用者は使い始められなくなり、既存の利用者も 15 日使わないとアクセスを失うことがあります。終了日を過ぎると、そのモデルへのリクエストは失敗します。別のモデルへ自動で切り替わることはありません。

モデルカードには「EOL no sooner than」の日付が載っています。この日より前には終了しない、という約束です。Claude Haiku 4.5 のその日付は 2026-10-16 で、この章を書いている日の 3 日後です。終了が決まったわけではありませんが、約束の期間は終わります。

そのため、アプリのコードはモデルの名前を知りません。モデル ID が入ってくる場所は、環境変数の 1 か所だけです。

<<< @/examples/36-bedrock/src/env.ts{env}

`BEDROCK_MODEL_ID` に、上の表にない ID を渡すと、アプリは起動しません。できることと単価を書いていないモデルでは、JSON の頼み方も、予算の計算も決められないからです。モデルを替える作業は、表に 1 行足し、評価を回し、環境変数を変える、という順になります。

終了までの日数は、表から計算できます。

<<< @/examples/36-bedrock/src/models.ts{lifecycle}

Bedrock には、自分で作る inference profile（application inference profile）もあります。モデルか、既存の cross-Region の profile を指す名前で、タグを付けて費用を分けられます。この章では使っていません。IAM に書く ARN の種類が増えるのに対して、この章が欲しい「ID を 1 か所に置く」は環境変数で足りるからです。費用をチームや機能ごとに分けたくなったら、検討してください。

Bedrock には、この章が使う `bedrock-runtime` のほかに `bedrock-mantle` というエンドポイントがあり、Converse のほかに Responses API と Chat Completions API があります。この章は `bedrock-runtime` と Converse だけを使います。ガードレールが `bedrock-mantle` に対応していないことと、17章のコードの続きとして書けることが理由です。

## エージェントのサービスを使わない理由

<!-- section: 36.agents -->

ループを自分で書かずに済ませるサービスも、AWS にあります。

Amazon Bedrock Agents は、2026-07-30 から新しい利用者を受け付けていません。名前は Agents Classic に変わり、保守だけが続いています。公式ドキュメントが移行先として挙げているのは Amazon Bedrock AgentCore です。

AgentCore は 1 つのサービスではなく、部品の集まりです。モデルとツールを設定で渡すとループを回してくれる Harness、エージェントのコードを動かす Runtime、API や Lambda の関数を MCP のツールとして見せる Gateway、会話をまたいで覚えておく Memory、利用者の認証をつなぐ Identity、コードを実行するサンドボックス、ブラウザなどがあります。固定した版の cdkd（0.296.28）も、Runtime など一部のリソースに専用の実装を持っています。

それでも、この章はループを自分で書きます。

ループの本体は 100 行ほどで、その中に、この章でいちばん大事な決まりが入っています。ツールは呼び出した人のノートしか読めない、という決まりです。自分のコードにあれば、テストで壊そうとして確かめられます。サービスに任せると、その決まりは設定と別のサービスの権限に移り、確かめる方法が変わります。

自分で書けば、決まった順序の失敗を手元で再現できます。ツールの要求の途中でストリームが切れる、モデルが存在しないツールを呼ぶ、といった場面を、モデルを呼ばずに何度でも試せます。

動く部品も増えません。この章のスタックは、17章のものにテーブル 2 つとガードレールを足しただけです。

AgentCore を検討するのは、ループの外側が要るようになったときです。何十分も続く作業、モデルが書いたコードの実行、ブラウザの操作、多数のツールの管理、会話をまたぐ記憶などがそれにあたります。この章は AgentCore を動かしていないので、使い勝手については何も言えません。
