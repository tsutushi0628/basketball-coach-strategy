/**
 * @file 全パターン共通の描画基盤（トンマナ固定・Hallmark準拠）。
 *
 * 練習メニューは男女共通（1本）。組違い＝そのメニューのコーチ付き段だけを男女でずらし、
 * コーチ1人が前半・後半で男女を入れ替えて見る（同時刻にコーチ付きは必ず片方）。各パターンは
 * 「日」の見せ方で差別化し、組違いパネル・目標・年/月は共通部品を使う。
 *
 * Hallmark NG（border帯のカード強調・emoji・汎用書体 Inter/Roboto・紫ピンクgradient・
 * gradient見出し・全幅centered hero・定型AIナビ）は基盤から排除している。
 */

import { loadCss } from './styles/load-css.mjs';
import { isAllTogetherTwoColRows, isTogetherRow } from './two-col-together.mjs';

/** ST-labo デザイントークン（warmブランド: クリーム地＋オレンジ）。実体は styles/tokens.css。
 * T5: --shadow/--shadow-soft/--inset を削除し、border+面の濃淡2値で区切りを表現する。
 * 残すのは: 強い区切り=--line-2（セクション外周）、弱い区切り=--hair（カード・行間）。
 */
export const TOKENS = loadCss(import.meta.url, 'styles/tokens.css');

/** styles/*.css 側で TOKENS の挿入位置を示す共通マーカー（auth-page.css・picker.css も同じ印を使う）。 */
const TOKENS_MARKER = '/*' + 'TOKENS' + '*/';

/**
 * .css を読み、中の TOKENS マーカーへ実際のトークン値を差し込んで返す（base.css・auth-page.css・
 * picker.css の3箇所で共通利用。呼び出し元自身の import.meta.url を渡すこと＝loadCss と同じ規約）。
 * @param {string} callerUrl 呼び出し元モジュールの import.meta.url
 * @param {string} relPath 呼び出し元ディレクトリからの相対パス
 * @returns {string}
 */
export function loadCssWithTokens(callerUrl, relPath) {
  return loadCss(callerUrl, relPath).replace(TOKENS_MARKER, () => TOKENS);
}

/** 共通ベースCSS。実体は styles/base.css（トークン挿入用コメントの位置に TOKENS を差し込む）。
 * T5: shadow廃止→border+面の濃淡2値で区切りを表現。
 * T6 タイポ5段（27/22/17/14/12・約1.25比率）: H1=27 / H2=22 / H3=17 / 本文=14 / 補助=12。
 * 見出しは必ず本文(14px)よりサイズ上位に置く（10px見出しラベル禁止）。
 * 枠線は「押せるもの（ボタン・タブ）」と「カード面」のみ。静的メタ情報はピル化しない。 */
export const BASE_CSS = loadCssWithTokens(import.meta.url, 'styles/base.css');

/**
 * ブロック種別の色（warm系で統一・虹色にしない）。固定6ブロック骨格に対応。
 * キーはブロックキー（plan-data の block）と表示ラベル（together行の row.label）の両方を含める。
 */
export const BLOCK_TINT = {
  // block キー
  アップ: 'var(--sage)',
  ファンダ: 'var(--orange)',
  シュート: 'var(--gold)',
  対人: 'var(--terra)',
  ラン: 'var(--sage)',
  静的: 'var(--mute)',
  ゲーム: 'var(--orange)',
  // 遠征日等にコーチが手で選ぶ枠（自動生成対象外）。既存トークンの未使用の濃色2種を割り当て、
  // 互いに区別できる色にする（灰色フォールバックに落とさない）。
  移動: 'var(--orange-deep)',
  その他: 'var(--terra-ink)',
  // 表示ラベル（together行 row.label 経由の参照用）
  ファンダメンタル: 'var(--orange)',
  走り込み: 'var(--sage)',
  静的ストレッチ: 'var(--mute)',
};

/** HTMLエスケープ。 */
export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 再生アイコン（SVG・emoji不使用）。 */
export const VIDEO_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 9l5 3-5 3z"/></svg>';

/** 日ビュー操作ツールバーのアイコン（プリンタ／鉛筆／複製・自作インラインSVG・emoji不使用）。
 * 線幅・角処理（stroke-width/stroke-linecap/stroke-linejoin）は3つとも styles/pattern-timeline.css の
 * .op-btn svg 側で揃える（各SVGにはpath形状のみ持たせる）。 */
export const PRINT_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/><path d="M17 12h.01"/></svg>';
export const EDIT_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20H5a1 1 0 0 1-1-1v-7"/><path d="m15.5 4.5 4 4L9 19l-5 1 1-5z"/></svg>';
export const COPY_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h8l3 3v11H8z"/><path d="M16 5v4h4M11 12h5M11 15h5M5 8v11h10"/></svg>';

/**
 * §3.3: モードマーク（dot + 文字ラベル）。自走は空文字（多数派の自走全行にマークを置くと
 * コーチ付きの希少性が消えるため、コーチ付き・レクチャのみ表示）。
 * dot: 6pxの行頭●（コーチ付き=--orange）。自走は dot も非表示。
 */
export const modeMark = (mode) => {
  if (mode === 'practice') return `<span class="mode-mark"><span class="mode-dot coach-dot"></span><span class="tag tag-coach">コーチ</span></span>`;
  if (mode === 'lecture')  return `<span class="mode-mark"><span class="tag tag-lec">レクチャ</span></span>`;
  return ''; // 自走はマーク非表示
};

/** T4互換エイリアス（既存呼び出し側が modeTag を参照しているため残す）。 */
export const modeTag = modeMark;

/** 動画リンク（あれば）。 */
export const videoLink = (url) =>
  url ? ` <a class="vid" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${VIDEO_SVG}<span>動画</span></a>` : '';

/**
 * 「いずれか」候補行。registry があれば候補名を data-drill タップ要素にする（ハッシュ駆動詳細）。
 * @param {string[]} alts 候補名配列
 * @param {Map} [registry] 名前→詳細（省略可）
 */
export const altLine = (alts, registry) => {
  if (!alts || !alts.length) return '';
  const items = alts.map((name) => {
    const detail = registry && registry.get(name);
    if (detail) return `<button type="button" class="drill-trig" data-drill="${esc(detail.id)}">${esc(name)}</button>`;
    return esc(name);
  }).join(' ／ ');
  return `<div class="alt"><b>いずれか</b>　${items}</div>`;
};

/** 男女チップ。 */
export const genderChip = (gender) =>
  `<span class="gchip ${gender === '男子' ? 'boys' : 'girls'}">${esc(gender)}</span>`;

