---
title: "68 Nitro: デプロイ"
---

# 68 Nitro: デプロイ

このページの手順は、どれも実行していません。インスタンスの中で打つコマンドは Nitro Enclaves のユーザーガイドから、AWS CLI の引数は devShell の AWS CLI 2.35.11 の help から写しました。エンクレーブのイメージを作るには Docker が要ります。Nix の devShell に Docker のデーモンは入っていないので、ビルドはインスタンスの上で行います。試すときは、インスタンスが時間課金であることを忘れず、その日のうちに[片付け](/ja/chapters/68-nitro/wrap.md)まで進めてください。

## デプロイする

<!-- section: 68.deploy -->

11章のネットワークが先に要ります。11章の設定は既定のままで構いません。この章のインスタンスはパブリックサブネットに置くので、インターフェースエンドポイントは使いません。

```bash
vp run net:infra:deploy
vp run nitro:infra:diff
vp run nitro:infra:deploy
```

`nitro:infra:diff` は、作られるリソースを表示します。セキュリティグループ、ロール、インスタンスプロファイル、KMS の鍵、インスタンスの 5 つのはずです。デプロイが終わると、スタックの出力に `InstanceId`、`KeyId`、`ParentRoleArn` が出ます。

最初に確かめるのは、インスタンスでエンクレーブが有効になっていることです。固定した版の cdkd がこのプロパティを Cloud Control API 経由で渡す、という点を、この章は実物で確かめていません。

```bash
aws ec2 describe-instances --region ap-northeast-1 --instance-ids i-xxxxxxxxxxxxxxxxx --query 'Reservations[].Instances[].EnclaveOptions'
```

`Enabled` が `true` でなければ、この先の手順は通りません。そのときは、cdkd が何を送ったかを `nitro:infra:deploy` の出力で見て、検証メモの再開手順に進んでください。

この時点のキーポリシーには、管理用のステートメントしかありません。鍵は存在しますが、誰も使えません。

ドリフトの検査は、23章と同じです。

```bash
vp run nitro:infra:drift
```

## エンクレーブを起動するまで

<!-- section: 68.walkthrough -->

インスタンスには Session Manager で入ります。23章と同じく、Session Manager プラグインが要ります。

```bash
aws ssm start-session --region ap-northeast-1 --target i-xxxxxxxxxxxxxxxxx
```

ここからは、インスタンスの中で打つコマンドです。まず、Nitro CLI と、サンプルの入った開発用のパッケージを入れ、自分を 2 つのグループに足します。

```bash
sudo dnf install aws-nitro-enclaves-cli -y
sudo dnf install aws-nitro-enclaves-cli-devel -y
sudo usermod -aG ne $USER
sudo usermod -aG docker $USER
```

グループの変更は、入り直すまで効きません。セッションを閉じて、もう一度入ります。

次に、エンクレーブに渡す vCPU とメモリを先に取り分けます。取り分けるのは allocator というサービスで、量は `/etc/nitro_enclaves/allocator.yaml` に書きます。既定は 512 MiB と 2 vCPU です。ユーザーガイドは、2 vCPU の Graviton のインスタンスでは 1 vCPU だけを取り分けるよう書いています。`c6g.large` はこれに当たるので、`cpu_count: 2` の行を `cpu_count: 1` に書き換えてから、サービスを有効にします。ファイルの書式は、GitHub にある Nitro CLI のリポジトリのもので確かめました。パッケージに入っているファイルが同じかどうかは、2 行目で見てください。

```bash
sudo sed -i 's/^cpu_count: 2$/cpu_count: 1/' /etc/nitro_enclaves/allocator.yaml
grep -E '^(cpu_count|memory_mib)' /etc/nitro_enclaves/allocator.yaml
sudo systemctl enable --now nitro-enclaves-allocator.service
sudo systemctl enable --now docker
nitro-cli --version
```

ここまでで、エンクレーブを起動する用意ができました。ユーザーガイドの最初のチュートリアルは、5 秒ごとに 1 行を出すだけのサンプルです。Docker のイメージを作り、それをイメージファイルに変換します。

```bash
docker build /usr/share/nitro_enclaves/examples/hello -t hello
nitro-cli build-enclave --docker-uri hello:latest --output-file hello.eif
```

2 行目が、計測値を出力します。ユーザーガイドの例では、次の形です。値はイメージごとに違います。

```text
Start building the Enclave Image...
Enclave Image successfully created.
{
  "Measurements": {
    "HashAlgorithm": "Sha384 { ... }",
    "PCR0": "<96 hex digits>",
    "PCR1": "<96 hex digits>",
    "PCR2": "<96 hex digits>"
  }
}
```

