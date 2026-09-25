import { test } from "node:test";
import assert from "node:assert/strict";
import { step, count, window3, PRESETS, N } from "../src/life.js";

const blinker = [".....", "..#..", "..#..", "..#..", "....."];

test("blinker が回る", () => {
  assert.deepEqual(step(blinker, false), [".....", ".....", ".###.", ".....", "....."]);
  assert.deepEqual(step(step(blinker, false), false), blinker);
});

test("端の扱い: 外側は死とトーラス", () => {
  const b = ["#..", "...", "..#"];
  assert.equal(count(b, 0, 0, false), 0);
  assert.equal(count(b, 0, 0, true), 1); // (2,2) は (0,0) の左上
  assert.deepEqual(window3(b, 0, 0, false), ["...", ".#.", "..."]);
  assert.deepEqual(window3(b, 0, 0, true), ["#..", ".#.", "..."]);
});

test("トーラスでは端をまたいだ blinker も回る", () => {
  // 列 2 の 4,0,1 行が生（行 0 を中心にした縦の blinker）→ 行 0 で横一列になる
  const b = ["..#..", "..#..", ".....", ".....", "..#.."];
  assert.deepEqual(step(b, true), [".###.", ".....", ".....", ".....", "....."]);
});

test("プリセットは 16×16 で、形が盤面に収まる", () => {
  for (const [name, b] of Object.entries(PRESETS)) {
    assert.equal(b.length, N, name);
    for (const row of b) assert.match(row, /^[#.]{16}$/, name);
  }
  const live = (b) => b.join("").split("#").length - 1;
  assert.equal(live(PRESETS["glider + blinker"]), 8);
  assert.equal(live(PRESETS.pulsar), 48);
  assert.equal(live(PRESETS.LWSS), 9);
});
