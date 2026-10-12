---
title: "50 AgentCore: エージェントの実行環境、記憶、ツール、認証"
revision: 1
---

# 50 AgentCore: エージェントの実行環境、記憶、ツール、認証

[36章](/ja/chapters/36-bedrock.md)では、モデルにツールを使わせるループを自分で書き、Lambda で動かしました。Amazon Bedrock AgentCore は、そのループを置く場所と、まわりに要るもの（セッションごとの実行環境、記憶、ツールへの入口、認証、観測）を引き受けるサービスの集まりです。この章で伝えたいことは 1 つです。ループを AgentCore に預けても、「いまだれのために動いているか」を決めるのは自分のコードのままです。AgentCore はセッションを microVM で分けますが、そのセッションがだれのものかは確かめません。

この章では、36章のループとツールをそのまま使い、AgentCore Runtime が求める HTTP の形に包んで、会話の記憶を AgentCore Memory に置きます。フレームワークは使いません。コードは `examples/50-agentcore/` にあり、モデルとの接点は 36章の `ModelGateway` です。

料金は使った分だけで、この章のスタックは、セッションが 1 つもなければ AgentCore の料金がかかりません。ただし、セッションは最後の呼び出しのあともアイドルのあいだ生きていて、そのあいだのメモリに料金がかかります。金額は[費用のページ](/ja/chapters/50-agentcore/wrap.md)にまとめました。この章のスタックは AWS に一度もデプロイしていないので、AgentCore の動きについて書いていることは、すべて 2026-10-13 に読んだドキュメントによります。

前提は 36章のループ、[06章](/ja/chapters/06-auth.md)のサインイン、[21章](/ja/chapters/21-security.md)の最小権限です。モデルそのものは [56章](/ja/chapters/56-nova.md)、コーディングエージェントを隔離して動かす話は [63章](/ja/chapters/63-agent-sandbox.md)が扱います。

## AgentCore とは

<!-- section: 50.what -->

AgentCore は 2025 年 10 月 13 日に一般提供になりました。ドキュメントは「どのフレームワークでも、どのモデルでも」使えるエージェントの基盤と説明していて、部品は別々に使えます。Bedrock のモデルを呼ぶための API（17章と 36章の Converse）とは別のサービスで、エンドポイントも IAM のアクションの接頭辞（`bedrock-agentcore:`）も別です。

東京（`ap-northeast-1`）では、2026-10-13 の時点で、支払いの機能（AgentCore payments）を除くすべての部品が使えると、リージョンの表に載っています。

エージェントのコードを置く方法は 2 つあります。1 つはコンテナイメージ（ARM64、2 GB まで）で、もう 1 つは ZIP にまとめたコード（direct code deployment）です。ZIP で使えるランタイムは Python 3.10 から 3.14 と Node.js 22 で、Node.js の場合は `/invocations` と `/ping` を持つ HTTP サーバーの `.js` ファイルを起点にします。TypeScript はそのままでは動かないので、JavaScript にしてから入れます。この章は ZIP を選びました。Nix の shell に Docker の daemon が無くても、バンドルから synth まで手元で確かめられるからです。

フレームワークについて、ドキュメントは LangGraph、Strands Agents、CrewAI などを挙げたうえで、特定のフレームワークを使わないエージェントでもよいと書いています。Runtime がコードに求めるのは HTTP の約束だけです。TypeScript の SDK（npm の `bedrock-agentcore`）と、TypeScript のプロジェクトを作れる CLI（`@aws/agentcore`）もありますが、この章では使いません。約束が小さいので、04章の部品で足ります。

## 部品の一覧

<!-- section: 50.components -->

ドキュメントの概要のページに載っている名前で並べます。「この章」の列は、この章のスタックが使うかどうかです。

