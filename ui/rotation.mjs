/**
 * @file 組違いローテーション導出（プレゼン層の純モジュール）。
 *
 * 退役 engine/src/groups.js（git 0bf06ac）の不変条件（要監督を無監督にしない・左右別ドリル・
 * 両列被覆）を presentation day の形（name/mode/minutes、drill_id なし）に移植。
 * ただし groups.js の self 配分（Pass A/B）は wall-clock 崩壊の元なので移植せず
 * 「逐次レイアウト」に置換（設計仕様 §2.1・§3）。
 *
 * 逐次レイアウトの原則（§3.1）:
 *   - WU/CD（isBundle）→ together 行（左右同一・実尺占有）
 *   - 主自走ブロック（items が全て self mode）→ together 行（左右同一・実尺占有・裏埋めに使わない）
 *   - コーチ段（items に practice/lecture が含まれる）→ rotation 行（前後半2行・coachSide swap）
 *   - 裏埋めは selfFillPool から短い自走を1本充てる（selfFillPool は共通メニューに追加しない）
 *
 * 新不変条件（§3.3）:
 *   - 全 rows の minutes 合計 === pd.totalMinutes（窓）。不一致なら throw で即検出。
 *
 * @typedef {{name:string,minutes:number,category:string,mode:string,video:string|null,alternatives:string[]}} PdItem
 * @typedef {{block:string,isBundle:boolean,from:string,to:string,minutes:number,items:PdItem[]}} PdBlock
 * @typedef {{day:string,coachPresent:boolean,blocks:PdBlock[],totalMinutes:number}} PresentationDay
 */

/**
 * presentation day のアイテムのモードを practice/self に畳む。
 * lecture は practice として扱う（コーチ監督が必要な点で同等）。
 * @param {string} mode
 * @returns {'practice'|'self'}
 */
function weekdayMode(mode) {
  return mode === 'practice' || mode === 'lecture' ? 'practice' : 'self';
}

/**
 * ブロック内の全 item が self モードかを返す（主自走ブロック判定）。
 * @param {PdBlock} block
 * @returns {boolean}
 */
function isAllSelf(block) {
  return block.items.length > 0 && block.items.every((it) => weekdayMode(it.mode) === 'self');
}

/**
 * ブロック内に practice/lecture の item が1本以上あるかを返す（コーチ段判定）。
 * @param {PdBlock} block
 * @returns {boolean}
 */
function hasPractice(block) {
  return block.items.some((it) => weekdayMode(it.mode) === 'practice');
}

/**
 * 組違いローテーションを構築する（コーチ在席平日専用）。
 *
 * アルゴリズム（逐次レイアウト・設計仕様 §2.4・§3.1）:
 *   1. pd.blocks を先頭から順に走査。
 *   2. WU/CD（isBundle）→ together 行（左右同一・実尺占有）。
 *   3. 主自走ブロック（isAllSelf）→ together 行（左右同一・実尺占有）。
 *      ※主自走（ツーメン等）は裏埋めに溶かさない（wall-clock 崩壊の根源を断つ）。
 *   4. コーチ段（hasPractice）→ ブロック内の practice item を順に走査し、各 practice item ごとに
 *      rotation 行を前後半2行に展開（coachSide 交互）。中間 practice（3on3）も末尾 practice（5on5）も
 *      それぞれ自分の実尺で可視タイムラインに出る（先頭1本だけ膨らませない）。
 *      前半: coachSide=practice、相方=selfFillPool から短い自走。
 *      後半: 左右入替（coachSide 反転）。途中の self item は together 行で実尺占有。
 *   5. 末尾アサート: 全 rows.minutes 合計 === pd.totalMinutes（時計不変・throw で即検出）。
 *
 * @param {PresentationDay} pd
 * @param {PdItem[]} selfFillPool 裏埋め用の短い自走候補（buildSession が用意）
 * @returns {object} pd.rotation に付与する rotation オブジェクト
 */
