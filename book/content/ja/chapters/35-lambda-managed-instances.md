---
title: "35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす"
revision: 1
---

# 35 Lambda Managed Instances: Lambda を自分の EC2 キャパシティで動かす

[04章](/ja/chapters/04-http-api.md)の Lambda は、呼ばれたときだけ動き、使った時間だけ料金がかかりました。[23章](/ja/chapters/23-ec2.md)の EC2 は、動かしている時間に料金がかかるかわりに、OS から上をすべて自分で面倒を見ました。Lambda Managed Instances は、この 2 つのあいだにあります。関数の書き方とデプロイの仕方は Lambda のままで、動く場所が自分のアカウントの EC2 インスタンスになり、料金はインスタンスの時間にかかります。

この章では、04章のノート API をそのまま Lambda Managed Instances に載せます。コードを書き換える必要はほとんどありませんが、前提が 1 つ変わります。標準の Lambda では 1 つの実行環境が一度に 1 つのリクエストしか処理しなかったのに対し、Lambda Managed Instances では同時に複数のリクエストを処理します。この違いで壊れるコードと、その直し方が、この章の中心です。

この章で作るものは、**置いてあるだけで時間単位の料金がかかります**。既定の構成では、リクエストが 1 件も来なくても 1 日およそ USD 8.87、1 か月（730 時間）で USD 269.77 です。この本のなかでいちばん高い練習用のスタックなので、試したらその日のうちに[片付け](/ja/chapters/35-lambda-managed-instances/wrap.md)まで進めてください。金額は「Lambda がインスタンスを 3 台起動する」という仮定に立っていて、実機では確かめていません。

前提は 04章のノート API、[11章](/ja/chapters/11-network.md)の VPC、23章の EC2 です。コールドスタートやメモリの設定など、標準の Lambda の調整は [29章](/ja/chapters/29-lambda-tuning.md)が扱います。コードは `examples/35-lambda-managed-instances/` にあります。

## Lambda Managed Instances とは

<!-- section: 35.what -->

Lambda Managed Instances は、Lambda の関数を、自分のアカウントの VPC にある EC2 インスタンスで動かす機能です。2025 年 11 月 30 日に発表されました。インスタンスの起動、OS とランタイムのパッチ、リクエストの振り分け、スケーリングは Lambda が行います。インスタンスを自分で終了させるといった、EC2 のふつうの操作はできません。AWS のドキュメントは、これまでの Lambda を Lambda (default) と呼んで区別しています。この章では「標準の Lambda」と書きます。

API とテンプレートに出てくる名前は、キャパシティプロバイダー（capacity provider）です。キャパシティプロバイダーは、インスタンスを置くサブネットとセキュリティグループ、Lambda がインスタンスを管理するためのロール、使ってよいインスタンスの種類、vCPU の上限を持つリソースで、API では `CreateCapacityProvider`、CloudFormation では `AWS::Lambda::CapacityProvider` です。関数の側は、`CapacityProviderConfig` にキャパシティプロバイダーの ARN を書くだけで、ほかは標準の Lambda の関数と同じ形をしています。

2026-10-13 の時点で確かめたことを並べます。

- **リージョン。** 発表のときの 5 つのリージョンに東京（`ap-northeast-1`）が入っています。AWS Price List には、2026-10-09 に公開された版で、東京を含む 30 のリージョンに Lambda Managed Instances の単価が載っています。料金が載っていることと使えることは別の事実ですが、東京についてはどちらも確認できたので、この章のスタックは東京に作ります
- **ランタイム。** Node.js 22 以降、Python 3.13 以降、Java 21 以降、.NET 8 以降と、OS だけのランタイム（`provided.al2023` 以降）で動かす Rust です
- **アーキテクチャ。** `x86_64` と `arm64` で、キャパシティプロバイダーごとにどちらか一方です。この章は、ほかの章と同じ `arm64` を使います
- **関数の大きさ。** いちばん小さい設定がメモリ 2 GB と 1 vCPU です。04章の関数は 256 MB でしたが、それより小さくはできません
- **分離。** 標準の Lambda は、実行環境ごとに Firecracker の microVM で分けていました。Lambda Managed Instances は、インスタンスの上のコンテナで分けます。AWS のドキュメントは、コンテナをセキュリティの境界として扱わないように書いていて、同じキャパシティプロバイダーに載せる関数は、互いに信頼できるものに限ります

