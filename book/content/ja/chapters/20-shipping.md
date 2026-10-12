---
title: "20 CI/CD: OIDC、環境、preview、rollback、drift"
revision: 3
---

# 20 CI/CD: OIDC、環境、preview、rollback、drift

ここまでの章は、あなたの端末から、あなたの認証情報で、cdkd を使ってデプロイしてきました。学ぶには速くて良いやり方です。でも、「本番向けの経路は 20章で」「人の認証情報でデプロイしない話は 20章で」と、何度も先送りにしてきましたよね。

この章で、その約束をまとめて果たします。04章の API を、AWS CDK CLI と CloudFormation という標準の経路にのせます。GitHub Actions が、アクセスキーをどこにも置かずに AWS に入れるようにします。そして、02章で作った drift の gate に、CloudFormation の drift 検出をつなぎます。

先に正直に言っておきます。この章の AWS 側の手順と GitHub Actions の workflow は、まだ一度も実際には動かしていません。手元で確かめたのは、テスト、型検査、synth までです。どこが未確認かは、章末にまとめてあります。

前提は [02章](/ja/chapters/02-toolchain.md)と [04章](/ja/chapters/04-http-api.md)です。コードは `examples/20-shipping/` と `tools/src/drift/` にあります。

## 全体像

<!-- section: 20.architecture -->

```figure
caption: 手元と GitHub Actions は同じ flake.lock、同じ pnpm-lock.yaml、同じ vp run タスクを使い、AWS には access key を置かずに、job ごとに OIDC token を 1 時間の認証情報と交換する
direction: right
node laptop: Developer laptop | check:all, ship:cfn:synth
node gha: GitHub Actions | pr, deploy, drift, preview
node aws: AWS account | ap-northeast-1
edge laptop -> gha: git push
edge gha -> aws: OIDC token
edge aws --> gha: 1 時間の認証情報
```

```figure
caption: AWS に触る 4 つの workflow は、それぞれ別の IAM role を使う
direction: right
node pr: pr.yml | check: check:all (AWS なし)
node deploy: deploy.yml | check:all, status, ship:smoke
node drift: drift.yml
node preview: preview.yml
node plan: PlanRole
node deployrole: DeployRole
node driftrole: DriftRole
node previewrole: PreviewRole
edge pr -> plan: plan: ship:cfn:diff
edge deploy -> deployrole: ship:cfn:deploy
edge drift -> driftrole: ship:cfn:drift
edge preview -> previewrole: deploy / destroy
group gha: GitHub Actions = pr, deploy, drift, preview
group aws: AWS account (ap-northeast-1) = plan, deployrole, driftrole, previewrole
```

```figure
caption: 4 つの role は、届く先がそれぞれ違い、stack を作れるのは DeployRole と PreviewRole だけ
direction: right
node plan: PlanRole | pr.yml
node deployrole: DeployRole | deploy.yml
node driftrole: DriftRole | drift.yml
node previewrole: PreviewRole | preview.yml
node lookup: cdk lookup role | 読むだけ
node cdkdeploy: cdk deploy role | CloudFormation へ
node detect: DetectStackDrift | 読むだけ
node prstack: AihShipApiPr<number> | preview stack
node cfn: CloudFormation | cfn-exec role が AihShipApiProd を作る
edge plan -> lookup
edge deployrole -> cdkdeploy
edge driftrole -> detect
edge previewrole -> prstack
edge cdkdeploy -> cfn
group aws: AWS account (ap-northeast-1) = plan, deployrole, driftrole, previewrole, lookup, cdkdeploy, detect, prstack, cfn
```

左から右へ、3 つの場所があります。

手元では、これまでどおり `vp run` でテストと synth をします。GitHub Actions は、同じ `flake.lock` で同じ devShell に入り、同じ `vp run` タスクを呼びます。CI 専用のスクリプトはありません。「CI では通るのに手元では通らない」を、作りようがないようにしたいからです。

AWS に触る job は 4 種類で、それぞれが別の IAM role を使います。pull request は読むだけ。main への push はデプロイ。毎日の定期実行は drift の検出。pull request ごとの preview は、専用の stack の作成と削除です。

題材は 04章の API ですが、stack は別物です。04章で cdkd が作った `AihHttpApi` には触りません。この章は `AihShipApi` という別の名前の stack を、CloudFormation に作らせます。

## 2 つの経路を、もう一度

<!-- section: 20.two-paths -->

02章で、template を AWS に反映する経路は 2 つあると話しました。おさらいしながら、今度は CloudFormation の側を詳しく見ます。

cdkd は、AWS の各サービスの API を自分で呼んでリソースを作り、「何を作ったか」を S3 の JSON に記録します。AWS CDK CLI（`cdk deploy`）は、template を CloudFormation に渡すだけです。作るのも、記録するのも、失敗したときに戻すのも、CloudFormation という AWS のサービスがやります。

cdkd の公式ドキュメントは、本番には AWS CDK CLI を使い続けるよう勧めています。理由として挙げているのは、CloudFormation が持っている change set や stack policy といった道具です（確認日 2026-10-12）。この章で使うものを並べると、こうなります。

- stack: 何を作ったかの記録。あなたの S3 bucket ではなく、CloudFormation の中にある
- change set: 更新の前に「何が追加され、変わり、置き換わり、消えるか」を一覧にしたもの
- 自動の rollback: 更新の途中でリソースが 1 つでも失敗したら、既定では前の設定に戻す
- drift detection: template と実物の比較。ただし範囲に限りがあります（後半の主役です）
- termination protection と stack policy: うっかり消す、うっかり置き換える、への歯止め

