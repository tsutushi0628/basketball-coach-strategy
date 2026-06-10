/**
 * @file cleanDrillNotes() ユニットテスト（§1.4 業務要件検証）。
 *
 * 3系統を業務期待で検証:
 *   1. メモ混在 → やり方のみ残る
 *   2. 全文メモ → null（空文字ではなく null）
 *   3. メモ無し → 原文不変
 */

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { cleanDrillNotes } from './drill-detail.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 全カタログゲート: 214件全ドリルのクレンジング後本文に監査語ゼロを保証する。
// 「確認」は追加禁止（「パス回しで動きを確認」等の正当手順文が誤爆する）。
const AUDIT_WORDS = [
  '検証', '実在', '明記', '掲載', '訂正', '収集元', '照合', '一致',
  '索引では', 'http', 'source_url', 'video_url', 'NFHS', 'YouTube',
  '要出典補完', '出典', 'fetch', 'WebFetch', '403', '404', 'bot', 'URL',
  '動画あり', '別エントリ', 'intensity_class', '強度の判定',
];

test('全カタログゲート: 214件クレンジング後に監査語ゼロ', () => {
  const drillsPath = resolve(__dirname, '../docs/practice-knowledge/data/drills.json');
  const drills = JSON.parse(readFileSync(drillsPath, 'utf8'));
  const violations = [];
  for (const d of drills) {
    const cleaned = cleanDrillNotes(d.notes);
    if (!cleaned) continue; // null（空化）はOK
    for (const w of AUDIT_WORDS) {
      if (cleaned.includes(w)) {
        violations.push(`[${d.id}] ${d.name}: 「${w}」が残存 → ${cleaned.slice(0, 80)}…`);
      }
    }
  }
  assert.deepStrictEqual(violations, [], '監査語残存:\n' + violations.join('\n'));
});

test('メモ混在: メモ文を除去してやり方のみ残す', () => {
  const input = 'ドリブルで間合いを詰め、フロントチェンジで抜く。要出典補完。ディフェンスはフットワーク優先で対応する。';
  const result = cleanDrillNotes(input);
  // 「要出典補完」を含む文が除去されている
  assert.ok(!result.includes('要出典補完'), 'メモ語が残っている');
  // 要点は残る
  assert.ok(result.includes('ドリブルで間合いを詰め'), 'やり方の文が消えている');
  assert.ok(result.includes('ディフェンスはフットワーク優先'), '2文目も残るべき');
});

test('全文メモ: null を返す（空文字ではない）', () => {
  const input = '要出典補完。';
  const result = cleanDrillNotes(input);
  assert.strictEqual(result, null, '全文メモは null であるべき');
});

test('全文メモ（句点なし）: null を返す', () => {
  const input = '要出典補完';
  const result = cleanDrillNotes(input);
  assert.strictEqual(result, null, '句点なし全文メモも null であるべき');
});

test('メモ無し: 原文を（末尾句点付きで）返す', () => {
  const input = 'ボールを受けたら素早くピボット。ディフェンスの重心を見て仕掛ける。';
  const result = cleanDrillNotes(input);
  // 原文の要点テキストが維持されている
  assert.ok(result.includes('ボールを受けたら素早くピボット'), 'やり方文1が消えている');
  assert.ok(result.includes('ディフェンスの重心を見て仕掛ける'), 'やり方文2が消えている');
  // メモ語が含まれていない
  assert.ok(!result.includes('要出典補完'), 'メモ語が混入している');
});

test('URL語含み文の除去', () => {
  const input = '壁でのボール当てで腕の回転数を上げる。URLは確認済み。フォームは肘を前に出す意識で。';
  const result = cleanDrillNotes(input);
  assert.ok(!result.includes('URL'), 'URL語が残っている');
  assert.ok(result.includes('壁でのボール当てで'), '要点文1が消えている');
  assert.ok(result.includes('フォームは肘を前に出す'), '要点文2が消えている');
});

