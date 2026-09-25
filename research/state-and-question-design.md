# TypeSafe (Jev) で Conway's Game of Life を駆動する — state / question 設計調査

対象 issue: `uehaj/jev-conway-lifegame#2`「state と質問の設計ガイダンス」への一次情報調査。
調査元: `https://docs.typesafe.ai/llms.txt` を起点に主要ページを WebFetch で取得（markdown 版 `.md`）。API 呼び出しは一切行っていない。

既知事実（再掲・出典あり）:
- jev-1.13 はカウントが不正確: `https://docs.typesafe.ai/model-jaggedness/jev-1.13.md`
- トークン予算: 1 リクエスト合計 64k、`state` は 32k まで（正確には「32k tokens for `state` plus the longest question」— `https://docs.typesafe.ai/models.md`）
- 料金: input token のみ課金。`https://docs.typesafe.ai/models.md` に "$42 / $0.042" per billion/million tokens、"Output tokens are free" と明記。
- SDK: `@typesafe-ai/sdk`（`https://docs.typesafe.ai/sdk/javascript.md`）

---

## 1. state 内でのボード表現

ドキュメントは grid/board/座標データの表現方法について**具体的な推奨を明記していない**（`https://docs.typesafe.ai/concepts/state.md` を確認したが該当記述なし）。state の一般形として示されているのは以下3種のみ（同URL）:

- 文字列: `"My card was charged twice."`
- オブジェクト: `{"message": "...", "order_id": "A-104"}`
- 配列: `["Hi", "My customer number is TS1337.", "My card was charged twice."]`

推奨文言として明記されているのは "Use an object for most requests so each part of the state has a descriptive name and its relationships remain clear."（同URL）のみで、盤面表現（行文字列/座標リスト/2次元配列）の優劣についての言及はない。

**推測**: 上記の一般原則（descriptive name を持つオブジェクトを使う）に従うなら、盤面は `{"board": {"width": 16, "height": 16, "cells": [[0,1,0,...], ...]}}` のような named field + 2D array が自然な選択。行文字列（`"................"` のような1行1文字列）は人間可読で軽量だが、"descriptive" 原則には反しにくく、Jev がインデックスで文字位置を数える必要が生じる（後述のカウント不正確性リスク）ため、座標での参照がしやすい2D配列やライブセル座標リストの方が安全と考えられる。ただし、これは公式ガイダンスではなくこちらの推論。

### backtick によるネストパス参照

- `https://docs.typesafe.ai/primitives.md`: "You reference specific fields using dot-and-index paths in instructions. For example: `` `ticket.messages[0].text` ``"
- `https://docs.typesafe.ai/primitives/noul.md` の "Structured Instructions" 例:
  ```json
  {
    "instructions": {
      "potential_duplicate": { "name": "Jon Smith", "location": "Oakland, CA" },
      "question": "Is the resume for the same person as `potential_duplicate`?"
    }
  }
  ```
  ここでの `` `potential_duplicate` `` は **instructions オブジェクト内のキー**を指しており、同ページの説明では "The backtick syntax references nested properties within the `state` object for comparison." ともある。
- `https://docs.typesafe.ai/primitives/advanced.md`: instructions/criteria は `EntryType`（string/object/array/null）を受け付け、配列で複数フィールドを並べて参照する例（`["ticket.sender.display_name", "ticket.sender.email"]`）はあるが、`` `board.rows[3]` `` のような**配列インデックス付きドット記法が state 側パスとして動くかを直接示す例文は見つからなかった**。primitives.md の一般説明文 "dot-and-index paths"（上記引用）が唯一、インデックス表記の使用を示唆する根拠。

