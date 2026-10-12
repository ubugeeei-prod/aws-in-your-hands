---
title: "23 VM: しくみと実装"
---

# 23 VM: しくみと実装

## SSH の port は開けない

<!-- section: 23.access -->

サーバーに入るといえば SSH でした。22 番の port を開けて、鍵を配って、踏み台を置く。この章はそれを全部やりません。開いている port は攻撃の入口ですし、鍵は誰かの laptop に残り続けるからです。

かわりに Systems Manager の Session Manager を使います。仕組みはこうです。instance の中で SSM Agent というプロセスが動いていて、Systems Manager に向かって HTTPS の接続を張ります。あなたが `aws ssm start-session` を呼ぶと、Systems Manager がその接続を通して shell をつないでくれます。接続を始めるのは、いつも instance の側。だから inbound の規則が 1 つも要りません。誰が入れるかは、鍵ではなく IAM で決まります。

要るものは 3 つです。

1. **SSM Agent。** AWS が配っている Amazon Linux 2023 の AMI には、最初から入っています
2. **権限。** instance の role に `AmazonSSMManagedInstanceCore` という managed policy を付けます（次の節）
3. **Systems Manager までの経路。** ここが、お金のかかるところです

経路の作り方は 3 通りあります。金額は、通信がなくてもかかる 1 か月ぶんです。

| instance の置き場所 | Systems Manager への道 | 道の料金 |
| --- | --- | --- |
| private subnet | interface endpoint を 3 つ（`ssm`、`ssmmessages`、`ec2messages`） | 61.32 |
| private subnet | NAT Gateway | 48.91（11章の `-c egress=nat`） |
| public subnet | internet gateway と、instance の public IPv4 アドレス | 3.65 |

どれを選んでも、inbound は空のままです。public subnet に置いても、外から instance に接続を始めることはできません。

### 既定は private subnet にしました

正直に言って、迷いました。試すだけなら public subnet のほうが 5 分の 1 以下で済みます。

それでも既定を private にした理由は 2 つです。1 つは、public IPv4 アドレスを持った machine は、security group の規則 1 行の差で外から届くようになること。いまは inbound が空でも、長生きする machine の設定は、誰かがいつか触ります。もう 1 つは、外向きの通信です。public subnet の instance は、443 番ならインターネットのどこへでも出られます。private subnet なら、届くのは Systems Manager と S3 だけです。中のソフトウェアが乗っ取られたときに、できることが違います。

長く置く machine、そして 24章のように複数台で動かすものは、private subnet に置くのが普通です。なので既定はそちらに合わせました。ただ、この章を一度通すだけなら `-c placement=public` で十分です。そのときも inbound は空で、テストがそれを固定しています。

### 11章の VPC につなぐ

interface endpoint は、11章の stack の切り替えで足します。

```bash
vp run net:infra:deploy -c interfaceEndpoints=ssm,ssmmessages,ec2messages
```

11章で見たとおり、`-c` はその 1 回のコマンドにしか効きません。あとで `-c` なしで 11章を deploy し直すと、endpoint は消えて、この章の instance は Systems Manager から見えなくなります。

endpoint が 3 つとも要るのかは、実は言い切れません。Systems Manager のドキュメントは 3 つを並べていますが、同じページに、SSM Agent 3.3.40.0 以降は `ec2messages` のかわりに `ssmmessages` を使う、とも書いてあります。`ec2messages` を省ければ月に USD 20.44 減ります。ただ、endpoint を省いてよいとは書かれておらず、実機でも試していないので、この章は 3 つとも置いています。

instance の側のコードはこれだけです。

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{network}

`securityGroupIngress` がありません。書き忘れではなく、これが設定です。テストは、inbound の規則が 1 つも無いこと、SSH の key pair を指定していないことを見ています。

outbound は 443 番だけにしました。security group を作ると、最初は「すべての宛先へ、すべての通信を許可」という outbound の規則が付いてきます。規則を 1 つ書くと、それに置き換わります。DNS、時刻合わせ、次の節の instance metadata は、security group が見ない通信なので、規則を書かなくても通ります。

### 経路がないと、何が起きる？

ここが、この章でいちばんハマりやすいところです。endpoint を足し忘れても、deploy は成功します。instance は起動して、status は running になります。でも、Systems Manager には永遠に現れません。エラーはどこにも出ません。

なので、経路があるかどうかを、deploy の前に手元で確かめられるようにしました。11章の経路のモデルを、そのまま使っています。

<<< @/examples/23-ec2/src/access.ts{access}

`vp run ec2:plan` に、11章を deploy するときの設定を渡してみてください。

```bash
vp run ec2:plan interfaceEndpoints=ssm
```

