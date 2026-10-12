---
title: 02 Toolchain: Nix、vp、CDK、cdkd、drift
revision: 3
---

# 02 Toolchain: Nix、vp、CDK、cdkd、drift

アカウントの準備ができました。次は道具をそろえます。

この章では、この本のコマンドが誰の手元でも同じ版のツールで動くようにして、そのうえで TypeScript で S3 bucket を 1 つ定義し、AWS に作って、変えて、消します。最後に、「これから何が変わるか（diff）」と「記録と実物がずれていないか（drift）」を、別のものとして確かめられるようになりましょう。

前提は [01章](/ja/chapters/01-account.md)です。コードは `examples/02-toolchain/` にあります。

## 全体像

```figure
caption: CDK app は手元で動き、cdkd がその template から AWS アカウントに bucket と stack を作ります。
node nix: nix develop | node, pnpm, aws, vp
node task: vp run <task>
node app: CDK app | TypeScript
node out: cdk.out/ | template
node state: cdkd-state-<account> | S3、stack ごとに state.json
node assets: cdkd-assets-<account>-<region>
node stack: AihHello stack | Notes bucket (S3)
edge nix -> task
edge task -> app
edge app -> out: synth
edge out -> state: cdkd: SDK / CC API
edge out -> assets
edge out -> stack
group machine: 手元のマシン = nix, task, app, out
group aws: AWS アカウント (ap-northeast-1) = state, assets, stack
```

コードが動くのは手元だけです。この章で AWS 側に作るのは、bucket と、cdkd が使う保存場所。それだけです。

## 環境に入る

<!-- section: 02.nix -->

この本は、ツールの版を Nix で固定します。Nix は、パッケージを版とハッシュで固定して取ってくる仕組みです。`flake.nix` に「どのツールが要るか」を書いて、`flake.lock` が「正確にどの版か」を記録する。この 2 つのファイルがあれば、Node.js を手で入れなくて済みます。

Nix 自体は自分で入れてください。公式のインストーラで入れて、`nix-command` と `flakes` という 2 つの機能を有効にします。この本の検証には Nix 2.25.3 を使いました。Nix の知識は、これ以上は要りません。

リポジトリのルートで、これを実行します。

```bash
nix develop
```

固定した版のツールが入った shell に入れます。この shell を devShell と呼びます。初回はダウンロードがあるので、少し待ちます。

<<< @/flake.nix

入るのは Node.js 24.21.0、pnpm 10.34.5、AWS CLI 2.35.11、git、そして `vp` 1.1.0 です。正確な版の一覧は[ツールチェイン](/ja/reference/toolchain.md)にあります。

`vp` は nixpkgs に入っていないので、この本が Nix 式を持っています。配布元が npm に公開している platform 別のバイナリを、ハッシュを固定して取ってくるものです。

<<< @/nix/vp.nix

`shellHook` がやっているのは 2 つです。

1 つ目。`vp` の設定置き場（`VP_HOME`）を、ホームディレクトリではなく、リポジトリの中の `.vp-home/` に向けます。あなたの `~/.vite-plus` は読みも書きもしません。

2 つ目。`VP_SELF_SETUP_NO_MODIFY_PATH` を設定します。`vp` 1.1.0 は、新しい `VP_HOME` で初めて起動したときに自分自身をそこへ配置して、何も言わなければ `~/.zshrc` などの shell の設定ファイルに 1 行を追記するんです。この変数がそれを止めます。devShell に入っただけでホームディレクトリのファイルが書き換わるのは、困りますよね。なお、この初回起動はネットワークを使います。

`.vp-home/` に置く設定は、次の 1 ファイルです。`vp` に「Node.js と pnpm は自分でダウンロードせず、PATH にあるもの（Nix が入れたもの）を使ってね」と伝えています。

<<< @/nix/vp-home.json

意図した Node.js が使われているか、確かめておきましょう。

```bash
vp env which node
```

`/nix/store/` で始まるパスが出れば、Nix の Node.js です。

正直に言うと、確かめた組み合わせは macOS（Apple silicon、`aarch64-darwin`）だけです。Intel Mac と Linux 用の定義も `nix/vp.nix` にありますが、実行して確かめてはいません。

それから、Nix が用意しないものもあります。AWS の認証情報、Docker の daemon、ネットワーク。04章の一部で Docker を使いますが、devShell に入っただけでは daemon は動いていません。

## 依存を入れる

<!-- section: 02.install -->

```bash
vp install --frozen-lockfile
```

`vp install` は、`package.json` の `packageManager` に書かれた package manager を呼びます。この本では pnpm 10.34.5 です。`--frozen-lockfile` は「`pnpm-lock.yaml` に書かれた版だけを入れて、lockfile は書き換えない」という指定です。

`vp` を使っても lockfile は要ります。`vp` 専用の lockfile というものはなくて、pnpm の `pnpm-lock.yaml` がそれです。

CDK の CLI も cdkd も、この `vp install` で入ります。Nix で入れるのは Node.js まで、npm のパッケージは pnpm が管理する、という分担です。同じツールを 2 か所で管理したくないので。
