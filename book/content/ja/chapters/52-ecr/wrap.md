---
title: "52 ECR: 費用、注意点、片付け"
---

# 52 ECR: 費用、注意点、片付け

[前のページ](/ja/chapters/52-ecr/build.md)までで、リポジトリの設定と、それを支える関数を書きました。このページでは、デプロイして確かめる手順、料金、つまずきやすいところ、本番で変えること、片付けをまとめます。デプロイの手順は用意しただけで、実行していません。

## デプロイして確かめる

<!-- section: 52.deploy -->

リポジトリだけなら、何も渡さずにデプロイします。料金はかかりません。

```bash
vp run ecr:infra:diff
vp run ecr:infra:deploy
```

CI からプッシュするロールも作るときは、GitHub のリポジトリを渡します。先に、[20章](/ja/chapters/20-shipping.md)の CI 用のスタックで、GitHub の OIDC プロバイダーがアカウントにできている必要があります。プロバイダーが無いと、ロールを引き受けられません。プロバイダーが無い状態でロールの作成そのものが通るかどうかは、確かめていません。

```bash
vp run ecr:infra:deploy -c githubRepository=owner/repo -c pullThroughCache=on
```

出力は `RepositoryUri`、`RepositoryName`、`PushRoleArn` の 3 つです。

イメージは、12章のタスクで作ってプッシュします。Docker のデーモンが要るのは、この手順です。12章のプッシュ用のタスクは、`--repository-uri` を渡すと、12章のスタックではなく、指定したリポジトリにプッシュします。

```bash
vp run ecs:bundle
vp run ecs:image:build sha-0123abc
vp run ecs:image:push sha-0123abc --repository-uri <RepositoryUri>
```

同じタグでもう一度、別のイメージをプッシュしてみてください。immutable なリポジトリなら、`ImageTagAlreadyExistsException` で拒否されるはずです。

プッシュしたイメージのダイジェストは、リポジトリに聞きます。

```bash
aws ecr describe-images --region ap-northeast-1 \
  --repository-name <RepositoryName> \
  --image-ids imageTag=sha-0123abc \
  --query 'imageDetails[0].imageDigest' --output text
```

検査の結果でデプロイを止めるかどうかは、次のタスクで判定します。検査が終わるまで 5 秒おきに最大 60 回待ち、しきい値（既定は `HIGH`）以上の結果があるか、検査が終わらなければ、0 以外で終了します。待つのは状態が `COMPLETE` になるまでなので、basic scanning 用です。enhanced scanning の継続的な検査では、状態が `ACTIVE` になります。

```bash
vp run ecr:scan:gate --digest sha256:...
```

イメージがいくつか溜まったら、ライフサイクルポリシーを ECR に評価させて、この章の evaluator と比べます。このタスクは、ECR の lifecycle policy preview を始め、終わるのを待ち、消される予定のイメージとルールの番号を、手元の結果と突き合わせます。preview は結果を返すだけで、イメージを消しません。

```bash
vp run ecr:lifecycle:compare
```

食い違いが出たら、正しいのは ECR のほうです。evaluator を直し、その入力をテストに足してください。

CI では、ワークフローが 20章と同じやり方で `PushRoleArn` のロールを引き受け、12章と同じ手順でログインしてプッシュします。この章には、ワークフローのファイルを置いていません。プッシュ用のロールは cdkd の state を読めないので、`ecr:scan:gate` には `--repository-name` でリポジトリの名前を渡します。

設定が手で変えられていないかは、ドリフトの検査で確かめます。タグの設定が `MUTABLE` に戻されていれば、ここで見つかります。

```bash
vp run ecr:infra:drift
```

## 料金

<!-- section: 52.cost -->

単価は、2026-10-13 に AWS Price List の bulk API で確かめた、東京リージョンのものです。

ECR の料金は、保存量とデータ転送の 2 つです。保存は 1 GB あたり月 USD 0.10 で、リポジトリの数や、プッシュと取得の回数には料金がかかりません。データ転送は、プッシュ（入ってくる方向）が無料で、同じリージョンの Fargate、Lambda、EC2 からの取得も 1 GB あたり USD 0.00 です。料金がかかるのは、リージョンの外へ出る転送です。GitHub のランナーのように AWS の外からイメージを取得すると、インターネットへのデータ転送として、最初の 10 TB までは 1 GB あたり USD 0.114 かかります。

以下の金額は、イメージ 1 つを 0.15 GB と仮定して計算しています。イメージはビルドしていないので、この大きさは計測した値ではありません。イメージどうしで共有されるレイヤーが保存量にどう数えられるかも確認していないので、イメージごとに全量を数えています。