export function buildRotation(pd, selfFillPool) {
  const startMin = timeToMin(pd.start);
  /** @type {Array} */
  const rows = [];
  let cur = startMin;
  let practiceRoundIdx = 0;

  // selfFillPool の消費インデックス（コーチ段ごとに順番に使う）
  let poolIdx = 0;

  for (const block of pd.blocks) {
    if (block.items.length === 0) continue;

    if (block.isBundle) {
      // WU / CD: together 行（左右同一・全幅・実尺占有）
      const mainItem = block.items.length === 1
        ? block.items[0]
        : _bundleMainItem(block);
      rows.push({
        type: 'together',
        from: minToTime(cur),
        label: block.label || block.block,
        minutes: block.minutes,
        drill: {
          name: mainItem.name,
          mode: mainItem.mode,
          video: mainItem.video,
          alternatives: mainItem.alternatives,
          components: mainItem.components || null,
        },
      });
      cur += block.minutes;
    } else if (isAllSelf(block)) {
      // 主自走ブロック: together 行（左右同一・全幅・実尺占有）
      // ブロック内に複数 item があれば代表1本（先頭）を主見出しにする
      const repItem = block.items[0];
      rows.push({
        type: 'together',
        from: minToTime(cur),
        label: block.label || block.block,
        minutes: block.minutes,
        drill: {
          name: repItem.name,
          mode: repItem.mode,
          video: repItem.video,
          alternatives: repItem.alternatives,
        },
      });
      cur += block.minutes;
    } else if (hasPractice(block)) {
      // コーチ段: ブロック内の practice item を「先頭1本だけ膨らませる」のではなく、
      // ブロックの items を順に走査して、各 practice item ごとに rotation 行を1ラウンド展開する。
      // これにより対人ブロックの中間 practice（3on3=チームディフェンス）も末尾 practice（5on5）も
      // それぞれ自分の実尺で見える行(spine-rotation)に出る（先頭1本だけ膨らませると2本目以降が
      // hidden plain-text にしか残らず可視タイムラインから黙って脱落する不具合の根治）。
      // 途中に挟まる self item は together 行として実尺占有する（左右同一・男女共通）。
      for (const item of block.items) {
        if (weekdayMode(item.mode) !== 'practice') {
          // ブロック内の自走 item は together 行で実尺占有（男女共通メニュー）。
          rows.push({
            type: 'together',
            from: minToTime(cur),
            label: block.label || block.block,
            minutes: item.minutes,
            drill: {
              name: item.name,
              mode: item.mode,
              video: item.video,
              alternatives: item.alternatives,
            },
          });
          cur += item.minutes;
          continue;
        }

        const practiceItem = item;
        // selfFillPool から裏埋め1本を選択（重複しないよう practice.name と別の name を使う）
        let fillItem = null;
        const startPool = poolIdx;
        while (poolIdx < (selfFillPool || []).length) {
          const candidate = selfFillPool[poolIdx];
          poolIdx++;
          if (candidate.name !== practiceItem.name) {
            fillItem = candidate;
            break;
          }
        }
        if (!fillItem) {
          // プールを全走査しても見つからない場合はフォールバック
          poolIdx = startPool;
          fillItem = { name: '自走ドリル', mode: 'self', video: null, alternatives: [] };
        }

        // coachSide は round ごと交互（偶数=男子先攻、奇数=女子先攻）
        const coachSide = practiceRoundIdx % 2 === 0 ? '男子' : '女子';
        const otherSide = coachSide === '男子' ? '女子' : '男子';

        const practiceCell = { name: practiceItem.name, mode: 'practice', video: practiceItem.video, alternatives: practiceItem.alternatives };
        const fillCell = { name: fillItem.name, mode: 'self', video: fillItem.video, alternatives: fillItem.alternatives };
        // コーチ側=要監督ドリル、相方=自走の1行を組む。
        const sideRow = (side, half, from, minutes) => ({
          type: 'rotation',
          round: practiceRoundIdx,
          half,
          from,
          minutes,
          coachSide: side,
          boys: side === '男子' ? practiceCell : fillCell,
          girls: side === '女子' ? practiceCell : fillCell,
        });

        // 5分グリッドで半割できる practice item だけ前後半に分けてコーチ側を入れ替える（配布フォーマットの
        // 5分単位要件。例: 15分→5/10）。割れない・10分未満の小尺（端数の philosophy-floor 等）は
        // 分割せずコーチ側のみの1行で実尺占有する（throw でプラン全体を落とさない）。
        const m = practiceItem.minutes;
        if (m >= 10 && m % 5 === 0) {
          const half1 = Math.floor(m / 10) * 5;
          const half2 = m - half1;
          rows.push(sideRow(coachSide, '前半', minToTime(cur), half1));
          cur += half1;
          rows.push(sideRow(otherSide, '後半', minToTime(cur), half2));
          cur += half2;
        } else {
          rows.push(sideRow(coachSide, '', minToTime(cur), m));
          cur += m;
        }

        practiceRoundIdx++;
      }
    } else {
      // その他（both_self 的なブロック）: together 行で実尺占有
      const repItem = block.items[0];
      rows.push({
        type: 'together',
        from: minToTime(cur),
        label: block.label || block.block,
        minutes: block.minutes,
        drill: {
          name: repItem.name,
          mode: repItem.mode,
          video: repItem.video,
          alternatives: repItem.alternatives,
        },
      });
      cur += block.minutes;
    }
  }

  // 時計不変アサート: 全 rows.minutes 合計 === pd.totalMinutes（窓）
  const rowsTotal = rows.reduce((s, r) => s + r.minutes, 0);
  if (rowsTotal !== pd.totalMinutes) {
    throw new Error(
      `buildRotation: rows minutes sum (${rowsTotal}) !== pd.totalMinutes (${pd.totalMinutes}) on day=${pd.day}. 時間消失を検出。`,
    );
  }

  return { kind: 'rotation', rows };
}

