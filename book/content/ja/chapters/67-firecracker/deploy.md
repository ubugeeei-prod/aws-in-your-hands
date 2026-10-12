---
title: "67 Firecracker: デプロイ"
---

# 67 Firecracker: デプロイ

Linux と KVM のあるマシンが手元に無い読者のために、試す場所を EC2 に用意するスタックです。**`-c run=true` を付けてデプロイすると、c7i.large が 1 台起動し、消すまで 1 時間ごとに料金がかかります。** 東京リージョンのオンデマンドの定価で 1 時間 0.11235 USD、パブリック IPv4 アドレスとルートボリュームを足すと、2 時間で 0.24 USD、消し忘れて 1 か月で 87.20 USD です。フラグを付けなければインスタンスは作られず、時間で課金されるものはありません。このページのコマンドは、synth を除いて実行していません。

## 試す場所としてのインスタンス

<!-- section: 67.host -->

Firecracker の手引きは、EC2 では `.metal` のインスタンスタイプだけを使うと書いています。EC2 が KVM を使わせるのは `.metal` だけだから、という理由です。例に挙がっている c5.metal は、東京リージョンで 1 時間 5.136 USD、2 時間で 10.27 USD です。

一方、EC2 のユーザーガイドには、nested virtualization のページがあります。ベアメタルではない通常のインスタンスの中で KVM や Hyper-V を動かす機能で、追加の料金はかかりません。2026 年 10 月 13 日の時点で、対応するのは M7i、C7i、C8i、R8i など Intel の一部のファミリーで、Graviton のファミリーは一覧にありません。インスタンスの起動時に、CPU オプションの `NestedVirtualization` を有効にします。

この 2 つの記述は食い違っていて、手引きのほうが古いのだと読めます。このスタックは、安いほうの nested virtualization を使います。ただし、次のことを承知のうえで使ってください。

- Firecracker のプロジェクトがテストしているのは `.metal` のインスタンスだけです。nested virtualization の上で Firecracker が動くことは、プロジェクトの資料にも、この本にも、確かめた記録がありません
- EC2 のガイドは、性能や遅延に厳しいワークロードにはベアメタルを検討するよう書いています。ここで測る時間は、仮想マシンの中の仮想マシンの時間です
- 練習のための構成です。jailer を使わず、SMT も無効にしていません。他人のコードを動かす場所にはなりません

設定は 3 つです。

<<< @/examples/67-firecracker/src/host-config.ts{schema}

<<< @/examples/67-firecracker/infra/bin/app.ts{context}

nested virtualization は、起動テンプレート（launch template）に書きます。この本が固定している CDK の版では、`AWS::EC2::Instance` の CPU オプションにこのプロパティが無く、起動テンプレートの側にだけあるためです。

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{launch-template}

イメージは、x86_64 の Amazon Linux 2023 の、カーネル 6.1 のものです。6.1 は、Firecracker v1.17.0 が対応するホストのカーネルの 1 つです。メタデータの設定は 23章と同じで、トークンの応答が届くのは 1 ホップまでです。ゲストは TAP デバイスの向こうにいるので、ゲストからはトークンを取れないはずですが、これは設定からの推測で、確かめていません。前のページの `tap.sh` が、ホストの側でもメタデータ宛のパケットを落とします。

インスタンスそのものは、フラグがあるときだけ作ります。

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{instance}

置く場所は、11章の VPC のパブリックサブネットです。Firecracker のバイナリ、カーネル、Node.js を GitHub、S3、nodejs.org から取得するので、外へ出る HTTPS が要ります。入ってくる通信は 1 つも許可していません。入口は、23章と同じ Session Manager です。

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{network}

インスタンスにはこのリポジトリのチェックアウトが無いので、前のページで作った `dist/kit/` を S3 のバケット経由で渡します。ロールに足した権限は、そのプレフィックスの読み取りだけです。

<<< @/examples/67-firecracker/infra/lib/firecracker-host-stack.ts{kit}

固定した版の cdkd（0.296.28）での扱いも確かめました。`AWS::EC2::LaunchTemplate` には専用の実装が無く、Cloud Control API 経由になります。`AWS::EC2::Instance` には専用の実装がありますが、その実装が自分で書くプロパティの一覧に `LaunchTemplate` はありません。23章で読んだとおりなら、このインスタンスも Cloud Control API 経由になります。どちらもデプロイして確かめてはいません。残りの種類（セキュリティグループ、ロール、ポリシー、インスタンスプロファイル、バケット、バケットポリシー）は、23章のスタックが使っているものと同じです。

手順は次のとおりです。先に 11章のネットワークが要ります。

```bash
vp run net:infra:deploy
vp run firecracker:infra:deploy -c run=true
vp run firecracker:kit:publish
```

`firecracker:kit:publish` は、`dist/kit/` を 1 つのアーカイブにしてバケットに置き、インスタンスの上で実行するコマンドを表示します。インスタンスには、マネジメントコンソールの Session Manager か、Session Manager プラグインを入れた AWS CLI で入ります。インスタンスの ID は、スタックの出力の `InstanceId` です。

```bash
aws ssm start-session --target <InstanceId> --region ap-northeast-1
```

インスタンスの中では、まず KVM が見えていることを確かめ、道具を入れ、キットを取り出します。

```bash
ls -l /dev/kvm
sudo dnf install -y squashfs-tools iptables-nft jq tar xz openssh-clients
mkdir kit && cd kit
aws s3 cp s3://<KitBucketName>/kit/kit.tgz . && tar -xzf kit.tgz
```

`/dev/kvm` が無ければ、nested virtualization が有効になっていません。そこから先は、[手元で動かす](/ja/chapters/67-firecracker/local.md)のページの `bash deploy/prepare.sh` 以降と同じです。パッケージの名前は Amazon Linux 2023 のものを書きましたが、この一覧で足りるかどうかも、実行して確かめてはいません。

終わったら、その日のうちに消します。手順は[次のページ](/ja/chapters/67-firecracker/wrap.md)にあります。
