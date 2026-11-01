// 소식을 한 번 받아서 public/data/feed.json 파일로 저장한다.
// GitHub Actions가 30분마다 이 스크립트를 실행한다. (내 컴퓨터에서는: npm run build:data)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from '../src/collect.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'feed.json');
const SCHEDULE = join(ROOT, 'data', 'schedule.json');
const GUILD = join(ROOT, 'data', 'guild.json');

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const prev = await readJson(OUT, {});
const state = await collect(prev);
const schedule = await readJson(SCHEDULE, []);
const guild = await readJson(GUILD, { name: '', notices: [], events: [] });

const allFailed = Object.values(state.sources).every((s) => !s.ok);
if (allFailed && !state.items.length) {
  console.error('모든 출처에서 실패했고 이전 데이터도 없습니다.');
  process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ ...state, schedule, guild }));
console.log(`저장 완료: ${state.items.length}건 → public/data/feed.json`);