## 置いてあるだけでかかる料金

<!-- section: 35.cost -->

金額は USD で、東京リージョンの従量課金の定価、税別です。1 か月は 730 時間として計算しています。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

課金されるものは 3 つあります。

- **インスタンス。** EC2 のふつうの料金です。この章が使う `m6g.large`（2 vCPU、8 GiB）は 1 時間 USD 0.099 で、3 台を 730 時間で 216.81
- **管理料（management fee）。** EC2 のオンデマンドの定価の 15% が、インスタンスの時間に上乗せされます。`m6g.large` では 1 時間 USD 0.01485 で、3 台を 730 時間で 32.52
- **リクエスト。** 100 万件あたり USD 0.20 で、標準の Lambda と同じです。標準の Lambda にあった実行時間の料金（GB 秒）は、かかりません

これに、11章のスタックに足すインターフェースエンドポイントの料金が加わります。CloudWatch Logs のエンドポイントを 1 つ、2 つの AZ に置くので、1 時間 USD 0.014 が 2 つぶんで、730 時間で 20.44 です。合わせると、次のようになります。

| 状態 | 1 日 | 1 か月 |
| --- | --- | --- |
| 既定（インスタンス 3 台と仮定） | 8.87 | 269.77 |
| vCPU の上限（6 台）まで増えたまま | 17.07 | 519.10 |
| 関数を止める（実行環境を 0 に）| 0.67 | 20.44 |

1 行目の「3 台」は、Lambda のガイドの記述から取った仮定です。ガイドには、関数のバージョンを公開すると、AZ をまたいだ可用性のために既定で 3 台のインスタンスを起動し、3 つの実行環境を立ち上げる、と書かれています。この章のスタックは 2 つの AZ のサブネットを渡すので、3 台がどう配置されるか、本当に 3 台になるかは、デプロイして確かめるまでわかりません。

2 行目は、請求の上限の目安です。キャパシティプロバイダーには vCPU の上限（`maxVCpuCount`）があり、このスタックは CDK が受け付けるいちばん小さい値の 12 にしています。`m6g.large` は 2 vCPU なので、6 台を超えては起動しません。

3 行目は、関数の実行環境の最小と最大を両方 0 にした場合です。ガイドによると、実行環境が 1 つも無くなったインスタンスは Lambda が終了させます。残るのはエンドポイントの料金で、これは 11章のスタックを消すまで続きます。標準の Lambda と違って、リクエストが来なくなっただけでは 0 にはなりません。

何が課金されるかは、コードにしてあります。

<<< @/examples/35-lambda-managed-instances/src/cost.ts{billable}

デプロイする前に、手元で金額を出せます。AWS のアカウントは要りません。

```bash
vp run lmi:plan
vp run lmi:plan instanceType=m7g.large
```

この表には、インスタンスに付く EBS ボリューム、API Gateway、ログ、データ転送の料金を入れていません。0 という意味ではなく、未算入です。EBS ボリュームは、大きさも、誰に課金されるかも、料金のページには書かれていませんでした。Lambda の無料利用枠が Lambda Managed Instances のリクエストに当てはまるかも、料金のページからは読み取れなかったので、差し引いていません。

EC2 の Savings Plans とリザーブドインスタンスは、インスタンスの料金に適用されます。管理料には適用されず、割引後の料金ではなくオンデマンドの定価の 15% のままです。東京の `m6g.large` に対する割引率は調べていないので、この章の金額はすべてオンデマンドの定価です。

## 全体像

<!-- section: 35.architecture -->