test('null/undefined 入力: null を返す', () => {
  assert.strictEqual(cleanDrillNotes(null), null);
  assert.strictEqual(cleanDrillNotes(undefined), null);
  assert.strictEqual(cleanDrillNotes(''), null);
});

test('WebFetch語含み文の除去', () => {
  const input = 'スタートで重心を低く保つ。WebFetch失敗のため詳細未取得。10秒以内に3往復を目標にする。';
  const result = cleanDrillNotes(input);
  assert.ok(!result.includes('WebFetch'), 'WebFetch語が残っている');
  assert.ok(result.includes('スタートで重心を低く保つ'), '要点文が消えている');
});

// 差し戻し2回目: team-lead目視で確認された3実例
test('検証:書式メモの除去（実例: ホイバーグ式ドラッグスクリーン）', () => {
  // team-lead目視で配布画面に露出していた文
  const input = 'ボール保持者がドリブルで押し上げ、合わせるビッグが走り込んでスクリーン。中学では段階的に無対人から導入。検証: source_url 開けてホイバーグ式トランジション→アーリーオフェンスのドラッグスクリーン（O1がスコア/O4へ/O5ロールの複数読み）で内容一致。';
  const result = cleanDrillNotes(input);
  assert.ok(!result.includes('検証:'), '「検証:」メモ文が残っている');
  assert.ok(!result.includes('source_url'), 'source_url語が残っている');
  assert.ok(result.includes('ボール保持者がドリブルで押し上げ'), 'やり方文1が消えている');
  assert.ok(result.includes('中学では段階的に無対人から導入'), 'やり方文2が消えている');
});

test('ページ実在・内容一致メモの除去（実例: 疲労下フリースロー）', () => {
  const input = '走った直後にフリースロー2本。3人ローテーションが前提（人数が要る）。守備はスタックでも横並びでも可（コーチ裁量）。検証: ページ実在（Active.com）、3人ローテーション（FT2本／リバウンド／コート1周スプリント）・10分で各自約25本の記述が候補と一致。';
  const result = cleanDrillNotes(input);
  assert.ok(!result.includes('ページ実在'), 'ページ実在語が残っている');
  assert.ok(!result.includes('候補と一致'), '「候補と一致」語が残っている');
  assert.ok(result.includes('走った直後にフリースロー2本'), 'やり方文が消えている');
  assert.ok(result.includes('3人ローテーションが前提'), '説明文が消えている');
});

test('video_url含み検証メモの除去（実例: ナッシュ式トランジション）', () => {
  const input = '3対2で攻め切ったあと2対1で守る側が続いて戦う。疲労が入り速攻判断を磨く。守備はスタックでも横並びでも可（コーチ裁量）。検証: source_url 開けて3対2→2対1連続トランジション・ナッシュ帰属で内容一致。video_url 動画タイトル『The 3 on 2 on 1 dri…』で一致。';
  const result = cleanDrillNotes(input);
  assert.ok(!result.includes('video_url'), 'video_url語が残っている');
  assert.ok(!result.includes('検証:'), '「検証:」メモ文が残っている');
  assert.ok(result.includes('3対2で攻め切ったあと2対1で守る側が続いて戦う'), 'やり方文が消えている');
});

test('YouTube含み所蔵情報メモの除去（実例: 5対3トランジションDF）', () => {
  // team-lead裁定: 「図解とYouTube実演あり。」は動画リンク欄が担う設計のため本文から除去
  const input = 'Creighton大HCグレッグ・マクダーモット考案。守備5人がFT延長線で背走→番号(1/2/3)の選手がベースラインタッチして戻り、残り3人が5対3を遅らせる。図解とYouTube実演あり。中央へ誘導しヘルプ到達を待つ原則。';
  const result = cleanDrillNotes(input);
  assert.ok(!result.includes('YouTube'), 'YouTube語が残っている');
  assert.ok(result.includes('Creighton大'), 'やり方文1が消えている');
  assert.ok(result.includes('中央へ誘導しヘルプ到達を待つ原則'), 'やり方文2が消えている');
});
