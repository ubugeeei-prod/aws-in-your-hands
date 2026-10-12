---
title: "57 Polly: 費用、注意点、片付け"
---

# 57 Polly: 費用、注意点、片付け

[前のページ](/ja/chapters/57-polly/build.md)までで、同じ文章を 1 回しか合成しない読み上げの API と、そのテストができました。このページでは、デプロイの手順、料金、AWS に送られるデータ、Cloudflare や Vercel との違い、注意点、片付けを扱います。

## デプロイして確かめる

<!-- section: 57.deploy -->

この節の手順は、実際の AWS では実行していません。

```bash
vp run polly:infra:diff
vp run polly:infra:deploy
```

デプロイすると、スタックの出力に `FunctionUrl`、`CacheBucketName`、`HandlerLogGroupName` が出ます。Polly を使い始めるための申し込みや有効化の手順は、読んだドキュメントの範囲には見当たりませんでした。

動作は、次のタスクで確かめます。**課金されます**。送るのは 70 文字ほどの短いノートです。

```bash
vp run polly:listen
```

スクリプトは、署名の無いリクエストが 403 で断られることを確かめたあと、同じノートを署名付きで 2 回送ります。ノートには実行した時刻を入れてあるので、1 回目は必ず新しい文章です。1 回目で `billedCharacters` が 0 より大きく、2 回目で 0 になり、すべての部分の `source` が `cache` であれば成功です。2 回目が合成されていたら、スクリプトは失敗で終わります。最後に、音声の URL を取りにいって、`Content-Type` と大きさを表示します。表示された URL をブラウザで開くと、声が聞けます。

`--voice Mizuki` を付けると、standard の声で試せます。1 回目の `billedCharacters` を、送った文章の文字数と比べてみてください。Polly が文字をどう数えるかが、そこで分かります。

同時に届いたリクエストの扱いは、2 つの端末から同じ瞬間に実行しても確かめにくいはずです。スクリプトが時刻を文章に入れるので、2 つの実行は別の文章になります。確かめるには、`scripts/listen.ts` の文章を固定の新しいものに書き換えてから、2 つ同時に実行し、関数のログの `synthesized` の合計を見ます。

ドリフトの検査は、ほかの章と同じです。

```bash
vp run polly:infra:drift
```

## 料金

<!-- section: 57.cost -->

金額は USD、東京リージョン、従量課金、税別です。計算の中身は[料金の計算](/ja/reference/pricing.md)にあります。

**誰も聞かない月の料金は 0 です。** 関数、function URL、空のバケット、Polly のどれにも、置いてあるだけでかかる料金はありません。スタックのテストは、時間や月で課金されるリソースの種類がテンプレートに無いことを確かめています。

Polly の単価は、東京リージョンで、neural が 1 文字あたり 0.000016（100 万文字で 16）、standard が 1 文字あたり 0.000004（100 万文字で 4）です（AWS Price List、2026-10-13 確認）。いちばん長いノート（題 120 文字、本文 10,000 文字）を neural で 1 回合成すると、10,120 × 0.000016 で、およそ 0.16 です。

聞かれた月の計算をしておきます。「聞く」が月に 1,000 回押され、ノートは平均 600 文字、そのうち 300 回はキャッシュにある文章だったと仮定します。

| 対象 | 数量 | 定価 | 毎月の無料枠の適用後 |
| --- | --- | --- | --- |
| Polly（neural） | 420,000 文字 | 6.72 | 6.72（無料枠は引いていない） |
| Lambda のリクエスト | 1,000 回 | 0.0002 | 0 |
| Lambda の実行時間 | 547.5 GB 秒 | 0.01 | 0 |
| S3 の PUT | 2,800 回 | 0.01 | 0.01 |
| S3 の HEAD と GET | 4,000 回 | 0.00148 | 0.00148 |
| S3 の保存 | 0.21 GB 月 | 0.01 | 0.01 |
| インターネットへの転送 | 0.3 GB | 0.03 | 0.03 |
| ログの取り込み | 0.00095 GB | 0.000722 | 0 |
| 小計 | | **6.78** | **6.77** |

小計と、0.01 以上の行は、セント未満を丸めた値です。S3 と転送の無料枠は確認できていないので、引いていません。

料金のほぼすべてが Polly です。キャッシュが効いているのは、Polly の行だけです。キャッシュが無ければ 1,000 回 × 600 文字で 9.60 かかるところが、6.72 になっています。同じノートが繰り返し聞かれるほど差は開き、誰も 2 回聞かなければ差はありません。standard の声なら、Polly の行は 420,000 × 0.000004 で 1.68 です。

