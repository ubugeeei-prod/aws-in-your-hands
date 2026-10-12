---
title: "21 Security: 実装のつづき"
---

# 21 Security: 実装のつづき

## WAF を付けられる入口、付けられない入口

<!-- section: 21.waf -->

AWS WAF は、リクエストがアプリに届く前に検査して、止めるものです。設定の単位を web ACL と呼びます。

どこにでも付けられるわけではありません。公式ドキュメントの一覧は、こうです（確認日 2026-10-12）。

- CloudFront の distribution
- API Gateway の REST API
- Application Load Balancer
- AppSync の GraphQL API、Cognito の user pool、App Runner の service、Bedrock AgentCore Gateway、Verified Access の instance、Amplify

この本で使ってきた入口のうち、API Gateway の HTTP API（04章）と、Lambda の function URL（09章、17章）は、この一覧にありません。付けたければ、手前に CloudFront を置いて、CloudFront に付けます。この章の構成が CloudFront から始まっているのは、そのためです。

WAF が付かないからといって、歯止めが無いわけではありません。HTTP API を使う章（04章から）は、stage の流量制限で API 全体を毎秒 10 件に抑えています。料金はかかりません。ただ、あれは全員まとめての上限で、IP アドレスごとに分けてはくれません。function URL には、それにあたる設定がありません。

ただし、CloudFront に付けただけでは足りません。裏の入口が開いていたら、そちらから入れます。

<<< @/examples/21-security/infra/lib/security-stack.ts{entry}

function URL の `AuthType` を `AWS_IAM` にして、CloudFront の origin access control に署名させる。09章と同じ形です。署名のないリクエストは、関数が動く前に Lambda が断ります。CloudFront を迂回する道が無いので、web ACL を迂回する道もありません。

HTTP API を CloudFront の裏に置く構成は、この本では実装も検証もしていません。やるなら、裏の入口をどう閉じるかを先に決めてからにしてください。

署名には制約もあります。CloudFront は、署名を `Authorization` ヘッダーに入れます。なので、この API は token を `x-aih-token` という別のヘッダーで受け取ります。そして 09章で話したとおり、POST や PUT は、呼ぶ側が本文の SHA-256 をヘッダーに入れる必要があります。この API は GET と HEAD だけにしました。

### web ACL

<<< @/examples/21-security/infra/lib/waf-stack.ts{web-acl}

CloudFront 用の web ACL は、us-east-1 に作ります。distribution や origin がどこにあっても、です。この stack は、ほかのリージョンを指定すると synth で止まります。

rule は 3 つです。

1 つ目は rate-based rule。1 つの IP アドレスから、5 分間に 300 回を超えたら block します。[14章](/ja/chapters/14-kv-cache.md)の rate limit との違いは、場所です。あちらはアプリの中で、公平に配るためのもの。こちらはアプリの手前で、Lambda を呼ばせないためのものです。

正確さは期待しないでください。ドキュメントによると、AWS WAF は約 10 秒ごとに率を見積もっていて、設定した上限の「近く」で制限しますが、ぴったりは保証しません。上限を超えてから block が始まるまで、ふつうは 30 秒未満、長いと数分かかります。その間のリクエストは通ります。

2 つ目と 3 つ目は、AWS が保守している managed rule group です。評判の悪い IP アドレスの一覧と、よくある攻撃の pattern を集めた core rule set。

core rule set は、最初は `count` にしてあります。止めずに、「止めていたはず」を数えるだけ。この rule group には、8 KB を超える本文を block する rule などが入っていて、正当なリクエストを止めることがあるからです。AWS も、本番のトラフィックに対して count で様子を見てから有効にするよう勧めています。block に切り替えるのは `-c wafCommonRules=block` です。

### 付ける手順

stack が 2 つのリージョンに分かれるので、2 段階です。

```bash
vp run sec:waf:infra:deploy
vp run sec:infra:deploy -c webAclArn=<WebAclArn の出力>
```

