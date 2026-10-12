---
title: "50 AgentCore: しくみと実装"
---

# 50 AgentCore: しくみと実装

このページでは、36章のループを AgentCore Runtime の HTTP の約束に包むところから始めて、[最初のページ](/ja/chapters/50-agentcore.md)で挙げた 3 つの境界（だれが呼んでいるか、セッション、記憶）を順に実装し、最後にスタックを見ます。

## Runtime が求める HTTP の形

<!-- section: 50.contract -->

Runtime がエージェントに求めるのは、`0.0.0.0:8080` で待つ HTTP サーバーと、2 つのパスです。`GET /ping` は生きているかどうかを答え、`POST /invocations` が呼び出しを受けます。`/invocations` のボディの中身を、AgentCore は決めていません。ドキュメントの例は `{"prompt": "..."}` ですが、エージェントごとに自分で決めるものです。

この章のボディは、プロンプト 1 つだけです。

<<< @/examples/50-agentcore/src/contract.ts{payload}

`v.strictObject` にしているので、`owner` や `messages` を足したボディは 400 になります。プロンプトを文字列に限っているのは、AgentCore のセキュリティの手引きにある注意に従ったものです。フレームワークによっては、入力に紛れた `toolUse` のブロックをそのままツールの実行に回すことがあり、手引きは `prompt` が文字列であることを確かめるよう求めています。この章のループはそもそも入力を文字列としてしか扱いませんが、入口で断っておきます。

`/ping` は 1 行です。

<<< @/examples/50-agentcore/src/agent.ts{ping}

`status` には `Healthy` のほかに `HealthyBusy` があり、`HealthyBusy` を返しているあいだ、Runtime はそのセッションを使用中とみなして終わらせません。裏で仕事を続けるエージェントのための値です。この章のエージェントは呼び出しの外では何もしないので、常に `Healthy` を返します。間違って `HealthyBusy` を返し続けると、セッションは最長の寿命まで生き、そのあいだのメモリに料金がかかります。

`/invocations` は、リクエストを確かめてから、36章のループを呼びます。確かめる順序は次のとおりで、どれかで断ったときはモデルを呼びません。

<<< @/examples/50-agentcore/src/agent.ts{guard}

ループを呼ぶところは、36章の `app.ts` とほとんど同じです。

<<< @/examples/50-agentcore/src/agent.ts{invoke}

ツールは、36章の `createNoteTools` を、このリクエストの利用者で作ります。セッションに作り置きはしません。答えは 36章と同じイベント（`delta`、`tool`、`done`、`error`）を server-sent events で返します。Runtime の HTTP の約束は、JSON の応答と `text/event-stream` の応答の両方を認めています。

## だれが呼んでいるか

<!-- section: 50.identity -->

スタックは Runtime に JWT オーソライザーを設定し、`Authorization` ヘッダーをエージェントまで通します。エージェントは、届いたトークンから利用者を読みます。

<<< @/examples/50-agentcore/src/identity.ts{claims}

<<< @/examples/50-agentcore/src/identity.ts{forwarded}

この関数は署名を検査しません。検査は Runtime が済ませていて、microVM のポート 8080 に届くリクエストは Runtime を通ったものだけ、というドキュメントの説明に立っています。AWS の手引きにも、エージェントの側では署名の検証を省いてよいと書かれています。発行者とクライアント ID を照らし合わせているのは、オーソライザーの設定とコードの設定が食い違ったときに止めるためで、署名の代わりにはなりません。テストには、署名がでたらめなトークンをこの関数が受け入れることを、わざと固定してあります。この関数を検証器だと思って別の場所で使わないためです。

Runtime の外では、この関数は何も証明しません。手元のサーバーは、06章のローカルのサインイン（署名を検証します）を使います。どちらも 06章の `Authenticate` の形をしているので、エージェントの本体は、どちらが渡されたかを知りません。

## セッション ID を持ち主に結びつける

<!-- section: 50.session-id -->

Runtime はセッション ID を 33 文字以上の文字列としか見ません。この章では、ID の作り方に決まりを 1 つ足します。先頭の 32 文字を、利用者の ID の SHA-256 から取ります。

<<< @/examples/50-agentcore/src/session-id.ts{session-id}

