---
title: "34 Kubernetes: デプロイ"
---

# 34 Kubernetes: デプロイ

## デプロイする

<!-- section: 34.deploy -->

このページの 2 つ目のコマンドのまとまりから、時間課金が始まります。**このページのコマンドは、どれも実際の AWS では実行していません。** 手順は、ドキュメントと、固定した版の道具のソースから組み立てたものです。

この手順には `kubectl` が要ります。この本の devShell（Nix）には `kubectl` が入っていないので、別に用意してください。`kubectl` は、クラスターのバージョンと 1 マイナーバージョン以内のものを使います。このクラスターは 1.37 なので、1.36 から 1.38 です。

最初に、11章の VPC と、12章のリポジトリとイメージを用意します。12章のスタックは、タグなしでデプロイすればリポジトリだけになり、時間課金はありません。イメージのビルドとプッシュには Docker のデーモンが要ります。

```bash
vp run net:infra:deploy
vp run ecs:infra:deploy
vp run ecs:bundle
vp run ecs:image:build v1
vp run ecs:image:push v1
```

クラスターをデプロイします。**ここから 1 時間に USD 0.10 かかります。**

```bash
vp run eks:infra:diff
vp run eks:infra:deploy
```

cdkd は、Cloud Control API にクラスターの作成を頼み、終わるのを 30 分まで待ちます。この時点では、ノードもロードバランサーもありません。

`kubectl` の接続先を設定して、クラスターに届くことを確かめます。

```bash
aws eks update-kubeconfig --name aih-eks --region ap-northeast-1
kubectl get namespaces
```

`update-kubeconfig` は、手元の kubeconfig にクラスターの入口と、`aws eks get-token` で認証する設定を書きます。パスワードや鍵は保存されません。`kubectl` を実行するたびに、いまの AWS の認証情報から短い期限のトークンが作られます。クラスターをデプロイしたのと同じ認証情報で実行してください。別の主体は、アクセスエントリーが無いので拒否されます。

クラスター全体に効くマニフェストを適用します。

```bash
vp run eks:manifests cluster | kubectl apply -f -
```

`eks:manifests` は、スタックの出力からノードのロールの名前とクラスターのセキュリティグループの ID を読み、マニフェストに入れて標準出力に書きます。ノードプールができても、置き場所を待っている Pod が無いので、ノードはまだ起動しません。

アプリを適用します。**ここから、ノードとロードバランサーの時間課金が始まります。**

```bash
vp run eks:manifests app --tag v1 | kubectl apply -f -
kubectl -n notes rollout status deployment/notes-api
kubectl get nodes -o wide
kubectl -n notes get pods -o wide
```

Pod は最初 Pending になります。Auto Mode がそれを見てノードを起動し、ノードがイメージを取得して、Pod が動き始めます。`kubectl get nodes` に `t4g.medium` のノードが 2 つ、別々の AZ に現れるはずです。

ALB のホスト名は、Ingress の状態に入ります。使えるようになるまで数分かかると、ドキュメントにあります。

```bash
kubectl -n notes get ingress notes-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
curl -si http://xxxx.ap-northeast-1.elb.amazonaws.com/health
```

`x-app-version: v1` が返ってくれば、リクエストは Pod の中のサーバーまで届いています。

続けて、止めずに v2 へ入れ替えます。12章の `ecs:watch` は、URL を渡せばこの ALB にも使えます。別のターミナルで動かしたまま、次を実行してください。

```bash
vp run ecs:image:build v2
vp run ecs:image:push v2
vp run eks:manifests app --tag v2 | kubectl apply -f -
kubectl -n notes rollout status deployment/notes-api
```

うまくいかなかったときは、前の版に戻せます。ECS の circuit breaker と違い、Deployment は自動では戻しません。新しい Pod が ready にならなければ、古い Pod を残したまま入れ替えが止まり、既定では 600 秒で失敗と表示されるだけです。戻すのは人か、パイプラインです。

```bash
kubectl -n notes rollout undo deployment/notes-api
```

`rollout undo` は、クラスターの中の Deployment を前の版に戻しますが、リポジトリのマニフェストは v2 のままです。次に適用すれば、また v2 になります。戻したあとは、`--tag v1` で適用し直して、手元とクラスターを揃えてください。

