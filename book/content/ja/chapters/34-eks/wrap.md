---
title: "34 Kubernetes: 費用、注意点、片付け"
---

# 34 Kubernetes: 費用、注意点、片付け

## 料金

<!-- section: 34.cost -->

金額は USD、東京リージョン、従量課金、税別で、1 か月を 730 時間として計算しています。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

スタックをデプロイしただけで、マニフェストを適用していないときは、コントロールプレーンの月 USD 73.00 だけです。

次の表は、既定の構成でアプリを動かし、誰も呼ばないまま置いたときの料金です。

| 対象 | 数量 | 単価 | 月額 |
| --- | --- | --- | --- |
| コントロールプレーン（標準サポート） | 730 時間 | 0.10／時 | 73.00 |
| ノード（t4g.medium） | 2 × 730 時間 | 0.0432／時 | 63.07 |
| Auto Mode の管理料金 | 2 × 730 時間 | 0.00518／時 | 7.56 |
| ノードのエフェメラルストレージ | 2 × 20 GB | 0.096／GB 月 | 3.84 |
| ALB | 730 時間 | 0.0243／時 | 17.74 |
| パブリック IPv4 アドレス | （ALB 2 + ノード 2）× 730 時間 | 0.005／時 | 14.60 |
| 小計 | | | **179.81** |

1 日あたりでは USD 5.91 です。

この表からわかることを 3 つ挙げます。

**12章のおよそ 3.6 倍かかります。** 同じアプリ、同じ Pod の数で、12章は月 USD 50.33 でした。差の USD 129.48 のうち、USD 73.00 がコントロールプレーンです。残りは、Pod 2 つには大きすぎるノードの料金です。

**ノードは、ほとんど空いています。** 0.25 vCPU の Pod 2 つのために、2 vCPU のノードを 2 つ動かしています。Fargate は使うぶんの大きさで課金され、12章ではタスク 2 つで月 USD 17.99 でした。ノードに Pod を詰めていけば、Pod 1 つあたりの料金は下がります。Pod が少ないうちは、ノードの方式は割に合いません。

**Auto Mode の上乗せは、インスタンスの料金の 12% です。** ノード 2 つで月 USD 7.56 です。ノードの OS と Kubernetes の更新、ロードバランサーのコントローラーの面倒を自分で見る時間と比べる数字です。

ノードの置き場所と、バージョンの扱いで、合計は次のように変わります。

| 構成 | この章のぶん | 11章の側 | 合計 |
| --- | --- | --- | --- |
| 既定（パブリックサブネット） | 179.81 | 0 | 179.81 |
| `--node-subnets private` と NAT Gateway 1 つ | 172.51 | 49.03 | 221.55 |
| 既定の構成で、延長サポートに入ったバージョン | 544.81 | 0 | 544.81 |

2 行目の 11章の側には、NAT Gateway、その Elastic IP アドレス、NAT Gateway を通るデータを月 2 GB と仮定した料金が入っています。行ごとに丸めているので、足した値と合計は 1 セントずれます。

この表に入れていないものがあります。ノードのルートボリュームは、大きさを確かめられなかったので未算入です。エフェメラルストレージを gp3 としたのも仮定です。ノードの料金は Linux のオンデマンドの単価で計算しました。Auto Mode のノードは Bottlerocket で動きますが、Bottlerocket 用の別の単価があるかどうかは確かめていません。T4g の CPU クレジットの超過分、ALB の LCU、ログ、データ転送、12章のリポジトリの保存料金も未算入です。どれも 0 という意味ではありません。

無料枠は引いていません。EKS の料金ページには、クラスターの時間料金にも Auto Mode にも、無料枠の記述が見つかりませんでした。

**叩かれたら。** 入口は 12章と同じ ALB で、認証もスロットリングもありません。届いたリクエストはすべて Pod まで届きます。

固定費には上限があります。この章は Pod の数を自動で増やす設定（HorizontalPodAutoscaler）を入れていないので、Pod は 2 つのままです。ノードプールの上限は vCPU 8 つぶんで、ノードは 4 つまでしか増えません。4 つのまま 1 か月動いても USD 261.59 です。ノード 1 つあたり月 USD 40.89 です。

LCU、ログ、データ転送に上限が無いのは、12章と同じです。12章の[料金](/ja/chapters/12-containers/wrap.md)の計算が、そのまま当てはまります。Pod のログは、この章の構成では CloudWatch Logs に送っていません。ノードの上に残るだけで、ノードと一緒に消えます。

