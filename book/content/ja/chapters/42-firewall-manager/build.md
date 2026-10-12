---
title: "42 Firewall Manager: しくみと実装"
---

# 42 Firewall Manager: しくみと実装

[最初のページ](/ja/chapters/42-firewall-manager.md)で見た 2 つのポリシーを、範囲、保護の内容、届くまでの時間、報告の順に作っていきます。このページに出てくる判定のコードは、どれも Firewall Manager のドキュメントをこの本が読み取って書いたモデルです。手元のテストで確かめられるのは、モデルが読み取ったとおりに動くことまでで、サービスが同じ答えを返すことではありません。

## 範囲: どのリソースにポリシーが届くか

<!-- section: 42.scope -->

ポリシーの範囲は、3 つの条件を重ねたものです。アカウントが範囲に入っていること、リソースタイプが合っていること、タグの条件に合っていることです。

アカウントは、3 通りに指定できます。組織のすべてのアカウント、挙げたアカウントと OU だけ（`IncludeMap`）、挙げたアカウントと OU を除くすべて（`ExcludeMap`）です。OU を挙げると、その OU と、子の OU にあるアカウントがすべて入ります。あとから OU に加わったアカウントも入ります。

<<< @/examples/42-firewall-manager/src/org.ts{ancestry}

<<< @/examples/42-firewall-manager/src/scope.ts{accounts}

`IncludeMap` と `ExcludeMap` は、両方を書けても、両方は効きません。API リファレンスは、`IncludeMap` があるときは `ExcludeMap` を評価しないと書いています。「ワークロードの OU を入れて、その中の 1 つのアカウントだけ外す」と書いたつもりのポリシーは、外したつもりのアカウントにも適用されます。テストはこの動作を固定していて、スタックのほうは、両方を指定したら synth で止めます。

タグの条件は、少し込み入っています。ポリシーに書いたタグを持つリソースだけを入れるか（`ExcludeResourceTags` が `false`）、持つリソースを外すか（`true`）を選び、タグが複数あるときは、すべてを持つこと（`AND`）と、どれか 1 つを持つこと（`OR`）のどちらで判定するかを選びます。1 つのポリシーで、入れる指定と外す指定を混ぜることはできません。

<<< @/examples/42-firewall-manager/src/scope.ts{tags}

タグは、キーと値の両方が同じときにだけ一致します。`fms-waf=exempt` を条件にしたポリシーにとって、`fms-waf=Exempt` は関係のないタグです。値を書かなかったタグは空文字列として保存され、空文字列の値にしか一致しません。

<<< @/examples/42-firewall-manager/src/scope.ts{resource}

### 例外はタグで表す

この章の 2 つのポリシーは、どちらも「対象の OU にある、その種類のリソースすべて。ただし、例外のタグが付いたものを除く」という範囲にしてあります。

<<< @/examples/42-firewall-manager/src/policies.ts{exemptions}

逆の書き方、つまり「`public=true` のタグが付いたリソースだけを入れる」にはしていません。そう書くと、タグを付け忘れたディストリビューションは範囲の外になり、ポリシーは何も言いません。この章が答えたかった問いは、誰も覚えていなかったリソースのことでした。入れる側をタグに頼ると、覚えておく対象が web ACL からタグに変わるだけです。

外す側をタグにすると、例外は、誰かがわざわざ付けたものになります。それでも、例外の一覧がいつのまにかポリシーの本体になってしまうことはあります。防ぐために、次の 3 つを決めておきます。

- 例外は、ポリシーの定義ではなく、リソースのタグに置く。ポリシーにアカウントやリソースの名前を足していくと、ポリシーが例外の一覧になります
- 例外になっているリソースを、定期的に一覧にする。範囲から外れたリソースは、準拠の報告にも出てきません。黙って消えるので、別に数える必要があります
- 例外のタグを付けられる人を絞る。リソースの持ち主が自分でタグを付ければ、ポリシーから抜けられます。タグ付けの権限を IAM と SCP で絞るのは、Firewall Manager ではなく組織の側の仕事です。この章では、その SCP を書いていません

2 つ目のために、モデルは、範囲に入らなかった理由を分けて返します。

<<< @/examples/42-firewall-manager/src/scope.ts{coverage}

`keptOutByTags` が、アカウントもリソースタイプも合っているのに、タグだけで外れたリソースです。実際の組織でこの一覧を作るには、各アカウントのリソースとタグを集める必要があります。この章は、その収集を実装していません。