| 名前 | 役割 | この章 |
| --- | --- | --- |
| Runtime | エージェントやツールのコードを、セッションごとの microVM で動かす | 使う |
| Memory | 会話のイベント（短期記憶）と、そこから取り出したレコード（長期記憶）を預かる | 短期記憶だけ使う |
| Identity | エージェントを呼べる人を決め、エージェントが外部のサービスを呼ぶための認証情報を預かる | Runtime の JWT の検査として使う |
| Gateway | API、Lambda 関数、既存の MCP サーバーを、MCP のツールとして 1 つの入口にまとめる | 使わない |
| Observability | メトリクス、ログ、スパンを CloudWatch に出す | 既定のメトリクスとログだけ |
| harness | モデル、ツール、指示を宣言すると、ループを AgentCore が回す | 使わない |
| Code Interpreter | エージェントが書いたコードを動かすサンドボックス | 使わない |
| Browser | エージェントが操作するブラウザ | 使わない |
| Policy | Gateway を通るツールの呼び出しを、ポリシーで許可・拒否する | 使わない |
| Evaluations、Optimization | エージェントの出力を評価し、設定の改善案を出す | 使わない |
| Registry | 組織の中のエージェント、MCP サーバー、ツールのカタログ | 使わない |
| Payments | エージェントが有料の API に少額の支払いをする | 東京では使えない |

一般提供かプレビューかは、リリースノートと発表で確かめました。サービス全体は 2025 年 10 月、Policy と Evaluations は 2026 年 3 月、harness は 2026 年 6 月 17 日、Registry は 2026 年 8 月に一般提供になっています。Memory だけを名指しした記述は見つけていませんが、プレビューの注記もありません。Optimization のうち Failure Insights はパブリックプレビューです。Runtime の Instances（自分のアカウントの EC2 で動かす方式）と、プラットフォームバージョン V2 については、一般提供かプレビューかを書いた記述を見つけられませんでした。

Runtime には、この章に関係する数字がいくつかあります。どれも 2026-10-13 にクォータのページで読んだ値で、変わることがあります。最新の値は [Quotas for Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/bedrock-agentcore-limits.html) にあります。

- 1 セッションに割り当てられるのは 2 vCPU と 8 GB まで
- 同期のリクエストは 15 分まで、ストリーミングは 60 分まで、ペイロードは 100 MB まで
- セッションは、アイドルが 15 分続くか、起動から 8 時間たつと終わる（どちらも設定で変えられる）
- 同時に動かせるセッションは、東京ではアカウントあたり 2,500（引き上げを申請できる）
- 新しいセッションを作れるのは毎秒 25 まで、データプレーンの API は合わせて毎秒 1,000 リクエストまで
- ZIP は圧縮して 250 MB、展開して 750 MB まで

## 36章のループから変わること

<!-- section: 50.takes-over -->

36章では、Lambda の function URL がリクエストを受け、関数の中でループが回りました。この章でも、ループとツールは同じファイルです。変わるのは、その外側です。

```figure
caption: クライアントは AgentCore Runtime を呼び、Runtime がセッションの microVM の中のエージェントを呼ぶ
node client: Client | access token
node runtime: AgentCore Runtime | JWT authorizer
node agent: Agent process | session microVM
node model: Bedrock | ConverseStream
node notes: DynamoDB | notes
node memory: AgentCore Memory | events
edge client -> runtime: InvokeAgentRuntime
edge runtime -> agent: POST /invocations
edge agent -> model: 36章のループ
edge agent -> notes: Query, GetItem
edge agent -> memory: CreateEvent, ListEvents
group aws: AWS account = runtime, agent, model, notes, memory
mark agent
```

AgentCore が引き受けるのは次のことです。

