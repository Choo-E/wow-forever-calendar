// 내 컴퓨터에서 쓰는 개발용 서버. 공개 사이트는 이 서버 없이 정적 파일(public/)만 올린다.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './src/collect.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CACHE_FILE = join(ROOT, 'data', 'cache.json');
const SCHEDULE_FILE = join(ROOT, 'data', 'schedule.json');
const GUILD_FILE = join(ROOT, 'data', 'guild.json');
const PORT = Number(process.env.PORT) || 3000;
const REFRESH_MS = 15 * 60 * 1000;

let state = { updatedAt: null, sources: {}, items: [] };
let refreshing = null;

async function loadCache() {
  try {
    state = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
  } catch {
    /* 첫 실행이면 캐시가 없다 */
  }
}

function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    state = await collect(state);
    await mkdir(join(ROOT, 'data'), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(state));
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // 공개 사이트의 정적 파일(public/data/feed.json)과 같은 주소로 응답한다.
  if (url.pathname === '/data/feed.json') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    const schedule = await readJson(SCHEDULE_FILE, []);
    const guild = await readJson(GUILD_FILE, { name: '', notices: [], events: [] });
    res.end(JSON.stringify({ ...state, schedule, guild }));
    return;
  }

  // 정적 파일 (public 폴더 밖으로 나가는 경로는 차단)
  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

await loadCache();
server.listen(PORT, () => {
  console.log(`WoW Forever 캘린더: http://localhost:${PORT}`);
});
refresh();
setInterval(refresh, REFRESH_MS);
