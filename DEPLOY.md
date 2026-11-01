# 인터넷에 공개하는 방법 (GitHub Pages)

공개 주소는 `https://내아이디.github.io/저장소이름/` 형태가 됩니다. 비용은 들지 않습니다.

## 한 번만 하는 준비
1. https://github.com 에서 계정을 만든다. (직접 가입)
2. 새 저장소(New repository)를 만든다. 이름 예: `wow-forever-calendar`, 공개(Public) 선택.
3. 이 폴더의 파일을 그 저장소에 올린다. (Git 또는 GitHub Desktop 사용)
4. 저장소의 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꾼다.
5. **Actions** 탭에서 `데이터 갱신 및 배포`를 한 번 수동 실행(Run workflow)한다.

이후에는 30분마다 자동으로 소식을 받아 사이트가 갱신된다.

## 일정이 바뀌었을 때
`data/schedule.json` 을 고쳐서 올리면(push) 바로 다시 배포된다.
화면 아래의 "2026년 11월 1일 기준" 문구(`public/index.html`)도 같이 고친다.

## 알아둘 점
- 공개 저장소에서 60일 동안 활동이 없으면 GitHub가 예약 실행을 멈출 수 있다. 멈추면 Actions 탭에서 다시 켠다.
- 블리자드 로고와 이미지의 권리는 블리자드에 있다. 블리자드가 내려 달라고 요청하면 `public/img/forever-logo.png` 와 `index.html`의 `<img class="brand-logo">`를 글자 로고로 바꾼다.
- 블리자드 뉴스 페이지 자동 수집(`src/sources/blizzard.js`)은 공개판에서 꺼져 있다. 내 컴퓨터에서만 쓰려면 `ENABLE_BLIZZARD=1` 로 실행한다.
