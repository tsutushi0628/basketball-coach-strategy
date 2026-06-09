/**
 * @file パターン「タイムライン」— 縦の比例タイムライン（採用案）。練習メニューは男女共通（1本）。
 *
 * 主役は「日」: 組違い時は中央スパイン3列（左=男子・中央=時計・右=女子）で、クロックレールと
 * 比例高さカードを維持したまま男女のドリルが左右に展開する。together 行（WU/自走/CD）は3列を
 * 横断する全幅バンド。週＝5日のガント、月＝今月やること、年＝男女2行の1年の流れ。
 */

import {
  esc, modeTag, altLine, videoLink, plainText, BLOCK_TINT,
  modeToggle, dayHeader,
  goalsSection, monthSection, yearSection, assumptionsNote,
  genderChip,
} from './render-shared.mjs';

/** 分→比例高さ(px)。 */
const segH = (minutes) => Math.max(34, Math.round(minutes * 3.6));

function trackSeg(b) {
  const tint = BLOCK_TINT[b.block] || 'var(--mute)';
  if (b.isBundle) {
    const names = b.items.map((it) => esc(it.name)).join('・');
    return `<div class="tlband" style="--t:${tint}">
      <span class="tbl">${esc(b.label)}</span>
      <span class="tbn">${names}</span>
      <span class="tbm">${b.minutes}分</span>
    </div>`;
  }
  const rows = b.items
    .map(
      (x) => `<div class="tdrill">
        <span class="tdn">${esc(x.name)}${videoLink(x.video)}</span>
        ${modeTag(x.mode)}
        ${altLine(x.alternatives)}
      </div>`,
    )
    .join('');
  return `<div class="tlcard" style="--t:${tint};min-height:${segH(b.minutes)}px">
    <div class="tlh"><span class="tll">${esc(b.label)}</span><span class="tlm">${b.minutes}分</span></div>
    <div class="tlbody">${rows}</div>
  </div>`;
}