デプロイロールにアプリの適用を任せるなら、スタックにロールの ARN を渡します。

```bash
vp run eks:infra:deploy -c deployRoleArn=arn:aws:iam::123456789012:role/aih-deploy
```

11章、12章と同じく、`-c` はその 1 回のコマンドにしか効きません。付け忘れてデプロイすると、アクセスエントリーが削除され、デプロイロールはクラスターに入れなくなります。

ドリフトの検査は、02章と同じです。

```bash
vp run eks:infra:drift
```

ドリフトの検査が見るのは、スタックが作ったものだけです。ノード、ALB、ターゲットグループ、そして Kubernetes のオブジェクトは、cdkd の state に無いので、検査の対象になりません。`kubectl edit` で Deployment を書き換えても、cdkd は気づきません。クラスターの中のドリフトは、`vp run eks:manifests app --tag v1 | kubectl diff -f -` で見ます。

## バージョンを上げる

<!-- section: 34.upgrade -->

EKS のクラスターには、ECS には無い期限があります。Kubernetes のマイナーバージョンは、およそ 4 か月に 1 つ出ます。EKS は、それぞれを公開から 14 か月のあいだ標準サポートとし、そのあとの 12 か月を延長サポートとします。

2026-10-13 に読んだ公開カレンダーでは、標準サポートは 1.34 から 1.37 の 4 つで、延長サポートは 1.31 から 1.33 の 3 つでした。この章の 1.37 は、2027 年 12 月 1 日に標準サポートを終えます。日付は変わることがあるので、作業の前に[カレンダー](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)を読み直してください。

<<< @/examples/34-eks/src/support.ts{calendar}

標準サポートを過ぎたクラスターがどうなるかは、`upgradePolicy` で決まります。

<<< @/examples/34-eks/src/support.ts{status}

<<< @/examples/34-eks/test/support.test.ts{status}

`EXTENDED` は CloudFormation から作るクラスターの既定で、延長サポートに入って同じバージョンに留まります。料金は 1 時間に USD 0.60 になり、月 USD 365.00 が上乗せされます。12 か月が過ぎると、EKS がクラスターを自動で上げます。

`STANDARD` は、標準サポートの終わりに EKS が次のバージョンへ自動で上げます。上乗せは払いません。この章のスタックはこちらです。一度延長サポートに入ったクラスターは、`STANDARD` に変えられません。

どちらを選んでも、**いずれクラスターは上がります。** 選べるのは、自分で決めた日に上げるか、期限の日に上げられるかだけです。14 か月に 1 度、長くても 26 か月に 1 度は、バージョンを上げる作業が来ます。Kubernetes を選ぶと付いてくる、いちばん確実な定期の仕事です。

上げるときの決まりは次のとおりです。

- 1 度に上げられるのは、1 マイナーバージョンです。1.34 から 1.37 へは、3 回かかります

<<< @/examples/34-eks/src/support.ts{plan}

- コントロールプレーンが先で、ノードがあとです。Auto Mode では、コントロールプレーンを上げたあと、ノードが新しいバージョンのものに順に入れ替わります。このとき PodDisruptionBudget が守られます。前のページの計算は、この入れ替えのためのものです
- 上げたあと 7 日以内なら、前のバージョンに戻せます。7 日を過ぎると戻せません
- 上げる前に、使っている API が次のバージョンで無くなっていないかを確かめます。EKS には upgrade insights という検査があります

この章のスタックでは、`src/config.ts` の `KUBERNETES_VERSION` を 1 つ上げてデプロイします。

<<< @/examples/34-eks/src/config.ts{names}

```bash
vp run eks:infra:diff
vp run eks:infra:deploy
```

cdkd が Cloud Control API 経由で `Version` の変更をクラスターの更新として扱えるかどうかは、確かめていません。`diff` で、クラスターが置き換えではなく更新と表示されることを必ず確かめてください。置き換えと表示されたら、実行せずに `aws eks update-cluster-version` を使い、あとでスタックを揃えます。

Auto Mode が受け持つので、VPC CNI、CoreDNS、kube-proxy、ロードバランサーのコントローラーを自分で上げる作業はありません。マネージドノードグループを選んだ場合は、これらとノードの AMI が、上げるたびの作業に加わります。