クォータも関係します。1 つのポリシーが範囲に使えるタグは既定で 8 個、範囲に入れられる OU は 20 個です（確認日 2026-10-13）。モデルのスキーマは、この数を超えたら断ります。

<<< @/examples/42-firewall-manager/src/scope.ts{scope-schema}

スタックは、モデルが読むのと同じ範囲の定義から、`AWS::FMS::Policy` のプロパティを作ります。テストが調べた範囲と、デプロイされる範囲が、別々に書かれて食い違うことを避けるためです。

<<< @/examples/42-firewall-manager/infra/lib/scope-props.ts{scope-props}

綴りの違いが 1 つあります。OU のキーは、API リファレンスでは `ORG_UNIT`、CloudFormation のリファレンスでは `ORGUNIT` です。スタックは CloudFormation の綴りで出力します。固定した版の cdkd は、このリソースを Cloud Control API 経由で作るので、CloudFormation のスキーマが使われるはずですが、実際に受け付けられることは確かめていません。

## AWS WAF のポリシー

<!-- section: 42.waf-policy -->

21章の web ACL は、1 つのアカウントの中で、ルールを自分で並べました。Firewall Manager の AWS WAF のポリシーは、範囲に入るアカウントごとに web ACL を作り、その中のルールを 3 つの組に分けます。

```text
order  set                 who writes it                    what goes in it
1      first rule groups   the Firewall Manager policy      rule groups only
2      account's own       the owner of the member account  rules and rule groups
3      last rule groups    the Firewall Manager policy      rule groups only
```

最初の組と最後の組はポリシーが決め、そのあいだに、アカウントの持ち主が自分のルールを足せます。ポリシーが入れられるのはルールグループだけで、単独のルールは入れられません。1 つのルールを配りたいときは、それを入れたルールグループを管理者アカウントに作ります。

最初と最後を分ける理由は、AWS WAF の評価のしかたにあります。Allow と Block は、そこで評価を終える動作（terminating action）です。アカウントの持ち主が自分のルールで Allow したリクエストは、そのあとの組に進みません。最初の組は、アカウントのルールより先に評価されるので、持ち主が何を書いても通り抜けられません。最後の組に届くのは、アカウントのルールが許可も拒否もしなかったリクエストだけです。

<<< @/examples/42-firewall-manager/src/policies.ts{edge-waf}

この章のポリシーは、最初の組に、評判の悪い IP アドレスの一覧（`AWSManagedRulesAmazonIpReputationList`、25 WCU）を置きました。どのアカウントにも例外なく効かせたいものです。最後の組には、既知の攻撃の入力を止めるルールグループ（`AWSManagedRulesKnownBadInputsRuleSet`、200 WCU）を置きました。アカウントが自分のルールで先に通したリクエストには、効きません。

21章が `count` から始めた core rule set は、入れていません。正当なリクエストを止めることがあるルールグループを、すべてのアカウントに一度に配るのは、21章が 1 つのアカウントで慎重にやったことの逆です。入れるなら、あとで説明する自動修復を無効にしたまま、まず 1 つの OU で様子を見ます。

### 設定は JSON の文字列で渡す

ポリシーの種類ごとの設定は、`SecurityServicePolicyData.ManagedServiceData` という 1 つのプロパティに、JSON を文字列にして入れます。CloudFormation にとっては、中身は検査しないただの文字列です。キーの綴りを 1 文字間違えても、synth は通ります。

<<< @/examples/42-firewall-manager/src/managed-service-data.ts{waf-data}

このスキーマは、この章が使うフィールドだけを、API リファレンスの例の形に合わせて書いたものです。知らないキーは断るので、綴りの間違いはデプロイの前に見つかります。ただし、これは Firewall Manager の検査ではありません。サービスは、ここに無いフィールドを受け付けますし、ここを通った値を断るかもしれません。

`overrideAction` を `NONE` だけにしているのも、同じ理由です。API リファレンスの WAFV2 の例に出てくる値は `NONE` だけでした。`COUNT` は AWS WAF Classic の例にしか出てこず、WAFV2 のポリシーで使えるかどうかを確かめていないので、スキーマは通しません。

<<< @/examples/42-firewall-manager/src/managed-service-data.ts{encode}

<<< @/examples/42-firewall-manager/infra/lib/edge-waf-policy-stack.ts{waf-policy}

### 自動修復を無効にしているあいだに得られるもの