この表の仮定のうち、計測したものは 1 つもありません。キャッシュに当たる割合、合成にかかる時間（3 秒）、音声の大きさ（1 回ぶん 0.3 MB）は、どれも置いた数字です。Polly が文字を数える方法も確認していないので、文章の 1 文字を 1 と数えています。日本語の 1 文字が 1 より多く数えられるなら、Polly の行はそのぶん増えます。

無料枠は引いていません。料金ページは、standard の声に月 500 万文字、neural の声に月 100 万文字（最初の 12 か月）の無料枠を挙げていますが、同じページに、2025 年 7 月 15 日以降に作ったアカウントは無料枠の代わりに credits を受け取るとあります。自分のアカウントがどちらなのかは、請求のコンソールで確かめてください。

料金ページには、合成した音声を保存して繰り返し再生しても追加の料金はかからない、と書いてあります。この章のキャッシュは、その使い方です。

## AWS に送られるもの、残るもの

<!-- section: 57.privacy -->

ノートは、人が自分のために書いた文章です。「聞く」ボタンを押すと、その文章がアプリの外に出ます。どこへ行き、どこに残るのかを整理しておきます。

**Polly へ送る文章。** 題と本文が、そのまま Polly に送られます。Polly の FAQ（2026-10-13 時点）は、Polly が処理した文章を保存し、サービスの提供と維持のほかに、Polly やほかの機械学習の技術の改善に使うことがある、としています。保存先は利用しているリージョンですが、改善のために別のリージョンに保存されることもある、とも書かれています。この利用を止めるには、AWS Organizations の AI services opt-out policy を使います。opt-out すると、改善のために保存されていた内容も削除されます。Organizations を使っていないアカウントでどうすればよいかは、FAQ がサポートへの連絡に触れている以上のことは確かめていません。

デベロッパーガイドのデータ保護のページは、自由に書ける欄に、顧客の口座番号のような機微な情報を入れないよう勧めています。入力した内容が診断用のログに取り込まれることがある、というのが理由です。ノートに何が書かれるかをアプリは選べないので、この注意は、利用者に伝える側に回ります。ボタンのそばに、文章が音声合成のサービスに送られることを書いておくのが、最低限の対応です。

**S3 に残る音声。** 音声は、ノートの内容を別の形で保存したものです。ノートを消しても、音声は合成されてから 30 日がたつまで残ります。キーはハッシュなので、ノートから音声をたどって消すことはできません。すぐに消す必要があるなら、ノートを消すときに同じ計算でキーを求めて削除するか、キャッシュの期間を短くします。前者は、ノートの本文を消す前に計算しなければならず、同じ文章を持つ別の利用者の音声も消えます。この章では作っていません。

**署名付き URL。** URL を知っていれば、期限（1 時間）のあいだ、誰でもその音声を聞けます。URL はレスポンスの本文にだけ入れ、ログには書いていません。

**ログ。** 関数のログに出るのは、声、部分の数、合成した数、課金された文字数、かかった時間です。ノートの文章は出ません。予期しないエラーも、名前だけを書きます。サービスのエラーメッセージには、送った文章の一部が引用されることがあるからです。テストは、ログとエラーのレスポンスにノートの文章が現れないことを確かめています。

## Cloudflare や Vercel から来た人へ

<!-- section: 57.platforms -->

以下は、2026-10-13 時点の公式ドキュメントの内容です。

Cloudflare の Workers AI には、音声合成のモデルが 4 つ載っています。Deepgram の `aura-1`、`aura-2-en`、`aura-2-es` と、MyShell の `melotts` です。`aura-2-en` の料金は 1,000 文字あたり 0.03 USD で、英語とスペイン語のモデルがあります。`melotts` は音声 1 分あたり 0.000205 USD で、言語を `lang` で指定します。既定は `en` で、対応する言語の一覧はモデルのページにありませんでした。日本語を読めるかどうかは確認していません。

Vercel について読んだのは、AI SDK のページです。AI SDK には `generateSpeech` があり、OpenAI などのプロバイダーの音声モデルを呼んで、音声のバイト列を受け取ります。Vercel 自身が音声合成のモデルを提供しているかどうかは、確かめていません。

Polly を選ぶ理由になるのは、日本語の声が用意されていること、SSML とレキシコンで読み方を直せること、非同期の合成が S3 に直接書いてくれることです。英語の文章を読ませるだけで、すでに Workers にアプリがあるなら、そちらで足ります。

