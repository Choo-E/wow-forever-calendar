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
      ...classify(title, summary),
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
