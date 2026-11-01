import { classify } from '../classify.js';

const UA = 'Mozilla/5.0 (compatible; WoWForeverCalendar/1.0)';

// 블리자드 뉴스 페이지에는 기사 목록이 JSON 형태로 통째로 들어 있어서 그걸 읽는다.
export async function fetchBlizzard(locale = 'ko-kr') {
  const base = `https://news.blizzard.com/${locale}`;
  const res = await fetch(`${base}/world-of-warcraft`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const text = html.replace(/\\"/g, '"');
  const marks = [...text.matchAll(/"newsId":"(\d+)"/g)];
  if (!marks.length) throw new Error('기사 데이터를 찾지 못했습니다 (페이지 구조 변경?)');

  const items = new Map();
  let prev = 0;
  for (const m of marks) {
    const chunk = text.slice(prev, m.index + m[0].length);
    prev = m.index + m[0].length;
    const id = m[1];
    if (items.has(id)) continue;

    const props = chunk.lastIndexOf('"properties":{');
    const scope = props >= 0 ? chunk.slice(props) : chunk;
    const title = field(scope, 'title');
    const date = field(chunk, 'lastUpdated');
    if (!title || !date) continue;

    const summary = field(scope, 'summary') || '';
    let image = field(chunk, 'imageUrl', true) || '';
    if (image.startsWith('//')) image = `https:${image}`;

    items.set(id, {
      id: `blizzard-${id}`,
      source: 'blizzard',
      sourceName: '블리자드 공식',
      lang: locale.startsWith('ko') ? 'ko' : 'en',
      title,
      summary: summary.trim(),
      url: `${base}/article/${id}`,
      image,
      date,
      ...classify(title, summary),
    });
  }
  return [...items.values()];
}

// 이스케이프된 JSON 조각에서 "key":"value" 를 꺼낸다. last=true 면 마지막 값을 쓴다.
function field(src, key, last = false) {
  const re = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const all = [...src.matchAll(re)];
  if (!all.length) return '';
  const raw = (last ? all[all.length - 1] : all[0])[1];
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}