/** 共通メニューの縦比例タイムライン（rotation 以外の日用）。 */
function menuTimeline(pd) {
  const rows = pd.blocks
    .map((b) => {
      const h = b.isBundle ? 'auto' : segH(b.minutes) + 'px';
      return `<div class="tlrow" style="--rh:${h}">
        <div class="tlclock"><span class="tk">${esc(b.from)}</span></div>
        <div class="tlseg">${trackSeg(b)}</div>
      </div>`;
    })
    .join('');
  const endRow = `<div class="tlrow tlrow-end">
      <div class="tlclock"><span class="tk">${esc(pd.end)}</span></div>
      <div class="tlseg"><div class="tlend"><span class="tbl">ダウン／ミーティング</span><span class="tbn">今日の振り返りと、次に向けてのひとこと。</span></div></div>
    </div>`;
  return `<div class="timeline">${rows}${endRow}</div>`;
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
function rotationTimeline(pd) {
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
        <span class="bothmark">両チーム共通</span>
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
      return `<div class="spine-row spine-rotation" style="min-height:${h}px">
        <div class="spine-side${boys.mode === 'practice' ? ' spine-coach' : ' spine-self'}">
          ${modeTag(boys.mode)}
          <div class="spine-name">${esc(boys.name)}${videoLink(boys.video)}</div>
          <div class="spine-mins">${row.minutes}分</div>
          ${altLine(boys.alternatives)}
        </div>
        <div class="spine-clk">
          <span class="tk">${esc(row.from)}</span>
          <span class="spine-dot" style="background:var(--orange)"></span>
          <span class="spine-half">${esc(row.half)}</span>
        </div>
        <div class="spine-side${girls.mode === 'practice' ? ' spine-coach' : ' spine-self'}">
          ${modeTag(girls.mode)}
          <div class="spine-name">${esc(girls.name)}${videoLink(girls.video)}</div>
          <div class="spine-mins">${row.minutes}分</div>
          ${altLine(girls.alternatives)}
        </div>
      </div>`;
    }
    return '';
  }).join('');

  // 終了時刻行（pd.end を使う）
  const endBandInner = `<span class="tbl">ダウン／ミーティング</span>
      <span class="tbm">今日の振り返りと、次に向けてのひとこと。</span>`;
  const endRow = `<div class="spine-row spine-together spine-end">
    <span class="bothmark">両チーム共通</span>
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

  const onContent = `${genderHeader}<div class="spine">${rowsHtml}${endRow}</div>`;

  const offNote = `<div class="inote" data-interact="off" hidden>
    <b>組違いOFF</b>：男女が別時間に同じメニューを各自フル（コーチが全段に付く）。<br>
    メニューは下の共通メニューを男女それぞれが順番に実施。
  </div>`;

  return `<div data-interact="on">${onContent}</div>${offNote}`;
}

function dayTimeline(data, pd, idx) {
  const isRotation = pd.sharedKind === 'rotation' && pd.rotation;
  return `<article class="day pageb" data-day="${esc(pd.day)}"${idx === 0 ? '' : ' hidden'}>
    ${dayHeader(pd, data.month)}
    ${isRotation ? rotationTimeline(pd) : ''}
    ${isRotation ? `<details class="menu-detail"><summary class="menu-summary">共通メニュー（男女同一の内容）</summary>${menuTimeline(pd)}</details>` : menuTimeline(pd)}
    <pre class="plain" hidden>${esc(plainText(data, pd))}</pre>
  </article>`;
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

/** 曜日列に出すブロック一覧（items が空の曜日は null）。 */
function dayBlocks(d) {
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
 * 全曜日の稼働帯の和集合にクランプし、最大未使用ギャップを1本の畳みブレイクにする。
 * @param {Array} days buildDays 結果の days 配列
 * @returns {{ axisStart:number, axisEnd:number, used:number[][], collapse:{from:number,to:number}|null }|null}
 */
function buildWeekAxis(days) {
  const present = days.map(dayBlocks).filter(Boolean);
  if (present.length === 0) return null;

  const axisStart = Math.min(...present.map((bs) => toMin(bs[0].from)));
  const axisEnd   = Math.max(...present.map((bs) => toMin(bs[bs.length - 1].to)));

  // 稼働帯の和集合（各曜日の稼働帯 [from, to] をマージ）
  const used = mergeRanges(present.map((bs) => [toMin(bs[0].from), toMin(bs[bs.length - 1].to)]));

  // 最大未使用ギャップを1本のブレイクに畳む
  let collapse = null;
  let maxGap = 0;
  for (let i = 1; i < used.length; i++) {
    const gap = used[i][0] - used[i - 1][1];
    if (gap > maxGap) {
      maxGap = gap;
      collapse = { from: used[i - 1][1], to: used[i][0] };
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
 * 週カレンダーグリッドのガター目盛りHTML（稼働帯の区画境界のみ刻む）。
 * 畳み区間はブレイクとして挟み、前後の時刻を連続表示する。
 */
function gutterTicks(axis) {
  const ticks = [];
  // 各稼働区画の開始・終了時刻を刻む
  for (const [from, to] of axis.used) {
    const fromMin = from;
    const toMin2  = to;
    // 区画の開始時刻（稼働帯の全体先頭以外もそれぞれ打つ）
    const fromY = axisY(fromMin, axis);
    const toY   = axisY(toMin2, axis);
    ticks.push({ y: fromY, label: hhmm(fromMin) });
    // 1時間刻みの中間目盛りを追加（可読性向上）
    const nextHour = Math.ceil(fromMin / 60) * 60;
    for (let t = nextHour; t < toMin2; t += 60) {
      ticks.push({ y: axisY(t, axis), label: hhmm(t) });
    }
    ticks.push({ y: toY, label: hhmm(toMin2) });
  }
  // 重複除去（同y座標に複数入ることがある）
  const seen = new Set();
  return ticks.filter((tk) => {
    if (seen.has(tk.label)) return false;
    seen.add(tk.label);
    return true;
  });
}

/** hhmm ヘルパー（plan-data にも同定義がある・ここはグリッドローカル） */
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 週レベル: Googleカレンダー型の時間グリッド（T5: 縦棒ガント全面置換）。 */
function weekLevel(data) {
  const axis = buildWeekAxis(data.days);
  if (!axis) {
    return `<h3 class="lvh">今週の練習</h3><p class="note">今週は練習なし。</p>`;
  }

  // グリッド全体の高さ
  const totalH = axisY(axis.axisEnd, axis) + 8; // 末端に少し余白

  // 曜日ヘッダ
  const SHARE_LABEL = { rotation: '組違いローテ', together: '男女合同', independent: 'コーチ不在（各自）' };
  const SHARE_NOTE  = { rotation: '（左右の段取りは日タブ）', together: '', independent: '' };

  // 列番号は data.days の並び順から導出（ガター=1列目・各曜日=2列目以降）。
  // 曜日名のハードコードmap（火→2…）にしないのは、別曜日構成でも静かに列が重ならないため。
  const dayHeads = data.days.map((d, i) => {
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

  // 時刻ガター
  const ticks = gutterTicks(axis);
  const ticksHtml = ticks.map((tk) =>
    `<span class="wg-tick" style="top:${Math.round(tk.y)}px">${esc(tk.label)}</span>`
  ).join('');

  // 共通水平罫線（各稼働区画の開始と終了を横断）
  const rulePositions = new Set();
  for (const [from, to] of axis.used) {
    rulePositions.add(Math.round(axisY(from, axis)));
    rulePositions.add(Math.round(axisY(to, axis)));
    // 1時間刻みの中間罫線
    const nextHour = Math.ceil(from / 60) * 60;
    for (let t = nextHour; t < to; t += 60) rulePositions.add(Math.round(axisY(t, axis)));
  }
  const rulesHtml = [...rulePositions].map((y) =>
    `<div class="wg-rule" style="top:${y}px"></div>`
  ).join('');

  // 畳みブレイク帯
  let breakHtml = '';
  if (axis.collapse) {
    const breakY = Math.round(axisY(axis.collapse.from, axis) + (BREAK_PX / 2));
    const fromLabel = hhmm(axis.collapse.from);
    const toLabel   = hhmm(axis.collapse.to);
    breakHtml = `<div class="wg-break" style="top:${breakY}px;transform:translateY(-50%)">
      <span class="wg-breaklabel">午前〜午後（練習なし・${esc(fromLabel)}〜${esc(toLabel)}）</span>
    </div>`;
  }

  // 各曜日列のイベントブロック
  const colsHtml = data.days.map((d, i) => {
    const colIdx = i + 2;
    const blocks = dayBlocks(d);
    if (!blocks) {
      return `<div class="wg-col" style="grid-column:${colIdx};height:${Math.round(totalH)}px">
        <div class="wg-noday">練習なし</div>
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
        return `<div class="ev mini" style="top:${Math.round(top)}px;height:${Math.max(10, Math.round(height))}px;--t:${tint}">
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

  return `<h3 class="lvh">今週の練習（火・水・木・金・土）</h3>
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