## Cloudflare と Vercel から来た人へ

<!-- section: 34.others -->

Cloudflare にも Vercel にも、Kubernetes の API を提供するサービスは見当たりません（2026-10-13 に、それぞれのドキュメントを読んだ範囲です）。かわりに、どちらもコンテナをクラスターなしで動かす方法を持っています。

**Cloudflare Containers** は、コンテナを Worker のコードから起動して制御します。入口は Worker で、コンテナには Durable Object を通して届きます。ドキュメント自身が、Kubernetes の operator を書くかわりに TypeScript を書く、と対比しています。使っていない間は止まり、料金も止まります。Workers Paid プランで使えます。イメージは `linux/amd64` で作る決まりなので、この章の arm64 のイメージはそのままでは動きません。stateless なアプリ向けの組み込みの autoscaling は、いまは無いと FAQ にあります。12章の[比較](/ja/chapters/12-containers/wrap.md)に、ECS と並べた表があります。

**Workers** は、コンテナもノードも持ちません。この章で書いた Deployment、Service、Ingress、PodDisruptionBudget、ノードプールに当たる設定が、そもそもありません。作るものが Workers の制約に収まるなら、この章の内容の大半は、考えなくてよいことです。

**Vercel** には、Vercel Functions の Container Runtime があります（ベータ、全プランで利用可）。プロジェクトの `Dockerfile.vercel` からイメージを作り、Functions として動かします。数の増減は自動で、CPU を使っている時間で課金されます。こちらも Kubernetes の API ではありません。

違いを 1 つにまとめると、誰がクラスターの面倒を見るかです。Cloudflare と Vercel では、クラスターに当たるものは見えず、バージョンも、ノードも、欠けてよい数も、利用者の仕事ではありません。EKS では、Auto Mode がノードを受け持っても、バージョンを上げる日、PodDisruptionBudget、アクセスエントリー、マニフェストは利用者の仕事として残ります。

Kubernetes が要るのは、Kubernetes の API そのものが要るときです。すでに持っているマニフェストや Helm のチャート、operator として配られているソフトウェア、Kubernetes を前提にした組織の道具がそれに当たります。コンテナを動かしたいだけなら、12章の ECS で足ります。Cloudflare や Vercel に収まっているなら、そこに留まるのがよい判断です。

## つまずきやすいところ

| こうなったら | ここを見る |
| --- | --- |
| `kubectl` が認証のエラーを返す | いまの AWS の認証情報に、アクセスエントリーがありません。クラスターを作ったのと同じ主体で実行しているかを `aws sts get-caller-identity` で確かめる |
| Pod が Pending のまま動かない | `kubectl -n notes describe pod` のイベントを見る。ノードプールが無い（`k8s/cluster.json` を適用していない）、`nodeSelector` に合うノードプールが無い、ノードプールの `limits.cpu` に達している、のどれかが多い |
| ノードが起動しない、または起動してもクラスターに参加しない | `kubectl get nodeclaim` と `kubectl describe nodeclaim` の Status を見る。ノードのロールのアクセスエントリー、サブネットの `Name` タグ、セキュリティグループの ID を確かめる |
| Pod が `ImagePullBackOff` になる | イメージのタグが 12章のリポジトリにあるか、ノードが ECR に届くか（プライベートサブネットなのに NAT が無い）を確かめる |
| Pod が `CrashLoopBackOff` になる | `kubectl -n notes logs deployment/notes-api` を見る。x86 でビルドしたイメージを arm64 のノードで動かしていないかを確かめる |
| Ingress の `ADDRESS` が空のまま | `kubectl -n notes describe ingress notes-api` のイベントを見る。IngressClass と IngressClassParams を適用したか、`Name` タグでサブネットが 2 つ見つかるかを確かめる |
| ALB の URL がエラーを返す | `aws elbv2 describe-target-health` で、ターゲットが登録されていて健全かどうかを見る。`/health` が 200 を返すか、Pod が ready かを確かめる |
| 入れ替えのたびに、数件のリクエストが失敗する | `preStop` の秒数が足りないか、`terminationGracePeriodSeconds` が短い。`src/timing.ts` の関係を確かめる |
| ノードの更新が進まない | `kubectl get pdb -A` で、`ALLOWED DISRUPTIONS` が 0 の PodDisruptionBudget を探す |
| `eks:infra:destroy` のあとも ALB が残っている | Ingress を消す前にクラスターを消しました。ALB、ターゲットグループ、セキュリティグループを手で消す |
| `net:infra:destroy` が `StackHasActiveImportsError` で止まる | この章のスタックが VPC を使っています。先に `eks:infra:destroy` を実行する |
| 使っていないのに請求がある | クラスターが残っています。コントロールプレーンだけで月 USD 73.00 です |