```figure
caption: リクエストは API Gateway から Lambda を通り、自分の VPC にあるインスタンスの実行環境に届く
node client: Client
node apigw: API Gateway | HTTP API
node lambda: Lambda | router, scaler
node a: インスタンス | Private1, ap-northeast-1a
node c: インスタンス | Private2, ap-northeast-1c
node vpce: Interface endpoint | logs (11章のスタック)
node logs: CloudWatch Logs
edge client -> apigw: HTTPS
edge apigw -> lambda: Invoke
edge lambda -> a
edge lambda -> c
edge a -> vpce: HTTPS 443
edge c -> vpce: HTTPS 443
edge vpce -> logs
group vpc: VPC AihNetwork = a, c, vpce
mark lambda
```

```figure
caption: キャパシティプロバイダーが、インスタンスの置き場所、Lambda が使うロール、台数の上限をまとめて持つ
node cp: Capacity provider | arm64, m6g.large, 最大 12 vCPU
node subnets: プライベートサブネット | Private1, Private2
node sg: Security group | アウトバウンド tcp 443 のみ
node op: オペレーターロール | Lambda が引き受ける
node fn: Lambda function | nodejs24.x, 2048 MB, 実行環境 3 から 6
node role: 実行ロール | 自分のロググループに書くだけ
edge cp -> subnets
edge cp -> sg
edge cp -> op
edge fn -> cp: CapacityProviderConfig
edge fn -> role
mark cp
```

1 つ目の図は、リクエストの通り道です。API Gateway から先は 04章と同じに見えますが、Lambda の先にあるのが自分の VPC のインスタンスです。リクエストを振り分けるルーターと、台数を決めるスケーラーは Lambda の側にあり、利用者からは見えません。インスタンスは、ログを送るために自分から CloudWatch Logs に接続します。

2 つ目の図は、スタックが作るリソースの関係です。ロールが 2 つあることに注意してください。オペレーターロール（operator role）は、Lambda がインスタンスを起動するときに引き受けるロールです。実行ロールは、04章と同じく、関数のコードが動くときのロールです。

設定は、ほかの章と同じく Valibot のスキーマで受けます。

<<< @/examples/35-lambda-managed-instances/src/config.ts{schema}

## 選ぶ場面と、選ばない場面

<!-- section: 35.when -->

先に結論を書くと、04章の API のような小さな関数で、負荷に波があるなら、標準の Lambda のままでかまいません。Lambda Managed Instances は、リクエストが来なくても 1 か月 USD 269.77 かかり、関数のメモリは 2 GB より小さくできません。

Lambda Managed Instances が合うのは、次のような場合です。

- **一定の負荷が長く続く。** 標準の Lambda は、処理中のリクエスト 1 件ごとに、メモリと時間の積で課金します。同時に処理中のリクエストが常に何件もあるなら、インスタンスを借りて 1 台で何件も処理するほうが安くなる点があります。どこで逆転するかは、[料金のページ](/ja/chapters/35-lambda-managed-instances/wrap.md)で計算します
- **EC2 の割引を使いたい。** すでに Savings Plans やリザーブドインスタンスを持っている組織なら、その割引がインスタンスの料金に効きます
- **インスタンスの種類を選びたい。** メモリと vCPU の比率、ネットワークの帯域、新しい世代の CPU を指定できます
- **コールドスタートを避けたい。** リクエストが来てから実行環境を作ることがないので、最初の 1 件だけ遅い、ということが起きません。そのかわり、急に増えた負荷はスロットリングになります

ほかの置き場所と、同じ 1 か月で比べます。負荷は、1 か月に 1 億リクエスト、1 リクエスト平均 200 ミリ秒としました。同時に処理中のリクエストは、平均で 7.6 件です。

| 置き場所 | 1 か月 | 含めていないもの |
| --- | --- | --- |
| Lambda Managed Instances（`m6g.large` 3 台） | 289.77 | EBS ボリューム |
| 標準の Lambda、256 MB | 86.67 | |
| 標準の Lambda、1 GB | 286.67 | |
| 標準の Lambda、2 GB | 553.34 | |

