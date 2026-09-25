// 盤面は "#"（生）/ "."（死）の行文字列の配列。座標は (行, 列)、0 から数える。
export const N = 16;

const D = [-1, 0, 1];

export const at = (b, r, c, torus) => {
  const h = b.length, w = b[0].length;
  if (torus) (r = (r + h) % h), (c = (c + w) % w);
  return b[r]?.[c] === "#";
};

export const count = (b, r, c, torus) =>
  D.flatMap((dr) => D.map((dc) => (dr || dc) && at(b, r + dr, c + dc, torus))).filter(Boolean).length;

export const window3 = (b, r, c, torus) =>
  D.map((dr) => D.map((dc) => (at(b, r + dr, c + dc, torus) ? "#" : ".")).join(""));

export const map = (b, f) => b.map((row, r) => [...row].map((_, c) => (f(r, c) ? "#" : ".")).join(""));

export const cells = (b) => b.flatMap((row, r) => [...row].map((_, c) => [r, c]));

export const step = (b, torus) =>
  map(b, (r, c) => {
    const n = count(b, r, c, torus);
    return at(b, r, c) ? n === 2 || n === 3 : n === 3;
  });

export const empty = () => Array(N).fill(".".repeat(N));

const place = (...parts) => {
  const b = empty().map((row) => [...row]);
  for (const [shape, r0, c0] of parts)
    shape.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && (b[r0 + r][c0 + c] = "#")));
  return b.map((row) => row.join(""));
};

const GLIDER = [".#.", "..#", "###"];
const PULSAR = [
  "..###...###..",
  ".............",
  "#....#.#....#",
  "#....#.#....#",
  "#....#.#....#",
  "..###...###..",
  ".............",
  "..###...###..",
  "#....#.#....#",
  "#....#.#....#",
  "#....#.#....#",
  ".............",
  "..###...###..",
];

export const PRESETS = {
  "glider + blinker": place([GLIDER, 1, 1], [["###"], 9, 9]),
  glider: place([GLIDER, 1, 1]),
  "R-pentomino": place([[".##", "##.", ".#."], 6, 7]),
  pulsar: place([PULSAR, 1, 1]),
  LWSS: place([[".#..#", "#....", "#...#", "####."], 6, 9]),
};

export const random = () => map(empty(), () => Math.random() < 0.3);