/**
 * WU/CD ブロックの代表 item を返す。
 * components 畳み込み後は先頭がダイナミックストレッチ（主見出し）になっているはず。
 * @param {PdBlock} block
 * @returns {PdItem}
 */
function _bundleMainItem(block) {
  // components フィールドを持つ item（WU集約済みの主見出し）を優先
  const withComponents = block.items.find((it) => it.components);
  if (withComponents) return withComponents;
  // 集約なしの複数itemバンドル（CDのジョグ→静的ストレッチ等）: 先頭を主見出しにし、
  // 残りを components に畳んで全itemを可視化する（代表1件だけ見せると残りが配布から消える）
  const head = block.items[0];
  if (block.items.length > 1) {
    return { ...head, components: block.items.slice(1).map((it) => it.name) };
  }
  return head;
}

/**
 * rotation rows の不変条件を検証する。違反を配列で返す（空配列 = 全条件充足）。
 * rows 版（buildRotation の出力 rows を直接検査）。
 *
 * 検査する不変条件:
 *   不変2: practice は rotation 行の coachSide 側にしか出ない（相方は必ず self）。
 *   不変3: 各 rotation 行で boys.name !== girls.name（左右に違うドリル）。
 *
 * @param {Array} rows buildRotation の返値 .rows
 * @returns {Array<{rowIdx:number, violation:string}>}
 */
export function findRotationViolations(rows) {
  /** @type {Array<{rowIdx:number, violation:string}>} */
  const violations = [];
  if (!Array.isArray(rows)) return violations;

  rows.forEach((row, idx) => {
    if (row.type !== 'rotation') return;
    // 不変3: 左右別ドリル
    if (row.boys.name === row.girls.name) {
      violations.push({ rowIdx: idx, violation: `boys.name === girls.name ('${row.boys.name}') — 左右に同じドリルが並んでいる` });
    }
    // 不変2: practice は coachSide 側にしか出ない
    const coachCell = row.coachSide === '男子' ? row.boys : row.girls;
    const otherCell = row.coachSide === '男子' ? row.girls : row.boys;
    if (coachCell.mode !== 'practice') {
      violations.push({ rowIdx: idx, violation: `coachSide '${row.coachSide}' のセルが practice でない (mode='${coachCell.mode}')` });
    }
    if (otherCell.mode === 'practice') {
      violations.push({ rowIdx: idx, violation: `非coachSide側のセルが practice mode になっている (name='${otherCell.name}')` });
    }
  });

  return violations;
}

/**
 * 列ごとにカバーしているドリル名の集合を返す（不変4: 両列被覆の検査用）。
 * together 行のドリルは両列共通なので両方に含める。
 *
 * @param {Array} rows buildRotation の返値 .rows
 * @param {'boys'|'girls'|'both'} side
 * @returns {string[]} ソート済み
 */
export function coveredColumnNames(rows, side = 'both') {
  const names = new Set();
  if (!Array.isArray(rows)) return [];
  for (const row of rows) {
    if (row.type === 'together') {
      names.add(row.drill.name);
    } else if (row.type === 'rotation') {
      if (side === 'boys' || side === 'both') names.add(row.boys.name);
      if (side === 'girls' || side === 'both') names.add(row.girls.name);
    }
  }
  return [...names].sort();
}

// ── 時刻ユーティリティ ────────────────────────────────────────────────────────

/**
 * 'HH:MM' → 分数（整数）。
 * @param {string} hhmm
 * @returns {number}
 */
function timeToMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * 分数（整数）→ 'HH:MM'。
 * @param {number} min
 * @returns {string}
 */
function minToTime(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