**推測（ドキュメントに明記なし）**: 上記を総合すると、質問 `instructions` の文字列中でバッククォートに囲んだ `state` 内のドット/インデックスパス（例: `` `board.rows[3]` ``）を書くと、モデルはそのパスが指す値を state から解決して参照する、という機能として使えると考えられる。ただし公式の完全な文法仕様（配列インデックスの範囲、否定形、存在しないパスの扱い等）を明記したページは今回の調査範囲では発見できなかった。設計に使う際は小規模なプロトタイプで実際の応答を検証すべき。

---

## 2. 近傍モードのバッチ処理

### 1リクエスト内の複数 question は「同じ state 全体」を見る

- `https://docs.typesafe.ai/concepts/state.md`: "Each request evaluates one state against one or more questions. All questions see the same state and are evaluated independently. You can mix Choice, Score, and Noul questions in one request."
- `https://docs.typesafe.ai/patterns/fan-out.md`: "Each question evaluates against the same shared state... The pattern doesn't show questions referencing different substates or branching paths. Instead, all questions receive the complete context, and your application logic filters relevance afterward."（fan-out パターンの調査結果として、documents に per-question の部分状態スコープ機能を示す例は見当たらなかった）

**重要な帰結（推論）**: TypeSafe には「この question はこの部分状態だけを見る」という**トークン消費を削減する意味でのスコープ限定機能はドキュメント上確認できない**。1リクエストの `state` はJSON全体として送信され、すべての question がそれを（原理上）参照可能。バッククォートのパス参照は「モデルの注意をどこに向けるか」という**指示文上のテクニック**であり、「送信されるトークン量を減らす」機能ではない。つまり近傍モードで `neighborhoods["3,4"]` のようなキーを使っても、state 全体（=全近傍を束ねたJSON）のトークン数がそのリクエストの state コストになる。

### バッチの効果はどこにあるか

- `https://docs.typesafe.ai/cookbooks/parallel_questions.md`: 13問（Noul 8 + Choice 2 + Score 3）を1リクエストに束ねた場合、同じ13問を13回の単発リクエストに分けた場合と比べ "12.2x cheaper" かつ "10.0x faster"。根拠は "N single-question calls re-send the article N times; the batched call sends it once." つまり**state（=文書）を1回だけ送ることによる節約**が本質。
- `https://docs.typesafe.ai/patterns/fan-out.md`: "All questions are evaluated in parallel, so adding more questions usually has little effect on response time."（質問数を増やしても応答時間はほぼ変わらない）

**推測（本ケースへの適用）**: 近傍モードで「多くのセルの質問を1リクエストにまとめる」こと自体は、上記の cookbook と整合する有効な戦略。ただし state を小さくする効果があるのは「1つの近傍だけを送る」場合であり、複数セル分の近傍をバッチしたいなら `neighborhoods` map に多数のエントリを詰め込む必要がある（ユーザー案どおり）。この場合 state はセル数に比例して大きくなるため、"state を小さくする" ことと "多くの質問をバッチする" ことは同じ state 設計の中でトレードオフになる。近傍モードの真の利点は、(a) 同じセル数を処理する場合に全盤面モードより state 中の冗長データが少ない可能性がある点、および (b) 後述するカウント信頼性の観点、の2つであり、「1リクエストあたりのトークン量削減」という素朴な理解だけでは正確でない。

---

## 3. 実用上の上限とコスト試算

### ドキュメントが明示する数値

| 項目 | 値 | 出典 |
|---|---|---|
| 1リクエスト合計トークン予算 | 64k tokens | `https://docs.typesafe.ai/models.md` |
| `state` の上限 | "32k tokens for `state` plus the longest question" | 同上 |
| 1リクエストあたりの質問数の上限 | **明記なし**（fan-out.md 調査: "The documentation doesn't specify a hard limit on questions per request"） | `https://docs.typesafe.ai/patterns/fan-out.md` |
| 料金（input） | $0.042 / 百万トークン（$42 / 十億トークン） | `https://docs.typesafe.ai/models.md` |
| 料金（output） | "Output tokens are free" | 同上 |
| カウント信頼性 | "jev-1.13 does not count reliably... the error grows with the size of the thing being counted" → "count in code" 推奨 | `https://docs.typesafe.ai/model-jaggedness/jev-1.13.md` |

