// PROTOTYPE — wipe me. Jev に全盤面モード/近傍モード/カウントモードで1世代分の判定をさせ、正解と並べて表示する。
// 実行: node probe.mjs [モード名...]  （TYPESAFE_API_KEY が必要。モード1つにつき API を1リクエスト呼ぶ）
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

const RULES =
  "Conway's Game of Life. '#' is a live cell, '.' is a dead cell. Cells outside the board are dead. " +
  "A live cell with 2 or 3 live neighbours stays alive; a dead cell with exactly 3 live neighbours becomes alive; " +
  "every other cell is dead in the next generation. Neighbours are the 8 surrounding cells.";


const SOFT_LIVE = "A live cell dies of loneliness if it has too few live neighbours, and dies of overcrowding if it has too many; with a comfortable amount of company it stays alive.";
const SOFT_DEAD = "A dead cell comes to life only when it has just the right number of live neighbours — a small group, neither lonely nor crowded.";
// ライフゲームの名前も数値も出さない
const SOFT = `A world of cells. '#' is a live cell, '.' is a dead cell. Cells outside the board are dead. Each cell's neighbours are the 8 cells around it. ${SOFT_LIVE} ${SOFT_DEAD}`;
// 8×8: 左上に glider、右下に blinker
const board = [
  ".#......",
  "..#.....",
  "###.....",
  "........",
  "........",
  ".....###",
  "........",
  "........",
];
const H = board.length, W = board[0].length;
const alive = (r, c) => board[r]?.[c] === "#";
const nbrs = (r, c) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => (dr || dc) && alive(r + dr, c + dc))).filter(Boolean).length;
const truth = (r, c) => (alive(r, c) ? [2, 3].includes(nbrs(r, c)) : nbrs(r, c) === 3);
const window3 = (r, c) => [-1, 0, 1].map((dr) => [-1, 0, 1].map((dc) => (alive(r + dr, c + dc) ? "#" : ".")).join(""));
const cells = board.flatMap((row, r) => [...row].map((_, c) => [r, c]));

const modes = {
  全盤面モード: {
    state: { rules: RULES, board },
    q: (r, c) => `Look at \`board\` (row ${r}, column ${c}, both 0-indexed; the character \`board[${r}][${c}]\`). Is this cell alive in the next generation?`,
  },
  近傍モード: {
    state: { rules: RULES, neighborhoods: Object.fromEntries(cells.map(([r, c]) => [`${r},${c}`, window3(r, c)])) },
    q: (r, c) => `\`neighborhoods["${r},${c}"]\` is a 3x3 window; its centre character is the cell. Is the centre cell alive in the next generation?`,
  },
  // 生きているセルには「死ぬか」、死んでいるセルには「生まれるか」だけを聞く。Noul の確率は変化する確率
  カウントモード: {
    state: { n: Object.fromEntries(cells.map(([r, c]) => [`${r},${c}`, nbrs(r, c)])) },
    q: (r, c) =>
      alive(r, c)
        ? `\`n["${r},${c}"]\` is the number of live neighbours of a live cell. A live cell survives only when it has 2 or 3 live neighbours. Does this cell die?`
        : `\`n["${r},${c}"]\` is the number of live neighbours of a dead cell. A dead cell comes to life only when it has exactly 3 live neighbours. Does this cell come to life?`,
    toAlive: (r, c, p) => (alive(r, c) ? 1 - p : p),
  },
  // 以下2つは、カウントモードと同じ「生なら死ぬか、死なら生まれるか」の分け方を、Jev が自分で数えるモードに入れたもの
  "全盤面モード/分割": {
    state: { board },
    q: (r, c) =>
      `Look at \`board\` ('#' live, '.' dead, outside the board is dead): the cell at row ${r}, column ${c} (0-indexed; \`board[${r}][${c}]\`) is ` +
      (alive(r, c)
        ? "live. A live cell survives only when 2 or 3 of its 8 surrounding cells are live. Does this cell die?"
        : "dead. A dead cell comes to life only when exactly 3 of its 8 surrounding cells are live. Does this cell come to life?"),
    toAlive: (r, c, p) => (alive(r, c) ? 1 - p : p),
  },
  "近傍モード/分割": {
    state: { neighborhoods: Object.fromEntries(cells.map(([r, c]) => [`${r},${c}`, window3(r, c)])) },
    q: (r, c) =>
      `\`neighborhoods["${r},${c}"]\` is a 3x3 window ('#' live, '.' dead) whose centre is a ` +
      (alive(r, c)
        ? "live cell. A live cell survives only when 2 or 3 of the other 8 cells are live. Does the centre cell die?"
        : "dead cell. A dead cell comes to life only when exactly 3 of the other 8 cells are live. Does the centre cell come to life?"),
    toAlive: (r, c, p) => (alive(r, c) ? 1 - p : p),
  },
  // 以下3つは、数値のルールをやめて「寂しすぎる/混みすぎると死ぬ」のような言葉だけでルールを伝えたもの
  "全盤面モード/定性": { state: { rules: SOFT, board }, q: (r, c) => modes["全盤面モード"].q(r, c) },
  "近傍モード/定性": { state: { rules: SOFT, neighborhoods: Object.fromEntries(cells.map(([r, c]) => [`${r},${c}`, window3(r, c)])) }, q: (r, c) => modes["近傍モード"].q(r, c) },
  "カウントモード/定性": {
    state: { n: Object.fromEntries(cells.map(([r, c]) => [`${r},${c}`, nbrs(r, c)])) },
    q: (r, c) =>
      alive(r, c)
        ? `\`n["${r},${c}"]\` is how many of the 8 surrounding cells of a live cell are live. ${SOFT_LIVE} Does this cell die?`
        : `\`n["${r},${c}"]\` is how many of the 8 surrounding cells of a dead cell are live. ${SOFT_DEAD} Does this cell come to life?`,
    toAlive: (r, c, p) => (alive(r, c) ? 1 - p : p),
  },
};
const only = process.argv.slice(2); // 例: node probe.mjs カウントモード 近傍モード/分割

const client = new TypeSafeClient();
for (const [name, m] of Object.entries(modes).filter(([n]) => !only.length || only.includes(n))) {
  const t0 = performance.now();
  const res = await client.systemOne({
    state: m.state,
    questions: Object.fromEntries(cells.map(([r, c]) => [`c${r}_${c}`, noul(m.q(r, c))])),
  });
  const ms = Math.round(performance.now() - t0);
  let ok = 0;
  const lines = board.map((_, r) =>
    [...board[r]].map((_, c) => {
      const raw = res.answers[`c${r}_${c}`].noul, p = m.toAlive ? m.toAlive(r, c, raw) : raw, pred = p >= 0.5, hit = pred === truth(r, c);
      ok += hit;
      return (pred ? "#" : ".") + (hit ? " " : "!") + String(Math.round(p * 9));
    }).join(" "),
  );
  console.log(`\n== ${name}  model=${res.model}  ${ms}ms  input_tokens=${res.usage.input_tokens}  正解 ${ok}/${cells.length}`);
  console.log("   Jev の判定（# 生 / . 死、! は正解と食い違い、数字は確率×9）      正解の次世代");
  lines.forEach((l, r) => console.log(`   ${l}     ${board[r].split("").map((_, c) => (truth(r, c) ? "#" : ".")).join("")}`));
}
console.log("\n現世代:\n" + board.map((l) => "   " + l).join("\n"));
