/**
 * @file ドリル詳細レジストリ（素カタログ直読み・notesクレンジング）。
 *
 * normalize.js 経由では balls 等のフィールドが落ちるため、詳細表示用の registry は
 * 素の drills.json を直接読む。照合は名前（214件全件一意）。
 *
 * §1.4 notesクレンジング（決定論・LLM不使用）:
 *   - notes を句点（。）で文に分割し、メモ語（固定リスト）を含む文を丸ごと除去。
 *   - 元データ（drills.json）は書き換えない。表示層のみ。
 *   - クレンジング後に空になるドリルは §2.4 のフォールバック文字列で表示。
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { AIM_MAP, SHORT_CAT } from './plan-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** §1.4 notesクレンジング対象の固定語リスト。 */
const MEMO_WORDS = [
  '要出典補完',
  '出典',
  'fetch',
  'WebFetch',
  '403',
  '404',
  '検索',
  'サイト本文',
  'ページ正式',
  '指標化候補',
  '別エントリ',
  'bot',
  'URL',
  '動画あり',
  // 検証完了メモ語（調査・照合・所蔵情報を示す文を全カタログでゲート）
  '検証',    // 「検証:」「検証済:」等を前方一致で包含
  '実在',
  '明記',
  '掲載',
  '訂正',
  '収集元',
  '照合',
  '一致',    // 「内容一致」「記載あり一致」「候補と一致」等を包含
  '索引では',
  'http',
  'source_url',
  'video_url',
  'NFHS',
  'YouTube',
  // 傷害予防・強度判定系内部メモ
  'intensity_class',
  '強度の判定',
];

/**
 * notes 文字列からAI調査メモを除去して「やり方の要点」テキストを返す純関数。
 *
 * §1.4 仕様:
 * 1. 句点（。）で文に分割する
 * 2. MEMO_WORDS のいずれかを含む文を丸ごと落とす
 * 3. 残った文を 。 で再結合する
 * 4. 空になったら null を返す（フォールバック文字列はレンダリング側で付与）
 *
 * @param {string|null|undefined} notes 生の notes 文字列
 * @returns {string|null} クレンジング後のテキスト（空化した場合は null）
 */
export function cleanDrillNotes(notes) {
  if (!notes || !notes.trim()) return null;
  const sentences = notes.split('。').map((s) => s.trim()).filter(Boolean);
  const cleaned = sentences.filter(
    (s) => !MEMO_WORDS.some((w) => s.includes(w)),
  );
  if (cleaned.length === 0) return null;
  // 元の句点区切りで再結合（末尾に。を付ける）
  return cleaned.join('。') + '。';
}

/**
 * ドリル詳細レジストリを構築する。
 * 素の drills.json（normalize 前）を読み、名前→詳細オブジェクトの Map を返す。
 *
 * @returns {Map<string, object>}
 */
export function buildDrillRegistry() {
  const drillsPath = resolve(__dirname, '../docs/practice-knowledge/data/drills.json');
  const rawDrills = JSON.parse(readFileSync(drillsPath, 'utf8'));

  return new Map(
    rawDrills.map((d) => {
      const notesClean = cleanDrillNotes(d.notes);
      return [
        d.name,
        {
          id: d.id,
          name: d.name,
          category: d.category,
          aim: AIM_MAP[d.category] || `${SHORT_CAT[d.category] || d.category}を磨く`,
          subSkill: d.sub_skill || null,
          metricMeaning: d.metric_meaning || null,
          notesClean, // null = 空化（フォールバック表示）
          court: d.court || null,
          balls: d.balls || null,
          people: d.people || null,
          durationMin: d.duration_min || null,
          durationMax: d.duration_max || null,
          grades: d.grades || null,
          intensity: d.intensity_class || null,
          loadNotes: d.load_notes || null,
          masteryStage: d.mastery_stage || null,
          video: d.video_url || null,
          sourceName: d.source_name || null,
          sourceUrl: d.source_url || null,
        },
      ];
    }),
  );
}