エンクレーブを起動します。最初はデバッグモードにして、コンソールを見ます。

```bash
nitro-cli run-enclave --cpu-count 1 --memory 512 --enclave-cid 16 --eif-path hello.eif --debug-mode
nitro-cli describe-enclaves
nitro-cli console --enclave-id i-xxxxxxxxxxxxxxxxx-encxxxxxxxxxxxxxxxxx
nitro-cli terminate-enclave --enclave-id i-xxxxxxxxxxxxxxxxx-encxxxxxxxxxxxxxxxxx
```

ユーザーガイドは `--cpu-count 2` で書かれています。あちらの例は 4 vCPU の `m5.xlarge` だからです。この章のインスタンスでは、取り分けたのが 1 vCPU なので 1 にしています。`describe-enclaves` は `State` が `RUNNING`、`Flags` が `DEBUG_MODE` のエンクレーブを 1 つ返し、`console` は `Hello from the enclave side!` を 5 秒ごとに表示する、とユーザーガイドにあります。`run-enclave` の出力にあるエンクレーブの ID を、3 行目と 4 行目に渡します。

チュートリアルの Dockerfile は、`amazonlinux:2023` や `alpine:latest` といったベースのイメージをレジストリから取ります。インスタンスをパブリックサブネットに置いたのは、このためです。hello のサンプルがどのイメージを取るかは、確かめていません。既定のルートボリュームに、Docker のイメージとイメージファイルが収まるかどうかは、確かめていません。

## 計測値をキーポリシーに入れる

`build-enclave` が出した PCR0 を、スタックに渡します。

```bash
vp run nitro:infra:diff -c measurement=<PCR0>
vp run nitro:infra:deploy -c measurement=<PCR0>
```

変わるのは鍵のポリシーだけのはずです。インスタンスが置き換わるような差分が出たら、デプロイせずに止めてください。`-c measurement=` を付け忘れてデプロイし直すと、ポリシーは誰も使えない形に戻ります。

これで、鍵は「この PCR0 を持つ文書が付いたリクエスト」にだけ答えるようになりました。hello のサンプルは KMS を呼ばないので、ここから先は、ユーザーガイドの 2 つのチュートリアルを順に通します。「Connect the parent instance with an enclave by using virtio-vsock」と「Connect an enclave with AWS KMS」です。この章の構成に合わせて読み替える点が 5 つあります。

- **リージョン。** ユーザーガイドの例は `us-east-1` です。vsock-proxy の許可リスト、`kmstool_enclave_cli` の `--region` を、どれも `ap-northeast-1` にします。許可リストは `/etc/nitro_enclaves/vsock-proxy.yaml` で、サービスは `nitro-enclaves-vsock-proxy.service` です
- **計測値。** イメージを作り直すたびに PCR0 が変わります。チュートリアルのイメージを作ったら、その PCR0 でもう一度デプロイします
- **デバッグモード。** チュートリアルは `--debug-mode` で起動します。そのエンクレーブの PCR0 は 0 なので、この章のポリシーでは鍵をもらえません。`measurement` は 0 だけの値を受け付けないようにしてあります。アテステーションを確かめるときは、デバッグモードを外して起動します
- **暗号文の作り方。** チュートリアルは、手元で `aws kms encrypt` を呼んで暗号文を作ります。この章の鍵は、`kms:Encrypt` を誰にも許していません。代わりに、エンクレーブの中から `kmstool_enclave_cli genkey` でデータキーを作り、出力の `CIPHERTEXT` を `decrypt` に渡します。どちらのコマンドも `kmstool-enclave-cli` の README に載っています
- **IMDSv2 の hop limit。** チュートリアルの親側のプログラムは、コンテナの中から IMDSv2 でロールの認証情報を取ります。この章のインスタンスは hop limit を 1 にしています。EC2 のドキュメントは、インスタンスの上のコンテナのためには、より大きい値が要ることがある、と書いています。認証情報が取れなければ、親側のプログラムをコンテナの外で動かすか、`aws ec2 modify-instance-metadata-options` で 2 に上げます

通したら、確かめることは 3 つです。エンクレーブの中からの `decrypt` が通ること。親のシェルで同じ包まれた鍵を `aws kms decrypt --ciphertext-blob fileb://<file> --key-id <KeyId>` に渡すと、拒否されること。CloudTrail の KMS のイベントに、`additionalEventData` の `recipient` として文書の情報が残っていること。2 つ目が、この章でいちばん見たい結果です。同じインスタンスの、同じロールで、文書が無いだけで断られます。