### bootstrap は別物

`cdk deploy` を使うには、アカウントとリージョンごとに一度、CDK の bootstrap が要ります。02章の cdkd の bootstrap とは、名前が同じだけの別物です。

```bash
vp run ship:cfn:bootstrap
```

これは AWS を変更します。固定した版の CLI（2.1145.0）が持っている template を `cdk bootstrap --show-template` で出して読むと、作られるのは `CDKToolkit` という CloudFormation の stack で、中身は次のとおりでした。

| | cdkd の bootstrap（02章） | CDK の bootstrap（この章） |
| --- | --- | --- |
| 作る手段 | cdkd が API を直接呼ぶ | CloudFormation の stack `CDKToolkit` |
| S3 bucket | `cdkd-state-<アカウント>`、`cdkd-assets-<アカウント>-<リージョン>` | `cdk-hnb659fds-assets-<アカウント>-<リージョン>` |
| ECR repository | `cdkd-container-assets-<アカウント>-<リージョン>` | `cdk-hnb659fds-container-assets-<アカウント>-<リージョン>` |
| IAM role | なし。あなたの権限でそのまま作る | 5 つ（下で説明します） |
| 「何を作ったか」の記録 | state の bucket の JSON | CloudFormation が持つ。bucket には置かない |
| その他 | | 版を記録する SSM parameter `/cdk-bootstrap/hnb659fds/version` |

`hnb659fds` は qualifier と呼ばれる既定の文字列で、値そのものに意味はありません。

role は 5 つです。CLI が template や zip を bucket に置くための file-publishing role、コンテナイメージ用の image-publishing role、CloudFormation に指示を出す deploy role、アカウントの情報を読むための lookup role。そして、CloudFormation 自身がリソースを作るときに使う cfn-exec role。

この最後の role に注意してください。何も指定しないと、cfn-exec role には `AdministratorAccess` が付きます。つまり、deploy role を使える人は、template に書きさえすれば、CloudFormation 経由で何でも作れます。絞るには bootstrap のときに `--cloudformation-execution-policies` で policy を指定しますが、この章のタスクは既定のままです。本番のアカウントでは、ここを最初に見直してください。

asset の bucket は、`CDKToolkit` stack を消しても残る設定になっています。

### 同じ stack を、交互に触らない

02章で書いたことを、もう一度。cdkd で作った stack を `cdk deploy` で更新する、あるいはその逆は、やりません。記録が 2 か所にできて、どちらも「自分が全部知っている」つもりで動くからです。

この章が stack の名前を分けているのは、そのためです。cdkd の公式ドキュメントも、1 つの CDK アプリを、開発環境には cdkd で、本番には AWS CDK CLI でデプロイする使い方を挙げています。道具を分ける単位は、stack（環境）です。

「いま cdkd で動いている stack を、CloudFormation の管理に移したい」こともあるでしょう。固定した版の cdkd には、そのための `export` と、逆向きの `import --migrate-from-cloudformation` があります。ヘルプによれば、`export` は CloudFormation の import の change set でリソースをそのまま引き渡し、成功したら cdkd の state を消します。import できない種類のリソースが 1 つでもあると中止します。これは日々のデプロイとは別の、一度きりの移行作業です。この本では実行していないので、試すなら練習用の stack で、`--dry-run` の計画を読んでからにしてください。

### CDK CLI を呼ぶ場所は 1 つ

cdkd のときと同じく、CLI に渡す引数は 1 つの関数に集めました。

<<< @/examples/20-shipping/src/cdk-args.ts{invocation}

`--no-rollback`、`--hotswap`、`--express` は、どこにも出てきません。どれも速くなるかわりに、失敗したときに CloudFormation が戻してくれなくなるものです。この関数がそれらを自分からは足さないことを、テストで固定しています。

## 環境は stack を分ける

<!-- section: 20.stages -->

dev と prod を、1 つの stack の「モード」にはしません。別の stack にします。

<<< @/examples/20-shipping/infra/lib/config.ts{stage}

`-c stage=prod` を付けると、作られるのは `AihShipApiProd`。`-c stage=pr-12` なら `AihShipApiPr12`。何も付けなければ `AihShipApi`（dev）です。「何も指定しなかったら本番に当たった」が起きない向きにしてあります。知らない stage の名前は、synth の時点で止まります。

<<< @/examples/20-shipping/infra/bin/app.ts{app}

本番だけ変えているのは 2 点です。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{protection}

1 つは termination protection。stack の削除を、解除するまで拒否します。もう 1 つは、log group を stack と一緒に消さないこと。練習用と preview の stack は、消したら何も残りません。

stage ごとに変えていないものも 1 つ。どの stack の API も、誰でも呼べる URL を 1 つ持ちます。なので 04章と同じ流量制限を、dev にも prod にも preview にも付けています。

<<< @/examples/20-shipping/infra/lib/ship-api-stack.ts{throttle}

ここで、名前で分けることの限界も書いておきます。stack を分けても、同じアカウントの中にいるかぎり、権限の壁はありません。さっき見たとおり、deploy role は「どの stack でも」更新できますし、cfn-exec role は管理者です。preview をデプロイできる job は、権限のうえでは prod も壊せます。本当に分けたいなら、アカウントを分けます。この本は 1 つのアカウントで通しているので、そこまでは実装していません。
