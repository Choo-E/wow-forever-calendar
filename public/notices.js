// 공지 탭: 전체 공개 / 길드원 전용 / 호드평화유지단 전용 공지. 읽기 범위는 데이터베이스 규칙(RLS)이 정한다.
// 작성·삭제·고정은 간부·길마만 할 수 있다 (화면에서 숨기는 것은 편의일 뿐, 막는 것은 데이터베이스다).
(function () {
  const $ = (id) => document.getElementById(id);
  const sb = window.sb;
  const listBox = $('dbNotices');
  if (!sb || !listBox) return;

  const AUD = { public: '전체 공개', member: '길드원 전용', peacekeeper: '호드평화유지단 전용' };
  const toast = (t, ok = true) => (window.hlToast ? window.hlToast(t, ok) : undefined);
  let ctx = { userId: null, rank: null };
  const isMember = () => Boolean(ctx.userId && ctx.rank && ctx.rank !== 'pending');
  const isOfficer = () => ctx.rank === 'officer' || ctx.rank === 'master';

  // 본문: 글자는 모두 안전하게 처리하고, http(s) 주소만 링크로 바꾼다
  const body = (s) =>
    esc(s)
      .replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
      .replace(/\n/g, '<br>');
  const dateText = (iso) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(iso));

  async function load() {
    const showMine = isMember();
    $('noticeComposerBlock').hidden = !isOfficer();
    const locked = $('lockedNoticeBlock');
    if (locked) locked.hidden = showMine;

    const { data, error } = await sb
      .from('notices')
      .select('id, title, body, audience, pinned, starts_at, ends_at, created_at')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      listBox.innerHTML = `<div class="empty">공지를 불러오지 못했습니다. (${esc(error.message)})</div>`;
      return;
    }
    const notices = data || [];
    renderList(notices);
    renderHome(notices);
  }

  function renderList(notices) {
    if (!notices.length) {
      listBox.innerHTML = '<div class="empty">아직 올라온 공지가 없습니다.</div>';
      return;
    }
    const now = Date.now();
    listBox.innerHTML = notices
      .map((n) => {
        const expired = n.ends_at && new Date(n.ends_at).getTime() < now;
        const upcoming = new Date(n.starts_at).getTime() > now;
        const act = isOfficer()
          ? `<div class="notice-act"><button class="btn small" type="button" data-act="pin" data-id="${esc(n.id)}" data-pinned="${n.pinned}">${n.pinned ? '고정 해제' : '상단 고정'}</button><button class="btn small danger" type="button" data-act="del" data-id="${esc(n.id)}">삭제</button></div>`
          : '';
        return `<article class="notice-card aud-${esc(n.audience)}${expired ? ' expired' : ''}">
          <div class="notice-top">
            ${n.pinned ? '<span class="pin" title="상단 고정">📌</span>' : ''}
            <span class="aud-badge aud-${esc(n.audience)}">${esc(AUD[n.audience] || n.audience)}</span>
            ${expired ? '<span class="aud-badge">기간 종료</span>' : ''}${upcoming ? '<span class="aud-badge">게시 예정</span>' : ''}
            <small>${esc(dateText(n.created_at))}${n.ends_at ? ` · ${esc(dateText(n.ends_at))}까지` : ''}</small>
          </div>
          <h3>${esc(n.title)}</h3>
          <div class="notice-body">${body(n.body)}</div>
          ${act}
        </article>`;
      })
      .join('');
  }

  // 홈 상단: 고정된 공지만 띄운다
  function renderHome(notices) {
    const now = Date.now();
    const pinned = notices.filter((n) => n.pinned && new Date(n.starts_at).getTime() <= now && (!n.ends_at || new Date(n.ends_at).getTime() > now)).slice(0, 3);
    $('homeDbNotices').innerHTML = pinned.map((n) => `<a class="notice-banner" href="#/notice">📌 ${esc(n.title)}</a>`).join('');
  }

  // ───── 작성 (간부·길마) ─────
  const form = $('noticeForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = form.elements.ntitle.value.trim();
      const text = form.elements.nbody.value.trim();
      if (!title || !text) return toast('제목과 내용을 모두 입력해 주세요.', false);
      const endDay = form.elements.nend.value;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { error } = await sb.from('notices').insert({
        title,
        body: text,
        audience: form.elements.naud.value,
        pinned: form.elements.npin.checked,
        ends_at: endDay ? new Date(`${endDay}T23:59:59+09:00`).toISOString() : null,
      });
      btn.disabled = false;
      if (error) return toast(/row-level security/.test(error.message) ? '권한이 없습니다.' : error.message, false);
      form.reset();
      toast('공지를 올렸습니다.');
      load();
    });
  }

  // 삭제는 두 번 눌러야 실행된다 (실수 방지)
  const armed = new Map();
  listBox.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'pin') {
      const { error } = await sb.from('notices').update({ pinned: b.dataset.pinned !== 'true' }).eq('id', id);
      if (error) return toast(error.message, false);
      return load();
    }
    if (b.dataset.act === 'del') {
      if (!armed.get(id)) {
        armed.set(id, setTimeout(() => {
          armed.delete(id);
          b.textContent = '삭제';
        }, 4000));
        b.textContent = '정말 삭제?';
        return;
      }
      clearTimeout(armed.get(id));
      armed.delete(id);
      const { error } = await sb.from('notices').delete().eq('id', id);
      if (error) return toast(error.message, false);
      toast('삭제했습니다.');
      load();
    }
  });

  function onAuth(d) {
    ctx = d ? { userId: d.userId, rank: d.rank } : { userId: null, rank: null };
    load();
  }
  window.addEventListener('hl-auth', (e) => onAuth(e.detail));
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/notice' || location.hash === '#/home' || location.hash === '') load();
  });
  onAuth(window.hlAuthState);
})();
