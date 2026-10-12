---
title: "45 Infrastructure Composer: しくみと実装"
---

# 45 Infrastructure Composer: しくみと実装

このページでは、合成されたテンプレートをグラフとして読むモジュールを作ります。リソースを点にし、参照を線にして、種類ごとの数、どこからも参照されないリソース、いちばん長い参照の鎖を出します。最後に、同じスタックのものだと言い張る 2 つのテンプレートを比べます。

これは Infrastructure Composer ではありません。たどる参照の形は、template studio のガイドに書かれている 4 つと同じにしましたが、template studio の図と同じ結果になるかどうかは確かめていません。

## テンプレートをグラフとして読む

<!-- section: 45.graph -->

読むのは、テンプレートのうち `Resources`、`Parameters`、`Outputs` の 3 つだけです。リソースには `Type` が必要で、`DependsOn` は文字列か文字列の配列です。それ以外の部分は、中身を決めずに通します。

<<< @/examples/45-infrastructure-composer/src/template.ts{schema}

読むのは JSON だけです。`cdk.out` のテンプレートが JSON だからで、YAML は読みません。

グラフの型は次のとおりです。線は「`from` が `to` の名前を書いている」という向きで、CloudFormation はこのとき `to` を先に作り、`from` を先に消します。

<<< @/examples/45-infrastructure-composer/src/graph.ts{types}

線になるのは 4 つの形です。

- `{ "Ref": "名前" }`
- `{ "Fn::GetAtt": ["名前", "属性"] }`。属性の側に `Ref` が入っていれば、それもたどります
- `{ "Fn::Sub": "…${名前}…" }` と、変数の対応表を付けた `{ "Fn::Sub": ["…", { … }] }`
- リソースの `DependsOn`

`Ref` と `Fn::GetAtt` は、キーが 1 つだけのオブジェクトとして、リソースの中のどの深さにあっても見つけます。

<<< @/examples/45-infrastructure-composer/src/graph.ts{walk}

`Fn::Sub` には、決まりが 3 つあります。`${Bucket.Arn}` は `Bucket` の属性を読むので、名前は点の前までです。`${!Literal}` は名前ではなく、`${Literal}` という文字そのものです。そして、対応表に書いた名前は、その `Fn::Sub` の中だけの変数で、同じ名前のリソースがあっても、そちらは指しません。

<<< @/examples/45-infrastructure-composer/src/graph.ts{sub}

見つけた名前がリソースなら線にします。パラメーターや、`AWS::Region` のような擬似パラメーターなら、線にも誤りにもしません。どれでもない名前は、`unresolved` に残します。テンプレートに無いものを指している参照は、黙って捨てずに表示したいからです。

<<< @/examples/45-infrastructure-composer/src/graph.ts{graph}

たどらないものも決めてあります。

- `Fn::ImportValue`。別のスタックの出力を指すので、このテンプレートの中に相手がいません
- リソースの `Condition` と、`Fn::If` の 1 つ目の引数。指しているのは条件の名前で、リソースではありません
- 説明文や ARN の文字列に、たまたま含まれているリソースの名前
- `Fn::ForEach` などの transform が展開する前の形。`Resources` に `Type` の無い項目があれば、読み込みの時点で断ります。SAM の `AWS::Serverless::Function` は 1 つの点として読み、展開後のリソースは見ません

CDK が合成したテンプレートには、`AWS::CDK::Metadata` のリソースが 1 つ入っています。どこからも参照されないので、何もしなければ、毎回「つながっていないリソース」として出てきます。CLI はこの種類を省き、省いたことを 1 行で表示します。

## 要約

<!-- section: 45.summary -->

レビューの前に知りたいことは、グラフそのものよりも、その要約です。

<<< @/examples/45-infrastructure-composer/src/summary.ts{summary}

`unreferenced` は、ほかのどのリソースからも名前を書かれていないリソースです。これは誤りの一覧ではありません。API のルートや Lambda の実行許可のように、参照する側にしかならないリソースは、必ずここに入ります。その中に、覚えの無いものが混じっていないかを見ます。

`isolated` は、参照されず、自分も何も参照していないリソースです。バケットが 1 つだけのスタックなら当然そうなりますが、リソースの多いスタックでこれが出たら、つなぎ忘れか、消し忘れを疑います。

`longestChain` は、参照をたどって進める、いちばん長い道です。鎖が長いところは、作る順番も消す順番も 1 つに決まっているところで、1 か所の失敗がいちばん遠くまで響きます。

参照が輪になっていると、いちばん長い道は決まりません。そのときは道を答えずに、輪を 1 つ答えます。

<<< @/examples/45-infrastructure-composer/src/summary.ts{chain}

