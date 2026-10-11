---
title: Cloudflare から来た人へ
revision: 1
---

# Cloudflare から来た人へ

Cloudflare の D1、Workers、Workers AI で開発したことがある人のための案内です。乗り換えの手引きではありません。慣れた作業が AWS ではどういう手順になるかを、同じ小さな機能を作りながら確かめるための道順です。

先に断っておくことが 2 つあります。

- **サービス名の対応表は、出発点でしかありません。** 「D1 に当たるのは Aurora DSQL」と書いても、SQL の方言も、ローカルでの動かし方も、整合性の保証も同じにはなりません。
- **3 つの経路のうち、書き終えているのは Workers の経路の前半だけです。** 残りは planned で、下の表に状態を書いています。

## 3 つの経路

| 慣れているもの | AWS で作るもの | 章 | 状態 |
| --- | --- | --- | --- |
| Workers で HTTP の handler を書く | Lambda と API Gateway HTTP API | [04](/ja/chapters/04-http-api.md)、[05](/ja/chapters/05-dynamodb.md)、[06](/ja/chapters/06-auth.md) | 本文とサンプルあり。ローカル検証済み、AWS 未検証 |
| Workers で edge の処理を書く | CloudFront Functions、Lambda@Edge | [10](/ja/chapters/10-edge.md) | planned |
| D1 で SQL を書く | Aurora DSQL、RDS PostgreSQL、Aurora Serverless v2 | [13](/ja/chapters/13-sql.md) | planned |
| Workers AI でモデルを呼ぶ | Amazon Bedrock | [17](/ja/chapters/17-ai.md) | planned |

どの経路も、[01章](/ja/chapters/01-account.md)と[02章](/ja/chapters/02-toolchain.md)が前提です。

各経路は、同じ 5 つの段階で進めます。手元で試す、テストする、公開の手順を整える、観測する、片付ける。

## Workers の経路

読む順は 00 → 01 → 02 → 04 → 10 です。

04章で、小さな HTTP の handler、型付きの client、環境変数の検証、手元での watch、テスト、デプロイ、ログの確認までを一通り行います。章の終わりに、Workers との違いを表にまとめています。要点は次のとおりです。

**手元の実行環境が違う。** Workers は、`wrangler dev` や Vite plugin が Miniflare を通じて、本番と同じ runtime（workerd）でコードを動かします。04章の `vp run dev:api` は Node.js の HTTP サーバーで、Lambda の runtime そのものではありません。

**binding が無い。** Workers では、設定に binding を宣言すると `env` から使えて、手元では既定でローカルの模擬につながります。AWS では、SDK で呼び、接続先を環境変数で渡し、権限を IAM の role に書きます。手元用の模擬は標準では付いてきません。

**権限が 2 つある。** 手元で動かすときはあなた自身の権限、デプロイ後は関数の実行 role の権限で動きます。手元で通った操作が、デプロイ後に拒否されることがあります。

**実行場所が違う。** Lambda は 1 つのリージョンで動きます。読者の近くで動かしたい処理は 10章の話題ですが、CloudFront Functions は Workers の対応物ではありません。ネットワークにもファイルシステムにも触れない、URL とヘッダーの書き換えのための環境です。

## D1 の経路（planned）

読む順は 00 → 01 → 02 → 04 → 13 → 22 の予定です。RDS や Aurora Serverless v2 も試すなら、13章の前に 11章が要ります。

13章で、schema と migration、型付きの CRUD、seed と reset、ローカルのテスト、実環境への migration、backup と restore までをつなげる予定です。

書く前から分かっている違いを挙げます。

- **D1 は SQLite です。DynamoDB は SQL のデータベースではありません。** SQL で書きたいなら、05章の DynamoDB ではなく 13章へ進んでください。
- **D1 のローカル開発は、手元に閉じた環境で動きます。** Cloudflare のドキュメントによれば、`wrangler dev` は既定でローカル専用の D1 を使い、データは実行をまたいで残り、本番のデータとは分かれています。AWS の SQL のサービスには、同じ形の「ローカル版」は付いてきません。13章では手元の PostgreSQL を代用にしますが、それは代用であり、Aurora DSQL の認証、競合、分散 transaction を再現しません。
- **候補は 1 つではありません。** Aurora DSQL、RDS for PostgreSQL、Aurora Serverless v2 を、SQL の互換性、認証、接続方法、transaction、使っていないときの料金で選びます。Aurora DSQL は PostgreSQL と完全に同じではないので、使う SQL と migration のツールが対応しているかを、執筆時に確かめます。

## Workers AI の経路（planned）

読む順は 00 → 01 → 02 → 04 → 17 の予定です。

17章で、数行の呼び出しから始めて、ノートの要約を streaming で返す API を作る予定です。

- **どちらも、推論は手元では動きません。** Cloudflare のドキュメントは、Workers AI にはローカルの模擬がなく、モデルは常に remote で動くと書いています。Bedrock も同じで、手元で API サーバーを動かしていても、モデルの呼び出しは AWS に届き、課金されます。
- **テストは fixture で行います。** 実際のモデルを呼ぶ確認は、別の `vp run` タスクに分け、ふだんの `check:all` からは呼びません。
- **streaming は経路全体で確かめます。** モデルの API が streaming に対応していても、途中の入口が対応していなければ、読者には届きません。たとえば 04章の API Gateway HTTP API は、応答の streaming に対応していません。

## この案内の検証状況

Cloudflare 側の記述は、次のページに基づきます。どれも確認日は 2026-10-11 です。

- [Workers: Local development](https://developers.cloudflare.com/workers/local-development/)
- [D1: Local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Workers AI: Bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/)

この本は、Cloudflare 側の比較用コードを載せていません。載せる章では、`wrangler` の設定を含む完全なソースを同じリポジトリに置きます。
