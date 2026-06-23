/**
 * @file パターン「タイムライン」— 縦の比例タイムライン（採用案）。練習メニューは男女共通（1本）。
 *
 * 主役は「日」: 組違い時は中央スパイン3列（左=男子・中央=時計・右=女子）で、クロックレールと
 * 比例高さカードを維持したまま男女のドリルが左右に展開する。together 行（WU/自走/CD）は3列を
 * 横断する全幅バンド。週＝Googleカレンダー型時間グリッド、月＝今月やること、年＝男女2行の1年の流れ。
 */

import {
  esc, modeTag, modeMark, altLine, videoLink, plainText, BLOCK_TINT,
  modeToggle, dayHeader, partHeader,
  goalsSection, monthSection, yearSection, assumptionsNote, goalsBar,
  genderChip, VIDEO_SVG,
} from './render-shared.mjs';

/** 分→比例高さ(px)。 */
const segH = (minutes) => Math.max(34, Math.round(minutes * 3.6));

/**
 * ドリル名をハッシュ駆動タップ要素（button[data-drill]）に変換する。
 * registry に無い名前は throw（カタログ不整合をビルド時に発覚）。
 * 「自走ドリル」プレースホルダはリンク化しない唯一の例外（§2.4）。
 * @param {string} name ドリル名
 * @param {Map} registry 名前→詳細オブジェクト
 * @returns {string} HTML（button[data-drill] または素テキスト）
 */
function drillTrig(name, registry) {
  if (name === '自走ドリル') return esc(name); // プレースホルダは素テキスト維持
  const detail = registry.get(name);
  if (!detail) throw new Error(`drill registry にドリル名が見つかりません: "${name}"`);
  return `<button type="button" class="drill-trig" data-drill="${esc(detail.id)}">${esc(name)}</button>`;
}

function trackSeg(b, drillIndex) {
  const tint = BLOCK_TINT[b.block] || 'var(--mute)';
  if (b.isBundle) {
    const names = b.items.map((it) => esc(it.name)).join('・');
    return `<div class="tlband" style="--t:${tint}">
      <span class="tbl">${esc(b.label)}</span>
      <span class="tbn">${names}</span>
      <span class="tbm">${b.minutes}分</span>
    </div>`;
  }
  // T4: カード1〜2行凝縮。名前14px+分数12px右寄せ+ラベル10px の1行目、alt条件付き2行目。
  // 手書き（コーチ指定）item は minutes が null のとき分数を出さず、note があれば素注記行（.alt 流用）で出す。
  const rows = b.items
    .map((x) => {
      const tag = modeTag(x.mode);
      const nameHtml = drillIndex ? drillTrig(x.name, drillIndex) : esc(x.name);
      const minsHtml = (x.minutes != null && x.minutes > 0) ? `<span class="tlm">${x.minutes}分</span>` : '';
      const noteHtml = x.note ? `<div class="alt">${esc(x.note)}</div>` : '';
      return `<div class="tdrill">
        <span class="tdn">${nameHtml}${videoLink(x.video)}</span>
        ${minsHtml}
        ${tag}
        ${noteHtml}
        ${altLine(x.alternatives, drillIndex)}
      </div>`;
    })
    .join('');
  // コーチ指定ブロックは見出しを大きく（tll-lg）＋時刻レンジを右肩に出す（項目<見出しの階層に直す）。
  const llCls = b.coach ? 'tll tll-lg' : 'tll';
  const llTime = b.coach && b.from ? `<span class="tll-time">${esc(b.from)}–${esc(b.to)}</span>` : '';
  return `<div class="tlcard" style="--t:${tint};min-height:${segH(b.minutes)}px">
    <div class="tlh"><span class="${llCls}">${esc(b.label)}</span>${llTime}</div>
    <div class="tlbody">${rows}</div>
  </div>`;
}

/** 共通メニューの縦比例タイムライン（rotation 以外の日用）。 */
function menuTimeline(pd, drillIndex) {
  const rows = pd.blocks
    .map((b) => {
      const h = b.isBundle ? 'auto' : segH(b.minutes) + 'px';
      return `<div class="tlrow" style="--rh:${h}">
        <div class="tlclock"><span class="tk">${esc(b.from)}</span></div>
        <div class="tlseg">${trackSeg(b, drillIndex)}</div>
      </div>`;
    })
    .join('');
  const endRow = `<div class="tlrow tlrow-end">
      <div class="tlclock"><span class="tk">${esc(pd.end)}</span></div>
      <div class="tlseg"><div class="tlend"><span class="tbl">終了</span><span class="tbn">今日の振り返りひとことで解散。</span></div></div>
    </div>`;
  return `<div id="plan-top" class="timeline">${rows}${endRow}</div>`;
}

/**
 * 中央スパイン3列タイムライン（rotation 日の日ビジュアル本体）。
 *
 * レイアウト: 左列=男子 / 中央=時刻クロック＋dot / 右列=女子
 * - together 行（WU/主自走/CD）: 3列を横断する全幅バンド
 * - rotation 行: 左右にドリルカード、中央に時刻＋dot（コーチ付き側にコーチタグ）
 * - 比例高さ（segH）は各ドリルカードの min-height で維持
 *
 * ON/OFF トグル: data-interact="on" = 中央スパイン3列、data-interact="off" = 共通メニュー1列注記。
 */
