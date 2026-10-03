/**
 * @file Tests for the scrimmage team-split engine.
 * spec: docs/findings/spec-20260905-scrimmage-split.md §4, §7, §8. Synthetic
 * ids/names only (no real player data).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// ---------------------------------------------------------------------------
// Member order inside each team (strength desc, tie → id asc)
// ---------------------------------------------------------------------------

/** s = tier + 0.5 × (grade − 1) — the spec §4.2 definition, restated here. */
function strengthOf(p) {
  return p.tier + 0.5 * (p.grade - 1);
}

test('splitTeams: each team lists members strength-desc with tier and grade mixed', () => {
  // Strengths: M01=1.0, M02=2.0, M03=3.0, M04=4.0, M05=5.0, M06=6.0 — all
  // distinct, and tier alone would order them differently from grade alone.
  const roster = [
    { id: 'M01', grade: 1, tier: 1, heightCm: 170, roles: [] },
    { id: 'M02', grade: 3, tier: 1, heightCm: 170, roles: [] },
    { id: 'M03', grade: 1, tier: 3, heightCm: 170, roles: [] },
    { id: 'M04', grade: 3, tier: 3, heightCm: 170, roles: [] },
    { id: 'M05', grade: 1, tier: 5, heightCm: 170, roles: [] },
    { id: 'M06', grade: 3, tier: 5, heightCm: 170, roles: [] },
  ];
  const attendees = roster.map((p) => p.id);
  const byId = new Map(roster.map((p) => [p.id, p]));

  for (const teamCount of [2, 3]) {
    for (let seed = 1; seed <= 12; seed++) {
      const { teams } = splitTeams({ roster, attendees, teamCount, history: [], seed });
      for (const team of teams) {
        const expected = [...team].sort((a, b) => {
          const d = strengthOf(byId.get(b)) - strengthOf(byId.get(a));
          if (d !== 0) return d;
          return a < b ? -1 : a > b ? 1 : 0;
        });
        assert.deepEqual(team, expected, `teamCount=${teamCount} seed=${seed}`);
        for (let i = 1; i < team.length; i++) {
          assert.ok(
            strengthOf(byId.get(team[i - 1])) >= strengthOf(byId.get(team[i])),
            `strength must not increase: ${team.join(',')}`,
          );
        }
      }
    }
  }
});

test('splitTeams: explicit expected order for one concrete split', () => {
  // Strength rises with the id here — M01=1.0, M02=2.0, M03=3.0, M04=4.0,
  // M05=5.0, M06=6.0 — built from mixed tier and grade (M02 is tier 1 / grade 3
  // = 2.0 while M03 is tier 3 / grade 1 = 3.0), so strength-desc is the exact
  // reverse of id-asc and the old contract cannot pass this assertion.
  const roster = [
    { id: 'M01', grade: 1, tier: 1, heightCm: 170, roles: ['handler'] },
    { id: 'M02', grade: 3, tier: 1, heightCm: 171, roles: ['shooter'] },
    { id: 'M03', grade: 1, tier: 3, heightCm: 172, roles: ['rimProtector'] },
    { id: 'M04', grade: 3, tier: 3, heightCm: 173, roles: ['handler'] },
    { id: 'M05', grade: 1, tier: 5, heightCm: 174, roles: ['shooter'] },
    { id: 'M06', grade: 3, tier: 5, heightCm: 175, roles: ['rebounder'] },
  ];
  const attendees = roster.map((p) => p.id);
  const { teams } = splitTeams({ roster, attendees, teamCount: 2, history: [], seed: 7 });
  // Team 1: 6.0 → 3.0 → 1.0. Team 2: 5.0 → 4.0 → 2.0. Pre-change this same
  // split read [['M01','M03','M06'], ['M02','M04','M05']].
  assert.deepEqual(teams, [
    ['M06', 'M03', 'M01'],
    ['M05', 'M04', 'M02'],
  ]);
});

test('splitTeams: equal strength ties break on id ascending', () => {
  // Two strength-2.0 pairs: (M04 grade3/tier1) and (M05 grade1/tier2), plus
  // (M07 grade1/tier2) and (M08 grade3/tier1) — four ids all at 2.0.
  const roster = [
    { id: 'M04', grade: 3, tier: 1, heightCm: 170, roles: [] },
    { id: 'M05', grade: 1, tier: 2, heightCm: 170, roles: [] },
    { id: 'M07', grade: 1, tier: 2, heightCm: 170, roles: [] },
    { id: 'M08', grade: 3, tier: 1, heightCm: 170, roles: [] },
  ];
  const attendees = roster.map((p) => p.id);
  // Every attendee has strength 2.0, so each team's order is decided purely
  // by the id tiebreak.
  const { teams } = splitTeams({ roster, attendees, teamCount: 2, history: [], seed: 9 });
  for (const team of teams) {
    assert.deepEqual(team, [...team].sort(), `equal strength → id asc: ${team.join(',')}`);
  }
  // And the union is still the full attendee set.
  assert.deepEqual([...teams.flat()].sort(), ['M04', 'M05', 'M07', 'M08']);
});

test('splitTeams: same seed twice → byte-identical member order', () => {
  const roster = makeRoster(13);
  const attendees = roster.map((p) => p.id);
  for (const teamCount of [2, 3]) {
    const a = splitTeams({ roster, attendees, teamCount, history: [], seed: 20260905 });
    const b = splitTeams({ roster, attendees, teamCount, history: [], seed: 20260905 });
    assert.equal(JSON.stringify(a.teams), JSON.stringify(b.teams), `teamCount=${teamCount}`);
  }
});

test('splitTeams: allocation (the member set per team) is unchanged by the reorder', () => {
  // Golden fixture captured from the pre-reorder implementation (teams were
  // then returned id-ascending). Sorting today's teams by id must reproduce it
  // exactly — proof that only the presentation order moved and the §4.3
  // distribution logic was not touched.
  const golden = JSON.parse(
    readFileSync(new URL('./scrimmage-allocation.golden.json', import.meta.url), 'utf8'),
  );
  const roster = makeRoster(13);
  const attendees = roster.map((p) => p.id);
  for (const teamCount of [2, 3]) {
    for (let seed = 1; seed <= 20; seed++) {
      const { teams } = splitTeams({ roster, attendees, teamCount, history: [], seed });
      assert.deepEqual(
        teams.map((t) => [...t].sort()),
        golden[`${teamCount}:${seed}`],
        `teamCount=${teamCount} seed=${seed}`,
      );
      assert.deepEqual(
        teams.map((t) => t.length),
        teamSizes(attendees.length, teamCount),
      );
    }
  }
});