`RemediationEnabled` が `false` のポリシーは、何も変えません。範囲に入るリソースのうち、ポリシーの web ACL が付いていないものを、準拠していないものとして一覧にするだけです。

この一覧だけでも、21章の構成では手に入らなかったものです。組織のすべてのアカウントについて、web ACL の付いていないディストリビューションがいくつあり、どれなのかが、1 か所で分かります。ドキュメントも、まず無効で作り、何が変わるかを見てから有効にする手順を勧めています。この章のスタックも、既定では無効です。

有効にするには、`-c wafRemediation=on` を付けてデプロイし直します。Firewall Manager は、範囲に入るアカウントに web ACL を作り、範囲に入るリソースに関連付けます。web ACL の名前は `FMManagedWebACLV2-<ポリシー名>-<時刻>` になります。名前はあとから変えられないので、ポリシーの名前を変えても web ACL の名前は変わりません。

web ACL をいつ作るかは、`optimizeUnassociatedWebACL` で変わります。`true` なら、そのアカウントに web ACL を使うリソースが 1 つでもあるときにだけ作ります。`false` なら、範囲に入るすべてのアカウントに、使うリソースが無くても作ります。web ACL は置いてあるだけで月額がかかるので、この章は `true` にしています。

### すでに web ACL が付いているリソース

範囲に入ったディストリビューションに、21章のように自分で付けた web ACL がすでにある場合、ポリシーの設定によって扱いが変わります。

既定の動作は、Firewall Manager が新しい web ACL を作ることです。自動修復を有効にするとき、「ほかの有効な Firewall Manager のポリシーが管理していない web ACL の関連付けを外す」という選択肢を足せます。API では `overrideCustomerWebACLAssociation` です。これを選ぶと、Firewall Manager は、先にポリシーの web ACL を関連付けてから、元の関連付けを外します。この章では `-c replaceAccountWebAcls=on` がそれにあたります。

置き換えで失われるものがあります。関連付くのは別の web ACL なので、アカウントの持ち主が元の web ACL に書いていたルールは、付いてきません。21章のレートベースのルールは、ポリシーの web ACL の「アカウント自身のルール」の組に、持ち主が書き直す必要があります。

この選択肢を選ばなかったときに、自分で付けた web ACL がどうなるかは、ドキュメントの中で読み取りが分かれました。ポリシーの作成手順は、置き換えを選択肢として書いています。一方、web ACL の管理のページには、利用者が手で関連付けた自分の web ACL も、ポリシーの web ACL で上書きされるという注記があります。どちらの条件での話なのかを確かめていないので、この章のモデルは、選択肢を選ばなければ元の web ACL が残り、リソースは準拠していないままになる、という保守的なほうを取っています。本番で有効にする前に、1 つのアカウントで確かめてください。

もう 1 つのやり方が、既存の web ACL をそのまま使う設定（`webACLSource` を `RETROFIT_EXISTING` にする）です。Firewall Manager は、すでに付いている web ACL の先頭と末尾に、ポリシーのルールグループを差し込みます。条件があり、web ACL がそのアカウントのもので、範囲に入るリソースにしか関連付いていないことが必要です。この章のスタックは、この設定を使っていません。

### 範囲から外れたリソース

リソースが範囲から外れたとき、たとえば例外のタグが付いたとき、既定では、付いていた web ACL はそのまま残ります。保護は続きますが、準拠の報告からは消えます。`ResourcesCleanUp` を `true` にすると、Firewall Manager は、範囲から外れたリソースから web ACL の関連付けを外します。

どちらが正しいかは、例外の意味によります。「このリソースにはポリシーの web ACL を付けたくない」という例外なら、外れてほしいはずです。この章のスタックは `true` にしています。例外のタグを付けた結果が、付けた人の意図どおりになるほうを選びました。

## セキュリティグループの監査ポリシー

<!-- section: 42.sg-audit -->

content audit のポリシーは、範囲に入るセキュリティグループのルールを、基準と比べます。基準の書き方は 2 通りあります。Firewall Manager が用意した選択肢を組み合わせるもの（managed policy rules）と、基準にするセキュリティグループを 1 つ指定するもの（custom policy rules）です。この章は後者を使います。前者の設定を API でどう書くかは、リファレンスに一部の例しか無く、確かめきれなかったからです。

基準にするセキュリティグループを、監査用のセキュリティグループ（audit security group）と呼びます。管理者アカウントに作り、どのリソースにも付けません。Firewall Manager は、比べる相手として読むだけです。

