# 2단계 준비: 직접 하실 일 (디스코드 로그인 + 데이터베이스)

목표: 길드원이 **디스코드 계정으로 로그인**하고, 캐릭터를 등록하고, 길마가 가입을 **승인**하는 바탕을 만든다.
계정 가입과 비밀 값 입력은 보안상 **직접** 하셔야 한다. 막히는 화면은 캡처해서 보여 주시면 된다. (단, 아래 "절대 보내면 안 되는 것"은 캡처에서 가려 주세요.)

## 전체 순서

| 순서 | 할 일 | 소요 |
|---|---|---|
| A | Supabase 가입 + 프로젝트 만들기 | 10분 |
| B | 디스코드 개발자 앱 만들기 | 10분 |
| C | Supabase에 디스코드 연결 | 5분 |
| D | 데이터베이스 만들기 (SQL 붙여넣기) | 3분 |
| E | 저에게 공개용 값 2개 알려주기 | 1분 |

## A. Supabase 가입 + 프로젝트 만들기

1. https://supabase.com 에 들어가 **Start your project** (또는 Sign in)를 누른다.
2. **Continue with GitHub**로 로그인한다. (이미 있는 GitHub 계정 사용. 승인 창에서 직접 승인)
3. 조직(Organization)을 만든다. 이름 예: `호드생활`, 요금제는 **Free**.
4. **New project**를 누르고 입력한다.

| 항목 | 입력 |
|---|---|
| Name | `hordelife` (영문 소문자) |
| Database Password | **Generate a password** 를 눌러 만들고, **안전한 곳에 따로 저장** (대화창에 붙여넣지 않기) |
| Region | 한국과 가까운 곳 (예: Northeast Asia / Seoul 또는 Tokyo) |

5. 만들어질 때까지 1~2분 기다린다.

## B. 디스코드 개발자 앱 만들기

1. https://discord.com/developers/applications 에 접속해 로그인한다.
2. **New Application** → 이름 `오늘도 평화로운 호드 생활` → 약관 체크 → **Create**.
   (이 이름이 길드원이 로그인할 때 디스코드 승인 화면에 보인다.)
3. 왼쪽 **OAuth2** 메뉴에서 다음을 확인한다.
   - **Client ID** → 복사해 둔다. (공개되어도 되는 값)
   - **Client Secret** → **Reset Secret**을 눌러 만들고 복사해 둔다. (**비밀번호와 같다. 대화창·GitHub에 절대 올리지 않기**)
4. **Redirects** 칸은 C단계에서 Supabase의 주소를 받은 뒤 채운다.

## C. Supabase에 디스코드 연결

1. Supabase 프로젝트 → **Authentication** → **Sign In / Providers** (메뉴 이름이 조금 다를 수 있음) → **Discord**를 켠다(Enable).
2. B단계에서 복사한 **Client ID**와 **Client Secret**을 붙여넣는다.
3. 같은 화면에 있는 **Callback URL** (`https://....supabase.co/auth/v1/callback` 형태)을 **복사**한다.
4. 디스코드 개발자 앱 → OAuth2 → **Redirects** → **Add Redirect** → 복사한 주소를 붙여넣고 **Save Changes**.
5. Supabase로 돌아와 **Save**.
6. **Authentication → URL Configuration**에서 입력한다.
   - **Site URL**: `https://choo-e.github.io/wow-forever-calendar/`
   - **Redirect URLs**에 두 개 추가: `https://choo-e.github.io/wow-forever-calendar/**` 와 `http://localhost:3000/**`
7. **Authentication → Sign In / Providers**에서 **Email**은 **끈다** (또는 가입 허용 끄기). 그래야 **디스코드로만** 가입할 수 있다.

## D. 데이터베이스 만들기