function rotationTimeline(pd, drillIndex) {
  const rot = pd.rotation;
  if (!rot || !rot.rows || rot.rows.length === 0) return '';

  const genderHeader = `<div class="spine-header">
    <div class="spine-col-label">${genderChip('男子')}</div>
    <div class="spine-clock-header"></div>
    <div class="spine-col-label">${genderChip('女子')}</div>
  </div>`;

  const rowsHtml = rot.rows.map((row) => {
    const h = segH(row.minutes);
    const tint = BLOCK_TINT[row.label] || 'var(--mute)';

    if (row.type === 'together') {
      // 男女同一メニュー（WU/主自走/CD）。左右2列ミラーで中央線がカードを貫かない構造。
      // 左右の中央向きの角だけ角丸を落とし、ひとつの帯に繋がって見える。
      const compHtml = row.drill?.components?.length
        ? `<span class="tbl-comp">${row.drill.components.map(esc).join(' / ')}</span>`
        : '';
      const drillName = row.drill?.name || row.label || '';
      const blockLabel = row.drill?.name && row.label && row.drill.name !== row.label ? row.label : '';
      const bandInner = `${blockLabel ? `<span class="tbl-block">${esc(blockLabel)}</span>` : ''}
          <span class="tbl">${esc(drillName)}</span>
          <span class="tbm">${row.minutes}分</span>
          ${compHtml}`;
      return `<div class="spine-row spine-together" style="--sh:${h}px;--t:${tint}">
        <div class="spine-band left">
          ${bandInner}
        </div>
        <div class="spine-clk">
          <span class="tk">${esc(row.from)}</span>
          <span class="spine-dot" style="background:var(--t)"></span>
        </div>
        <div class="spine-band right">
          ${bandInner}
        </div>
      </div>`;
    }

    if (row.type === 'rotation') {
      const boys = row.boys;
      const girls = row.girls;
      // T4: 名前+分数+ラベルの1行凝縮（spine-side内）。自走ラベルは非表示。
      const boysNameHtml = drillIndex ? drillTrig(boys.name, drillIndex) : esc(boys.name);
      const girlsNameHtml = drillIndex ? drillTrig(girls.name, drillIndex) : esc(girls.name);
      return `<div class="spine-row spine-rotation" style="min-height:${h}px">
        <div class="spine-side${boys.mode === 'practice' ? ' spine-coach' : ' spine-self'}">
          <div class="spine-row1">
            <span class="spine-name">${boysNameHtml}${videoLink(boys.video)}</span>
            <span class="spine-mins">${row.minutes}分</span>
            ${modeTag(boys.mode)}
          </div>
          ${altLine(boys.alternatives, drillIndex)}
        </div>
        <div class="spine-clk">
          <span class="tk">${esc(row.from)}</span>
          <span class="spine-dot" style="background:var(--orange)"></span>
          <span class="spine-half">${esc(row.half)}</span>
        </div>
        <div class="spine-side${girls.mode === 'practice' ? ' spine-coach' : ' spine-self'}">
          <div class="spine-row1">
            <span class="spine-name">${girlsNameHtml}${videoLink(girls.video)}</span>
            <span class="spine-mins">${row.minutes}分</span>
            ${modeTag(girls.mode)}
          </div>
          ${altLine(girls.alternatives, drillIndex)}
        </div>
      </div>`;
    }
    return '';
  }).join('');

  // 終了時刻行（pd.end を使う）。ダウン本体はエンジンのダウン枠が担うため、ここは終了マーカーのみ。
  const endBandInner = `<span class="tbl">終了</span>
      <span class="tbm">今日の振り返りひとことで解散。</span>`;
  const endRow = `<div class="spine-row spine-together spine-end">
    <div class="spine-band left spine-band-end">
      ${endBandInner}
    </div>
    <div class="spine-clk">
      <span class="tk">${esc(pd.end)}</span>
      <span class="spine-dot" style="background:var(--mute)"></span>
    </div>
    <div class="spine-band right spine-band-end">
      ${endBandInner}
    </div>
  </div>`;

  const onContent = `${genderHeader}<div id="plan-top" class="spine">${rowsHtml}${endRow}</div>`;

  const offNote = `<div class="inote" data-interact="off" hidden>
    <b>組違いOFF</b>：男女が別時間に同じメニューを各自フル（コーチが全段に付く）。<br>
    メニューは下の共通メニューを男女それぞれが順番に実施。
  </div>`;

  return `<div data-interact="on">${onContent}</div>${offNote}`;
}

/**
 * コーチ指定の上書き日（layout:"two-col"）専用の男女2列タイムライン。
 *
 * レイアウト: 左=男子セル / 中央=時刻クロック＋dot / 右=女子セル。
 *  - both 行（ラントレ等の男女共通）: 3列を横断する全幅バンド（together）。
 *  - 男女別行: 左右2セル。各セルは見出し(label・16px)＋itemリスト(name 14px・note は .alt)。
 * 既存トークン（spine/spine-band/spine-clk/tll/tll-lg/tdn/alt/genderChip）を再利用。
 * 手書きドリル名はカタログ外なので drillIndex を使わず素テキスト化する（throwさせない）。
 */
function twoColTimeline(pd) {
  const rows = pd.rows || [];
  if (rows.length === 0) return '';

  const genderHeader = `<div class="spine-header">
    <div class="spine-col-label">${genderChip('男子')}</div>
    <div class="spine-clock-header"></div>
    <div class="spine-col-label">${genderChip('女子')}</div>
  </div>`;

  // 1セルの中身（見出し＝大・itemリスト＝小note は .alt）。手書き名は素テキスト。
  const cellInner = (cell) => {
    if (!cell) return '<div class="tc2-empty">—</div>';
    const tint = BLOCK_TINT[cell.block] || 'var(--mute)';
    const items = (cell.items || [])
      .map((it) => `<div class="tdrill">
        <span class="tdn">${esc(it.name)}</span>
        ${it.note ? `<div class="alt">${esc(it.note)}</div>` : ''}
      </div>`)
      .join('');
    return `<div class="tc2-head"><span class="tll tll-lg" style="--t:${tint}">${esc(cell.label)}</span></div>
      <div class="tc2-body">${items}</div>`;
  };

  const rowsHtml = rows.map((row) => {
    if (row.both) {
      // 男女共通の全幅バンド（左右ミラー・中央クロック）。見出し大＋itemリスト。
      const tint = BLOCK_TINT[row.both.block] || 'var(--mute)';
      const bandInner = `<span class="tll tll-lg" style="--t:${tint}">${esc(row.both.label)}</span>
        ${(row.both.items || []).map((it) => `<span class="tc2-bn">${esc(it.name)}${it.note ? `（${esc(it.note)}）` : ''}</span>`).join('')}`;
      return `<div class="spine-row spine-together tc2-together" style="--t:${tint}">
        <div class="spine-band left">${bandInner}</div>
        <div class="spine-clk">
          <span class="tk">${esc(row.from)}</span>
          <span class="spine-dot" style="background:var(--t)"></span>
        </div>
        <div class="spine-band right">${bandInner}</div>
      </div>`;
    }
    // 男女別行: 左=男子 / 中央=時刻 / 右=女子。
    return `<div class="spine-row spine-rotation tc2-split">
      <div class="spine-side spine-self tc2-cell">${cellInner(row.boys)}</div>
      <div class="spine-clk">
        <span class="tk">${esc(row.from)}</span>
        <span class="spine-dot" style="background:var(--orange)"></span>
      </div>
      <div class="spine-side spine-self tc2-cell">${cellInner(row.girls)}</div>
    </div>`;
  }).join('');

  const endRow = `<div class="spine-row spine-together spine-end">
    <div class="spine-band left spine-band-end"><span class="tbl">終了</span><span class="tbm">今日の振り返りひとことで解散。</span></div>
    <div class="spine-clk">
      <span class="tk">${esc(pd.end)}</span>
      <span class="spine-dot" style="background:var(--mute)"></span>
    </div>
    <div class="spine-band right spine-band-end"><span class="tbl">終了</span><span class="tbm">今日の振り返りひとことで解散。</span></div>
  </div>`;

  return `${genderHeader}<div id="plan-top" class="spine">${rowsHtml}${endRow}</div>`;
}

