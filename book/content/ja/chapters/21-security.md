---
title: "21 Security: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations"
revision: 2
---

# 21 Security: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations

01章の `AdministratorAccess` を絞る方法、03章の WAF、04章の「秘密は環境変数に置かない」は、どれも 21章で扱うと書いて先送りにしてきました。この章でまとめて扱います。

AWS で「セキュリティ」と名の付くサービスをすべて有効にする章ではありません。1 人で使っているアカウントに要るものと、人やアカウントが増えてから要るものを分け、前者だけを実際に入れます。後者については、何のためのサービスで、いくらかかるかを説明します。

料金を先に書いておくと、何も指定せずにデプロイしたこの章のスタックで月額がかかるのは、シークレット 1 つだけです（月 USD 0.40、時間割り）。**KMS の鍵と web ACL は、置いてあるだけで毎月料金がかかるので、明示的に指定したときにしか作りません**。GuardDuty、Inspector、AWS Config は、この章のスタックに入れていません。入れていない理由は[実装のつづき](/ja/chapters/21-security/more.md)で説明します。

この章の AWS 側の手順は、まだ一度も実際に動かしていません。手元で確かめたのは、テスト、型検査、synth、手元のサーバーまでで、内訳は[章末の検証メモ](/ja/chapters/21-security/wrap.md)にあります。

前提は [06章](/ja/chapters/06-auth.md)と [20章](/ja/chapters/20-shipping.md)です。CloudFront と関数 URL（function URL）の組み合わせは [09章](/ja/chapters/09-ssr.md)で扱いました。コードは `examples/21-security/` にあります。

## 入れる順番

<!-- section: 21.tiers -->

AWS のコンソールで「Security」を開くと、多くのサービスが並んでいます。すべて有効にすると、毎月の請求と、誰も読まない通知が増えます。かといって何も入れなければ、鍵が漏れても気づけません。

この本では、3 段に分けて考えます。

```text
tier            what                          what it costs                     how this chapter handles it
everyone        root MFA, no root access keys free                              sec:posture fails without them
                CloudTrail event history      free, always on, 90 days          sec:trail:iam reads it
                least-privilege roles         free                              wildcard lint in tests
                secrets out of env vars       per secret per month              default stack
with-data       GuardDuty (threat detection)  per event and GB, after a trial   console; sec:posture reports it
                Inspector (vulnerabilities)   per function, image, instance     console; sec:posture reports it
                AWS WAF on CloudFront         per web ACL and rule per month    opt-in stack AihSecurityWaf
                customer managed KMS key      per key per month                 opt-in: -c cmk=on
organization    CloudTrail trail              S3 storage                        explained, not created
                AWS Config                    per configuration item            explained, not created
                Organizations and SCPs        free                              policy JSON and tests only
```

1 段目（everyone）は、アカウントを持った日からやることで、料金はほぼかかりません。2 段目（with-data）は、漏れたら困るデータや、止まったら困るサービスを持ってから入れます。3 段目（organization）は、関わる人やアカウントが 2 つ以上になってから入れます。

この 3 段は AWS の公式な分類ではなく、この本の判断です。事情に合わせて前後させて構いません。大事なのは、いま入れていないものについて、忘れているのではなく選んで入れていないと言えることです。

いまのアカウントがどの状態にあるかは、次のタスクで確認できます。

```bash
vp run sec:posture
```

このタスクは読み取りしかせず、何も変更しません。6 つのサービスに問い合わせて、結果を 3 段に並べます。

<<< @/examples/21-security/src/posture.ts{assess}

[02章](/ja/chapters/02-toolchain.md)のドリフト検出では、「差が見つからなかった」と「すべて比べて一致した」を別の状態として扱いました。このタスクも同じ考え方で、権限が足りなくて読めなかった項目を `off` ではなく `unknown` にします。

<<< @/examples/21-security/src/posture.ts{snapshot}

タスクが失敗するのは、1 段目の項目が `on` でないときだけです。

<<< @/examples/21-security/src/posture.ts{gate}

GuardDuty が無効でも、タスクは失敗しません。GuardDuty を入れないのは選択のうちですが、root ユーザーに MFA が無いのは選択ではないからです。

## 全体像

<!-- section: 21.architecture -->

題材は小さなトークン API です。`/token` が署名付きのトークンを発行し、`/verify` がそのトークンを検証します。署名に使う鍵が、この章で守るシークレットです。