1. Supabase 프로젝트 → 왼쪽 **SQL Editor** → **New query**.
2. 이 저장소의 [`supabase/schema.sql`](../supabase/schema.sql) 파일 **전체**를 복사해서 붙여넣는다.
   (GitHub에서 열고 "Copy raw file" 버튼을 쓰면 편하다.)
3. **Run**을 누른다. `Success` 같은 메시지가 나오면 된다. 오류가 나면 캡처해서 보여 주세요.

이 파일이 만드는 것: 프로필(승인 대기 → 승인), 캐릭터, 공지, 명단 공개 스위치, 그리고 "누가 무엇을 볼 수 있는지" 규칙.

## E. 저에게 알려 주실 것 (공개해도 되는 값 2개)

Supabase 프로젝트의 **Project Settings → API** (또는 상단 **Connect**)에서 확인한다.

| 알려 주실 것 | 모양 | 공개 가능? |
|---|---|---|
| **Project URL** | `https://xxxxxxxx.supabase.co` | ✅ 가능 |
| **Publishable key** (예전 이름: anon public key) | `sb_publishable_...` 또는 `eyJ...` | ✅ 가능 (원래 웹페이지에 들어가는 공개용 값) |

공개용 값이 노출되어도 안전한 이유: 데이터를 지키는 것은 키가 아니라 **D단계에서 만든 접근 규칙(RLS)**이다.

### 🚫 절대 보내면 안 되는 것 (대화창, GitHub, 캡처 모두 금지)

- **secret key / service_role key**: 규칙을 무시하고 모든 데이터를 열 수 있는 열쇠
- **Database Password**
- **Discord Client Secret**
- Supabase의 다른 "Reveal" 버튼으로 보이는 값

실수로 노출했다면 **즉시 해당 서비스에서 재발급(Reset/Rotate)**하면 된다.

## 이후 흐름 (제가 하는 일)

1. 받은 공개용 값 2개를 사이트 설정에 넣고 **디스코드 로그인 버튼**을 만든다.
2. 사이트에서 **본인이 한 번 로그인**한다. 이때 등급은 "승인 대기"다.
3. SQL Editor에서 **본인을 길마로 지정**한다. ([`schema.sql`](../supabase/schema.sql) 맨 아래의 안내 참고, 제가 한 줄씩 알려 드림)
4. 길드원이 로그인하면 "승인 대기"가 되고, 길마·간부가 **승인하며 등급을 정한다.**
5. 캐릭터 등록, 멤버 명단(공개 스위치), 공지(3단계 공개 범위) 순으로 열어 간다.

## 알아 두실 점

- **무료 플랜은 일정 기간 사용이 없으면 일시 정지될 수 있다.** Supabase 공식 문서에 따르면 7일 동안 데이터베이스 활동이 적은 무료 프로젝트는 정지되고, 정지 1주일 전쯤 이메일로 경고가 온다. 다시 켤 수는 있다. 대비책으로 GitHub 자동 실행에 **가벼운 "깨우기" 요청**을 추가할 예정이다. (효과는 실제로 확인해야 한다.) 확실하게 막으려면 유료 Pro 플랜(월 약 $25)이 필요하다.
- **무료 플랜에는 자동 백업이 없다.** 멤버·회의록 같은 중요한 데이터는 정기적으로 내려받아 보관하는 방법을 4단계에서 만든다.
- **디스코드 이메일**: Supabase의 디스코드 로그인은 기본으로 이메일 정보도 요청한다. 이 정보는 Supabase 내부에만 저장되고 우리 화면과 공개 명단에는 나오지 않게 만든다. 이를 싫어하는 길드원에게는 미리 안내하는 것이 좋다.
- **가입은 승인제**다. 아무나 디스코드로 로그인할 수는 있지만 승인 전에는 아무 정보도 볼 수 없다.

참고: [Supabase 프로젝트 일시 정지 안내](https://supabase.com/docs/guides/platform/free-plan-pausing), [Supabase 디스코드 로그인 설정](https://supabase.com/docs/guides/auth/social-login/auth-discord)
