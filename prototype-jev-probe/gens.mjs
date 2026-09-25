// PROTOTYPE — wipe me. デモで並べる3つの盤面（全盤面モード・近傍モード・カウントモード）を、
// 同じ初期盤面から Jev の判定で N 世代進め、正しいライフゲームと並べて表示する。
// 実行: node gens.mjs [世代数=5]  （1世代につき API を3リクエスト呼ぶ）
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";

const RULES =
  "Conway's Game of Life. '#' is a live cell, '.' is a dead cell. Cells outside the board are dead. " +
  "A live cell with 2 or 3 live neighbours stays alive; a dead cell with exactly 3 live neighbours becomes alive; " +
  "every other cell is dead in the next generation. Neighbours are the 8 surrounding cells.";
const N = +(process.argv[2] ?? 5);
const init = [".#......", "..#.....", "###.....", "........", "........", ".....###", "........", "........"];
const H = init.length, W = init[0].length;
const cells = init.flatMap((row, r) => [...row].map((_, c) => [r, c]));
const key = (r, c) => `${r},${c}`;
const at = (b, r, c) => b[r]?.[c] === "#";
const nbrs = (b, r, c) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => (dr || dc) && at(b, r + dr, c + dc))).filter(Boolean).length;
const life = (b, r, c) => (at(b, r, c) ? [2, 3].includes(nbrs(b, r, c)) : nbrs(b, r, c) === 3);
const window3 = (b, r, c) => [-1, 0, 1].map((dr) => [-1, 0, 1].map((dc) => (at(b, r + dr, c + dc) ? "#" : ".")).join(""));
const toBoard = (f) => init.map((_, r) => [...init[r]].map((_, c) => (f(r, c) ? "#" : ".")).join(""));

// 各モードは盤面 b から { state, q(r,c), toAlive?(r,c,p) } を作る
const modes = {
  全盤面: (b) => ({
    state: { rules: RULES, board: b },
    q: (r, c) => `Look at \`board\` (row ${r}, column ${c}, both 0-indexed; the character \`board[${r}][${c}]\`). Is this cell alive in the next generation?`,
  }),
  近傍: (b) => ({
    state: { rules: RULES, neighborhoods: Object.fromEntries(cells.map(([r, c]) => [key(r, c), window3(b, r, c)])) },
    q: (r, c) => `\`neighborhoods["${r},${c}"]\` is a 3x3 window; its centre character is the cell. Is the centre cell alive in the next generation?`,
  }),
  カウント: (b) => ({
    state: { n: Object.fromEntries(cells.map(([r, c]) => [key(r, c), nbrs(b, r, c)])) },
    q: (r, c) =>
      at(b, r, c)
        ? `\`n["${r},${c}"]\` is the number of live neighbours of a live cell. A live cell survives only when it has 2 or 3 live neighbours. Does this cell die?`
        : `\`n["${r},${c}"]\` is the number of live neighbours of a dead cell. A dead cell comes to life only when it has exactly 3 live neighbours. Does this cell come to life?`,
    toAlive: (r, c, p) => (at(b, r, c) ? 1 - p : p),
  }),
};

const client = new TypeSafeClient();
let boards = Object.fromEntries([...Object.keys(modes), "正解"].map((k) => [k, init]));
let tokens = 0;
const show = (g) => {
  console.log(`\n-- 世代 ${g} ` + Object.entries(boards).map(([k, b]) => `${k}:${b.join("").split("#").length - 1}`).join(" ") + " （生きているセル数）");
  console.log("   " + Object.keys(boards).map((k) => k.padEnd(W)).join("  "));
  for (let r = 0; r < H; r++) console.log("   " + Object.values(boards).map((b) => b[r]).join("    "));
};
show(0);
for (let g = 1; g <= N; g++) {
  const next = await Promise.all(
    Object.entries(modes).map(async ([k, mk]) => {
      const m = mk(boards[k]);
      const res = await client.systemOne({ state: m.state, questions: Object.fromEntries(cells.map(([r, c]) => [`c${r}_${c}`, noul(m.q(r, c))])) });
      tokens += res.usage.input_tokens;
      return [k, toBoard((r, c) => { const p = res.answers[`c${r}_${c}`].noul; return (m.toAlive ? m.toAlive(r, c, p) : p) >= 0.5; })];
    }),
  );
  const b = boards.正解;
  boards = { ...Object.fromEntries(next), 正解: toBoard((r, c) => life(b, r, c)) };
  show(g);
}
console.log(`\n入力トークン合計 ${tokens}`);