```figure
caption: viewer からシークレットまでの経路に、WAF、関数のロール、シークレットを暗号化する鍵が並び、CloudTrail がそれらへの管理操作を記録する
node viewer: Viewer | HTTPS, GET と HEAD だけ
node waf: Web ACL | AihSecurityWaf (us-east-1), -c webAclArn=... のときだけ
node cf: CloudFront | distribution
node url: Lambda function URL | AuthType AWS_IAM, 署名なしは 403
node fn: Lambda function | HandlerRole
node secret: Secrets Manager のシークレット
node key: KMS key | aws/secretsmanager, -c cmk=on なら customer managed key
node trail: CloudTrail event history | CreateRole, PutSecretValue, ... を 90 日
edge viewer -> cf
edge waf -> cf
edge cf -> url: OAC が SigV4 で署名
edge url -> fn
edge fn -> secret: GetSecretValue, 実行環境ごとに約 5 分に 1 回
edge secret -> key: 暗号化に使う鍵
edge secret --> trail: 管理操作を記録
```

この図に並んでいるものが、そのままこの章の話題です。入口の WAF、関数のロール、シークレットとそれを暗号化する鍵、それらへの操作を記録する CloudTrail を順に扱います。

スタックは 2 つあります。

<<< @/examples/21-security/infra/bin/app.ts{stacks}

`AihSecurity` が既定のスタックで、`AihSecurityWaf` は名前を指定してデプロイしたときにだけ作られます。月額がかかるものを足すかどうかは、CDK のコンテキストで切り替えます。

<<< @/examples/21-security/infra/lib/config.ts{context}

[14章](/ja/chapters/14-kv-cache.md)の `-c store=valkey` と同じ考え方で、何も付けなければ安いほうになります。`-c cmk=true` のような書き間違いは、off として扱わずに synth で止めます。料金のかかるスイッチが、黙って別の意味になっては困るからです。

`reservedConcurrency` だけは、料金のかからないスイッチです。それでも既定で off にしているのは、新しいアカウントでは同時実行数の上限が低く、予約しただけでデプロイが断られることがあるからです。いつ付けるかは[デプロイのページ](/ja/chapters/21-security/deploy.md)で説明します。

## 権限を絞る

<!-- section: 21.least-privilege -->

01章で `AdministratorAccess` を使ったとき、絞る方法は 21章で扱うと書きました。絞り方は、誰の権限を絞るかによって違います。

**動いているコードの権限**は、いますぐ絞れますし、最初に絞るべきなのもここです。関数のロールは、インターネットから届くリクエストを処理するコードが使うものだからです。この章の関数が持つ権限は、次のコードに書いてあるものがすべてです。

<<< @/examples/21-security/infra/lib/security-stack.ts{role}

関数にできるのは、自分のロググループに書くことと、1 つのシークレットを読むことだけです。`secretsmanager:*` も、アカウントのすべてのシークレットを読む権限も与えていません。この関数のコードに穴があっても、攻撃者が手にするのはこの 3 つのアクションです。最小権限（least privilege）は、具体的にはこういう形になります。

[20章](/ja/chapters/20-shipping.md)と同じく、権限はロールの中にインラインで書いています。`AWSLambdaBasicExecutionRole` のような AWS 管理のポリシーは付けていません。04章で見たとおり、`AWSLambdaBasicExecutionRole` はアカウントのどのロググループにでも書ける権限だからです。

**人の権限**を絞るのは、もう少し難しくなります。この本のサンプルは、デプロイのたびに IAM のロールを作ります。ロールを作れる人は、そのロールにどんな権限でも持たせられるので、実質的に管理者です。学習用のアカウントで、デプロイする人の権限だけを細かく絞っても、得るものは多くありません。

現実的には、次の順番で進めます。

1. 長期のアクセスキーを持たない。01章で済ませました
2. ふだんの調べものには読み取り専用の権限でサインインし、デプロイのときだけ強い権限に切り替える
3. デプロイを人の手から CI のロールに移す。20章で済ませました。CI のロールは、決まったリポジトリの決まったジョブからしか使えません
4. それでも人に強い権限が残るなら、使った実績をもとに絞る

4 には専用の機能があります。IAM Access Analyzer の policy generation は、CloudTrail の記録を最大 90 日ぶん読み、そのロールやユーザーが実際に使ったアクションだけを並べたポリシーのひな形を作ります。ただし、読む元として CloudTrail の証跡（trail）が必要です。証跡を作る理由の 1 つがこれで、証跡そのものは[実装のつづき](/ja/chapters/21-security/more.md)で説明します。この機能は、この本では試していません。

強い権限を持つ人にも効く歯止めが、もう 1 つあります。Organizations の SCP で、これも[実装のつづき](/ja/chapters/21-security/more.md)で扱います。
