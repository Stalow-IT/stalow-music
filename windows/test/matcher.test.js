'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ArtistMatcher } = require('../src/matcher');
const m = new ArtistMatcher([
  { id: 'mbd', names: ['Mordechai Ben David'] }, { id: 'af', names: ['Avraham Fried'] },
  { id: 'ys', names: ['Yaakov Shwekey'] }, { id: 'ybc', names: ['Yeshiva Boys Choir'] },
  { id: 'ms', names: ['Motty Steinmetz'] }, { id: 'df', names: ['Duvid Fried'] },
]);
const top = (q) => (m.match(q)[0] || {}).id;
test('nicknames and initials', () => {
  for (const [q, id] of [['MBD', 'mbd'], ['fried', 'af'], ['shwekey', 'ys'], ['motty', 'ms'], ['ybc', 'ybc']]) assert.strictEqual(top(q), id, q);
});
test('loose spellings, typos and Hebrew', () => {
  for (const [q, id] of [['mordche ben dovid', 'mbd'], ['yakov schwekey', 'ys'], ['avrom fried', 'af'], ['moti steinmets', 'ms'], ['מרדכי בן דוד', 'mbd'], ['אברהם פריד', 'af']]) assert.strictEqual(top(q), id, q);
});
test('unrelated text matches nothing', () => assert.deepStrictEqual(m.match('reggaeton'), []));