// ── T2: ドリル詳細オーバーレイパネル（ハッシュ駆動）──────────────────────────────

/**
 * 週計画全体に登場する全ドリルのオーバーレイパネル（hidden）を1まとめに生成する。
 * ページの一番末尾（.levels 外）に置く固定オーバーレイコンテナ内に全パネルを格納。
 * §2.3 レイアウト・§2.4 状態パターン準拠。
 * @param {object} data buildPlanData の戻り値
 * @returns {string} HTML（#drill-overlay コンテナ）
 */
function drillDetailPanels(data) {
  const registry = data.drillIndex;
  if (!registry) return '';

  // 週計画全体（全日）に登場するドリル名を収集
  const nameSet = new Set();
  for (const pd of data.days) {
    if (pd.source === 'coach') continue; // 手書き名はカタログ外（詳細パネル対象外）
    // rotation rows から
    if (pd.rotation && pd.rotation.rows) {
      for (const row of pd.rotation.rows) {
        if (row.type === 'together' && row.drill?.name) nameSet.add(row.drill.name);
        if (row.type === 'rotation') {
          if (row.boys?.name) nameSet.add(row.boys.name);
          if (row.girls?.name) nameSet.add(row.girls.name);
          if (row.boys?.alternatives) row.boys.alternatives.forEach((n) => nameSet.add(n));
          if (row.girls?.alternatives) row.girls.alternatives.forEach((n) => nameSet.add(n));
        }
      }
    }
    // blocks から
    for (const b of pd.blocks) {
      for (const it of b.items) {
        if (it.name && it.name !== '自走ドリル') nameSet.add(it.name);
        if (it.alternatives) it.alternatives.filter((n) => n !== '自走ドリル').forEach((n) => nameSet.add(n));
      }
    }
  }

  // registry に無い名前は throw（§2.4: 不整合をビルド時に発覚）
  const allDrills = [];
  for (const name of nameSet) {
    const detail = registry.get(name);
    if (!detail) throw new Error(`drillDetailPanels: registry にドリル名がありません: "${name}"`);
    allDrills.push(detail);
  }

  if (allDrills.length === 0) return '';

  const panelsHtml = allDrills.map((d) => {
    const durText = d.durationMin === d.durationMax
      ? `${d.durationMin}分`
      : `${d.durationMin}〜${d.durationMax}分`;
    const metaParts = [
      d.court ? `コート ${esc(d.court)}` : null,
      d.balls ? `ボール ${esc(d.balls)}` : null,
      d.people ? `人数 ${esc(d.people)}` : null,
      `目安 ${esc(durText)}`,
      d.intensity ? `強度 ${esc(d.intensity)}` : null,
      d.grades ? `学年 ${esc(d.grades)}` : null,
      d.masteryStage ? `${esc(d.masteryStage)}` : null,
    ].filter(Boolean);
    const metaHtml = metaParts.length ? `<div class="dp-meta">${metaParts.join(' ・ ')}</div>` : '';

    const notesHtml = d.notesClean
      ? `<div class="dp-section"><span class="dp-label">やり方の要点</span><div class="dp-notes">${esc(d.notesClean)}</div></div>`
      : `<div class="dp-section"><span class="dp-label">やり方の要点</span><div class="dp-notes dp-unrecorded">このドリルの手順はカタログに未記載（ねらいとメタ情報を参照）</div></div>`;

    // いずれか候補（alternatives）は registry 経由でタップ可能に
    // このパネルを開く文脈は日ビューのみなので alternatives は各 row の情報を持たない
    // → パネル内にはいずれか行は出さない（§2.3 の代替候補はタイムライン側の altLine が担う）

    const videoHtml = d.video
      ? `<a class="dp-link" href="${esc(d.video)}" target="_blank" rel="noopener noreferrer">${VIDEO_SVG}<span>動画を見る</span></a>`
      : '';
    const sourceHtml = d.sourceUrl && d.sourceName
      ? `<a class="dp-link" href="${esc(d.sourceUrl)}" target="_blank" rel="noopener noreferrer"><span>参考元: ${esc(d.sourceName)}</span></a>`
      : '';
    const linksHtml = (videoHtml || sourceHtml)
      ? `<div class="dp-links">${videoHtml}${sourceHtml}</div>`
      : '';

    return `<div class="drill-panel" data-id="${esc(d.id)}" hidden>
      <div class="dp-header">
        <button type="button" class="drill-close" aria-label="閉じる">← 戻る</button>
      </div>
      <div class="dp-body">
        <div class="dp-name">${esc(d.name)}</div>
        <div class="dp-sub">${d.subSkill ? esc(d.subSkill) : ''}</div>
        ${d.aim ? `<div class="dp-section"><span class="dp-label">ねらい</span><div class="dp-aim">${esc(d.aim)}${d.metricMeaning ? `<span class="dp-metric">　効く指標: ${esc(d.metricMeaning)}</span>` : ''}</div></div>` : ''}
        ${notesHtml}
        ${metaHtml ? `<div class="dp-section"><span class="dp-label">メタ</span>${metaHtml}</div>` : ''}
        ${d.loadNotes ? `<div class="dp-load">注意: ${esc(d.loadNotes)}</div>` : ''}
        ${linksHtml}
      </div>
    </div>`;
  }).join('');

  return `<div id="drill-overlay" class="drill-overlay" hidden aria-hidden="true" aria-modal="true" role="dialog">
    <div class="drill-scrim"></div>
    <div class="drill-sheet">
      ${panelsHtml}
    </div>
  </div>`;
}

// ── 週カレンダーグリッド ユーティリティ（T4: 案A確定・データ導出・ハードコード禁止）──────

/** 'HH:MM' → 分。plan-data の timeToMin2 と同型・週グリッド用ローカル定義。 */
const toMin = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** px/分スケール: segH（m*3.6）と同係数で日スパインと比例感を揃える。承認モック尺（1分2.0px）を優先。 */
const PX_PER_MIN = 2.0;

/** 畳んだ未使用帯の固定高さ（px）。承認モックの46pxに合わせる。 */
const BREAK_PX = 46;

/** 曜日列に出すブロック一覧（items が空の曜日は null）。
 * コーチ指定の上書き日は時間割を持たない（from/to 空）ため週グリッドの時刻配置から除外する
 * （週ヘッダには「コーチ指定」だけ出す）。0:00 起点への潰れを防ぐ。 */