const PATTERN_CSS = `
.timeline{position:relative;padding-left:54px}
.timeline::before{content:"";position:absolute;left:44px;top:6px;bottom:16px;width:1px;background:var(--hair)}
.tlrow{position:relative;display:flex;min-height:var(--rh,auto);margin-bottom:9px}
.tlclock{position:absolute;left:-54px;top:0;width:54px;display:flex;align-items:flex-start}
.tk{font-size:12px;font-weight:700;color:var(--ink);background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 8px;font-variant-numeric:tabular-nums}
.tlclock::after{content:"";position:absolute;left:41px;top:8px;width:9px;height:9px;border-radius:50%;background:var(--t,var(--orange));box-shadow:var(--shadow-soft)}
.tlseg{flex:1;min-width:0;display:flex}
.tlcard{flex:1;background:var(--surface);border-radius:14px;box-shadow:var(--shadow-soft);padding:11px 15px;display:flex;flex-direction:column;justify-content:center}
.tlh{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.tll{font-size:12px;font-weight:700;color:var(--t);letter-spacing:.02em}
.tlm{margin-left:auto;font-size:11px;color:var(--mute)}
.tlbody{display:flex;flex-direction:column;gap:7px}
.tdrill{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.tdn{font-size:15px;font-weight:600;line-height:1.45;min-width:0}
.tdrill .alt{flex-basis:100%;margin-top:0}
.tlband{flex:1;display:flex;align-items:center;gap:9px;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:7px 13px}
.tlband .tbl{font-size:12px;font-weight:700;color:var(--t);flex:0 0 auto}
.tlband .tbn{font-size:12px;color:var(--mute);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tlband .tbm{font-size:11px;color:var(--mute);flex:0 0 auto}
.tlrow-end .tlend{flex:1;background:var(--bg);box-shadow:var(--inset);border-radius:11px;padding:9px 13px}
.tlrow-end .tbl{font-size:12px;font-weight:700;color:var(--mute);margin-right:8px}
.tlrow-end .tbn{font-size:12px;color:var(--mute)}
.tlrow-end .tlclock::after{background:var(--mute)}

/* ── 週カレンダーグリッド CSS（T6: 案A確定・Googleカレンダー型・Hallmark準拠） ── */
/* 列構成: 左に時刻ガター1本（52px）＋練習5日。全列が同じ px/分スケールを共有する。 */
.weekgrid{
  display:grid;
  grid-template-columns:52px repeat(5,1fr);
  background:var(--surface);
  border-radius:18px;
  box-shadow:var(--shadow);
  padding:14px 14px 16px;
  overflow:hidden
}
/* 曜日ヘッダ行 */
.wg-corner{grid-column:1;grid-row:1}
.wg-dayhead{grid-row:1;text-align:center;padding:0 4px 10px;border-bottom:1px solid var(--hair)}
.wg-dayhead .wd{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em}
.wg-dayhead .wr{display:block;font-size:9px;color:var(--orange-deep);font-weight:700;letter-spacing:.04em;margin-top:1px}
.wg-dayhead .wt{display:block;font-size:11px;color:var(--mute);margin-top:3px;font-variant-numeric:tabular-nums}
/* 時刻ガター（共通1本） */
.wg-gutter{grid-column:1;grid-row:2;position:relative}
.wg-tick{position:absolute;right:8px;font-size:11px;color:var(--mute);font-variant-numeric:tabular-nums;transform:translateY(-50%);white-space:nowrap}
/* 各曜日本体カラム（同一縦尺を共有・罫線より上に重ねる） */
.wg-col{grid-row:2;position:relative;z-index:1;border-left:1px solid var(--hair);padding:0 5px}
.wg-noday{font-size:11px;color:var(--mute);padding:8px 4px;text-align:center}
/* 共通水平罫線（全列横断・極薄）*/
.wg-rules{grid-column:2 / -1;grid-row:2;position:relative;z-index:0;pointer-events:none}
.wg-rule{position:absolute;left:0;right:0;height:1px;background:var(--hair)}
/* 未使用帯の畳み込みブレイク（BusyCal collapse 相当・薄面＋mute文字） */
.wg-break{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:8px}
.wg-break::before,.wg-break::after{content:"";flex:1;height:1px;background:var(--hair)}
.wg-breaklabel{font-size:10px;color:var(--mute);letter-spacing:.04em;white-space:nowrap;background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 12px;font-variant-numeric:tabular-nums}
/* イベント（練習ブロック）: top=開始オフセット・height=所要px（比例配置）。border帯禁止・背景tintのみ。 */
.ev{position:absolute;left:4px;right:4px;background:var(--bg);box-shadow:var(--inset);border-radius:10px;padding:5px 9px;overflow:hidden;display:flex;flex-direction:column;gap:0}
.ev.coach{background:var(--surface);box-shadow:var(--shadow-soft)}
.ev .evt{font-size:10px;color:var(--mute);font-variant-numeric:tabular-nums;letter-spacing:.02em;line-height:1.25}
.ev .evl{font-size:11px;font-weight:700;color:var(--t);letter-spacing:.02em;line-height:1.3}
.ev .evn{font-size:12px;font-weight:600;color:var(--ink);line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.ev .evm{font-size:10px;color:var(--mute);margin-top:auto;font-variant-numeric:tabular-nums}
.ev.mini{flex-direction:row;align-items:center;padding:2px 9px}
.ev.mini .evt{font-size:9px;white-space:nowrap}
/* 週グリッド凡例 */
.wg-legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;font-size:12px;color:var(--mute)}
.wg-legend .lk{display:inline-flex;align-items:center;gap:6px}
.wg-legend .sw{width:14px;height:14px;border-radius:5px;display:inline-block}
.wg-legend .sw.coach{background:var(--surface);box-shadow:var(--shadow-soft)}
.wg-legend .sw.self{background:var(--bg);box-shadow:var(--inset)}
/* 狭幅: 横スクロールで時間グリッドを維持（列ごと尺替えはしない・common-scale保持） */
@media (max-width:680px){
  .weekgrid{overflow-x:auto;grid-template-columns:46px repeat(5,minmax(108px,1fr))}
}

/* 中央スパイン3列タイムライン */
.spine-header{display:grid;grid-template-columns:1fr 54px 1fr;gap:7px;margin-bottom:6px;align-items:center}
.spine-col-label{font-size:13px}
.spine-clock-header{width:54px}
.spine{position:relative;display:flex;flex-direction:column;gap:6px}
/* 中央時計レール: 1px・不透明度9%の極薄罫線（Notion Calendar作法） */
.spine::before{content:"";position:absolute;left:calc(50% - .5px);top:6px;bottom:16px;width:1px;background:var(--hair);pointer-events:none}

/* together 行（WU/主自走/CD）: 左右2列ミラー。中央線がカードを貫かないための構造。 */
.spine-together{display:grid;grid-template-columns:1fr 54px 1fr;gap:7px;align-items:stretch;position:relative}
.spine-band{display:flex;flex-direction:column;justify-content:center;gap:3px;background:var(--bg);box-shadow:var(--inset);padding:9px 14px;min-height:var(--sh,36px)}
/* 左右を1ユニットに: 左は左角だけ丸め / 右は右角だけ丸め → 中央でひとつの帯に繋がって見える */
.spine-band.left{border-radius:13px 4px 4px 13px}
.spine-band.right{border-radius:4px 13px 13px 4px}
.spine-band .tbl-block{font-size:10px;color:var(--mute);letter-spacing:.04em}
.spine-band .tbl{font-size:14px;font-weight:700;color:var(--ink);line-height:1.4}
.spine-band .tbm{font-size:11px;color:var(--mute)}
.tbl-comp{flex-basis:100%;font-size:11px;color:var(--mute);opacity:.8;line-height:1.5;margin-top:2px}
/* 「両チーム共通」マーカー: 帯の上端中央に1つだけ。左右が同じ内容だと一目で分かる。 */
.bothmark{position:absolute;left:50%;top:-9px;transform:translateX(-50%);font-size:9px;letter-spacing:.08em;font-weight:700;color:var(--mute);background:var(--surface);box-shadow:var(--shadow-soft);border-radius:999px;padding:2px 10px;white-space:nowrap;z-index:2}
.spine-band-end .tbl{color:var(--mute)}
.spine-band-end .tbn{font-size:12px;color:var(--mute)}
.spine-end .spine-clk .tk{color:var(--mute)}
/* 現在時刻ライン（細い --orange 1px・練習中のみ・印刷非表示） */
.nowline{position:absolute;left:0;right:0;height:0;pointer-events:none;z-index:3}
.nowline::before{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:var(--orange);opacity:.85}
.nowpill{position:absolute;left:50%;top:0;transform:translate(-50%,-50%);font-size:10px;font-weight:700;color:var(--orange-ink);background:var(--orange);border-radius:999px;padding:2px 9px;white-space:nowrap;box-shadow:var(--shadow-soft)}
@media print{.nowline{display:none}}

/* rotation 行: 左右にドリルカード・中央に時刻 */
.spine-rotation{display:grid;grid-template-columns:1fr 54px 1fr;gap:7px;align-items:flex-start}
.spine-side{border-radius:12px;padding:9px 12px;display:flex;flex-direction:column;gap:4px}
.spine-side.spine-coach{background:var(--surface);box-shadow:var(--shadow-soft)}
.spine-side.spine-self{background:var(--bg);box-shadow:var(--inset)}
.spine-name{font-size:14px;font-weight:600;line-height:1.4;margin-top:2px}
.spine-mins{font-size:11px;color:var(--mute);margin-top:1px}

/* クロック（中央列共通） */
.spine-clk{width:54px;display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:3px;flex-shrink:0}
.spine-clk .tk{font-size:12px;font-weight:700;color:var(--ink);background:var(--bg);box-shadow:var(--inset);border-radius:999px;padding:3px 8px;white-space:nowrap}
.spine-dot{width:9px;height:9px;border-radius:50%;box-shadow:var(--shadow-soft)}
.spine-half{font-size:10px;color:var(--mute);letter-spacing:.04em;text-align:center}

.menu-detail{margin-top:8px}
.menu-summary{font-size:13px;color:var(--mute);cursor:pointer;padding:5px 2px}
@media (max-width:580px){
  .spine-header,.spine-rotation,.spine-together{grid-template-columns:1fr 44px 1fr}
  .spine-clk{width:44px}
  .spine-clk .tk{font-size:11px;padding:2px 6px}
  .spine::before{left:calc(50% - 1px)}
}
@media print{
  .menu-detail{display:block}
  .menu-detail[open],.menu-detail summary+*{display:block}
}
`;

