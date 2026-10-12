---
title: 02 Toolchain: Nix、vp、CDK、cdkd、drift
revision: 3
---

# 02 Toolchain: Nix、vp、CDK、cdkd、drift

アカウントの準備ができたので、次は道具をそろえます。

この章ではまず、この本のコマンドが誰の手元でも同じ版のツールで動くようにします。そのうえで、TypeScript で S3 バケットを 1 つ定義し、AWS に作って、変えて、消します。最後に、これから何が変わるかを示す diff と、記録と実物のずれであるドリフト（drift）を、別々の検査として確かめられるようにします。

前提は [01章](/ja/chapters/01-account.md)です。コードは `examples/02-toolchain/` にあります。

## 全体像

```figure
caption: CDK アプリは手元で動き、cdkd がそのテンプレートから AWS アカウントにバケットとスタックを作ります。
node nix: nix develop | node, pnpm, aws, vp
node task: vp run <task>
node app: CDK アプリ | TypeScript
node out: cdk.out/ | テンプレート
node state: cdkd-state-<account> | S3、スタックごとに state.json
node assets: cdkd-assets-<account>-<region>
node stack: AihHello スタック | Notes バケット (S3)
edge nix -> task
edge task -> app
edge app -> out: synth
edge out -> state: cdkd: SDK / CC API
edge out -> assets
edge out -> stack
group machine: 手元のマシン = nix, task, app, out
group aws: AWS アカウント (ap-northeast-1) = state, assets, stack
```

コードが動くのは手元だけです。この章で AWS 側に作るのは、バケット 1 つと、cdkd が使う保存場所だけです。

## 環境に入る

<!-- section: 02.nix -->

この本では、ツールの版を Nix で固定します。Nix は、パッケージを版とハッシュで固定して取得する仕組みです。必要なツールを `flake.nix` に書くと、正確な版が `flake.lock` に記録されます。この 2 つのファイルがあるので、Node.js を手で入れる必要はありません。

Nix そのものは自分で入れてください。公式のインストーラで入れたあと、`nix-command` と `flakes` の 2 つの機能を有効にします。この本の検証には Nix 2.25.3 を使いました。Nix について、これ以上の知識は要りません。

リポジトリのルートで次のコマンドを実行します。

```bash
nix develop
```

実行すると、固定した版のツールが入ったシェルに入ります。このシェルを devShell と呼びます。初回はツールをダウンロードするので、少し待ちます。

<<< @/flake.nix

devShell に入るのは、Node.js 24.21.0、pnpm 10.34.5、AWS CLI 2.35.11、git、`vp` 1.1.0 です。正確な版の一覧は[ツールチェイン](/ja/reference/toolchain.md)にあります。

`vp` は nixpkgs に入っていないので、この本のリポジトリに Nix 式を置いています。配布元が npm に公開しているプラットフォーム別のバイナリを、ハッシュを固定して取得する式です。

<<< @/nix/vp.nix

`flake.nix` の `shellHook` は、2 つのことをしています。

1 つは、`vp` の設定の置き場所（`VP_HOME`）を、ホームディレクトリではなくリポジトリの中の `.vp-home/` に向けることです。こうしておくと、`vp` は `~/.vite-plus` を読みも書きもしません。

もう 1 つは、`VP_SELF_SETUP_NO_MODIFY_PATH` を設定することです。`vp` 1.1.0 は、新しい `VP_HOME` で初めて起動したときに自分自身をそこへ配置し、何も指定しなければ `~/.zshrc` などのシェルの設定ファイルに 1 行を追記します。devShell に入っただけでホームディレクトリのファイルが書き換わるのは困るので、この変数で追記を止めています。なお、この初回の起動ではネットワークを使います。

`.vp-home/` に置く設定は次の 1 ファイルです。Node.js と pnpm を `vp` が自分でダウンロードせず、PATH にあるもの、つまり Nix が入れたものを使うように指定しています。

<<< @/nix/vp-home.json

意図した Node.js が使われているかどうかは、次のコマンドで確かめられます。

```bash
vp env which node
```

`/nix/store/` で始まるパスが表示されれば、Nix が入れた Node.js です。

確かめた組み合わせは macOS（Apple silicon、`aarch64-darwin`）だけです。Intel Mac と Linux 用の定義も `nix/vp.nix` にありますが、実行して確かめてはいません。

Nix が用意しないものもあります。AWS の認証情報、Docker のデーモン、ネットワークの 3 つです。04章の一部で Docker を使いますが、devShell に入っただけではデーモンは動いていません。

## 依存を入れる

<!-- section: 02.install -->

```bash
vp install --frozen-lockfile
```

`vp install` は、`package.json` の `packageManager` に書かれたパッケージマネージャーを呼び出します。この本では pnpm 10.34.5 です。`--frozen-lockfile` を付けると、`pnpm-lock.yaml` に書かれた版だけを入れ、ロックファイルは書き換えません。

`vp` を使う場合もロックファイルは必要です。`vp` 専用のロックファイルはなく、pnpm の `pnpm-lock.yaml` がその役目をします。

CDK の CLI と cdkd も、この `vp install` で入ります。同じツールを 2 か所で管理しないように、Nix で入れるのは Node.js までとし、npm のパッケージは pnpm に任せています。
