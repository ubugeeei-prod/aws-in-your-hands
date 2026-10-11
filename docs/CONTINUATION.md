# 継続プロンプト / Continuation prompts

このリポジトリを編集できる agent に、そのまま渡せる指示です。`[CHAPTER_ID]` と `[SCENARIO_ID]` を置き換えて使います。どちらの言語で渡しても、作るのは日英両方です。

00章から 24章まで、全 25 章の本文とサンプルが日英で書き上がっています。どの章も手元の検査（`vp run check:all`）は通っていますが、AWS に対しては、どの章も一度も deploy も実行もしていません。本のサイトも未デプロイです。

なので、次の仕事は章を書くことではなく、**実環境の検証**です。残っている項目は `data/validation.json` の `open` にあり、進める順序の提案はこのファイルの末尾にあります。

## 章を足す、書き直す

新しい章を足すときと、既存の章を大きく書き直すときに使います。

```text
このリポジトリの CONTRIBUTING.md、docs/EDITORIAL.md、data/chapters.json、data/sources.json、
既存の examples/ を読み、章 [CHAPTER_ID] を日英で書いて（既存の章なら書き直して）ください。

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
残る制約、次にやるべき検証を報告してください。
```

```text
Read CONTRIBUTING.md, docs/EDITORIAL.md, data/chapters.json, data/sources.json, and the existing
examples/ in this repository. Write chapter [CHAPTER_ID] in Japanese and English, or rewrite it if
it already exists.

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
what was verified, the remaining constraints, and the validation that should come next.
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

`data/validation.json` の `open` にある項目は、互いに依存しています。次の順で進めると、後の検証が前の結果を使えます。どれも未実行で、ここに書いたのは順序の提案です。実行するのは、明示的に許可された学習用のアカウントでだけにしてください。

### 先に答えを出したい 5 つ

外れていた場合に、複数の章のコードや本文を直すことになる項目です。下の順序は、これらが早く出るように組んであります。

1. **ESM の Lambda bundle が、Lambda の runtime で読み込めるか。** 05・06・07・08・15・16・17・19・22章の関数は、AWS SDK を含む ES module の bundle に `require` の shim を足してあります（各章の `infra/lib/*-stack.ts`）。手元の Node.js で読み込めることは `vp run bundles:check` が見ていますが、Lambda の上では未確認です。段階 3 の 05章で最初に当たります。ここで読み込みに失敗したら、9 つの章に同じ直しが要ります。この項目は、まだ `open` に独立した項目として入っていません。検証を始めるときに足してください
2. **S3 への form POST のイベントに sequencer が入るか**（`async-s3-event-shape`）。入らなければ、08章の worker は作成イベントをすべて失敗にして、DLQ へ送ります。順序づけを `eventTime` と `eTag` に替えるか、通知を EventBridge 経由に替えることになり、22章の修復にも響きます。段階 4
3. **11章の VPC を、別の CDK アプリから `Fn::ImportValue` で読めるか**（`11-cross-stack`）。12・23・24章の前提です。11章の既定の構成は固定費がかからないので、時間課金の章より先に、段階 5 で確かめます
4. **Amazon Linux 2023 の repository に、S3 の gateway endpoint だけで届くか**（`23-first-boot`）。届かなければ、23章と 24章の既定の構成（private subnet）は、最初の起動で `dnf` が止まります。段階 7
5. **ElastiCache Serverless の public endpoint と IAM 認証**（`14-elasticache`）。`ConnectionType: public`、既定の user group、自作の SigV4 token、どれも実機で通していません。段階 6

### 順序

**段階 0: 認証情報と、読むだけの確認。**

- `account:whoami`: AWS SDK が `aws login` の認証情報を読めるか（`sdk-aws-login`）
- `aws ec2 describe-availability-zones --region ap-northeast-1`: 既定の AZ 名が自分のアカウントで使えるか（`11-zone-names`）

**段階 1: cdkd の土台（02 → 03 → 本のサイト）。**

- `infra:bootstrap` → `hello:infra:deploy` → `hello:infra:drift`: cdkd の基本動作と、drift report の実際の形。採取した出力を `tools/src/drift/fixtures/` に加える（`drift-fixtures`、`cdkd-state-outputs`）
- 02章の drift の実験（コンソールで versioning を止める → 検出 → 解消 → 再検出）
- `spa:infra:deploy` → `spa:publish` → `spa:smoke` → `spa:infra:drift`: cdkd が `AWS::CloudFront::Function` を扱えるか（`cdkd-cloudfront-function`）
- `book:infra:deploy` → `book:publish` → `book:smoke`: 本のサイトの公開。03章と同じ種類のリソースなので、ここで続けて確かめられます

**段階 2: 最初の Lambda（04）。**

- `api:infra:deploy` → `api:smoke` → `api:logs`: Node.js 24 の runtime で bundle が動くか。04章の bundle は AWS SDK を含まないので、ここが通っても「先に答えを出したい」の 1 はまだ出ていません

**段階 3: SDK を含む bundle と、ノートのアプリ（05 → 06）。**

- `notes:infra:deploy` → `notes:smoke`: shim つきの bundle が cold start で読み込めるか。続けて、実環境で同時更新を試す（`dynamodb-conditional-writes`）
- `app:infra:deploy` → `app:user:create` → `app:publish` → ブラウザでサインイン → `app:smoke:api`（`cognito-sign-in`）

**段階 4: 画像の経路（07 → 08 → 22）。** 前の章の結果が、次の章の設計を決めます。

- 07: `uploads:infra:deploy` → `uploads:user:create` → `uploads:publish` → `uploads:smoke:api`。presigned POST の `tagging` の欄を S3 が受け付けるか（`uploads-s3-post-policy`）。拒否されたら、アップロード先を別の接頭辞にする設計に替えることになり、08章と 22章も変わります。lifecycle rule の確認（`uploads-lifecycle`）は 2 日かかるので、stack を残すならここで仕込みます
- 08: `async:infra:deploy` → `async:smoke`。08章の stack は 07章のコードを取り込んだ別の stack（`AihAsync`）なので、07章の stack が無くても deploy できます。sequencer と、bucket の名前を固定した通知の設定（`async-notification-deploy`）。記録ができなければ `async:queue` で DLQ を見る
- 22: `recovery:infra:deploy` のあと、本文「drill を実行する」の順（`22-drill`、`22-cutover`）。`-c backup=on` と `-c replica=on` は、置いてある間ずっと課金されるので、試したらすぐ消します

**段階 5: 置いてあるだけでは料金がほぼかからない章。** stack どうしは互いに依存していないので、順番は問いません。

- 09: `build:ssr` → `ssr:infra:deploy` → `ssr:assets:publish` → `ssr:smoke`（`ssr-aws-path`、`ssr-streaming-path`、`ssr-cdkd-cloudfront-policies`）
- 10: `edge:infra:deploy` → `aws cloudfront test-function` → `edge:publish` → `edge:kvs:sync`。Lambda@Edge は、`AIH_AWS_REGION=us-east-1 vp run infra:bootstrap` のあと `edge:body:infra:deploy`（`edge-function-on-real-runtime`、`kvs-stale-etag-error`、`kvs-propagation-time`、`cdkd-kvs-and-lambda-edge`）
- 11（既定の構成）: `net:infra:deploy` → `net:infra:drift`。続けて、`importNetwork` を使う小さな stack を別のアプリから deploy して、cross-stack の参照と、export が残っている間の destroy の拒否を確かめる（`11-deploy`、`11-cross-stack`）
- 13: `sql:infra:deploy` → `sql:db:migrate` → `sql:db:grant` → `sql:smoke`（`dsql-real-cluster`、`cdkd-dsql-cluster`、`dsql-dpu-estimate`）
- 14（既定の DynamoDB 版）: `kv:infra:deploy` → `kv:smoke` → `kv:infra:drift`（`14-deploy`）
- 15: `mail:infra:deploy -c fromAddress=...` → `mail:send`。実際にメールが送られます（`ses-send-and-events`、`ses-cdkd-cloud-control`、`email-dynamodb-claim`）
- 16: `export:infra:deploy` → `export:seed --notes 250` → `export:start --id check-1 --wait`。durable function 版は `-c durable=true` で別に（`16-deploy`、`16-durable`）
- 17: `ai:hello` → `ai:test:live` → `ai:infra:deploy` → `ai:smoke`。モデルを呼ぶたびに token の数だけ課金されます（`17-live-inference`、`17-deployed-streaming`）
- 19: `obs:infra:deploy` → `obs:smoke` → `obs:query`。Lambda の JSON ログの実際の形に、metric filter と query が依存しています（`obs-lambda-json-log-shape`、`obs-otel-layer-node24`、`obs-alarm-behavior`）
- 20: `ship:cfn:bootstrap` → `ship:cfn:diff` → `ship:cfn:deploy` → `ship:smoke` → `ship:cfn:status` → `ship:cfn:drift`。OIDC の role（`ship:ci:deploy`）は GitHub の repository が要るので、公開先が決まってから（`20-cfn-deploy`、`20-drift-live`、`20-rollback-live`、`20-oidc-roles`）
- 21（既定の構成）: `sec:infra:deploy` → `sec:smoke` → `sec:secret:rotate` → `sec:smoke`。`sec:posture` と `sec:trail:iam` は読むだけ（`21-deploy`、`21-rotation`、`21-iam-propagation`、`21-posture`）

**段階 6: 置いてあるだけで課金される、小さめのもの。** 1 つずつ deploy して、確かめたらその日のうちに消します。

- 14 の Valkey 版: `kv:infra:deploy -c store=valkey` → `kv:smoke` → `kv:infra:destroy -c store=valkey`（`14-elasticache`）
- 18: `stream:infra:deploy` → OBS で配信 → 視聴 → `stream:stop` → `stream:status --expect-offline` → `stream:infra:destroy`（`18-live-broadcast`）
- 21 の web ACL と customer managed key: `sec:waf:infra:deploy`、`sec:infra:deploy -c cmk=on`（`21-waf`、`21-cmk`）

**段階 7: 時間で課金される構成（11 → 12 → 23 → 24）。** 11章の stack を土台にして、上に 1 つずつ載せます。消すのは逆の順です。

- 12: `net:infra:deploy` → `ecs:infra:deploy` → `ecs:image:push v1` → `ecs:infra:deploy -c imageTag=v1` → rolling update の観察 → `ecs:infra:destroy`。Docker の daemon が要ります（`12-image-build`、`12-deploy`、`12-rolling-update`）。`-c taskSubnets=private` の構成は、そのあとで（`12-private-subnets`）
- 23: `net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages` → `ec2:infra:deploy` → `ec2:status`（最初の起動の結果）→ `ec2:app:release` → `ec2:smoke`。続けて、instance の作り直しと snapshot からの restore（`23-deploy`、`23-first-boot`、`23-release`、`23-replace-and-restore`、`23-ssm-endpoints`）
- 24: 同じ endpoint のまま、`celld:fetch --host` → `celld:infra:deploy -c nodes=1` → `celld:artifacts` → `celld:install` → `celld:app-deploy` → `celld:start` → `celld:smoke`。通ったら `-c nodes=3` で drain、rollout、node の喪失、backup と restore（`24-deploy`、`24-fleet-operations`）。celld の新しい release を使うなら、先に `24-recheck-celld`

**段階 8: 片付け。** 各 `*:unpublish`、`*:empty`、`*:infra:destroy` を実行して、残るものを確かめます。11章の stack は、12・23・24章の stack を消してから、最後に消します。

### 料金の注意

金額は、どれも章の本文にある定価です（東京、USD、730 時間）。実測ではありませんし、無料枠は引いていません。

- **11章**: 既定の構成は、置いてあるだけでかかるものがありません。NAT Gateway を 1 つ足すと月におよそ USD 49、interface endpoint は 1 つ（2 つの AZ）で月 USD 20.44、3 つで月 USD 61.32 です。23章と 24章でいちばん高い部品は、この endpoint です。`net:infra:destroy` で消すか、`-c` なしで deploy し直して endpoint を外すまで、instance を止めても消しても続きます
- **12章**: 既定の構成で、リクエストが 0 でも月 USD 50.33（1 日 USD 1.65）。ALB、Fargate の task 2 つ、public IPv4 アドレス 4 つです。task を private subnet に置くと、11章の側と合わせて月 USD 92.07（NAT Gateway 1 つ）か USD 104.37（interface endpoint 3 つ）になります
- **23章**: 既定の構成（private subnet と endpoint 3 つ）で 1 日およそ USD 2.33、月 USD 70.74。instance を止めても月 USD 62.86 かかり続けます。`-c placement=public` なら月 USD 13.07 です
- **24章**: 既定は node が 0 台で、時間課金はありません。1 台で 1 日およそ USD 2.71（月 USD 82.56）、3 台で 1 日 USD 4.11（月 USD 125.03）。3 台とも止めても月 USD 65.93。既定のまま stack を消すと、残った data volume 3 つに月 USD 2.30 かかります
- **14章**: `-c store=valkey` は、使わなくても月 USD 7.37（ElastiCache Serverless の最小課金）。既定の DynamoDB 版は、置いてあるだけなら 0 です
- **18章**: 配信していなければ IVS の料金は 0 です。ただし、配信ソフトを止め忘れると、`BASIC` の channel で 730 時間 USD 146.00 になります
- **21章**: 既定の stack は secret 1 つで月 USD 0.40。web ACL は、distribution に付けていなくても月 USD 8.00。`-c cmk=on` を足すと、合わせて月 USD 1.40
- **使った分だけのもの**: 17章のモデルの呼び出し（token の数）、15章の `mail:send`、19章の `obs:query`（走査したログの量）

01章の予算の通知は、止めてはくれません。時間課金の構成を deploy したら、その日のうちに destroy まで進めてください。
