/**
 * @file Deterministic scrimmage (紅白戦) team-split engine.
 *
 * Pure functions only — no I/O, no `Math.random`, no `Date`. Given the same
 * roster/attendees/teamCount/history/seed, `splitTeams` always returns the
 * same `teams`. Randomness is confined to a seeded mulberry32 PRNG so results
 * are reproducible and "もう一回" (retry) is just `seed + 1` from the caller.
 *
 * spec: docs/findings/spec-20260905-scrimmage-split.md §4, §10-A.
 *
 * @typedef {{ id: string, grade: 1|2|3, tier: number, heightCm: number, roles: string[] }} ScrimmagePlayer
 */

// ---------------------------------------------------------------------------
// Role vocabulary (single source of truth — roster.js imports this)
// ---------------------------------------------------------------------------

/**
 * Role groups by canonical (English) role id. §2.2.
 * @type {{ creation: string[], scoring: string[], defense: string[] }}
 */
export const ROLE_GROUPS = {
  creation: ['handler', 'passer'],
  scoring: ['shooter', 'slasher', 'rimAttacker'],
  defense: ['eliteDefender', 'rimProtector', 'rebounder'],
};

/**
 * Japanese label → canonical role id. Used by `roster.js` to parse the 役割
 * spreadsheet column (§2.1). Not part of the §10-A contract but exported so
 * the vocabulary stays in this one file.
 * @type {Object<string, string>}
 */
export const ROLE_LABELS = {
  'ハンドラー': 'handler',
  'パサー': 'passer',
  'シューター': 'shooter',
  'スラッシャー': 'slasher',
  'リムアタッカー': 'rimAttacker',
  'エリートディフェンダー': 'eliteDefender',
  'リムプロテクター': 'rimProtector',
  'リバウンダー': 'rebounder',
};

// ---------------------------------------------------------------------------
// mulberry32 PRNG
// ---------------------------------------------------------------------------

/**
 * mulberry32: small, fast, deterministic PRNG. Returns a function producing
 * floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [0, n) using the given PRNG. */
function randInt(rng, n) {
  return Math.floor(rng() * n);
}

/** Fisher-Yates shuffle (in place), using the given PRNG. Returns the array. */
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Infinite boustrophedon (snake) sequence of team indices: 0..n-1, n-1..0,
 * 0..n-1, ... Used by the §4.3 step-1 initial fill.
 * @param {number} teamCount
 */
function* serpentineOrder(teamCount) {
  for (;;) {
    for (let i = 0; i < teamCount; i++) yield i;
    for (let i = teamCount - 1; i >= 0; i--) yield i;
  }
}

// ---------------------------------------------------------------------------
// Team sizes
// ---------------------------------------------------------------------------

/**
 * How many people go on each of `teamCount` teams for `n` attendees.
 * Divide evenly; the remainder is handed out one each starting from team A.
 * §4.1.
 * @param {number} n
 * @param {number} teamCount
 * @returns {number[]}
 */