| 状態 | 仮定 | 月額 |
| --- | --- | --- |
| スタックを置いただけ | イメージなし | USD 0.00 |
| ポリシーが残す上限まで溜まった | 50 個、7.5 GB | USD 0.75 |
| ポリシーなしで 1 年たった | 平日に 1 日 5 回プッシュ、1,200 個、180 GB | USD 18.00 |

3 行目は、1 年たった時点の 1 か月ぶんで、何もしなければ翌月はさらに増えます。金額としては小さく見えますが、誰も消さないイメージの費用は、止めるまで増え続け、数が増えるほど「どれを消してよいか」が分からなくなります。ライフサイクルポリシーは、リポジトリを作るときに一緒に付けるものです。

オプションごとの料金は次のとおりです。

- enhanced scanning: Inspector の料金で、最初の検査が 1 イメージ USD 0.11、検査し直しが 1 回 USD 0.01。月に 100 回プッシュし、残っている 50 個が月に 4 回ずつ検査し直されると仮定すると、月 USD 13.00。検査し直しの回数は新しい脆弱性の公表しだいで、4 回という数に根拠はありません。basic scanning には、料金の記載が見つかりませんでした
- 複製: 転送元のリージョンの、リージョン間のデータ転送の料金。大阪へ月に 100 個（15 GB）複製すると、月 USD 1.35。複製先の保存料金は別にかかります。大阪の単価は確かめていません
- pull through cache: ルールそのものに料金の記載は見つかりませんでした。写しは自分のリポジトリに保存されるので、その保存量に料金がかかります。Docker Hub などを上流にするときのシークレットは、1 つにつき月 USD 0.40 です（21章）
- 署名: managed signing は、署名 1 回につき USD 0.02
- アーカイブ: 東京リージョンでは、アーカイブ用のストレージも 153,600 GB までは 1 GB あたり月 USD 0.10 で、通常の保存と同じ単価です。取り出しには 1 GB あたり USD 0.03 がかかり、最低 90 日ぶんの保存料金も請求されます。この本の規模では、アーカイブにして安くなることはありません

無料枠は引いていません。料金のページには、新規の利用者向けに、プライベートリポジトリの保存 500 MB を 1 年間、という枠が書かれていますが、すべてのアカウントに当てはまるものではありません。Inspector には新規のアカウント向けのトライアルがありますが、月ごとの無料枠ではありません。

スタックを消したあとは、USD 0 です。ただし、pull through cache が作ったリポジトリはスタックの外にあるので、消さなければ保存料金が残ります。

## つまずきやすいところ

<!-- section: 52.pitfalls -->

**ポリシーを付けたのに、イメージが消えない。** ライフサイクルポリシーによる削除は、条件を満たしてから 24 時間以内に行われます。すぐには消えません。反対に、付けた直後に大量に消えることもあります。適用の前に preview で確かめる理由です。

**`v*` が思わぬタグに一致する。** `v*` は `v1.2.0` だけでなく、`vendor-test` にも一致します。この章のポリシーでは、そうしたイメージもリリースとして数えられ、本物のリリースが 20 個の枠から押し出されます。タグの付け方を決めたら、ほかの付け方をしないことが前提です。

**タグの無いイメージを消すルールが、動いているイメージを消す。** 12章のように 1 つのアーキテクチャのイメージだけをプッシュしているなら、タグの無いイメージは、タグを失ったものです。複数のアーキテクチャをまとめたイメージでは、アーキテクチャごとのイメージにはタグが付かず、manifest list から参照されます。ドキュメントによると、参照されているイメージは manifest list より先には消されません。この章の evaluator はこの規則を実装していないので、そうしたリポジトリでは、手元の結果が実際より多くなります。

**検査の結果が見つからない。** 検査が一度も走っていないイメージに `DescribeImageScanFindings` を呼ぶと、`ScanNotFoundException` が返ります。scan on push を付ける前にプッシュしたイメージが、これに当たります。enhanced scanning を有効にしたレジストリでは、フィルターに一致しないリポジトリは検査されず、手動の検査もできません。

**basic と enhanced を切り替えると、前の結果が見えなくなる。** ドキュメントに、切り替えると以前の検査は使えなくなる、とあります。元に戻せば、また見えるようになります。

**pull through cache 経由の最初の取得が失敗する。** 取得するロールに `ecr:BatchImportUpstreamImage` と `ecr:CreateRepository` が無いか、インターネットへの経路が無い場所から最初の取得をしている可能性があります。

