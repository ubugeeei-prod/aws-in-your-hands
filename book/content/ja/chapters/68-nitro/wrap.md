---
title: "68 Nitro: 費用、注意点、片付け"
---

# 68 Nitro: 費用、注意点、片付け

章の最後のページです。エンクレーブが解決しないこと、サーバーを持たない基盤との違い、つまずきやすい点、本番にするなら変えること、片付けの順に進みます。料金は[最初のページ](/ja/chapters/68-nitro.md)にあります。

## エンクレーブが解決しないこと

<!-- section: 68.limits -->

エンクレーブが約束するのは、切り出したメモリと vCPU に親が触れないこと、そして、どのイメージから起動したかを外に証明できることです。その外にあるものは、守られません。

**エンクレーブの中のコードの誤り。** アテステーションが証明するのは、どのコードが動いているかです。そのコードが正しいかどうかは、証明しません。テストには、データキーを応答に入れて返してしまうイメージがあります。そのイメージの計測値をポリシーに書けば、KMS は鍵を渡し、鍵は親に届きます。仕組みはどこも壊れていません。ポリシーに計測値を書く人が、そのイメージの中身を読んだかどうかが、最後の砦になります。エンクレーブに入れるコードを小さく保つ理由は、ここにあります。

**キーポリシーを書き換えられる人。** `kms:PutKeyPolicy` を持つ人は、条件を外せます。ユーザーガイドは、親インスタンスの管理者に、鍵を使う権限もキーポリシーを変える権限も持たせないよう書いています。エンクレーブは、インスタンスの管理者からデータを隠します。鍵の管理者からは隠しません。2 つの役を別の人に分け、キーポリシーの変更を CloudTrail で見張る（21章）ところまでが、この仕組みの一部です。

**条件の無い許可。** キーポリシーに条件の無い `kms:Decrypt` が 1 つでもあれば、あるいはアカウントに `kms:*` を与えたうえで IAM ポリシーが `Decrypt` を許していれば、エンクレーブを通らない道ができます。テストは、条件を書き忘れたポリシーで親が鍵を手にすることを示しています。スタックのテストは、合成したテンプレートに `kms:*` が無いこと、ロールに IAM ポリシーが無いことを固定しています。

**親を通るデータ。** [ノートを封印する](/ja/chapters/68-nitro/more.md)の節に書いたとおり、ノートの本文は親を通ります。親はエンクレーブへのリクエストを自由に作れるので、動いているエンクレーブに開封を頼めます。エンクレーブがそれを断るには、頼んでいるのが誰なのかを、エンクレーブ自身が確かめる必要があります。

**止められること。** 親は、エンクレーブを終了でき、メッセージを届けないこともできます。エンクレーブが守るのは機密性で、可用性ではありません。エンクレーブには永続的なストレージが無いので、状態は起動のたびに空から始まります。

**サイドチャネル。** ホワイトペーパーは、エンクレーブがほかのインスタンスと同じ隔離とサイドチャネルへの対策を受け継ぎ、親とのあいだでコアもメモリも共有しない、と書いています。ここから言えるのは、コアの共有を前提にした種類の攻撃は、設計の上では親とエンクレーブのあいだに成り立たない、ということです。対策そのものは、外から確かめられません。一方、エンクレーブの応答にかかる時間は、親から丸見えです。ホワイトペーパーが例に挙げている、比較にかかる時間から秘密が漏れる種類の問題は、エンクレーブに入れるコードの側で防ぐものです。

## サーバーを持たない基盤では

<!-- section: 68.platforms -->

この章の話は、どれも、サーバーを自分で選ぶから出てくるものです。Cloudflare Workers のコードは、Cloudflare のネットワークの機械の上にある V8 の isolate で動き、関数ごとに仮想マシンが作られるわけではない、とドキュメントにあります（2026-10-13 時点）。インスタンスタイプも、プロセッサーのアーキテクチャも、ボリュームのデバイス名も、開発者が決める項目としては出てきません。Workers に、エンクレーブに当たる仕組みがあるかどうかは、確かめていません。Vercel についても、確かめていません。

Lambda と Fargate は、その中間にあります。アーキテクチャは選びますが、インスタンスタイプは選びません。その下で何が動いているかは [67章](/ja/chapters/67-firecracker.md)にあります。

名前を読む必要も、デバイスを探す必要もない基盤で足りるなら、そのほうが覚えることは少なくて済みます。この章の知識が要るのは、23章のようにサーバーを持つと決めた後です。