function dayBlocks(d) {
  if (d.source === 'coach') return null;
  const blocks = d.blocks.filter((b) => b.items.length > 0);
  return blocks.length ? blocks : null;
}

/** 区間配列（[from,to] のペア）を昇順でソートして隣接/重複を結合する。 */
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      if (sorted[i][1] > last[1]) last[1] = sorted[i][1];
    } else {
      merged.push(sorted[i].slice());
    }
  }
  return merged;
}

/**
 * 共通軸を導出する（案A確定）。
 * §5.2: 軸範囲を外側の毎時に丸め、collapse 境界も内側の毎時に丸める。
 * @param {Array} days buildDays 結果の days 配列
 * @returns {{ axisStart:number, axisEnd:number, used:number[][], collapse:{from:number,to:number}|null }|null}
 */
function buildWeekAxis(days) {
  const present = days.map(dayBlocks).filter(Boolean);
  if (present.length === 0) return null;

  // §5.2: axisStart は外側（floor to 60分）、axisEnd は外側（ceil to 60分）
  const rawStart = Math.min(...present.map((bs) => toMin(bs[0].from)));
  const rawEnd   = Math.max(...present.map((bs) => toMin(bs[bs.length - 1].to)));
  const axisStart = Math.floor(rawStart / 60) * 60;
  const axisEnd   = Math.ceil(rawEnd / 60) * 60;

  // 稼働帯の和集合（各曜日の稼働帯 [from, to] をマージ）
  const used = mergeRanges(present.map((bs) => [toMin(bs[0].from), toMin(bs[bs.length - 1].to)]));

  // 最大未使用ギャップを1本のブレイクに畳む（素値で検出）
  let collapseRaw = null;
  let maxGap = 0;
  for (let i = 1; i < used.length; i++) {
    const gap = used[i][0] - used[i - 1][1];
    if (gap > maxGap) {
      maxGap = gap;
      collapseRaw = { from: used[i - 1][1], to: used[i][0] };
    }
  }

  // §5.2: collapse 境界を内側の毎時に丸める（collapseFrom=ceil, collapseTo=floor）
  // 丸め後の幅が 60分未満なら畳まない（過剰畳み防止）
  let collapse = null;
  if (collapseRaw) {
    const collapseFrom = Math.ceil(collapseRaw.from / 60) * 60;
    const collapseTo   = Math.floor(collapseRaw.to / 60) * 60;
    if (collapseTo - collapseFrom >= 60) {
      collapse = { from: collapseFrom, to: collapseTo };
    }
  }

  return { axisStart, axisEnd, used, collapse };
}

/**
 * 共通軸上の絶対時刻(min) → 縦px。畳む区間より後はBREAK_PX分詰める。
 */
function axisY(min, axis) {
  if (axis.collapse && min >= axis.collapse.to) {
    const before = (axis.collapse.from - axis.axisStart) * PX_PER_MIN;
    const after  = (min - axis.collapse.to) * PX_PER_MIN;
    return before + BREAK_PX + after;
  }
  return (min - axis.axisStart) * PX_PER_MIN;
}

/** 各ブロックの絶対 top/height（共通軸・全曜日同一スケール）。 */
function blockRect(block, axis) {
  const top    = axisY(toMin(block.from), axis);
  const height = (toMin(block.to) - toMin(block.from)) * PX_PER_MIN;
  return { top, height };
}

/**
 * 週カレンダーグリッドのガター目盛りHTML。
 * §5.2: 目盛り・罫線は可視区間内の毎時のみ（端数時刻は出さない）。
 */
function gutterTicks(axis) {
  const ticks = [];
  // 各稼働区画の可視時間帯内の毎時のみ打つ
  for (const [from, to] of axis.used) {
    // 区画の外側毎時を軸の範囲から求める
    const fromHour = Math.floor(from / 60) * 60; // 既に axisStart が floor 済みなのでここでも整合
    const toHour   = Math.ceil(to / 60) * 60;
    for (let t = fromHour; t <= toHour; t += 60) {
      // axisStart 〜 axisEnd の範囲内のみ
      if (t >= axis.axisStart && t <= axis.axisEnd) {
        // collapse 区間の中にある時刻は出さない（飛んでいる区間）
        if (axis.collapse && t > axis.collapse.from && t < axis.collapse.to) continue;
        ticks.push({ y: axisY(t, axis), label: hhmm(t) });
      }
    }
  }
  // 重複除去
  const seen = new Set();
  return ticks.filter((tk) => {
    if (seen.has(tk.label)) return false;
    seen.add(tk.label);
    return true;
  });
}