輪のあるテンプレートを CloudFormation がどう扱うかは、今回読んだページには書かれていませんでした。作る順番が決まらないので、受け付けられないはずですが、確かめていません。この本の `cdk.out` には、輪のあるテンプレートはありませんでした。

## 文字と図にする

<!-- section: 45.render -->

表示は文字が基本です。この章の fixture（`fixtures/notes-api.template.json`）を読ませると、次のようになります。fixture は、この章のために手で書いたテンプレートで、デプロイも、CloudFormation による検証もしていません。

```text
notes-api: 9 resources, 11 connections

types
  1  AWS::ApiGatewayV2::Api
  1  AWS::ApiGatewayV2::Integration
  1  AWS::ApiGatewayV2::Route
  1  AWS::DynamoDB::Table
  1  AWS::IAM::Policy
  1  AWS::IAM::Role
  1  AWS::Lambda::Function
  1  AWS::Lambda::Permission
  1  AWS::SQS::Queue

connections (from names to)
  FnPolicy -> FnRole  [Ref]
  FnPolicy -> NotesTable  [GetAtt]
  NotesFn -> FnRole  [GetAtt]
  NotesFn -> NotesTable  [Ref]
  NotesFn -> FnPolicy  [DependsOn]
  ApiIntegration -> Api  [Ref]
  ApiIntegration -> NotesFn  [GetAtt]
  ApiRoute -> Api  [Ref]
  ApiRoute -> ApiIntegration  [Sub]
  InvokePermission -> NotesFn  [Ref]
  InvokePermission -> Api  [Sub]

no resource names these
  ApiRoute  AWS::ApiGatewayV2::Route
  InvokePermission  AWS::Lambda::Permission
  LeftoverQueue  AWS::SQS::Queue

no connection at all
  LeftoverQueue  AWS::SQS::Queue

longest chain (5)
  ApiRoute -> ApiIntegration -> NotesFn -> FnPolicy -> FnRole

outputs
  ApiEndpoint -> Api

names that are not in the template
  (none)
```

`LeftoverQueue` は、わざと入れた消し忘れです。どこからも参照されないリソースは 3 つありますが、何ともつながっていないのはこの 1 つだけで、要約がそれを分けて表示しています。

リソースが 9 個までなら、同じグラフをこの本の図の書き方でも出力できます。`--figure` を付けると、```` ```figure ```` のブロックに入れる行が出てきます。値を渡している参照は実線、`DependsOn` だけのつながりは破線にしました。

<<< @/examples/45-infrastructure-composer/src/render.ts{figure}

fixture を図にすると、次のようになります。箱と矢印の行は CLI の出力をそのまま貼ったもので、テストが、このページの図と CLI の出力が一致することを確かめています。

```figure
caption: fixture のテンプレートの参照。矢印の元のリソースが、先のリソースの名前を書いています。LeftoverQueue だけが何ともつながっていません。
node ApiRoute: ApiRoute | AWS::ApiGatewayV2::Route
node InvokePermission: InvokePermission | AWS::Lambda::Permission
node LeftoverQueue: LeftoverQueue | AWS::SQS::Queue
node ApiIntegration: ApiIntegration | AWS::ApiGatewayV2::Integration
node NotesFn: NotesFn | AWS::Lambda::Function
node Api: Api | AWS::ApiGatewayV2::Api
node FnPolicy: FnPolicy | AWS::IAM::Policy
node NotesTable: NotesTable | AWS::DynamoDB::Table
node FnRole: FnRole | AWS::IAM::Role
edge FnPolicy -> FnRole: Ref
edge FnPolicy -> NotesTable: GetAtt
edge NotesFn -> FnRole: GetAtt
edge NotesFn -> NotesTable: Ref
edge NotesFn --> FnPolicy: DependsOn
edge ApiIntegration -> Api: Ref
edge ApiIntegration -> NotesFn: GetAtt
edge ApiRoute -> Api: Ref
edge ApiRoute -> ApiIntegration: Sub
edge InvokePermission -> NotesFn: Ref
edge InvokePermission -> Api: Sub
```

9 個を超えるグラフは図にしません。`docs/FIGURES.md` が 1 つの図の箱を 9 個までとしているからで、この本のスタックのほとんどは、それより大きくなります。大きなグラフを読める図にするには、まとめ方を考える必要があり、Infrastructure Composer のグループや template studio の図がしているのは、その仕事です。このモジュールはそこまでしません。

## 自分のスタックを読む

<!-- section: 45.run -->

タスクは 3 つあります。どれもファイルを読むだけで、AWS にもネットワークにも触りません。

```bash
vp run composer:graph          # 引数なし: この章の fixture
vp run composer:graph:hello    # 02章の AihHello（先に synth する）
vp run composer:graph:ship     # 20章の AihShipApi（先に synth する）
```

ほかの章のスタックは、サンプルのディレクトリとスタックの名前を渡します。`cdk.out` にテンプレートが 1 つしか無ければ、名前は省けます。2 つ以上あるのに名前が無ければ、推測せずに、ある名前を挙げて止まります。

```bash
vp run notes:infra:synth
vp run composer:graph ../05-dynamodb
vp run composer:graph ../20-shipping AihShipCi
```

<<< @/examples/45-infrastructure-composer/src/cdk-out.ts{choose}

02章の `AihHello` は、いちばん小さな例です。

```text
AihHello: 2 resources, 1 connection
left out: CDKMetadata (AWS::CDK::Metadata)

