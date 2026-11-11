'use strict';
// Finds approved artists from how people type them: nicknames ("mbd"), initials, loose and Hebrew spellings,
// small typos. Same rules as the Android app (search/ArtistMatcher.kt + offline/SubsetNormalize.kt).

const JOINMARK = /['’‘`´"׳״]/g;
const NON_TOKEN = /[^a-z0-9֐-׿]+/;
const HEB = { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ז': 'z', 'ח': 'k', 'ט': 't', 'כ': 'k', 'ך': 'k', 'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'פ': 'p', 'ף': 'p', 'צ': 'c', 'ץ': 'c', 'ק': 'k', 'ר': 'r', 'ש': 's', 'ת': 't' };

const clean = (s) => (s || '').normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase().replace(JOINMARK, '');
const plainTokens = (s) => clean(s).split(NON_TOKEN).filter(Boolean);
const romanize = (w) => [...w].map((ch) => HEB[ch] ?? (/[֐-׿]/.test(ch) ? '' : ch)).join('');
const latinSkeleton = (s) => s.replace(/sh|ş/g, 's').replace(/ch|kh|ḥ|x/g, 'k').replace(/tz|ts/g, 'c').replace(/th/g, 't')
  .replace(/[aeiou]/g, '').replace(/[wyh']/g, '').replace(/v/g, 'b').replace(/f/g, 'p').replace(/q/g, 'k').replace(/[^a-z0-9]/g, '');
const skeletonTokens = (s) => plainTokens(s).map((w) => latinSkeleton(romanize(w))).filter((x) => x.length >= 2);

function damerau(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[a.length][b.length];
}
const wordMatches = (q, w) => q === w || (q.length >= 3 && w.startsWith(q))
  || (Math.max(q.length, w.length) >= 3 && Math.min(q.length, w.length) >= 2 && damerau(q, w, 1) <= 1);

const NICKNAMES = [
  ['mbd', 'Mordechai Ben David'], ['מבד', 'Mordechai Ben David'], ['מרדכי בן דוד', 'Mordechai Ben David'],
  ['fried', 'Avraham Fried'], ['af', 'Avraham Fried'], ['פריד', 'Avraham Fried'], ['אברהם פריד', 'Avraham Fried'],
  ['shwekey', 'Yaakov Shwekey'], ['schwekey', 'Yaakov Shwekey'], ['שוואקי', 'Yaakov Shwekey'],
  ['lipa', 'Lipa Schmeltzer'], ['ליפא', 'Lipa Schmeltzer'], ['motty', 'Motty Steinmetz'], ['מוטי', 'Motty Steinmetz'],
  ['beri', 'Beri Weber'], ['benny', 'Benny Friedman'], ['ishay', 'Ishay Ribo'], ['ישי ריבו', 'Ishay Ribo'],
  ['carlebach', 'Rabbi Shlomo Carlebach'], ['קרליבך', 'Rabbi Shlomo Carlebach'], ['shmueli', 'Shmueli Ungar'],
  ['abie', 'Abie Rotenberg'], ['8th day', '8th Day'], ['eighth day', '8th Day'], ['ms', 'Mordechai Shapiro'],
  ['schnitzler', 'Michoel Schnitzler'], ['mbc', 'Miami Boys Choir'], ['ybc', 'Yeshiva Boys Choir'],
  ['shulem', 'Shulem Lemmer'], ['dedi', 'Dedi Graucher'],
];

class ArtistMatcher {
  /** entries: [{ id, names: [..] }] */
  constructor(entries) {
    this.index = entries.map((e) => {
      const plain = e.names.map(plainTokens);
      return { e, plain: plain.map((t) => t.join(' ')), skeletons: e.names.map(skeletonTokens),
        initials: new Set(plain.filter((t) => t.length >= 2).map((t) => t.map((w) => w[0]).join(''))) };
    });
    this.nick = new Map();
    for (const [n, full] of NICKNAMES) {
      const target = plainTokens(full).join(' ');
      const hits = this.index.filter((ix) => ix.plain.includes(target));
      if (hits.length) this.nick.set(plainTokens(n).join(' '), hits);
    }
  }

  match(query, limit = 8) {
    const pq = plainTokens(query);
    if (!pq.length) return [];
    const joined = pq.join(' ');
    const sq = skeletonTokens(query);
    const score = new Map();
    const add = (e, s) => { if (!score.has(e.id) || score.get(e.id).s < s) score.set(e.id, { e, s }); };
    (this.nick.get(joined) || []).forEach((ix) => add(ix.e, 100));
    for (const ix of this.index) {
      if (pq.length === 1 && joined.length >= 2 && joined.length <= 5 && ix.initials.has(joined)) add(ix.e, 90);
      if (ix.plain.includes(joined)) add(ix.e, 95);
      if (sq.length && ix.skeletons.some((name) => sq.every((q) => name.some((w) => wordMatches(q, w))))) add(ix.e, 60 + 5 * sq.length);
      if (joined.length >= 3 && ix.plain.some((p) => p.includes(joined))) add(ix.e, 50);
    }
    const ranked = [...score.values()].sort((a, b) => b.s - a.s);
    const best = ranked.length ? ranked[0].s : 0;
    // weak look-alikes are dropped when there is a clearly better match
    return ranked.filter((x) => x.s >= best - 30).slice(0, limit).map((x) => x.e);
  }
}

module.exports = { ArtistMatcher, plainTokens, skeletonTokens };