/** hhmm ヘルパー（plan-data にも同定義がある・ここはグリッドローカル） */
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 週レベル: Googleカレンダー型の時間グリッド。days と focus を渡せば任意の週を描ける（複数週の実切替用）。 */
function weekLevel(data, days = data.days, focus = '') {
  const axis = buildWeekAxis(days);
  const focusNote = focus ? `<p class="note"><b style="color:var(--orange-deep)">今週の焦点</b>　${esc(focus)}</p>` : '';
  if (!axis) {
    return `<h3 class="lvh">この週の練習</h3>${focusNote}<p class="note">この週は予定が入っていません。</p>`;
  }

  // グリッド全体の高さ
  const totalH = axisY(axis.axisEnd, axis) + 8;

  // 曜日ヘッダ
  const SHARE_LABEL = { rotation: '組違いローテ', together: '男女合同', independent: 'コーチ不在（各自）', authored: '' };
  const SHARE_NOTE  = { rotation: '（左右の段取りは日タブ）', together: '', independent: '', authored: '' };

  const dayHeads = days.map((d, i) => {
    const colIdx = i + 2;
    const blocks = dayBlocks(d);
    const fromLabel = blocks ? blocks[0].from : '';
    const toLabel   = blocks ? blocks[blocks.length - 1].to : '';
    const shareLabel = SHARE_LABEL[d.sharedKind] || d.sharedKind;
    const shareNote  = SHARE_NOTE[d.sharedKind] || '';
    return `<div class="wg-dayhead" style="grid-column:${colIdx}">
      <span class="wd">${esc(d.day)}</span>
      <span class="wr">${esc(shareLabel)}${esc(shareNote)}</span>
      <span class="wt">${esc(fromLabel)}–${esc(toLabel)}</span>
    </div>`;
  }).join('');

  // 時刻ガター（毎時のみ）
  const ticks = gutterTicks(axis);
  const ticksHtml = ticks.map((tk) =>
    `<span class="wg-tick" style="top:${Math.round(tk.y)}px">${esc(tk.label)}</span>`
  ).join('');

  // 共通水平罫線（毎時のみ・端数なし）
  const rulePositions = new Set();
  for (const tk of ticks) {
    rulePositions.add(Math.round(tk.y));
  }
  const rulesHtml = [...rulePositions].map((y) =>
    `<div class="wg-rule" style="top:${y}px"></div>`
  ).join('');

  // §5.1: 畳みブレイク帯は「・・・」（中黒3つ）のみ。ラベル/ピルなし。
  let breakHtml = '';
  if (axis.collapse) {
    const breakY = Math.round(axisY(axis.collapse.from, axis) + (BREAK_PX / 2));
    breakHtml = `<div class="wg-break" style="top:${breakY}px;transform:translateY(-50%)" aria-label="昼間の空き時間（省略）">
      <span class="wg-breakmark">・・・</span>
    </div>`;
  }

  // 各曜日列のイベントブロック
  const colsHtml = days.map((d, i) => {
    const colIdx = i + 2;
    const blocks = dayBlocks(d);
    if (!blocks) {
      // §5.1: 空曜日は「—」（emダッシュ）
      return `<div class="wg-col" style="grid-column:${colIdx};height:${Math.round(totalH)}px">
        <div class="wg-noday">—</div>
      </div>`;
    }
    const eventsHtml = blocks.map((b) => {
      const { top, height } = blockRect(b, axis);
      const tint = BLOCK_TINT[b.block] || 'var(--mute)';
      const isCoach = b.items.some((it) => it.mode === 'practice' || it.mode === 'lecture');
      const main = b.isBundle
        ? esc(b.label)
        : esc(b.items[0] ? b.items[0].name : b.label);
      const isMini = height < 20;
      if (isMini) {
        return `<div class="ev mini" style="top:${Math.round(top)}px;height:${Math.max(14, Math.round(height))}px;--t:${tint}">
          <span class="evt">${esc(b.from)} ${esc(b.label)}</span>
        </div>`;
      }
      return `<div class="ev${isCoach ? ' coach' : ''}" style="top:${Math.round(top)}px;height:${Math.round(height)}px;--t:${tint}">
        <span class="evt">${esc(b.from)}</span>
        <span class="evl">${esc(b.label)}</span>
        <span class="evn">${main}</span>
        <span class="evm">${b.minutes}分</span>
      </div>`;
    }).join('');
    return `<div class="wg-col" style="grid-column:${colIdx};height:${Math.round(totalH)}px">
      ${eventsHtml}
    </div>`;
  }).join('');

  return `<h3 class="lvh">この週の練習（火・水・木・金・土）</h3>
    ${focusNote}
    <div class="weekgrid">
      <div class="wg-corner"></div>
      ${dayHeads}
      <div class="wg-gutter" style="height:${Math.round(totalH)}px">
        ${ticksHtml}
      </div>
      <div class="wg-rules" style="height:${Math.round(totalH)}px">
        ${rulesHtml}
        ${breakHtml}
      </div>
      ${colsHtml}
    </div>
    <div class="wg-legend">
      <span class="lk"><span class="sw coach"></span>コーチ付き／合同</span>
      <span class="lk"><span class="sw self"></span>自走</span>
    </div>
    <p class="note"><b>共通の縦時刻軸1本</b>を全曜日で共有し、同じ「1分＝px」尺で揃えています。土の午前帯と平日の夕帯の間にある長い空き時間は、1本の「空き」ブレイクに畳んでいます。組違い日（火・金）の男女の左右内訳は「日」タブで見られます。</p>`;
}

/** 1つのセッション（単一日 or 区画）のタイムライン本体（rotation か共通メニュー）を描く。 */
function sessionTimeline(session, drillIndex) {
  const isRotation = session.sharedKind === 'rotation' && session.rotation;
  return isRotation ? rotationTimeline(session, drillIndex) : menuTimeline(session, drillIndex);
}

function dayTimeline(data, pd, idx) {
  // コーチ指定の上書き日は手書きドリル名（registry 外）なので drillIndex を渡さず素テキスト化する。
  const reg = pd.source === 'coach' ? null : data.drillIndex;
  // コーチ指定の男女2列日（twoCol）: 専用の男女2列タイムライン。
  let body;
  if (pd.source === 'coach' && pd.twoCol) {
    body = twoColTimeline(pd);
    return `<article class="day pageb" data-day="${esc(pd.day)}"${idx === 0 ? '' : ' hidden'}>
    ${dayHeader(pd, data.month)}
    ${body}
    <pre class="plain" hidden>${esc(plainText(data, pd))}</pre>
  </article>`;
  }
  // 2部構成の日（火）: 区画ごとに部ヘッダ＋タイムラインを分けて描く（ヘッダ・タイムラインを分離）。
  if (Array.isArray(pd.parts) && pd.parts.length > 0) {
    body = pd.parts
      .map((part, pi) => `<section class="daypart">
        ${partHeader(part, pi)}
        ${sessionTimeline(part, reg)}
      </section>`)
      .join('');
  } else {
    body = sessionTimeline(pd, reg);
  }
  // rotation 日は中央スパインのみ表示（折りたたみ「共通メニュー」廃止・T3）。
  // 詳細はハッシュ駆動オーバーレイ（#drill-overlay）で表示。日タイムラインに詳細セクションは付与しない。
  return `<article class="day pageb" data-day="${esc(pd.day)}"${idx === 0 ? '' : ' hidden'}>
    ${dayHeader(pd, data.month)}
    ${body}
    <pre class="plain" hidden>${esc(plainText(data, pd))}</pre>
  </article>`;
}

