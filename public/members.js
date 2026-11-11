// 멤버 탭: 내 캐릭터 · 가입 승인/등급 관리(호드평화유지단) · 공개 명단.
// 권한은 화면이 아니라 데이터베이스 규칙(RLS)이 최종으로 지킨다. 화면에서 숨기는 것은 편의일 뿐이다.
(function () {
  const $ = (id) => document.getElementById(id);
  const sb = window.sb;
  const rosterBox = $('roster');
  if (!rosterBox) return;
  if (!sb) {
    rosterBox.innerHTML = '<div class="empty">로그인 기능이 연결되지 않아 명단을 불러올 수 없습니다.</div>';
    return;
  }

  const CLASSES = ['전사', '성기사', '사냥꾼', '도적', '사제', '주술사', '마법사', '흑마법사', '드루이드'];
  const ROLES = { tank: '탱', healer: '힐', dps: '딜' };
  const ROLE_ICON = { tank: '🛡️', healer: '💚', dps: '⚔️' };
  const RANK = { pending: '승인 대기', newbie: '신입', member: '정회원', raid_leader: '공대장', officer: '간부', master: '길마' };
  const ELEVATED = ['raid_leader', 'officer', 'master']; // 간부 이상 등급은 길마만 바꿀 수 있다

  let ctx = { session: null, userId: null, rank: null, name: '' };
  let rosterPublic = true;
  const isAdmin = () => ctx.rank === 'officer' || ctx.rank === 'master';

  const safeAvatar = (u) => (typeof u === 'string' && u.startsWith('https://cdn.discordapp.com/') ? u : '');
  const badge = (rank) => `<span class="rank-badge r-${esc(rank)}">${esc(RANK[rank] || rank)}</span>`;
  const roleTag = (r) => `<span class="role-tag role-${esc(r)}">${ROLE_ICON[r] || ''} ${esc(ROLES[r] || r)}</span>`;

  // ───── 알림창(토스트) ─────
  let toastTimer;
  function toast(text, ok = true) {
    let t = $('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = ok ? 'ok show' : 'err show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ok ? 'ok' : 'err'), 4500);
  }

  // 데이터베이스 오류를 알아보기 쉬운 한국어로 바꾼다
  function friendly(error) {
    const m = (error && error.message) || String(error);
    if (error && error.code === '23505') return '이미 등록된 캐릭터 이름입니다.';
    if (/최대 10개/.test(m)) return '캐릭터는 최대 10개까지 등록할 수 있습니다.';
    if (/row-level security|permission denied|권한이 없습니다/.test(m)) return '권한이 없습니다.';
    if (/길마만/.test(m)) return '이 작업은 길마만 할 수 있습니다.';
    return m;
  }

  // ───── 공개 명단 ─────
  async function loadRoster() {
    rosterBox.innerHTML = '<div class="empty">불러오는 중…</div>';
    const [res, setting] = await Promise.all([sb.rpc('get_roster'), sb.from('app_settings').select('value').eq('key', 'roster_public').maybeSingle()]);
    if (setting.data) rosterPublic = setting.data.value !== false;
    renderSwitch();
    if (res.error) {
      rosterBox.innerHTML = `<div class="empty">명단을 불러오지 못했습니다. (${esc(friendly(res.error))})</div>`;
      return;
    }
    const rows = res.data || [];
    if (!rows.length) {
      const hidden = !rosterPublic && !(ctx.rank && ctx.rank !== 'pending');
      rosterBox.innerHTML = `<div class="empty">${hidden ? '명단은 길드원에게만 공개되어 있습니다. 로그인하고 승인을 받으면 볼 수 있습니다.' : '아직 등록된 캐릭터가 없습니다.'}</div>`;
      return;
    }
    const count = { tank: 0, healer: 0, dps: 0 };
    rows.forEach((r) => (count[r.role] = (count[r.role] || 0) + 1));
    rosterBox.innerHTML = `
      <div class="role-summary"><span>전체 <b>${rows.length}</b>명</span>${['tank', 'healer', 'dps'].map((k) => `<span>${ROLE_ICON[k]} ${ROLES[k]} <b>${count[k] || 0}</b></span>`).join('')}</div>
      <div class="table-wrap"><table class="roster-table">
        <thead><tr><th>캐릭터</th><th>직업</th><th>역할</th><th>등급</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r.is_main ? '<span class="star" title="대표 캐릭터">★</span> ' : ''}${esc(r.name)}</td><td>${esc(r.class)}</td><td>${roleTag(r.role)}</td><td>${badge(r.rank)}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  // 길마만: 명단을 로그인하지 않은 사람에게도 보여 줄지 정하는 스위치
  function renderSwitch() {
    const box = $('rosterSwitch');
    if (ctx.rank !== 'master') {
      box.innerHTML = rosterPublic ? '' : '<div class="banner">🔒 지금 명단은 <b>길드원에게만</b> 공개되어 있습니다.</div>';
      return;
    }
    box.innerHTML = `<label class="switch-row"><input type="checkbox" id="rosterPublicChk" ${rosterPublic ? 'checked' : ''}> <span>명단을 <b>로그인하지 않은 사람에게도</b> 공개 <small>(끄면 승인된 길드원만 볼 수 있습니다)</small></span></label>`;
    $('rosterPublicChk').onchange = async (e) => {
      const want = e.target.checked;
      const { error } = await sb.rpc('set_setting', { setting_key: 'roster_public', setting_value: want });
      if (error) {
        e.target.checked = !want;
        return toast(friendly(error), false);
      }
      rosterPublic = want;
      toast(want ? '명단을 모두에게 공개합니다.' : '명단을 길드원에게만 공개합니다.');
      loadRoster();
    };
  }

  // ───── 내 캐릭터 ─────
  async function loadMine() {
    const box = $('myChars');
    box.innerHTML = '<div class="empty">불러오는 중…</div>';
    const { data, error } = await sb.from('characters').select('id, name, class, role, is_main').eq('owner', ctx.userId).order('created_at');
    if (error) {
      box.innerHTML = `<div class="empty">캐릭터를 불러오지 못했습니다. (${esc(friendly(error))})</div>`;
      return;
    }
    const list = data || [];
    const pendingNote = ctx.rank === 'pending' ? '<div class="banner">⏳ 승인 전에도 캐릭터를 등록해 둘 수 있습니다. 길마·간부가 승인할 때 참고합니다. 명단에는 승인 후에 나타납니다.</div>' : '';
    box.innerHTML = `${pendingNote}
      <div class="char-list">${list.length ? list.map((c) => `<div class="char-row"><div class="char-info"><b>${c.is_main ? '<span class="star" title="대표 캐릭터">★</span> ' : ''}${esc(c.name)}</b><span>${esc(c.class)}</span>${roleTag(c.role)}</div><div class="char-actions">${c.is_main ? '' : `<button class="btn small" data-main="${esc(c.id)}" type="button">대표로</button>`}<button class="btn small danger" data-del="${esc(c.id)}" type="button">삭제</button></div></div>`).join('') : '<div class="empty">아직 등록한 캐릭터가 없습니다.</div>'}</div>
      <form id="charForm" class="char-form">
        <h3>캐릭터 추가 <small>(${list.length}/10)</small></h3>
        <div class="form-row">
          <label>이름<input id="cName" type="text" maxlength="30" required autocomplete="off" placeholder="인게임 캐릭터 이름"></label>
          <label>직업<select id="cClass" required>${CLASSES.map((c) => `<option>${c}</option>`).join('')}</select></label>
          <label>역할<select id="cRole" required>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${ROLE_ICON[k]} ${v}</option>`).join('')}</select></label>
          <button class="btn" type="submit"${list.length >= 10 ? ' disabled' : ''}>등록</button>
        </div>
        <p class="hint">이름은 인게임과 똑같이 적어 주세요. 같은 이름은 한 번만 등록할 수 있습니다.</p>
      </form>`;

    box.querySelector('#charForm').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('cName').value.trim();
      if (!name) return toast('캐릭터 이름을 입력해 주세요.', false);
      const { error: err } = await sb.from('characters').insert({ owner: ctx.userId, name, class: $('cClass').value, role: $('cRole').value, is_main: list.length === 0 });
      if (err) return toast(friendly(err), false);
      toast(`${name} 등록 완료`);
      refreshAll();
    };
    box.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const { error: err } = await sb.from('characters').delete().eq('id', b.dataset.del);
        if (err) return toast(friendly(err), false);
        toast('삭제했습니다.');
        refreshAll();
      };
    });
    box.querySelectorAll('[data-main]').forEach((b) => {
      b.onclick = async () => {
        const a = await sb.from('characters').update({ is_main: false }).eq('owner', ctx.userId);
        const c = await sb.from('characters').update({ is_main: true }).eq('id', b.dataset.main);
        if (a.error || c.error) return toast(friendly(a.error || c.error), false);
        toast('대표 캐릭터를 바꿨습니다.');
        refreshAll();
      };
    });
  }

  // ───── 가입 승인 · 등급 관리 (호드평화유지단) ─────
  function rankOptions(selected, forPending) {
    const base = forPending ? ['newbie', 'member'] : ['pending', 'newbie', 'member'];
    const list = ctx.rank === 'master' ? [...base, 'raid_leader', 'officer'] : base;
    return list.map((r) => `<option value="${r}"${r === selected ? ' selected' : ''}>${RANK[r]}</option>`).join('');
  }
  const charLine = (cs) => (cs && cs.length ? cs.map((c) => `${c.is_main ? '★' : ''}${esc(c.name)} <small>(${esc(c.class)}·${esc(ROLES[c.role] || c.role)})</small>`).join(', ') : '<small>등록한 캐릭터 없음</small>');
  const avatarImg = (u) => (safeAvatar(u) ? `<img src="${esc(safeAvatar(u))}" alt="" width="28" height="28" class="avatar">` : '<span class="avatar ph"></span>');

  async function loadAdmin() {
    const box = $('adminPanel');
    box.innerHTML = '<div class="empty">불러오는 중…</div>';
    const [p, c] = await Promise.all([
      sb.from('profiles').select('id, display_name, avatar_url, rank, created_at').order('created_at'),
      sb.from('characters').select('owner, name, class, role, is_main').order('created_at'),
    ]);
    if (p.error || c.error) {
      box.innerHTML = `<div class="empty">불러오지 못했습니다. (${esc(friendly(p.error || c.error))})</div>`;
      return;
    }
    const byOwner = new Map();
    (c.data || []).forEach((x) => {
      if (!byOwner.has(x.owner)) byOwner.set(x.owner, []);
      byOwner.get(x.owner).push(x);
    });
    const pending = p.data.filter((x) => x.rank === 'pending');
    const active = p.data.filter((x) => x.rank !== 'pending');

    const pendingHtml = pending.length
      ? pending.map((x) => `<div class="admin-card" data-id="${esc(x.id)}">
          <div class="admin-who">${avatarImg(x.avatar_url)}<b>${esc(x.display_name)}</b><small>${esc(new Date(x.created_at).toLocaleDateString('ko-KR'))} 가입 신청</small></div>
          <div class="admin-chars">${charLine(byOwner.get(x.id))}</div>
          <div class="admin-act"><select data-rank>${rankOptions('newbie', true)}</select><button class="btn small" data-approve type="button">승인</button></div>
        </div>`).join('')
      : '<div class="empty">승인을 기다리는 사람이 없습니다.</div>';

    const activeHtml = active.map((x) => {
      const self = x.id === ctx.userId;
      const locked = self || x.rank === 'master' || (ELEVATED.includes(x.rank) && ctx.rank !== 'master');
      return `<tr data-id="${esc(x.id)}">
        <td><span class="admin-who">${avatarImg(x.avatar_url)}<b>${esc(x.display_name)}</b>${self ? ' <small>(나)</small>' : ''}</span></td>
        <td>${badge(x.rank)}</td>
        <td class="admin-chars">${charLine(byOwner.get(x.id))}</td>
        <td>${locked ? '<small>변경 불가</small>' : `<select data-rank>${rankOptions(x.rank, false)}</select> <button class="btn small" data-set type="button">적용</button>`}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <h3 class="sub-title">승인 대기 <span class="count">${pending.length}</span></h3>
      <div class="admin-list">${pendingHtml}</div>
      <h3 class="sub-title">길드원 등급 관리 <span class="count">${active.length}</span></h3>
      <div class="table-wrap"><table class="roster-table admin-table"><thead><tr><th>이름</th><th>등급</th><th>캐릭터</th><th>변경</th></tr></thead><tbody>${activeHtml}</tbody></table></div>
      <p class="hint">${ctx.rank === 'master' ? '간부·공대장 지정은 길마만 할 수 있습니다. 길마 등급 변경은 데이터베이스에서만 가능합니다.' : '간부·공대장 지정은 길마만 할 수 있습니다.'}</p>`;

    const apply = async (rowEl, trigger) => {
      const id = rowEl.dataset.id;
      const rank = rowEl.querySelector('[data-rank]').value;
      trigger.disabled = true;
      const { error } = await sb.rpc('set_rank', { target: id, new_rank: rank });
      if (error) {
        trigger.disabled = false;
        return toast(friendly(error), false);
      }
      toast(`등급을 "${RANK[rank]}"(으)로 바꿨습니다.`);
      refreshAll();
    };
    box.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => apply(b.closest('[data-id]'), b)));
    box.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => apply(b.closest('[data-id]'), b)));
  }

  // ───── 로그인 상태가 바뀔 때 화면 다시 그리기 ─────
  function refreshAll() {
    $('myCharsBlock').hidden = !ctx.userId;
    $('adminBlock').hidden = !isAdmin();
    if (ctx.userId) loadMine();
    if (isAdmin()) loadAdmin();
    loadRoster();
  }
  function onAuth(d) {
    ctx = d || { session: null, userId: null, rank: null, name: '' };
    refreshAll();
  }
  window.addEventListener('hl-auth', (e) => onAuth(e.detail));
  onAuth(window.hlAuthState); // 이 파일이 늦게 불러와진 경우를 위해 지금 상태로도 한 번 그린다
})();