4 つとも、API Gateway、ログ、データ転送は含めていません。どの行でも同じだけかかるからです。標準の Lambda の 3 行は、メモリを変えても 1 リクエストの時間が 200 ミリ秒のままだと仮定しています。1 行目は、3 台でこの負荷を処理できるという仮定に立っています。処理できるかどうかは 1 リクエストが使う CPU 時間で決まり、この章では計測していません。

同じ大きさのマシンを、別の借り方で 1 か月持つ場合とも比べます。こちらはリクエストの料金を含まない、置いてあるだけの金額です。

| 借り方 | 1 か月 | 自分の仕事になるもの |
| --- | --- | --- |
| EC2 の `m6g.large` を 3 台（23章のやり方） | 216.81 | OS のパッチ、プロセスの監視、スケーリング、ロードバランサー |
| Lambda Managed Instances で `m6g.large` を 3 台 | 249.33 | モジュールスコープの状態を持たないコードにすること |
| Fargate のタスク（2 vCPU、8 GB）を 3 つ（[12章](/ja/chapters/12-containers.md)のやり方） | 254.61 | コンテナイメージ、ロードバランサー、スケーリングの設定 |

2 行目と 1 行目の差の 32.52 が、管理料です。3 台ぶんの OS のパッチとスケーリングと振り分けを、月に USD 32.52 で任せていることになります。Fargate は同じ大きさならほぼ同じ金額ですが、Fargate にはもっと小さなタスクがあり、12章の既定の構成（0.25 vCPU と 0.5 GB のタスク 2 つ）は、ロードバランサーとパブリック IPv4 アドレスを含めて 1 か月 USD 50.34 です。小さく始めて常に動かしておきたいなら、Fargate のほうが安く始められます。

## Workers と Fluid compute

<!-- section: 35.others -->

Cloudflare Workers や Vercel から来た読者には、1 つのプロセスが同時に複数のリクエストを処理するというモデルは、すでになじみのあるものです。確認日は 2026-10-13 です。

Workers のドキュメントは、1 つの Workers のインスタンスが、同時に来たものも含めて複数のリクエストを、1 つのスレッドのイベントループで処理することがある、と書いています。`await` で待っている間に別のリクエストが処理されることがあり、2 つのリクエストが同じインスタンスに届く保証も、別のインスタンスに届く保証もないので、グローバルな状態を使ったり書き換えたりしないように勧めています。この章で扱う不具合と、同じ種類の注意です。

Vercel の Fluid compute は、2025 年 4 月 23 日から新しいプロジェクトの既定になっていて、Node.js と Python のランタイムでは、1 つの関数のインスタンスが複数の呼び出しを同時に処理します。ドキュメントには、複数の呼び出しが同じプロセスとグローバルな状態を共有する、と書かれています。料金は、コードが動いている CPU の時間、確保したメモリの時間、呼び出しの回数で決まり、すべてのリクエストが終わるとインスタンスは一時停止して、次の呼び出しまで課金されません。

Lambda Managed Instances がこの 2 つと違うのは、リクエストが来なくても料金がかかることと、インスタンスが自分のアカウントの VPC にあることです。Workers と Fluid compute は、同時実行のモデルを使いながら、使っていない間の料金は 0 のままです。小さな API を安く動かしたいだけなら、Workers、Fluid compute、標準の Lambda のどれでも足りていて、Lambda Managed Instances に移る理由はありません。移る理由になるのは、一定の負荷が長く続いていて EC2 の料金体系のほうが安くなる場合や、インスタンスの種類や VPC の中の配置を自分で決めたい場合です。

この先は、[しくみと実装](/ja/chapters/35-lambda-managed-instances/build.md)、[手元で動かす](/ja/chapters/35-lambda-managed-instances/local.md)、[デプロイ](/ja/chapters/35-lambda-managed-instances/deploy.md)、[費用、注意点、片付け](/ja/chapters/35-lambda-managed-instances/wrap.md)の順に進みます。
