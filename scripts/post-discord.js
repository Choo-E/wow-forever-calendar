// 디스코드 채널에 "일정판" 메시지를 올리고, 일정이 바뀌면 같은 메시지를 수정한다.
// 새 길드 일정이 등록되면 별도의 알림 메시지도 올린다.
//
// 필요한 것: 환경 변수 DISCORD_WEBHOOK_URL (GitHub Secrets에 저장. 파일에 적지 말 것!)
// 시험: DRY_RUN=1 node scripts/post-discord.js  → 보내지 않고 내용만 출력
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = join(ROOT, 'data', 'discord-state.json');
const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL || '').trim();
const SITE_URL = process.env.SITE_URL || 'https://choo-e.github.io/wow-forever-calendar/';
const DRY_RUN = process.env.DRY_RUN === '1';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
};

// ───── 날짜 도구 (한국 시간 기준) ─────
const kstDay = (d = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const dayNum = (ymd) => Date.parse(`${ymd}T00:00:00Z`) / 86400000;
const md = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}(${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
};
const span = (e) => (e.endDate && e.endDate !== e.date ? `${md(e.date)}~${md(e.endDate)}` : md(e.date));
const trunc = (s, n = 1000) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ───── 메시지 만들기 ─────
function buildBoard(schedule, guild, today) {
  const t = dayNum(today);
  const endOf = (e) => dayNum(e.endDate || e.date);
  const dLabel = (e) => {
    const s = dayNum(e.date);
    if (endOf(e) < t) return '종료';
    if (s > t) return `D-${s - t}`;
    return e.endDate && e.endDate !== e.date ? `진행 중 · ${endOf(e) - t === 0 ? '오늘 마감' : `마감 D-${endOf(e) - t}`}` : '오늘';
  };

  const dated = schedule.filter((s) => s.date);
  const live = dated.filter((s) => s.endDate && dayNum(s.date) <= t && t <= endOf(s));
  const upcoming = dated.filter((s) => dayNum(s.date) > t || (!s.endDate && dayNum(s.date) === t)).sort((a, b) => dayNum(a.date) - dayNum(b.date));
  const undated = schedule.filter((s) => !s.date);
  const guildEvents = (guild.events || []).filter((e) => endOf(e) >= t).sort((a, b) => dayNum(a.date) - dayNum(b.date));

  const featured = schedule.find((s) => s.featured && s.date && dayNum(s.date) >= t) || upcoming[0];
  const fields = [];

  if (live.length) {
    fields.push({
      name: '🔥 지금 진행 중',
      value: trunc(live.map((s) => `**${s.title}**\n${span(s)} · ${dLabel(s)}`).join('\n')),
    });
  }

  fields.push({
    name: `⚔️ 길드 일정`,
    value: guildEvents.length
      ? trunc(guildEvents.slice(0, 8).map((e) => `**${span(e)}** ${e.time ? `${e.time} ` : ''}${e.title} — ${dLabel(e)}${e.note ? `\n> ${e.note}` : ''}`).join('\n'))
      : '예정된 길드 일정이 없습니다.',
  });

  const official = [
    ...upcoming.slice(0, 5).map((s) => `**${span(s)}** ${s.title} — ${dLabel(s)}`),
    ...undated.slice(0, 3).map((s) => `**${s.dateText || '날짜 미정'}** ${s.title}`),
  ];
  if (official.length) fields.push({ name: '🏰 포에버 주요 일정', value: trunc(official.join('\n')) });

  const notices = (guild.notices || []).map((n) => (typeof n === 'string' ? n : n.text)).filter(Boolean);
  if (notices.length) fields.push({ name: '📢 공지', value: trunc(notices.map((n) => `• ${n}`).join('\n')) });

  const description = featured
    ? `**${featured.title}** 까지 **${dayNum(featured.date) === t ? 'D-DAY' : `D-${dayNum(featured.date) - t}`}** (${md(featured.date)})`
    : '';

  return {
    allowed_mentions: { parse: [] }, // @everyone 같은 멘션이 우연히 울리지 않게 막음
    embeds: [
      {
        title: `📅 ${guild.name || 'WoW Forever'} · 일정판`,
        url: SITE_URL,
        description,
        color: 0xe8c05a,
        fields,
        footer: { text: `${today} 기준 · 전체 달력은 위 제목을 눌러 확인하세요 (한국 시간)` },
      },
    ],
  };
}

// ───── 디스코드 호출 ─────
async function call(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 404) throw new Error(`디스코드 응답 오류 ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

// ───── 실행 ─────
const [schedule, guild, state] = await Promise.all([
  readJson(join(ROOT, 'data', 'schedule.json'), []),
  readJson(join(ROOT, 'data', 'guild.json'), { name: '', notices: [], events: [] }),
  readJson(STATE_FILE, { messageId: null, hash: null, seen: null }),
]);

const today = kstDay();
const board = buildBoard(schedule, guild, today);
const hash = createHash('sha256').update(JSON.stringify(board)).digest('hex');

// 새 길드 일정 알림 (처음 실행할 때는 기존 일정을 "본 것"으로만 기록하고 알리지 않는다)
const ids = (guild.events || []).map((e) => e.id).filter(Boolean);
const firstRun = state.seen === null;
const newEvents = firstRun ? [] : (guild.events || []).filter((e) => e.id && !state.seen.includes(e.id));

if (DRY_RUN || !WEBHOOK) {
  if (!DRY_RUN) console.log('DISCORD_WEBHOOK_URL 이 없어 디스코드 전송을 건너뜁니다.');
  console.log(JSON.stringify(board, null, 2));
  if (newEvents.length) console.log('새 일정 알림 대상:', newEvents.map((e) => e.title).join(', '));
  process.exit(0);
}

const next = { ...state, seen: ids };

if (newEvents.length) {
  const lines = newEvents.map((e) => `• **${span(e)}** ${e.time ? `${e.time} ` : ''}${e.title}${e.note ? ` (${e.note})` : ''}`);
  await call('POST', WEBHOOK, {
    allowed_mentions: { parse: [] },
    content: `📢 **새 길드 일정이 등록되었습니다**\n${lines.join('\n')}\n${SITE_URL}`,
  });
  console.log(`새 일정 알림 ${newEvents.length}건 전송`);
}

if (hash === state.hash && state.messageId) {
  console.log('일정판 내용이 그대로여서 수정하지 않습니다.');
} else {
  let messageId = state.messageId;
  let edited = false;
  if (messageId) {
    const res = await call('PATCH', `${WEBHOOK}/messages/${messageId}`, board);
    edited = res.ok; // 404면 메시지가 삭제된 것이므로 새로 올린다
  }
  if (!edited) {
    const res = await call('POST', `${WEBHOOK}?wait=true`, board);
    messageId = (await res.json()).id;
    console.log('일정판 메시지를 새로 올렸습니다. 이 메시지를 채널에 고정(핀)해 두세요.');
  } else {
    console.log('일정판 메시지를 수정했습니다.');
  }
  next.messageId = messageId;
  next.hash = hash;
}

await writeFile(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