const PATTERN_CSS = `
/* ── 2部構成の日（火）の区画セクション ── */
.daypart{margin-bottom:20px}
.daypart:last-child{margin-bottom:0}

/* ── タイムライン（日レベル・非rotation） ── */
.timeline{position:relative;padding-left:54px}
.timeline::before{content:"";position:absolute;left:44px;top:6px;bottom:16px;width:1px;background:var(--hair)}
.tlrow{position:relative;display:flex;min-height:var(--rh,auto);margin-bottom:9px}
.tlclock{position:absolute;left:-54px;top:0;width:54px;display:flex;align-items:flex-start}
/* T6: tk は素テキスト12px（枠線・ピル廃止。背景は中央線マスク用） */
.tk{font-size:12px;font-weight:700;color:var(--ink);background:var(--bg);padding:3px 4px;font-variant-numeric:tabular-nums}
.tlclock::after{content:"";position:absolute;left:41px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--t,var(--orange))}
.tlseg{flex:1;min-width:0;display:flex}
/* T5: tlcard は surface+1px hair罫線（shadow廃止） */
.tlcard{flex:1;background:var(--surface);border-radius:10px;border:1px solid var(--hair);padding:11px 15px;display:flex;flex-direction:column;justify-content:center}
.tlh{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
/* T6: tll は 12px/700（補助段・カード内アイブロウ） */
.tll{font-size:12px;font-weight:700;color:var(--t);letter-spacing:.04em}
.tll-lg{font-size:16px}
.tll-time{margin-left:auto;font-size:12px;font-weight:700;color:var(--mute);font-variant-numeric:tabular-nums}
/* T4/T5: tdrill は 1行基本（名前14px+分数12px右寄せ+ラベル10px）。gap で隙間 */
.tlbody{display:flex;flex-direction:column;gap:7px}
.tdrill{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
/* T6: tdn は 14px/700（カード見出し・本文と同サイズなら太さで差を付ける） */
.tdn{font-size:14px;font-weight:700;line-height:1.45;min-width:0;flex:1}
.tdrill .tlm{margin-left:auto;font-size:12px;color:var(--mute);flex:0 0 auto}
.tdrill .alt{flex-basis:100%;margin-top:0}
/* T5: tlband は bg+hair罫線（shadow廃止） */
.tlband{flex:1;display:flex;align-items:center;gap:9px;background:var(--bg);border:1px solid var(--hair);border-radius:10px;padding:7px 13px}
/* T5: tbl は 14px/700（本文段・ただしバンドは若干大きく） */
.tlband .tbl{font-size:14px;font-weight:700;color:var(--t);flex:0 0 auto}
.tlband .tbn{font-size:12px;color:var(--mute);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* T5: tbm は 12px（補助段） */
.tlband .tbm{font-size:12px;color:var(--mute);flex:0 0 auto}
.tlrow-end .tlend{flex:1;background:var(--bg);border:1px solid var(--hair);border-radius:10px;padding:9px 13px}
.tlrow-end .tbl{font-size:14px;font-weight:700;color:var(--mute);margin-right:8px}
.tlrow-end .tbn{font-size:12px;color:var(--mute)}
.tlrow-end .tlclock::after{background:var(--mute)}

/* ── 週カレンダーグリッド CSS（Googleカレンダー型・Hallmark準拠） ── */
/* T5: weekgrid は surface+line-2罫線（shadow廃止）*/
.weekgrid{
  display:grid;
  grid-template-columns:52px repeat(5,1fr);
  background:var(--surface);
  border-radius:14px;
  border:1px solid var(--line-2);
  padding:14px 14px 16px;
  overflow:hidden
}
.wg-corner{grid-column:1;grid-row:1}
.wg-dayhead{grid-row:1;text-align:center;padding:0 4px 10px;border-bottom:1px solid var(--hair)}
/* T6: wd は 17px/700（H3段・列見出し） */
.wg-dayhead .wd{display:block;font-size:17px;font-weight:700;letter-spacing:-.01em}
/* T6: wr は 12px/700（補助段） */
.wg-dayhead .wr{display:block;font-size:12px;color:var(--orange-deep);font-weight:700;letter-spacing:.04em;margin-top:1px}
/* T5: wt は 12px（補助段） */
.wg-dayhead .wt{display:block;font-size:12px;color:var(--mute);margin-top:3px;font-variant-numeric:tabular-nums}
.wg-gutter{grid-column:1;grid-row:2;position:relative}
/* T5: wg-tick は 12px（補助段） */
.wg-tick{position:absolute;right:8px;font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums;transform:translateY(-50%);white-space:nowrap}
.wg-col{grid-row:2;position:relative;z-index:1;border-left:1px solid var(--hair);padding:0 5px}
/* T5: wg-noday は 12px（補助段） */
.wg-noday{font-size:12px;color:var(--mute);padding:8px 4px;text-align:center}
.wg-rules{grid-column:2 / -1;grid-row:2;position:relative;z-index:0;pointer-events:none}
.wg-rule{position:absolute;left:0;right:0;height:1px;background:var(--hair)}
/* §5.1: ブレイク帯は「・・・」のみ */
.wg-break{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:8px}
.wg-break::before,.wg-break::after{content:"";flex:1;height:1px;background:var(--hair)}
/* T6: wg-breakmark は 12px mute（補助段・ピル廃止） */
.wg-breakmark{font-size:12px;color:var(--mute);letter-spacing:.04em;white-space:nowrap}
/* T5: ev は bg+hair罫線（shadow廃止）。border帯禁止・背景tintのみ。 */
.ev{position:absolute;left:4px;right:4px;background:var(--bg);border:1px solid var(--hair);border-radius:10px;padding:5px 9px;overflow:hidden;display:flex;flex-direction:column;gap:0}
/* T5: coach は surface+line-2（区別維持） */
.ev.coach{background:var(--surface);border:1px solid var(--line-2)}
/* T6: evt は 12px（補助段） */
.ev .evt{font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums;letter-spacing:.02em;line-height:1.25}
/* T6: evl は 12px/700（補助段・アイブロウ） */
.ev .evl{font-size:12px;font-weight:700;color:var(--t);letter-spacing:.02em;line-height:1.3}
/* T6: evn は 14px/700（カード見出し） */
.ev .evn{font-size:14px;font-weight:700;color:var(--ink);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
/* T5: evm は 12px（補助段） */
.ev .evm{font-size:12px;color:var(--mute);margin-top:auto;font-variant-numeric:tabular-nums}
.ev.mini{flex-direction:row;align-items:center;padding:2px 9px}
.ev.mini .evt{font-size:12px;white-space:nowrap}
.wg-legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;font-size:12px;color:var(--mute)}
.wg-legend .lk{display:inline-flex;align-items:center;gap:6px}
.wg-legend .sw{width:14px;height:14px;border-radius:5px;display:inline-block}
/* T5: legend は border（shadow廃止） */
.wg-legend .sw.coach{background:var(--surface);border:2px solid var(--line-2)}
.wg-legend .sw.self{background:var(--bg);border:2px solid var(--line-2)}
@media (max-width:680px){
  .weekgrid{overflow-x:auto;grid-template-columns:46px repeat(5,minmax(108px,1fr))}
}

/* ── 中央スパイン3列タイムライン ── */
.spine-header{display:grid;grid-template-columns:1fr 54px 1fr;gap:7px;margin-bottom:6px;align-items:center}
.spine-col-label{font-size:17px}
.spine-clock-header{width:54px}
.spine{position:relative;display:flex;flex-direction:column;gap:6px}
.spine::before{content:"";position:absolute;left:calc(50% - .5px);top:6px;bottom:16px;width:1px;background:var(--hair);pointer-events:none}

/* together 行（WU/主自走/CD）: 左右2列ミラー。中央線がカードを貫かないための構造。 */
.spine-together{display:grid;grid-template-columns:1fr 54px 1fr;gap:7px;align-items:stretch;position:relative}
/* T5: spine-band は bg+hair（shadow廃止）*/
.spine-band{display:flex;flex-direction:column;justify-content:center;gap:3px;background:var(--bg);border:1px solid var(--hair);padding:9px 14px;min-height:var(--sh,36px)}
.spine-band.left{border-radius:10px 4px 4px 10px}
.spine-band.right{border-radius:4px 10px 10px 4px}
/* T6: tbl-block は 12px（補助段・アイブロウ） */
.spine-band .tbl-block{font-size:12px;color:var(--mute);letter-spacing:.04em}
/* T5: tbl は 14px/700（本文段） */
.spine-band .tbl{font-size:14px;font-weight:700;color:var(--ink);line-height:1.4}
/* T5: tbm は 12px（補助段） */
.spine-band .tbm{font-size:12px;color:var(--mute)}
.tbl-comp{flex-basis:100%;font-size:12px;color:var(--mute);opacity:.8;line-height:1.5;margin-top:2px}
.spine-band-end .tbl{color:var(--mute)}
.spine-band-end .tbn{font-size:12px;color:var(--mute)}
.spine-end .spine-clk .tk{color:var(--mute)}
.nowline{position:absolute;left:0;right:0;height:0;pointer-events:none;z-index:3}
.nowline::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:var(--orange);opacity:.85}
/* T5: nowpill は surface+hair（shadow廃止） */
.nowpill{position:absolute;left:50%;top:0;transform:translate(-50%,-50%);font-size:12px;font-weight:700;color:var(--orange-ink);background:var(--orange);border-radius:999px;padding:2px 9px;white-space:nowrap}
@media print{.nowline{display:none}}

/* T4: spine-rotation は 1行目（名前+分数+ラベル）レイアウト */
.spine-rotation{display:grid;grid-template-columns:1fr 54px 1fr;gap:7px;align-items:flex-start}
/* T5: spine-side は border（shadow廃止）。coach=surface+line-2、self=bg+hair */
.spine-side{border-radius:10px;padding:9px 12px;display:flex;flex-direction:column;gap:4px}
.spine-side.spine-coach{background:var(--surface);border:1px solid var(--line-2)}
.spine-side.spine-self{background:var(--bg);border:1px solid var(--hair)}
/* T4: spine-row1 = 名前+分数+ラベル の1行 */
.spine-row1{display:flex;align-items:center;flex-wrap:wrap;gap:5px}
/* T6: spine-name は 14px/700（カード見出し・太さで差を付ける） */
.spine-name{font-size:14px;font-weight:700;line-height:1.4;flex:1;min-width:0}
/* T5: spine-mins は 12px（補助段） */
.spine-mins{font-size:12px;color:var(--mute);white-space:nowrap}
/* drill-anchor スタイル */
.drill-anchor{color:var(--ink);text-decoration:none}
.drill-anchor:hover{text-decoration:underline;color:var(--orange-deep)}

/* クロック（中央列共通） */
.spine-clk{width:54px;display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:3px;flex-shrink:0}
/* T6: spine-clk .tk は素テキスト12px（枠線・ピル廃止。背景は中央線マスク用） */
.spine-clk .tk{font-size:12px;font-weight:700;color:var(--ink);background:var(--bg);padding:3px 4px;white-space:nowrap}
.spine-dot{width:9px;height:9px;border-radius:50%}
.spine-half{font-size:12px;color:var(--mute);letter-spacing:.04em;text-align:center}

/* ── 上書き日の男女2列タイムライン（twoCol）── 既存spineトークン再利用・新規色/emoji/色帯なし ── */
/* 各セルは見出し(tll-lg=16px)を上、itemリスト(tdn=14px)を下に積む縦構成 */
.tc2-cell{align-items:stretch}
.tc2-head{margin-bottom:6px}
/* together 行の見出しと項目を縦に積む（バンド内・既存spine-band流用） */
.tc2-together .spine-band{align-items:flex-start;gap:5px}
.tc2-together .tll-lg{color:var(--t)}
/* together バンドの項目名は本文段（14px）。逃げ語なし・素テキスト */
.tc2-bn{font-size:14px;color:var(--ink);line-height:1.45}
.tc2-empty{font-size:12px;color:var(--mute);text-align:center}
/* セル見出し（tll-lg）は項目(tdn 14px)より大きい階層を保つ */
.tc2-cell .tll-lg{display:block;color:var(--t)}
.tc2-cell .tc2-body{display:flex;flex-direction:column;gap:6px}

@media (max-width:580px){
  .spine-header,.spine-rotation,.spine-together{grid-template-columns:1fr 44px 1fr}
  .spine-clk{width:44px}
  .spine-clk .tk{font-size:12px;padding:2px 4px}
  .spine::before{left:calc(50% - 1px)}
}

/* ── T2: ドリル詳細オーバーレイ（ハッシュ駆動・§2.2） ── */
/* オーバーレイコンテナ: 全画面固定・印刷非表示 */
.drill-overlay{position:fixed;inset:0;z-index:200;display:flex;align-items:stretch;justify-content:center}
.drill-overlay[hidden]{display:none!important}
/* 暗幕 */
.drill-scrim{position:fixed;inset:0;background:var(--scrim)}
/* シート: 狭幅=全画面（height:100dvh・角丸なし）・広幅=中央パネル */
.drill-sheet{position:relative;z-index:201;background:var(--surface);border:1px solid var(--line-2);border-radius:0;width:100%;height:100dvh;overflow-y:auto;overscroll-behavior:contain}
@media(min-width:681px){
  .drill-sheet{border-radius:14px;max-width:560px;height:auto;max-height:90dvh;margin:auto;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)}
  .drill-overlay{align-items:center}
}
/* 固定ヘッダ（戻るボタン・44px タップ領域） */
.dp-header{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--hair);padding:0 16px;z-index:10;display:flex;align-items:center;min-height:44px}
.drill-close{background:none;border:none;cursor:pointer;font:inherit;font-size:14px;font-weight:700;color:var(--orange-deep);padding:12px 0;letter-spacing:.02em}
.drill-close:hover{text-decoration:underline}
/* パネル本文 */
.dp-body{padding:16px 20px 28px}
/* ドリル名: 22px/700（H2段・詳細画面の文書見出し） */
.dp-name{font-size:22px;font-weight:700;letter-spacing:-.01em;line-height:1.35;margin-bottom:4px}
/* サブスキル: 12px mute */
.dp-sub{font-size:12px;color:var(--mute);line-height:1.5;margin-bottom:12px;min-height:0}
/* セクション（ねらい・やり方・メタ） */
.dp-section{margin-bottom:12px}
/* T6: dp-label は 17px/700（H3段・見出しは本文より大きく） */
.dp-label{display:block;font-size:17px;font-weight:700;color:var(--orange-deep);margin-bottom:5px}
/* ねらい: 14px */
.dp-aim{font-size:14px;line-height:1.6;color:var(--ink)}
.dp-metric{font-size:12px;color:var(--mute)}
/* やり方の要点: 14px/行間1.7 */
.dp-notes{font-size:14px;line-height:1.7;color:var(--ink)}
.dp-unrecorded{color:var(--mute);font-style:italic}
/* メタ: 12px mute（コート・ボール等） */
.dp-meta{font-size:12px;color:var(--mute);line-height:1.7}
/* 注意: 12px mute */
.dp-load{font-size:12px;color:var(--mute);line-height:1.6;margin-bottom:10px}
/* リンク（動画・参考元） */
.dp-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.dp-link{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--orange-deep);text-decoration:none}
.dp-link:hover{text-decoration:underline}

/* 期間ピッカー（レベルごと: 日=曜日 / 週=週頭 / 月=月。データのある期間のみ実選択・他はグレー） */
.picker{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:16px}
.pk{appearance:none;border:1px solid var(--hair);background:var(--surface);color:var(--mute);border-radius:999px;padding:8px 14px;font:inherit;font-size:14px;font-weight:600;display:flex;flex-direction:column;align-items:center;gap:1px;min-width:46px;text-align:center;cursor:pointer;transition:transform .14s ease}
.pk small{font-weight:400;font-size:11px;opacity:.85}
.pk:hover{transform:translateY(-2px)}
.pk.on{background:var(--orange);color:var(--orange-ink);border-color:var(--orange)}
.pk.sun{color:var(--sun)}
.pk.sat{color:var(--sat)}
.pk.on.sun,.pk.on.sat{color:var(--orange-ink)}
.pk-off{opacity:.4;cursor:default;border-style:dashed}
.pk-off:hover{transform:none}
`;

