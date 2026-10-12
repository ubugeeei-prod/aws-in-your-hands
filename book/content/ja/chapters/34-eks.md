---
title: "34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB"
revision: 2
---

# 34 Kubernetes: EKS、Auto Mode、Pod Identity、ALB

12章でコンテナにしたノート API を、同じイメージのまま Amazon EKS の上で動かします。ECS がタスク定義とサービスで受け持っていたことを、Kubernetes ではどのオブジェクトが受け持つのかを、1 つずつ対応させながら進めます。

この章のクラスターは、この本でいちばん高い置き忘れになります。**クラスターを作った時点から、誰も呼ばなくても 1 時間に USD 0.10、1 か月で USD 73.00 かかります。アプリを載せると、ノードとロードバランサーが加わって 1 時間におよそ USD 0.25、1 日で USD 5.91、1 か月で USD 179.81 です**（東京、既定の構成。内訳は[料金](/ja/chapters/34-eks/wrap.md)にあります）。12章の ECS のサービスは同じアプリで月 USD 50.33 でした。試し終わったら、その日のうちに[片付け](/ja/chapters/34-eks/wrap.md)まで進めてください。片付けには順番があり、Ingress を先に消さないとロードバランサーが残ることがあります。

前提は [11章](/ja/chapters/11-network.md)の VPC と、[12章](/ja/chapters/12-containers.md)のイメージです。コードは `examples/34-eks/` にあります。

この章では、クラスターを一度も作っていません。手元で確かめたのは、スタックの synth とテスト、マニフェストの検査、計算だけです。AWS の上での動きは、ドキュメントと、固定した版の cdkd と CDK のソースを読んで書いています。

## ECS で足りる場面、Kubernetes を選ぶ場面

<!-- section: 34.when -->

12章の構成で困っていないなら、Kubernetes に移る理由はありません。コンテナを決まった数だけ動かし、ALB の後ろに並べ、止めずに入れ替えることは、ECS のサービスがすでにしています。ECS にはクラスターそのものの料金がなく、バージョンを上げる作業もありません。

Kubernetes を選ぶと手に入るのは、Kubernetes の API です。

- 同じ API を話す道具と部品が使えます。Helm のチャート、Argo CD のような GitOps の道具、データベースやメッセージングの operator は、Kubernetes の API を前提に配られています。使いたいものが Kubernetes 向けにしか無いなら、選ぶ理由になります
- 載せるものの置き方を細かく書けます。全部のノードに 1 つずつ置く DaemonSet、AZ をまたいだ分散、ノードの入れ替えで同時に欠けてよい数（この章で扱う PodDisruptionBudget）は、どれも Kubernetes のオブジェクトです
- すでに Kubernetes で動いているものを、書き直さずに持ってこられます。ほかのクラウドや手元のクラスターと同じマニフェストを使いたい組織にとっては、これが最大の理由になります。ただし、ロードバランサーとノードの設定は EKS のものなので、マニフェストがすべてそのまま動くわけではありません
- 1 つのクラスターを、namespace と権限で区切って複数のチームで使えます

引き換えに増えるものも、同じくらいはっきりしています。

- クラスターごとに、月 USD 73.00 のコントロールプレーンの料金がかかります。ECS には、これに当たる料金がありません
- Kubernetes のバージョンには期限があります。EKS の標準サポートは公開から 14 か月で、過ぎると料金が 6 倍になるか、自動で上げられるかのどちらかです（[デプロイ](/ja/chapters/34-eks/deploy.md)のページで扱います）
- 権限の仕組みが 2 つになります。AWS の IAM と、Kubernetes の中の権限です。この 2 つをつなぐ設定を、人とデプロイロールのためと、Pod のためとで、別々に書きます
- 状態の置き場所が 2 つになります。スタックが作るのはクラスターまでで、ノードとロードバランサーは、マニフェストを見た EKS があとから作ります。cdkd の state には載りません

この章のアプリは、ECS で足りる側にあります。それでも EKS に載せるのは、対応を並べて見るためです。読み終えたときに、自分の作るものがどちらの側にあるかを判断できれば、この章の役目は済んでいます。

## 全体像

<!-- section: 34.architecture -->