エージェントは、リクエストのたびに、トークンの `sub` からダイジェストを計算し直して、セッション ID の先頭と比べます。合わなければ 403 を返します。ダイジェストは秘密ではありません。Alice のセッション ID を Bob が知っていても、Bob の `sub` からは同じ先頭ができないので、使えないということです。

はじめは、プロセスの中に「このセッションを最初に開いた利用者」を覚えておく実装を考えました。それだと、microVM が入れ替わったあと、先に呼んだほうが持ち主になります。Bob が Alice のセッション ID で先に呼ぶと、会話は漏れませんが、Alice が自分のセッションから締め出されます。ID そのものに持ち主を入れておけば、覚えておくものが無く、プロセスが入れ替わっても答えは変わりません。

Bob のリクエストは、断られるまえに Alice の microVM に届いています。Runtime がセッション ID だけで振り分けるからです。エージェントは、利用者を確かめるまえにセッションの状態に触らない順序で書いてあります。同じ決まりをクライアントの側（セッション ID を作る側）でも守る必要があり、`newSessionId` はスクリプトと手元のサーバーが使っています。

## セッションの記憶

<!-- section: 50.memory -->

会話の 2 問目に答えるには、1 問目のやりとりが要ります。この章は、やりとりを 1 種類のイベントとして記録し、状態はイベントを畳み込んだ結果として持ちます。

<<< @/examples/50-agentcore/src/session.ts{event}

<<< @/examples/50-agentcore/src/session.ts{reduce}

`reduce` が受け付けるのは、次の番号のイベントだけです。同じイベントが 2 回届いても（書き込みの再試行）、番号が飛んでいても（途中のイベントが欠けた）、状態は変わりません。だから、ストアがイベントをどんな順序で、何回返しても、同じ状態になります。覚えておくのは直近の 6 往復で、答えは 2,000 文字で切ります。覚えたやりとりは次の質問のたびにモデルへ送り直すので、ここが 1 問あたりのトークンの上限を決めます。

覚えるのは、利用者の質問と、モデルが最後まで書き終えた答えの文章だけです。ツールが返したノートの中身は覚えません。次の質問で要るなら、そのときの利用者でもう一度読みます。途中で切れた答えと、ガードレールが止めた答えも覚えません。

<<< @/examples/50-agentcore/src/session.ts{history}

36章のループは、会話を質問 1 つから始めます。ループには手を入れず、モデルへの入口のほうを包んで、覚えているやりとりを先頭に足します。

<<< @/examples/50-agentcore/src/history.ts{with-history}

プロセスのメモリは、セッションの microVM と一緒に消えます。スタックの設定では、アイドルが 5 分続くと消えます。消えても続きから話せるように、イベントは AgentCore Memory の短期記憶に書きます。ストアのインターフェースは、どの呼び出しにも actor を取ります。

<<< @/examples/50-agentcore/src/memory-store.ts{store}

エージェントは、プロセスがそのセッションを初めて見たときに、ストアからイベントを読んで状態を作ります。

<<< @/examples/50-agentcore/src/agent.ts{open}

答えが完了したら、先にストアへ書き、書けたときだけプロセスの状態を進めます（上の `invoke` の `remember`）。ストアが断ったときは、答えは利用者に届けたうえで、覚えなかったことをログに残します。こうしておくと、プロセスが覚えていることは、いつもストアが受け取ったイベントを畳み込んだものと一致します。microVM が入れ替わっても、会話の続きが食い違いません。書き込みはセッションごとに 1 つずつ順番に行います。テストを書いたとき、同時に終わった 2 つの答えが同じ番号を取り、片方がストアから消えることが分かったためです。

AgentCore Memory との対応は、純粋な関数 2 つに分けてあります。

<<< @/examples/50-agentcore/src/memory-events.ts{write}

<<< @/examples/50-agentcore/src/memory-events.ts{read}

`clientToken` は、同じやりとりを 2 回書いても 1 回分しか保存されないようにするための値です。SDK の型定義には、前のリクエストと同じトークンなら、AgentCore はエラーを返さずにリクエストを無視すると書かれています。読む側は、返ってきたイベントが頼んだ actor とセッションのものかをもう一度確かめます。AWS を呼ぶのは次のアダプターだけで、手元でもテストでも使いません。

<<< @/examples/50-agentcore/src/agentcore-memory.ts{adapter}

