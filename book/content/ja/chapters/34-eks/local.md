---
title: "34 Kubernetes: 手元で動かす"
---

# 34 Kubernetes: 手元で動かす

## 手元で確かめる

<!-- section: 34.local -->

この章では、手元でクラスターを動かしません。Nix の shell には Docker のデーモンも、kind や minikube も入っていないからです。アプリそのものは、12章の `vp run dev:ecs` で動かせます。イメージもサーバーも同じものです。

手元で確かめられるのは、クラスターに渡す前の段階です。

```bash
vp run test:unit
vp run eks:render
vp run eks:infra:synth
vp run eks:infra:synth -c deployRoleArn=arn:aws:iam::123456789012:role/aih-deploy
```

テストは、次の 5 つの対象を見ています。

| 対象 | ファイル | 見ているもの | 見ていないもの |
| --- | --- | --- | --- |
| マニフェスト | `test/manifests.test.ts` | この章のスキーマに合うこと、オブジェクトどうしの参照、`k8s/` のファイルとジェネレーターの一致 | API サーバーが受け取ること、Auto Mode がそのとおりに動くこと |
| 欠けてよい数 | `test/rollout.test.ts` | 入れ替え、PodDisruptionBudget、drain の計算 | 実際のスケジューラーとコントローラーの動き、ノードの故障 |
| 時間 | `test/timing.test.ts` | 秒数どうしの関係。12章の規則も含む | その値で実際にリクエストが落ちないこと |
| サポート期間と料金 | `test/support.test.ts`、`test/pricing.test.ts` | 日付の計算、本文の金額と料金データの一致 | 請求そのもの |
| インフラ | `infra/test/eks-stack.test.ts` | ロールの信頼ポリシーとポリシー、アクセスエントリーの範囲、Auto Mode の設定、リソースの種類 | cdkd と Cloud Control API がテンプレートどおりに作れること |

マニフェストを、スタックをデプロイせずに出力することもできます。値をすべてフラグで渡すと、AWS を読みません。

```bash
vp run eks:manifests cluster --node-role AihEks-NodeRole-EXAMPLE --security-group sg-0123456789abcdef0
vp run eks:manifests app --image 123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/repository-name:v1
```

次のものは、手元では再現できません。

- クラスターの作成と、ノードがクラスターに参加すること
- Pod のスケジューリング、probe、入れ替え、drain の実際の動き
- Auto Mode が Ingress から ALB を作ること、annotation が効くこと
- Pod Identity の認証情報が Pod に届くこと
- cdkd が Cloud Control API 経由で `AWS::EKS` のリソースを作れること

手元にクラスターを立てる道具（kind など）で `k8s/app.json` を試すことはできますが、`k8s/cluster.json` の NodeClass、NodePool、IngressClassParams は EKS の独自の種類なので、適用できません。この本では試していません。