### 試算の前提（すべて推測・独自見積り）

ドキュメントに文字→トークン換算の明示はないため、一般的な経験則「英数字テキストは概ね4文字≒1トークン」を仮定する（**TypeSafe固有の数値ではない、こちらの推測**）。

- 全盤面モードの state: 盤面を2D配列（0/1）+ ルール説明文（固定・目安200トークン）とする。
  - 16x16=256セル: 配列表現ざっくり 256セル×数文字 ≒ 70トークン。state 合計 ≒ 270トークン。
  - 32x32=1024セル: ≒ 260トークン。state 合計 ≒ 460トークン。
  - いずれも 32k 上限に対して極めて小さい。
- 近傍モードの state: `neighborhoods` map（キー "x,y" + 3x3セル）をセル数分持つ + ルール説明文200トークン。
  - 1エントリ ≒ 45文字 ≒ 11トークン（key・括弧・カンマ込みの概算）。
  - 16x16: 256エントリ × 11 ≒ 2,800トークン。state 合計 ≒ 3,000トークン。
  - 32x32: 1024エントリ × 11 ≒ 11,300トークン。state 合計 ≒ 11,500トークン（32k以内）。
- question 側: 1セルあたり "Is cell (x,y) alive in the next generation?" 相当の短い instructions ≒ 15〜20トークン/問（criteriaを付けるとさらに増える）。
  - 16x16 = 256問 × 20 ≒ 5,100トークン。
  - 32x32 = 1024問 × 20 ≒ 20,500トークン。

### リクエスト数の見積り（推測）

上記の粗い前提に基づくと、両モードとも state と questions の合計が 64k を大きく下回るため、**1世代分の更新が1リクエストに収まる可能性が高い**という試算結果になる:

- 全盤面モード 16x16: state 270 + questions 5,100 ≒ 5,370トークン → 1リクエストで足りる（推測）。
- 全盤面モード 32x32: state 460 + questions 20,500 ≒ 21,000トークン → 1リクエストで足りる（推測）。
- 近傍モード 16x16: state 3,000 + questions 5,100 ≒ 8,100トークン → 1リクエストで足りる（推測）。
- 近傍モード 32x32: state 11,500 + questions 20,500 ≒ 32,000トークン → 64k以内だがマージンが小さくなる（推測。criteria追加や記述の冗長化で64kを超えるリスクがある）。

**この試算の限界（明記が必要）**: 4文字/トークンという換算比、instructions/criteria の実際の文字数、モデルが「質問数の上限」を暗黙に持つ可能性（ドキュメントに明記はないが実運用上のレイテンシ・レスポンス生成コストは考慮されていない）は、いずれもドキュメントで裏付けられていない。特に1リクエストに1,000問超を積む運用が実際に安定するかは、プロトタイプでの実測が必要。

### コスト試算（推測、$0.042/百万トークン、input のみ課金）

- 全盤面16x16: 5,370トークン × $0.042/1,000,000 ≒ $0.00023/世代
- 全盤面32x32: 21,000トークン ≒ $0.00088/世代
- 近傍16x16: 8,100トークン ≒ $0.00034/世代
- 近傍32x32: 32,000トークン ≒ $0.00134/世代

output は無料なので、応答（各セルの `noul` 確率値）自体はコストに影響しない。**この試算が示す帰結（推論）**: 盤面サイズがこの程度（最大32x32=1024セル）である限り、素朴な文字数見積りでは全盤面モードの方が近傍モードよりむしろ安い可能性がある（近傍モードは3x3の重複データを大量に含むため state が冗長になりやすい）。近傍モードを選ぶ理由は「コスト」よりも「カウント信頼性」（jev-1.13が広い盤面上でセルの位置と近傍8セルを正しく特定・計数できるかへの懸念、`model-jaggedness/jev-1.13.md` 参照）にあると考えられる、というのがこちらの解釈。

