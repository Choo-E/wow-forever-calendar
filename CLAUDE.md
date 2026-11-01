# WoW Forever 캘린더

WoW: Forever 관련 일정·패치·이벤트를 모아 보여주는 웹앱. 사용자는 개발 초보(기계공학 전공)이므로 설명은 쉬운 한국어로, 비유를 곁들여 한다.

## 구조
- 공개 사이트는 **정적 파일(`public/`)만** GitHub Pages에 올린다. 서버 없음. 배포 방법은 `DEPLOY.md`
- `.github/workflows/update-and-deploy.yml` — 30분마다 `scripts/build-data.js`를 실행해 `public/data/feed.json`을 갱신·커밋하고 배포
- `src/collect.js` — 출처 목록(`SOURCES`)과 수집·병합 로직. 서버와 build 스크립트가 공유
- `server.js` — 내 컴퓨터 개발용 서버 (`/data/feed.json`을 공개 사이트와 같은 주소로 제공). 외부 의존성 없음
- `src/sources/` — 출처별 수집기 (`wowhead.js`: RSS, `blizzard.js`: 뉴스 페이지 파싱 — **공개판에서는 꺼짐**, `ENABLE_BLIZZARD=1`일 때만 사용)
- `src/classify.js` — 제목 키워드로 패치/이벤트/소식 및 Forever 여부 분류
- `data/schedule.json` — 손으로 관리하는 주요 일정 (출시일 등). 날짜 단위, 한국 시간 기준
- `public/` — 화면 (index.html, style.css, app.js)

## schedule.json 항목 형식
- `date`(시작일) / `endDate`(종료일, 기간 일정일 때만) / `dateText`(날짜 미정일 때 표시할 문구, date는 null)
- `category`: launch(출시), prelaunch(사전 일정), raid(공격대), roadmap(로드맵), beta(베타) — 달력·카드 색이 이 값으로 정해짐
- 오늘이 기간 안에 들어가면 "지금 진행 중" 카드(진행률 막대)로 자동 표시됨

## guild.json (길드 일정)
- 길드: 오늘도 평화로운 호드 생활 (호드). 사용자가 대화로 알려주는 일정을 `data/guild.json`의 `events`에 추가한다
- 항목: `title`, `date`, `endDate`(기간일 때), `time`(선택, 예 "21:00"), `note`(선택). 날짜는 한국 시간 기준
- `notices`: 사이트에 띄울 공지 문구 배열 (없으면 비워 둠)
- 달력에는 청록색(`cat-guild`)으로 표시, 달력 아래 "길드 일정" 영역에 예정·진행 중과 접이식 "지난 일정"으로 자동 분류됨
- 공개 사이트이므로 멤버 이름, 디스코드 초대 링크 등 민감한 정보는 넣지 않는다

## 자동 번역
- `src/translate.js` — 영어→한국어 무료 번역 (1순위 Google 번역 비공식 주소, 2순위 MyMemory). API 키 없음. `GLOSSARY`에 와우 용어 보정 사전
- `src/collect.js`의 `addTranslations` — 새 글만 번역해 `titleKo`/`summaryKo`로 저장 (원문 `titleSrc`/`summarySrc`와 비교해 바뀐 글만 재번역). 한 번에 30건, 연속 3회 실패하면 중단. 실패하면 영어 원문을 그대로 보여줌
- 화면은 한글을 먼저, 원문 제목은 작게 표시 (`.orig`). 비공식 주소라 막힐 수 있으며, 그때는 `translateText` 함수만 Claude API 등으로 교체하면 됨
- 어색한 용어는 `GLOSSARY`에 항목을 추가해 고친다

## 디스코드 일정판
- `scripts/post-discord.js` — 웹훅으로 채널에 일정판 메시지를 올리고, 일정이 바뀌면 같은 메시지를 수정. 새 길드 일정(id 기준)이 생기면 알림 메시지도 올림
- 웹훅 주소는 **GitHub Secrets의 `DISCORD_WEBHOOK_URL`** 에만 둔다. 파일·대화·커밋에 절대 적지 않는다 (저장소가 공개)
- `data/discord-state.json` — 일정판 메시지 ID와 내용 해시, 이미 알린 일정 id (봇이 자동 커밋)
- 새 길드 일정에는 반드시 고유한 `id`를 붙인다 (알림 중복 방지용)
- 새 패치·핫픽스 소식도 같은 채널에 알림 (`isPatchAlert`: 사이트 분류가 patch이고 제목에 hotfix/patch notes/tuning/fix/PTR 등이 있고 interview/guide/datamine 등은 제외). 한 번에 최대 5건, 처음 실행 때는 기존 글을 알리지 않고 기록만 함 (`seenItems`)
- 알림 기준이 어긋나면 `PATCH_ALERT_INCLUDE` / `PATCH_ALERT_EXCLUDE` 정규식을 고친다
- 시험: `DRY_RUN=1 node scripts/post-discord.js` (전송 없이 내용만 출력)

## 규칙
- 날짜는 공식 공지를 직접 확인한 뒤 적는다 (미국/한국 날짜가 하루 다를 수 있어 한국 기준으로 기록하고 note에 미국 기준을 병기)
- 새 출처는 `src/sources/`에 수집기를 만들고 `src/collect.js`의 `SOURCES`에 한 줄 추가
- 기사 본문은 복사하지 않고 제목·요약·링크만 보여준다 (저작권)
- 블리자드 페이지 구조가 바뀌면 `blizzard.js`가 먼저 깨진다. 실패해도 이전 캐시를 유지하는 것이 정상 동작
- 실행: `node server.js` (http://localhost:3000)
