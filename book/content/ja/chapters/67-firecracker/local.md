---
title: "67 Firecracker: 手元で動かす"
---

# 67 Firecracker: 手元で動かす

このページは 2 つに分かれます。前半は、どのマシンでも動く部分で、テストと、送るリクエストの表示です。この本が実際に実行したのはここまでです。後半は、Linux と KVM のあるマシンで microVM を起動し、その中で 04章のサーバーを動かす手順で、実行していません。

## テストと、送るリクエストの表示

<!-- section: 67.local -->

```bash
nix develop
vp install --frozen-lockfile
vp test run examples/67-firecracker
vp run firecracker:plan
```

`firecracker:plan` は、起動のときに送るリクエストを、順番どおりに curl のコマンドとして表示します。ソケットは開かず、何も送りません。引数が無ければ、後半の手順で使う設定になります。

```text
# Boot. Nothing below is sent by this command.
# putMachineConfiguration, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/machine-config' -H 'Content-Type: application/json' -d '{"vcpu_count":1,"mem_size_mib":256}'
# putGuestBootSource, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/boot-source' -H 'Content-Type: application/json' -d '{"kernel_image_path":"work/vmlinux","boot_args":"console=ttyS0 reboot=k panic=1"}'
# putGuestDriveByID, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/drives/rootfs' -H 'Content-Type: application/json' -d '{"drive_id":"rootfs","path_on_host":"work/rootfs.ext4","is_root_device":true,"is_read_only":false}'
# putGuestNetworkInterfaceByID, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/network-interfaces/net1' -H 'Content-Type: application/json' -d '{"iface_id":"net1","host_dev_name":"tap0","guest_mac":"06:00:AC:10:00:02"}'
# createSyncAction, expects 204
curl --unix-socket /tmp/firecracker.socket -X PUT 'http://localhost/actions' -H 'Content-Type: application/json' -d '{"action_type":"InstanceStart"}'
```

上の出力は、2026 年 10 月 13 日にこのリポジトリで実行したときのものです。Firecracker の手引きが curl で 1 つずつ送っているのと同じ呼び出しで、違いは、この列が検証済みの設定から作られ、ボディが仕様と照らされていることです。別の設定で見たいときは、JSON のファイルを渡します。`--snapshot` を付けると、スナップショットを取る 3 つの呼び出しも表示します。

<<< @/examples/67-firecracker/src/args.ts{args}

テストが扱う範囲は、前のページで見たとおりです。仕様との照合、設定の検証、リクエストの列、Unix ドメインソケット越しのクライアントと失われた応答、起動時間の測り方、スタックのアサーション。テストの相手は自作のサーバーなので、次のことは再現していません。

- 本物の Firecracker が、誤った設定や順序をどう断るか。ステータスとメッセージは確かめていません
- ゲストの起動そのもの。カーネル、ルートファイルシステム、ネットワークは、テストに出てきません
- 起動にかかる時間。テストの時計は、進めた分しか進まない作りものです

`vp run firecracker:boot` を macOS で実行すると、何も送らずに、Linux と KVM が要ることを表示して終わります。

## Linux と KVM のあるマシンでの手順

<!-- section: 67.walkthrough -->

ここから先は実行していません。手引き（`docs/getting-started.md`）のコマンドをもとに、この章のコードをつなぐ手順を書いたものです。うまくいかなければ、まず手引きのとおりに curl で起動できるかを確かめてください。

要るものは、手引きによれば次のとおりです。x86_64 か aarch64 の Linux。読み書きできる `/dev/kvm`。確かめるコマンドも手引きにあります。

```bash
lsmod | grep kvm
[ -r /dev/kvm ] && [ -w /dev/kvm ] && echo "OK" || echo "FAIL"
```

手元に Linux のマシンがあれば、それがいちばん簡単です。無い場合に EC2 で用意する方法は、[デプロイ](/ja/chapters/67-firecracker/deploy.md)のページに書きました。Firecracker がテストしているホストのカーネルは 5.10、6.1、6.18 です。ほかに、`curl`、`tar`、`xz`、`squashfs-tools`、`e2fsprogs`、`ssh-keygen`、`iproute2`、`iptables`、`jq` を使います。

最初に、この章のプログラムを、チェックアウトの無いマシンでも動く形にまとめます。これは macOS でも実行でき、実行しました。

