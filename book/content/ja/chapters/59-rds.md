---
title: "59 RDS: PostgreSQL を運用する"
revision: 1
---

# 59 RDS: PostgreSQL を運用する

RDS for PostgreSQL は、PostgreSQL そのものを AWS が動かすサービスです。OS の更新、バックアップ、待機系への切り替えは AWS がやりますが、どの大きさのインスタンスを何台置くか、いつ版を上げるか、誰がどのパスワードでつなぐか、どこから読むかは、あなたが決めたまま動き続けます。この章は、その決めごとを順に見ていきます。

[13章](/ja/chapters/13-sql.md)は Aurora DSQL を選び、RDS は表の 1 列として比べただけでした。この章はその先です。13章のアプリとマイグレーションをそのまま使い、置き場所を RDS のインスタンスに替えます。アプリのコードはほとんど増えません。増えるのは、インスタンスのまわりの設定と、リードレプリカから読むときの決まりです。

この章のスタックは、**置いてあるだけで料金がかかります**。既定の構成（db.t4g.micro が 1 台、ストレージ 20 GB）を 1 か月動かしたままにすると、定価で USD 21.51 です。インスタンスを止めてもストレージの料金は続き、止めたインスタンスは 7 日たつと自動で起動します。試し終わったら、その日のうちに `vp run rds:infra:destroy` で消してください。内訳は[費用、注意点、片付け](/ja/chapters/59-rds/wrap.md)にあります。

前提は 13章と、[11章](/ja/chapters/11-network.md)の VPC です。11章のスタックを既定の構成でデプロイしてあれば足ります。シークレットと IAM は [21章](/ja/chapters/21-security.md)、バックアップとリストアの考え方は [22章](/ja/chapters/22-recovery.md)で扱いました。Aurora は [60章](/ja/chapters/60-aurora.md)、別のデータベースへの移行は [39章](/ja/chapters/39-database-migration.md)の主題なので、この章では扱いません。コードは `examples/59-rds/` にあります。

## 全体像

<!-- section: 59.architecture -->

```figure
caption: リクエストは API Gateway と Lambda 関数を通り、VPC のプライベートサブネットの中で RDS のインスタンスに届く
node client: Client | curl, あとで SPA
node api: API Gateway HTTP API | ap-northeast-1
node fn: Lambda function | Node.js 24, arm64
node db: RDS for PostgreSQL | db.t4g.micro, Single-AZ
edge client -> api: HTTPS
edge api -> fn: GET|POST /notes, GET|PUT|DELETE /notes/{id}
edge fn -> db: TLS, port 5432, user notes_api
group vpc: 11章の VPC のプライベートサブネット = fn, db
mark db
```

```figure
caption: データベースには VPC の外から届かないので、マイグレーションは VPC の中の運用用の関数に頼む。マスターユーザーのパスワードを使うのは最初の 1 回だけ
node laptop: 手元のマシン | vp run rds:db:*
node sm: Secrets Manager | マスターユーザーのシークレット
node ops: Ops function | VPC の中, 経路は Invoke だけ
node db: RDS for PostgreSQL
edge laptop -> sm: bootstrap のときだけ読む
edge laptop -> ops: lambda:InvokeFunction
edge ops -> db: notes_admin (1 回), notes_migrator
group vpc: プライベートサブネット = ops, db
```

13章の構成との違いは 3 つあります。

1 つ目は、データベースが VPC の中にあることです。RDS のインスタンスはサブネットに置くもので、この章ではインターネットへの経路がないプライベートサブネットに置き、パブリックなアドレスも付けません。つなぐ側の Lambda 関数も同じサブネットに入れます。11章で見たとおり、このサブネットからは AWS の API にも届きません。関数が Secrets Manager を呼べないので、この制約が認証のやり方を決めます。

2 つ目は、パスワードが存在することです。Aurora DSQL には保存するパスワードがありませんでしたが、PostgreSQL にはマスターユーザーがいて、パスワードを持ちます。この章では RDS にパスワードを作らせて Secrets Manager に置かせ、アプリには使わせません。アプリは 13章と同じく、IAM の認証情報で署名したトークンでサインインします。

3 つ目は、インスタンスが 1 台、ずっと動いていることです。誰もつないでいなくても課金され、そのインスタンスが止まれば API も止まります。待機系を持つか、読み取り用の複製を持つかは、料金と引き換えに自分で決めます。