監査の向きは、`ALLOW` と `DENY` から選びます。`ALLOW` では、範囲に入るセキュリティグループのルールがすべて、監査用のセキュリティグループのルールが許す幅の中に収まっていなければなりません。`DENY` では逆に、監査用のルールに当てはまるものが 1 つもあってはなりません。

<<< @/examples/42-firewall-manager/src/policies.ts{sg-audit}

この章の基準は、インターネット全体に開けてよいのは HTTPS だけ、というものです。監査用のセキュリティグループには、どこからでも届く TCP の 443 番と、プライベートアドレスの 3 つのブロックからの通信すべてを書きました。範囲に入るセキュリティグループの受信ルールは、このどれかに収まっていなければなりません。

「0.0.0.0/0 に 443 番以外を開けない」より、少し厳しい基準になっています。事務所の IP アドレス 1 つに 22 番を開けるルールも、どの幅にも収まらないので、準拠していないことになります。必要なら、例外のタグを付けるか、監査用のセキュリティグループにそのアドレスを足します。足すと、すべてのアカウントでそのアドレスが許されます。

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{audit-group}

セキュリティグループは VPC の中にしか作れないので、スタックは、何も入っていない VPC を 1 つ作ります。サブネットもゲートウェイも無く、時間課金のものはありません。

<<< @/examples/42-firewall-manager/src/managed-service-data.ts{audit-data}

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{audit-policy}

監査用のセキュリティグループの ID は、デプロイするまで決まりません。CDK の中ではトークンなので、スキーマはトークンを通します。合成されたテンプレートで、ID の位置に `Fn::GetAtt` が入っていることは、スタックのテストで確かめています。

### 同じルールを手元で当てる

同じ基準を、手元で受信ルールに当てる関数を書きました。

<<< @/examples/42-firewall-manager/src/security-group-audit.ts{audit-rule}

ドキュメントが書いているのは、ルールが「許された幅の中に収まる」ことまでです。この関数は、それを次のように読みました。送信元の CIDR が許された CIDR に含まれ、プロトコルが同じで、ポートの範囲が許された範囲に含まれていれば、収まっています。許す側がすべてのプロトコルなら、ポートは問いません。この読みが Firewall Manager の判定と同じかどうかは、確かめていません。

答えは 3 通りあります。準拠している、準拠していない、評価していない、です。送信元がほかのセキュリティグループやプレフィックスリストのルールを、Firewall Manager がどう扱うかは、読んだ範囲のドキュメントには書いてありませんでした。分からないものを「準拠している」に入れないのは、21章の `sec:posture` が、読めなかった項目を `off` ではなく `unknown` にしたのと同じ考え方です。

<<< @/examples/42-firewall-manager/src/security-group-audit.ts{audit-group}

送信ルールは見ていません。監査用のセキュリティグループを使う設定で、受信と送信がどう比べられるのかも、ドキュメントからは読み取れなかったからです。

この関数は、合成したテンプレートにも当てられます。セキュリティグループに直接書かれたルールと、`AWS::EC2::SecurityGroupIngress` として別に書かれたルールの両方を読みます。

<<< @/examples/42-firewall-manager/src/security-group-audit.ts{from-template}

### 自動修復が動いているサービスにすること

監査のポリシーは、作るときには自動修復を有効にできません。必ず無効で作り、あとで有効に変えます。この章では、2 回目のデプロイで `-c sgRemediation=on` を付けます。

有効にすると、Firewall Manager は、準拠していないルールを書き換えるか、削除します。ロードバランサーのセキュリティグループに 80 番をインターネットへ開けているサービスなら、そのルールが書き換えられるか削除されます。削除されれば、80 番で届いていたリクエストは届かなくなります。どのルールがどう変わるかは、有効にする前に、準拠の報告の「違反の詳細」で見られます。そこには、違反しているルール、比べた監査用のルール、理由、修復の提案が並びます。

CDK で管理しているセキュリティグループでは、もう 1 つ問題が起きます。Firewall Manager がルールを消しても、スタックのテンプレートにはそのルールが残っています。[02章](/ja/chapters/02-toolchain.md)のドリフト検出はこれを差として報告し、次のデプロイがルールを元に戻すかもしれません。戻れば、Firewall Manager がまた消します。ドキュメントも、Firewall Manager とほかの道具が同じセキュリティグループを管理すると、修復が互いを打ち消し合って繰り返されると警告しています。自動修復を有効にするなら、直す場所はコードです。準拠の報告を見てテンプレートを直し、自動修復は、コードを通らなかったものへの最後の手段にします。

