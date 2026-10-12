---
title: "21 Security: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations"
revision: 2
---

# 21 Security: WAF、Inspector、GuardDuty、secret、KMS、CloudTrail、Config、Organizations

ここまで、いくつも「それは 21章で」と先送りにしてきました。01章の `AdministratorAccess` を絞る話。03章の WAF。04章の「秘密は環境変数に置かない」。この章で、まとめて引き受けます。

ただ、AWS の「セキュリティ」と名の付くサービスを全部入れよう、という章ではありません。逆です。1 人で使っているアカウントに要るものと、人やアカウントが増えてから要るものを分けて、前者だけを手を動かして入れます。後者は、何のためのものかと、いくらかかるかを押さえます。

先にお金の話を。この章の stack は、何も指定しなければ、月額がかかるのは secret 1 つだけです（月 USD 0.40、時間割り）。**KMS の鍵と web ACL は、置いてあるだけで毎月かかるので、明示的に頼んだときにしか作りません**。GuardDuty、Inspector、AWS Config は、この章の stack には入れていません。理由はあとで話します。

正直に言うと、この章の AWS 側の手順は、まだ一度も実際には動かしていません。手元で確かめたのは、テスト、型検査、synth、手元の server までです。内訳は章末にあります。

前提は [06章](/ja/chapters/06-auth.md)と [20章](/ja/chapters/20-shipping.md)です。CloudFront と function URL の組み合わせは [09章](/ja/chapters/09-ssr.md)で出てきました。コードは `examples/21-security/` にあります。

## 何から入れるか

<!-- section: 21.tiers -->

AWS のコンソールで「Security」を開くと、サービスがずらっと並びます。全部を有効にすると、毎月の請求が増えて、読まない通知が増えます。何もしないと、鍵が漏れても気づけません。

この本は、3 段に分けて考えます。

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

1 段目は、アカウントを持った日からやることです。お金はほぼかかりません。2 段目は、漏れたら困るデータや、止まったら困るサービスを持ってから。3 段目は、関わる人やアカウントが 2 つ以上になってから。

この分け方は AWS の公式な分類ではなく、この本の判断です。あなたの事情で前後して構いません。大事なのは、「いま入れていないもの」を、忘れているのではなく選んで入れていない、と言えることです。

いまのアカウントがどの状態かは、タスクで見られます。

```bash
vp run sec:posture
```

読み取りだけで、何も変えません。6 つのサービスに聞いて、結果を 3 段に並べます。

<<< @/examples/21-security/src/posture.ts{assess}

[02章](/ja/chapters/02-toolchain.md)の drift で、「差が見つからなかった」と「全部比べて一致した」を分けましたよね。ここでも同じことをしています。権限が足りなくて読めなかった項目は、`off` ではなく `unknown` です。

<<< @/examples/21-security/src/posture.ts{snapshot}

タスクが失敗するのは、1 段目が `on` でないときだけです。

<<< @/examples/21-security/src/posture.ts{gate}

GuardDuty が無効でも、タスクは落ちません。それは選択だからです。root ユーザーに MFA が無いのは、選択ではありません。

## 全体像

<!-- section: 21.architecture -->

題材は、小さな token API です。`/token` が署名つきの token を発行し、`/verify` がそれを検証します。署名に使う鍵が、この章の「secret」です。

```figure
caption: viewer から secret までの経路に、WAF、関数の role、secret を暗号化する鍵が並び、CloudTrail がそれらへの管理操作を記録する
node viewer: Viewer | HTTPS, GET と HEAD だけ
node waf: Web ACL | AihSecurityWaf (us-east-1), -c webAclArn=... のときだけ
node cf: CloudFront | distribution
node url: Lambda function URL | AuthType AWS_IAM, 署名なしは 403
node fn: Lambda function | HandlerRole
node secret: Secrets Manager secret
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

上から順に、この章の話題が並んでいます。入口に WAF。関数の role。secret と、それを暗号化する鍵。そして、それらへの操作を記録する CloudTrail。

stack は 2 つです。

<<< @/examples/21-security/infra/bin/app.ts{stacks}

`AihSecurity` が既定の stack。`AihSecurityWaf` は、名前を指定してデプロイしたときにだけ作られます。月額がかかるものを足すスイッチは、CDK の context です。

<<< @/examples/21-security/infra/lib/config.ts{context}

[14章](/ja/chapters/14-kv-cache.md)の `-c store=valkey` と同じ考え方ですね。何も付けなければ安いほう。`-c cmk=true` のような書き間違いは、「off として扱う」のではなく synth で止めます。お金のかかるスイッチが、黙って別の意味になるのは困るので。

`reservedConcurrency` だけは、お金のかからないスイッチです。それでも既定で off にしているのは、新しいアカウントだと同時実行数の上限が低くて、予約しただけでデプロイが断られることがあるからです。いつ付けるかは、デプロイの節で話します。

## 権限を絞る

<!-- section: 21.least-privilege -->

01章で `AdministratorAccess` を使ったとき、「絞る方法は 21章で」と書きました。答えは、絞る相手によって違います。

**動いているコードの権限**は、いますぐ絞れます。絞るべきなのも、まずここです。関数の role は、インターネットからのリクエストを処理するコードが使うものだからです。この章の関数が持つ権限は、これで全部です。

<<< @/examples/21-security/infra/lib/security-stack.ts{role}

自分の log group に書く。1 つの secret を読む。それだけ。`secretsmanager:*` でも、アカウントの全 secret でもありません。この関数のコードに穴があっても、攻撃者が手にするのは、この 3 つの action です。これが最小権限（least privilege）の実際の形です。

[20章](/ja/chapters/20-shipping.md)と同じく、権限は role の中に inline で書いています。AWS 管理の policy（`AWSLambdaBasicExecutionRole` など）は付けていません。04章で見たとおり、あれは「アカウントのどの log group にでも書ける」権限です。

**人の権限**は、もう少し難しい話です。この本のサンプルは、デプロイのたびに IAM の role を作ります。role を作れる人は、その role に何でも持たせられるので、実質的に管理者です。学習用のアカウントで、デプロイする人の権限だけを細かく絞っても、得るものは多くありません。

現実的な順番は、こうです。

1. 長期のアクセスキーを持たない。01章でやりました
2. ふだんの調べものには、読み取り専用の権限でサインインする。デプロイのときだけ、強い権限に切り替える
3. デプロイは人の手から CI の role に移す。20章でやりました。あの role は、決まった repository の決まった job からしか使えません
4. それでも人に強い権限が残るなら、使った実績から絞る

4 には道具があります。IAM Access Analyzer の policy generation は、CloudTrail の記録を最大 90 日ぶん読んで、その role や user が実際に使った action だけを並べた policy のひな形を作ってくれます。ただし、読む元として CloudTrail の trail が要ります。あとで出てくる「trail を作る理由」の 1 つです。この機能は、この本では試していません。

もう 1 つ、強い権限を持つ人にも効く歯止めがあります。Organizations の SCP です。章の後半で扱います。