- **置き場所。** コードを渡すと、Runtime が microVM を用意し、ポート 8080 の HTTP サーバーとして起動して、`POST /invocations` で呼びます。スケーリングとパッチ（ZIP の場合は Node.js のランタイムまで）は AWS の仕事になります
- **セッションの分離。** セッション ID ごとに専用の microVM が割り当てられ、CPU、メモリ、ファイルシステムが分かれます。セッションが終わると microVM は破棄されます。Lambda では 1 つの実行環境が、別の利用者のリクエストを順番に処理していました
- **長いセッション。** 同じセッション ID の呼び出しは同じ microVM に届くので、プロセスのメモリやファイルに会話の状態を持てます。microVM は最長 8 時間生きます
- **入口の認証。** Runtime の手前で、IAM の署名か JWT のどちらかを検査します。06章では API Gateway の JWT オーソライザーがしていた仕事です
- **記憶。** Memory が、actor とセッションごとにイベントを保存します。テーブルを自分で設計しなくて済みます
- **観測。** 呼び出しの数や時間のメトリクスと、標準出力のログが CloudWatch に出ます

かわりに、自分で決められなくなること、見えなくなることがあります。

- HTTP の形は決まっています。ポートは 8080、パスは `/invocations` と `/ping` で、ARM64 だけです。ZIP で使える Node.js は 22 だけで、この本のほかの章が使う 24 ではありません
- microVM がいつ作られていつ消えるかは、2 つのタイムアウトを通してしか決められません。プロセスのメモリに置いたものは、アイドルが続けば消えます
- エージェントが自分で返した 4xx や 5xx は、ドキュメントによれば、呼び出した側には 424（`RuntimeClientError`）として届きます。自分で決めたステータスコードが、そのままクライアントに届くわけではありません
- すべての利用者のすべてのセッションが、1 つの実行ロールで動きます。microVM の中のコードは、メタデータのサービスからそのロールの認証情報を取れます。利用者ごとに権限を分ける仕組みは、IAM の側にはありません

最後の点が、次の節の話です。

ループそのものも預けたいときは、harness があります。モデル、ツール、指示を宣言すると AgentCore がループを回し、Runtime の microVM がその実行環境になります。ツールは、MCP サーバー、Gateway、Browser、Code Interpreter のほか、呼び出した側で実行するインライン関数として渡せます。この章が harness を使わないのは、ループの 1 手ごとに何を止めるかを 36章で自分で決めていて、それを見える形のまま残したいからです。

## 境界はどこにあるか

<!-- section: 50.boundary -->

36章から持ち越す不変条件は、「利用者の代わりに動くエージェントは、その利用者のノートにしか届かない」です。36章では、ツールを作るときに持ち主を固定し、モデルが書いた入力には持ち主を入れさせないことで守りました。ループを Runtime に移すと、同じ条件を脅かす場所が 3 つ増えます。

1 つ目は、だれが呼んでいるかです。Runtime の JWT オーソライザーは、トークンの署名、発行者、クライアントを検査します。検査を通ったトークンを、エージェントのコードまで渡してもらう設定（リクエストヘッダーの許可リストに `Authorization` を入れる）をすると、コードはトークンの `sub` を読めます。持ち主はこの `sub` で、リクエストのボディに書かれた値ではありません。Runtime には、利用者の ID をヘッダー（`X-Amzn-Bedrock-AgentCore-Runtime-User-Id`）で渡す別の方法もありますが、ドキュメントはこの値を「検証しない」と明記していて、この章では使いません。

2 つ目は、セッションです。Runtime はセッション ID で microVM を選びますが、ドキュメントは「AgentCore はセッションと利用者の対応を強制しない。対応はクライアントのバックエンドが持つこと」と書いています。有効なトークンを持つ Bob が Alice のセッション ID を付けて呼ぶと、Runtime はそのリクエストを Alice の microVM に届けます。そこには Alice の会話が残っています。

```figure
type: sequence
caption: Runtime はトークンを検査するが、セッション ID がだれのものかは見ない。断るのはエージェントのコード
actor bob: Bob
actor runtime: Runtime
actor agent: Agent | Alice のセッション
step bob -> runtime: Bob のトークン、Alice の ID
note runtime: ID の持ち主は見ない
step runtime -> agent: POST /invocations
step agent -> agent: ownsSession(sub, id)
step agent -x bob: 403
```