---

## 4. 具体的なリクエスト形状の案

出典: `https://docs.typesafe.ai/primitives/noul.md`（Noulのスキーマと例）、`https://docs.typesafe.ai/sdk/javascript.md`（SDKでの呼び出し形状）、`https://docs.typesafe.ai/primitives.md`（dot-and-index path 参照）。

### 全盤面モード

```json
{
  "state": {
    "rules": "Conway's Game of Life: a live cell with 2 or 3 live neighbors survives; a dead cell with exactly 3 live neighbors becomes alive; otherwise the cell is dead in the next generation.",
    "board": {
      "width": 16,
      "height": 16,
      "cells": [[0,0,1,0, "...16 values..."], ["...15 more rows..."]]
    }
  },
  "model": "jev-latest",
  "questions": {
    "cell_3_7": {
      "type": "noul",
      "instructions": "Given `rules` and `board`, is the cell at row 3, column 7 (`board.cells[3][7]`) alive in the next generation?",
      "criteria": {
        "true": "Applying the rules to board.cells[3][7] and its 8 neighbors yields alive",
        "false": "Applying the rules yields dead"
      }
    }
  }
}
```

盤面全体を1つの `state.board` として持ち、256（または1024）個の `questions` を同じリクエストに束ねる（`concepts/state.md` の "one state against one or more questions" に基づく設計）。

### 近傍モード

```json
{
  "state": {
    "rules": "Conway's Game of Life: ...(同上)...",
    "neighborhoods": {
      "3,7": [[0,1,0],[1,1,0],[0,0,1]],
      "3,8": [[1,0,1],[1,0,0],[0,1,0]]
    }
  },
  "model": "jev-latest",
  "questions": {
    "cell_3_7": {
      "type": "noul",
      "instructions": "The center cell of `neighborhoods[\"3,7\"]` (a 3x3 grid) represents cell (3,7). Given `rules`, is the center cell alive in the next generation?"
    }
  }
}
```

`neighborhoods` を "x,y" キーのマップとして state にまとめ、各 question が自分の担当セルのキーだけをバッククォートで参照する（`primitives.md` の "dot-and-index paths in instructions" および `primitives/noul.md` の構造化 instructions 例に基づく設計。ただし `` `neighborhoods["3,7"]` `` という角括弧文字列キー記法自体がドキュメントの例に直接あるわけではなく、こちらの拡張適用——**推測**）。

JS SDK での呼び出し形状（`https://docs.typesafe.ai/sdk/javascript.md`、`https://docs.typesafe.ai/sdk/javascript/api/functions/noul.md` に基づく）:

```ts
import { noul } from "@typesafe-ai/sdk";

const response = await client.systemOne({
  state: { rules, neighborhoods },
  questions: {
    cell_3_7: noul(
      'The center cell of `neighborhoods["3,7"]` — is it alive next generation?'
    ),
  },
});
```

`noul(instructions?, criteria?)` のシグネチャは `sdk/javascript/api/functions/noul.md` に明記されている。

---

## 未解決・要プロトタイプ検証項目（まとめ）

1. `` `board.rows[3]` `` 型のインデックス付きバッククォートパスが実際にモデルへ正しく解決されるか（ドキュメント上は "dot-and-index paths" という一般論のみで、配列添字を含む完全な例文は未発見）。
2. 1リクエストに数百〜千問規模の `questions` を積んだ場合の実際の挙動・安定性（ドキュメントは上限を明記せず、実測が必要）。
3. 4文字/トークンという変換比の妥当性（TypeSafe固有のトークナイザ挙動は不明）。
4. 近傍モードでの盤面全体復元（隣接する neighborhoods 間の重複データ管理）は本調査の範囲外。
