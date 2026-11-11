const CATEGORIES = [
  { id: 'all', label: '전체' },
  { id: 'forever', label: 'Forever' },
  { id: 'patch', label: '패치·핫픽스' },
  { id: 'event', label: '이벤트' },
  { id: 'news', label: '일반 소식' },
];
const SOURCES = [
  { id: 'all', label: '모든 출처' },
  { id: 'blizzard', label: '블리자드 공식' },
  { id: 'wowhead', label: 'Wowhead' },
];
const CAT_LABEL = { patch: '패치·핫픽스', event: '이벤트', news: '소식' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const filter = { cat: 'all', src: 'all', day: null };
let data = { items: [], schedule: [], guild: { name: '', notices: [], events: [] }, sources: {}, updatedAt: null };
let calMonth = null; // { y, m }

const $ = (id) => document.getElementById(id);

// 한국 시간 기준 'YYYY-MM-DD'
const kstDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const dayNum = (ymd) => Date.parse(`${ymd}T00:00:00Z`) / 86400000;
const parts = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d, w: WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

// ───── 히어로 ─────
function renderHero() {
  const today = dayNum(kstDay(Date.now()));
  const featured =
    data.schedule.find((s) => s.featured && s.date && dayNum(s.date) >= today) ||
    data.schedule.find((s) => s.date && dayNum(s.date) >= today);
  const el = $('hero');
  if (!featured) {
    el.innerHTML = `<div class="hero-label">World of Warcraft: Forever</div><h1 class="hero-title">예정된 주요 일정이 없습니다</h1>`;
    return;
  }
  const diff = dayNum(featured.date) - today;
  const p = parts(featured.date);
  const count = diff === 0 ? 'D-DAY' : `D-${diff}`;
  el.innerHTML = `
    <div class="hero-label">${diff === 0 ? 'Today' : 'Next Milestone'}</div>
    <div class="hero-count" aria-label="${diff === 0 ? '오늘' : `${diff}일 남음`}">${count}</div>
    <h1 class="hero-title">${esc(featured.title)}</h1>
    <div class="hero-date">${p.y}년 ${p.m}월 ${p.d}일 (${p.w})</div>
    ${featured.note ? `<div class="hero-note">${esc(featured.note)}</div>` : ''}
    ${featured.url ? `<a class="btn hero-link" href="${esc(featured.url)}" target="_blank" rel="noopener noreferrer">공식 소식 보기</a>` : ''}`;
}

const md = (ymd) => {
  const p = parts(ymd);
  return `${p.m}월 ${p.d}일`;
};

// ───── 지금 진행 중 (기간 일정) ─────
function renderLive() {
  const today = dayNum(kstDay(Date.now()));
  const live = data.schedule.filter((s) => s.date && s.endDate && dayNum(s.date) <= today && today <= dayNum(s.endDate));
  $('live').innerHTML = live
    .map((s) => {
      const start = dayNum(s.date);
      const end = dayNum(s.endDate);
      const total = end - start + 1;
      const done = today - start + 1;
      const left = end - today;
      const pct = Math.round((done / total) * 100);
      const leftText = left === 0 ? '오늘 마감' : `마감까지 ${left}일`;
      const tag = s.url ? 'a' : 'div';
      const attrs = s.url ? ` href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"` : '';
      return `<${tag} class="live-card cat-${esc(s.category)}"${attrs}>
        <div class="live-head"><span class="live-badge"><i class="pulse"></i>지금 진행 중</span><span class="live-left">${leftText}</span></div>
        <h2 class="live-title">${esc(s.title)}</h2>
        <div class="live-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(s.title)} 진행률">
          <div class="live-fill" style="width:${pct}%"></div>
        </div>
        <div class="live-range"><span>◀ ${md(s.date)}</span><span>${pct}% 경과 (${done}/${total}일)</span><span>${md(s.endDate)} ▶</span></div>
        ${s.note ? `<p class="live-note">${esc(s.note)}</p>` : ''}
      </${tag}>`;
    })
    .join('');
}

// ───── 다가오는 일정 ─────
function renderUpcoming() {
  const today = dayNum(kstDay(Date.now()));
  const list = data.schedule
    .filter((s) => !s.date || dayNum(s.date) > today || (!s.endDate && dayNum(s.date) === today))
    .sort((a, b) => (a.date ? dayNum(a.date) : 1e9) - (b.date ? dayNum(b.date) : 1e9));
  if (!list.length) {
    $('upcoming').innerHTML = '<div class="empty">등록된 예정 일정이 없습니다. data/schedule.json 에 추가할 수 있어요.</div>';
    return;
  }
  $('upcoming').innerHTML = list
    .map((s) => {
      const dateBox = s.date
        ? (() => {
            const p = parts(s.date);
            return `<span class="m">${p.m}월</span><span class="d">${p.d}</span><span class="m">${p.w}요일</span>`;
          })()
        : `<span class="d tbd">TBD</span><span class="m">미정</span>`;
      const range = s.date && s.endDate ? `${md(s.date)} ~ ${md(s.endDate)}` : '';
      const note = [s.dateText || range, s.note].filter(Boolean).join(' · ');
      const tag = s.url ? 'a' : 'div';
      const attrs = s.url ? ` href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"` : '';
      return `<${tag} class="event-card cat-${esc(s.category)}"${attrs}>
        <div class="event-date">${dateBox}</div>
        <div class="event-info"><h3>${esc(s.title)}</h3><p>${esc(note)}</p></div>
      </${tag}>`;
    })
    .join('');
}

// ───── 필터 ─────
function renderFilters() {
  const make = (list, key, el) => {
    el.innerHTML = list
      .map((o) => `<button class="chip" type="button" data-id="${o.id}" aria-pressed="${filter[key] === o.id}">${o.label}</button>`)
      .join('');
    el.onclick = (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      filter[key] = b.dataset.id;
      renderFilters();
      renderFeed();
    };
  };
  // 기사가 실제로 있는 출처만 버튼으로 보여준다. (출처가 하나뿐이면 출처 버튼 자체를 숨김)
  const present = SOURCES.filter((o) => o.id === 'all' || data.items.some((i) => i.source === o.id));
  make(CATEGORIES, 'cat', $('catFilters'));
  make(present.length > 2 ? present : [], 'src', $('srcFilters'));
}

// ───── 월간 달력 ─────
const ymdOf = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// 매년 반복 일정(repeat: 'yearly')을 연도별 실제 날짜로 펼친다.
// date 의 연도부터 lastYear 까지 만들고, since(창립 연도)가 있으면 제목에 "N주년"을 붙인다.
function expandYearly(events, lastYear) {
  const out = [];
  for (const e of events) {
    if (e.repeat !== 'yearly') {
      out.push(e);
      continue;
    }
    const [by, bm, bd] = e.date.split('-');
    const length = e.endDate ? dayNum(e.endDate) - dayNum(e.date) : 0;
    for (let y = Number(by); y <= lastYear; y++) {
      const date = `${y}-${bm}-${bd}`;
      if (ymdOf(dayNum(date)) !== date) continue; // 2월 29일처럼 그 해에 없는 날짜는 건너뜀
      const years = e.since ? y - Number(e.since) : 0;
      out.push({
        ...e,
        id: `${e.id}-${y}`,
        date,
        endDate: length ? ymdOf(dayNum(date) + length) : undefined,
        title: years > 0 ? `${e.title} (${years}주년)` : e.title,
        repeat: undefined,
      });
    }
  }
  return out;
}

function renderCalendar() {
  const today = kstDay(Date.now());
  if (!calMonth) {
    const p = parts(today);
    calMonth = { y: p.y, m: p.m };
  }
  const { y, m } = calMonth;
  const key = (d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // 날짜별 소식 (분류별 개수)
  const news = new Map();
  for (const i of data.items) {
    const k = kstDay(i.date);
    if (!news.has(k)) news.set(k, []);
    news.get(k).push(i);
  }

  // 날짜별 주요 일정. 기간이 있으면 시작(▶)·중간(막대)·끝(◀ 종료)으로 나눠 매일 표시한다.
  const marks = new Map();
  const thisYear = Number(today.slice(0, 4));
  const guildEvents = expandYearly(data.guild?.events || [], Math.max(y, thisYear + 1)).map((e) => ({ ...e, category: 'guild' }));
  for (const s of [...data.schedule, ...guildEvents]) {
    if (!s.date) continue;
    const start = dayNum(s.date);
    const end = s.endDate ? dayNum(s.endDate) : start;
    const past = end < dayNum(today);
    for (let n = start; n <= end; n++) {
      const k = ymdOf(n);
      if (!marks.has(k)) marks.set(k, []);
      const kind = start === end ? 'single' : n === start ? 'first' : n === end ? 'last' : 'mid';
      marks.get(k).push({ title: s.title, cat: s.category, kind, past });
    }
  }

  const startW = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let cells = WEEK.map((w, i) => `<div class="cal-w${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}">${w}</div>`).join('');
  cells += '<div class="cal-cell blank"></div>'.repeat(startW);

  for (let d = 1; d <= dim; d++) {
    const k = key(d);
    const list = news.get(k) || [];
    const ms = marks.get(k) || [];
    const dots = ['forever', 'patch', 'event', 'news']
      .map((c) => {
        const n = list.filter((i) => (c === 'forever' ? i.forever : !i.forever && i.category === c)).length;
        return n ? `<span class="cdot ${c}" title="${n}건"></span>`.repeat(Math.min(n, 4)) : '';
      })
      .join('');
    const cls = ['cal-cell'];
    if (k === today) cls.push('today');
    if (ms.length) cls.push('has-mark');
    if (filter.day === k) cls.push('selected');
    const isSunday = (startW + d - 1) % 7 === 0;
    const label = ms
      .map((x) => {
        const c = `cat-${esc(x.cat)}${x.past ? ' past' : ''}`;
        const t = esc(x.title);
        if (x.kind === 'single') return `<span class="cmark ${c}">${t}</span>`;
        if (x.kind === 'first') return `<span class="cmark range-first ${c}">${t} ▶</span>`;
        if (x.kind === 'last') return `<span class="cband band-end ${c}" title="${t}">◀ 종료</span>`;
        // 중간 날: 막대만. 주의 첫날(일요일)에는 제목을 다시 적어 준다.
        return isSunday ? `<span class="cband band-label ${c}" title="${t}">${t}</span>` : `<span class="cband ${c}" title="${t}"></span>`;
      })
      .join('');
    const aria = `${m}월 ${d}일${list.length ? `, 소식 ${list.length}건` : ''}${ms.length ? `, 주요 일정 ${ms.length}건` : ''}`;
    cells += `<button type="button" class="${cls.join(' ')}" data-day="${k}" aria-label="${esc(aria)}"${list.length ? '' : ' data-empty="1"'}>
      <span class="cnum">${d}</span>${label}<span class="cdots">${dots}</span>
    </button>`;
  }

  $('calendar').innerHTML = `
    <div class="cal-nav">
      <button type="button" class="btn" data-nav="-1" aria-label="이전 달">◀</button>
      <div class="cal-title">${y}년 ${m}월</div>
      <button type="button" class="btn" data-nav="1" aria-label="다음 달">▶</button>
      <button type="button" class="btn" data-nav="0">오늘</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span><i class="cdot forever"></i>Forever</span><span><i class="cdot patch"></i>패치·핫픽스</span>
      <span><i class="cdot event"></i>이벤트</span><span><i class="cdot news"></i>일반 소식</span>
      <span><i class="cmark cat-launch">주요 일정</i></span>
      <span><i class="cmark cat-prelaunch range-first">기간 일정 ▶</i></span>
      <span><i class="cmark cat-raid">공격대</i></span>
      ${data.guild?.events?.length ? '<span><i class="cmark cat-guild">길드 일정</i></span>' : ''}
    </div>`;
}

$('calendar').addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const step = Number(nav.dataset.nav);
    if (step === 0) calMonth = null;
    else {
      const t = new Date(Date.UTC(calMonth.y, calMonth.m - 1 + step, 1));
      calMonth = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    }
    renderCalendar();
    return;
  }
  const cell = e.target.closest('.cal-cell[data-day]');
  if (!cell) return;
  filter.day = filter.day === cell.dataset.day ? null : cell.dataset.day;
  renderCalendar();
  renderFeed();
  if (filter.day) location.hash = '#/news'; // 고른 날짜의 소식은 소식 탭에서 보여 준다
});