この章が使うのは短期記憶だけです。長期記憶は、イベントから利用者の好みや要約などをモデルで取り出して保存する機能で、取り出しは裏で非同期に進みます。組み込みの方式は 4 つ（利用者の好み、意味、セッションの要約、エピソード）あります。会話に出てきたことが、セッションをまたいで残るようになるので、何が残り、いつ消えるかを決めてから使う機能です。

## スタック

<!-- section: 50.stack -->

スタックが作るのは、Runtime、Memory、実行ロール、ノートのテーブル、ユーザープールとクライアントです。

エージェントのコードは、synth のときに esbuild で 1 つの `app.js` にまとめます。

<<< @/examples/50-agentcore/infra/lib/bundle.ts{bundle}

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{code}

`s3assets.Asset` の `bundling` は、ふつうはコンテナの中でビルドするための設定ですが、`local.tryBundle` が成功すればコンテナは起動しません。`lambda-nodejs` の `NodejsFunction` が synth のときに esbuild を呼ぶのと同じ流れを、ここでは自分で書いています。出力を CommonJS にしているのは、ZIP の中には `package.json` が無く、Node.js が `.js` を CommonJS として読むからです。

Runtime の定義です。

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{runtime}

`authorizerConfiguration` を書かないと、Runtime は IAM の署名（SigV4）で呼び出しを受けます。IAM と JWT は、1 つの Runtime でどちらか一方です。IAM にした場合、エージェントに届くのは「この IAM のプリンシパルが呼んだ」ことまでで、アプリの利用者がだれかは届きません。`networkMode` の `PUBLIC` は、エージェントから外へ出る通信の話で、だれでも呼べるという意味ではありません。

`lifecycleConfiguration` は、アイドルで終わるまでを既定の 15 分から 5 分に、最長の寿命を 8 時間から 1 時間に縮めています。メモリの料金はセッションが終わるまでかかるので、アイドルの時間がそのまま費用になります。短くしすぎると、利用者が少し考えているあいだに microVM が消え、次の質問で起動と Memory の読み込みをやり直します。

プラットフォームバージョンは指定していないので、既定の V1 です。V2 は、用意した環境のスナップショットから起動する新しい方式で、東京でも使えます。ドキュメントには「CloudFormation と CDK は `platformVersion` の指定にまだ対応していない」とありますが、固定した版の `aws-cdk-lib`（2.273.0）の `CfnRuntime` にはその property があります。どちらが正しいかをデプロイして確かめていないので、この章では触っていません。

ユーザープールは、この章のためだけの小さなものです。

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{users}

サインインのページも、インターネットから呼べるパスワードの API もありません。トークンは、このアカウントの IAM の identity が `AdminInitiateAuth` で取ります。動作確認のための割り切りで、本物のアプリなら 06章のクライアントをここに書きます。

Memory は、方式を 1 つも持たない短期記憶だけのリソースです。

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{memory}

実行ロールです。

<<< @/examples/50-agentcore/infra/lib/agentcore-stack.ts{role}

信頼ポリシーは、`bedrock-agentcore.amazonaws.com` に、このアカウントとリージョンのリソースのためにだけ引き受けることを許します。ログとメトリクスのステートメントは、Runtime のガイドが実行ロールに挙げているものです。ガイドには X-Ray のアクションと `logs:PutResourcePolicy` も載っていますが、この章はトレースもログの配信も設定していないので入れていません。それで Runtime が起動するかどうかは確かめていません。

ノートのテーブルと Memory に対する権限は、テーブル全体、Memory 全体です。実行ロールは、どの利用者のノートも、どの actor のイベントも読めます。IAM ではここまでしか絞れないので、絞るのはコードです。スタックのテストは、この前提を崩す変更（書き込みの権限が増える、`*` が増える）を止めます。

<<< @/examples/50-agentcore/infra/test/agentcore-stack.test.ts{resource-types}

固定した版の cdkd（0.296.28）は、`AWS::BedrockAgentCore::Runtime` に専用の実装を持っています。ただし、その実装が書き込む property に `RequestHeaderConfiguration` が無く、cdkd は、専用の実装が扱わない property を持つリソースを Cloud Control API 経由に回します。`AWS::BedrockAgentCore::Memory` と `AWS::Cognito::UserPoolClient` には専用の実装が無く、同じく Cloud Control API 経由です。ユーザープール、テーブル、ロール、ポリシーには専用の実装があります。
