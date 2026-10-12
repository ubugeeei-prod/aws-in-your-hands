---
title: "55 Grafana: Amazon Managed Grafana で dashboard と alert を持つ"
revision: 1
---

# 55 Grafana: Amazon Managed Grafana で dashboard と alert を持つ

[19章](/ja/chapters/19-observability.md)のダッシュボードは CloudWatch のコンソールの中にあるので、見るには AWS アカウントに入る権限が要ります。Amazon Managed Grafana は AWS が運用する Grafana のサーバーで、人は IAM ではなく組織のサインインで入り、CloudWatch 以外のデータも同じ画面に並べられます。

この章で作るのは、19章と同じ数字を見せる Grafana のダッシュボードです。ダッシュボードが 2 か所にあると、片方だけ直されて、同じ障害を見ているはずの 2 人が違う数字を見ることになります。そこで、何を見るかの定義をコードに 1 つだけ置き、CloudWatch のダッシュボードはその定義と照合し、Grafana のダッシュボードはその定義から生成します。

ただし、この章のワークスペースは実際には作っていません。サインインの条件と月額の料金があるので、作る前に次の節を読んでください。前提は [19章](/ja/chapters/19-observability.md)と [01章](/ja/chapters/01-account.md)です。コードは `examples/55-grafana/` にあります。

## 全体像

<!-- section: 55.overview -->

```figure
caption: 定義は 1 つで、CloudWatch のダッシュボードはそれと照合し、Grafana のダッシュボードはそれから生成する
node def: signals.ts | 7 つのパネルの定義
node cw: CloudWatch ダッシュボード | 19章のスタック
node json: Grafana の JSON | 生成したもの
node ws: Grafana ワークスペース
node metrics: CloudWatch Metrics
node people: 利用者 | IAM Identity Center か SAML
edge def -> cw: 一致を検査
edge def -> json: 生成
edge json -> ws: HTTP API、15 分のトークン
edge ws -> metrics: ロールで GetMetricData
edge people -> ws: サインイン
mark def
```

Amazon Managed Grafana では、論理的に分かれた Grafana のサーバーをワークスペース（workspace）と呼びます。サーバーの用意、スケール、更新は AWS の仕事で、利用者が持つのはワークスペースの設定と中身です。東京リージョンでも使えます。

ワークスペースは、自分では数字を持ちません。パネルを開くたびに、データソース（data source）を通して CloudWatch などへ問い合わせます。CloudWatch への問い合わせには、ワークスペースに渡した IAM ロールの権限が使われます。

### サインインに要るもの

ワークスペースには、IAM ユーザーや IAM ロールではサインインできません。使えるのは、IAM Identity Center か、SAML 2.0 に対応した IdP のどちらか、または両方です。

IAM Identity Center を選ぶ場合、アカウントで AWS Organizations が有効になっている必要があります。公式ドキュメントによると、organization に属していないアカウントでも使えて、Identity Center を使う最初のワークスペースを作るときに、Managed Grafana が Organizations を有効にします。IdP を持っていなくても、Identity Center に組み込みのディレクトリがあるので、そこに利用者を作れます。

[01章](/ja/chapters/01-account.md)で `aws login` を選んだ読者は、IAM ユーザーで作業しています。その IAM ユーザーではワークスペースに入れないので、Grafana を使うには、Organizations と Identity Center を有効にするか、外部の IdP を SAML でつなぐことになります。前者は、アカウントの形を変える判断です。ドキュメントは、organization に属さないアカウントでワークスペースと利用者を管理するロールに `AWSOrganizationsFullAccess` などの管理ポリシーを求めていて、このポリシーはアカウントの管理者に相当すると注意しています。

そこまでする理由が無ければ、19章のダッシュボードとアラームで足ります。次の節に、その見分け方を書きました。

### 料金

料金は、ワークスペースごとに、その月に使った利用者の数で決まります。東京リージョンでは、編集者と管理者が 1 人あたり月 9、閲覧者が 1 人あたり月 5 です（USD、税別）。数えられるのは、その月に 1 回でもサインインしたか、API を呼んだ利用者だけです。

**ワークスペースは、誰もサインインしなくても月 9 かかります。** 料金ページに、ワークスペースごとに最低 1 つの Editor ライセンスが要ると書かれているためです。この章のスタックは、既定ではワークスペースを作りません。

初めて使うアカウントには 90 日の無料トライアルがあり、アカウントあたり 5 人までが無料になります。月額の内訳と、Grafana が CloudWatch を呼ぶぶんの料金は、[最後のページ](/ja/chapters/55-grafana/wrap.md)で計算します。

## CloudWatch のダッシュボードで足りる場合

<!-- section: 55.enough -->

19章のダッシュボードで足りるのは、見る人が全員 AWS アカウントに入れて、見たい数字が CloudWatch にある場合です。開発者が数人のチームなら、たいていこれに当たります。CloudWatch のダッシュボードは 19章のスタックの一部なので、アプリと一緒にデプロイされ、サインインの仕組みも月額の最低料金も増えません。

Grafana を足す理由になるのは、次のような場合です。

- AWS アカウントに入れたくない人にも見せたい。サポートや事業側の担当者を、組織の IdP でサインインさせ、閲覧者として割り当てられます
- CloudWatch に無い数字を、同じ画面に並べたい
- すでに Grafana のダッシュボードやアラートを持っていて、その置き場所を AWS に任せたい

2 つ目の、並べられるデータの種類について補足します。ワークスペースには AWS のサービス向けのデータソースが用意されています。CloudWatch はメトリクスとログを読み、この章で使うのはこれだけです。X-Ray のデータソースは、19章のトレースをダッシュボードや Explore の画面から開けるようにします。Athena のデータソースは SQL のクエリの結果をパネルにするので、[49章](/ja/chapters/49-athena.md)のように S3 に置いたログの集計を、メトリクスの隣に並べられます。Amazon Managed Service for Prometheus は、コンテナのメトリクスを Prometheus と同じデータモデルとクエリ言語で扱うサービスで、[34章](/ja/chapters/34-eks.md)のような Kubernetes のクラスターを見るときに使います。専用のデータソースは、Managed Grafana のバージョン 12 から用意されています。バージョン 9 以降のワークスペースでは、コアに含まれないデータソースはプラグインの導入が要ることがあります。

反対に、Grafana を足しても変わらないこともあります。アラームが見ているのは CloudWatch のメトリクスで、障害が AWS の側にあるかどうかは [44章](/ja/chapters/44-health.md)の Health が知らせます。Grafana は、すでにある数字の見せ方を変える道具で、数字そのものを増やしはしません。

次の[しくみと実装](/ja/chapters/55-grafana/build.md)で、定義、生成、ワークスペース、反映の順にコードを見ていきます。