1 行目を実行した時点から、web ACL の月額が始まります。distribution に付けていなくても、です。

料金は、web ACL 1 つが月 USD 5、rule 1 つが月 USD 1（managed rule group は 1 つと数える）、検査したリクエスト 100 万件ごとに USD 0.60。この章の構成だと、リクエストが 0 でも月 USD 8.00、100 万件で USD 8.60 です。Bot Control のような追加の rule group は、別に月額とリクエスト料金がかかるので、入れていません。テストは、それらが入っていないことも固定しています。

外すときは、逆の順です。先に `webAclArn` なしで `sec:infra:deploy` して distribution から外し、それから `sec:waf:infra:destroy`。

## IAM の変更は、すぐには届かない

<!-- section: 21.iam-consistency -->

この章の分散システムの話は、IAM です。

IAM のドキュメントに、こういう一節があります。IAM は、世界中のデータセンターのコンピューターを通じて使われるサービスなので、eventual consistency（結果整合性）という分散の model を使っている。変更が、すべての endpoint から見えるようになるまでには時間がかかる。cache もあるので、古い情報が期限切れになるまで見えないこともある。

つまり、role に権限を足した直後の呼び出しは、拒否されることがあります。権限を消した直後の呼び出しは、通ることがあります。どのくらいの時間なのか、ドキュメントは数字を書いていません。この本でも計っていません。

AWS の勧めは 2 つです。IAM の変更を、止まっては困る処理の途中に入れないこと。そして、変更が行き渡ったことを確かめてから、それに頼ること。

### 許可したあと

デプロイは、role を作って、すぐにその role で関数を動かします。まさに「変更の直後」です。なので、動作確認のスクリプトは、拒否を一度で失敗にしません。

<<< @/examples/21-security/src/propagation.ts{until-allowed}

再試行するのは、拒否だけです。ほかのエラーは、待っても直らないので、すぐ上げます。そして回数に上限があります。上限まで拒否され続けたら、それはもう伝播の遅れではなく、policy の書き間違いです。「待てば直る」と「待っても直らない」を、どこかで切り分けないといけません。

関数の側は、secret を読む権限が無いとき、503 と `retry-after` を返します。

<<< @/examples/21-security/src/app.ts{unavailable}

<<< @/examples/21-security/scripts/smoke.ts{wait-for-iam}

正直に言うと、デプロイ直後に実際に 503 が返るのかどうかは、確かめていません。返らないかもしれません。返らなければ、この待ちは一度も使われず、害もありません。

### 取り消したあと

逆向きのほうが、危険です。鍵が漏れた、role を乗っ取られた、というとき、人は権限を消して、一度試して、拒否されたのを見て安心します。

<<< @/examples/21-security/src/propagation.ts{until-denied}

1 回の拒否は、その 1 回が、変更を知っている endpoint に届いたというだけです。この関数は、続けて何回か拒否されるまで、「止まった」と言いません。テストは、拒否、許可、拒否、拒否、拒否、という順序を再現して、最初の拒否で確認済みにしないことを見ています。

とはいえ、これも「数回続けて拒否された」以上のことは言えません。本当に急ぐときは、権限を消すのに加えて、守るもの自体を変えます。この章なら、secret を rotation する（`--force` で）。漏れた鍵が、もう正しい鍵ではなくなれば、IAM がどこまで行き渡ったかを気にしなくて済みます。

この関数は、この章のタスクからは呼んでいません。試す手順は、検証メモの再開手順に書いてあります。

### いつ変えたかは、CloudTrail が知っている

```bash
vp run sec:trail:iam
```

直近 24 時間の、IAM への変更を一覧にします。誰が、いつ、どの操作をしたか。デプロイしたあとなら、`CreateRole` や `PutRolePolicy` が並ぶはずです。

1 つ、ハマりどころがあります。IAM は global なサービスで、その event は us-east-1 に記録されます。東京リージョンの event history をいくら探しても、IAM の変更は出てきません。このタスクは、最初から us-east-1 を見に行きます。

