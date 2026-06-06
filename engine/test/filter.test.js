/**
 * @file Tests for the deterministic pool filters (court / grades / zone / sets).
 * Each test asserts a coaching constraint, not the regex mechanics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrill } from '../src/normalize.js';
import {
  courtFits,
  gradesFit,
  isZoneDrill,
  isSetsDrill,
  isInYear,
  filterPoolForDay,
} from '../src/filter.js';

const mw = '中学';
const CONFIG = {
  category: mw,
  grades: [1, 2],
  current_month: 8,
  philosophy: { zone_forbidden: true, sets_forbidden_in_year: true },
};

function drill(over) {
  return normalizeDrill({
    id: 'X',
    name: 'd',
    category: 'シュート',
    court: '不問',
    grades: '全',
    intensity_class: '中',
    ...over,
  });
}

test('F1 court: a full-court-only drill cannot be placed on a half-court day', () => {
  const full = drill({ court: '全面' });
  assert.equal(courtFits(full, '半面'), false);
  assert.equal(courtFits(full, '全面'), true);
});

test('F1 court: half/quarter/不問 drills fit any day', () => {
  for (const c of ['半面', '¼', '不問', '半面〜全面']) {
    assert.equal(courtFits(drill({ court: c }), '半面'), true, `${c} should fit half day`);
  }
});

test('F2 grades: drill must share a grade with the team to qualify', () => {
  assert.equal(gradesFit(drill({ grades: '中学3年' }), [1, 2]), false);
  assert.equal(gradesFit(drill({ grades: '中学2〜3年' }), [1, 2]), true);
  assert.equal(gradesFit(drill({ grades: '全' }), [1, 2]), true);
});

test('F3 zone: middle-school zone-forbidden teams exclude zone drills', () => {
  assert.equal(isZoneDrill(drill({ name: 'ゾーンディフェンス概略' })), true);
  assert.equal(isZoneDrill(drill({ name: 'man-to-man帰陣' })), false);
});

test('F4 sets: set-play drills are detected by name/notes keyword', () => {
  assert.equal(isSetsDrill(drill({ name: 'セットオフェンス基礎' })), true);
  assert.equal(isSetsDrill(drill({ name: 'ピック&ロール', notes: 'セットの一部' })), true);
  assert.equal(isSetsDrill(drill({ name: 'カットの合わせ' })), false);
});

test('in-year window: months 1-12 are all in-year (MVP contract)', () => {
  for (let m = 1; m <= 12; m++) assert.equal(isInYear(m), true, `month ${m}`);
});

test('filterPoolForDay: removes zone, sets, off-grade, and full-court-on-half', () => {
  const pool = [
    drill({ id: 'keep', court: '半面', grades: '全' }),
    drill({ id: 'zone', name: 'ゾーン守備' }),
    drill({ id: 'sets', name: 'セットオフェンス' }),
    drill({ id: 'g3', grades: '中学3年' }),
    drill({ id: 'full', court: '全面' }),
  ];
  const kept = filterPoolForDay(pool, CONFIG, '半面').map((d) => d.id);
  assert.deepEqual(kept, ['keep']);
});

test('filterPoolForDay: a non-middle-school team keeps zone drills', () => {
  const hs = { ...CONFIG, category: '高校' };
  const pool = [drill({ id: 'zone', name: 'ゾーン守備', court: '半面' })];
  assert.equal(filterPoolForDay(pool, hs, '半面').length, 1);
});