```bash
vp run firecracker:kit:build
```

`dist/kit/` に、ゲストの中で動かすサーバー（`guest-server.mjs`）、`firecracker:plan` と同じもの（`plan.mjs`）、起動して時間を測るもの（`boot.mjs`）、そして `deploy/` が入ります。ゲストの中で動かすのは 04章のアプリで、変えていません。

<<< @/examples/67-firecracker/src/guest-server.ts{guest}

以下は、Linux のマシンの上で、`dist/kit/` を置いたディレクトリから実行します。まず、起動に要るものを `work/` に揃えます。

<<< @/examples/67-firecracker/deploy/prepare.sh

```bash
bash deploy/prepare.sh
```

カーネルとルートファイルシステムを取得する部分は、手引きと同じです。Firecracker のプロジェクトが自分の CI のために作って公開しているもので、ルートファイルシステムは Ubuntu です。足したのは 3 点で、Firecracker のバイナリを版とチェックサムを固定して取得すること、Node.js を同じくチェックサムを確かめて取得すること、ルートファイルシステムに Node.js と `guest-server.mjs` と次のユニットを入れることです。

<<< @/examples/67-firecracker/deploy/notes.service

確かめられていない点を 1 つ挙げておきます。公式の Node.js のバイナリが、この Ubuntu のイメージの中でそのまま動くかどうかです。イメージを作るスクリプトのパッケージの一覧からは動くと見込んでいますが、イメージの中身は見ていません。動かなければ、ゲストに SSH で入って `journalctl -u notes` を見ます。

次に、ホスト側のネットワークを作ります。

<<< @/examples/67-firecracker/deploy/tap.sh

```bash
sudo bash deploy/tap.sh up
```

TAP デバイスと NAT の部分は手引きのとおりです。`up` の最後の 2 行は、本番ホストの設定の文書から足しました。ホストが EC2 のインスタンスのとき、ゲストから `169.254.169.254` に届くと、ゲストの中のコードがインスタンスのロールの認証情報を取れてしまいます。Firecracker はパケットを選別しないので、ホストで落とします。

端末を 2 つ使います。1 つ目で Firecracker を起動します。ソケットで待ち受けるだけで、まだ何も動きません。

```bash
sudo rm -f /tmp/firecracker.socket
sudo work/firecracker --api-sock /tmp/firecracker.socket
```

2 つ目で、起動の列を送ります。Firecracker を root で起動したので、ソケットを開く側も root にします。

```bash
sudo work/node/bin/node boot.mjs
```

`boot.mjs` は、設定の 4 つを送り、`InstanceStart` を送り、ゲストの中のサーバーが `http://172.16.0.2:8080/health` に答えるまで、5 ミリ秒の間を置いて繰り返し試します。

<<< @/examples/67-firecracker/src/boot.ts{boot}

表示するのは 3 つの時間です。設定の呼び出しにかかった時間、`InstanceStart` の呼び出しにかかった時間、`InstanceStart` を送ってから最初の応答までの時間。3 つ目には、ゲストのカーネルの起動、systemd、Node.js の起動、アプリの初期化、そして試す間隔が入っています。Firecracker の仕様書の 125 ミリ秒は init が始まるまでの値なので、これと比べられる数字ではありません。プログラムも、時間を表示するたびにそう書き添えます。ここで見られるのは、29章で Lambda の外から見ていたコールドスタートを、microVM の起動から自分のコードの最初の応答まで、自分のマシンで分けて見たときの内訳です。

動いたら、ホストから確かめます。

```bash
curl -s http://172.16.0.2:8080/health
ssh -i work/guest.id_rsa root@172.16.0.2
```

止めるときは、ゲストの中で `reboot` を実行します。FAQ によれば、Firecracker はゲストの再起動に対応していないので、`reboot` はプロセスの終了になります。そのあと、ホストのネットワークを戻します。

```bash
sudo bash deploy/tap.sh down
sudo rm -f /tmp/firecracker.socket
```

もう 1 歩進めるなら、`sudo work/node/bin/node boot.mjs --snapshot` で、起動のあとにスナップショットを取れます。`work/snapshot.mem` の大きさが、設定したメモリの大きさとどう対応するかを見てください。