そして、ここに出る時刻は、API が呼ばれた時刻です。その変更が、すべての endpoint で効き始めた時刻ではありません。

## 見張る道具は、それぞれ別のものを見ている

<!-- section: 21.detect -->

名前が似ているので混ざりやすい 4 つを、並べておきます。

```text
service      question it answers                          looks at                               result
Inspector    does my code have known vulnerabilities?     Lambda packages, ECR images, EC2       findings per CVE
GuardDuty    is someone acting like an attacker?          CloudTrail events, VPC flow, DNS logs  findings per suspicious activity
CloudTrail   who called which API, and when?              every management API call              events, 90 days free
AWS Config   what did this resource look like last week?  resource configurations over time      configuration items
```

Inspector と GuardDuty は、よく「どっちを入れればいい？」と聞かれますが、別物です。

**Inspector** は、脆弱性の検査です。あなたの Lambda 関数に入っているパッケージ、ECR のコンテナイメージ、EC2 のインスタンスを調べて、既知の脆弱性（CVE）が無いかを見ます。攻撃が起きているかどうかは見ません。関数をデプロイしたとき、そして新しい CVE が公開されたときに、検査し直します。この本のように、依存を bundle して Lambda に載せる構成だと、「デプロイしたあとで見つかった脆弱性」に気づく手段になります。

**GuardDuty** は、脅威の検出です。CloudTrail の event や、VPC の通信の記録を分析して、「漏れた認証情報が、知らない場所から使われている」「暗号通貨の採掘らしい通信がある」といった、怪しい動きを見つけます。コードに穴があるかどうかは見ません。

**CloudTrail** は記録です。判断はしません。event history は最初から有効で、management event を 90 日ぶん、リージョンごとに持っています。無料です。90 日より長く残したい、S3 に置いて検索したい、Access Analyzer に読ませたい、となったら trail を作ります。management event の 1 つ目のコピーを S3 に届けるぶんは無料で、かかるのは S3 の保存料金です。

**AWS Config** は、リソースの設定の履歴です。「この security group は、いつ、どう変わったか」に答えます。[02章](/ja/chapters/02-toolchain.md)の drift 検出は「いま、コードと違うか」でした。Config は「これまで、どう変わってきたか」です。記録する設定 1 件ごとに料金がかかります。

### なぜ stack に入れていないか

GuardDuty と Inspector は、2 段目に置きました。守るものができたら、入れる価値があります。でも、この章の CDK には入れていません。理由は 3 つです。

1 つ目。どちらも、アカウントとリージョンに 1 つの設定です。練習用の stack を消すときに、一緒に無効になっては困ります。

2 つ目。既定の範囲が広いんです。GuardDuty のドキュメントによると、初めて有効にすると、そのリージョンで使える protection plan が、既定ですべて有効になります。Inspector も、コンソールから有効にすると、すべての種類の検査が始まります。何が有効になったかを、画面で見ながら決めてほしい。

3 つ目。料金が、使ってみないと分かりません。どちらにも無料の試用期間があって（GuardDuty は 30 日、Inspector は 15 日）、その間にコンソールが「このままだと月いくら」を見積もってくれます。その数字を見てから決めるのが、いちばん確かです。

なので手順は、コンソールで有効にして、`vp run sec:posture` で確かめる、です。01章の root の MFA と同じ扱いですね。固定した版の cdkd が GuardDuty の detector に専用の実装を持っていない、という事情もあります。

正直に言うと、この節の内容は、ドキュメントを読んだだけです。どちらも有効にしていません。finding がどんな形で出るのかも、見ていません。

## 組織になったら

<!-- section: 21.organizations -->

1 人で 1 つのアカウントを使っているあいだは、ここまでで足ります。人が増えて、アカウントが増えると、別の問題が出てきます。「全員が正しく設定してくれる」ことに頼れなくなるんです。

