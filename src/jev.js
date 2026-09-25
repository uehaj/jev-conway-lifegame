import { at, count, window3, cells } from "./life.js";

export const rules = (torus, n) =>
  "Conway's Game of Life. '#' is a live cell, '.' is a dead cell. " +
  (torus
    ? `The board wraps around: the top and bottom edges are connected, and so are the left and right edges (the row above row 0 is row ${n - 1}, and the column left of column 0 is column ${n - 1}).`
    : "Cells outside the board are dead.") +
  " A live cell with 2 or 3 live neighbours stays alive; a dead cell with exactly 3 live neighbours becomes alive;" +
  " every other cell is dead in the next generation. Neighbours are the 8 surrounding cells.";

const questions = (b, q) =>
  Object.fromEntries(cells(b).map(([r, c]) => [`c${r}_${c}`, { type: "noul", instructions: q(r, c) }]));
const perCell = (b, f) => Object.fromEntries(cells(b).map(([r, c]) => [`${r},${c}`, f(r, c)]));
const asIs = (b, r, c, p) => p;

// build(盤面, トーラスか) → { state, questions }、toAlive(盤面, r, c, Noul の確率) → 生である確率
export const MODES = {
  full: {
    name: "全盤面モード",
    about: "盤面全体とルールを渡す",
    build: (b, torus) => ({
      state: { rules: rules(torus, b.length), board: b },
      questions: questions(b, (r, c) =>
        `Look at \`board\` (row ${r}, column ${c}, both 0-indexed; the character \`board[${r}][${c}]\`). Is this cell alive in the next generation?`),
    }),
    toAlive: asIs,
  },
  near: {
    name: "近傍モード",
    about: "セルの周り 3×3 とルールを渡す",
    build: (b, torus) => ({
      state: { rules: rules(torus, b.length), neighborhoods: perCell(b, (r, c) => window3(b, r, c, torus)) },
      questions: questions(b, (r, c) =>
        `\`neighborhoods["${r},${c}"]\` is a 3x3 window; its centre character is the cell. Is the centre cell alive in the next generation?`),
    }),
    toAlive: asIs,
  },
  count: {
    name: "カウントモード",
    about: "生きている隣の数を渡し、死ぬか / 生まれるかを聞く",
    build: (b, torus) => ({
      state: { n: perCell(b, (r, c) => count(b, r, c, torus)) },
      questions: questions(b, (r, c) =>
        at(b, r, c)
          ? `\`n["${r},${c}"]\` is the number of live neighbours of a live cell. A live cell survives only when it has 2 or 3 live neighbours. Does this cell die?`
          : `\`n["${r},${c}"]\` is the number of live neighbours of a dead cell. A dead cell comes to life only when it has exactly 3 live neighbours. Does this cell come to life?`),
    }),
    toAlive: (b, r, c, p) => (at(b, r, c) ? 1 - p : p),
  },
};

// kind: "key"（401/403）| "fatal"（その他 4xx）| "missing"（答えの欠け）| "retry"（再試行しきった）
export class JevError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const RETRIES = 3;
const TIMEOUT_MS = 30_000;
let modelChecked = false;

const sleepFor = (ms, signal) =>
  new Promise((ok, ng) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), ng(signal.reason)), { once: true });
  });

const retryDelay = (res, i) => {
  const ms = +res?.headers.get("retry-after-ms"), s = +res?.headers.get("retry-after");
  return ms > 0 ? ms : s > 0 ? s * 1000 : 1000 * 2 ** i;
};

// 1リクエストを投げ、{ "c<行>_<列>": Noul の確率 } を返す。429/529/5xx/通信/タイムアウトは再試行する。
// onRetry(理由, 何回目, 待つミリ秒)
export async function ask({ state, questions }, { key, signal, onRetry = () => {}, fetch = globalThis.fetch, sleep = sleepFor }) {
  for (let i = 0; ; i++) {
    let res, why;
    try {
      res = await fetch("/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jev-1.13.0", state, questions }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      why = e.name === "TimeoutError" ? "タイムアウト" : "通信エラー";
    }
    if (res?.ok) {
      const body = await res.json();
      if (!modelChecked && (modelChecked = true) && !body.model?.startsWith("jev-1.13"))
        console.warn(`モデルが jev-1.13 ではありません: ${body.model}`);
      const out = {};
      for (const k of Object.keys(questions)) {
        const p = body.answers?.[k]?.noul;
        if (typeof p !== "number") throw new JevError("missing", "答えが欠けています");
        out[k] = p;
      }
      return out;
    }
    if (res) {
      const s = res.status;
      if (s === 401 || s === 403) throw new JevError("key", "キーが無効です");
      if (s !== 429 && s < 500) throw new JevError("fatal", `${s} ${await res.text()}`);
      why = s === 429 ? "429 レート制限" : `${s} サーバエラー`;
    }
    if (i === RETRIES) throw new JevError("retry", `${why}、再試行をあきらめました`);
    const ms = retryDelay(res, i);
    onRetry(why, i + 1, ms);
    await sleep(ms, signal);
  }
}
