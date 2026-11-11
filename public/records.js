// 레이드 탭: 지난 레이드의 결과·출석 기록과 출석 통계.
// 길드원은 결과 요약과 합계만 보고, 사람별 출석 기록과 통계는 간부·길마(와 그 레이드 공대장)만 본다. 판정은 데이터베이스 함수가 한다.
(function () {
  const $ = (id) => document.getElementById(id);
  const sb = window.sb;
  const box = $('pastRaids');
  if (!sb || !box) return;

  const toast = (t, ok = true) => (window.hlToast ? window.hlToast(t, ok) : undefined);
  const ROLE = { tank: '🛡️ 탱', healer: '💚 힐', dps: '⚔️ 딜' };
  let ctx = { userId: null, rank: null };
  let past = [];
  let days = 90;
  const openSet = new Set();
  const isMember = () => Boolean(ctx.userId && ctx.rank && ctx.rank !== 'pending');
  const isOfficer = () => ctx.rank === 'officer' || ctx.rank === 'master';
  const missing = (e) => e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || ''));

  const kst = (iso, o) => Object.fromEntries(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...o }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const dateParts = (iso) => kst(iso, { month: 'numeric', day: 'numeric', weekday: 'long' });

  async function load() {
    $('pastRaidsBlock').hidden = !isMember();
    $('statsBlock').hidden = !isOfficer();
    if (!isMember()) return;
    const { data, error } = await sb.rpc('get_past_raids', { p_limit: 20 });
    if (error) {
      box.innerHTML = `<div class="empty">${missing(error) ? '지난 레이드 기록 기능을 준비하고 있습니다. (데이터베이스 설정 필요)' : `불러오지 못했습니다. (${esc(error.message)})`}</div>`;
      return;
    }
    past = data || [];
    render();
    if (isOfficer()) loadStats();
  }

  function render() {
    if (!past.length) {
      box.innerHTML = '<div class="empty">아직 지난 레이드가 없습니다. 레이드가 끝나면 이곳에 결과와 출석이 쌓입니다.</div>';
      return;
    }
    box.innerHTML = past
      .map((r) => {
        const d = dateParts(r.starts_at);
        const hasAtt = r.attended_count + r.late_count + r.noshow_count > 0;
        const state = r.summary || r.cleared || hasAtt ? '<span class="st-badge st-confirmed">기록됨</span>' : '<span class="st-badge st-waitlist">미기록</span>';
        return `<article class="raid-card past" data-raid="${esc(r.id)}">
          <div class="raid-head">
            <div class="event-date"><span class="m">${esc(d.month)}월</span><span class="d">${esc(d.day)}</span><span class="m">${esc(d.weekday)}</span></div>
            <div class="raid-main">
              <h3>${esc(r.name)} ${state}</h3>
              <p class="raid-meta">${[r.dungeon ? esc(r.dungeon) : '던전 미정', r.size ? `${r.size}인` : ''].filter(Boolean).join(' · ')}</p>
              <div class="slots"><span class="slot">신청 ${r.signup_count}</span>${hasAtt ? `<span class="slot">✅ 참석 ${r.attended_count}</span><span class="slot">🕒 지각 ${r.late_count}</span><span class="slot${r.noshow_count ? ' full' : ''}">❌ 노쇼 ${r.noshow_count}</span>` : ''}</div>
            </div>
          </div>
          ${r.summary ? `<p class="result"><b>결과</b> ${esc(r.summary)}</p>` : ''}
          ${r.cleared ? `<p class="result"><b>처치</b> ${esc(r.cleared)}</p>` : ''}
          ${r.can_manage ? `<details class="raid-list" data-raid="${esc(r.id)}"${openSet.has(r.id) ? ' open' : ''}><summary>결과 · 출석 기록하기</summary><div class="list-body"></div></details>` : ''}
        </article>`;
      })
      .join('');
    openSet.forEach((id) => {
      const det = box.querySelector(`details[data-raid="${CSS.escape(id)}"]`);
      if (det) loadAttendance(id, det);
    });
  }

  // ───── 출석 기록표 + 결과 입력 (관리자·그 레이드 공대장) ─────
  async function loadAttendance(id, det) {
    const body = det.querySelector('.list-body');
    const r = past.find((x) => x.id === id);
    const { data, error } = await sb.rpc('get_raid_attendance', { p_raid: id });
    if (error) {
      body.innerHTML = `<div class="empty">불러오지 못했습니다. (${esc(error.message)})</div>`;
      return;
    }
    const sel = (cur) => `<select name="att">${[['', '미기록'], ['attended', '✅ 참석'], ['late', '🕒 지각'], ['noshow', '❌ 노쇼']].map(([v, l]) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const rows = (data || []).map((a) => `<tr data-profile="${esc(a.profile_id)}"><td><b>${esc(a.character_name)}</b><br><small class="muted">${esc(a.display_name)}</small></td><td>${esc(a.class)}</td><td>${ROLE[a.role] || esc(a.role)}</td><td>${sel(a.attendance)}</td></tr>`).join('');
    body.innerHTML = `<form class="att-form" data-raid="${esc(id)}">
      ${rows ? `<div class="table-wrap"><table class="roster-table"><thead><tr><th>캐릭터</th><th>직업</th><th>역할</th><th>출석</th></tr></thead><tbody>${rows}</tbody></table></div><p><button class="btn small" type="button" data-all>모두 참석으로</button></p>` : '<div class="empty">신청·확정된 사람이 없습니다.</div>'}
      <div class="form-row">
        <label class="grow">결과 요약<textarea name="summary" rows="2" maxlength="500" placeholder="예: 공대 전멸 없이 클리어">${esc((r && r.summary) || '')}</textarea></label>
        <label class="grow">처치한 보스 등<textarea name="cleared" rows="2" maxlength="500">${esc((r && r.cleared) || '')}</textarea></label>
      </div>
      <button class="btn" type="submit">저장</button>
    </form>`;
  }

  box.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.matches || !d.matches('details.raid-list')) return;
    const id = d.dataset.raid;
    if (d.open) {
      openSet.add(id);
      loadAttendance(id, d);
    } else openSet.delete(id);
  }, true);

  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-all]')) {
      e.target.closest('form').querySelectorAll('select[name="att"]').forEach((s) => {
        if (!s.value) s.value = 'attended';
      });
    }
  });

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const id = f.dataset.raid;
    const rows = [...f.querySelectorAll('tbody tr')].map((tr) => ({ profile_id: tr.dataset.profile, attendance: tr.querySelector('select[name="att"]').value || null }));
    const a = await sb.rpc('record_attendance', { p_raid: id, p_rows: rows });
    if (a.error) return toast(a.error.message, false);
    const s = await sb.rpc('save_raid_result', { p_raid: id, p_summary: f.summary.value, p_cleared: f.cleared.value });
    if (s.error) return toast(s.error.message, false);
    toast('결과와 출석을 저장했습니다.');
    openSet.add(id);
    load();
  });

  // ───── 출석 통계 (간부·길마) ─────
  async function loadStats() {
    const sbox = $('attStats');
    const { data, error } = await sb.rpc('get_attendance_stats', { p_days: days });
    if (error) {
      sbox.innerHTML = `<div class="empty">${missing(error) ? '출석 통계를 준비하고 있습니다.' : `불러오지 못했습니다. (${esc(error.message)})`}</div>`;
      return;
    }
    const rows = (data || []).map((x) => {
      const done = x.attended + x.late + x.noshow;
      return { ...x, rate: done ? Math.round(((x.attended + x.late) / done) * 100) : null, done };
    });
    const any = rows.some((x) => x.done || x.late_cancel);
    sbox.innerHTML = `<div class="form-row stats-bar"><label>기간<select id="statsDays">${[30, 90, 180].map((d) => `<option value="${d}"${d === days ? ' selected' : ''}>최근 ${d}일</option>`).join('')}</select></label></div>
      ${any ? `<div class="table-wrap"><table class="roster-table"><thead><tr><th>이름</th><th>대표 캐릭터</th><th>참석</th><th>지각</th><th>노쇼</th><th>늦은 취소</th><th>출석률</th></tr></thead><tbody>${rows
        .filter((x) => x.done || x.late_cancel)
        .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
        .map((x) => `<tr><td>${esc(x.display_name)}</td><td>${esc(x.main_character || '-')}</td><td>${x.attended}</td><td>${x.late}</td><td${x.noshow ? ' class="warn-cell"' : ''}>${x.noshow}</td><td>${x.late_cancel}</td><td><b>${x.rate == null ? '-' : `${x.rate}%`}</b></td></tr>`)
        .join('')}</tbody></table></div><p class="hint">출석률 = (참석 + 지각) ÷ (참석 + 지각 + 노쇼). 기록된 레이드만 계산합니다.</p>` : '<div class="empty">아직 기록된 출석이 없습니다.</div>'}`;
    const s = $('statsDays');
    if (s) s.onchange = () => {
      days = Number(s.value);
      loadStats();
    };
  }

  function onAuth(d) {
    ctx = d ? { userId: d.userId, rank: d.rank } : { userId: null, rank: null };
    load();
  }
  window.addEventListener('hl-auth', (e) => onAuth(e.detail));
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/raid' && isMember()) load();
  });
  onAuth(window.hlAuthState);
})();
