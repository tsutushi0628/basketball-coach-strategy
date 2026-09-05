/**
 * @file Tests for the scrimmage team-split engine.
 * spec: docs/findings/spec-20260905-scrimmage-split.md §4, §7, §8. Synthetic
 * ids/names only (no real player data).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitTeams, scoreTeams, teamSizes } from '../src/scrimmage.js';

/** Build a synthetic roster of `n` players with varied grade/tier/height. */
function makeRoster(n) {
  const roster = [];
  for (let i = 1; i <= n; i++) {
    roster.push({
      id: 'M' + String(i).padStart(2, '0'),
      grade: ((i - 1) % 3) + 1,
      tier: ((i - 1) % 5) + 1,
      heightCm: 160 + ((i * 7) % 30),
      roles: [],
    });
  }
  return roster;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('splitTeams: same roster/attendees/teamCount/history/seed → same teams', () => {
  const roster = makeRoster(13);
  const attendees = roster.map((p) => p.id);
  const a = splitTeams({ roster, attendees, teamCount: 3, history: [], seed: 42 });
  const b = splitTeams({ roster, attendees, teamCount: 3, history: [], seed: 42 });
  assert.deepEqual(a.teams, b.teams);
  assert.equal(a.seed, 42);
  assert.equal(b.seed, 42);
});

test('splitTeams: a different seed can produce a different split', () => {
  const roster = makeRoster(13);
  const attendees = roster.map((p) => p.id);
  const base = splitTeams({ roster, attendees, teamCount: 3, history: [], seed: 1 });
  let foundDifferent = false;
  for (let s = 2; s <= 40; s++) {
    const alt = splitTeams({ roster, attendees, teamCount: 3, history: [], seed: s });
    if (JSON.stringify(alt.teams) !== JSON.stringify(base.teams)) {
      foundDifferent = true;
      break;
    }
  }
  assert.ok(foundDifferent, 'expected at least one differing split among seeds 2..40');
});

// ---------------------------------------------------------------------------
// teamSizes (§4.1)
// ---------------------------------------------------------------------------

test('teamSizes: concrete examples from spec §8', () => {
  assert.deepEqual(teamSizes(13, 3), [5, 4, 4]);
  assert.deepEqual(teamSizes(13, 2), [7, 6]);
  assert.deepEqual(teamSizes(5, 3), [2, 2, 1]);
});

test('teamSizes: matches the §4.1 rule for n = teamCount..20, teamCount = 2,3', () => {
  for (const teamCount of [2, 3]) {
    for (let n = teamCount; n <= 20; n++) {
      const sizes = teamSizes(n, teamCount);
      assert.equal(sizes.length, teamCount);
      assert.equal(
        sizes.reduce((a, b) => a + b, 0),
        n,
      );
      const base = Math.floor(n / teamCount);
      const remainder = n % teamCount;
      for (let i = 0; i < teamCount; i++) {
        assert.equal(sizes[i], base + (i < remainder ? 1 : 0), `n=${n} teamCount=${teamCount}`);
      }
    }
  }
});

test('splitTeams: produced team sizes match teamSizes for n = teamCount..20', () => {
  for (const teamCount of [2, 3]) {
    for (let n = teamCount; n <= 20; n++) {
      const roster = makeRoster(n);
      const attendees = roster.map((p) => p.id);
      const { teams } = splitTeams({ roster, attendees, teamCount, history: [], seed: 7 });
      assert.deepEqual(
        teams.map((t) => t.length),
        teamSizes(n, teamCount),
        `n=${n} teamCount=${teamCount}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// scoreTeams (§4.2)
// ---------------------------------------------------------------------------

test('scoreTeams: role-group deficiency (missing handler/shooter/rim-defense) raises J by 40 per gap', () => {
  const roster = [
    { id: 'M01', grade: 1, tier: 3, heightCm: 150, roles: ['handler'] },
    { id: 'M02', grade: 1, tier: 3, heightCm: 150, roles: ['shooter'] },
    { id: 'M03', grade: 1, tier: 3, heightCm: 150, roles: ['rimProtector'] },
    { id: 'M04', grade: 1, tier: 3, heightCm: 140, roles: [] },
    { id: 'M05', grade: 1, tier: 3, heightCm: 140, roles: [] },
    { id: 'M06', grade: 1, tier: 3, heightCm: 140, roles: [] },
  ];
  // Team A covers handler/shooter/rim-defense; team B covers none and is not
  // among the top-2 tallest (both are 150cm, team B is 140cm).
  const teams = [
    ['M01', 'M02', 'M03'],
    ['M04', 'M05', 'M06'],
  ];
  // ΔS=0 (equal tier/grade), R=3 (team B misses all three), ΔH=10 (150-140),
  // G=0 (single grade), P=0 (no history) → J = 40*3 + 2*10 = 140.
  assert.equal(scoreTeams({ roster, teams, history: [] }), 140);
});

test('scoreTeams: a past-3-round pair penalizes J via P', () => {
  const roster = [
    { id: 'M01', grade: 1, tier: 3, heightCm: 170, roles: [] },
    { id: 'M02', grade: 1, tier: 3, heightCm: 170, roles: [] },
    { id: 'M03', grade: 1, tier: 3, heightCm: 170, roles: [] },
    { id: 'M04', grade: 1, tier: 3, heightCm: 170, roles: [] },
  ];
  const teams = [
    ['M01', 'M02'],
    ['M03', 'M04'],
  ];
  const withoutHistory = scoreTeams({ roster, teams, history: [] });
  // M01/M02 were on the same past-round team; M03/M04 were not → exactly
  // one pair-occurrence added.
  const historyWithOnePair = [[['M01', 'M02', 'M03'], ['M04']]];
  const withHistory = scoreTeams({ roster, teams, history: historyWithOnePair });
  assert.equal(withHistory - withoutHistory, 1);
});

// ---------------------------------------------------------------------------
// Invalid input (§4.1, §7)
// ---------------------------------------------------------------------------

test('splitTeams: throws on an attendee id not present in roster', () => {
  const roster = makeRoster(5);
  assert.throws(() =>
    splitTeams({
      roster,
      attendees: ['M01', 'M02', 'M99'],
      teamCount: 2,
      history: [],
      seed: 1,
    }),
  );
});

test('splitTeams: throws on a duplicate attendee id', () => {
  const roster = makeRoster(5);
  assert.throws(() =>
    splitTeams({
      roster,
      attendees: ['M01', 'M01', 'M02'],
      teamCount: 2,
      history: [],
      seed: 1,
    }),
  );
});

test('splitTeams: throws when teamCount is not 2 or 3', () => {
  const roster = makeRoster(5);
  assert.throws(() =>
    splitTeams({
      roster,
      attendees: roster.map((p) => p.id),
      teamCount: 4,
      history: [],
      seed: 1,
    }),
  );
});

test('splitTeams: throws when attendees is empty (all absent)', () => {
  const roster = makeRoster(5);
  assert.throws(() =>
    splitTeams({ roster, attendees: [], teamCount: 2, history: [], seed: 1 }),
  );
});

test('splitTeams: throws when attendee count is below teamCount', () => {
  const roster = makeRoster(5);
  assert.throws(() =>
    splitTeams({
      roster,
      attendees: ['M01', 'M02'],
      teamCount: 3,
      history: [],
      seed: 1,
    }),
  );
});