この章の設計は、どのサービスでも変わりません。音声合成は呼ぶたびに料金がかかり、同じ入力の結果は使い回せます。キーを入力のハッシュにすること、合成の前に印を置くこと、利用者の文章を指示として解釈させないことは、R2 と Workers AI の組み合わせでも同じように必要です。R2 の条件付きの書き込みについては調べていません。

## つまずきやすいところ

| 症状 | 見るところ |
| --- | --- |
| `EngineNotSupportedException` | 声とエンジンの組み合わせが合っていません。Kazuha と Tomoko は neural だけ、Mizuki は standard だけです。`src/voices.ts` を、ドキュメントの声の一覧と見比べます |
| `TextLengthExceededException` | 部分が上限を超えています。この章の数え方ではまず起きないはずです。起きたら、Polly の数え方が `billedSize` の想定より大きいということなので、`MAX_BILLED_CHARACTERS` を下げます |
| `InvalidSsmlException` | 送った SSML が不正です。`escapeSsml` を通さずに文章を入れた箇所がないかを確かめます |
| 無いはずの音声に 403 が返る | ロールに `s3:ListBucket` がありません。S3 は、一覧の許可が無い相手には、無いキーを 404 ではなく 403 で答えます |
| いつまでも 503（busy）が返る | 印が残っていて、音声がありません。90 秒待てば、次のリクエストが引き継ぎます。それでも続くなら、関数のログでエラーを探します |
| 429（throttled）が返る | Polly のクォータに当たっています。neural は毎秒 8 リクエストです。長いノートを同時に何人もが初めて聞くと当たります |
| 音声の URL が 403 になる | 署名付き URL の期限（1 時間）が切れています。もう一度 `POST /speech` を呼びます。キャッシュにあるので、料金はかかりません |
| 文章を直していないのに、また課金された | 音声が 30 日のライフサイクルルールで消えています。空白や改行を変えただけでも、別の文章として扱われます |

## 本番にするなら

- 利用者の認証の後ろに置く。この章の function URL は、IAM の署名を持つ呼び出しだけを受け付けます。ブラウザから呼ぶなら、[06章](/ja/chapters/06-auth.md)のオーソライザーの後ろに置き、ノートの持ち主だけがそのノートを読み上げられるようにします
- 1 人が使える量を決める。サインインした利用者が、毎回違う 1 万文字を送り続ければ、1 回ごとに 0.16 USD かかります。[14章](/ja/chapters/14-kv-cache.md)のレート制限を利用者ごとにかけ、関数に予約済み同時実行数を設定します（[32章](/ja/chapters/32-limits.md)）
- 文字数にアラームを付ける。Polly は `AWS/Polly` の名前空間に `RequestCharacters` を出しています。1 日の合計にしきい値を置けば、料金が増え始めたことに早く気づけます。アラームの作り方は [19章](/ja/chapters/19-observability.md)にあります
- 文章の利用について決める。Organizations を使っているなら、AI services opt-out policy を設定するかどうかを決めます
- 音声を残す期間を、ノートの削除の方針に合わせる。利用者に「消したら消える」と約束しているなら、30 日は長すぎます
- バケットとロググループを残す設定にする。練習用なので、どちらもスタックと一緒に消える設定です。キャッシュのバケットは消えても作り直せますが、消えた直後は、すべての文章にもう一度料金がかかります
- 声を変えるときの費用を見積もる。既定の声を変えると、すべての文章のキーが変わり、キャッシュは空の状態から始まります

## 片付け

<!-- section: 57.cleanup -->

```bash
vp run polly:empty
vp run polly:empty --yes
vp run polly:infra:destroy
```

cdkd は、空でないバケットを削除しません。先に `polly:empty` でバケットを空にします。`--yes` を付けないと、数を数えるだけで何も消しません。

消えるのは、バケット、関数、ロール、function URL、ロググループです。キャッシュしていた音声とログも一緒に消えます。Polly の側に、消すべきリソースはありません。レキシコンも非同期のタスクも作っていないからです。Polly が改善のために保存した文章があるとすれば、スタックを消しても残ります。消すには、前の節に書いた opt-out が要ります。

ほかに残るのは、cdkd の bootstrap で作った保存場所だけです（02章）。

## 分散システムとして見ると