// ───── 길드 일정 (예정·진행 중 / 지난 일정) ─────
function guildItem(e, today) {
  const start = dayNum(e.date);
  const end = dayNum(e.endDate || e.date);
  const sp = parts(e.date);
  const ep = parts(e.endDate || e.date);
  const days = end - start + 1;
  const multi = days > 1;

  let status;
  let cls;
  if (end < today) {
    status = '종료';
    cls = 'past';
  } else if (start <= today) {
    status = multi ? `진행 중 · ${today - start + 1}/${days}일째` : '오늘';
    cls = 'live';
  } else {
    status = `D-${start - today}`;
    cls = 'soon';
  }

  const dateBox = `<span class="m">${sp.m}월</span><span class="d">${multi ? `${sp.d}–${ep.m === sp.m ? ep.d : `${ep.m}/${ep.d}`}` : sp.d}</span><span class="m">${multi ? `${days}일간` : `${sp.w}요일`}</span>`;
  const range = multi
    ? `${sp.m}월 ${sp.d}일(${sp.w}) ~ ${ep.m}월 ${ep.d}일(${ep.w})`
    : `${sp.m}월 ${sp.d}일(${sp.w})${e.time ? ` ${esc(e.time)}` : ''}`;
  return `<div class="guild-item cat-guild ${cls}">
    <div class="event-date">${dateBox}</div>
    <div class="guild-info">
      <h3>${esc(e.title)}</h3>
      <p>${range}${e.note ? ` · ${esc(e.note)}` : ''}</p>
    </div>
    <span class="guild-status">${status}</span>
  </div>`;
}