この表は、ドキュメントの記述から組み立てたものです。実際に起こして確かめたものは 1 つもありません。

## 本番にするなら

- **クラスターを作った主体を管理者にしない。** `bootstrapClusterCreatorAdminPermissions` を `false` にして、管理者のロールをアクセスエントリーで書きます。デプロイロールには namespace の中だけを渡します
- **API の入口を絞る。** いまは、クラスターの API がインターネットから届きます（認証は要ります）。`publicAccessCidrs` で送信元を限るか、パブリックの入口を閉じて VPC の中から使います
- **ノードをプライベートサブネットに置く。** `--node-subnets private` と、11章の NAT Gateway かエンドポイントを使います
- **インスタンスの種類に幅を持たせる。** ノードプールの条件を 1 種類に絞ると、その在庫に左右されます。AZ も 3 つにします
- **HTTPS にし、入口にスロットリングを置く。** 証明書を `IngressClassParams` に書き、AWS WAF を Ingress の annotation で付けます（21章）
- **ログとメトリクスを外に出す。** いまは Pod のログがノードの上にしかありません。コントロールプレーンのログも有効にしていません（19章）
- **Pod の数を負荷に合わせる。** HorizontalPodAutoscaler を足します。この章には入れていません
- **NetworkPolicy で Pod どうしの通信を絞る。** いまは、クラスターの中の Pod は互いに自由に通信できます
- **デプロイを GitOps かパイプラインにする。** いまは手元から `kubectl apply` しています。適用したものと、リポジトリにあるものが一致する保証がありません（20章）
- **バージョンを上げる日を決めておく。** 標準サポートの終わりを待たずに、試す用のクラスターで先に上げます
- **データをクラスターの外に置く。** [実装のつづき](/ja/chapters/34-eks/more.md)の最後の節のとおりです
- **反映の経路を AWS CDK CLI と CloudFormation にする。** cdkd の公式ドキュメントは、cdkd を開発・テスト用途向けとし、本番には AWS CDK CLI を勧めています（02章）

## 片付け

<!-- section: 34.cleanup -->

片付けには順番があります。**先に Ingress を消してください。** ALB は、スタックではなく Auto Mode が Ingress を見て作ったものです。EKS のドキュメントは、Ingress を消さずにクラスターを消すと ALB が残ると書いています。同じページの Auto Mode の項には、クラスターを消すとロードバランサーもすべて消えるともあります。どちらになるかを確かめていないので、この章は先に消す手順にしました。

```bash
kubectl -n notes delete ingress notes-api
aws elbv2 describe-load-balancers --region ap-northeast-1
```

2 つ目のコマンドの結果からこの章の ALB が無くなるまで待ってから、残りを消します。

```bash
vp run eks:manifests app --tag v1 | kubectl delete -f - --ignore-not-found
vp run eks:manifests cluster | kubectl delete -f - --ignore-not-found
vp run eks:infra:destroy
```

Pod が無くなると、Auto Mode がノードを止めます。クラスターを消せば、残っていたノードも消えるとドキュメントにあります。

12章と 11章のスタックも消すなら、この順番です。VPC を使っているスタックが残っていると、11章の destroy は拒否されます。

```bash
vp run ecs:infra:destroy
vp run net:infra:destroy
```

最後に、自分で確かめます。

```bash
aws eks list-clusters --region ap-northeast-1
aws elbv2 describe-load-balancers --region ap-northeast-1
aws elbv2 describe-target-groups --region ap-northeast-1
```

1 つ目に `aih-eks` が無く、2 つ目と 3 つ目にこの章のものが無ければ、時間課金は止まっています。

ノードは、EC2 のコンソールや `aws ec2 describe-instances` では確かめにくくなっています。2026 年 4 月 22 日以降、Auto Mode が作るインスタンスは、既定では一覧に出ません。ドキュメントは、EKS のコンソールのクラスターのページか、`DescribeInstances` の `include-managed-resources` パラメーターで見られるとしています。クラスターを消したあとに残っていないかは、翌日の請求でも確かめてください。