## つまずきやすいところ

**T タイプを親にしようとする。** `t4g` も `t3` も、Nitro Enclaves の対象外です。この章の設定は、2 つのタイプしか受け付けません。

**デバッグモードのまま鍵を待つ。** `--debug-mode` で起動したエンクレーブの PCR は 0 です。鍵はもらえません。ユーザーガイドのチュートリアルは、デバッグモードのときは 0 だけの値をポリシーに書くよう案内しています。それは「デバッグモードの、どのイメージにでも鍵を渡す」という意味になるので、この章の設定は 0 だけの値を受け付けません。

**イメージを作り直した。** 依存を 1 つ上げただけでも、PCR0 は変わります。古い値のままのポリシーは、新しいエンクレーブを断ります。

**`-c measurement=` を忘れてデプロイし直した。** ポリシーから 2 つ目のステートメントが消えます。エラーは出ず、エンクレーブが鍵をもらえなくなります。

**allocator の設定。** 2 vCPU の Graviton では、取り分けるのは 1 vCPU です。既定の 2 のままでは、ユーザーガイドの記述に合いません。そのとき何が起きるかは、確かめていません。

**親を止めた。** エンクレーブは、親が止まると終わります。親を起動し直した後、エンクレーブが自分で戻るかどうかは、確かめていません。

**`/dev/nvme1n1` と書いた。** 次の起動で、その名前は別のボリュームを指しているかもしれません。

**x86 でビルドしたイメージを持ち込んだ。** エンクレーブは親と同じプロセッサーの上で動く仮想マシンなので、イメージも親と同じアーキテクチャで作ることになるはずです。ユーザーガイドの vsock のチュートリアルも、OS のアーキテクチャを調べて、それに合わせてビルドさせています。別のアーキテクチャのイメージを渡すと何が起きるかは、確かめていません。

## 本番にするなら

- **プライベートサブネットに置く。** KMS、Systems Manager のインターフェースエンドポイントを用意し、ベースのイメージは ECR から取ります（11章、[52章](/ja/chapters/52-ecr.md)）
- **イメージに署名し、PCR8 と PCR3 を条件に使う。** PCR0 だけの条件は、ビルドのたびに書き換えが要ります。ユーザーガイドは、署名の証明書（PCR8）と親のロール（PCR3）を組み合わせることを勧めています。入れ替えの最中に古いエンクレーブと新しいエンクレーブの両方へ鍵を渡す必要があるかどうかも、先に決めておきます
- **鍵の管理者とインスタンスの管理者を分ける。** キーポリシーを変えられる人が、インスタンスに入れる人と同じなら、エンクレーブを置く意味は薄れます
- **計測値を承認する手順を持つ。** 誰がイメージのソースを読み、誰が PCR0 をポリシーに入れるのか。イメージを CI で作り、同じソースから同じ PCR0 が出ることを確かめられるようにします
- **利用者の確認をエンクレーブの中で行う。** トークンの検証と、利用者とのあいだの暗号化を中に入れて初めて、親に入り込んだ人から本文を隠せます
- **鍵を消さない設定にする。** 練習用のスタックは、鍵を 7 日の待機で削除します。本番では `RemovalPolicy.RETAIN` にし、ローテーションを有効にします（21章）
- **アテステーション付きのリクエストを見張る。** KMS は、文書の情報を CloudTrail の `additionalEventData` に残します。拒否された `Decrypt` の記録は、文書なしで誰かが試したしるしかもしれません

## 片付け

<!-- section: 68.cleanup -->

この手順も、実行していません。エンクレーブを終了してから、スタックを消します。1 行目はインスタンスの中で、2 行目は手元で実行します。

```bash
nitro-cli terminate-enclave --all
vp run nitro:infra:destroy
```

1 行目は省いても構いません。親が終了すれば、エンクレーブも終わります。2 行目で、インスタンス、セキュリティグループ、ロールが消え、鍵は削除待ちになるはずです。

鍵は、すぐには消えません。7 日のあいだ削除待ちの状態で残り、その間は使えません。7 日たつと消え、その鍵で包んだデータキーは二度と開けなくなります。この章の手順で封印したものを残したいなら、消す前に、エンクレーブで開いておく必要があります。削除待ちのあいだに鍵の料金がかかるかどうかは、21章と同じく、確かめられていません。

消えたことは、自分で確かめてください。

```bash
aws ec2 describe-instances --region ap-northeast-1 --filters Name=instance-state-name,Values=pending,running,stopping,stopped
aws kms describe-key --region ap-northeast-1 --key-id <KeyId>
```