**ログインできない。** `ecr:GetAuthorizationToken` は、リポジトリポリシーでは許可できません。IAM のポリシーで、対象を `*` にして許可します。

## 本番にするなら

<!-- section: 52.production -->

- **リポジトリを残す設定にする。** 練習用に `RemovalPolicy.DESTROY` と `emptyOnDelete: true` にしてあります。本番では `RETAIN` にし、`emptyOnDelete` を外します。スタックを消しただけで、動いているイメージが消える設定は危険です
- **タスク定義はダイジェストで指す。** リリースごとにダイジェストを記録し、デプロイの設定にはその値を渡します。ロールバックは、前のダイジェストを渡し直すことです
- **本番で動いているダイジェストを、ライフサイクルの確認に渡す。** `ecr:lifecycle:preview` の `--in-use` は、そのための引数です。ポリシーを変えるプルリクエストの CI で、実際のイメージの一覧に対して走らせます
- **検査をレジストリの設定にし、プッシュのあとも続ける。** 本番で動かすリポジトリは enhanced scanning の継続的な検査にし、Inspector のイベントを通知につなぎます。プッシュのときの判定は、入口を 1 回見張るだけです
- **ビルドするアカウントと動かすアカウントを分ける。** 本番のアカウントからは、複製かリポジトリポリシーでイメージを受け取ります。本番のアカウントでは、誰もプッシュできないようにできます
- **キャッシュが作るリポジトリの設定を決めておく。** repository creation template で、ライフサイクルポリシーを付けます。付けなければ、ベースイメージの古い写しが溜まっていきます
- **クォータを知っておく。** 1 つのリポジトリに置けるイメージは 100,000 個（引き上げ可）、`PutImage` はリージョンごとに毎秒 10 回（引き上げ可）、ライフサイクルポリシーのルールは 50 個までです（2026-10-13 時点）。上限の見方は [32章](/ja/chapters/32-limits.md)にあります

## 片付け

<!-- section: 52.cleanup -->

```bash
vp run ecr:infra:destroy
```

リポジトリは、中のイメージごと消えます。`emptyOnDelete: true` にしてあるからで、固定した版の cdkd は、この設定があるときに限って、イメージの入ったリポジトリを消します。

スタックを消しても残るものが、3 つあります。

1 つ目は、pull through cache が作ったリポジトリです。`ecr-public/` で始まる名前のリポジトリが残っていないかを確かめ、あれば消します。

```bash
aws ecr describe-repositories --region ap-northeast-1 \
  --query 'repositories[].repositoryName'
aws ecr delete-repository --region ap-northeast-1 \
  --repository-name ecr-public/docker/library/node --force
```

2 つ目は、pull through cache のルールを作ったときに ECR が自動で作るサービスリンクロールです。料金はかかりません。

3 つ目は、20章の OIDC プロバイダーと、cdkd の bootstrap で作った保存場所です。どちらもこの章のものではないので、消すならそれぞれの章の手順に従ってください。

## 分散システムとして見ると

<!-- section: 52.distributed -->

- 状態の持ち主: 「このタグはどのイメージか」を持っているのはリポジトリです。「何を動かすか」を持っているのはタスク定義で、ECS のサービスは、デプロイのたびに解決したダイジェストを持ちます。3 か所が別々に変わるので、名前で指しているかぎり、どの時点の答えを使っているかで結果が変わります
- 不変条件: タスク定義が指しているイメージが、実際に動くイメージである
- 不変条件を壊そうとするテスト: 2 回の取得のあいだにタグを動かす、タグを動かしてからロールバックする、指しているイメージを消してから同じタグを付け直す、の 3 つを、リポジトリのモデルの上で決まった順序で再現しています
- ダイジェストが保証しないこと: ダイジェストは「別のものが動かない」ことを保証しますが、「そのイメージがまだある」ことは保証しません。ライフサイクルポリシーは、タスク定義を知らずにイメージを消します。2 つを結びつけているのは、リリースのタグを付けるという運用の約束だけです
- 遅れ: 複製はほとんどが 30 分以内ですが、上限は書かれていません。pull through cache の写しは、最大で 24 時間、上流より古いことがあります。ライフサイクルポリシーによる削除は 24 時間以内です。どれも「いずれそうなる」という種類の保証です
- 検査の時点: プッシュのときの検査は、その時点の脆弱性のデータベースに対する答えです。イメージは変わらなくても、答えは古くなります
- 届かないかもしれない知らせ: ECR のイベントは best effort です。プッシュや検査のイベントで次の処理を始める構成では、イベントが来なかったときに気づく手段を別に持ちます

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 60 件（参照の読み書き、ワイルドカード、タグの設定の 4 つの値、タグが動いたときの 2 つの壊れ方と 2 つの直し方、ドキュメントの 6 つの例の再現、この章のポリシー、スキーマが拒否するポリシー、デプロイの判定、`describe-images` の読み取り、preview との突き合わせ、スタックの assertion）。型検査。`ecr:lifecycle:preview` の出力。`ecr:infra:synth` で、既定の構成と、`-c githubRepository=example/notes -c pullThroughCache=on` を渡した構成のテンプレートが、AWS に問い合わせずに生成されること。`vp check --fix` を自分のファイルにかけ、awscdk-lint を含めて警告が出ないこと。`public.ecr.aws/docker/library/node:24-bookworm-slim` が存在すること（認証なしのマニフェストの要求。AWS の認証情報は使っていません）。