検出にかかる時間にも幅があります。ドキュメントによると、EC2 のネットワークインターフェースに付いたセキュリティグループの変更は、ふつう数時間以内に検出されますが、6 時間かかることもあります。また、対象にならないものがあります。Amazon RDS が作ったネットワークインターフェースは扱えず、Fargate のタスクのネットワークインターフェースや、AWS のサービスが管理しているネットワークインターフェースのセキュリティグループは、Firewall Manager からは更新できません。

## ポリシーが届くまでのあいだ

<!-- section: 42.reconcile -->

この章で扱う分散システムの問題は、ポリシーとリソースが別の場所にあることです。ポリシーは管理者アカウントに 1 つあり、リソースは多くのアカウントにあります。両者は、あとから合わせられます。

```figure
caption: ディストリビューションが作られてから、報告が「準拠」になるまで
type: sequence
actor owner: アカウントの持ち主
actor resource: ディストリビューション
actor config: AWS Config
actor manager: Firewall Manager
step owner -> resource: 作る
note resource: web ACL なし
step resource --> config: 設定を記録
step config --> manager: 設定の変化
note manager: 報告: NON_COMPLIANT
step manager -> resource: web ACL を関連付ける
step resource --> config: 設定を記録
step config --> manager: 設定の変化
note manager: 報告: COMPLIANT
```

リソースがいま守られているかどうかを知っているのは、そのリソースがあるメンバーアカウントです。管理者アカウントが持っているのは、最後に届いた設定をもとにした報告で、少し前の姿です。ディストリビューションが作られてから、その設定が Firewall Manager に届くまでのあいだ、メンバーアカウントの持ち主には web ACL の付いていないディストリビューションが見えていて、管理者には何も見えていません。

この関係を、小さなモデルにしました。

<<< @/examples/42-firewall-manager/src/reconcile.ts{world}

<<< @/examples/42-firewall-manager/src/reconcile.ts{enforces}

報告は、管理者に届いた設定（`observed`）だけから作ります。届いていないリソースは、準拠しているとも、していないとも言いません。

<<< @/examples/42-firewall-manager/src/reconcile.ts{report}

修復の計画も、届いた設定だけから立てます。

<<< @/examples/42-firewall-manager/src/reconcile.ts{plan}

<<< @/examples/42-firewall-manager/src/reconcile.ts{apply}

テストが壊そうとしている不変条件は、「範囲に入るリソースが、ポリシーのルールが効いていないのに、準拠していると報告されることはない」です。

モデルの上では、この文は、そのままでは成り立ちません。持ち主が web ACL を付け替えた直後、その変化が届くまでのあいだ、報告は「準拠している」のままだからです。テストは、この順序をそのまま再現して、報告がずれる時間があることを示します。そのうえで、成り立つ形に言い直した不変条件を確かめます。

- 報告に「準拠している」と出るリソースは、その報告のもとになった設定の中で、ポリシーの最初と最後のルールグループが効いている
- 一度も設定が届いていないリソースは、報告に出ない
- 報告と実際が食い違うのは、設定が届いたあとでリソースが変わったときだけである

3 つ目を確かめるために、テストは、乱数の種を固定して 2,000 手を進めます。リソースを作る、web ACL を付け替える、例外のタグを付け外しする、設定を届ける、修復する、を決まった順序で混ぜ、1 手ごとに報告の全行を調べます。「効いている」の判定は、テストの側で、モデルのコードを使わずに書いてあります。モデルの判定をわざと緩めると、このテストが落ちることも確かめました。

実際のサービスで、このずれがどれくらい続くかは、ドキュメントに数字が少ししかありません。ポリシーの作成には数分かかることがある、ポリシーやリソースを変えたあと準拠の状態が更新されるまで数分かかることがある、という記述です。セキュリティグループについては、先に書いた 6 時間の記述があります。新しく作ったディストリビューションに web ACL が付くまでの時間は、書かれていませんし、この本でも計っていません。

ドキュメントは、もう 1 つ注意を書いています。Firewall Manager は AWS Config の情報で変化を知るので、保護の状態を短い間隔で何度も変えると、AWS Config が一部を取りこぼし、準拠や修復の状態が失われることがあります。おかしいと思ったら、変更を繰り返している処理が無いことを確かめたうえで、AWS Config のルールを再評価します。