1 行目に、この章のインスタンスが残っていないこと、2 行目の `KeyState` が `PendingDeletion` であることを見ます。

残るものは、削除待ちの鍵のほかに、cdkd の bootstrap で作った保存場所（02章）と、11章のネットワークです。11章は、11章の手順で片付けます。

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト（インスタンスタイプの名前の読み取り、ボリューム ID からのデバイスの特定、PCR3 と PCR4 の計算がユーザーガイドの例の値と一致すること、キーポリシーとその評価器、親とエンクレーブと KMS のモデルと不変条件、料金の入力、スタックのアサーション）。型検査。`nitro:infra:synth`（既定、`-c measurement=<96 桁>`、`-c instanceType=m6g.large`）。`nitro:demo`、`nitro:names`、`nitro:prices`。`aws ec2 describe-instances`、`aws kms decrypt`、`aws kms describe-key`、`aws ssm start-session`、`aws ec2 modify-instance-metadata-options` の引数は、devShell の AWS CLI 2.35.11 の help で読みました。`KeyState` の値は、`@aws-sdk/client-kms` 3.1149.0 の型定義で見ました。本文の金額は、Price List の単価から `tools/src/pricing/calc.ts` が計算した値で、`examples/68-nitro/test/pricing.test.ts` が本文の数字と突き合わせています。

**まだ確かめていないこと。** AWS に対しては、何も実行していません。`nitro:infra:diff`、`nitro:infra:deploy`、`nitro:infra:drift`、`nitro:infra:destroy` のどれもです。エンクレーブのイメージを作っておらず、エンクレーブを一度も起動していません。この本を書いている機械は macOS で、Docker も Linux もないからです。したがって、次はすべて実物での確認待ちです。cdkd 0.296.28 がこのスタックを作って消せること、とくに `EnclaveOptions` が Cloud Control API 経由で渡ってエンクレーブが有効になること。この章のキーポリシーを KMS が受け付けること、明示した管理用のアクションだけで cdkd が鍵を作って消せること。2 vCPU の Graviton で allocator を 1 vCPU にして hello のサンプルが動くこと、`--cpu-count 1` で起動できること。既定のルートボリュームに Docker のイメージとイメージファイルが収まること。エンクレーブの中からの `Decrypt` と `GenerateDataKey` が通り、親からの同じ呼び出しが拒否されること。hop limit 1 のまま、ユーザーガイドの親側のコンテナが認証情報を取れるかどうか。`kmstool_enclave_cli genkey` の出力をそのまま `decrypt` に渡せること。`lsblk --json` の実際の出力が、テストの入力と同じ形であること。再開の手順は、参照ページの検証の記録にあります。

この章に無いもの。ノートを封印する TypeScript のコード（`src/enclave/vault.ts`）を、エンクレーブのイメージにする部分はありません。vsock の待ち受け、ハイパーバイザーからの文書の取得、文書を付けた KMS の呼び出しが要ります。モデルの上でしか動かしていません。

一次情報で確かめられなかったこと。Nitro Card とハイパーバイザーの中身は公開されておらず、ホワイトペーパーと製品ページの記述しか読んでいません。NCC Group の報告書そのものは読んでおらず、AWS のブログが引いている範囲しか書いていません。「ホストの資源のほとんどがインスタンスに渡る」ことを示す数字は、資料にありません。命名規則のページは、オプションの文字の順序も、プロセッサーの文字が無い名前の意味も書いていません。Fargate の arm64 がどの世代の Graviton かは、ECS のドキュメントに書いてありません。arm64 と x86 で同じ仕事にかかる時間は、測っていません。KMS が実際に返すエラーの名前、`CiphertextForRecipient` の中の形式は、モデルに入れていません。KMS の料金ページは今日は読み直しておらず、21章が 2026-10-12 に確かめた記述（鍵は 1 か月 USD 1 で時間按分、月 2 万リクエストまで無料）に頼っています。Amazon Linux 2023 の AMI のルートボリュームの大きさ、入っている util-linux の版、Session Manager で入ったときのユーザー名は確かめていません。Node.js で vsock を開く方法は、`net` モジュールのドキュメントに記述が無いことを見ただけで、ほかの方法は調べていません。Cloudflare については 1 ページを読んだだけで、Vercel については何も確かめていません。

