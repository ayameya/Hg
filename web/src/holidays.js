const FIXED = [
  [1, 1], [2, 11], [2, 23], [4, 29], [5, 3], [5, 4], [5, 5], [8, 11], [11, 3], [11, 23],
];
const HAPPY_MONDAY = [
  [1, 2], [7, 3], [9, 3], [10, 2],
];

function nthMonday(y, m, n) {
  const first = new Date(y, m - 1, 1).getDay();
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
}

function equinox(y, base) {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

const cache = new Map();

function holidaysOf(y) {
  if (cache.has(y)) return cache.get(y);
  const set = new Set();
  const key = (m, d) => m * 100 + d;
  for (const [m, d] of FIXED) set.add(key(m, d));
  for (const [m, n] of HAPPY_MONDAY) set.add(key(m, nthMonday(y, m, n)));
  set.add(key(3, equinox(y, 20.8431)));
  set.add(key(9, equinox(y, 23.2488)));
  const base = [...set].sort((a, b) => a - b);
  for (const k of base) {
    const d = new Date(y, Math.floor(k / 100) - 1, k % 100);
    if (d.getDay() !== 0) continue;
    const s = new Date(d);
    do s.setDate(s.getDate() + 1);
    while (set.has(key(s.getMonth() + 1, s.getDate())));
    if (s.getFullYear() === y) set.add(key(s.getMonth() + 1, s.getDate()));
  }
  for (let m = 1; m <= 12; m++) {
    const days = new Date(y, m, 0).getDate();
    for (let d = 2; d < days; d++) {
      if (set.has(key(m, d))) continue;
      const prev = new Date(y, m - 1, d - 1);
      const next = new Date(y, m - 1, d + 1);
      if (set.has(key(prev.getMonth() + 1, prev.getDate())) && set.has(key(next.getMonth() + 1, next.getDate())) && new Date(y, m - 1, d).getDay() !== 0) {
        set.add(key(m, d));
      }
    }
  }
  cache.set(y, set);
  return set;
}

export function isHoliday(date) {
  return holidaysOf(date.getFullYear()).has((date.getMonth() + 1) * 100 + date.getDate());
}