/**
 * 空状態ブロック（未入力の日/週/月/年に出す簡潔な案内＋導線）。
 *
 * オーナー方針「未入力は空白」。叩き台を自動表示せず、コーチが入れるまでは空状態にする。
 * 導線2つ:「入力する」＝空のまま編集を開く／「自動で叩き台を入れる」＝エンジン叩き台を編集欄へ読む。
 * design-hallmark 準拠: emoji・border帯（side-stripe）・紫ピンクgradient・汎用書体・偽chrome なし。
 * 既存トークン（surface/hair/mute）と既存 .btn 作法のみ。導線が不要な面（週/月/年の目標等）では
 * actions を空文字にして文言だけ出す。
 *
 * @param {object} arg
 * @param {string} arg.text 案内文（例「まだ入力がありません」）
 * @param {string} [arg.actions] 導線HTML（省略時は文言だけ）
 * @returns {string} HTML
 */
export function emptyState({ text, actions = '' }) {
  return `<div class="emptystate">
    <p class="es-text">${esc(text)}</p>
    ${actions ? `<div class="es-actions">${actions}</div>` : ''}
  </div>`;
}

/** 日の空状態の標準導線（「入力する」「自動で叩き台を入れる」）。editor.mjs が data-empty-act で拾う。 */
export function emptyDayActions() {
  return `<button type="button" class="btn" data-empty-act="blank" data-print-hide>入力する</button>` +
    `<button type="button" class="btn" data-empty-act="seed" data-print-hide>自動で叩き台を入れる</button>`;
}

/** 過去日の記録なし状態の導線。過去には自動の叩き台を生成しない。 */
export function noRecordDayActions() {
  return `<button type="button" class="btn" data-empty-act="blank" data-print-hide>この日の記録を入力する</button>`;
}

/** 日ヘッダ（曜日・コート・時間・本日の狙い）。印刷時は右側に月/週の目標を横並びにして行を稼ぐ。 */
export function dayHeader(pd, month, goals) {
  // 見出しの日付表記: 実日付があれば「6/23（火）」、無ければ従来の「N月 火曜」。
  const dateHead = pd.dateLabel ? `${esc(pd.dateLabel)}（${esc(pd.day)}）` : `${month}月 ${esc(pd.dayLabel)}`;
  // 印刷専用: 月/週の目標（画面では day レベルの目標バーで見せ、ここは display:none）。
  // 未設定の側は項目ごと出さず、月週とも未設定ならペイン自体を出さない（'—'の幽霊行を配布紙に刷らない。
  // 静的紙面なのでレイアウトシフトの概念はなく、ペイン省略時は .dh-main が flex:1 で全幅を使う）。
  const goalsPr = goals && (goals.monthMain || goals.week)
    ? `<div class="dh-goals" aria-hidden="true">${goals.monthMain ? `<span class="dhg-item"><b>月</b>${esc(goals.monthMain)}</span>` : ''}${goals.week ? `<span class="dhg-item"><b>週</b>${esc(goals.week)}</span>` : ''}</div>`
    : '';
  // コーチ指定の上書き日: 対象性別チップと手書きの狙いだけ出す。
  // 「コーチ指定」等の内部ラベルは配布物に出さない（コーチが見て無意味なため）。
  // 男女2列日（twoCol）は男女両方が対象なので男子・女子チップを並べ、単一性別表記はしない。
  // ただし onlyGender（男女オンリーモード）が立っている twoCol 日は対象は単一性別なのでチップを出す。
  if (pd.source === 'coach') {
    const singleGenderLabel = pd.onlyGender || (!pd.twoCol ? pd.team : null);
    // twoCol 日は男女2列が下に並ぶのでヘッダの男女チップは常に両方＝選択肢ゼロ（出さない）。
    // オンリー時・単一性別日（旧スキーマ）だけ対象を出す。
    const teamChip = singleGenderLabel ? ` ${genderChip(singleGenderLabel)}` : '';
    const aimScope = singleGenderLabel ? `（${esc(singleGenderLabel)}）` : '';
    return `<div class="dayhead">
      <div class="dh-main">
        <div class="dh-t">${dateHead}${teamChip}
          <span class="dh-court">${esc(pd.court)}</span>
        </div>
        <div class="dh-aim"><span class="dh-aiml">この日のねらい${aimScope}</span>${esc(pd.aim)}</div>
      </div>
      ${goalsPr}
    </div>`;
  }
  // 2部構成の日（火）は日全体の時間帯と「2部構成」である旨を示す（各部の詳細は部ヘッダで）。
  const partsNote = Array.isArray(pd.parts) && pd.parts.length > 1
    ? `・${pd.parts.length}部構成（${pd.parts.map((p) => `${esc(p.label)}${p.totalMinutes}分`).join(' ＋ ')}）`
    : `・${esc(pd.court)}`;
  const meta = `${partsNote}・${esc(pd.start)}〜${esc(pd.end)}・計${pd.totalMinutes}分${pd.coachPresent ? '' : '・コーチ不在'}`;
  return `<div class="dayhead">
    <div class="dh-main">
      <div class="dh-t">${dateHead}<span class="dh-court">${meta}</span></div>
      <div class="dh-aim"><span class="dh-aiml">本日の狙い</span>${esc(pd.aim)}</div>
    </div>
    ${goalsPr}
  </div>`;
}

/**
 * 区画（session part）ヘッダ（火の外トレ／全面など）。日ヘッダの下に各部の見出しとして置く。
 * 区画ラベル・コート・時間帯・組違い種別を1行で示す。
 * @param {object} part buildDays の day.parts の1要素
 * @param {number} idx 0始まりの区画番号
 */
export function partHeader(part, idx) {
  const SHARE = { rotation: '組違いローテ', together: '男女合同', independent: 'コーチ不在（各自）' };
  const kindLabel = SHARE[part.sharedKind] || '';
  const courtTxt = part.partCourt && part.partCourt !== '不問' ? esc(part.partCourt) : '屋外/コート外';
  const meta = `${courtTxt}・${esc(part.start)}〜${esc(part.end)}・${part.totalMinutes}分${kindLabel ? `・${kindLabel}` : ''}`;
  return `<div class="parthead">
    <span class="ph-no">第${idx + 1}部</span>
    <span class="ph-label">${esc(part.label)}</span>
    <span class="ph-meta">${meta}</span>
  </div>`;
}

/**
 * 2列グリッド描画（組違い ON 時の日ビジュアル本体）。
 * 行ループのみを担い、各セルの描画は renderCell コールバックで各パターンが注入する。
 *
 * @param {object} pd buildDays の day（pd.rotation.rows を持つ）
 * @param {function(row:{type,boys?,girls?,drill?,label?,from,minutes,half?,coachSide?}, side:'boys'|'girls'|'shared'):string} renderCell
 *   各セルのHTML文字列を返すコールバック。side='shared' のとき colspan セル1つ。
 * @returns {string} HTML
 */
