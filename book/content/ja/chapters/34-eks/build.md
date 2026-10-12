---
title: "34 Kubernetes: しくみと実装"
---

# 34 Kubernetes: しくみと実装

このページでは、AWS の側に作るものを扱います。ノードの用意のしかたを決め、クラスターを CDK で書き、人とデプロイロールがクラスターに入る道と、Pod が AWS を呼ぶ道を用意します。Kubernetes のマニフェストは[次のページ](/ja/chapters/34-eks/more.md)で書きます。

## ノードの用意のしかた

<!-- section: 34.nodes -->

EKS では、コントロールプレーンは AWS が動かしますが、Pod を載せるノードの用意のしかたは選べます。いまのドキュメントに載っている主な方法は 3 つです。

| | EKS Auto Mode | マネージドノードグループ | Fargate プロファイル |
| --- | --- | --- | --- |
| ノードの実体 | EKS が起動する EC2 のインスタンス | 自分で数と種類を決める EC2 のインスタンス | Pod ごとに用意される環境 |
| 数の調整 | 置き場所の無い Pod があれば起動し、空けば止める | Auto Scaling グループ。Pod に合わせるには Cluster Autoscaler などを自分で入れる | Pod の数だけ |
| OS とノードの更新 | EKS が行う。ノードは長くても 21 日で入れ替わる | AMI とバージョンの更新を自分で始める | AWS が行う |
| ロードバランサーとの連携 | 組み込み | AWS Load Balancer Controller を自分で入れる | 同じく自分で入れる |
| arm64 | 使える | 使える | 使えない |
| EKS Pod Identity | 組み込み | エージェントを入れれば使える | 使えない |
| 上乗せの料金 | インスタンスの料金のおよそ 12% | なし | vCPU とメモリの時間料金 |

この章は **Auto Mode** を使います。理由は 3 つあります。

1 つ目は、12章のイメージが arm64 だからです。Fargate プロファイルの比較表は、Arm のプロセッサーが要るものは動かせないとしています。Fargate の Pod はプライベートサブネットにしか置けず、NAT Gateway も前提になります。12章と同じ感覚で Fargate を選ぶと、イメージの作り直しと、月 USD 48.91 の NAT Gateway が付いてきます。

2 つ目は、クラスターの中に自分で入れて面倒を見る部品が減るからです。マネージドノードグループでは、ロードバランサーのコントローラー、ノードを増減させる仕組み、Pod Identity のエージェントを自分で入れ、Kubernetes のバージョンを上げるたびに、それぞれの対応する版を確かめます。Auto Mode では、これらが EKS の機能になっています。

3 つ目は、誰も使っていないときにノードが 0 になるからです。Auto Mode は、置き場所の無い Pod があるときだけノードを起動します。

マネージドノードグループを選ぶのは、ノードに手を入れたいときです。Auto Mode のノードには SSH でも Session Manager でも入れず、AMI も CNI も選べず、Windows のコンテナも動きません。セキュリティグループはノードクラスごとには分けられますが、Pod ごとには分けられません。こうした制約に当たるなら、12% を払わずに自分で面倒を見るほうが合っています。

### ノードプールを自分で書く理由

Auto Mode には、組み込みのノードプールが 2 つあります。アプリ向けの `general-purpose` は、amd64 のインスタンスしか起動しません。arm64 のイメージを動かすには、ノードプールを自分で書く必要があります。

そこで、このスタックは組み込みのノードプールを 2 つとも無効にしています。こうすると、既定のノードクラスも作られません。ノードクラス（どのサブネットに、どのロールで起動するか）とノードプール（どんなインスタンスを、いくつまで）を、マニフェストとして自分で用意します。

<<< @/examples/34-eks/src/manifests.ts{nodes}

ノードプールの `requirements` は、起動してよいインスタンスの条件です。arm64、オンデマンド、`t4g.medium` の 3 つで絞りました。Auto Mode は、vCPU が 1 つのインスタンスと、nano、micro、small の大きさを使いません。`t4g.medium`（2 vCPU、4 GiB）は、使える中でいちばん小さい arm64 のインスタンスの 1 つです。

