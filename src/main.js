import { N, at, map, step, PRESETS, random } from "./life.js";
import { MODES, ask } from "./jev.js";

const IDS = Object.keys(MODES);
const $ = (id) => document.getElementById(id);
const MAX_RUN = 100, MIN_MS = 1000;

let init = PRESETS["glider + blinker"];
let torus = false, gen = 0, playing = false, run = 0;
let ctrl = null, retrying = false, timer = 0;
let S; // 盤面ごと: { b: 盤面, p: { "r,c": 生である確率 } | null, right: 正しい次世代 | null }

const loadKey = () => { try { return localStorage.getItem("typesafeApiKey") ?? ""; } catch { return ""; } };
let key = loadKey();

const status = (s) => ($("status").textContent = s);

// 盤面4つ分のセルを作る
const views = {};
for (const id of [...IDS, "truth"]) {
  const el = document.createElement("div");
  el.className = "board";
  const [name, about] = MODES[id] ? [MODES[id].name, MODES[id].about] : ["本来の経過", "正しいルールで進めた盤面（Jev は使わない）"];
  el.innerHTML = `<h2>${name}</h2><p>${about}</p><div class="grid"></div>`;
  const grid = el.querySelector(".grid");
  views[id] = Array.from({ length: N * N }, (_, i) => {
    const cell = grid.appendChild(document.createElement("div"));
    cell.onclick = () => edit(Math.floor(i / N), i % N);
    return cell;
  });
  $("boards").appendChild(el);
}

const alpha = (p) => (p >= 0.5 ? 0.6 + 0.8 * (p - 0.5) : 0.8 * p);

function render() {
  for (const [id, cells] of Object.entries(views)) {
    const { b, p, right } = S[id];
    cells.forEach((cell, i) => {
      const r = Math.floor(i / N), c = i % N, live = at(b, r, c);
      const q = p?.[`${r},${c}`];
      cell.style.background = `rgba(30, 30, 60, ${q == null ? +live : alpha(q)})`;
      cell.classList.toggle("bad", !!right && live !== at(right, r, c));
      cell.title = q == null
        ? `(${r}, ${c}) ${live ? "生" : "死"}`
        : `(${r}, ${c}) 生である確率 ${q.toFixed(2)} / 正解: ${at(right, r, c) ? "生" : "死"}`;
    });
  }
  $("gen").textContent = gen;
  controls();
}

function controls() {
  $("play").textContent = playing ? "一時停止" : "再生";
  $("play").disabled = !key;
  $("step").disabled = !key || playing || !!ctrl;
  $("dead").setAttribute("aria-pressed", !torus);
  $("torus").setAttribute("aria-pressed", torus);
}

function stop() {
  playing = false;
  clearTimeout(timer);
  if (retrying) ctrl.abort(), (ctrl = null), (retrying = false), status(""); // 再試行待ちの世代は捨てる
  controls();
}

// 初期盤面の世代 0 に戻す。飛んでいる判定は捨てる
function reset() {
  stop();
  ctrl?.abort();
  ctrl = null;
  gen = 0;
  S = Object.fromEntries([...IDS, "truth"].map((id) => [id, { b: init, p: null, right: null }]));
  status("");
  render();
}

function edit(r, c) {
  if (gen !== 0 || playing || ctrl) return;
  init = map(init, (rr, cc) => at(init, rr, cc) !== (rr === r && cc === c));
  reset();
}

async function advance() {
  const my = (ctrl = new AbortController()), t0 = performance.now(), tor = torus;
  controls();
  let got;
  try {
    got = await Promise.all(
      IDS.map((id) =>
        ask(MODES[id].build(S[id].b, tor), {
          key,
          signal: my.signal,
          onRetry: (why, i, ms) => ((retrying = true), status(`${MODES[id].name}: ${why}、再試行 ${i}/3（${ms / 1000}秒後）`)),
        }).catch((e) => Promise.reject(Object.assign(e, { mode: MODES[id].name }))),
      ),
    );
  } catch (e) {
    if (my.signal.aborted) return; // リセットや再試行中の一時停止で取り消した
    my.abort(); // ほかのモードも止める
    ctrl = null, retrying = false;
    stop();
    if (e.kind === "key") $("keyerr").textContent = e.message;
    status(`${e.mode}: ${e.message ?? e}`);
    return;
  }
  if (ctrl !== my) return;
  ctrl = null, retrying = false;

  const next = {};
  IDS.forEach((id, k) => {
    const prev = S[id].b, m = MODES[id], p = {};
    const b = map(prev, (r, c) => (p[`${r},${c}`] = m.toAlive(prev, r, c, got[k][`c${r}_${c}`])) >= 0.5);
    next[id] = { b, p, right: step(prev, tor) };
  });
  next.truth = { b: step(S.truth.b, tor), p: null, right: null };
  const still = IDS.every((id) => !next[id].b.join("").includes("#") || next[id].b.join() === S[id].b.join());
  S = next;
  gen++;
  status("");
  if (playing && (++run >= MAX_RUN || still)) stop();
  render();
  if (playing) timer = setTimeout(advance, Math.max(0, MIN_MS - (performance.now() - t0)));
}

$("play").onclick = () => {
  if (playing) return stop();
  playing = true, run = 0;
  controls();
  if (!ctrl) advance();
};
$("step").onclick = () => advance();
$("reset").onclick = reset;
$("random").onclick = () => ((init = random()), reset());
$("preset").append(...Object.keys(PRESETS).map((n) => new Option(n, n)));
$("preset").onchange = (e) => ((init = PRESETS[e.target.value]), reset());
$("dead").onclick = () => ((torus = false), controls());
$("torus").onclick = () => ((torus = true), controls());

$("key").value = key;
$("save").onclick = () => {
  key = $("key").value.trim();
  try { localStorage.setItem("typesafeApiKey", key); } catch {}
  $("keyerr").textContent = "";
  controls();
};
$("clear").onclick = () => {
  key = $("key").value = "";
  try { localStorage.removeItem("typesafeApiKey"); } catch {}
  controls();
};

reset();
