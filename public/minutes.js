// 회의록 탭 (호드평화유지단 = 간부·길마 전용): 작성 · 확정 · 수정 이력 · 공지로 올리기 · 이미지 만들기.
// 읽기·쓰기 권한은 데이터베이스 규칙(RLS)이 지킨다. 이미지는 이 브라우저 안에서만 만들어지고 어디에도 전송되지 않는다.
(function () {
  const $ = (id) => document.getElementById(id);
  const sb = window.sb;
  const app = $('minutesApp');
  if (!sb || !app) return;

  const toast = (t, ok = true) => (window.hlToast ? window.hlToast(t, ok) : undefined);
  let ctx = { userId: null, rank: null };
  const isOfficer = () => ctx.rank === 'officer' || ctx.rank === 'master';
  let meetings = [];
  let view = 'list'; // list | edit
  let current = null; // 편집 중인 회의 (새 회의록이면 id 없음)

  // ───── 한국 시간 ─────
  const kst = (iso, o) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', hourCycle: 'h23', ...o }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const toInput = (iso) => {
    if (!iso) return '';
    const p = kst(iso, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  const fromInput = (v) => (v ? new Date(`${v}:00+09:00`).toISOString() : null);
  const WK = ['일', '월', '화', '수', '목', '금', '토'];
  const fmtKo = (iso) => {
    if (!iso) return '';
    const p = kst(iso, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const w = WK[new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`).getUTCDay()];
    return `${p.year}년 ${Number(p.month)}월 ${Number(p.day)}일 (${w}) ${p.hour}:${p.minute}`;
  };
  const splitNames = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  // ───── 불러오기 ─────
  async function load() {
    const locked = $('minutesLocked');
    if (!isOfficer()) {
      app.hidden = true;
      if (locked) locked.hidden = false;
      return;
    }
    if (locked) locked.hidden = true;
    app.hidden = false;
    const { data, error } = await sb.from('meetings').select('*').order('number', { ascending: false });
    if (error) {
      const missing = /Could not find the table|PGRST205/.test(error.message);
      app.innerHTML = `<div class="empty">${missing ? '회의록 기능을 준비하고 있습니다. (데이터베이스 설정 필요)' : `불러오지 못했습니다. (${esc(error.message)})`}</div>`;
      return;
    }
    meetings = data || [];
    render();
  }

  function render() {
    if (view === 'edit') renderEditor();
    else renderList();
  }

  // ───── 목록 ─────
  function renderList() {
    app.innerHTML = `
      <div class="minutes-bar"><p class="hint">호드평화유지단(간부·길마)만 읽고 쓸 수 있습니다. 확정한 뒤 고치면 <b>수정 이력</b>이 남습니다.</p><button class="btn" type="button" data-do="new">＋ 새 회의록</button></div>
      ${meetings.length ? `<div class="table-wrap"><table class="roster-table"><thead><tr><th>차수</th><th>회의</th><th>일시</th><th>상태</th><th></th></tr></thead><tbody>${meetings
        .map((m) => `<tr><td><b>${esc(m.number)}차</b></td><td>${esc(m.title)}</td><td>${esc(fmtKo(m.held_at))}</td><td><span class="st-badge ${m.status === 'final' ? 'st-confirmed' : 'st-waitlist'}">${m.status === 'final' ? '확정' : '작성 중'}</span></td><td><button class="btn small" type="button" data-do="open" data-id="${esc(m.id)}">열기</button></td></tr>`)
        .join('')}</tbody></table></div>` : '<div class="empty">아직 회의록이 없습니다. "새 회의록"으로 시작하세요.</div>'}`;
  }

  // ───── 편집기 ─────
  const agendaRow = (a = {}) => `<div class="m-row agenda-row">
    <div class="m-row-head"><b>안건</b><button class="btn small danger" type="button" data-rm>삭제</button></div>
    <label>제목<input type="text" name="atitle" maxlength="120" value="${esc(a.title || '')}"></label>
    <label>논의 내용<textarea name="adisc" rows="3">${esc(a.discussion || '')}</textarea></label>
    <label>결정 사항<textarea name="adec" rows="2">${esc(a.decision || '')}</textarea></label>
  </div>`;
  const actionRow = (a = {}) => `<div class="m-row action-row">
    <label class="grow">할 일<input type="text" name="ktask" maxlength="200" value="${esc(a.task || '')}"></label>
    <label>담당<input type="text" name="kowner" maxlength="40" value="${esc(a.owner || '')}"></label>
    <label>기한<input type="date" name="kdue" value="${esc(a.due || '')}"></label>
    <label class="chk"><input type="checkbox" name="kdone"${a.done ? ' checked' : ''}> 완료</label>
    <button class="btn small danger" type="button" data-rm>삭제</button>
  </div>`;

  function newMeeting() {
    const prev = meetings[0];
    const n = (prev ? prev.number : 0) + 1;
    return {
      number: n,
      title: `호드평화유지 ${n}차 정기 총회`,
      held_at: null, place: '', secretary: '', attendees: [], absentees: [],
      agenda: [{ title: '', discussion: '', decision: '' }],
      // 이전 회의에서 끝나지 않은 후속 조치를 이어서 가져온다
      actions: (prev ? prev.actions || [] : []).filter((a) => !a.done).map((a) => ({ ...a, done: false })),
      next_meeting_at: null, public_summary: '', status: 'draft',
    };
  }

  async function renderEditor() {
    const m = current;
    const isFinal = m.status === 'final';
    app.innerHTML = `
      <form id="mForm" class="m-form" autocomplete="off">
        <div class="minutes-bar"><button class="btn small" type="button" data-do="back">← 목록으로</button><span class="st-badge ${isFinal ? 'st-confirmed' : 'st-waitlist'}">${isFinal ? '확정됨' : '작성 중'}</span></div>
        ${isFinal ? '<div class="banner">확정된 회의록입니다. 고쳐서 저장하면 <b>고치기 전 내용이 수정 이력에 남습니다.</b></div>' : ''}
        <div class="form-row">
          <label>차수<input type="number" name="mnumber" min="1" required value="${esc(m.number)}" style="width:90px;min-width:0"></label>
          <label class="grow">회의 이름<input type="text" name="mtitle" maxlength="120" required value="${esc(m.title)}"></label>
          <label>일시 (한국 시간)<input type="datetime-local" name="mheld" required value="${esc(toInput(m.held_at))}"></label>
          <label>장소<input type="text" name="mplace" maxlength="60" placeholder="예: 디스코드 음성" value="${esc(m.place || '')}"></label>
          <label>서기<input type="text" name="msec" maxlength="40" value="${esc(m.secretary || '')}"></label>
        </div>
        <div class="form-row">
          <label class="grow">참석자 <small>(쉼표 또는 줄바꿈으로 구분)</small><textarea name="matt" rows="2">${esc((m.attendees || []).join(', '))}</textarea></label>
          <label class="grow">불참자<textarea name="mabs" rows="2">${esc((m.absentees || []).join(', '))}</textarea></label>
        </div>
        <h3 class="sub-title">안건</h3>
        <div id="agendaRows">${(m.agenda || []).map(agendaRow).join('')}</div>
        <button class="btn small" type="button" data-add="agenda">＋ 안건 추가</button>
        <h3 class="sub-title">후속 조치 <small class="muted">(이전 회의의 끝나지 않은 일이 자동으로 들어옵니다)</small></h3>
        <div id="actionRows">${(m.actions || []).map(actionRow).join('')}</div>
        <button class="btn small" type="button" data-add="action">＋ 할 일 추가</button>
        <div class="form-row" style="margin-top:16px">
          <label>다음 회의 일시 (한국 시간)<input type="datetime-local" name="mnext" value="${esc(toInput(m.next_meeting_at))}"></label>
        </div>
        <label class="block-label">길드원 공개 요약 <small>(길드원에게 알릴 결정 사항만 적습니다. 내부 논의는 쓰지 마세요)</small>
          <textarea name="msum" rows="4">${esc(m.public_summary || '')}</textarea></label>
        <div class="m-actions">
          <button class="btn" type="button" data-do="save">저장 (작성 중)</button>
          <button class="btn" type="button" data-do="final">${isFinal ? '확정 상태로 저장' : '확정하기'}</button>
          <button class="btn" type="button" data-do="img-full">🖼️ 이미지 만들기 (내부용)</button>
          <button class="btn" type="button" data-do="img-public">🖼️ 이미지 만들기 (공지용 요약)</button>
        </div>
        <div class="m-actions publish">
          <label>공지로 올리기
            <select name="maud"><option value="member">길드원 전용</option><option value="public">전체 공개</option></select></label>
          <button class="btn" type="button" data-do="publish">📢 공개 요약을 공지로 올리기</button>
          ${current.id && !isFinal ? '<button class="btn danger" type="button" data-do="delete">이 회의록 삭제</button>' : ''}
        </div>
        <div id="revBox"></div>
      </form>`;
    if (current.id && isFinal) loadRevisions();
  }

  async function loadRevisions() {
    const { data } = await sb.from('meeting_revisions').select('id, changed_at').eq('meeting_id', current.id).order('changed_at', { ascending: false });
    const box = $('revBox');
    if (!box) return;
    box.innerHTML = data && data.length ? `<details class="rev"><summary>수정 이력 ${data.length}건</summary><ul>${data.map((r) => `<li>${esc(fmtKo(r.changed_at))}에 고침 (고치기 전 내용을 보관 중)</li>`).join('')}</ul></details>` : '<p class="hint">수정 이력이 아직 없습니다.</p>';
  }

  // 화면의 값을 모아 저장용 데이터로 만든다
  function collect() {
    const f = $('mForm');
    const e = f.elements;
    const rowVals = (sel, map) => [...f.querySelectorAll(sel)].map(map);
    return {
      number: Number(e.mnumber.value),
      title: e.mtitle.value.trim(),
      held_at: fromInput(e.mheld.value),
      place: e.mplace.value.trim() || null,
      secretary: e.msec.value.trim() || null,
      attendees: splitNames(e.matt.value),
      absentees: splitNames(e.mabs.value),
      agenda: rowVals('.agenda-row', (r) => ({ title: r.querySelector('[name=atitle]').value.trim(), discussion: r.querySelector('[name=adisc]').value.trim(), decision: r.querySelector('[name=adec]').value.trim() })).filter((a) => a.title || a.discussion || a.decision),
      actions: rowVals('.action-row', (r) => ({ task: r.querySelector('[name=ktask]').value.trim(), owner: r.querySelector('[name=kowner]').value.trim(), due: r.querySelector('[name=kdue]').value || null, done: r.querySelector('[name=kdone]').checked })).filter((a) => a.task),
      next_meeting_at: fromInput(e.mnext.value),
      public_summary: e.msum.value.trim() || null,
    };
  }

  async function save(status) {
    const f = $('mForm');
    if (!f.reportValidity()) return;
    const payload = { ...collect(), status };
    const q = current.id ? sb.from('meetings').update(payload).eq('id', current.id) : sb.from('meetings').insert(payload);
    const { data, error } = await q.select().single();
    if (error) return toast(error.code === '23505' ? '이미 있는 차수입니다. 차수를 바꿔 주세요.' : /row-level security/.test(error.message) ? '권한이 없습니다.' : error.message, false);
    current = data;
    toast(status === 'final' ? '확정했습니다.' : '저장했습니다.');
    const list = await sb.from('meetings').select('*').order('number', { ascending: false });
    if (!list.error) meetings = list.data || [];
    renderEditor();
  }

  async function publish() {
    const f = $('mForm');
    const sum = f.elements.msum.value.trim();
    if (!sum) return toast('공개 요약을 먼저 적어 주세요.', false);
    const title = `${f.elements.mtitle.value.trim()} 결과 안내`;
    const next = fromInput(f.elements.mnext.value);
    const bodyText = `${sum}${next ? `\n\n다음 회의: ${fmtKo(next)}` : ''}`;
    const { error } = await sb.from('notices').insert({ title, body: bodyText, audience: f.elements.maud.value, pinned: false });
    if (error) return toast(error.message, false);
    toast('공지로 올렸습니다. 공지 탭에서 확인하세요.');
  }

  // ───── 클릭 처리 ─────
  const armed = {};
  app.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const html = add.dataset.add === 'agenda' ? agendaRow() : actionRow();
      $(add.dataset.add === 'agenda' ? 'agendaRows' : 'actionRows').insertAdjacentHTML('beforeend', html);
      return;
    }
    if (e.target.closest('[data-rm]')) {
      e.target.closest('.m-row').remove();
      return;
    }
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const act = b.dataset.do;
    if (act === 'new') {
      current = newMeeting();
      view = 'edit';
      return render();
    }
    if (act === 'open') {
      current = meetings.find((m) => m.id === b.dataset.id);
      view = 'edit';
      return render();
    }
    if (act === 'back') {
      view = 'list';
      current = null;
      return render();
    }
    if (act === 'save') return save('draft');
    if (act === 'final') return save('final');
    if (act === 'publish') return publish();
    if (act === 'img-full' || act === 'img-public') {
      b.disabled = true;
      try {
        await makeImage(act === 'img-public' ? 'public' : 'full');
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (act === 'delete') {
      if (!armed.del) {
        armed.del = setTimeout(() => {
          armed.del = null;
          b.textContent = '이 회의록 삭제';
        }, 4000);
        b.textContent = '정말 삭제?';
        return;
      }
      clearTimeout(armed.del);
      armed.del = null;
      const { error } = await sb.from('meetings').delete().eq('id', current.id);
      if (error) return toast(error.message, false);
      toast('삭제했습니다.');
      view = 'list';
      current = null;
      load();
    }
  });

  // ═════════ 회의록 이미지 (캔버스로 직접 그린다) ═════════
  const SERIF = '"Noto Serif KR","Batang","Times New Roman",serif';
  const SANS = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';

  function wrap(c, str, maxW) {
    const out = [];
    for (const para of String(str ?? '').split('\n')) {
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (c.measureText(test).width > maxW && line) {
          out.push(line);
          line = ch === ' ' ? '' : ch;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function emblem(c, x, y, s) {
    c.save();
    c.translate(x, y);
    const g = c.createLinearGradient(0, 0.1 * s, 0, s);
    g.addColorStop(0, '#b23026');
    g.addColorStop(1, '#561210');
    c.beginPath();
    c.moveTo(0.1 * s, 0.08 * s);
    c.lineTo(0.9 * s, 0.08 * s);
    c.lineTo(0.9 * s, 0.5 * s);
    c.bezierCurveTo(0.9 * s, 0.74 * s, 0.7 * s, 0.9 * s, 0.5 * s, 0.99 * s);
    c.bezierCurveTo(0.3 * s, 0.9 * s, 0.1 * s, 0.74 * s, 0.1 * s, 0.5 * s);
    c.closePath();
    c.fillStyle = g;
    c.fill();
    c.lineWidth = s * 0.04;
    c.lineJoin = 'round';
    c.strokeStyle = '#e8c05a';
    c.stroke();
    c.fillStyle = '#ffe8a0';
    c.font = `900 ${Math.round(s * 0.5)}px ${SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('平', 0.5 * s, 0.5 * s);
    c.restore();
  }

  // draw=false 이면 높이만 재고, true 이면 그린다. 같은 코드로 두 번 돌려서 이미지 높이를 정확히 맞춘다.
  function layout(c, m, mode, W, draw) {
    const pad = 64;
    const innerW = W - pad * 2;
    let y = 60;
    c.textAlign = 'left';
    c.textBaseline = 'top';

    const text = (str, x, f, color, lh, maxW) => {
      c.font = f;
      const ls = wrap(c, str, maxW);
      if (draw) {
        c.fillStyle = color;
        c.textAlign = 'left';
        c.textBaseline = 'top';
        ls.forEach((l, i) => c.fillText(l, x, y + i * lh));
      }
      y += ls.length * lh;
      return ls.length;
    };
    const section = (label) => {
      y += 34;
      if (draw) {
        c.fillStyle = '#c4473a';
        c.fillRect(pad, y + 4, 8, 34);
      }
      c.font = `900 32px ${SERIF}`;
      if (draw) {
        c.fillStyle = '#ffe8a0';
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText(label, pad + 22, y);
      }
      y += 58;
    };

    // 머리글: 엠블럼 + 제목
    const eS = 140;
    if (draw) emblem(c, pad, y, eS);
    const tx = pad + eS + 28;
    const y0 = y;
    c.font = `700 22px ${SANS}`;
    if (draw) {
      c.fillStyle = '#e8c05a';
      c.fillText('호  드  평  화  유  지  단', tx, y);
    }
    y += 38;
    text(m.title || `호드평화유지 ${m.number}차 정기 총회`, tx, `900 46px ${SERIF}`, '#fff3cf', 60, W - tx - pad);
    y = Math.max(y, y0 + eS) + 24;
    if (draw) {
      const lg = c.createLinearGradient(pad, 0, W - pad, 0);
      lg.addColorStop(0, '#e8c05a');
      lg.addColorStop(1, 'rgba(232,192,90,0)');
      c.fillStyle = lg;
      c.fillRect(pad, y, innerW, 3);
    }
    y += 30;

    const info = (label, value) => {
      if (!value) return;
      c.font = `700 22px ${SANS}`;
      if (draw) {
        c.fillStyle = '#e8c05a';
        c.fillText(label, pad, y + 3);
      }
      const ys = y;
      text(value, pad + 120, `500 26px ${SANS}`, '#f3ecda', 38, innerW - 120);
      y = Math.max(y, ys + 38) + 6;
    };
    info('일시', fmtKo(m.held_at));
    info('장소', m.place);

    if (mode === 'public') {
      section('결정 사항 요약');
      text(m.public_summary || '', pad, `500 28px ${SANS}`, '#f3ecda', 46, innerW);
    } else {
      info('서기', m.secretary);
      const chips = (names, bg, fg) => {
        let x = pad + 120;
        let first = true;
        names.forEach((n) => {
          c.font = `500 22px ${SANS}`;
          const w = c.measureText(n).width + 36;
          if (x + w > W - pad && !first) {
            x = pad + 120;
            y += 50;
          }
          if (draw) {
            rr(c, x, y, w, 40, 20);
            c.fillStyle = bg;
            c.fill();
            c.fillStyle = fg;
            c.textBaseline = 'middle';
            c.fillText(n, x + 18, y + 21);
            c.textBaseline = 'top';
          }
          x += w + 10;
          first = false;
        });
        y += 50;
      };
      const chipRow = (label, names, bg, fg) => {
        if (!names || !names.length) return;
        c.font = `700 22px ${SANS}`;
        if (draw) {
          c.fillStyle = '#e8c05a';
          c.fillText(label, pad, y + 8);
        }
        chips(names, bg, fg);
      };
      y += 6;
      chipRow('참석', m.attendees, 'rgba(232,192,90,.18)', '#ffe8a0');
      chipRow('불참', m.absentees, 'rgba(255,255,255,.08)', '#b8b09a');

      const agenda = (m.agenda || []).filter((a) => a.title || a.discussion || a.decision);
      if (agenda.length) {
        section('주요 안건');
        agenda.forEach((a, i) => {
          const top = y;
          if (draw) {
            c.fillStyle = '#c4473a';
            c.beginPath();
            c.arc(pad + 22, y + 22, 22, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#fff';
            c.font = `900 24px ${SANS}`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(String(i + 1), pad + 22, y + 23);
            c.textAlign = 'left';
            c.textBaseline = 'top';
          }
          const x = pad + 62;
          if (a.title) text(a.title, x, `700 30px ${SANS}`, '#ffffff', 42, innerW - 62);
          if (a.discussion) {
            y += 4;
            text(a.discussion, x, `400 24px ${SANS}`, '#cfc7b3', 38, innerW - 62);
          }
          if (a.decision) {
            y += 12;
            c.font = `500 25px ${SANS}`;
            const dl = wrap(c, a.decision, innerW - 62 - 110);
            const bh = Math.max(56, dl.length * 38 + 22);
            if (draw) {
              rr(c, x, y, innerW - 62, bh, 10);
              c.fillStyle = 'rgba(232,192,90,.13)';
              c.fill();
              c.fillStyle = '#e8c05a';
              c.fillRect(x, y + 6, 6, bh - 12);
              c.font = `700 21px ${SANS}`;
              c.fillText('결정', x + 22, y + 15);
              c.font = `500 25px ${SANS}`;
              c.fillStyle = '#fff3cf';
              dl.forEach((l, k) => c.fillText(l, x + 110, y + 11 + k * 38));
            }
            y += bh;
          }
          y = Math.max(y, top + 48) + 18;
        });
      }

      const acts = (m.actions || []).filter((a) => a.task);
      if (acts.length) {
        section('후속 조치');
        acts.forEach((a) => {
          const ys = y;
          if (draw) {
            c.font = `500 28px ${SANS}`;
            c.fillStyle = a.done ? '#7fbf86' : '#e8c05a';
            c.fillText(a.done ? '☑' : '☐', pad, y);
          }
          const n = text(a.task, pad + 44, `500 25px ${SANS}`, a.done ? '#9aa392' : '#f3ecda', 38, 560);
          const owner = a.owner || '';
          const due = a.due ? `${Number(a.due.slice(5, 7))}/${Number(a.due.slice(8, 10))}까지` : '';
          if (draw) {
            c.font = `500 23px ${SANS}`;
            c.fillStyle = '#ffe8a0';
            c.fillText(owner, pad + 640, ys + 3);
            c.fillStyle = '#b8b09a';
            c.fillText(due, pad + 640 + 200, ys + 3);
          }
          y = Math.max(y, ys + n * 38) + 12;
        });
      }
    }

    if (m.next_meeting_at) {
      y += 30;
      const bh = 86;
      if (draw) {
        const g = c.createLinearGradient(pad, 0, W - pad, 0);
        g.addColorStop(0, 'rgba(196,71,58,.85)');
        g.addColorStop(1, 'rgba(120,28,22,.55)');
        rr(c, pad, y, innerW, bh, 14);
        c.fillStyle = g;
        c.fill();
        c.fillStyle = '#ffe8a0';
        c.font = `700 22px ${SANS}`;
        c.fillText('다음 회의', pad + 28, y + 16);
        c.fillStyle = '#fff';
        c.font = `900 32px ${SERIF}`;
        c.fillText(fmtKo(m.next_meeting_at), pad + 28, y + 42);
      }
      y += bh;
    }

    // 맺음말
    y += 40;
    if (draw) {
      c.fillStyle = 'rgba(232,192,90,.35)';
      c.fillRect(pad, y, innerW, 2);
    }
    y += 22;
    c.font = `400 20px ${SANS}`;
    const foot = mode === 'public' ? '길드원 공지용 요약 · 호드평화유지단 · 오늘도 평화로운 호드 생활' : '호드평화유지단 내부 자료 · 외부에 공유하지 마세요 · 오늘도 평화로운 호드 생활';
    if (draw) {
      c.fillStyle = '#9d9684';
      c.textAlign = 'center';
      c.fillText(foot, W / 2, y);
      c.textAlign = 'left';
    }
    y += 30 + 56;
    return y;
  }

  async function makeImage(mode) {
    const f = $('mForm');
    if (!f.reportValidity()) return;
    const m = { ...current, ...collect() };
    if (mode === 'public' && !m.public_summary) return toast('공지용 이미지는 "길드원 공개 요약"을 먼저 적어야 만들 수 있습니다.', false);
    try {
      await Promise.all([document.fonts.load(`900 40px ${SERIF}`), document.fonts.load(`700 24px ${SANS}`), document.fonts.load(`500 24px ${SANS}`), document.fonts.load(`400 24px ${SANS}`)]);
    } catch (e) {
      /* 글꼴을 못 불러와도 기본 글꼴로 그린다 */
    }
    const W = 1080;
    const meas = document.createElement('canvas').getContext('2d');
    const H = Math.ceil(layout(meas, m, mode, W, false));
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1d0d0b');
    bg.addColorStop(0.5, '#10090a');
    bg.addColorStop(1, '#08090d');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    const glow = c.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.8);
    glow.addColorStop(0, 'rgba(196,71,58,.28)');
    glow.addColorStop(1, 'rgba(196,71,58,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    layout(c, m, mode, W, true);
    c.lineWidth = 4;
    c.strokeStyle = 'rgba(232,192,90,.75)';
    rr(c, 14, 14, W - 28, H - 28, 18);
    c.stroke();
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(196,71,58,.7)';
    rr(c, 24, 24, W - 48, H - 48, 12);
    c.stroke();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) return toast('이미지를 만들지 못했습니다.', false);
    showImage(blob, `호드평화유지_${m.number}차_정기총회${mode === 'public' ? '_공지용' : ''}.png`);
  }

  function showImage(blob, name) {
    const url = URL.createObjectURL(blob);
    const o = document.createElement('div');
    o.className = 'img-modal';
    o.innerHTML = `<div class="img-box" role="dialog" aria-label="회의록 이미지 미리보기"><div class="img-bar"><b>${esc(name)}</b><span><a class="btn small" download="${esc(name)}" href="${url}">PNG 저장</a> <button class="btn small" type="button" data-close>닫기</button></span></div><div class="img-scroll"><img src="${url}" alt="회의록 이미지"></div></div>`;
    const close = () => {
      URL.revokeObjectURL(url);
      o.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    o.addEventListener('click', (e) => (e.target === o || e.target.closest('[data-close]')) && close());
    document.addEventListener('keydown', onKey);
    document.body.appendChild(o);
  }

  function onAuth(d) {
    ctx = d ? { userId: d.userId, rank: d.rank } : { userId: null, rank: null };
    view = 'list';
    current = null;
    load();
  }
  window.addEventListener('hl-auth', (e) => onAuth(e.detail));
  onAuth(window.hlAuthState);
})();