cdkd が扱うリソースの種類。インストールした cdkd 0.296.28 の中身を読むと、`AWS::EC2::Instance`、`AWS::EC2::SecurityGroup`、`AWS::IAM::InstanceProfile`、`AWS::IAM::Role`、`AWS::KMS::Key` には専用の実装が登録されています。ただし、EC2 のインスタンス用の実装は `EnclaveOptions` を「not yet implemented by cdkd」としていて、テンプレートにこのプロパティがあるインスタンスは Cloud Control API 経由に回されます。`--prefer-sdk-route` でこの回り道を止めると、プロパティは黙って落とされる、ともコードにあります。スタックのテストが、使う種類の一覧を固定しています。

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| 置いてあるだけでかかる料金 | `examples/68-nitro/src/cost.ts`、`scripts/prices.ts`、`test/pricing.test.ts`、`data/pricing/` | `nitro:prices`、`test:unit` |
| この章で作るもの | `examples/68-nitro/src/config.ts` | `test:unit` |
| デバイス名は起動のたびに変わりうる | `examples/68-nitro/src/volume.ts`、`test/volume.test.ts`、`test/fixtures/lsblk.ts`、`examples/23-ec2/deploy/notes-data-volume.sh` | `test:unit` |
| インスタンスタイプの名前を読む | `examples/68-nitro/src/instance-type.ts`、`scripts/names.ts`、`test/instance-type.test.ts` | `nitro:names`、`test:unit` |
| Graviton | `examples/68-nitro/src/arch.ts`、`scripts/prices.ts`、`test/pricing.test.ts`、`data/pricing/` | `nitro:prices`、`test:unit` |
| エンクレーブと、その計測値 | `examples/68-nitro/src/measurement.ts`、`test/measurement.test.ts` | `test:unit` |
| KMS が鍵を渡す相手を決める | `examples/68-nitro/src/policy.ts`、`test/policy.test.ts` | `test:unit` |
| ノートを封印する | `examples/68-nitro/src/enclave/vault.ts`、`src/enclave/protocol.ts`、`test/enclave.test.ts` | `test:unit` |
| スタック | `examples/68-nitro/infra/lib/nitro-stack.ts`、`infra/bin/app.ts`、`infra/test/nitro-stack.test.ts` | `nitro:infra:synth`、`test:unit` |
| 手元で動かす | `examples/68-nitro/src/enclave/model.ts`、`src/enclave/attestation.ts`、`src/enclave/kms-model.ts`、`scripts/demo.ts`、`test/enclave.test.ts` | `nitro:demo`、`test:unit`、`nitro:infra:synth` |
| デプロイする | `examples/68-nitro/infra/bin/app.ts`、`tools/src/infra/` | `nitro:infra:diff`、`nitro:infra:deploy`、`nitro:infra:drift` |
| エンクレーブを起動するまで | `examples/68-nitro/infra/lib/nitro-stack.ts`、`src/measurement.ts` | `nitro:infra:deploy` |
| エンクレーブが解決しないこと | `examples/68-nitro/test/enclave.test.ts`、`src/enclave/model.ts` | `test:unit` |
| 片付け | `examples/68-nitro/infra/lib/nitro-stack.ts` | `nitro:infra:destroy` |

**一次情報**（確認日はすべて 2026-10-13）

