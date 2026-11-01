import { classify } from '../classify.js';

const UA = 'Mozilla/5.0 (compatible; WoWForeverCalendar/1.0)';
const FEED = 'https://www.wowhead.com/news/rss/all';

export async function fetchWowhead() {
  const res = await fetch(FEED, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();

  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = decode(tag(block, 'title'));
    const link = tag(block, 'link');
    const pub = tag(block, 'pubDate');
    if (!title || !link || !pub) continue;

    const summary = decode(tag(block, 'description'))
      .replace(/<[^>]+>/g, ' ')
      .replace(/Continue reading »/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const image = (block.match(/<media:content[^>]*url="([^"]+)"/) || [])[1] || '';
    const guid = tag(block, 'guid').match(/(\d+)\s*$/)?.[1] || link;

    // Wowhead가 기사마다 붙이는 버전 꼬리표: Forever / Live(본섭) / PTR(본섭 테스트) / WoW(전체 공통) 등
    const cats = [...block.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map((c) => decode(c[1]).trim().toLowerCase());
    const cls = classify(title, summary);
    let scope = 'other'; // forever(포에버) | all(모든 와우 공통) | retail(본섭) | other(그 외 클래식 등)
    if (cats.includes('forever')) scope = 'forever';
    else if (cats.includes('live') || cats.includes('ptr')) scope = 'retail';
    else if (cats.includes('wow')) scope = 'all';
    else if (!cats.length && cls.forever) scope = 'forever'; // 꼬리표가 없으면 제목·요약에 Forever가 있는지로 판단

    items.push({
      id: `wowhead-${guid}`,
      source: 'wowhead',
      sourceName: 'Wowhead',
      lang: 'en',
      title,
      summary,
      url: link,
      image,
      date: new Date(pub).toISOString(),
      scope,
      ...cls,
      forever: cls.forever || scope === 'forever',
    });
  }
  return items;
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