// 예정·진행 중 목록과 접이식 "지난 일정"을 지정한 요소들에 그린다. (일정 탭과 이벤트 탭이 같이 쓴다)
function paintGuildLists(ids, upcoming, past, today) {
  $(ids.up).innerHTML = upcoming.length
    ? upcoming.map((e) => guildItem(e, today)).join('')
    : '<div class="empty">예정된 길드 일정이 없습니다.</div>';
  const pastBox = $(ids.pastBox);
  pastBox.hidden = !past.length;
  $(ids.count).textContent = `(${past.length}건)`;
  $(ids.list).innerHTML = past.map((e) => guildItem(e, today)).join('');
  pastBox.open = !upcoming.length && past.length > 0;
}

function renderGuild() {
  const g = data.guild || {};
  const events = expandYearly(g.events || [], Number(kstDay(Date.now()).slice(0, 4)) + 1);
  const today = dayNum(kstDay(Date.now()));
  const sortedAsc = [...events].sort((a, b) => dayNum(a.date) - dayNum(b.date));
  const upcoming = sortedAsc.filter((e) => dayNum(e.endDate || e.date) >= today);
  const past = sortedAsc.filter((e) => dayNum(e.endDate || e.date) < today).reverse();

  paintGuildLists({ up: 'eventUpcoming', pastBox: 'eventPast', count: 'eventPastCount', list: 'eventPastList' }, upcoming, past, today);

  const section = $('guildSection');
  if (!events.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  $('guildTitle').textContent = g.name ? `${g.name} · 길드 일정` : '길드 일정';
  paintGuildLists({ up: 'guildUpcoming', pastBox: 'guildPast', count: 'guildPastCount', list: 'guildPastList' }, upcoming, past, today);
}

// ───── 타임라인 ─────
function renderFeed() {
  const notice = $('dayNotice');
  if (filter.day) {
    const p = parts(filter.day);
    notice.innerHTML = `<div class="day-notice"><span><b>${p.m}월 ${p.d}일 (${p.w})</b> 소식만 보는 중</span><button class="btn" type="button" id="clearDay">전체 보기</button></div>`;
    $('clearDay').onclick = () => {
      filter.day = null;
      renderCalendar();
      renderFeed();
    };
  } else {
    notice.innerHTML = '';
  }

  const items = data.items.filter((i) => {
    if (filter.day && kstDay(i.date) !== filter.day) return false;
    if (filter.src !== 'all' && i.source !== filter.src) return false;
    if (filter.cat === 'forever') return i.forever;
    if (filter.cat !== 'all') return i.category === filter.cat;
    return true;
  });
  const feed = $('feed');
  if (!items.length) {
    feed.innerHTML = '<div class="empty">조건에 맞는 소식이 없습니다.</div>';
    return;
  }

  const todayKey = kstDay(Date.now());
  const groups = new Map();
  for (const i of items) {
    const k = kstDay(i.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }

  feed.innerHTML = [...groups.entries()]
    .map(([k, list]) => {
      const p = parts(k);
      const isToday = k === todayKey;
      return `<div class="day">
        <div class="day-head${isToday ? ' today' : ''}">
          <span class="m">${p.y !== new Date().getFullYear() ? p.y + '년 ' : ''}${p.m}월</span>
          <span class="d">${p.d}</span>
          <span class="w">${p.w}요일</span>
          ${isToday ? '<span class="tag">오늘</span>' : ''}
        </div>
        <div class="cards">${list.map(card).join('')}</div>
      </div>`;
    })
    .join('');
}

function card(i) {
  // 한글 번역이 있으면 그것을 먼저 보여주고, 원문 제목은 작게 남긴다
  const translated = Boolean(i.titleKo);
  const title = i.titleKo || i.title;
  const summary = i.summaryKo || i.summary;
  const img = i.image
    ? `<div class="thumb" style="background-image:url('${esc(i.image)}')" role="img" aria-label=""></div>`
    : '';
  return `<a class="card${i.image ? '' : ' no-img'}" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
    ${img}
    <div class="card-body">
      <div class="meta">
        ${i.scope === 'all' ? '<span class="badge common" title="포에버를 포함한 모든 와우에 해당하는 소식">와우 공통</span>' : i.forever ? '<span class="badge forever">FOREVER</span>' : ''}
        <span class="badge ${i.category}">${CAT_LABEL[i.category] || '소식'}</span>
        <span>${esc(i.sourceName)}${translated ? ' · 자동 번역' : i.lang === 'en' ? ' · EN' : ''}</span>
        <span>· ${ago(i.date)}</span>
      </div>
      <h3>${esc(title)}</h3>
      ${translated ? `<p class="orig" lang="en" title="${esc(i.title)}">원문: ${esc(i.title)}</p>` : ''}
      ${summary ? `<p>${esc(summary)}</p>` : ''}
    </div>
  </a>`;
}

// ───── 탭 이동 (주소 끝의 #/탭이름 으로 구분) ─────
const TABS = { home: '홈', notice: '공지', schedule: '일정', raid: '레이드', event: '이벤트', member: '멤버', minutes: '회의록', news: '소식' };
const MORE_TABS = ['event', 'member', 'minutes', 'news']; // 모바일에서 "더보기" 안에 들어가는 탭

function closeMore() {
  $('moreSheet').hidden = true;
  $('moreBtn').setAttribute('aria-expanded', 'false');
}

function showTab() {
  const raw = location.hash.replace(/^#\/?/, '');
  const tab = TABS[raw] ? raw : 'home';
  document.querySelectorAll('.panel').forEach((p) => {
    p.hidden = p.dataset.panel !== tab;
  });
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('moreBtn').classList.toggle('active', MORE_TABS.includes(tab));
  closeMore();
  document.title = tab === 'home' ? '오늘도 평화로운 호드 생활 · 길드 캘린더' : `${TABS[tab]} · 오늘도 평화로운 호드 생활`;
  window.scrollTo(0, 0);
}

$('moreBtn').addEventListener('click', () => {
  const open = $('moreSheet').hidden;
  $('moreSheet').hidden = !open;
  $('moreBtn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!$('moreSheet').hidden && !e.target.closest('#moreSheet, #moreBtn')) closeMore();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMore();
});

// ───── 정기 레이드 (보기 전용: 신청 기능은 로그인 도입 후) ─────
const WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
// 지금 한국 시각: 오늘 날짜 번호와 자정부터 지난 분
function kstClock() {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t) => Number(hm.find((x) => x.type === t).value);
  return { day: dayNum(kstDay(Date.now())), min: get('hour') * 60 + get('minute') };
}
// 날짜 번호 → "11/14(토)"
const mdw = (day) => {
  const p = parts(ymdOf(day));
  return `${p.m}/${p.d}(${p.w})`;
};
function fmtLeft(mins) {
  if (mins >= 1440) return `${Math.floor(mins / 1440)}일 ${Math.floor((mins % 1440) / 60)}시간`;
  return `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
}
// 정기 레이드의 다음 시작 날짜 (이미 오늘 시작 시각이 지났으면 다음 주)
function nextRaid(t) {
  const now = kstClock();
  for (let i = 0; i < 8; i++) {
    const day = now.day + i;
    if (new Date(day * 86400000).getUTCDay() === WD[t.weekday] && (i > 0 || now.min < toMin(t.time))) return { day };
  }
  return null;
}
const raidInfo = () => (data.guild?.raids?.templates?.length ? data.guild.raids : null);

function renderRaids() {
  const r = raidInfo();
  const list = $('raidList');
  if (!r) {
    list.innerHTML = '<div class="empty">등록된 정기 레이드가 없습니다.</div>';
    return;
  }
  $('raidTitle').textContent = r.status ? `정기 레이드 (${r.status})` : '정기 레이드';
  const now = kstClock();
  list.innerHTML = r.templates
    .map((t) => {
      const nx = nextRaid(t);
      if (!nx) return '';
      const p = parts(ymdOf(nx.day));
      const diff = nx.day - now.day;
      const detail = [`${esc(t.time)} 시작`, t.dungeon ? esc(t.dungeon) : '던전 미정', t.size ? `${t.size}인` : '정원 미정', t.leader ? `공대장 ${esc(t.leader)}` : '공대장 미정'].join(' · ');

      let open = '';
      if (r.signupOpens) {
        const back = (WD[t.weekday] - WD[r.signupOpens.weekday] + 7) % 7;
        const openDay = nx.day - back;
        const left = (openDay - now.day) * 1440 + toMin(r.signupOpens.time) - now.min;
        open = left > 0
          ? `신청 오픈 <b>${mdw(openDay)} ${esc(r.signupOpens.time)}</b> · 오픈까지 ${fmtLeft(left)}`
          : `신청 오픈 시각(${mdw(openDay)} ${esc(r.signupOpens.time)})이 지났습니다 · 신청 기능은 준비 중`;
      }
      return `<div class="guild-item cat-raid ${diff === 0 ? 'live' : 'soon'}">
        <div class="event-date"><span class="m">${p.m}월</span><span class="d">${p.d}</span><span class="m">${p.w}요일</span></div>
        <div class="guild-info">
          <h3>${esc(t.name)}</h3>
          <p>${detail}</p>
          ${open ? `<p class="raid-open">${open}</p>` : ''}
          <button class="btn" type="button" disabled>신청하기 (준비 중)</button>
        </div>
        <span class="guild-status">${diff === 0 ? '오늘' : `D-${diff}`}</span>
      </div>`;
    })
    .join('');
}

// ───── 홈 카드 · 공지 · 머리글 ─────
function renderHomeCards() {
  const cards = [];
  const now = kstClock();

  const r = raidInfo();
  if (r) {
    const next = r.templates
      .map((t) => ({ t, n: nextRaid(t) }))
      .filter((x) => x.n)
      .sort((a, b) => a.n.day - b.n.day)[0];
    if (next) {
      const diff = next.n.day - now.day;
      cards.push({ href: '#/raid', label: '⚔️ 다음 레이드', main: `${mdw(next.n.day)} ${next.t.time}`, sub: `${next.t.name} · ${diff === 0 ? '오늘' : `D-${diff}`}` });
    }
  }

  const events = expandYearly(data.guild?.events || [], Number(kstDay(Date.now()).slice(0, 4)) + 1)
    .filter((e) => dayNum(e.endDate || e.date) >= now.day)
    .sort((a, b) => dayNum(a.date) - dayNum(b.date));
  if (events[0]) {
    const e = events[0];
    const start = dayNum(e.date);
    cards.push({ href: '#/schedule', label: '🎉 길드 다음 일정', main: e.title, sub: `${mdw(start)}${e.endDate ? ` ~ ${mdw(dayNum(e.endDate))}` : ''} · ${start <= now.day ? '진행 중' : `D-${start - now.day}`}` });
  }

  const latest = data.items[0];
  if (latest) cards.push({ href: '#/news', label: '📰 최신 소식', main: latest.titleKo || latest.title, sub: ago(latest.date) });

  $('homeCards').innerHTML = cards
    .map((c) => `<a class="home-card" href="${c.href}"><span class="hc-label">${c.label}</span><strong class="hc-main">${esc(c.main)}</strong><span class="hc-sub">${esc(c.sub)}</span></a>`)
    .join('');
}

function renderNotices() {
  const notices = (data.guild?.notices || []).map((n) => (typeof n === 'string' ? { text: n } : n)).filter((n) => n.text);
  $('homeNotices').innerHTML = notices.slice(0, 3).map((n) => `<a class="notice-banner" href="#/notice">📢 ${esc(n.text)}</a>`).join('');
  $('noticeList').innerHTML = notices.length ? `<ul class="guild-notices">${notices.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>` : '';
  $('noticeList').closest('.block').hidden = !notices.length; // 사이트 파일에 적은 안내가 없으면 이 영역은 숨긴다
}

function renderBrand() {
  const name = data.guild?.name;
  $('brandSub').textContent = name ? `${name} · 길드 캘린더` : '길드 캘린더';
}

// ───── 폰에 앱처럼 설치하기 ─────
let installPrompt = null;
const isStandalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (!isStandalone) $('installBtn').hidden = false;
});
if (isIOS && !isStandalone) $('installBtn').hidden = false; // 아이폰은 자동 설치 창이 없어서 안내 문구를 보여 준다
$('installBtn').addEventListener('click', async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('installBtn').hidden = true;
  } else if (isIOS) {
    $('iosHint').hidden = false;
  }
});
$('iosHintClose').addEventListener('click', () => {
  $('iosHint').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('installBtn').hidden = true;
});

// ───── 하단/상태 ─────
function renderStatus() {
  $('updated').textContent = data.updatedAt ? `마지막 업데이트: ${ago(data.updatedAt)}` : '아직 데이터를 받지 못했습니다';
  const srcs = Object.values(data.sources);
  $('sources').innerHTML = srcs.length
    ? srcs
        .map((s) => `<span title="${esc(s.ok ? '' : s.error || '')}"><span class="dot${s.ok ? '' : ' bad'}"></span>${esc(s.name)} ${s.ok ? `${s.count}건` : '불러오기 실패 (이전 데이터 표시 중)'}</span>`)
        .join('')
    : '';
}

function renderAll() {
  renderBrand();
  renderNotices();
  renderHero();
  renderLive();
  renderHomeCards();
  renderUpcoming();
  renderCalendar();
  renderGuild();
  renderRaids();
  renderFilters();
  renderFeed();
  renderStatus();
}

// 데이터는 서버가 30분마다 미리 만들어 둔 정적 파일이다. (상대 경로: 하위 주소에 올려도 동작)
async function load() {
  const btn = $('refresh');
  try {
    btn.disabled = true;
    const res = await fetch('data/feed.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    renderAll();
  } catch (e) {
    $('updated').textContent = '데이터를 불러오지 못했습니다.';
  } finally {
    btn.disabled = false;
  }
}

$('refresh').addEventListener('click', () => load());
window.addEventListener('hashchange', showTab);
showTab();
load();
setInterval(() => load(), 5 * 60 * 1000);

// 폰 설치형 앱(PWA): 서비스 워커를 등록한다. 실패해도 사이트는 그대로 동작한다.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