## インスタンスクラスとストレージ

<!-- section: 59.sizing -->

RDS で最初に決めるのは、インスタンスクラスとストレージです。どちらもあとから変えられますが、変えるたびに停止や制約がついて回ります。

インスタンスクラスは、CPU とメモリの組です。汎用の db.m、メモリを多く持つ db.r と db.x、バーストする db.t があります。db.c は db.c6gd だけで、あとで出てくる Multi-AZ DB cluster 専用です。この章は、いちばん安い db.t4g.micro（2 vCPU、メモリ 1 GiB）を使います。

db.t のクラスは、ふだんは決まった割合までしか CPU を使えず、使わなかった分をクレジットとして貯めて、必要なときに使います。db.t4g は Unlimited モードで動くので、クレジットを使い切っても止まりません。そのかわり、24 時間に貯められる量を超えて使った分には追加の料金がかかります。AWS のドキュメントは、db.t のクラスを開発やテストなど本番以外で使うよう勧めています。

メモリは、同時に張れる接続の数にも効きます。PostgreSQL は接続 1 本ごとにプロセスを 1 つ持つからです。もう 1 つ、この章が使う IAM データベース認証について、ドキュメントは「インスタンスに 300〜1000 MiB の余分なメモリが要る」と書いています。メモリが 1 GiB の db.t4g.micro でこれが足りるかどうかは、確かめていません。

ストレージは gp3 にします。PostgreSQL では 20 GiB が下限で、400 GiB 未満なら 3,000 IOPS と 125 MiB/秒が含まれます。400 GiB からは 4 本のボリュームに分けて置かれ、基準が 12,000 IOPS と 500 MiB/秒に上がります。I/O の多い本番向けには io2 Block Express があります。古い magnetic は廃止され、新しいインスタンスでは選べません。

ストレージで覚えておくことは、増やせるが減らせない、という 1 点です。一度割り当てた量は小さくできません。ドキュメントが挙げる小さくする方法は、小さいストレージのインスタンスを別に作って移す blue/green deployment です。

練習用と本番用で変える設定は、1 か所にまとめてあります。

<<< @/examples/59-rds/src/config.ts{profiles}

既定は `practice` です。`production` の各行が何を守っているかは、この章の残りで 1 つずつ説明します。

## RDS を選ばない場面

<!-- section: 59.choices -->

RDS が合うのは、PostgreSQL そのものが要るときです。拡張、トリガー、PL/pgSQL、長いトランザクション、手持ちの ORM やツールがそのまま動くことが必要で、負荷がおおよそ一定なら、素直な選択になります。パラメーターを自分で決めたい、版を上げる時期を自分で選びたい、という場合も同じです。

逆に、次の場合は別の選択肢のほうが楽です。

使われない時間が長いなら、13章の Aurora DSQL が向いています。置いてあるだけの月の料金が、RDS は USD 21.51、DSQL はストレージの分だけです。VPC も要りません。

待機系への切り替えを速くしたい、読み取り用の複製を何台も同じストレージの上に並べたい、容量を自動で伸び縮みさせたい、という場合は Aurora です。60章が扱います。

アプリが Cloudflare Workers や Vercel の上にあり、そこから動かす予定がないなら、データベースだけを AWS の VPC に置く理由は薄くなります。Vercel は自社の Postgres（Vercel Postgres）の提供を終えていて、いまは Marketplace から Neon や Supabase などの Postgres を入れる形です。Cloudflare には Hyperdrive があります。Hyperdrive は自分でデータベースを持たず、すでにある PostgreSQL や MySQL の手前で接続をプールし、クエリの結果をキャッシュするサービスで、対象には AWS の上のデータベースも入っています。プライベートなネットワークの中のデータベースには Cloudflare Tunnel を通してつなぎます。この章の RDS を Workers から使うこともできるわけですが、その構成は試していません。以上は 2026-10-13 に両社のドキュメントで確かめた内容です。Cloudflare が自社で PostgreSQL を運用するサービスを持っているかどうかは、確かめていません。

この本の立場は 13章と同じです。RDS は、ほかの選択肢より常に優れているわけではありません。得られるのは PostgreSQL のすべてと設定の自由で、支払うのは、止まらない料金と、次のページから見ていく運用の判断です。