export const meta = { id: 'timeline', name: 'タイムライン', tagline: '練習の流れを縦の比例タイムラインで・男女共通メニュー' };

/** 日ピッカー: 日〜土の曜日ボタン。練習日のみ選択可（cal-go）、無い曜日はグレーアウト。日曜始まり。 */
function dayPicker(data) {
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const pr = new Map();
  data.days.forEach((d, i) => { if (d.day) pr.set(d.day, { dateLabel: d.dateLabel, first: i === 0 }); });
  const btns = WD.map((w, i) => {
    const wk = i === 0 ? ' sun' : i === 6 ? ' sat' : '';
    const p = pr.get(w);
    if (!p) return `<span class="pk pk-off${wk}">${w}</span>`;
    const md = p.dateLabel ? p.dateLabel.slice(5) : '';
    return `<button class="pk cal-go${p.first ? ' on' : ''}${wk}" data-go="${esc(w)}" type="button">${w}${md ? `<small>${esc(md)}</small>` : ''}</button>`;
  });
  return `<div class="picker" data-print-hide>${btns.join('')}</div>`;
}

/** 週ピッカー: 生成済みの各週（data.weeks）を「yyyy/mm/dd〜」で実選択できるボタンで並べる。先頭=表示中。 */
function weekPicker(data) {
  const weeks = data.weeks || [];
  if (weeks.length <= 1) return ''; // 単一週なら切替不要＝ピッカー非表示
  const items = weeks.map((w, i) =>
    `<button class="pk cal-go-week${i === 0 ? ' on' : ''}" data-go="${esc(w.key)}" type="button">${esc(w.label)}</button>`
  ).join('');
  return `<div class="picker" data-print-hide>${items}</div>`;
}