export function genderTwoColumn(pd, renderCell) {
  const rot = pd.rotation;
  if (!rot || !rot.rows || rot.rows.length === 0) return '';

  const header = `<div class="twocol-header">
    <div>${genderChip('男子')}</div>
    <div>${genderChip('女子')}</div>
  </div>`;

  const rowsHtml = rot.rows
    .map((row) => {
      if (row.type === 'together') {
        // WU・主自走・CD・both_self: 全幅の合同行
        return `<div class="tc-shared">${renderCell(row, 'shared')}</div>`;
      }
      if (row.type === 'rotation') {
        // コーチ段: boys / girls の2セル
        return `<div class="twocol">
        <div class="tccell ${row.boys.mode === 'practice' ? 'tc-coach' : 'tc-self'}">${renderCell(row, 'boys')}</div>
        <div class="tccell ${row.girls.mode === 'practice' ? 'tc-coach' : 'tc-self'}">${renderCell(row, 'girls')}</div>
      </div>`;
      }
      return '';
    })
    .join('');

  return `${header}<div class="twocol-wrap">${rowsHtml}</div>`;
}

/** KPIメーター（1チーム分）。 */
function kpiCard(label, gender, g) {
  const meters = g.kpi
    .map((k) => {
      const span = Math.abs(k.target - k.baseline) || 1;
      const done = Math.max(0, Math.min(100, Math.round(((span - k.remain) / span) * 100)));
      return `<div class="kpi"><div class="name">${esc(k.label)}</div>
        <div class="val">${esc(String(k.latest))}${esc(k.unit)}<span class="arrow">→</span><span class="tgt">${esc(String(k.target))}${esc(k.unit)}</span></div>
        <div class="bar"><span style="width:${done}%"></span></div></div>`;
    })
    .join('');
  return `<div class="kteam"><div class="kth">${genderChip(gender)}の指標</div><div class="kpis">${meters}</div></div>`;
}

/** 月/週の目標バー（この日の狙いの上に置くボックス）。
 * 目標編集導線（goal-editor）の対象として data-goal-edit を付ける。週起点が無ければ週セルには
 * 編集属性を付けない。学校年度外の週は month:null を受け、月セルを描かない。
 *
 * 週セルは「表示中の週」に追従させる必要がある（日レベルは全週ぶんの .daywk グループを描き、表示中の
 * 週だけが見える）。そのため週と月のテキスト・編集キーは引数 week で差し替えられる。week 省略時は
 * session.goals と goalKeys のアンカー値にフォールバックし、従来の呼び出しと後方互換にする。
 * @param {object} data buildPlanData の戻り値
 * @param {{text:string, key:?string, month:({text:string, key:(string|number)}|null)}} [week]
 */
export function goalsBar(data, week) {
  const g = data.session.goals;
  const keys = data.goalKeys || {};
  const weekText = week ? week.text : g.week;
  const weekKey = week ? week.key : keys.weekKey;
  const month = week && Object.prototype.hasOwnProperty.call(week, 'month')
    ? week.month
    : { key: keys.monthArcKey, text: g.monthMain };
  const monthAttr = (month && month.key != null)
    ? ` data-goal-edit data-goal-scope="month" data-goal-key="${esc(String(month.key))}" data-goal-text="${esc(month.text || '')}"`
    : '';
  const weekAttr = weekKey
    ? ` data-goal-edit data-goal-scope="week" data-goal-key="${esc(weekKey)}" data-goal-text="${esc(weekText || '')}"`
    : '';
  // 未入力（既定空白）はエンジン既定を出さず「未入力」を淡色で示す（編集導線はそのまま＝入力できる）。
  const valHtml = (v) => v
    ? `<span class="gb-val" data-goal-val>${esc(v)}</span>`
    : `<span class="gb-val es-inline" data-goal-val>未入力</span>`;
  const monthCell = month === null
    ? ''
    : `<div class="gb-cell"${monthAttr}><span class="gb-lab">月の目標</span>${valHtml(month.text)}</div>`;
  return `<div class="goalbar${month === null ? ' goalbar--week-only' : ''}">
    ${monthCell}
    <div class="gb-cell"${weekAttr}><span class="gb-lab">週の目標</span>${valHtml(weekText)}</div>
  </div>`;
}

/** 目標セクション（今月/今週/定性は共通、チェックする数字は男女別）。 */
export function goalsSection(data) {
  const g = data.session.goals;
  const keys = data.goalKeys || {};
  const qual = g.qualitative.map((q) => `・${esc(q)}`).join('<br>');
  const monthViewAttr = keys.monthArcKey != null
    ? ` data-goal-view="month:${esc(String(keys.monthArcKey))}"`
    : '';
  const weekViewAttr = keys.weekKey
    ? ` data-goal-view="week:${esc(keys.weekKey)}"`
    : '';
  // 未入力（既定空白）はエンジン既定を出さず「未入力」を淡色で示す（goalsBar と同じ非対称解消）。
  // 空欄のままだと「壊れて見える」（質行が || '—' で守られているのと同じ守りを今月/今週にも揃える）。
  const goalTxt = (v) => v
    ? `<span class="txt" data-goal-val>${esc(v)}</span>`
    : `<span class="txt es-inline" data-goal-val>未入力</span>`;
  return `<section class="goals">
    <h3>目標（チェックする数字は各チーム別）</h3>
    <div class="gline"${monthViewAttr}><span class="lab">今月</span>${goalTxt(g.monthMain)}</div>
    <div class="gline"${weekViewAttr}><span class="lab">今週</span>${goalTxt(g.week)}</div>
    <div class="gline"><span class="lab">質</span><span class="txt">${qual || '—'}</span></div>
    <div class="kgrid">
      ${kpiCard('男子', '男子', data.boysGoals)}
      ${kpiCard('女子', '女子', data.girlsGoals)}
    </div>
  </section>`;
}

/**
 * 年の流れ（男子行・女子行の2段で表示）。
 * 今は男女とも同じ暦月に「いま」が立つ（大会の男女差はコーチ確認で確定後に反映）。
 */