インスタンスタイプを 1 つに絞るのは、練習用の割り切りです。その種類の在庫が無い AZ では、ノードを起動できません。本番では、世代や大きさの幅を持たせて、Auto Mode に選ばせます。T4g は CPU クレジットで動く種類なので、CPU を使い続ける用途では、クレジットの超過分に別の料金がかかります（[23章](/ja/chapters/23-ec2.md)）。

`limits.cpu` は、このノードプールが起動してよい vCPU の合計です。8 にしたので、ノードは 4 つまでです。12章の `maxCount` と同じで、料金の上限でもあります。

### ノードを置くサブネット

ノードは、起動するときに ECR からイメージを取得し、コントロールプレーンに接続します。12章のタスクと同じで、プライベートサブネットに置くなら外へ出る経路が要ります。

既定では、12章と同じく 11章のパブリックサブネットに置き、ノードにパブリック IP アドレスを付けます（`associatePublicIPAddress`）。11章に足すものが無く、時間課金はアドレスのぶんだけで済むからです。入ってくる通信を決めるのはセキュリティグループで、ノードには EKS が作るクラスターのセキュリティグループを使います。

プライベートサブネットに置くなら、11章を `-c egress=nat` でデプロイしておき、マニフェストを出すときに `--node-subnets private` を付けます。ノードクラスが選ぶサブネットと、アドレスの有無だけが変わります。

サブネットは、11章が付けた `Name` タグ（`AihNetwork/Public1` など）で選んでいます。ID を書かずに済み、マニフェストをリポジトリに置けます。

## クラスターを CDK で書く

<!-- section: 34.cdk -->

CDK には、EKS のクラスターを作る方法が 3 つあります。固定した版（aws-cdk-lib 2.273.0）で 3 つとも synth して、テンプレートを比べました。

| | `aws-eks` の `eks.Cluster` | `aws-eks-v2` の `Cluster` | `aws-eks` の `eks.CfnCluster` |
| --- | --- | --- | --- |
| クラスターの種類 | `Custom::AWSCDK-EKS-Cluster` | `AWS::EKS::Cluster` | `AWS::EKS::Cluster` |
| 付いてくるもの | ネストされたスタック 2 つと、その中の Lambda | セキュリティグループと SSM のパラメーター | なし |
| Auto Mode | 設定が無い | 既定で有効 | プロパティで書く |
| `upgradePolicy` と削除保護 | 設定が無い | 設定が無い | プロパティで書く |

1 つ目の `eks.Cluster` は、クラスターを CloudFormation のリソースとしてではなく、Lambda が動かすカスタムリソースとして作ります。テンプレートに `AWS::EKS::Cluster` は現れません。cdkd が管理するのは Lambda とネストされたスタックで、クラスターそのものは CloudFormation のリソースではなくなります。CDK からマニフェストを適用する機能も、kubectl を入れた Lambda を動かす仕組みです。この本で 1 つのクラスターを作るには、動く部品が多すぎます。

2 つ目の `aws-eks-v2` は、クラスターを `AWS::EKS::Cluster` で作り、カスタムリソースを使いません。有力な選択肢ですが、固定した版では合わない点が 3 つありました。Auto Mode のロールに付くポリシーが、いまのユーザーガイドの一覧と違います（`AmazonEKSBlockStoragePolicy` と `AmazonEKSWorkerNodePolicy` が付き、ガイドは `AmazonEKSBlockStoragePolicyV2` と `AmazonEKSWorkerNodeMinimalPolicy` を挙げています）。`upgradePolicy` と削除保護を書く場所がありません。そして、説明したい設定がコンストラクトの既定値の中に隠れます。

この章は 3 つ目の **`eks.CfnCluster`** を使います。CloudFormation のプロパティをそのまま書くので、テンプレートに出るものと本文で説明するものが 1 対 1 になります。

