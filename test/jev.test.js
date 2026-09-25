import { test } from "node:test";
import assert from "node:assert/strict";
import { MODES, rules, ask, JevError } from "../src/jev.js";

const b = ["#..", "##.", "..."];

test("全盤面モード: 盤面と rules を渡し、全セルに質問する", () => {
  const { state, questions } = MODES.full.build(b, false);
  assert.deepEqual(state, { rules: rules(false, 3), board: b });
  assert.equal(Object.keys(questions).length, 9);
  assert.equal(questions.c1_2.type, "noul");
  assert.match(questions.c1_2.instructions, /`board\[1\]\[2\]`/);
  assert.match(rules(true, 16), /row above row 0 is row 15/);
  assert.match(rules(false, 16), /Cells outside the board are dead\./);
});

test("近傍モード: セルごとの 3×3", () => {
  const { state, questions } = MODES.near.build(b, false);
  assert.deepEqual(state.neighborhoods["0,0"], ["...", ".#.", ".##"]);
  assert.match(questions.c0_0.instructions, /`neighborhoods\["0,0"\]`/);
});

test("カウントモード: 数だけ渡し、生には死ぬか・死には生まれるかを聞く", () => {
  const { state, questions } = MODES.count.build(b, false);
  assert.deepEqual(Object.keys(state), ["n"]);
  assert.equal(state.n["0,1"], 3);
  assert.match(questions.c0_0.instructions, /Does this cell die\?/);
  assert.match(questions.c0_1.instructions, /come to life\?/);
  assert.equal(MODES.count.toAlive(b, 0, 0, 0.1), 0.9);
  assert.equal(MODES.count.toAlive(b, 0, 1, 0.8), 0.8);
  assert.equal(MODES.full.toAlive(b, 0, 0, 0.3), 0.3);
});

const res = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const answers = (qs, p = 0.7) => ({ model: "jev-1.13.0", answers: Object.fromEntries(Object.keys(qs).map((k) => [k, { type: "noul", noul: p }])) });
const qs = MODES.full.build(b, false).questions;
const noSleep = async () => {};

test("成功: 確率の表を返し、リクエストの形が合う", async () => {
  let sent;
  const fetch = async (url, init) => ((sent = { url, init }), res(200, answers(qs)));
  const out = await ask({ state: {}, questions: qs }, { key: "k", fetch, sleep: noSleep });
  assert.equal(out.c0_0, 0.7);
  assert.equal(sent.url, "/v1/systemone");
  assert.equal(sent.init.headers.Authorization, "Bearer k");
  assert.equal(JSON.parse(sent.init.body).model, "jev-1.13");
});

test("429 は Retry-After に従って再試行し、3回で諦める", async () => {
  const waits = [], retries = [];
  let n = 0;
  const fetch = async () => (n++, res(429, {}, { "retry-after-ms": "250" }));
  await assert.rejects(
    ask({ questions: qs }, { key: "k", fetch, sleep: async (ms) => waits.push(ms), onRetry: (...a) => retries.push(a) }),
    (e) => e instanceof JevError && e.kind === "retry",
  );
  assert.equal(n, 4);
  assert.deepEqual(waits, [250, 250, 250]);
  assert.deepEqual(retries.map((r) => r[1]), [1, 2, 3]);
});

test("5xx と通信エラーは 1→2→4 秒で再試行し、途中で成功すれば答えを返す", async () => {
  const waits = [];
  const seq = [() => res(503, {}), () => Promise.reject(new TypeError("net")), () => res(200, answers(qs, 0.2))];
  const out = await ask({ questions: qs }, { key: "k", fetch: async () => seq.shift()(), sleep: async (ms) => waits.push(ms) });
  assert.equal(out.c2_2, 0.2);
  assert.deepEqual(waits, [1000, 2000]);
});

test("401/403 と 4xx と答えの欠けは再試行しない", async () => {
  for (const [status, kind] of [[403, "key"], [401, "key"], [422, "fatal"]]) {
    let n = 0;
    await assert.rejects(ask({ questions: qs }, { key: "k", fetch: async () => (n++, res(status, { error: "x" })), sleep: noSleep }), (e) => e.kind === kind);
    assert.equal(n, 1);
  }
  const partial = answers(qs);
  delete partial.answers.c1_1;
  await assert.rejects(ask({ questions: qs }, { key: "k", fetch: async () => res(200, partial), sleep: noSleep }), (e) => e.kind === "missing");
});

test("取り消しは AbortError のまま投げる", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    ask({ questions: qs }, { key: "k", signal: ac.signal, fetch: async (_, i) => { i.signal.throwIfAborted(); }, sleep: noSleep }),
    (e) => e.name === "AbortError",
  );
});