**まだ確かめていないこと。** AWS では何も実行していません。イメージは 1 つもビルドしておらず、プッシュもしていません。とくに次の点は、ドキュメントから読み取っただけです。

- ライフサイクルポリシーの評価。`src/lifecycle.ts` は、ドキュメントの評価規則と 6 つの例から書いたもので、ECR の preview とは比べていません。「N 日より古い」の境界、プッシュの時刻が同じイメージの順序は、ドキュメントに記述が見つかりませんでした。ドキュメントの「all images」の例 B は、同じ「1 日前」の 2 つのイメージのうち片方を消していて、テストでは、消されないほうを少し新しいものとして置いています
- リポジトリのモデルの仮定。タグを付け替えると元のイメージがタグなしで残ること、同じダイジェストに 2 つ目のタグを付けられること、イメージを消すとそのタグをまた使えることは、`src/registry.ts` の仮定で、実物では確かめていません
- タグの設定の例外フィルターで、`*` が空の文字列に一致するかどうか
- immutable なリポジトリが、同じタグの再プッシュを `ImageTagAlreadyExistsException` で拒否すること
- 検査。scan on push が走ること、結果が無いときの `findingSeverityCounts` の形、検査にかかる時間、12章のベースイメージが basic scanning の対応 OS に入っているか
- ECS の circuit breaker によるロールバックが、前に解決したダイジェストを使うのか、タグを解決し直すのか
- cdkd でのデプロイ。とくに `AWS::ECR::PullThroughCacheRule` が Cloud Control API 経由で作れること
- GitHub Actions からプッシュ用のロールを引き受けて、プッシュできること。OIDC プロバイダーが無いアカウントで、ロールの作成が通るかどうか
- pull through cache 経由の取得と、そのときにできるリポジトリ
- 複製、別アカウントからの取得、署名。スタックに入れておらず、ドキュメントを読んだだけです。署名を検証する側の設定は、読み切れていません
- 料金の仮定。イメージの大きさ、プッシュの回数、検査し直しの回数は、どれも計測していません。共有されるレイヤーの数え方は確認していません
- Cloudflare のレジストリに、ライフサイクルや検査にあたる設定があるかどうか

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| タグは名前、ダイジェストは中身 | `examples/52-ecr/src/reference.ts`、`src/registry.ts`、`test/invariant.test.ts` | `test:unit` |
| リポジトリの設定 | `examples/52-ecr/infra/lib/ecr-stack.ts`、`src/mutability.ts`、`test/mutability.test.ts` | `test:unit` |
| ライフサイクルポリシー | `examples/52-ecr/src/lifecycle.ts`、`src/policy.ts`、`src/wildcard.ts`、`test/lifecycle.test.ts` | `test:unit`、`ecr:lifecycle:preview` |
| 脆弱性の検査 | `examples/52-ecr/src/scan.ts`、`test/scan.test.ts`、`scripts/scan-gate.ts` | `test:unit`、`ecr:scan:gate` |
| pull through cache | `examples/52-ecr/infra/lib/ecr-stack.ts`、`src/config.ts` | `test:unit` |
| CI からのプッシュ | `examples/52-ecr/infra/lib/ecr-stack.ts`、`infra/bin/app.ts`、`infra/test/ecr-stack.test.ts` | `test:unit`、`ecr:infra:synth` |
| 手元で確かめる | `examples/52-ecr/scripts/lifecycle-preview.ts`、`src/describe.ts`、`fixtures/`、`test/describe.test.ts` | `ecr:lifecycle:preview` |
| デプロイして確かめる | `examples/52-ecr/scripts/lifecycle-compare.ts`、`scripts/scan-gate.ts` | `ecr:infra:diff`、`ecr:infra:deploy`、`ecr:lifecycle:compare`、`ecr:scan:gate`、`ecr:infra:drift` |
| 料金 | `data/pricing/` | |
| 片付け | `tools/src/infra/` | `ecr:infra:destroy` |

