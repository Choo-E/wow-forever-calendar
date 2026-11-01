import { fetchBlizzard } from './sources/blizzard.js';
import { fetchWowhead } from './sources/wowhead.js';

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

// 이전 상태에 새로 받은 기사를 합쳐서 새 상태를 돌려준다.
// 일부 출처가 실패해도 이전에 받아둔 기사는 그대로 유지한다.
export async function collect(prev = {}) {
  const now = new Date().toISOString();
  const enabled = new Set(SOURCES.map((s) => s.id));
  const results = await Promise.allSettled(SOURCES.map((s) => s.run()));

  const byId = new Map((prev.items || []).filter((i) => enabled.has(i.source)).map((i) => [i.id, i]));
  const sources = {};
  for (const id of enabled) if (prev.sources?.[id]) sources[id] = prev.sources[id];

  results.forEach((r, idx) => {
    const s = SOURCES[idx];
    if (r.status === 'fulfilled') {
      r.value.forEach((item) => byId.set(item.id, item));
      sources[s.id] = { name: s.name, ok: true, count: r.value.length, fetchedAt: now };
      console.log(`[${now}] ${s.name}: ${r.value.length}건`);
    } else {
      const error = String(r.reason?.message || r.reason);
      sources[s.id] = { ...sources[s.id], name: s.name, ok: false, error, failedAt: now };
      console.warn(`[${now}] ${s.name} 실패: ${error}`);
    }
  });

  const items = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_ITEMS);
  return { updatedAt: now, sources, items };
}