- 状態の持ち主: 音声の持ち主は S3 のバケットです。関数は何も覚えていません。バケットを空にしても失われるのは料金だけで、次のリクエストが作り直します
- 不変条件: 同じ入力（エンジン、声、形式、SSML）に対する合成は 1 回。同時に何件届いても、です
- 不変条件を壊そうとするテスト: 同時の 2 件と 10 件、合成の失敗、印を置いたままの停止、古い印の同時の引き継ぎ、読めない印、待っているあいだに消えた印を、決まった順序で再現しています
- 保証していないこと: 合成が終わってから音声を書くまでのあいだに関数が止まると、同じ文章にもう一度料金がかかります。30 日たって音声が消えたあとも、もう一度かかります
- 調停しているもの: 2 つのリクエストのどちらが合成するかを決めているのは、関数ではなく S3 の条件付きの書き込みです。関数どうしは、互いの存在を知りません
- 時計: 印が古いかどうかは、読んだ関数の時計で決めています。関数のタイムアウトとの差（30 秒）が、ずれの余裕です
- 確かめていないこと: ここまでの保証は、S3 がドキュメントどおりに条件を裁くことに頼っています。実際の S3 では試していません

::: details この章の検証メモ

**手元で確かめたこと。** ユニットテスト 72 件（SSML のエスケープとタグの混入、分割、キャッシュのキー、同時のリクエストと失敗と引き継ぎの再現、ルート、ログに文章が出ないこと、再生の順序、S3 と Polly へのリクエストの形、スタックの assertion）。型検査。`polly:infra:synth` で、テンプレートが AWS に問い合わせずに生成されること（esbuild のバンドル込み）。`SPEECH_BACKEND=fake` で開発サーバーを起動し、`curl` で同じノートを 2 回送って、2 回目が `cache` になり、URL から WAV が返ること。`vp check --fix` を自分のファイルにかけ、awscdk-lint を含めて警告が出ないこと。

**まだ確かめていないこと。** AWS では何も実行していません。Polly は 1 回も呼んでいません。とくに次の点は、ドキュメントから読み取っただけです。

- 声の聞こえ方、合成にかかる時間、返ってくる MP3 の大きさ。料金の表の 3 秒と 0.3 MB は仮定です
- Polly が文字をどう数えるか。日本語の 1 文字、エスケープした `&amp;`、改行が、それぞれいくつと数えられるかは分かっていません。分割は、いちばん大きく数えた場合に合わせてあります
- XML に書けない文字や、日本語の声に渡した英単語を、Polly がどう扱うか
- S3 の条件付きの書き込みの実際の動き。同時の `If-None-Match` と `If-Match` のうち 1 つだけが通ること、負けた側に返るエラーの形、SDK が 409 を自分で再試行するかどうか
- `polly:SynthesizeSpeech` を、レキシコンの ARN に絞れるかどうか。絞れなかった場合に備えて `*` にしてあります
- cdkd でのデプロイ、function URL の署名の検査、ライフサイクルルールが実際に消すまでの時間
- `src/player.ts` のブラウザでの動作。`audio` 要素が署名付き URL の音声を再生できること、部分のつなぎ目の聞こえ方
- `SPEECH_BACKEND=polly` での手元のサーバー
- 料金の仮定。聞かれる回数、キャッシュに当たる割合、ログの量
- Polly の利用開始に、申し込みや有効化が要るかどうか
- CloudFormation にレキシコンのリソースがあるかどうか

**コードの場所。**

| 節 | ファイル | タスク |
| --- | --- | --- |
| Polly でできること | `examples/57-polly/src/voices.ts` | |
| キャッシュのキー | `examples/57-polly/src/cache-key.ts`、`src/audio-cache.ts`、`test/cache-key.test.ts` | `test:unit` |
| 1 つの文章に、合成は 1 回 | `examples/57-polly/src/speak.ts`、`src/s3-audio-cache.ts`、`test/naive.ts`、`test/speak.test.ts`、`test/adapters.test.ts` | `test:unit` |
| 長いノートを分ける | `examples/57-polly/src/chunk.ts`、`test/chunk.test.ts` | `test:unit` |
| 利用者の文章を SSML に入れる | `examples/57-polly/src/ssml.ts`、`test/ssml.test.ts` | `test:unit` |
| ルート | `examples/57-polly/src/app.ts`、`src/contract.ts`、`src/polly.ts`、`src/player.ts`、`test/app.test.ts`、`test/player.test.ts` | `test:unit` |
| スタック | `examples/57-polly/infra/lib/polly-stack.ts`、`infra/bin/app.ts`、`src/lambda.ts`、`infra/test/polly-stack.test.ts` | `test:unit`、`polly:infra:synth` |
| 手元で動かす | `examples/57-polly/src/dev.ts`、`src/fake-synthesizer.ts`、`src/memory-audio-cache.ts` | `dev:polly` |
| デプロイして確かめる | `examples/57-polly/scripts/listen.ts` | `polly:infra:diff`、`polly:infra:deploy`、`polly:listen`、`polly:infra:drift` |
| 料金 | `data/pricing/` | |
| 片付け | `examples/57-polly/scripts/empty.ts` | `polly:empty`、`polly:infra:destroy` |