<<< @/examples/34-eks/infra/lib/eks-stack.ts{cluster}

Auto Mode は、`computeConfig`、`elasticLoadBalancing`、`blockStorage` の 3 つで有効にします。3 つは同じリクエストで一緒に有効にする決まりです。`computeConfig` に `nodePools` を書いていないので、組み込みのノードプールは作られません。

`bootstrapSelfManagedAddons` は、VPC CNI、CoreDNS、kube-proxy をクラスターの中に入れるかどうかの指定です。Auto Mode ではこれらがノードの上で動くので、`false` にしました。固定した版の `aws-eks-v2` は、Auto Mode でこの値を `true` にすると synth を失敗させます。書かなかった場合に何が起きるかは、確かめていません。

クラスターが使うロールは次のとおりです。

<<< @/examples/34-eks/infra/lib/eks-stack.ts{cluster-role}

このロールは、EKS がノードを起動し、ロードバランサーを作り、ボリュームを付けるときに使います。AWS が用意した管理ポリシーを 5 つ付けています。04章から続けてきた「必要な操作だけを自分で書く」方針から外れますが、Auto Mode が必要とする操作は EC2 と ELB の広い範囲にわたり、AWS の側で変わっていくので、ここは管理ポリシーに任せました。

### cdkd で作れるか

固定した版の cdkd（0.296.28）のソースを読むと、`AWS::EKS` の種類には専用の実装が 1 つもありません。このスタックが使う `AWS::EKS::Cluster`、`AWS::EKS::AccessEntry`、`AWS::EKS::PodIdentityAssociation` は、どれも Cloud Control API を経由します。cdkd が扱えない種類の一覧には入っておらず、`AWS::EKS::Cluster` には、作成と削除にそれぞれ 30 分まで待つ設定があります。`AWS::IAM::Role` には専用の実装があります。

読み取れるのはここまでです。**クラスターが実際に作れるかどうかは、デプロイしていないので確かめていません。** テストは、スタックが使うリソースの種類がこの 4 つだけであることと、カスタムリソースも Lambda もネストされたスタックも含まないことを固定しています。

## 人とデプロイロールの入り方

<!-- section: 34.access -->

クラスターの API を呼べるのは誰か、という設定は、IAM のポリシーとは別にあります。IAM で `eks:*` を許されていても、クラスターの側で認められていなければ、`kubectl` は拒否されます。

いまの EKS では、この対応を**アクセスエントリー**（access entry）で書きます。IAM のロールやユーザーに、Kubernetes の中での権限を結び付ける設定で、EKS の API で管理します。以前は、クラスターの中の `aws-auth` という ConfigMap を手で編集していました。編集を誤ると誰も入れなくなり、直すにはクラスターに入る必要がある、という作りでした。このスタックは `authenticationMode` を `API` にして、アクセスエントリーだけを使います。CloudFormation から作るクラスターの既定は、ConfigMap だけを使う `CONFIG_MAP` なので、明示しています。

このスタックでクラスターに入れるのは、次の 3 者です。

**クラスターを作った本人。** `bootstrapClusterCreatorAdminPermissions` を `true` にしてあるので、デプロイを実行した IAM の主体が、クラスターの管理者になります。練習には便利ですが、本番では、[20章](/ja/chapters/20-shipping.md)のデプロイロールが管理者になることを意味します。本番では `false` にして、管理者のロールをアクセスエントリーで別に書きます。

**ノード。** 自分で書いたノードクラスのロールには、EKS がアクセスエントリーを作りません。無いと、起動したノードがクラスターに参加できません。

<<< @/examples/34-eks/infra/lib/eks-stack.ts{node-role}

**デプロイロール。** アプリをリリースするロールには、アプリの namespace の中だけを変えられる権限を付けます。

<<< @/examples/34-eks/infra/lib/eks-stack.ts{deploy-access}

`AmazonEKSEditPolicy` は、Deployment、Service、Ingress、PodDisruptionBudget、service account を作り変えられますが、namespace は読めるだけです。範囲を `notes` という namespace に限ったので、このロールはノードプールにも、ほかの namespace にも触れません。

