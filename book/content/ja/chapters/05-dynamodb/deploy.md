---
title: "05 KV Store: デプロイ"
---

# 05 KV Store: デプロイ

## AWS にのせる準備

<!-- section: 05.infra -->

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{table}

`billingMode` は on-demand です。読み書きの回数に対して料金がかかり、容量を前もって決めなくて済みます。もう 1 つの選択肢は provisioned で、1 秒あたりの読み書きの容量を決めて、その時間ぶんを払います。流量が安定していて予測できるなら provisioned のほうが安くなることがありますが、使わない時間にも料金がかかります。学習用と、流量の読めない新しいアプリには on-demand が向いています。

`removalPolicy` は `DESTROY` です。stack を消すと、table もその中のノートもすべて消えます。練習用だからです。テストは、この設定をわざわざ確かめています。守るべきデータを入れるようになったら、最初に変えるべき場所なので。

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{role}

`table.grantReadWriteData(role)` と書けば 1 行で済みます。ただ、その権限には、table 全体を読む `Scan` や、まとめて読み書きする操作も入っています。このアプリはどれも使いません。使わない権限は、コードに欠陥があったときに悪用できる範囲を広げるだけなので、5 つの操作を並べています。テストは、操作がこの 5 つであること、対象がこの table の ARN だけであることを見ています。

<<< @/examples/05-dynamodb/infra/lib/notes-stack.ts{function}

`TABLE_NAME` は、デプロイのときに決まる table の名前を、環境変数で関数に渡しています。コードに名前を書きません。

`externalModules: []` は、AWS SDK を bundle に含める指定です。何も指定しないと、SDK は bundle から外されて、Lambda の runtime に入っている版が使われます。その版は、このリポジトリの lockfile とは無関係です。含めておけば、テストしたのと同じ版が動きます。そのぶん bundle は大きくなります。

`banner` の 1 行は、その副作用への手当てです。bundle に入った SDK は、中で `require()` を呼びます。ところが ES module には `require` がないので、そのままだと関数は読み込んだ瞬間に落ちます。そこで、bundle の先頭で `require` を用意しています。ユニットテストはこれを見つけられません（テストの実行環境が `require` を持っているからです）。なので `vp run bundles:check` が、synth した bundle を素の Node.js で読み込んで確かめます。

## デプロイして確かめる

<!-- section: 05.deploy -->

```bash
vp run notes:infra:diff
vp run notes:infra:deploy
vp run notes:smoke
```

`notes:smoke` は、型付きの client でノートを 1 件作って、読み戻して、更新して、わざと古い version で更新して拒否されることを確かめて、最後に消します。04章の smoke と違って、読み戻しはどの実行環境が応答しても成功しないといけません。

table の中身は、コンソールの DynamoDB の画面で「項目を探索」から見られます。

drift の検査は、これまでの章と同じです。

```bash
vp run notes:infra:drift
```

`AWS::DynamoDB::Table` は、固定した版の cdkd が専用の実装で扱う種類です。実際の AWS での結果は、まだ確かめていません。