export function yearSection(data) {
  const y = data.year;

  /** 1行分のセル列を作る（gender='boys'|'girls'、currentMonth=その性別の現在月）。 */
  function buildRow(gender, currentMonth) {
    return y.arc
      .map((a) => {
        const peakCls = a.peakLevel === 2 ? ' peak2' : a.peakLevel === 1 ? ' peak1' : '';
        const peakChip = a.peakLevel === 2 ? '<span class="peakchip">目標の大会</span>' : '';
        const isNow = a.month === currentMonth;
        const nowChip = isNow ? `<span class="nowchip ${gender}">${gender === 'boys' ? '男子' : '女子'}いま</span>` : '';
        const shortPhase = esc(a.phase.replace(/（.*$/, '').replace(/\(.*$/, ''));
        // 年タブの各arc月セルも目標編集の対象（月＝arcMonthsマップの同一源）。編集対象テキストは
        // 見出し文（a.headline）。セルは boys/girls の2行に出るが、編集導線は男子行（boys）にだけ
        // 付ける（同一arc月キーが左右2セルに重複すると保存導線が二重になるため）。
        // 狭セルなので data-goal-overlay で画面下オーバーレイ編集にする（セル内インライン展開だと行が崩れる）。
        const goalAttr = gender === 'boys'
          ? ` data-goal-edit data-goal-overlay="1" data-goal-scope="month" data-goal-key="${esc(String(a.month))}" data-goal-text="${esc(a.headline)}" data-goal-title="${esc(String(a.month))}月の目標"`
          : ` data-goal-view="month:${esc(String(a.month))}"`;
        return `<div class="arccell${peakCls}${isNow ? ' arccell-now' : ''}"${goalAttr} title="${esc(a.headline)}">
          <span class="am">${a.month}月</span>
          <span class="ap">${shortPhase}</span>
          ${peakChip}
          ${nowChip}
        </div>`;
      })
      .join('');
  }

  const boysRow = buildRow('boys', y.currentBoys);
  const girlsRow = buildRow('girls', y.currentGirls);
  const peakLabels = y.peaks.map((p) => `${esc(p.label)}（${p.months.join('・')}月）`).join(' ／ ');

  return `<h3 class="lvh">1年の流れ（夏に新チーム発足 → 冬の新人大会 → 翌夏の中体連）</h3>
    <p class="note">男子・女子それぞれの「今月の位置」と「目標の大会の時期」を2行で並べています。今は男女とも同じ流れです（大会の男女差はコーチ確認で確定）。</p>
    <div class="arcrows">
      <div class="arcrow-label"><span class="gchip boys">男子</span></div>
      <div class="arcwrap">${boysRow}</div>
      <div class="arcrow-label"><span class="gchip girls">女子</span></div>
      <div class="arcwrap">${girlsRow}</div>
    </div>
    <div class="arclegend">
      <span class="lk"><span class="sw" style="background:var(--orange-soft)"></span>目標の大会：${peakLabels}</span>
      <span class="lk"><span class="sw" style="background:var(--boys)"></span>いま（${y.currentBoys}月・男女共通）</span>
    </div>`;
}

/** 月セクション（今月やること・フェーズ・チェックする数字・共通）。m/displayMonth を渡せば任意の月を描ける（複数月の実切替用）。
 * arcMonthKey（その月のarc月キー）を渡すと「今月やること」を目標編集導線の対象にする（月＝arcMonthsマップ）。 */
export function monthSection(data, m = data.session.month, displayMonth = data.month, arcMonthKey = (m && m.arcMonth)) {
  const peak = m.peak
    ? `<div class="mc-peak">大会に向けて仕上げる時期（${esc(peakName(data, m.peak))}）</div>`
    : '';
  const kpi =
    m.kpiHints && m.kpiHints.length
      ? `<div class="mc-kpi"><div class="kk">チェックする数字</div><div class="kv">${m.kpiHints.map(esc).join('・')}</div></div>`
      : '';
  const aimAttr = (arcMonthKey != null)
    ? ` data-goal-edit data-goal-scope="month" data-goal-key="${esc(String(arcMonthKey))}" data-goal-text="${esc(m.headline || '')}"`
    : '';
  // 未入力（既定空白）はエンジン既定見出しを出さず「未入力」を淡色で示す（編集導線はそのまま）。
  const aimHtml = m.headline
    ? `<div class="mc-aim"${aimAttr}><span data-goal-val data-goal-empty="今月の目標は未入力">${esc(m.headline)}</span></div>`
    : `<div class="mc-aim"${aimAttr}><span class="es-inline" data-goal-val data-goal-empty="今月の目標は未入力">今月の目標は未入力</span></div>`;
  return `<h3 class="lvh">${displayMonth}月にやること</h3>
    <div class="monthcard">
      <div class="mc-h"><span class="mc-mon">${displayMonth}月</span><span class="mc-phase">${esc(m.phase)}</span></div>
      ${aimHtml}
      ${peak}
      ${kpi}
    </div>
    <p class="note">フェーズ・確認したい数字は年間予定どおり。今月の目標は入力したぶんだけ表示します。</p>`;
}

/** ピークkeyから表示名を引く。 */
function peakName(data, key) {
  const p = (data.year.peaks || []).find((x) => x.key === key);
  return p ? p.label : key;
}

/** 暫定前提の注記。 */
export function assumptionsNote(data) {
  if (!data.assumptions || !data.assumptions.length) return '';
  const items = data.assumptions.map((a) => `<li>${esc(a)}</li>`).join('');
  return `<div class="note"><b style="color:var(--orange-deep)">前提（コーチ確認で確定）</b><ul class="assume">${items}</ul></div>`;
}

/**
 * 印刷/PDF保存時のタイトル用日付文字列を決める純関数（ブラウザのPDF保存既定ファイル名は <title> 由来）。
 * 選択中日付(window.__curDate、ISO yyyy-mm-dd)から yyyymmdd を組み立てる。未設定・不正形式・
 * 実在しない日（2/30等・Date往復で成分一致を確認）のときは null を返す＝呼び出し側は現行タイトル維持
 * （フォールバック・throwしない）。
 * クライアント IIFE はこの純関数の本体を埋め込んで使う（node 側でテストした規則と実行時を一致＝ドリフト防止）。
 * @param {string|null|undefined} iso 選択中日付のISO(yyyy-mm-dd)。window.__curDate 由来
 * @returns {string|null} yyyymmdd。差替不可（未設定・不正・非実在日）なら null
 */
export function pdfPrintTitle(iso) {
  if (!iso) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  var dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null; // 2/30等は繰り上がり＝非実在日
  return m[1] + m[2] + m[3];
}

/**
 * 印刷前後のタイトル差替・復元の状態遷移（純: DOMはアダプタ host 経由・node:test で実行時挙動を検証）。
 * クライアント IIFE は pdfPrintTitle とペアで本体を埋め込んで使う（自由変数 pdfPrintTitle は埋め込み先スコープで解決）。
 * - beforeprint: 未差替のときだけ元タイトルを保存し、選択中日付が妥当なら日付タイトルへ差替。
 *   差替中の再入（連打・多重発火）と日付なし・不正時は何もしない（現行タイトル維持）。
 * - restore: 差替済みのときだけ元タイトルへ復元し状態をクリア。未差替・復元済みなら何もしない（冪等）。
 *   afterprint と focus（afterprint不発環境の保険）の両方から呼んでも安全。
 * @param {{getTitle:()=>string, setTitle:(t:string)=>void, getCurDate:()=>(string|null|undefined)}} host
 * @returns {{beforeprint:()=>void, restore:()=>void}}
 */
export function createPrintTitleSwap(host) {
  var savedTitle = null; // null＝未差替（差替中だけ元タイトルを保持）
  return {
    beforeprint: function () {
      if (savedTitle !== null) return; // 差替中の再入（連打・beforeprint多重発火）は無視
      var next = pdfPrintTitle(host.getCurDate());
      if (next === null) return; // 日付未選択・不正 → 差替しない（現行タイトルのまま印刷）
      savedTitle = host.getTitle();
      host.setTitle(next);
    },
    restore: function () {
      if (savedTitle === null) return; // 未差替・復元済み → 何もしない（冪等）
      host.setTitle(savedTitle);
      savedTitle = null;
    },
  };
}

/** タブ切替＋印刷＋テキストコピー＋組違いON/OFF の共通スクリプト。 */
export function clientScript() {
  return `(function(){
  function tabs(group,target){
    document.querySelectorAll('[data-'+group+']').forEach(function(p){p.hidden=p.getAttribute('data-'+group)!==target;});
  }
  function setLevel(t){
    document.querySelectorAll('.lvtab').forEach(function(x){x.classList.toggle('on',x.getAttribute('data-go')===t);});
    tabs('level',t);
  }
  document.querySelectorAll('.lvtab').forEach(function(b){b.addEventListener('click',function(){
    setLevel(b.getAttribute('data-go'));
  });});
  // ── 日レベルは全週ぶんに広がる（編集できる「日」画面が複数週）。可視は常に1日（単一可視日の不変条件）。
  // 日付(ISO)を唯一の起点にして切り替える。曜日名は別週の同曜日と衝突するため使わない。──
  var dts=document.querySelectorAll('.cal-go');           // 各週の日ピッカーのボタン（data-date付き）
  var dws=document.querySelectorAll('.cal-go-dayweek');   // 日レベルの週セレクタ（data-dayweek）
  var wts=document.querySelectorAll('.cal-go-week');      // 週レベルの週タブ（data-go）
  var weekNavNodes=document.querySelectorAll('.wknav');
  var firstWeekNav=weekNavNodes.length?weekNavNodes[0]:null;
  var firstWeekTabs=firstWeekNav?firstWeekNav.querySelectorAll('.picker .pk'):[];
  var orderAttr=firstWeekTabs.length&&firstWeekTabs[0].hasAttribute('data-dayweek')?'data-dayweek':'data-go';
  var ORDER=[];
  for(var oi=0;oi<firstWeekTabs.length;oi++){ORDER.push(firstWeekTabs[oi].getAttribute(orderAttr));}
  var WIN=4;
  var TODAY_KEY=firstWeekNav?firstWeekNav.getAttribute('data-today-week'):null;
  var TODAY_IDX=TODAY_KEY?ORDER.indexOf(TODAY_KEY):-1;
  var winStart=TODAY_IDX>=0?TODAY_IDX:0;
  var selectedWeek=TODAY_KEY;

  function selectedMonthValue(select,selectedIdx){
    var bestIdx=-1;
    var bestValue='';
    for(var i=0;i<select.options.length;i++){
      var optionIdx=ORDER.indexOf(select.options[i].getAttribute('data-week'));
      if(optionIdx<=selectedIdx&&optionIdx>bestIdx){
        bestIdx=optionIdx;
        bestValue=select.options[i].value;
      }
    }
    return bestValue;
  }
  function applyWindow(){
    if(!ORDER.length)return;
    var selectedIdx=ORDER.indexOf(selectedWeek);
    if(selectedIdx<0)throw new Error('選択週が週ナビの順序にありません: '+selectedWeek);
    if(selectedIdx<winStart)winStart=selectedIdx;
    if(selectedIdx>=winStart+WIN)winStart=selectedIdx-WIN+1;
    var maxStart=Math.max(0,ORDER.length-WIN);
    if(winStart<0)winStart=0;
    if(winStart>maxStart)winStart=maxStart;
    weekNavNodes.forEach(function(nav){
      var navTabs=nav.querySelectorAll('.cal-go-dayweek,.cal-go-week');
      navTabs.forEach(function(tab){
        var key=tab.hasAttribute('data-dayweek')?tab.getAttribute('data-dayweek'):tab.getAttribute('data-go');
        var idx=ORDER.indexOf(key);
        tab.hidden=idx<winStart||idx>=winStart+WIN;
      });
      var prev=nav.querySelector('.wk-prev');
      var next=nav.querySelector('.wk-next');
      var today=nav.querySelector('.wk-today');
      var select=nav.querySelector('.wk-jump-sel');
      if(prev)prev.disabled=winStart===0;
      if(next)next.disabled=winStart+WIN>=ORDER.length;
      if(today)today.setAttribute('data-shown',selectedWeek===TODAY_KEY?'false':'true');
      if(select){
        var monthValue=selectedMonthValue(select,selectedIdx);
        if(monthValue)select.value=monthValue;
      }
    });
  }
  // ある .day[data-date] が属する .daywk[data-week] のキーを返す。
  function weekKeyOfDay(node){
    var wk=node&&node.closest?node.closest('.daywk'):null;
    return wk?wk.getAttribute('data-week'):null;
  }
  // 選んでいる週を単一の持ち場（この関数）に集約する。日レベル(.daywk/.daywk-picker/
  // .cal-go-dayweek)と週レベル(.wkpanel/.cal-go-week)のどちらを動かすときも必ずこの関数を経由させ、
  // 両方へ同時に反映する。片方向の追従（例: 日→週だけ）だと逆向き（週→日）で同じ食い違いが残るため、
  // 状態の持ち場をここ1箇所に集約する（2026-08-02 QA差し戻し是正: 日と週を行き来すると選択が食い違う）。
  function selectWeek(weekKey){
    if(!weekKey)return;
    // .daywk（goalsBar+タイムライン）と .daywk-picker（7曜日ピッカー・row2左側）は別要素だが同じ
    // data-week キーを共有するグループなので、両方まとめて切り替える（週切替時の表示ズレを防ぐ）。
    document.querySelectorAll('.daywk[data-week],.daywk-picker[data-week]').forEach(function(g){g.hidden=g.getAttribute('data-week')!==weekKey;});
    dws.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-dayweek')===weekKey);});
    document.querySelectorAll('.wkpanel[data-week]').forEach(function(p){p.hidden=p.getAttribute('data-week')!==weekKey;});
    wts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===weekKey);});
    selectedWeek=weekKey;
    applyWindow();
  }
  // 指定ISOの日だけを可視にする（全 .day を一旦 hidden→該当1つだけ表示）。属する週（日レベル・
  // 週レベルの両方）は selectWeek で同時に揃える。
  function showDayByDate(iso){
    if(!iso)return;
    var target=document.querySelector('.day[data-date="'+iso+'"]');
    if(!target)return;
    document.querySelectorAll('.day[data-date]').forEach(function(p){p.hidden=p.getAttribute('data-date')!==iso;});
    selectWeek(weekKeyOfDay(target));
    // 日ピッカーの on は「いま見えている日＝同じISO」のボタンだけ。
    dts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-date')===iso);});
    window.__curDay=target.getAttribute('data-day'); // 既存コピー導線の互換（表示中の曜日）
    window.__curDate=iso;                              // 表示中の実ISO（単一可視日）
  }
  // 週起点未設定テナント（全日 date:null＝cal-go の data-date が空）用フォールバック。
  // 実ISOが無いので曜日(data-go)で切り替える。単一週なので .daywk は1グループ＝週同期は不要だが、
  // 多週時と同型に「全 .day を一旦 hidden→対象の1つだけ表示」で可視一意化する（curDay の前提＝
  // hidden でない最初の .day が常に1件、を曜日経路でも守る）。
  function showDayByDay(dayName){
    if(!dayName)return;
    var target=document.querySelector('.day[data-day="'+(window.CSS&&CSS.escape?CSS.escape(dayName):dayName)+'"]');
    if(!target)return;
    document.querySelectorAll('.day[data-date]').forEach(function(p){p.hidden=p!==target;});
    // 日ピッカーの on は同じ曜日のボタンだけ（ISO経路と対称）。
    dts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===dayName);});
    window.__curDay=dayName;       // 表示中の曜日（コピー導線の互換）
    window.__curDate=null;         // 実ISO無し（曜日フォールバック経路）
  }
  // cal-go は実ISO(data-date)があればそれで切り替える（多週・曜日衝突を実ISOで回避）。
  // 週起点未設定で data-date が空なら曜日(data-go)フォールバックで切り替える（無反応の退行を根治）。
  dts.forEach(function(b){b.addEventListener('click',function(){
    var iso=b.getAttribute('data-date');
    if(iso){showDayByDate(iso);}else{showDayByDay(b.getAttribute('data-go'));}
  });});
  // その週グループの既定日ISO（今日がその週内なら今日、無ければその週の先頭練習日）。
  function defaultDateOfWeek(wkKey,todayIso){
    var grp=document.querySelector('.daywk[data-week="'+(window.CSS&&CSS.escape?CSS.escape(wkKey):wkKey)+'"]');
    if(!grp)return null;
    var days=grp.querySelectorAll('.day[data-date]');
    for(var i=0;i<days.length;i++){if(days[i].getAttribute('data-date')===todayIso)return todayIso;}
    return days.length?days[0].getAttribute('data-date'):null;
  }
  // 週を切り替える単一の入口（日レベルの週セレクタ・週レベルの週タブの両方がここを呼ぶ）。
  // その週の既定日（今日 or 先頭練習日）があれば showDayByDate（内部で selectWeek も揃う）、
  // 無ければ selectWeek だけで週の状態を合わせる（週起点未設定等・実運用ではまず通らない経路）。
  function goToWeek(weekKey){
    var iso=defaultDateOfWeek(weekKey,todayISO());
    if(iso){showDayByDate(iso);}else{selectWeek(weekKey);}
  }
  function stepWeek(delta){
    var nextStart=winStart+delta;
    if(nextStart<0||nextStart+WIN>ORDER.length)return;
    winStart=nextStart;
    goToWeek(ORDER[winStart]);
  }
  function jumpToMonth(select){
    var option=select&&select.options[select.selectedIndex];
    var weekKey=option&&option.getAttribute('data-week');
    var idx=ORDER.indexOf(weekKey);
    if(idx<0)throw new Error('年月ジャンプの週が週ナビの順序にありません: '+weekKey);
    winStart=Math.min(idx,Math.max(0,ORDER.length-WIN));
    goToWeek(weekKey);
  }
  function goToday(){
    if(TODAY_IDX<0)return;
    winStart=TODAY_IDX;
    goToWeek(TODAY_KEY);
  }
  weekNavNodes.forEach(function(nav){
    var prev=nav.querySelector('.wk-prev');
    var next=nav.querySelector('.wk-next');
    var today=nav.querySelector('.wk-today');
    var select=nav.querySelector('.wk-jump-sel');
    if(prev)prev.addEventListener('click',function(){stepWeek(-1);});
    if(next)next.addEventListener('click',function(){stepWeek(1);});
    if(today)today.addEventListener('click',goToday);
    if(select)select.addEventListener('change',function(){jumpToMonth(select);});
  });
  // 週セレクタ（日レベル）: 選んだ週へ切り替える。
  dws.forEach(function(b){b.addEventListener('click',function(){goToWeek(b.getAttribute('data-dayweek'));});});
  // 週タブ（週レベル）: 選んだ週へ切り替える。日レベルの週セレクタと同じ goToWeek 入口を通すことで、
  // どちらから切り替えても日・週両方の状態が揃う（食い違いを構造的に防ぐ）。
  wts.forEach(function(b){b.addEventListener('click',function(){goToWeek(b.getAttribute('data-go'));});});
  // レベルを day に切替＋指定日を出す（週グリッドの曜日ヘッダ・他導線からの遷移）。
  function jumpToDate(iso){
    if(!iso)return;
    setLevel('day');
    showDayByDate(iso);
  }
  function todayISO(){
    var n=new Date();
    return n.getFullYear()+'-'+('0'+(n.getMonth()+1)).slice(-2)+'-'+('0'+n.getDate()).slice(-2);
  }
  // 週グリッドの曜日ヘッダ（[data-jumpdate]）クリックでその日の入力へ遷移。
  document.querySelectorAll('[data-jumpdate]').forEach(function(b){b.addEventListener('click',function(){
    jumpToDate(b.getAttribute('data-jumpdate'));
  });});
  // 既定表示日=今日に最も近い練習日（多週対応）: data-date が空でない全候補から今日との暦日差が
  // 最小の日を選ぶ。今日がちょうど練習日ならその日。今日が休養日（谷間）のときは直近の未来の
  // 練習日を優先し、範囲内に未来が無ければ直近の過去の練習日にフォールバックする。
  // 実日付を1件も持たないテナント（週起点未設定）は候補ゼロのまま静的初期表示に委ねる（従来動作維持）。
  (function(){
    var iso=todayISO();
    var nodes=document.querySelectorAll('.day[data-date]');
    var candidates=[];
    for(var i=0;i<nodes.length;i++){
      var v=nodes[i].getAttribute('data-date');
      if(v)candidates.push(v);
    }
    if(candidates.length===0)return;
    if(candidates.indexOf(iso)!==-1){showDayByDate(iso);return;}
    var future=candidates.filter(function(d){return d>iso;}).sort();
    if(future.length){showDayByDate(future[0]);return;}
    var past=candidates.filter(function(d){return d<iso;}).sort();
    showDayByDate(past.length?past[past.length-1]:candidates.sort()[0]);
  })();
  // 月ピッカー実切替: 押下した月の mopanel だけ出す。
  var mts=document.querySelectorAll('.cal-go-month');
  function showMonth(t){document.querySelectorAll('.mopanel[data-month]').forEach(function(p){p.hidden=p.getAttribute('data-month')!==t;});
    mts.forEach(function(b){b.classList.toggle('on',b.getAttribute('data-go')===t);});window.__curMonth=t;}
  mts.forEach(function(b){b.addEventListener('click',function(){showMonth(b.getAttribute('data-go'));});});
  // ── 印刷/PDF保存の既定ファイル名を選択中日付(yyyymmdd)にする ──
  // タイトル差替は window の beforeprint/afterprint に初期化時1回だけ登録する（ボタン経由も
  // Ctrl+P・ブラウザメニュー印刷も同じ経路で対象になり、連打・リスナー多重登録の穴が構造ごと消える）。
  // 差替・復元の状態遷移は node 側でテスト済みの純関数を埋め込む（規則と実行時を一致＝ドリフト防止）。
  var pdfPrintTitle=${pdfPrintTitle.toString()};
  var createPrintTitleSwap=${createPrintTitleSwap.toString()};
  var titleSwap=createPrintTitleSwap({
    getTitle:function(){return document.title;},
    setTitle:function(t){document.title=t;},
    getCurDate:function(){return window.__curDate;}
  });
  window.addEventListener('beforeprint',titleSwap.beforeprint);
  window.addEventListener('afterprint',titleSwap.restore);
  window.addEventListener('focus',titleSwap.restore); // afterprint不発環境の保険（restoreは冪等＝多重発火無害）
  var p=document.getElementById('printBtn'); if(p)p.addEventListener('click',function(){window.print();});
  var c=document.getElementById('copyBtn'); if(c)c.addEventListener('click',function(){
    // 現在表示中の日（単一可視日＝__curDate）の .plain を拾う。多週で曜日名は衝突するので実ISOで引く。
    // フォールバック: __curDate が無ければ hidden でない最初の .day の .plain（curDay 相当）。
    var day=(window.__curDate&&document.querySelector('.day[data-date="'+window.__curDate+'"]'))||(function(){
      var ns=document.querySelectorAll('.day[data-date]');
      for(var i=0;i<ns.length;i++){if(!ns[i].hidden)return ns[i];}
      return null;
    })();
    var el=day?day.querySelector('.plain'):document.querySelector('.plain');
    // copyBtn はアイコンのみ（sr-onlyラベル＋SVG）なので、旧実装のようにボタン自身の textContent は
    // 書き換えない（書き換えるとアイコン構造ごと消えて元に戻らなくなる）。共有の状態表示(#ed-msg)へ出す。
    navigator.clipboard.writeText(el?el.textContent:'').then(function(){
      var msg=document.getElementById('ed-msg');
      if(msg){msg.textContent='コピーしました';setTimeout(function(){msg.textContent='';},1500);}
    });
  });
  // ── ハッシュ駆動ドリル詳細オーバーレイ（§2.2）──
  var overlay=document.getElementById('drill-overlay');
  function openDrill(id){
    if(!overlay)return;
    overlay.querySelectorAll('.drill-panel').forEach(function(p){p.hidden=p.getAttribute('data-id')!==id;});
    overlay.hidden=false;
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
  }
  function closeDrill(){
    if(!overlay)return;
    overlay.hidden=true;
    overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
    if(location.hash){try{history.pushState('',document.title,location.pathname+location.search);}catch(_){location.hash='';}}
  }
  function syncHash(){
    var h=location.hash.replace('#drill-','');
    if(location.hash.indexOf('#drill-')===0&&h){openDrill(h);}
    else if(overlay&&!overlay.hidden){closeDrill();}
  }
  window.addEventListener('hashchange',syncHash);
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-drill]');
    if(t){e.preventDefault();var id=t.getAttribute('data-drill');location.hash='drill-'+id;}
  });
  if(overlay){
    // 戻る・暗幕は委譲で拾う（パネルは214枚あるため個別バインドだと先頭以外に効かない）
    overlay.addEventListener('click',function(e){
      if(e.target.closest('.drill-close')){location.hash='';return;}
      if(e.target===overlay||e.target.classList.contains('drill-scrim'))location.hash='';
    });
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&overlay&&!overlay.hidden)location.hash='';});
  syncHash();
})();`;
}

/**
 * 1パターン分の HTML 文書を組み立てる純関数（外殻＋CSS＋body＋client script）。
 * 静的ビルド(build.mjs)・Cloud Function 双方から再利用する（描画ロジックは触らない）。
 * ※ build.mjs には静的ビルド専用の総なめ import があり、Cloud Function 側がそれを束ねると
 *   非JS資産まで巻き込んで失敗するため、この純関数だけは glob を持たない本モジュールに置く。
 * @param {{title:string, css?:string, body:string, script?:string}} arg
 * @returns {string} 完全な HTML 文書
 */
export function renderPage({ title, css, body, script }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${BASE_CSS}${css || ''}</style>
</head>
<body>
<main class="wrap">
${body}
</main>
<script>${script || clientScript()}</script>
</body>
</html>`;
}

/**
 * 1区画（または単一日）のブロック明細を配布テキスト行に変換する。
 * @param {string[]} L 追記先の行配列
 * @param {Array} blocks 区画/日のブロック配列
 */
function plainBlocks(L, blocks) {
  for (const b of blocks) {
    L.push(`${b.from}〜${b.to}　${b.label}（${b.minutes}分）`);
    for (const it of b.items) {
      const tag = it.mode === 'practice' ? '（コーチ付き）' : it.mode === 'lecture' ? '（レクチャ）' : '';
      const mins = b.isBundle ? '' : `（${it.minutes}分）`;
      L.push(`　・${it.name}${tag}${mins}${it.alternatives.length ? `／いずれか：${it.alternatives.join('・')}` : ''}`);
    }
    if (!b.isBundle) L.push('　・給水');
  }
}

/** 貼り付け用プレーンテキスト（男女2列スワップの段取り＋共通メニュー）。 */
export function plainText(data, pd) {
  const L = [];

  // コーチ指定の上書き日: 手書き内容をそのまま箇条書きにする（rotation/共通メニュー段取りは出さない）。
  if (pd.source === 'coach') {
    // 男女2列日（twoCol）: 時間スロットごとに男女2列で出す。both は男女共通の1本。
    if (pd.twoCol) {
      const onlyG = (pd.onlyGender === '男子' || pd.onlyGender === '女子') ? pd.onlyGender : null;
      // 見出しは実際の割れ方に合わせる（行単位判定）: 全行共通／一部だけ男女別／全行男女別。
      const splitCount = pd.rows.filter((r) => !isTogetherRow(r)).length;
      const headScope = onlyG
        ? `・${onlyG}のみ`
        : isAllTogetherTwoColRows(pd.rows)
          ? '・男女共通'
          : splitCount === pd.rows.length
            ? '・男女2列'
            : '・一部男女別';
      L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${pd.court}${headScope}）${pd.title || '練習メニュー'}`);
      L.push('');
      L.push(`■ この日のねらい：${pd.aim}`);
      const cellText = (cell) =>
        (cell.items || []).map((it) => `${it.name}${it.note ? `（${it.note}）` : ''}`).join('／');
      const cellLine = (cell) => (cell ? `${cell.label}：${cellText(cell)}` : '—');
      for (const r of pd.rows) {
        L.push('');
        L.push(`■ ${r.from}〜${r.to}`);
        if (onlyG) {
          // オンリー時は対象性別の行だけ出す（幽霊の反対列を出さない・E）。
          // 対象セルが無く r.both があれば共通(both)を出す（F と整合）。
          const sideKey = onlyG === '男子' ? 'boys' : 'girls';
          const cell = r[sideKey] || r.both || null;
          L.push(`　${onlyG}｜${cellLine(cell)}`);
        } else if (isTogetherRow(r)) {
          // 明示のboth、または男女セルの内容一致（行単位）のいずれも共通の1本行として出す。
          const cell = r.both || r.boys || r['男子'] || null;
          L.push(`　[男女共通] ${cellLine(cell)}`);
        } else {
          L.push(`　男子｜${cellLine(r.boys)}`);
          L.push(`　女子｜${cellLine(r.girls)}`);
        }
      }
      L.push('　・終了');
      return L.join('\n');
    }
    const teamTxt = pd.team ? `・対象：${pd.team}` : '・男女共通';
    L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${pd.court}${teamTxt}）${pd.title || '練習メニュー'}`);
    L.push('');
    L.push(`■ この日のねらい：${pd.aim}`);
    for (const b of pd.blocks) {
      L.push('');
      L.push(`■ ${b.label}`);
      for (const it of b.items) {
        const mins = it.minutes != null && it.minutes > 0 ? `（${it.minutes}分）` : '';
        const note = it.note ? `　${it.note}` : '';
        L.push(`　・${it.name}${mins}${note}`);
      }
    }
    L.push('　・終了');
    return L.join('\n');
  }

  const headCourt = Array.isArray(pd.parts) && pd.parts.length > 1
    ? pd.parts.map((p) => `${p.label}${p.totalMinutes}分`).join('＋')
    : pd.court;
  L.push(`【${data.school}】${data.month}月 ${pd.dayLabel}（${headCourt}・${pd.start}〜${pd.end}）練習メニュー`);
  L.push('');
  L.push(`■ 本日の狙い：${pd.aim}`);

  // 2部構成の日（火）: 区画ごとに見出し＋メニューを分けて出す。
  if (Array.isArray(pd.parts) && pd.parts.length > 0) {
    pd.parts.forEach((part, idx) => {
      L.push('');
      const courtTxt = part.partCourt && part.partCourt !== '不問' ? part.partCourt : '屋外/コート外';
      L.push(`━━ 第${idx + 1}部 ${part.label}（${courtTxt}・${part.start}〜${part.end}・${part.totalMinutes}分）━━`);
      if (part.sharedKind === 'together') {
        L.push('■ 男女合同（コーチが両方を同時に）。');
      } else if (part.sharedKind === 'rotation') {
        L.push('■ 組違い（コーチ1人）：要監督ドリルを男女左右2列でずらす（前後半で入れ替え）。');
      } else {
        L.push('■ コーチ不在：男女とも各自で自走。');
      }
      plainBlocks(L, part.blocks);
    });
    L.push('　・終了');
    return L.join('\n');
  }

  if (pd.sharedKind === 'rotation' && pd.rotation) {
    L.push('■ 組違い（コーチ1人）：要監督ドリルを男女左右2列でずらす。');
    L.push('  前半：コーチ付き側が要監督ドリル、もう片方は別の自走ドリル');
    L.push('  後半：左右入れ替え（入れ替え後にコーチ付き側が変わる）');
    L.push('  ─ 前後半を合わせて両グループが同じカリキュラムを全部こなす ─');
    L.push('');
    L.push('■ 組違いスケジュール（男子左列 / 女子右列）');
    for (const row of pd.rotation.rows) {
      if (row.type === 'together') {
        // drill.name が集約主見出し（例: ダイナミックストレッチ）を使う
        const togetherName = row.drill?.name || row.label || '';
        const compNote = row.drill?.components?.length
          ? `（内訳：${row.drill.components.join('／')}）`
          : '';
        L.push(`  ${row.from}  [両] ${togetherName}（${row.minutes}分）${compNote}`);
      } else if (row.type === 'rotation') {
        const bTag = row.boys.mode === 'practice' ? '●' : '自走';
        const gTag = row.girls.mode === 'practice' ? '●' : '自走';
        L.push(`  ${row.from}（${row.half}）`);
        L.push(`    男子(${bTag}) ${row.boys.name}  ／  女子(${gTag}) ${row.girls.name}`);
      }
    }
  } else if (pd.sharedKind === 'together') {
    L.push('■ 土曜は男女合同（コーチが両方を同時に）。');
  } else {
    L.push('■ コーチ不在日：男女とも各自で自走。');
  }

  L.push('');
  L.push('■ 共通メニュー（男女同一の内容）');
  for (const b of pd.blocks) {
    L.push(`${b.from}〜${b.to}　${b.label}（${b.minutes}分）`);
    for (const it of b.items) {
      const tag = it.mode === 'practice' ? '（コーチ付き）' : it.mode === 'lecture' ? '（レクチャ）' : '';
      // 束ね（WU/CD）の内訳はルーティンの順序情報のみ。時間はブロック単位（5分刻み）に一本化し、
      // 端数の内訳分数（1分・2分等）は配布テキストに出さない。
      const mins = b.isBundle ? '' : `（${it.minutes}分）`;
      L.push(`　・${it.name}${tag}${mins}${it.alternatives.length ? `／いずれか：${it.alternatives.join('・')}` : ''}`);
    }
    if (!b.isBundle) L.push('　・給水');
  }
  L.push('　・終了');
  return L.join('\n');
}
