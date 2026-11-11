// 레이드 탭: 정기 레이드 신청(역할별 선착순) · 취소 · 신청자 목록 · 공대장 확정 · 템플릿 설정.
// 선착순·정원·권한 판정은 모두 데이터베이스 함수(supabase/stage3-raids.sql)가 한다. 이 화면은 보여 주고 요청만 보낸다.
(function () {
  const $ = (id) => document.getElementById(id);
  const sb = window.sb;
  const box = $('raidSignup');
  if (!box || !sb) return;

  const ROLES = { tank: '탱', healer: '힐', dps: '딜' };
  const ICON = { tank: '🛡️', healer: '💚', dps: '⚔️' };
  const STATUS = { signed: '신청 완료', waitlist: '대기', confirmed: '확정', declined: '제외', cancelled: '취소' };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const toast = (t, ok = true) => (window.hlToast ? window.hlToast(t, ok) : undefined);

  let ctx = { userId: null, rank: null };
  let raids = [];
  let chars = [];
  let leaders = [];
  let dbMissing = false;
  const openRaids = new Set(); // 펼쳐 둔 "신청자 보기"를 다시 그릴 때 유지한다
  const isMember = () => Boolean(ctx.userId && ctx.rank && ctx.rank !== 'pending');
  const isOfficer = () => ctx.rank === 'officer' || ctx.rank === 'master';

  // ───── 한국 시간 표기 ─────
  const kst = (iso, opts) => Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hourCycle: 'h23', ...opts }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const fmtDate = (iso) => {
    const p = kst(iso, { month: 'numeric', day: 'numeric', weekday: 'short' });
    return `${p.month}/${p.day}(${p.weekday})`;
  };
  const fmtTime = (iso) => {
    const p = kst(iso, { hour: '2-digit', minute: '2-digit' });
    return `${p.hour}:${p.minute}`;
  };
  const fmtLeft = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m >= 1440) return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
    if (m >= 60) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
    return `${m}분`;
  };
  const slotText = (n, max) => (max == null ? `${n}` : `${n}/${max}`);
  const errText = (error) => {
    const m = (error && error.message) || String(error);
    if (error && (error.code === 'PGRST202' || /Could not find the function/i.test(m))) return '__missing__';
    return m;
  };

  // ───── 불러오기 ─────
  async function load() {
    syncBanner();
    $('raidSignupBlock').hidden = !isMember();
    $('raidAdminBlock').hidden = !isOfficer();
    if (!isMember()) return;
    const ens = await sb.rpc('ensure_raids');
    if (ens.error && errText(ens.error) === '__missing__') {
      dbMissing = true;
      box.innerHTML = '<div class="empty">레이드 신청 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.</div>';
      return;
    }
    dbMissing = false;
    const [r, c] = await Promise.all([
      sb.rpc('get_raids'),
      sb.from('characters').select('id, name, class, role, is_main').eq('owner', ctx.userId).order('created_at'),
    ]);
    if (r.error) {
      box.innerHTML = `<div class="empty">레이드 목록을 불러오지 못했습니다. (${esc(errText(r.error))})</div>`;
      return;
    }
    raids = r.data || [];
    chars = c.data || [];
    render();
    if (isOfficer()) loadAdmin();
  }

  // 로그인 상태에 맞게 안내 줄을 바꾼다
  function syncBanner() {
    const b = $('raidBanner');
    const panel = document.querySelector('[data-panel="raid"]');
    panel.classList.toggle('signup-live', isMember());
    if (isMember()) {
      b.hidden = true;
    } else if (ctx.userId) {
      b.hidden = false;
      b.innerHTML = '⏳ <b>승인 대기 중입니다.</b> 길마·간부의 승인을 받으면 이 화면에서 레이드를 신청할 수 있습니다.';
    } else {
      b.hidden = false;
      b.innerHTML = '🔑 <b>레이드 신청은 로그인 후 이용할 수 있습니다.</b> 디스코드로 로그인하고 길마·간부의 승인을 받으면 이 화면에서 직접 신청합니다.';
    }
  }

  // ───── 레이드 카드 ─────
  function actionHtml(r) {
    const now = Date.now();
    const opens = new Date(r.signup_opens_at).getTime();
    const starts = new Date(r.starts_at).getTime();
    const closes = new Date(r.signup_closes_at || r.starts_at).getTime();
    const mine = r.my_signup_id ? r : null;

    if (mine) {
      const st = r.my_status;
      const cancel = now < starts && st !== 'declined' ? `<button class="btn small danger" type="button" data-act="cancel" data-raid="${esc(r.id)}">신청 취소</button>` : '';
      return `<span class="my-status st-${esc(st)}">내 신청: <b>${esc(STATUS[st] || st)}</b> · ${ICON[r.my_role] || ''} ${esc(ROLES[r.my_role] || '')}</span>${cancel}`;
    }
    if (now < opens) return `<span class="muted">신청 오픈 <b>${esc(fmtDate(r.signup_opens_at))} ${esc(fmtTime(r.signup_opens_at))}</b> · 오픈까지 ${esc(fmtLeft(opens - now))}</span>`;
    if (now >= closes) return '<span class="muted">신청이 마감되었습니다.</span>';
    if (!chars.length) return '<span class="muted">신청하려면 먼저 <a href="#/member">멤버 탭</a>에서 캐릭터를 등록해 주세요.</span>';
    const main = chars.find((c) => c.is_main) || chars[0];
    return `<form class="signup-form" data-raid="${esc(r.id)}">
      <select name="char" aria-label="캐릭터">${chars.map((c) => `<option value="${esc(c.id)}" data-role="${esc(c.role)}"${c.id === main.id ? ' selected' : ''}>${c.is_main ? '★ ' : ''}${esc(c.name)} (${esc(c.class)})</option>`).join('')}</select>
      <select name="role" aria-label="역할">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}"${k === main.role ? ' selected' : ''}>${ICON[k]} ${v}</option>`).join('')}</select>
      <button class="btn" type="submit">신청하기</button>
    </form>`;
  }

  function card(r) {
    const mark = r.can_manage ? '<span class="manager-tag" title="이 레이드를 관리할 수 있습니다">관리</span>' : '';
    const meta = [r.dungeon ? esc(r.dungeon) : '던전 미정', r.size ? `${r.size}인` : '정원 미정', r.leader_name ? `공대장 ${esc(r.leader_name)}` : '공대장 미정'].join(' · ');
    const dd = kst(r.starts_at, { month: 'numeric', day: 'numeric', weekday: 'long' });
    return `<article class="raid-card" data-raid="${esc(r.id)}">
      <div class="raid-head">
        <div class="event-date"><span class="m">${esc(dd.month)}월</span><span class="d">${esc(dd.day)}</span><span class="m">${esc(dd.weekday)}</span></div>
        <div class="raid-main">
          <h3>${esc(r.name)} <small>${esc(fmtTime(r.starts_at))} 시작</small> ${mark}</h3>
          <p class="raid-meta">${meta}</p>
          <div class="slots">
            <span class="slot${r.tank_slots != null && r.tank_count >= r.tank_slots ? ' full' : ''}">🛡️ 탱 ${slotText(r.tank_count, r.tank_slots)}</span>
            <span class="slot${r.healer_slots != null && r.healer_count >= r.healer_slots ? ' full' : ''}">💚 힐 ${slotText(r.healer_count, r.healer_slots)}</span>
            <span class="slot${r.dps_slots != null && r.dps_count >= r.dps_slots ? ' full' : ''}">⚔️ 딜 ${slotText(r.dps_count, r.dps_slots)}</span>
            ${r.waitlist_count ? `<span class="slot wait">⏳ 대기 ${r.waitlist_count}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="raid-act">${actionHtml(r)}</div>
      <details class="raid-list" data-raid="${esc(r.id)}"${openRaids.has(r.id) ? ' open' : ''}><summary>신청자 보기 · ${r.tank_count + r.healer_count + r.dps_count + r.waitlist_count}명</summary><div class="list-body"></div></details>
    </article>`;
  }

  function render() {
    if (dbMissing) return;
    box.innerHTML = raids.length ? raids.map(card).join('') : '<div class="empty">열려 있는 레이드가 없습니다.</div>';
    openRaids.forEach((id) => {
      const d = box.querySelector(`details[data-raid="${CSS.escape(id)}"]`);
      if (d) loadSignups(id, d);
    });
  }

  // ───── 신청자 목록 (+ 공대장·간부용 확정 / 수정) ─────
  async function loadSignups(id, details) {
    const body = details.querySelector('.list-body');
    const r = raids.find((x) => x.id === id);
    const { data, error } = await sb.rpc('get_raid_signups', { p_raid: id });
    if (error) {
      body.innerHTML = `<div class="empty">불러오지 못했습니다. (${esc(errText(error))})</div>`;
      return;
    }
    const manage = Boolean(r && r.can_manage);
    const active = data.filter((s) => s.status !== 'cancelled');
    const late = data.filter((s) => s.status === 'cancelled');
    const row = (s) => `<tr${s.is_me ? ' class="me-row"' : ''}>
      <td><b>${esc(s.character_name)}</b>${s.is_me ? ' <small>(나)</small>' : ''}${manage && s.who ? `<br><small class="muted">${esc(s.who)}</small>` : ''}</td>
      <td>${esc(s.class)}</td>
      <td>${ICON[s.role] || ''} ${esc(ROLES[s.role] || s.role)}</td>
      <td><span class="st-badge st-${esc(s.status)}">${esc(STATUS[s.status] || s.status)}</span></td>
      ${manage ? `<td class="row-act">${['confirmed', 'signed', 'waitlist', 'declined'].filter((k) => k !== s.status).map((k) => `<button class="btn small" type="button" data-act="setst" data-id="${esc(s.signup_id)}" data-st="${k}" data-raid="${esc(id)}">${k === 'confirmed' ? '확정' : k === 'signed' ? '신청으로' : k === 'waitlist' ? '대기로' : '제외'}</button>`).join('')}</td>` : ''}
    </tr>`;
    const head = `<tr><th>캐릭터</th><th>직업</th><th>역할</th><th>상태</th>${manage ? '<th>변경</th>' : ''}</tr>`;
    const table = active.length ? `<div class="table-wrap"><table class="roster-table"><thead>${head}</thead><tbody>${active.map(row).join('')}</tbody></table></div>` : '<div class="empty">아직 신청한 사람이 없습니다.</div>';
    const lateHtml = manage && late.length ? `<p class="hint">⚠️ 시작 3시간 이내에 취소한 사람: ${late.map((s) => `${esc(s.character_name)}${s.who ? ` (${esc(s.who)})` : ''}`).join(', ')}</p>` : '';
    body.innerHTML = `${manage ? editForm(r) : ''}${table}${lateHtml}`;
  }

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const numInput = (name, label, val) => `<label>${label}<input type="number" min="0" name="${name}" value="${val == null ? '' : esc(val)}" placeholder="제한 없음"></label>`;
  const leaderSelect = (current, disabled) => `<label>공대장<select name="leader"${disabled ? ' disabled' : ''}><option value="">미정</option>${leaders.map((l) => `<option value="${esc(l.id)}"${l.id === current ? ' selected' : ''}>${esc(l.display_name)}</option>`).join('')}</select></label>`;

  function editForm(r) {
    return `<form class="raid-edit" data-raid="${esc(r.id)}">
      <h4>이 레이드 설정 <small>(비워 두면 제한 없음)</small></h4>
      <div class="form-row">
        <label>던전<input type="text" name="dungeon" maxlength="40" value="${esc(r.dungeon || '')}" placeholder="미정"></label>
        ${numInput('size', '인원', r.size)}${numInput('tank', '탱 정원', r.tank_slots)}${numInput('healer', '힐 정원', r.healer_slots)}${numInput('dps', '딜 정원', r.dps_slots)}
        ${leaderSelect(r.leader_id, !isOfficer())}
        <button class="btn small" type="submit">저장</button>
      </div>
    </form>`;
  }

  // ───── 클릭·제출 처리 ─────
  async function after(msg) {
    toast(msg);
    await load();
  }

  box.addEventListener('change', (e) => {
    // 캐릭터를 바꾸면 그 캐릭터의 역할을 자동으로 고른다
    if (e.target.name === 'char') {
      const opt = e.target.selectedOptions[0];
      const roleSel = e.target.form.querySelector('[name="role"]');
      if (opt && roleSel) roleSel.value = opt.dataset.role;
    }
  });

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('signup-form')) {
      const btn = f.querySelector('button');
      btn.disabled = true;
      const { data, error } = await sb.rpc('signup_raid', { p_raid: f.dataset.raid, p_character: f.char.value, p_role: f.role.value });
      btn.disabled = false;
      if (error) return toast(errText(error), false);
      return after(data === 'waitlist' ? '정원이 가득 차서 대기로 등록되었습니다.' : '신청이 완료되었습니다.');
    }
    if (f.classList.contains('raid-edit')) {
      const { error } = await sb.rpc('update_raid', {
        p_raid: f.dataset.raid, p_dungeon: f.dungeon.value, p_size: num(f.size.value), p_tank: num(f.tank.value), p_healer: num(f.healer.value), p_dps: num(f.dps.value),
        p_leader: f.leader.value || null, p_change_leader: isOfficer(),
      });
      if (error) return toast(errText(error), false);
      openRaids.add(f.dataset.raid);
      return after('레이드 설정을 저장했습니다.');
    }
  });

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    b.disabled = true;
    if (b.dataset.act === 'cancel') {
      const { error } = await sb.rpc('cancel_signup', { p_raid: b.dataset.raid });
      if (error) {
        b.disabled = false;
        return toast(errText(error), false);
      }
      return after('신청을 취소했습니다.');
    }
    if (b.dataset.act === 'setst') {
      const { error } = await sb.rpc('set_signup_status', { p_signup: b.dataset.id, p_status: b.dataset.st });
      if (error) {
        b.disabled = false;
        return toast(errText(error), false);
      }
      openRaids.add(b.dataset.raid);
      return after('상태를 바꿨습니다.');
    }
  });

  // 펼침/접힘을 기억하고, 펼치면 신청자 목록을 불러온다 (toggle 이벤트는 위로 전달되지 않아서 capture 사용)
  box.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (!d.matches || !d.matches('details.raid-list')) return;
      const id = d.dataset.raid;
      if (d.open) {
        openRaids.add(id);
        loadSignups(id, d);
      } else {
        openRaids.delete(id);
      }
    },
    true,
  );

  // ───── 정기 레이드 설정 (간부·길마) ─────
  async function loadAdmin() {
    const adminBox = $('raidAdmin');
    const [t, l] = await Promise.all([
      sb.from('raid_templates').select('*').order('weekday'),
      sb.from('profiles').select('id, display_name, rank').in('rank', ['raid_leader', 'officer', 'master']).order('display_name'),
    ]);
    if (t.error) {
      adminBox.innerHTML = `<div class="empty">설정을 불러오지 못했습니다. (${esc(errText(t.error))})</div>`;
      return;
    }
    leaders = l.data || [];
    adminBox.innerHTML = `<p class="hint">여기서 바꾼 값은 <b>앞으로 열릴 모든 정기 레이드</b>에 적용됩니다. 정원을 비워 두면 제한이 없습니다. 이미 신청한 사람은 그대로 유지됩니다.</p>${(t.data || []).map((x) => `
      <form class="raid-edit tpl" data-id="${esc(x.id)}">
        <h4>${esc(x.name)} <small>${esc(WEEK[x.weekday])}요일 ${esc(String(x.start_time).slice(0, 5))}</small></h4>
        <div class="form-row">
          <label>던전<input type="text" name="dungeon" maxlength="40" value="${esc(x.dungeon || '')}" placeholder="미정"></label>
          ${numInput('size', '인원', x.size)}${numInput('tank', '탱 정원', x.tank_slots)}${numInput('healer', '힐 정원', x.healer_slots)}${numInput('dps', '딜 정원', x.dps_slots)}
          ${leaderSelect(x.leader_id, false)}
        </div>
        <div class="form-row">
          <label>신청 오픈 요일<select name="oday">${WEEK.map((w, i) => `<option value="${i}"${i === x.open_weekday ? ' selected' : ''}>${w}요일</option>`).join('')}</select></label>
          <label>오픈 시각<input type="time" name="otime" value="${esc(String(x.open_time).slice(0, 5))}" required></label>
          <label>마감 (시작 몇 분 전)<input type="number" min="0" name="close" value="${x.close_minutes_before == null ? '' : esc(x.close_minutes_before)}" placeholder="시작 시각까지"></label>
          <button class="btn small" type="submit">저장</button>
        </div>
      </form>`).join('')}`;
  }

  $('raidAdmin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await sb.rpc('save_template', {
      p_id: f.dataset.id, p_dungeon: f.dungeon.value, p_size: num(f.size.value), p_tank: num(f.tank.value), p_healer: num(f.healer.value), p_dps: num(f.dps.value),
      p_leader: f.leader.value || null, p_open_weekday: Number(f.oday.value), p_open_time: f.otime.value, p_close_minutes: num(f.close.value),
    });
    if (error) return toast(errText(error), false);
    toast('설정을 저장했습니다. 앞으로 열릴 레이드에 적용됩니다.');
    load();
  });

  // ───── 시작·갱신 ─────
  function onAuth(d) {
    ctx = d ? { userId: d.userId, rank: d.rank } : { userId: null, rank: null };
    load();
  }
  window.addEventListener('hl-auth', (e) => onAuth(e.detail));
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/raid' && isMember()) load();
  });
  // 선착순이라 현황이 자주 바뀐다. 레이드 탭을 보고 있고 입력 중이 아닐 때만 20초마다 새로 고친다.
  setInterval(() => {
    if (document.hidden || location.hash !== '#/raid' || !isMember()) return;
    if (box.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    load();
  }, 20000);
  onAuth(window.hlAuthState);
})();