export const meta = { id: 'timeline', name: 'タイムライン', tagline: '練習の流れを縦の比例タイムラインで・男女共通メニュー' };

export function render(data) {
  const dayTabs = data.days
    .map(
      (d, i) => `<button class="daytab${i === 0 ? ' on' : ''}" data-go="${esc(d.day)}" type="button">${esc(d.day)}<small>${d.coachPresent ? '在席' : '不在'}</small></button>`,
    )
    .join('');
  const dayTimelines = data.days.map((d, i) => dayTimeline(data, d, i)).join('\n');

  return {
    css: PATTERN_CSS,
    body: `
    <h1 style="font-size:clamp(20px,3.4vw,26px);font-weight:700;letter-spacing:-.01em;margin:0 0 4px">${esc(data.school)}　練習タイムライン</h1>
    <p style="color:var(--mute);font-size:13px;margin-bottom:14px">${data.month}月　／　練習メニューは男女共通。組違い＝コーチ1人で男女を回す段取りを切り替えられます。</p>
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
      <div class="daytabs" data-print-hide>${dayTabs}</div>
      ${dayTimelines}
    </div>

    <div class="level" data-level="week" hidden>${weekLevel(data)}</div>
    <div class="level" data-level="month" hidden>${monthSection(data)}${goalsSection(data)}</div>
    <div class="level" data-level="year" hidden>${yearSection(data)}${assumptionsNote(data)}</div>
    `,
  };
}