手元の kubeconfig には、消したクラスターの設定が残ります。害はありませんが、`kubectl` の既定の接続先になったままなので、別のクラスターを使うときは切り替えてください。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（87 件）。マニフェストがこの章のスキーマに合うこと、オブジェクトどうしの参照、`k8s/` のファイルとジェネレーターの一致、スキーマと参照の検査がそれぞれの誤りを報告すること。ローリングアップデート、PodDisruptionBudget、drain の計算。秒数の関係（12章の規則を含む）。サポート期間の日付の計算。本文の金額と、Price List の単価から `tools/src/pricing/calc.ts` が計算した値の一致。スタックのアサーション。型検査。`eks:infra:synth`（context なしと、`-c deployRoleArn=...` の 2 通り。ロールの ARN でない値が拒否されることも）。`eks:render`。`eks:manifests` を、値をすべてフラグで渡して実行し、`latest` のタグが拒否されること。`vp check --fix`（awscdk-lint を含む）が、この章のパスで警告なしで通ること。aws-cdk-lib 2.273.0 の `aws-eks` の `eks.Cluster`、`aws-eks-v2` の `Cluster` を 11章の VPC で synth し、リソースの種類と、ロールに付く管理ポリシーを見たこと。

**まだ確かめていないこと。** クラスターを一度も作っていません。次の項目は、すべて実環境での確認を待っています。cdkd 0.296.28 が Cloud Control API 経由で `AWS::EKS::Cluster`、`AWS::EKS::AccessEntry`、`AWS::EKS::PodIdentityAssociation` を作り、更新し、消せること。組み込みのノードプールなしの Auto Mode のクラスターが、このプロパティの組み合わせで作れること（`bootstrapSelfManagedAddons` を書かなかった場合の挙動を含む）。別のアプリのスタックから `Fn::ImportValue` で 11章の VPC を読めること。コントロールプレーンのネットワークインターフェースをプライベートサブネットに置き、ノードをパブリックサブネットに置く組み合わせで、ノードがクラスターに参加できること。`k8s/` のマニフェストを API サーバーが受け取ること。自前のノードクラスで `t4g.medium` のノードが起動すること、`Name` タグでサブネットを選べること、`associatePublicIPAddress` が効くこと。ノードのロールのポリシー 2 つで足りること。Ingress から ALB ができること、`IngressClassParams` の `subnets.matchTags` が `Name` タグで働くこと、Ingress の annotation 7 つが Auto Mode で効くこと。`preStop` の 15 秒と `minReadySeconds` の 30 秒で、入れ替えの間にエラーが出ないこと（`deregistrationLag` の 10 秒は仮定）。`preStop` の `sleep` が 1.37 のクラスターで受け付けられること。`runAsUser: 1000` と読み取り専用のファイルシステムで 12章のイメージが動くこと。Pod Identity の関連付けで、Pod に認証情報が届くこと。namespace を限った `AmazonEKSEditPolicy` で `k8s/app.json` の 5 つのオブジェクトを適用できること。drain のときに PodDisruptionBudget が計算どおりに働くこと。`KUBERNETES_VERSION` を上げたデプロイが、クラスターの更新として通ること。片付けの順番と、Ingress を消さなかったときに ALB が残るかどうか。「つまずきやすいところ」の症状。

一次情報で確かめられなかったこと。Auto Mode の組み込みのロードバランサーが Gateway API を扱うかどうか。Auto Mode で Pod の readiness gate が使えるかどうか。ノードのルートボリュームの大きさと、エフェメラルストレージの種類（gp3 と仮定）。Bottlerocket のノードに Linux の単価が当てはまること。ノードが 21 日の上限に達したとき、PodDisruptionBudget に止められていた Pod がどうなるか。`maxSurge` と `maxUnavailable` が割合のまま両方 0 になったときの Kubernetes の扱い（コードは拒否します）。`DescribeInstances` の `include-managed-resources` の、AWS CLI での書き方。Cloudflare と Vercel は、ドキュメントを読んだだけです。