/** 月ピッカー: 生成済みの各月（data.months）を「yyyy/mm」で実選択できるボタンで並べる。先頭=今月。 */
function monthPicker(data) {
  const months = data.months || [];
  if (months.length <= 1) return ''; // 単一月なら切替不要＝ピッカー非表示
  const items = months.map((m, i) =>
    `<button class="pk cal-go-month${i === 0 ? ' on' : ''}" data-go="${esc(m.key)}" type="button">${esc(m.label)}</button>`
  ).join('');
  return `<div class="picker" data-print-hide>${items}</div>`;
}

export function render(data) {
  const dayTimelines = data.days.map((d, i) => dayTimeline(data, d, i)).join('\n');

  return {
    css: PATTERN_CSS,
    body: `
    <div class="levels" role="tablist">
      <button class="lvtab on" data-go="day" type="button">日</button>
      <button class="lvtab" data-go="week" type="button">週</button>
      <button class="lvtab" data-go="month" type="button">月</button>
      <button class="lvtab" data-go="year" type="button">年</button>
    </div>

    <div class="level" data-level="day">
      <div class="toolbar" data-print-hide>
        ${modeToggle()}
        <button class="btn btn-primary" id="printBtn" type="button">印刷 / PDFで保存</button>
        <button class="btn" id="copyBtn" type="button">テキストでコピー</button>
      </div>
      ${dayPicker(data)}
      ${goalsBar(data)}
      ${dayTimelines}
    </div>

    <div class="level" data-level="week" hidden>${weekPicker(data)}${(data.weeks && data.weeks.length ? data.weeks : [{ key: '', days: data.days, focus: '' }]).map((w, i) => `<div class="wkpanel" data-week="${esc(w.key)}"${i === 0 ? '' : ' hidden'}>${weekLevel(data, w.days, w.focus)}</div>`).join('')}</div>
    <div class="level" data-level="month" hidden>${monthPicker(data)}${(data.months && data.months.length ? data.months : [{ key: '', month: data.session.month, displayMonth: data.month }]).map((m, i) => `<div class="mopanel" data-month="${esc(m.key)}"${i === 0 ? '' : ' hidden'}>${monthSection(data, m.month, m.displayMonth)}${i === 0 ? goalsSection(data) : ''}</div>`).join('')}</div>
    <div class="level" data-level="year" hidden>${yearSection(data)}${assumptionsNote(data)}</div>
    ${drillDetailPanels(data)}
    <p class="foot">${esc(data.school)}　練習タイムライン</p>
    `,
  };
}
