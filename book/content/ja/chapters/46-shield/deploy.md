---
title: "46 Shield: デプロイ"
---

# 46 Shield: デプロイ

[しくみと実装](/ja/chapters/46-shield/build.md)で作った 2 つのスタックをデプロイする手順と、攻撃を受ける前に決めておくことを、このページにまとめます。どの手順も、この章では実行していません。

## デプロイして確かめる

<!-- section: 46.deploy -->

既定のスタックは、月額のかかるものを何も作りません。

```bash
vp run shield:infra:diff
vp run shield:infra:deploy
```

確かめることは 3 つあります。スタックの出力の名前で書きます。

- `FunctionUrl` を `curl -i` で直接呼ぶと、403 が返る。オリジンが閉じていることの確認です
- `Url` の `/health` を 2 回続けて呼ぶと、2 回目の応答の `x-cache` が `Hit from cloudfront` になり、`x-request-id` が 1 回目と同じになる
- `/health?x=1` でも、同じキャッシュが返る。`/notes` は、何度呼んでも `x-cache` が `Miss from cloudfront` のままになる

web ACL を付けるときは、スタックが 2 つのリージョンに分かれているので、2 段階でデプロイします。**1 行目を実行した時点から、月 USD 6.10 がかかります。**

```bash
vp run shield:edge:infra:deploy
vp run shield:infra:deploy -c webAclArn=<AihShieldEdge の WebAclArn>
```

歯止めも付けるなら、同じコマンドに足します。

```bash
vp run shield:infra:deploy -c webAclArn=<AihShieldEdge の WebAclArn> -c reservedConcurrency=20
```

`-c` の値はデプロイのたびに渡します。省いてデプロイし直すと、その設定は外れます。

アラームを人に届けるには、us-east-1 に SNS のトピックを用意して、`shield:edge:infra:deploy` に `-c alarmTopicArn=<ARN>` を付けます。アラームは us-east-1 にあるので、トピックも同じリージョンのものを渡します。別のリージョンのトピックに通知できるかどうかは確かめていないので、設定の検査は us-east-1 のトピックだけを受け付けます。19章のトピック（ap-northeast-1）は渡せません。トピックを渡さなければ、アラームはコンソールに出るだけです。

Shield Advanced を契約済みのアカウントでは、保護を足せます。

```bash
vp run shield:edge:infra:deploy -c shieldAdvanced=on -c distributionArn=<AihShield の DistributionArn>
```

レートベースのルールが効くことを確かめたいときは、自分の 1 つのアドレスから、自分のディストリビューションに、上限を少し超える程度のリクエストを送るだけにします。たとえば毎秒 10 件を 3 分です。負荷試験について AWS が定めていることは、[32章](/ja/chapters/32-limits.md)にあります。

攻撃を模した試験は、自分では行えません。AWS の DDoS Simulation Testing Policy は、模擬試験を、AWS が事前に認めたパートナーが行うものに限っています。対象も、Shield Advanced を契約したアカウントで保護しているリソースなどに限られ、リクエスト数は毎秒 50,000 件までと決められています。この章のシミュレーションが手元のモデルなのは、そのためでもあります。

```bash
vp run shield:infra:drift
```

非常停止（次の節）を手で打つと、関数の予約済み同時実行数がテンプレートと食い違い、ドリフトとして出るはずです。

## 攻撃の前に用意するもの

<!-- section: 46.runbook -->

攻撃の最中に、初めて読むドキュメントから手順を組み立てる時間はありません。前もって書いておくことを、順に挙げます。

### 見るメトリクス

どれも、ふだんの値を知らなければ、異常に気づけません。平常時の 1 週間ぶんを先に見ておきます。

| メトリクス | 場所 | 読み方 |
| --- | --- | --- |
| `AWS/CloudFront` の `Requests`、`4xxErrorRate`、`5xxErrorRate` | us-east-1 | リクエスト数がふだんの何倍か。429 が増えていれば、歯止めが効いている |
| `AWS/WAFV2` の `BlockedRequests` | us-east-1 | レートベースのルールが止めている数。この章のアラームが見ているもの |
| `AWS/Lambda` の `Invocations`、`Throttles`、`ConcurrentExecutions` | ap-northeast-1 | 関数まで届いた数と、歯止めが断った数 |
| `AWS/DDoSProtection` の `DDoSDetected` ほか | CloudFront は us-east-1 | Shield Advanced で保護したリソースにだけ出る |

`AWS/DDoSProtection` は、Shield Advanced が、保護しているリソースについて出すメトリクスです。契約していないアカウントでこの名前空間に何か出るかどうかは、確かめていません。ドキュメントに書かれているのは、Advanced の利用者に向けた説明だけです。

### 打てる手

効き目が穏やかなものから順に並べます。

1. 誰が送っているかを見る。web ACL はリクエストのサンプルを残す設定にしてあります。レートベースのルールがいま制限している IP アドレスの一覧は、コンソールには出ないので、`aws wafv2 get-rate-based-statement-managed-keys` で取ります
2. レートベースのルールの上限を下げる。`src/defences.ts` の数字を変えて `shield:edge:infra:deploy` です。設定を変えると数え直しになり、最大で 1 分、制限が止まります
3. キャッシュできるルートを増やす。攻撃が特定のルートに集中していて、その答えが誰にでも同じなら、いちばんよく効きます
4. 関数の予約済み同時実行数を下げる。関数の後ろにあるものを守れますが、利用者も同じ割合で断られます
5. 非常停止。予約済み同時実行数を 0 にすると、function URL はすべてのリクエストに 429 を返します

```bash
aws lambda put-function-concurrency --function-name <FunctionName の出力> --reserved-concurrent-executions 0
```

5 は、サービスを自分で止める操作です。関数の後ろに、止めないと請求が膨らみ続けるものがあるときにだけ使います。誰が判断してよいのかも、前もって決めておきます。戻すときは、`shield:infra:deploy` を実行し直します。

### 連絡先

Shield Advanced を契約していなければ、連絡先は通常のサポートです。攻撃のときに SRT へつないでもらえるのは、Advanced の利用者で、かつ Business 以上のサポートプランを契約している場合に限られます。自分のアカウントのサポートプランで、どの窓口が、どのくらいの時間で応じるのかを確かめて、書いておきます。

障害が攻撃なのか、AWS の側の問題なのかを切り分けるには、[44章](/ja/chapters/44-health.md)の AWS Health を見ます。

### 終わったあと

- 何が届いて、どの手が効いたかを記録します。次に備えて、上限の数字とキャッシュするルートを見直します
- 手で変えた設定を、コードに戻すか、コードの側を合わせます。ドリフト検出で確かめます
- Shield Advanced の利用者は、攻撃のあった請求月が終わってから 15 日以内に、件名に `DDoS Concession` と書いた請求のケースで、クレジットを申請できます