`ssmmessages` と `ec2messages` が `UNREACHABLE` と出て、タスクは失敗で終わります。S3 への道は、11章が既定で作る gateway endpoint です。こちらは無料で、OS の package、SSM Agent の更新、この章の release の取得に使います。

1 つ正直に書いておくと、Amazon Linux 2023 の package の repository に、private subnet から S3 の gateway endpoint だけで届くことは、確かめていません。repository が S3 の bucket であることは、ドキュメントの出力例にある host 名から読み取っただけです。届かなければ、最初の起動で Node.js が入らず、user data が失敗します。そのときの調べ方は「ハマりどころ」に書きました。

## instance の権限は、中から取りに行く

<!-- section: 23.role -->

Lambda に実行 role があったように、instance にも role を持たせます。

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{role}

EC2 は role をそのまま受け取れません。instance profile という入れ物に role を 1 つ入れて、それを instance に付けます。CDK の高水準の construct はこれを黙ってやってくれますが、何が作られているのかを見たかったので、自分で書きました。

`AmazonSSMManagedInstanceCore` は AWS が管理している policy です。中を読むと、対象はすべて `"Resource": "*"` で、`ssm:GetParameter` も入っています。つまり、この instance の中のプロセスは、アカウントの Parameter Store の値を読もうとすれば読めます。04章からずっと「`*` を使わない」で来ましたが、ここは AWS の policy をそのまま使うぶん、例外です。自分で足した権限は 1 つだけ。release を置く bucket の、`releases/` の下を読むことです。

### 認証情報はどこから来る？

instance の中の AWS CLI や SDK は、アクセスキーを設定しなくても動きます。どこから認証情報を取っているのでしょう。

答えは IMDS（Instance Metadata Service）です。instance の中からだけ届く `169.254.169.254` というアドレスがあって、そこに問い合わせると、role の一時認証情報が返ってきます。期限つきで、自動で入れ替わります。disk に鍵を置かなくて済むのは、このおかげです。

便利ですが、弱点もあります。instance の中で動くものなら、誰でもこのアドレスに聞けるんです。たとえば、ユーザーが指定した URL を取りに行く機能がアプリにあったら。URL に `http://169.254.169.254/...` を渡されると、アプリが認証情報を取ってきて、応答として返してしまうかもしれません。

IMDS には版が 2 つあります。v1 は、ただの GET で答えます。いまの攻撃がそのまま通ります。v2 は、先に PUT で token をもらって、それをヘッダーに付けて問い合わせる方式です。「URL を 1 つ GET させる」だけの穴では、PUT もヘッダーの追加もできません。さらに、`X-Forwarded-For` ヘッダーの付いた PUT は拒否されます。proxy 越しのリクエストを弾くためです。

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{instance}

`httpTokens: "required"` で v2 だけにしています。`httpPutResponseHopLimit` は、token の返事がネットワークを何段まで渡れるかです。1 なら instance 自身にしか届きません。中でコンテナを動かして、コンテナにも role を使わせたいときは 2 にします。Amazon Linux 2023 の AMI は、何も指定しなくても v2 必須、hop limit 2 で起動するそうですが、AMI やアカウントの既定値に頼らず、書いて固定しました。

v2 にしても変わらないことが 1 つあります。role は instance に 1 つで、中のプロセス全員の共有物です。`notes` という権限の低い user で動かしているノート API も、token を取る手順を踏めば、同じ認証情報を手にできます。instance の role に付けた権限は、その machine で動く全部のコードに付けた権限だと思ってください。

## AMI を選ぶ

<!-- section: 23.ami -->

AMI（Amazon Machine Image）は、instance の最初の disk の中身になる雛形です。この章は Amazon Linux 2023 の arm64 版を使います。

AMI には `ami-0123...` という ID があって、リージョンごとに違い、新しい版が出るたびに変わります。ID をコードに書くと、すぐ古くなります。そこで AWS は、「いちばん新しい AMI の ID」を Parameter Store の公開の parameter として配っています。

<<< @/examples/23-ec2/infra/lib/ec2-stack.ts{ami}

これを synth すると、template に `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>` という型の parameter が 1 つできます。値を引くのは deploy のときで、synth は AWS に何も聞きません。テストは、parameter の名前が `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` であることと、synth が問い合わせを残さないことを見ています。

ここは 2 回つまずきました。固定した版（aws-cdk-lib 2.273.0）での話です。

まず、よく紹介される `MachineImage.latestAmazonLinux2023()` は、`kernel` を渡しても無視して、カーネル 6.1 用の parameter を引きます。Amazon Linux のドキュメントによると、`kernel-default` のほうは 2026 年 8 月から 6.18 になっています。次に、かわりに `AmazonLinux2023ImageSsmParameter` を直接使うと、今度は既定で synth のときに AMI を調べに行こうとして、アカウントを指定していない stack では synth が落ちます。`cachedInContext: false` が要ります。

