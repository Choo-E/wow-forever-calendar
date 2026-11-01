import { fetchBlizzard } from './sources/blizzard.js';
import { fetchWowhead } from './sources/wowhead.js';
import { translateText } from './translate.js';

// 공개 사이트에는 RSS로 공개된 출처만 쓴다.
// 블리자드 뉴스 페이지 자동 수집은 약관 문제가 있을 수 있어 기본으로 꺼 두고,
// 내 컴퓨터에서만 쓰고 싶을 때 ENABLE_BLIZZARD=1 로 켠다.
export const SOURCES = [
  { id: 'wowhead', name: 'Wowhead', run: fetchWowhead },
  ...(process.env.ENABLE_BLIZZARD === '1'
    ? [{ id: 'blizzard', name: '블리자드 공식', run: () => fetchBlizzard('ko-kr') }]
    : []),
];

const MAX_ITEMS = 300;

// 포에버 소식과 모든 와우에 공통인 소식만 남기고, 본섭(Live)·본섭 테스트(PTR) 등은 버린다.
// scope 가 없는 옛 데이터는 Forever 언급이 있을 때만 남긴다.
const isRelevant = (i) => i.scope === 'forever' || i.scope === 'all' || (i.scope === undefined && i.forever);
const MAX_TRANSLATE_PER_RUN = 30; // 한 번에 번역하는 글 수 (나머지는 다음 실행에서)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 영어 글의 제목·요약을 한국어로 번역해서 titleKo / summaryKo 로 붙인다.
// 이미 번역한 글(원문이 그대로인 글)은 다시 번역하지 않고, 실패하면 영어 원문 그대로 둔다.
async function addTranslations(items) {
  let budget = MAX_TRANSLATE_PER_RUN;
  let failures = 0;
  let done = 0;
  for (const i of items) {
    if (i.lang !== 'en') continue;
    const needTitle = i.titleSrc !== i.title;
    const needSummary = Boolean(i.summary) && i.summarySrc !== i.summary;
    if (!needTitle && !needSummary) continue;
    if (budget-- <= 0) break;
    if (failures >= 3) {
      console.warn('번역이 연속으로 실패해서 이번 실행에서는 중단합니다.');
      break;
    }

    let ok = false;
    if (needTitle) {
      const ko = await translateText(i.title);
      if (ko) {
        i.titleKo = ko;
        i.titleSrc = i.title;
        ok = true;
      }
    }
    if (needSummary) {
      const ko = await translateText(i.summary.slice(0, 400));
      if (ko) {
        i.summaryKo = ko;
        i.summarySrc = i.summary;
        ok = true;
      }
    }
    failures = ok ? 0 : failures + 1;
    if (ok) done++;
    await sleep(300);
  }
  if (done) console.log(`번역 ${done}건 완료`);
}

// 이전 상태에 새로 받은 기사를 합쳐서 새 상태를 돌려준다.
// 일부 출처가 실패해도 이전에 받아둔 기사는 그대로 유지한다.
export async function collect(prev = {}) {
  const now = new Date().toISOString();
  const enabled = new Set(SOURCES.map((s) => s.id));
  const results = await Promise.allSettled(SOURCES.map((s) => s.run()));

  const byId = new Map((prev.items || []).filter((i) => enabled.has(i.source) && isRelevant(i)).map((i) => [i.id, i]));
  const sources = {};
  for (const id of enabled) if (prev.sources?.[id]) sources[id] = prev.sources[id];

  results.forEach((r, idx) => {
    const s = SOURCES[idx];
    if (r.status === 'fulfilled') {
      // 새로 받은 글 위에, 이전에 저장해 둔 번역(titleKo 등)을 유지한다
      r.value.forEach((item) => {
        if (isRelevant(item)) byId.set(item.id, { ...byId.get(item.id), ...item });
        else byId.delete(item.id); // 예전에는 포에버였다가 분류가 바뀐 글 등
      });
      sources[s.id] = { name: s.name, ok: true, count: r.value.length, fetchedAt: now };
      console.log(`[${now}] ${s.name}: ${r.value.length}건`);
    } else {
      const error = String(r.reason?.message || r.reason);
      sources[s.id] = { ...sources[s.id], name: s.name, ok: false, error, failedAt: now };
      console.warn(`[${now}] ${s.name} 실패: ${error}`);
    }
  });

  const items = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_ITEMS);
  await addTranslations(items);
  return { updatedAt: now, sources, items };
}