**cdkd（0.296.28）での扱い。** インストールした npm のパッケージの `dist/` を読みました。`AWS::ECR::Repository` と `AWS::IAM::Role` には専用の実装があり、ECR のプロバイダーは、タグの設定とその例外フィルター、検査の設定、ライフサイクルポリシー、`EmptyOnDelete` を扱っています。`AWS::ECR::PullThroughCacheRule` はパッケージのどこにも出てこないので、専用の実装も、未対応の一覧への登録もありません。12章で確かめた読み方に従えば、Cloud Control API を経由します。

**一次情報**（確認日はすべて 2026-10-13）

- タグと暗号化とポリシー: [Preventing image tags from being overwritten](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)、[PutImageTagMutability](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_PutImageTagMutability.html)、[ImageTagMutabilityExclusionFilter](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_ImageTagMutabilityExclusionFilter.html)、[Encryption at rest](https://docs.aws.amazon.com/AmazonECR/latest/userguide/encryption-at-rest.html)、[Private repository policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policies.html)、[Private repository policy examples](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html)、[Private registry permissions](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry-permissions.html)
- ライフサイクル: [Automate the cleanup of images by using lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html)、[Lifecycle policy properties](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_parameters.html)、[Examples of lifecycle policies](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lifecycle_policy_examples.html)、[Creating a lifecycle policy preview](https://docs.aws.amazon.com/AmazonECR/latest/userguide/lpp_creation.html)
- 検査: [Scan images for software vulnerabilities](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html)、[basic scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-basic.html)、[enhanced scanning](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning-enhanced.html)、[DescribeImageScanFindings](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_DescribeImageScanFindings.html)、[ImageScanStatus](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_ImageScanStatus.html)、[PutImageScanningConfiguration](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_PutImageScanningConfiguration.html)、[Amazon ECR events and EventBridge](https://docs.aws.amazon.com/AmazonECR/latest/userguide/ecr-eventbridge.html)
- pull through cache と複製: [Sync an upstream registry with an Amazon ECR private registry](https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache.html)、[Creating a pull through cache rule](https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache-creating-rule.html)、[IAM permissions required](https://docs.aws.amazon.com/AmazonECR/latest/userguide/pull-through-cache-iam.html)、[Private image replication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/replication.html)、[Docker Hub pull usage and limits](https://docs.docker.com/docker-hub/usage/pulls/)、[ECR Public のマニフェスト](https://public.ecr.aws/v2/docker/library/node/manifests/24-bookworm-slim)（トークンを付けて要求）
- プッシュと署名: [IAM permissions for pushing an image](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html)、[Sign images in Amazon ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-signing.html)、[Managed signing](https://docs.aws.amazon.com/AmazonECR/latest/userguide/managed-signing.html)
- ECS: [Deploy Amazon ECS services by replacing tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)（Container image resolution の節）
- クォータと料金: [Amazon ECR service quotas](https://docs.aws.amazon.com/AmazonECR/latest/userguide/service-quotas.html)、[Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/)（テキストとして読んだため、単価の表は読み取れていません）
- AWS Price List bulk API: [ECR](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECR/current/ap-northeast-1/index.json)、[Inspector](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonInspectorV2/current/ap-northeast-1/index.json)（データ転送と Secrets Manager の単価は、ほかの章で確認したものを使っています）
- AWS CLI 2.35.11 に入っている ECR のサービスモデル（[service-2.json](https://github.com/aws/aws-cli/blob/2.35.11/awscli/botocore/data/ecr/2015-09-21/service-2.json) と waiters-2.json）。Nix の shell に入っている写しを読みました。lifecycle policy preview の API の形、検査の状態と重大度の値、waiter の間隔と回数は、ここから取りました
- 固定した版のパッケージ: aws-cdk-lib 2.273.0（`aws-ecr` と `aws-ecs` の型とコード）、[@go-to-k/cdkd 0.296.28](https://www.npmjs.com/package/@go-to-k/cdkd/v/0.296.28)
- Cloudflare: [Containers: image management](https://developers.cloudflare.com/containers/platform-details/image-management/)

:::