## 準拠の報告と通知

<!-- section: 42.compliance -->

準拠の状態は、Firewall Manager のコンソールで、ポリシーごとに見られます。まずアカウントの単位で、範囲に入るアカウントが、準拠しているか、していないかに分かれます。アカウントを選ぶと、準拠していないリソースの ID、タイプ、理由が並びます。content audit のポリシーでは、リソースを選ぶと違反の詳細まで見られます。

人が見に行かなくても知らせが届くようにするには、経路を選ぶ必要があります。ドキュメントで確かめた範囲では、次のとおりです。

- CloudWatch のメトリクスは出ません。ドキュメントは、Firewall Manager はメトリクスを記録しないので、CloudWatch のアラームは作れないと書いています
- SNS には、通知チャンネル（notification channel）を設定すると届きます。SNS のトピックと、発行に使う IAM ロールを 1 つずつ指定します。どんな内容のメッセージが届くのかは、形式の説明を見つけられませんでした
- Security Hub CSPM には、準拠していないリソースの finding が自動で送られます。Security Hub を有効にしていれば、追加の設定は要りません
- EventBridge に Firewall Manager 自身がイベントを出すという記述は、読んだ範囲では見つかりませんでした。Security Hub が、取り込んだ finding を 1 件ずつ EventBridge に流すので、それを使います

この章のスタックは、2 つ目と 3 つ目の両方を用意します。形が文書になっているのは Security Hub からの経路なので、中身を読んで整えるのはそちらだけです。

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{channel}

トピックのポリシーは、Firewall Manager のドキュメントにある例のとおりで、管理者アカウントのサービスリンクロールに `sns:Publish` を許します。Organizations のドキュメントによると、このロールは、Firewall Manager と Organizations の信頼されたアクセス（trusted access）を有効にしたときに、組織のアカウントに作られます。まだ無いアカウントにこのスタックをデプロイしたときに何が起きるかは、確かめていません。

<<< @/examples/42-firewall-manager/src/finding.ts{event-pattern}

ルールは、Security Hub が出す「Security Hub Findings - Imported」のうち、製品名が Firewall Manager のものだけを拾います。この製品名は、Firewall Manager のドキュメントが、Security Hub で絞り込むときの値として挙げているものです。大文字と小文字を区別します。

<<< @/examples/42-firewall-manager/src/finding.ts{event-schema}

スキーマが見るのは、ハンドラーが読むフィールドだけです。finding の形式（AWS Security Finding Format）は、アカウント、タイトル、説明、重大度、リソースなどを必須にしていて、準拠の状態や製品名は任意です。任意のフィールドが無い finding は、状態を「書かれていない」として通知します。「準拠している」にも「していない」にも寄せません。

テストの fixture は、この本が文書の形式から書いたもので、実際のアカウントから取ったものではありません。Firewall Manager の finding が、任意のフィールドに実際に何を入れてくるかは、見ていません。

<<< @/examples/42-firewall-manager/src/finding.ts{summarize}

<<< @/examples/42-firewall-manager/src/notify.ts{notify}

読めなかったイベントは、捨てずに「読めなかった」として通知します。形式が変わってスキーマに合わなくなったとき、黙ってしまうと、通知が来ないことが「すべて準拠している」に見えるからです。再試行しても形は直らないので、関数は失敗にしません。

<<< @/examples/42-firewall-manager/src/lambda.ts{handler}

<<< @/examples/42-firewall-manager/infra/lib/firewall-manager-stack.ts{notifier}

finding には、気をつける点が 2 つあります。1 つは、どのアカウントの Security Hub に届くかです。Security Hub のドキュメントによると、Security Hub の管理者アカウントの EventBridge には、メンバーアカウントの finding のイベントも流れます。また、集約リージョン（aggregation Region）を決めていれば、ほかのリージョンの finding もそこに流れます。Firewall Manager の finding がどのアカウントとリージョンで生まれるのかは、確かめていません。このスタックのルールは、置いたアカウントの、東京リージョンのイベントしか見ません。us-east-1 のポリシーの finding を拾うには、同じルールを us-east-1 にも置くか、Security Hub の集約を設定します。

もう 1 つは、finding が閉じないことがある点です。Firewall Manager は、削除されたポリシー、削除されたリソース、範囲から外れたリソースの finding を更新しません。例外のタグを付けて範囲から外したリソースの finding は、「準拠していない」のまま Security Hub に残ります。