AWS Organizations は、複数のアカウントを 1 つの organization にまとめるサービスです。追加料金はかかりません。organization を作ったアカウントが management account になり、請求をまとめ、ほかのアカウント（member account）に policy を付けられるようになります。

20章で、「dev と prod を同じアカウントに置くかぎり、名前でしか分かれていない」と書きました。その先にあるのが、これです。

### SCP は、権限を与えない

SCP（service control policy）は、member account の IAM user と role に「許せる権限の上限」を決める policy です。見た目は IAM の policy とそっくりですが、働きが違います。

SCP は、権限を与えません。上限を決めるだけです。

<<< @/examples/21-security/src/policy-model.ts{decide}

これは、IAM と SCP の組み合わせ方を、テスト用に小さく model にしたものです。本物の IAM の評価ではありません。でも、要点は 3 行に入っています。

- どこかに明示的な `Deny` があれば、拒否
- root から、途中の OU、アカウントまで、すべての階層の SCP が許していて
- かつ、本人の IAM policy も許しているときだけ、許可

2 行目が、SCP を初めて触る人が事故を起こすところです。SCP を有効にすると、Organizations は `FullAWSAccess` という「全部許可」の SCP を、すべての階層に付けます。これを外して、`Deny` だけの SCP に付け替えると、「許している SCP」が無くなって、そのアカウントでは何もできなくなります。テストに、その順序を入れてあります。

もう 1 つの注意。SCP は management account には効きません。service-linked role にも効きません。management account でふだんの作業をしないのは、このためです。

### 最初の guardrail

<<< @/examples/21-security/policies/scp-guardrails.json

4 つの statement は、どれも `Deny` です。`FullAWSAccess` を付けたまま、その上に重ねて使います。

1. organization から抜けさせない
2. 監査の記録を止めさせない。CloudTrail の trail、GuardDuty の detector、Config の recorder
3. この本が使わないリージョンでは、何もさせない。AWS のドキュメントの例と同じ形で、`NotAction` で global なサービスを除いています。除く一覧は、ドキュメントの例に合わせた 4 つだけです。AWS が公開している例の policy には、40 ほどのサービスが並んでいます。使うサービスに合わせて足してください
4. member account の root ユーザーには、何もさせない

1 つ目から 3 つ目は、管理者の権限を持っている人にも効きます。01章の `AdministratorAccess` を持ったままでも、trail は止められなくなります。「絞る方法」の、もう 1 つの答えです。

テストは、この JSON を model に通して確かめます。

- 管理者でも、`cloudtrail:StopLogging` や `organizations:LeaveOrganization` は拒否される
- 管理者でも、`eu-west-1` での `ec2:RunInstances` は拒否される。`ap-northeast-1` なら通る
- IAM policy を何も持たない人は、SCP が全部許可でも、何もできない
- `Principal` を含む statement は、読み込みで落ちる（SCP は `Principal` を持てません）
- 空白を除いた長さが、SCP の上限の 10,240 文字より短い
- model が知らない条件を含む policy は、評価を断る。知らない条件を「真」として扱わない

### これは CDK で作っていない

Organizations と SCP は、この章の stack に入っていません。タスクもありません。

organization を作る、アカウントを移す、SCP を付ける。どれも、実際のアカウントの構成を変える操作で、練習用の stack のように「消せば元どおり」にはなりません。SCP を root に付けて間違えると、全アカウントが止まります。AWS も、SCP は root にいきなり付けず、専用の OU を作って、アカウントを 1 つずつ入れて試すよう強く勧めています。

なのでこの章が渡すのは、policy の JSON と、それを付ける前に確かめるテストまでです。付けるのは、あなたの organization の、あなたが選んだ OU に、あなたの手で。

model には限界があります。知っている条件は `aws:RequestedRegion` と `aws:PrincipalArn` の 2 つだけ。resource の一致も見ていません。「テストが通った」は、「この model の範囲では、意図どおりに書けている」という意味です。実際の organization に付けて確かめてはいません。