この章では、セッション ID の先頭に持ち主の ID のダイジェストを入れる決まりにして、エージェントがリクエストのたびに確かめます。ほかの利用者のセッション ID は、知っていても使えません。

3 つ目は、記憶です。Memory のイベントは actor とセッションで区切られていて、IAM には `bedrock-agentcore:actorId` という条件キーもあります。ところが条件キーが照合するのは Memory を呼ぶ IAM のプリンシパルで、この構成ではどの利用者のセッションでも同じ実行ロールです。ドキュメントも、IAM の条件は JWT の利用者を表せないと書いています。どの actor のイベントを読むかは、エージェントのコードが、検査済みの `sub` から決めます。

まとめると、AgentCore が引く境界はセッションとセッションのあいだにあり、利用者と利用者のあいだにはありません。利用者の境界は、トークンの `sub` を 3 か所（ツール、セッション ID、Memory の actor）に同じように通す、自分のコードが引きます。[しくみと実装](/ja/chapters/50-agentcore/build.md)で、その 3 か所と、壊そうとするテストを見ます。

## 使う場面と、使わない場面

<!-- section: 50.when -->

AgentCore Runtime が合うのは、会話が何往復も続き、その途中の状態をプロセスやファイルに持ちたいとき、処理が Lambda の 15 分に収まらないとき、エージェントが書いたコードやブラウザを動かすので、セッションごとに強く分けたいときです。

1 問ごとに完結する質問応答なら、36章の Lambda のままで足ります。部品が少なく、料金も呼び出した時間だけです。会話の履歴が要るだけなら、36章の構成に DynamoDB の項目を 1 つ足す方法もあります。

Gateway は、同じツールをいくつものエージェントから使うときや、すでにある API を MCP のツールとして見せたいときに役に立ちます。この章のツールは 2 つで、エージェントと同じプロセスの中にあるので、Gateway を通しません。通す場合は、利用者の ID をツールまで届ける経路を別に用意することになります。Lambda をターゲットにしたとき関数に渡る値として、ドキュメントが挙げるのはツールの入力と、Gateway やツールの名前だけで、利用者を表す値は載っていません。`Authorization` ヘッダーをターゲットに渡すには、インターセプターの Lambda を置くと書かれています。

Cloudflare と Vercel にも、エージェントのための機能があります。2026-10-13 にそれぞれのドキュメントを読みました。

Cloudflare の Agents は、エージェントの 1 つ 1 つを Durable Object に対応させます。エージェントごとに SQLite のデータベースがあり、WebSocket の接続と予定された処理を持てて、アイドルのあいだは眠り、そのあいだの時間には料金がかかりません。状態がエージェントと同じ場所にあるので、Memory にあたる別のサービスは要りません。分離の単位は Durable Object で、AgentCore のようなセッションごとの microVM ではありません。任意のコードを動かす用途には、別に Sandbox SDK があります。アプリがすでに Workers にあり、エージェントが呼ぶのが自分の API とモデルだけなら、Agents のほうが部品は少なく済みます。

Vercel では、AI SDK がループを部品として用意しています（`ToolLoopAgent`）。信頼できないコードを動かす場所として Vercel Sandbox（Firecracker の microVM）があり、I/O を待つ時間を CPU の料金に数えない点は AgentCore Runtime と同じ考え方です。途中で止まって再開する処理には Workflow があります。「セッションごとの microVM でエージェントを預かる」という 1 つの製品は、読んだ範囲では見当たりませんでした。

AgentCore を選ぶ理由になるのは、エージェントが AWS の中のデータに、鍵を配らずに IAM のロールで届くことと、セッションごとの microVM、記憶、認証が同じアカウントの中で揃うことです。部品が増えるぶん、この章で見るように、自分で通す境界も増えます。