- Nitro System: [Instances built on the AWS Nitro System](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-nitro-instances.html)、[AWS Nitro System](https://aws.amazon.com/ec2/nitro/)、ホワイトペーパー The Security Design of the AWS Nitro System の [Introduction](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/security-design-of-aws-nitro-system.html)、[Traditional virtualization primer](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/traditional-virtualization-primer.html)、[The Nitro System journey](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-nitro-system-journey.html)、[The components of the Nitro System](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-components-of-the-nitro-system.html)、[Putting the pieces together: EBS volume attachment](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/putting-the-pieces-together-ebs-volume-attachment.html)、[No AWS operator access](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/no-aws-operator-access.html)、[The EC2 approach to preventing side-channels](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/the-ec2-approach-to-preventing-side-channels.html)、[Conclusion](https://docs.aws.amazon.com/whitepapers/latest/security-design-of-aws-nitro-system/conclusion.html)、AWS のブログ [AWS Nitro System gets independent affirmation of its confidential compute capabilities](https://aws.amazon.com/blogs/compute/aws-nitro-system-gets-independent-affirmation-of-its-confidential-compute-capabilities/)
- インスタンスタイプとデバイス: [Amazon EC2 instance type naming conventions](https://docs.aws.amazon.com/ec2/latest/instancetypes/instance-type-names.html)、仕様の表（[general purpose](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html)、[compute optimized](https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html)）、[Amazon EBS volumes and NVMe](https://docs.aws.amazon.com/ebs/latest/userguide/nvme-ebs-volumes.html)、[Map Amazon EBS volumes to NVMe device names](https://docs.aws.amazon.com/ebs/latest/userguide/identify-nvme-ebs-device.html)、[Device names for volumes](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/device_naming.html)、[Amazon EBS-optimized instance types](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-optimized.html)、[Enhanced networking with ENA](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking-ena.html)、[lsblk(8)](https://man7.org/linux/man-pages/man8/lsblk.8.html)、util-linux 2.40.2 の [lsblk.c](https://github.com/util-linux/util-linux/blob/v2.40.2/misc-utils/lsblk.c)
- Graviton: [AWS Graviton Processors](https://aws.amazon.com/ec2/graviton/)、[Lambda の instruction set architecture](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html)、[Amazon ECS task definitions for 64-bit ARM workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-arm64.html)
- Nitro Enclaves のユーザーガイド: [What is Nitro Enclaves?](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)、[Concepts](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-concepts.html)、[Enclave workflow overview](https://docs.aws.amazon.com/enclaves/latest/user/flow.html)、[Building an enclave image file](https://docs.aws.amazon.com/enclaves/latest/user/building-eif.html)、[Creating an enclave](https://docs.aws.amazon.com/enclaves/latest/user/create-enclave.html)、[Hello Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/getting-started.html)、[Connect the parent instance with an enclave by using virtio-vsock](https://docs.aws.amazon.com/enclaves/latest/user/enclave-networking.html)、[Connect an enclave with AWS KMS](https://docs.aws.amazon.com/enclaves/latest/user/connect-enclave-kms.html)、[Cryptographic attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html)、[Using cryptographic attestation with AWS KMS](https://docs.aws.amazon.com/enclaves/latest/user/kms.html)、[Verifying the root of trust](https://docs.aws.amazon.com/enclaves/latest/user/verify-root.html)、[Security](https://docs.aws.amazon.com/enclaves/latest/user/security.html)、[Install the Nitro Enclaves CLI on Linux](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli-install.html)、[nitro-cli build-enclave](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-build-enclave.html)、[run-enclave](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-run-enclave.html)、[terminate-enclave](https://docs.aws.amazon.com/enclaves/latest/user/cmd-nitro-terminate-enclave.html)、[AWS Nitro Enclaves FAQs](https://aws.amazon.com/ec2/nitro/nitro-enclaves/faqs/)、GitHub の [kmstool-enclave-cli](https://github.com/aws/aws-nitro-enclaves-sdk-c/blob/main/bin/kmstool-enclave-cli/README.md) と [allocator.yaml](https://github.com/aws/aws-nitro-enclaves-cli/blob/main/bootstrap/allocator.yaml)
- KMS: [Cryptographic attestation support in AWS KMS](https://docs.aws.amazon.com/kms/latest/developerguide/cryptographic-attestation.html)、[Condition keys for attested platforms](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-attestation.html)、[Condition keys for Nitro Enclaves](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-nitro-enclave.html)、[How to make attested calls](https://docs.aws.amazon.com/kms/latest/developerguide/attested-calls.html)、[Monitoring attested requests](https://docs.aws.amazon.com/kms/latest/developerguide/ct-attestation.html)、[Decrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Decrypt.html)、[RecipientInfo](https://docs.aws.amazon.com/kms/latest/APIReference/API_RecipientInfo.html)、[Default key policy](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html)、[KMS key access and permissions](https://docs.aws.amazon.com/kms/latest/developerguide/control-access.html)
- CloudFormation と道具: [AWS::EC2::Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html)、[How IMDSv2 works](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-metadata-v2-how-it-works.html)、`aws-cdk-lib` 2.273.0 の `aws-ec2` と `aws-kms` の型定義、`@go-to-k/cdkd` 0.296.28 の中身、[Node.js 24 の net](https://nodejs.org/docs/latest-v24.x/api/net.html)
- 料金: AWS Price List bulk API の [EC2](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-1/index.csv)（CSV を usage type で絞って読みました。公開日は 2026-10-09）。Lambda、Fargate、EBS、パブリック IPv4 アドレス、KMS の単価は、ほかの章が 2026-10-11 から 2026-10-13 に同じ Price List から取った値を使っています
- 比べた相手: [How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)

:::