### 「最新」は、作り直しの引き金

便利な仕組みですが、長生きする machine とは相性が悪いんです。

AMI の ID が変わると、instance は**置き換え**になります。CloudFormation のドキュメントでは `ImageId` の変更は Replacement で、cdkd のソースでも同じ扱いです。新しい AMI は頻繁に出ます。つまり、先月と同じコードを deploy しただけで、machine が新品に入れ替わることがあります。root volume の中身は、古い instance と一緒に消えます。CDK の型定義のコメントにも、この image を使うなら instance に状態を置くな、と書いてあります。

だから、この章は 2 つのことをしています。1 つは、消えて困るデータを root volume に置かないこと（「データは別の volume に」）。もう 1 つは、AMI を固定できるようにしたことです。

```bash
aws ssm get-parameter --region ap-northeast-1 --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text
vp run ec2:infra:deploy -c amiId=ami-xxxxxxxxxxxxxxxxx
```

1 行目で、いまの ID がわかります（認証情報が要ります）。それを `-c amiId=` で渡すと、template には ID がそのまま入って、あなたが変えるまで変わりません。練習なら「最新」のままで構いません。置きっぱなしにする machine なら、固定して、patch は自分の予定で当てます（「patch を当てる」）。

どちらにしても、deploy の前に `vp run ec2:infra:diff` を見る癖をつけてください。正直に言うと、cdkd の diff が、parameter の先の AMI の変化を置き換えとして見せてくれるのかは、確かめていません。

## 最初の起動でやること

<!-- section: 23.user-data -->

起動したばかりの instance には、Node.js も、ノート API も、それを動かす user もありません。それを用意するのが user data です。instance の起動時に shell script を渡しておくと、最初の起動のときに root で実行されます。

渡す script は、TypeScript の関数が組み立てます。

<<< @/examples/23-ec2/src/user-data.ts{user-data}

やっていることは 5 つ。Node.js を入れる。権限の低い user を作る。設定ファイル、systemd の unit、2 つの script を置く。service を有効にする。data volume を用意する。組み立てた結果は `examples/23-ec2/deploy/user-data.sh` に置いてあるので、TypeScript を読まなくても、何が走るのかをそのまま読めます。

この関数は純粋です。入力は設定だけで、時刻も、deploy 時に決まる値も入りません。同じ設定からは、いつでも同じ script が出ます。だから、テストで読んだものと、instance で走るものが一致します。

### root の shell に入る値は、全部疑う

user data は root で走ります。そこに設定値を文字列として埋め込むので、値に `; rm -rf /` や `$(...)` が紛れ込んだら、それがそのまま実行されます。

<<< @/examples/23-ec2/src/machine.ts{spec}

埋め込む値は、すべてこの schema を通します。path は英数字と `.` `_` `-` だけ、名前は小文字で始まる短い文字列だけ。引用符も、空白も、改行も入りません。テストは、どの項目に危ない値を入れても、script の生成そのものが例外で止まることを確かめています。

秘密も入れません。user data は、instance の中のどのプロセスからも IMDS 経由で読めますし、`aws ec2 describe-instance-attribute` を呼べる人なら外からも読めます。この章のサンプルには秘密がありませんが、あったとしても、ここは置き場所ではありません。テストは、設定ファイルに入る項目が 6 つ（許可する origin、ログの level、stage、host、port、ノートのファイルの path）だけであることも見ています。

### user data の限界

便利ですが、頼りすぎると痛い目を見ます。

**走るのは 1 回だけ。** 最初の起動のときだけです。あとで script を直して deploy しても、動いている instance では走り直しません。cdkd のソースを読むかぎり、`UserData` の変更は instance に届きもしません。CloudFormation なら instance を再起動しますが、それでも script は走りません。machine の作りを変えたければ、instance を作り直すか、中に入って手で変えるかです。

**失敗に気づきにくい。** script が 5 行目で落ちても、instance は running のままです。EC2 から見れば、OS は立ち上がっているからです。この script は `set -euo pipefail` で、最初に失敗したところで止まるようにしてあります。半分だけ設定された machine より、止まった machine のほうが見つけやすいので。結果は `vp run ec2:status` で見られます。出力は instance の `/var/log/cloud-init-output.log` に残ります。

**16 KB まで。** いまの script は 4 KB ほどです。アプリのコードを詰め込む場所ではありません。

最後の点が、設計を決めています。user data が用意するのは machine までで、アプリは入れません。アプリは何度も入れ替えるものだからです。入れ替えの道は「デプロイして、入る」で作ります。