cdkd が扱うリソースの種類。インストールした npm のパッケージ（0.296.28）の `dist` を読みました。バンドルにはソースのファイル名が残っています。`AWS::EKS` で始まる種類を登録している SDK のプロバイダーはありません。`AWS::EKS::Cluster`、`AccessEntry`、`PodIdentityAssociation` は、Cloud Control API が扱えない種類の一覧（`unsupported-types.generated.ts`）に無いので、Cloud Control API を経由します。`slow-cc-operation-timeouts.ts` は `AWS::EKS::Cluster` の作成と削除に 30 分を与え、`protection-flags.ts` は `DeletionProtection` を削除保護のプロパティとして知っています。`AWS::IAM::Role` には専用の実装があり、`AssumeRolePolicyDocument` と `ManagedPolicyArns` を扱います。

**コードの場所。**

| 節 | ファイル | `vp run` のタスク |
| --- | --- | --- |
| 全体像 | `examples/34-eks/infra/lib/eks-stack.ts`、`src/config.ts`、`k8s/` | `eks:infra:synth` |
| コントロールプレーンの料金 | `examples/34-eks/src/cost.ts`、`test/pricing.test.ts` | `test:unit` |
| ノードの用意のしかた | `examples/34-eks/src/manifests.ts`、`src/config.ts`、`k8s/cluster.json`、`test/manifests.test.ts` | `test:unit`、`eks:render` |
| クラスターを CDK で書く | `examples/34-eks/infra/lib/eks-stack.ts`、`infra/bin/app.ts`、`infra/test/eks-stack.test.ts` | `eks:infra:synth`、`test:unit` |
| 人とデプロイロールの入り方 | `examples/34-eks/infra/lib/eks-stack.ts`、`src/config.ts`、`infra/test/eks-stack.test.ts` | `test:unit` |
| Pod の権限 | `examples/34-eks/infra/lib/eks-stack.ts`、`infra/test/eks-stack.test.ts` | `test:unit` |
| マニフェストを、型のあるコードで書く | `examples/34-eks/src/k8s/schema.ts`、`src/k8s/check.ts`、`src/manifests.ts`、`src/rendered.ts`、`scripts/render.ts`、`k8s/`、`test/manifests.test.ts` | `test:unit`、`eks:render` |
| 入口 | `examples/34-eks/src/manifests.ts`、`k8s/app.json`、`k8s/cluster.json` | `test:unit` |
| 止められるとき | `examples/34-eks/src/timing.ts`、`test/timing.test.ts`、`examples/12-containers/src/timing.ts` | `test:unit` |
| 同時に欠けてよい Pod の数 | `examples/34-eks/src/rollout.ts`、`test/rollout.test.ts`、`src/config.ts` | `test:unit` |
| クラスターの外に置くもの | `examples/34-eks/infra/lib/eks-stack.ts` | |
| 手元で確かめる | `examples/34-eks/test/`、`infra/test/eks-stack.test.ts`、`scripts/render.ts` | `test:unit`、`eks:render`、`eks:infra:synth` |
| デプロイする | `examples/34-eks/infra/bin/app.ts`、`cdk.json`、`scripts/manifests.ts`、`tools/src/infra/` | `eks:infra:diff`、`eks:infra:deploy`、`eks:manifests`、`eks:infra:drift` |
| バージョンを上げる | `examples/34-eks/src/support.ts`、`test/support.test.ts`、`src/config.ts` | `test:unit` |
| 料金 | `examples/34-eks/src/cost.ts`、`test/pricing.test.ts`、`data/pricing/` | `test:unit` |
| 片付け | `tools/src/infra/` | `eks:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- EKS の全体: [Amazon EKS architecture](https://docs.aws.amazon.com/eks/latest/userguide/eks-architecture.html)、[Manage compute resources by using nodes](https://docs.aws.amazon.com/eks/latest/userguide/eks-compute.html)、[Simplify compute management with AWS Fargate](https://docs.aws.amazon.com/eks/latest/userguide/fargate.html)、[Simplify node lifecycle with managed node groups](https://docs.aws.amazon.com/eks/latest/userguide/managed-node-groups.html)
- Auto Mode: [Automate cluster infrastructure with EKS Auto Mode](https://docs.aws.amazon.com/eks/latest/userguide/automode.html)、[Create a Node Pool](https://docs.aws.amazon.com/eks/latest/userguide/create-node-pool.html)、[Enable or Disable Built-in NodePools](https://docs.aws.amazon.com/eks/latest/userguide/set-builtin-node-pools.html)、[Create a Node Class](https://docs.aws.amazon.com/eks/latest/userguide/create-node-class.html)、[Managed instances](https://docs.aws.amazon.com/eks/latest/userguide/automode-learn-instances.html)、[VPC Networking and Load Balancing](https://docs.aws.amazon.com/eks/latest/userguide/auto-networking.html)、[Create an IngressClass to configure an Application Load Balancer](https://docs.aws.amazon.com/eks/latest/userguide/auto-configure-alb.html)、[Tag subnets](https://docs.aws.amazon.com/eks/latest/userguide/tag-subnets-auto.html)、[cluster IAM role](https://docs.aws.amazon.com/eks/latest/userguide/auto-cluster-iam-role.html)、[node IAM role](https://docs.aws.amazon.com/eks/latest/userguide/auto-create-node-role.html)、[Create a cluster with the AWS CLI](https://docs.aws.amazon.com/eks/latest/userguide/automode-get-started-cli.html)、[Enable on an existing cluster](https://docs.aws.amazon.com/eks/latest/userguide/auto-enable-existing.html)、[Update the Kubernetes version](https://docs.aws.amazon.com/eks/latest/userguide/auto-upgrade.html)
- 権限: [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)、[Assign an IAM role to a Kubernetes service account](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-association.html)、[How EKS Pod Identity works](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-how-it-works.html)、[Set up the Pod Identity Agent](https://docs.aws.amazon.com/eks/latest/userguide/pod-id-agent-setup.html)、[Service accounts（IRSA との比較）](https://docs.aws.amazon.com/eks/latest/userguide/service-accounts.html)、[Assign IAM roles to Kubernetes service accounts（IRSA）](https://docs.aws.amazon.com/eks/latest/userguide/associate-service-account-role.html)、[Access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html)、[Access policy permissions](https://docs.aws.amazon.com/eks/latest/userguide/access-policy-permissions.html)、[Connect kubectl to an EKS cluster](https://docs.aws.amazon.com/eks/latest/userguide/create-kubeconfig.html)、[Set up kubectl](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)
- バージョン: [Kubernetes version lifecycle on EKS](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)、[Disable EKS extended support](https://docs.aws.amazon.com/eks/latest/userguide/disable-extended-support.html)、[Update existing cluster](https://docs.aws.amazon.com/eks/latest/userguide/update-cluster.html)、[Roll back a cluster](https://docs.aws.amazon.com/eks/latest/userguide/rollback-cluster.html)、[Delete a cluster](https://docs.aws.amazon.com/eks/latest/userguide/delete-cluster.html)
- 入口: [AWS Load Balancer Controller](https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html)、[Ingress annotations](https://github.com/kubernetes-sigs/aws-load-balancer-controller/blob/main/docs/guide/ingress/annotations.md)（オープンソースのコントローラーのドキュメント）
- CloudFormation: [AWS::EKS::Cluster](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-eks-cluster.html)と、ComputeConfig、AccessConfig、UpgradePolicy のページ
- Kubernetes: [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)、[Specifying a Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)、[Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)、[API-initiated Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/)、[Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)、[Container Lifecycle Hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)、[Pod Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)、[kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/)、[kubectl diff](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/)
- 料金: [Amazon EKS pricing](https://aws.amazon.com/eks/pricing/)、[Amazon ECS pricing](https://aws.amazon.com/ecs/pricing/)、AWS Price List bulk API の [EKS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEKS/current/ap-northeast-1/index.json)（公開日 2026-09-28）と [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.json)（公開日 2026-10-09）。ALB、パブリック IPv4 アドレス、gp3、NAT Gateway の単価は、これまでの章で取得したもの
- [docker-node: Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)（`node` ユーザーの uid）
- Cloudflare Containers: [Overview](https://developers.cloudflare.com/containers/)、[Lifecycle of a Container](https://developers.cloudflare.com/containers/platform-details/architecture/)、[FAQ](https://developers.cloudflare.com/containers/faq/)
- Vercel: [Container Runtime](https://vercel.com/docs/functions/runtimes/container)、[Runtimes](https://vercel.com/docs/functions/runtimes)
- [aws-cdk-lib 2.273.0](https://www.npmjs.com/package/aws-cdk-lib/v/2.273.0)（`aws-eks` と `aws-eks-v2` の型定義とソース、synth の結果）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)（`dist` のバンドル）

:::
