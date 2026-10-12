# Brief: rewriting the prose so a person would have written it

The author's words: 「もっと人間にとって読みやすい文章を書いてほしい．特に日本語．訳が不自然なところも多いし」, and earlier, about the whole book, 「AI 臭さは徹底的に排除して細部までこだわってほしい」.

Japanese is the source language. Today much of it reads like a translation: English nouns left in Latin letters mid-sentence (bucket, table, stack), English sentence shapes, short clipped sentences in a row, and a put-on chattiness (「〜なんです」「〜ですよね」「さて、何が起きるでしょう」) that an earlier style guide asked for. The English reads like a rendering of the Japanese.

## What to do

Rewrite the prose of your pages, Japanese first, then the English to match what the Japanese now says. `docs/EDITORIAL.md`, section 「文体: 人が書いた、読みやすい文章」, is the standard, including the table of which terms are katakana and which stay in English. Read it before you write a word.

Read each page as its reader would: a TypeScript developer who is new to AWS. Where a paragraph makes them stop and re-read, rewrite it until it does not. That usually means saying the point first, joining clipped sentences into one that carries its reason, naming things instead of pointing at them with それ/これ, and cutting sentences that only announce what the next one says.

Things that must come out wherever they are a tic, not a choice: rhetorical questions as section openers, 「正直に言うと」 as a refrain, 「〜ですよね」「〜なんです」「〜しましょうね」, colons and dashes joining clauses, three-item lists made for rhythm, and sentences that restate the heading.

## What must not change

- Facts, numbers, prices, conditions, caveats, and every statement that something was not verified.
- Every `<<< @/path{region}` line, every code fence's content, every `<!-- section: NN.name -->` marker, frontmatter, link targets, and the `::: details` block structure. Text inside the details block is prose and is yours to rewrite.
- The order and number of headings and blocks. `node tools/src/checks/content.ts` compares the two languages (section markers, snippet imports, number of headings and of code blocks) and must pass. You may reword a heading; nothing links to heading anchors.
- Figures (```figure blocks): keep nodes, edges, groups and their order. You may reword a caption or a Japanese label to follow the term table, in both languages together where structure is shared. Check with `node book/theme/figure-cli.ts <files>`.

## Things to fix while you are there

- Chapters were recently split into pages (`NN-slug.md` plus `NN-slug/{build,more,local,deploy,wrap}.md`), and one ASCII diagram often became two or three figures. Sentences that point at 「図の上半分」「さっきの図の 3 行目」, or at a section that is now on another page of the chapter, must point at what is actually there: name the figure by what it shows, and link to the other page (`/ja/chapters/NN-slug/wrap.md`, and the `/en/` path in English).
- Chapter titles are now one noun with the services after a colon (「05 KV Store: DynamoDB」). Where prose still calls a chapter by its old title, use the number (「05章」) or the new name.
- A page that starts cold after the split (a later page of a chapter beginning mid-thought) gets one or two sentences that say where the reader is. Do not add a summary list.

## Rules

- Your pages only. Do not touch code under `examples/`, `data/`, `book/theme/`, or other chapters. If the prose says something the code does not do, report it; do not change the code and do not quietly change the claim.
- No new claims. If you are unsure what a sentence meant, read the code it describes before rewriting it.
- Do not run `vp run check:all` or `vp run build:book`. Do not commit or push. Nothing touches AWS.
- Report back: pages rewritten, the kinds of change you made most, any sentence whose meaning you could not determine, any place where prose and code disagree, and confirmation that `content.ts` and `figure-cli.ts` pass for your pages.