**cdkd（0.296.28）での扱い。** 導入されているパッケージの `dist` で、専用の実装が登録されていることを確かめたもの: `AWS::S3::Bucket`、`AWS::S3::BucketPolicy`、`AWS::Lambda::Function`、`AWS::Lambda::Url`、`AWS::Logs::LogGroup`、`AWS::IAM::Role`、`AWS::IAM::Policy`。このスタックに、Cloud Control API 経由になる種類はありません。

**一次情報**（確認日はすべて 2026-10-13）

- Polly デベロッパーガイド: [Quotas in Amazon Polly](https://docs.aws.amazon.com/polly/latest/dg/limits.html)、[Available voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)、[Neural voices](https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html)、[Generative voices](https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html)、[Long-form voices](https://docs.aws.amazon.com/polly/latest/dg/long-form-voices.html)、[Long audio files](https://docs.aws.amazon.com/polly/latest/dg/asynchronous.html)、[Setting up the IAM policy for asynchronous synthesis](https://docs.aws.amazon.com/polly/latest/dg/asynchronous-iam.html)、[Speech marks](https://docs.aws.amazon.com/polly/latest/dg/speechmarks.html)、[Speech mark output](https://docs.aws.amazon.com/polly/latest/dg/output.html)、[Managing lexicons](https://docs.aws.amazon.com/polly/latest/dg/managing-lexicons.html)、[Integrating CloudWatch with Amazon Polly](https://docs.aws.amazon.com/polly/latest/dg/cloud-watch.html)、[Data Protection in Amazon Polly](https://docs.aws.amazon.com/polly/latest/dg/data-protection.html)
- SSML: [Generating speech from SSML documents](https://docs.aws.amazon.com/polly/latest/dg/ssml.html)、[Supported SSML tags](https://docs.aws.amazon.com/polly/latest/dg/supportedtags.html)、[Reserved characters in SSML](https://docs.aws.amazon.com/polly/latest/dg/escapees.html)、[Adding a pause](https://docs.aws.amazon.com/polly/latest/dg/break-tag.html)
- API: [SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/dg/API_SynthesizeSpeech.html)、[StartSpeechSynthesisTask](https://docs.aws.amazon.com/polly/latest/dg/API_StartSpeechSynthesisTask.html)、[StartSpeechSynthesisStream](https://docs.aws.amazon.com/polly/latest/dg/API_StartSpeechSynthesisStream.html)
- IAM: [How Amazon Polly works with IAM](https://docs.aws.amazon.com/polly/latest/dg/security_iam_service-with-iam.html)、[Polly の service reference（JSON）](https://servicereference.us-east-1.amazonaws.com/v1/polly/polly.json)
- 料金とデータの扱い: [Amazon Polly Pricing](https://aws.amazon.com/polly/pricing/)、[Amazon Polly FAQs](https://aws.amazon.com/polly/faqs/)、[AI services opt-out policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html)、[AWS Price List: AmazonPolly（東京）](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonPolly/current/ap-northeast-1/index.json)（Lambda、S3、転送、ログの単価は、04章、07章、19章で確認したものを使っています）
- S3: [How to prevent object overwrites with conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- XML: [XML 1.0 の Characters の節](https://www.w3.org/TR/xml/#charsets)
- パッケージ: [@aws-sdk/client-polly 3.1149.0](https://registry.npmjs.org/@aws-sdk/client-polly/3.1149.0)、[@go-to-k/cdkd 0.296.28](https://registry.npmjs.org/@go-to-k/cdkd/0.296.28)（導入されている `dist` を読みました）
- Cloudflare: [Workers AI: Models](https://developers.cloudflare.com/workers-ai/models/)、[melotts](https://developers.cloudflare.com/workers-ai/models/melotts/)、[aura-2-en](https://developers.cloudflare.com/workers-ai/models/aura-2-en/)
- Vercel: [AI SDK: Speech](https://ai-sdk.dev/docs/ai-sdk-core/speech)
- ブラウザ: MDN の [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) と [SpeechSynthesisVoice.localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService)（ページの元になっている Markdown を読みました）

:::
