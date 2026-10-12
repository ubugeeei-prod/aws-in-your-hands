---
title: "42 Firewall Manager: デプロイ"
---

# 42 Firewall Manager: デプロイ

## デプロイして確かめる

<!-- section: 42.deploy -->

ここからは、組織を持っている読者のための手順です。このページの内容は、どれも実行していません。ドキュメントと、[手元で確かめた](/ja/chapters/42-firewall-manager/local.md)テンプレートから組み立てた手順です。

デプロイした時点から、ポリシー 1 つにつき月 USD 100 がかかります。自動修復を有効にすると、範囲に入るメンバーアカウントに web ACL が作られ、そちらのアカウントにも料金がかかります。試すなら、アカウントが 1 つか 2 つしか入っていない練習用の OU を対象にしてください。

### 先に済ませておくこと

次の 4 つは、この章のタスクでは行いません。コンソールで済ませます。

1. 組織で「すべての機能」が有効になっていることを、Organizations のコンソールで確かめる
2. 組織の管理アカウントでサインインし、Firewall Manager のコンソールの Settings で、管理者アカウントにするアカウントの ID を指定する
3. 対象の OU に入っているアカウントと、管理者アカウントのすべてで、us-east-1 と ap-northeast-1 の AWS Config を有効にする。記録の頻度は連続にする
4. 通知まで確かめるなら、Security Hub CSPM を有効にする

3 は手間がかかります。Firewall Manager のドキュメントは、AWS Config を有効にする CloudFormation StackSets のサンプルテンプレートがあることを案内しています。この本では試していません。

対象にする OU の ID（`ou-` で始まる文字列）は、Organizations のコンソールで確かめます。

### デプロイする

Firewall Manager の管理者アカウントの認証情報で、2 つのスタックをデプロイします。アカウントの ID は、認証情報が指しているアカウントと同じものを渡します。

```bash
vp run fwm:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
vp run fwm:edge:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id>
```

1 行目は東京リージョンに、監査のポリシー、監査用のセキュリティグループ、通知の経路を作ります。2 行目は us-east-1 に、CloudFront 用の AWS WAF のポリシーを作ります。どちらも自動修復は無効で、この時点ではメンバーアカウントの何も変えません。

通知をメールで受け取るなら、1 行目に `-c notifyEmail=<address>` を足します。SNS が確認のメールを送るので、届いたリンクを開くまで、通知は届きません。

固定した版の cdkd は、`AWS::FMS::Policy` と `AWS::FMS::NotificationChannel` を Cloud Control API 経由で作ります。この経路でのデプロイは確かめていないので、最初の実行では、エラーの内容をよく読んでください。うまくいかない場合、同じテンプレート（`cdk.out/` の `*.template.json`）を CloudFormation で作るという道があります。ただし、cdkd と CloudFormation で同じスタックを交互に管理することはしないでください。

### 準拠の状態を見る

Firewall Manager のコンソールの Security policies に、2 つのポリシーが並びます。ドキュメントによると、作成には数分かかることがあり、そのあいだアカウントの欄は Pending と表示されます。アカウントの数に変わったら、ポリシーを開いて、準拠していないアカウントとリソースを見ます。

ここで見るのは、次の点です。

- 対象の OU のアカウントが、範囲に入るアカウントとして並んでいるか
- web ACL の付いていないディストリビューションが、準拠していないリソースとして出ているか
- 監査のポリシーで、どのセキュリティグループのどのルールが違反とされているか。[しくみと実装のページ](/ja/chapters/42-firewall-manager/build.md)のモデルが評価しなかった、送信元がセキュリティグループのルールがどう扱われているかも、ここで分かります

手元のモデルと違う結果が出たら、正しいのはサービスのほうです。

### 自動修復を有効にする

準拠の報告を読んで、変わってよいと判断してから、有効にします。

```bash
vp run fwm:edge:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id> -c wafRemediation=on
vp run fwm:infra:deploy -c adminAccountId=<12 digits> -c orgUnitIds=<ou-id> -c sgRemediation=on
```

1 行目で、範囲に入るディストリビューションに、ポリシーの web ACL が関連付けられます。すでに自分の web ACL が付いているディストリビューションも置き換えるなら、`-c replaceAccountWebAcls=on` を足します。置き換えると、元の web ACL に書いていたルールは効かなくなります。

2 行目で、違反とされた受信ルールが、書き換えられるか削除されます。動いているサービスの通信が止まることがあるので、違反の詳細を 1 件ずつ確かめてからにしてください。CDK で管理しているセキュリティグループは、先にコードを直します。

コンテキストは、毎回すべて渡します。`-c wafRemediation=on` を付け忘れて次のデプロイをすると、自動修復は無効に戻ります。

### ドリフトを調べる

```bash
vp run fwm:infra:drift
vp run fwm:edge:infra:drift
```

ドリフトの検査は、記録された state と実物を比べるもので、synth をしません。そのため、このタスクにはコンテキストを付けません。[02章](/ja/chapters/02-toolchain.md)のドリフト検出が、Cloud Control API 経由のリソースである `AWS::FMS::Policy` をどこまで比べられるかは、確かめていません。比べられなかったリソースは、02章で決めたとおり「差が無い」ではなく「比べていない」として報告されるはずです。

このタスクが見るのは、管理者アカウントにあるポリシーの定義だけです。メンバーアカウントのリソースがポリシーに合っているかどうかは、ドリフトではなく、準拠の報告で調べます。