types
  1  AWS::S3::Bucket
  1  AWS::S3::BucketPolicy

connections (from names to)
  NotesPolicyE872504C -> Notes5BB3582F  [Ref, GetAtt]

no resource names these
  NotesPolicyE872504C  AWS::S3::BucketPolicy

no connection at all
  (none)

longest chain (2)
  NotesPolicyE872504C -> Notes5BB3582F

outputs
  NotesBucketName -> Notes5BB3582F

names that are not in the template
  (none)
```

02章のコードには、バケットポリシーを作る行はありません。`enforceSSL` を指定したバケットから CDK が作ったもので、それがバケットを 2 通りの形で参照していることが、この出力でわかります。

20章の `AihShipApi` は 18 個のリソースと 29 本のつながりがあり、出力は長くなります。読んで気づいたことを 2 つ挙げます。

```text
AihShipApi: 18 resources, 29 connections
left out: CDKMetadata (AWS::CDK::Metadata)

types
  5  AWS::ApiGatewayV2::Route
  5  AWS::Lambda::Permission
  1  AWS::ApiGatewayV2::Api
  1  AWS::ApiGatewayV2::Integration
  1  AWS::ApiGatewayV2::Stage
  1  AWS::IAM::Role
  1  AWS::Lambda::Alias
  1  AWS::Lambda::Function
  1  AWS::Lambda::Version
  1  AWS::Logs::LogGroup
```

1 つ目は、Integration が 1 つしか無いことです。その論理 ID は `ApiGEThealthNotesA0A0F53E` で、名前だけを見ると `GET /health` のためのものに見えますが、つながりの一覧では 5 つのルートすべてがこれを参照しています。論理 ID から見るかぎり、最初に足したルートのところに作られた Integration を、残りのルートが使い回しています。テンプレートを上から読んでいると、見落としやすいところです。

2 つ目は、いちばん長い鎖です。ルートから Integration、エイリアス、バージョン、関数、ロールを通って、ロググループまで 7 つ続きます。ロールがロググループを参照しているのは、ロールのポリシーが、ログの書き込みをそのロググループの ARN にだけ許しているからです。最小権限にした結果が、線として見えています。

これらの出力は、2026 年 10 月 13 日に手元で synth したテンプレートを読んだものです。論理 ID の末尾の文字列は CDK が決めるもので、CDK の版やコードが変われば変わります。

## 2 つのテンプレートを比べる

<!-- section: 45.diff -->

[概要](/ja/chapters/45-infrastructure-composer.md)のページで、この章の不変条件を「1 つのスタックの正本は 1 つ」としました。図の道具から保存したテンプレートが手元に残っていると、この条件が壊れます。壊れたことに気づくために、2 つのテンプレートをグラフとして比べます。

<<< @/examples/45-infrastructure-composer/src/diff.ts{diff}

テストは、fixture を合成されたテンプレートに見立て、図の道具でしそうな編集を 1 つずつ加えて、違いが見えることを確かめます。カードを 1 枚足す、カードを消す、参照を文字列に書き換える、`DependsOn` を消す、論理 ID をそのままに種類を変える、の 5 つです。

比べるのは形だけです。プロパティの値は比べません。課金方式を `PAY_PER_REQUEST` から `PROVISIONED` に書き換えても、グラフは同じなので、違いは出ません。テストにはこの場合も入れてあり、見えないことを確かめています。値の違いまで見たいときは、テンプレートそのものを `diff` で比べるか、各章の `infra:diff` のタスクを使います。

CLI では `--against` に、比べる相手のテンプレートを渡します。違いがあれば、終了コードが 1 になります。

```bash
vp run composer:graph ../20-shipping AihShipApi --against ~/Downloads/template.json
```

図の道具から保存したテンプレートを、実際にこの比較にかけたことはありません。Infrastructure Composer が保存するテンプレートが、開く前とどう違うのかを確かめていないからです。確かめる手順は、[費用、注意点、片付け](/ja/chapters/45-infrastructure-composer/wrap.md)のページの検証メモに書きました。