export function teamSizes(n, teamCount) {
  const base = Math.floor(n / teamCount);
  const remainder = n % teamCount;
  const sizes = [];
  for (let i = 0; i < teamCount; i++) {
    sizes.push(base + (i < remainder ? 1 : 0));
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Strength / scoring
// ---------------------------------------------------------------------------

/** Player strength: s = tier + 0.5 × (grade − 1). No upper bound. §4.2. */
function strength(player) {
  return player.tier + 0.5 * (player.grade - 1);
}

/**
 * Ids of the `teamCount` tallest attendees (height desc, tie → id asc).
 * §4.2 "身長上位 teamCount 名".
 * @param {ScrimmagePlayer[]} attendeePlayers
 * @param {number} teamCount
 * @returns {Set<string>}
 */
function tallTopIds(attendeePlayers, teamCount) {
  const sorted = [...attendeePlayers].sort((a, b) => {
    if (b.heightCm !== a.heightCm) return b.heightCm - a.heightCm;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return new Set(sorted.slice(0, teamCount).map((p) => p.id));
}

/**
 * Objective function J for a candidate split. Lower is better. §4.2.
 * @param {{ roster: ScrimmagePlayer[], teams: string[][], history: string[][][] }} args
 * @returns {number}
 */
export function scoreTeams({ roster, teams, history }) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const attendeePlayers = teams.flat().map((id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`scoreTeams: unknown player id in teams: ${id}`);
    return p;
  });
  const tallTop = tallTopIds(attendeePlayers, teams.length);

  const strengthSums = [];
  const heightAvgs = [];
  const grade3Counts = [];
  const grade2Counts = [];
  let R = 0;

  for (const teamIds of teams) {
    const players = teamIds.map((id) => byId.get(id));

    let sSum = 0;
    let hSum = 0;
    let g3 = 0;
    let g2 = 0;
    let hasHandler = false;
    let hasShooter = false;
    let hasRimDefense = false;
    for (const p of players) {
      sSum += strength(p);
      hSum += p.heightCm;
      if (p.grade === 3) g3++;
      if (p.grade === 2) g2++;
      if (p.roles.includes('handler')) hasHandler = true;
      if (p.roles.includes('shooter')) hasShooter = true;
      if (p.roles.includes('rimProtector') || tallTop.has(p.id)) hasRimDefense = true;
    }
    strengthSums.push(sSum);
    heightAvgs.push(players.length > 0 ? hSum / players.length : 0);
    grade3Counts.push(g3);
    grade2Counts.push(g2);
    R += (hasHandler ? 0 : 1) + (hasShooter ? 0 : 1) + (hasRimDefense ? 0 : 1);
  }

  const deltaS = Math.max(...strengthSums) - Math.min(...strengthSums);
  const deltaH = Math.max(...heightAvgs) - Math.min(...heightAvgs);
  const g3Spread = Math.max(0, Math.max(...grade3Counts) - Math.min(...grade3Counts) - 1);
  const g2Spread = Math.max(0, Math.max(...grade2Counts) - Math.min(...grade2Counts) - 1);
  const G = g3Spread + g2Spread;

  // P: total pair-count of "同チームだった" occurrences across up to-3 past rounds.
  let P = 0;
  for (const round of history ?? []) {
    // teamOf: playerId -> team index, for this past round.
    const teamOf = new Map();
    round.forEach((teamIds, idx) => {
      for (const id of teamIds) teamOf.set(id, idx);
    });
    for (const teamIds of teams) {
      for (let i = 0; i < teamIds.length; i++) {
        for (let j = i + 1; j < teamIds.length; j++) {
          const a = teamIds[i];
          const b = teamIds[j];
          if (teamOf.has(a) && teamOf.has(b) && teamOf.get(a) === teamOf.get(b)) {
            P += 1;
          }
        }
      }
    }
  }

  return 100 * deltaS + 40 * R + 2 * deltaH + 5 * G + 1 * P;
}

// ---------------------------------------------------------------------------
// splitTeams
// ---------------------------------------------------------------------------

/**
 * Split `attendees` into `teamCount` balanced teams. Deterministic for a
 * given `(roster, attendees, teamCount, history, seed)`. §4.3, §10-A.
 *
 * @param {{
 *   roster: ScrimmagePlayer[],
 *   attendees: string[],
 *   teamCount: 2|3,
 *   history: string[][][],
 *   seed: number
 * }} args
 * @returns {{ teams: string[][], seed: number }}
 */
export function splitTeams({ roster, attendees, teamCount, history, seed }) {
  if (teamCount !== 2 && teamCount !== 3) {
    throw new Error(`splitTeams: teamCount must be 2 or 3, got ${teamCount}`);
  }
  const byId = new Map(roster.map((p) => [p.id, p]));

  const seen = new Set();
  for (const id of attendees) {
    if (seen.has(id)) throw new Error(`splitTeams: duplicate attendee id: ${id}`);
    seen.add(id);
    if (!byId.has(id)) throw new Error(`splitTeams: attendee not in roster: ${id}`);
  }
  if (attendees.length < teamCount) {
    throw new Error(
      `splitTeams: attendees (${attendees.length}) must be >= teamCount (${teamCount})`,
    );
  }

  // §4.1: canonical id-ascending ordering of the attendee set.
  const sortedAttendees = [...attendees].sort();
  const n = sortedAttendees.length;
  const sizes = teamSizes(n, teamCount);
  const normalizedSeed = seed >>> 0;
  const rng = mulberry32(normalizedSeed);

  // Step 1: strength-desc (tie id-asc) serpentine fill, skipping teams that
  // already reached their target size.
  const byStrengthDesc = [...sortedAttendees].sort((a, b) => {
    const pa = byId.get(a);
    const pb = byId.get(b);
    const sa = strength(pa);
    const sb = strength(pb);
    if (sb !== sa) return sb - sa;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  /** @type {string[][]} */
  const teams = Array.from({ length: teamCount }, () => []);
  const order = serpentineOrder(teamCount);
  for (const id of byStrengthDesc) {
    // Advance through the serpentine sequence, skipping teams already at
    // their target size (§4.3 step 1).
    let idx = order.next().value;
    let guard = 0;
    while (teams[idx].length >= sizes[idx]) {
      idx = order.next().value;
      guard += 1;
      if (guard > n * teamCount + teamCount * 4) {
        throw new Error('splitTeams: internal error building serpentine fill');
      }
    }
    teams[idx].push(id);
  }

  // Step 2: perturb — swap `attendees.length` random cross-team pairs
  // (sizes unchanged: one-for-one swap between two different teams).
  if (teamCount >= 2) {
    for (let k = 0; k < n; k++) {
      const teamPairs = [];
      for (let a = 0; a < teamCount; a++) {
        for (let b = a + 1; b < teamCount; b++) teamPairs.push([a, b]);
      }
      const [ta, tb] = teamPairs[randInt(rng, teamPairs.length)];
      if (teams[ta].length === 0 || teams[tb].length === 0) continue;
      const ia = randInt(rng, teams[ta].length);
      const ib = randInt(rng, teams[tb].length);
      const tmp = teams[ta][ia];
      teams[ta][ia] = teams[tb][ib];
      teams[tb][ib] = tmp;
    }
  }

  // Step 3: local search. Enumerate all cross-team (team-index, player-index)
  // pairs, shuffle their trial order via the PRNG, and greedily accept any
  // swap that lowers J. One "周" (cycle) = one full pass; stop when a full
  // cycle makes zero improvements, or after 200 cycles.
  const MAX_CYCLES = 200;
  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    /** @type {Array<[number, number, number, number]>} */
    const candidates = [];
    for (let ta = 0; ta < teamCount; ta++) {
      for (let tb = ta + 1; tb < teamCount; tb++) {
        for (let ia = 0; ia < teams[ta].length; ia++) {
          for (let ib = 0; ib < teams[tb].length; ib++) {
            candidates.push([ta, ia, tb, ib]);
          }
        }
      }
    }
    shuffleInPlace(candidates, rng);

    let improved = false;
    for (const [ta, ia, tb, ib] of candidates) {
      const before = scoreTeams({ roster, teams, history });
      const tmp = teams[ta][ia];
      teams[ta][ia] = teams[tb][ib];
      teams[tb][ib] = tmp;
      const after = scoreTeams({ roster, teams, history });
      if (after < before) {
        improved = true;
      } else {
        // revert
        teams[tb][ib] = teams[ta][ia];
        teams[ta][ia] = tmp;
      }
    }
    if (!improved) break;
  }

  const finalTeams = teams.map((teamIds) => [...teamIds].sort());
  return { teams: finalTeams, seed: normalizedSeed };
}
