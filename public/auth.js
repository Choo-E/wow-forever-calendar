// 디스코드 로그인 (Supabase Auth). 설정이 없거나 라이브러리를 못 불러오면 조용히 꺼진다.
(function () {
  const cfg = window.APP_CONFIG || {};
  const box = document.getElementById('authBox');
  const card = document.getElementById('accountCard');
  if (!box || !card) return;

  const RANK = { pending: '승인 대기', newbie: '신입', member: '정회원', raid_leader: '공대장', officer: '간부', master: '길마' };

  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) {
    box.hidden = true;
    card.innerHTML = '<div class="placeholder"><div class="ph-icon">🔑</div><h3>로그인은 준비 중입니다</h3><p>디스코드 로그인이 연결되면 이곳에서 내 계정 상태를 볼 수 있습니다.</p></div>';
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  window.sb = sb; // 다른 화면 코드에서도 쓸 수 있게 둔다

  // 로그인 후 돌아올 주소: 지금 보던 페이지 (공개 사이트·내 컴퓨터 모두 허용 목록에 등록되어 있다)
  const returnUrl = () => location.origin + location.pathname;

  async function login() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: returnUrl() } });
    if (error) showError(error.message);
  }
  async function logout() {
    await sb.auth.signOut();
  }
  window.hordeLogin = login; // 시험용

  function showError(msg) {
    card.innerHTML = `<div class="placeholder lock"><div class="ph-icon">⚠️</div><h3>로그인 중 문제가 생겼습니다</h3><p>${esc(msg)}</p></div>`;
  }

  const safeAvatar = (u) => (typeof u === 'string' && u.startsWith('https://cdn.discordapp.com/') ? u : '');

  // 다른 화면 코드(members.js 등)가 로그인 상태를 알 수 있게 알려 준다
  function emit(detail) {
    window.hlAuthState = detail;
    window.dispatchEvent(new CustomEvent('hl-auth', { detail }));
  }

  async function render(session) {
    if (!session) {
      emit({ session: null, userId: null, rank: null, name: '' });
      box.innerHTML = '<button class="btn login-btn" type="button" id="loginBtn">🔑 디스코드로 로그인</button>';
      box.querySelector('#loginBtn').onclick = login;
      card.innerHTML = `<div class="placeholder">
        <div class="ph-icon">🔑</div>
        <h3>디스코드로 로그인</h3>
        <p>별도의 회원가입이나 비밀번호 없이 <b>디스코드 계정</b>으로 로그인합니다. 처음 로그인하면 <b>승인 대기</b> 상태가 되고, 길마·간부가 승인하면 길드원 기능을 쓸 수 있습니다.</p>
        <p class="warn">로그인하면 디스코드가 알려주는 <b>사용자 이름·프로필 사진·이메일</b>이 로그인 서비스(Supabase)에 저장됩니다. 이메일은 화면과 공개 명단에 나오지 않습니다.</p>
        <button class="btn" type="button" id="loginBtn2">🔑 디스코드로 로그인</button>
      </div>`;
      card.querySelector('#loginBtn2').onclick = login;
      return;
    }

    // 로그인한 상태: 내 프로필(등급)을 가져온다. 규칙상 내 것만 읽을 수 있다.
    const { data: me, error } = await sb.from('profiles').select('display_name, avatar_url, rank, approved_at').eq('id', session.user.id).maybeSingle();
    if (error) return showError(error.message);

    const rank = me?.rank || 'pending';
    const name = me?.display_name || '이름 없음';
    const avatar = safeAvatar(me?.avatar_url);
    box.innerHTML = `<span class="me">${avatar ? `<img src="${esc(avatar)}" alt="" width="26" height="26">` : ''}<b>${esc(name)}</b><span class="rank-badge r-${esc(rank)}">${esc(RANK[rank] || rank)}</span></span><button class="btn" type="button" id="logoutBtn">로그아웃</button>`;
    box.querySelector('#logoutBtn').onclick = logout;
    emit({ session, userId: session.user.id, rank, name });

    let body;
    if (rank === 'pending') {
      body = `<h3>가입 승인을 기다리는 중입니다</h3><p><b>${esc(name)}</b>님의 가입 신청이 접수되었습니다. 길마나 간부가 승인하면 길드원 기능을 쓸 수 있습니다. 승인이 늦어지면 디스코드에서 길마·간부에게 알려 주세요.</p>`;
    } else if (rank === 'master' || rank === 'officer') {
      body = `<h3>${esc(RANK[rank])} 권한으로 로그인했습니다</h3><p><b>${esc(name)}</b>님은 호드평화유지단입니다. 가입 승인과 등급 관리 화면은 다음 단계에서 열립니다.</p>`;
    } else {
      body = `<h3>환영합니다, ${esc(name)}님</h3><p>등급: <b>${esc(RANK[rank] || rank)}</b>. 캐릭터 등록과 레이드 신청 기능은 단계적으로 열립니다.</p>`;
    }
    card.innerHTML = `<div class="placeholder ${rank === 'pending' ? '' : 'ok'}"><div class="ph-icon">${rank === 'pending' ? '⏳' : '✅'}</div>${body}<span class="ph-tag">${esc(RANK[rank] || rank)}</span></div>`;
  }

  sb.auth.onAuthStateChange((event, session) => {
    // 콜백 안에서 바로 요청을 보내면 막히는 경우가 있어 한 박자 늦춘다
    setTimeout(() => render(session), 0);
    if (event === 'SIGNED_IN' && /[?&]code=/.test(location.search)) {
      history.replaceState(null, '', location.pathname + '#/member');
      location.hash = '#/member';
    }
  });
  sb.auth.getSession().then(({ data }) => render(data.session));
})();