```figure
caption: リクエストは Application Load Balancer から Pod へ直接届く。コントロールプレーンは AWS が動かし、ノードは EKS Auto Mode が Pod の数に合わせて起動する
node client: クライアント | curl
node alb: Application Load Balancer | Ingress を見て Auto Mode が作る
node cp: コントロールプレーン | API サーバーと etcd, AWS が管理
node p1: Pod | AZ 1a
node p2: Pod | AZ 1c
node ecr: ECR のリポジトリ | 12章のスタック
edge client -> alb: HTTP :80
edge alb -> p1: HTTP :8080, target type ip
edge alb -> p2
edge cp --> p1: kubelet が指示を受け取る
edge cp --> p2
edge p1 -> ecr: イメージの取得
group nodes: ノード: t4g.medium が AZ ごとに 1 つ = p1, p2
mark cp
```

```figure
caption: スタックが作るのはクラスターと IAM まで。ノードとロードバランサーは、マニフェストを適用したあとで EKS Auto Mode が作り、cdkd の state には載らない
node stack: スタック AihEks | cdkd がデプロイ
node admin: k8s/cluster.json | クラスターの管理者が一度だけ適用
node app: k8s/app.json | デプロイロールがリリースのたびに適用
node auto: Auto Mode が作るもの | EC2 インスタンス, ALB, ターゲットグループ
edge stack -> admin: クラスター, ロール, アクセスエントリー
edge admin -> app: namespace, ノードプール, IngressClass
edge app --> auto: Pod が Pending, Ingress ができる
```

図に出てくる用語を、12章の ECS の用語と並べて説明します。

**コントロールプレーン**（control plane）は、Kubernetes の API サーバーと、クラスターの状態を持つ etcd です。EKS では AWS が 3 つの AZ にまたがって動かし、利用者には API の入口だけが見えます。ECS にもタスクを管理する側はありますが、利用者には見えず、料金もありません。EKS では、クラスター 1 つにつき時間で課金されます。

**Pod** は、Kubernetes が動かす最小の単位で、ECS のタスクに当たります。**Deployment** は、Pod を決まった数だけ動かし続け、イメージが変われば入れ替える指示で、ECS のサービスに当たります。タスク定義に書いていたイメージ、CPU、メモリ、環境変数は、Deployment の中の Pod のひな形に書きます。

**ノード**（node）は Pod を載せるマシンで、EKS では EC2 のインスタンスです。12章の Fargate ではタスクごとに専用の環境が用意され、マシンを意識しませんでした。Kubernetes では、ノードの CPU とメモリを複数の Pod が分け合います。この章では、ノードの起動と入れ替えを **EKS Auto Mode** に任せます。

**Service** と **Ingress** は、通信の届け先を決めます。Service は Pod の集まりに名前を付け、Ingress は外から来た HTTP をどの Service へ送るかを書きます。EKS では、Ingress を見たコントローラーが ALB とターゲットグループを作ります。12章でスタックに書いていたロードバランサーが、ここではマニフェストから作られます。

Pod の大きさと数は、12章と同じにしました。

<<< @/examples/34-eks/src/config.ts{size}

`POD` は 12章の `TASK` から計算しています。0.25 vCPU は、Kubernetes では `250m`（1000 分の 250）と書きます。`NODES` は、Auto Mode が起動してよいノードを決める値です。インスタンスタイプを 1 つに絞ったのは、置いてあるだけでかかる料金を、この本に数字で書けるようにするためです。

12章から変わっていない点も 1 つあります。ノートはまだ Pod のメモリの中にあり、Pod が 2 つあれば `Map` も 2 つあります。データをクラスターの外に置く話は、[実装のつづき](/ja/chapters/34-eks/more.md)でします。

## コントロールプレーンの料金

<!-- section: 34.control-plane -->

EKS のクラスターは、作った時点から 1 時間に USD 0.10 かかります。ノードが 1 つも無くても、Pod が 1 つも無くても同じです。1 か月置くと USD 73.00 で、12章の構成全体（USD 50.33）より高くなります。

この章のスタックは、組み込みのノードプールを無効にしてあります。スタックをデプロイしただけの状態では、かかるのはコントロールプレーンの料金だけです。ノードとロードバランサーの料金は、マニフェストを適用したところから始まります。

料金は、クラスターの Kubernetes のバージョンによっても変わります。標準サポートを過ぎたバージョンのまま動かすと、1 時間に USD 0.50 が上乗せされて USD 0.60 になります。1 か月で USD 365.00 の差です。このスタックは、上乗せされる前に EKS が自動でバージョンを上げる設定（`upgradePolicy` が `STANDARD`）にしてあります。CloudFormation から作るクラスターの既定は、上乗せを払って同じバージョンに留まる `EXTENDED` です。

時間で課金されるものの数え方は、コードにしてあります。

<<< @/examples/34-eks/src/cost.ts{billable}

テストは、この関数が出す時間数が料金データのシナリオと一致することと、この章に書いた金額が計算結果と一致することを確かめています。
