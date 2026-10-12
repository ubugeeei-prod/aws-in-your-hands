---
title: "07 File Upload: デプロイ"
---

# 07 File Upload: デプロイ

## AWS にのせる準備

<!-- section: 07.infra -->

stack（`AihUploads`）は、06章の stack に、bucket を 1 つ、権限を 2 つ、route を 4 つ足したものです。

### bucket

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-bucket}

Block Public Access は、4 つの設定を全部有効にしています。ACL でも bucket policy でも、この bucket の object は公開できません。presigned URL は「公開」ではなく、role が署名したリクエストなので、この設定の下でも使えます。

CORS は、origin を 2 つ（デプロイした SPA と、手元の開発サーバー）、method を `POST` だけにしています。ブラウザの JavaScript が、別の origin への POST の結果を読むために要ります。`<img>` で画像を表示するのに CORS の規則は要らないので、`GET` は入れていません。

lifecycle rule は 2 つ。1 つは、さっきの pending の掃除です。もう 1 つは、未完了の multipart upload の中止。multipart upload は、大きな object を分割して送る仕組みで、完了も中止もされなかった part は、保存されたまま料金がかかり続けます。この章のアプリは multipart upload を始めません。それでも入れてあるのは、公式ドキュメントがこの規則を勧めているのと、あとで大きなファイルに対応したときに忘れないためです。

`removalPolicy` は `DESTROY` です。stack を消すと、空にした bucket が消えます。

### 関数にできること

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{uploads-role}

関数に許すのは、`u/` で始まる key への 5 つの操作です。`s3:PutObject` と `s3:PutObjectTagging` は、関数自身は呼びません。ブラウザのアップロードが、関数の署名を使って実行します。署名した role に権限がなければ、許可証は使えません。

`s3:ListBucket` は、一覧のためではありません。公式ドキュメントによると、存在しない key への `HeadObject` は、呼び出し側にこの権限があれば 404、なければ 403 を返します。403 では、「まだ送られていない」と「権限がない」の区別がつきません。

<<< @/examples/07-uploads/infra/lib/uploads-stack.ts{routes}

テストは、template に対して次を確かめます。

- 2 つの bucket がどちらも、Block Public Access の 4 つの設定を有効にしている
- アップロード用の bucket の policy に、`Allow` が 1 つもない
- CORS の規則が 1 つで、method が `POST` だけ、`*` を含まない
- lifecycle rule が、pending の tag と multipart upload の 2 つである
- 関数の S3 の権限が、上の 6 つの操作だけで、`*` の action も `*` の resource もない
- `/health` 以外のすべての route に、足した 4 つも含めて、JWT authorizer と scope が付いている

使っているリソースの種類は、06章と同じ 19 種類です。アップロード用の bucket は、新しい種類を足しません。固定した版の cdkd は、`AWS::S3::Bucket` に専用の実装を持っていて、lifecycle と CORS の設定を扱うコードがあることを、パッケージの中で確かめました。専用の実装がない 3 種類（`AWS::CloudFront::Function`、`AWS::Cognito::UserPoolClient`、`AWS::Cognito::UserPoolDomain`）は、06章と同じです。

## デプロイする

<!-- section: 07.deploy -->

ここから先は、実行していません。手順とタスクを用意したところまでです。

```bash
vp run uploads:infra:diff
vp run uploads:infra:deploy
vp run uploads:user:create you@example.com
vp run uploads:publish
vp run uploads:smoke:web
vp run uploads:smoke:api
```

流れは 06章と同じです。違うのは `uploads:smoke:api` で、環境変数 `AIH_ACCESS_TOKEN` に access token を入れて実行すると、本物の bucket に対して次を試します。

- 大きすぎるファイル、違う `Content-Type`、違う key の 3 つを、S3 が拒否すること
- 小さな PNG が送れて、完了できて、一覧に出ること
- 返ってきた URL が、token なしで画像を返すこと
- 削除すると、同じ URL が画像を返さなくなること

この章の「まだ」は、ほとんどこのタスクで確かめられます。token を入れなかった場合は、token なしのリクエストが拒否されることだけを確かめて、「アップロードの経路は確かめていない」と表示します。

06章の stack（`AihNotesApp`）とは、別の stack です。user pool も table も別なので、両方をデプロイすると、利用者もノートも別々になります。

drift の検査は、これまでと同じです。

```bash
vp run uploads:infra:drift
```