この区切りに合わせて、マニフェストを 2 つに分けてあります。namespace、ノードクラス、ノードプール、IngressClass は、クラスター全体に効くので管理者が一度だけ適用します。Deployment などは、デプロイロールがリリースのたびに適用します。

ロールの ARN は、デプロイのときに渡します。

<<< @/examples/34-eks/src/config.ts{schema}

テストは、渡したロールに付くのが namespace を限った `AmazonEKSEditPolicy` だけで、テンプレートのどこにも `AmazonEKSClusterAdminPolicy` が現れないことを確かめています。

## Pod の権限

<!-- section: 34.pod-identity -->

12章のタスクには、ロールが 2 つありました。イメージの取得とログの書き込みに使うタスク実行ロールと、コードが AWS を呼ぶときに使うタスクロールです。EKS でも同じ 2 つに分かれます。

イメージの取得は、ノードのロールが受け持ちます。前の節の `NodeRole` に付けた `AmazonEC2ContainerRegistryPullOnly` がそれです。

コードが AWS を呼ぶ権限は、**EKS Pod Identity** で渡します。ノードのロールにアプリの権限を付ける方法は取りません。ノードには複数の Pod が載るので、ノードのロールの権限は、そのノードのどの Pod のものでもなくなるからです。Auto Mode のノードは、インスタンスのメタデータへのホップ数を 1 に制限しているので、ふつうの Pod からはノードのロールの認証情報を取れません。Pod Identity は、Pod ごとに別のロールを渡す仕組みです。

<<< @/examples/34-eks/infra/lib/eks-stack.ts{pod-identity}

関連付けは「このクラスターの、この namespace の、この service account で動く Pod には、このロール」という 1 行です。Deployment が Pod に同じ service account を指定していれば、EKS が Pod の環境変数に認証情報の取得先を入れ、AWS の SDK は既定の手順のままそれを使います。

このアプリは AWS を 1 つも呼ばないので、12章のタスクロールと同じく、ロールに権限はありません。05章のテーブルにつなぐなら、`table.grantReadWriteData(podRole)` と書きます。

### IRSA との違い

同じことをする以前からの方法に、IRSA（IAM roles for service accounts）があります。クラスターごとに IAM の OIDC プロバイダーを作り、ロールの信頼ポリシーに、そのクラスターの OIDC の URL と、namespace と service account の名前を書きます。service account の側にも、ロールの ARN を annotation で書きます。

| | EKS Pod Identity | IRSA |
| --- | --- | --- |
| 信頼ポリシーに書く相手 | `pods.eks.amazonaws.com` だけ | クラスターごとの OIDC プロバイダー |
| クラスターを作り直したとき | 関連付けを作り直す。ロールは変えない | ロールの信頼ポリシーを書き換える |
| 結び付けを書く場所 | EKS の API（このスタックの中） | 信頼ポリシーと、service account の annotation |
| 使える場所 | EKS の EC2 のノードだけ。Fargate の Pod では使えない | EKS 以外の Kubernetes でも使える |

AWS のドキュメントは、使えるなら Pod Identity を勧めています。この章でも、ロールの信頼ポリシーがクラスターに依存しなくなる点を取りました。クラスターを作り直しても、ロールはそのまま使えます。Fargate の Pod や、EKS 以外のクラスターでも同じ仕組みを使いたいときは、IRSA が残ります。

Pod Identity を使っても、コンテナが安全の境界になるわけではありません。同じノードの Pod はカーネルを共有します。ドキュメントもそう断っています。

テストは、Pod のロールを引き受けられるのが `pods.eks.amazonaws.com` だけであること、関連付けの namespace と service account が Deployment のものと一致すること、スタックに OIDC プロバイダーが無いことを確かめています。名前が食い違っても、どちらの側もエラーにはなりません。Pod が権限を持たないまま動くだけなので、テストで固定しました。
