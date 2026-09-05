/**
 * @param {string[]} dates 候補日のISO（編集中の日を除いたもの）
 * @param {string} baseDate 基準日＝編集中の日のISO
 * @returns {{recommended:Array<{date:string,relation:string}>,
 *            months:Array<{ym:string,label:string,dates:string[]}>,
 *            searchable:boolean, initialYm:string|null}}
 */
export function copySourceCandidates(dates, baseDate) {
  const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  function utcMilliseconds(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }

  if (dates.length === 0) {
    return {
      recommended: [],
      months: [],
      searchable: false,
      initialYm: null,
    };
  }

  const uniqueDates = [...new Set(dates)];
  const candidates = uniqueDates.map((date) => ({
    date,
    milliseconds: utcMilliseconds(date),
  }));
  const baseMilliseconds = utcMilliseconds(baseDate);
  const baseWeekday = new Date(baseMilliseconds).getUTCDay();
  const previousCandidates = candidates
    .filter((candidate) => candidate.milliseconds < baseMilliseconds)
    .sort((left, right) => right.milliseconds - left.milliseconds);

  const recentSameWeekday = previousCandidates.find(
    (candidate) => new Date(candidate.milliseconds).getUTCDay() === baseWeekday,
  );
  const previousPractice = previousCandidates[0];

  const lastYearCenter = baseMilliseconds - 364 * millisecondsPerDay;
  const lastYearCandidates = candidates.filter((candidate) => {
    const distance = Math.abs(candidate.milliseconds - lastYearCenter);
    return distance <= 21 * millisecondsPerDay;
  });
  const lastYearSameWeekday = lastYearCandidates.filter(
    (candidate) => new Date(candidate.milliseconds).getUTCDay() === baseWeekday,
  );
  let nearestPool = lastYearCandidates;
  if (lastYearSameWeekday.length > 0) {
    nearestPool = lastYearSameWeekday;
  }
  const lastYearNearby = nearestPool.sort((left, right) => {
    const leftDistance = Math.abs(left.milliseconds - lastYearCenter);
    const rightDistance = Math.abs(right.milliseconds - lastYearCenter);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return right.milliseconds - left.milliseconds;
  })[0];

  const recommended = [];
  const recommendedDates = new Set();

  function addRecommendation(candidate, relation) {
    if (!candidate || recommendedDates.has(candidate.date)) {
      return;
    }
    recommended.push({ date: candidate.date, relation });
    recommendedDates.add(candidate.date);
  }

  addRecommendation(recentSameWeekday, `直近の${weekdayNames[baseWeekday]}曜`);
  addRecommendation(previousPractice, '前回の練習日');
  addRecommendation(lastYearNearby, '去年の同じ頃');

  const datesByMonth = new Map();
  for (const date of uniqueDates) {
    const ym = date.slice(0, 7);
    if (!datesByMonth.has(ym)) {
      datesByMonth.set(ym, []);
    }
    datesByMonth.get(ym).push(date);
  }

  const months = [...datesByMonth.entries()]
    .sort(([leftYm], [rightYm]) => rightYm.localeCompare(leftYm))
    .map(([ym, monthDates]) => {
      const [year, month] = ym.split('-').map(Number);
      return {
        ym,
        label: `${year}年${month}月`,
        dates: monthDates.sort((left, right) => left.localeCompare(right)),
      };
    });

  const baseYm = baseDate.slice(0, 7);
  let initialYm = months[0].ym;
  if (datesByMonth.has(baseYm)) {
    initialYm = baseYm;
  }

  return {
    recommended,
    months,
    searchable: uniqueDates.some((date) => !recommendedDates.has(date)),
    initialYm,
  };
}
