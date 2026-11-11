-- ════════════════════════════════════════════════════════════════
-- 호드 길드 앱 2단계 데이터베이스 설계 (Supabase / PostgreSQL)
--
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
-- 여러 번 실행해도 안전하도록 만들어 두었다.
--
-- 보안 원칙
--  1) 모든 표에 RLS(행 단위 접근 규칙)를 켠다. 규칙이 없으면 아무도 못 읽는다.
--  2) 등급(rank)은 사용자가 직접 못 바꾼다. 길마·간부만 set_rank() 함수로 바꾼다.
--  3) 공개 명단은 표를 직접 열어 주지 않고 get_roster() 함수로만 보여 준다.
--     (캐릭터 이름·직업·역할·등급만. 디스코드 정보는 절대 나가지 않는다.)
-- ════════════════════════════════════════════════════════════════

-- ───── 0. 등급 ─────
do $$ begin
  create type public.guild_rank as enum ('pending', 'newbie', 'member', 'raid_leader', 'officer', 'master');
  -- pending=가입 승인 대기, newbie=신입, member=정회원, raid_leader=공대장, officer=간부, master=길마
exception when duplicate_object then null; end $$;

-- ───── 1. 프로필 (로그인한 사람 한 명당 한 줄) ─────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  discord_id   text,
  display_name text not null default '이름 없음',
  avatar_url   text,
  rank         public.guild_rank not null default 'pending',
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid references public.profiles (id)
);
alter table public.profiles enable row level security;

-- 디스코드로 처음 로그인하면 프로필을 자동으로 만든다. 처음에는 항상 '승인 대기(pending)'.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, discord_id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '이름 없음'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───── 2. 도우미 함수: 내 등급 / 길드원인가 / 간부인가 ─────
create or replace function public.my_rank() returns public.guild_rank
language sql stable security definer set search_path = '' as $$
  select rank from public.profiles where id = (select auth.uid());
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_rank() <> 'pending', false);
$$;

-- 호드평화유지단(길드 관리자) = 간부 + 길마. (공대장 포함 여부가 정해지면 여기를 고친다.)
create or replace function public.is_officer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_rank() in ('officer', 'master'), false);
$$;

-- ───── 3. 프로필 접근 규칙 ─────
drop policy if exists "내 프로필 보기" on public.profiles;
create policy "내 프로필 보기" on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "관리자는 모든 프로필 보기" on public.profiles;
create policy "관리자는 모든 프로필 보기" on public.profiles for select to authenticated
  using (public.is_officer());
-- 수정·삭제 규칙은 일부러 만들지 않는다. (등급은 set_rank() 로만 바뀐다)

-- ───── 4. 캐릭터 ─────
create table if not exists public.characters (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  class      text not null,
  role       text not null check (role in ('tank', 'healer', 'dps')),
  is_main    boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists characters_name_unique on public.characters (lower(name));
alter table public.characters enable row level security;

-- 한 사람이 캐릭터를 너무 많이 만들지 못하게 막는다. (최대 10개)
create or replace function public.limit_characters() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.characters where owner = new.owner) >= 10 then
    raise exception '캐릭터는 최대 10개까지 등록할 수 있습니다.';
  end if;
  return new;
end $$;
drop trigger if exists characters_limit on public.characters;
create trigger characters_limit before insert on public.characters
  for each row execute function public.limit_characters();

drop policy if exists "내 캐릭터와 관리자 보기" on public.characters;
create policy "내 캐릭터와 관리자 보기" on public.characters for select to authenticated
  using (owner = (select auth.uid()) or public.is_officer());

drop policy if exists "내 캐릭터 등록" on public.characters;
create policy "내 캐릭터 등록" on public.characters for insert to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists "내 캐릭터 수정" on public.characters;
create policy "내 캐릭터 수정" on public.characters for update to authenticated
  using (owner = (select auth.uid()) or public.is_officer())
  with check (owner = (select auth.uid()) or public.is_officer());

drop policy if exists "내 캐릭터 삭제" on public.characters;
create policy "내 캐릭터 삭제" on public.characters for delete to authenticated
  using (owner = (select auth.uid()) or public.is_officer());

-- ───── 5. 앱 설정 (명단 공개 스위치 등) ─────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('roster_public', 'true'::jsonb) on conflict (key) do nothing;

-- 공개해도 되는 설정(명단 공개 여부)만 누구나 읽을 수 있다.
drop policy if exists "공개 설정 읽기" on public.app_settings;
create policy "공개 설정 읽기" on public.app_settings for select to anon, authenticated
  using (key = 'roster_public');

-- ───── 6. 공지 (전체 공개 / 길드원 전용 / 호드평화유지단 전용) ─────
create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null default '',
  audience   text not null default 'public' check (audience in ('public', 'member', 'peacekeeper')),
  pinned     boolean not null default false,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  author     uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.notices enable row level security;

drop policy if exists "공지 읽기" on public.notices;
create policy "공지 읽기" on public.notices for select to anon, authenticated
  using (
    public.is_officer()
    or (
      starts_at <= now() and (ends_at is null or ends_at > now())
      and (
        audience = 'public'
        or (audience = 'member' and public.is_member())
        or (audience = 'peacekeeper' and public.is_officer())
      )
    )
  );

drop policy if exists "관리자 공지 작성" on public.notices;
create policy "관리자 공지 작성" on public.notices for insert to authenticated with check (public.is_officer());
drop policy if exists "관리자 공지 수정" on public.notices;
create policy "관리자 공지 수정" on public.notices for update to authenticated using (public.is_officer()) with check (public.is_officer());
drop policy if exists "관리자 공지 삭제" on public.notices;
create policy "관리자 공지 삭제" on public.notices for delete to authenticated using (public.is_officer());

-- ───── 7. 명단 보기: 안전한 열만 돌려주는 함수 ─────
-- 명단이 '공개'로 설정돼 있으면 누구나, '길드원 전용'이면 승인된 길드원만 본다.
create or replace function public.get_roster() returns table (name text, class text, role text, rank text, is_main boolean)
language sql stable security definer set search_path = '' as $$
  select c.name, c.class, c.role, p.rank::text, c.is_main
  from public.characters c
  join public.profiles p on p.id = c.owner
  where p.rank <> 'pending'
    and (
      coalesce((select (s.value #>> '{}')::boolean from public.app_settings s where s.key = 'roster_public'), true)
      or public.is_member()
    )
  order by
    case p.rank when 'master' then 1 when 'officer' then 2 when 'raid_leader' then 3 when 'member' then 4 else 5 end,
    c.is_main desc,
    c.name;
$$;

-- ───── 8. 등급 바꾸기 / 설정 바꾸기 (권한 확인 포함) ─────
create or replace function public.set_rank(target uuid, new_rank public.guild_rank) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller_rank public.guild_rank := public.my_rank();
  old_rank    public.guild_rank;
begin
  if caller_rank is null or caller_rank not in ('officer', 'master') then
    raise exception '권한이 없습니다.';
  end if;
  select p.rank into old_rank from public.profiles p where p.id = target;
  if old_rank is null then
    raise exception '대상을 찾을 수 없습니다.';
  end if;
  -- 간부 이상 등급을 주거나 바꾸는 일, 길마의 등급을 바꾸는 일은 길마만 할 수 있다.
  if (new_rank in ('officer', 'master', 'raid_leader') or old_rank in ('officer', 'master', 'raid_leader')) and caller_rank <> 'master' then
    raise exception '길마만 할 수 있습니다.';
  end if;
  update public.profiles
     set rank = new_rank,
         approved_at = case when old_rank = 'pending' and new_rank <> 'pending' then now() else approved_at end,
         approved_by = case when old_rank = 'pending' and new_rank <> 'pending' then (select auth.uid()) else approved_by end
   where id = target;
end $$;

create or replace function public.set_setting(setting_key text, setting_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_rank() is distinct from 'master' then
    raise exception '길마만 바꿀 수 있습니다.';
  end if;
  if setting_key not in ('roster_public') then
    raise exception '알 수 없는 설정입니다.';
  end if;
  insert into public.app_settings (key, value) values (setting_key, setting_value)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ───── 9. 함수 실행 권한 ─────
-- 규칙에서 쓰는 도우미 함수는 비로그인(anon)도 실행할 수 있어야 한다. (결과는 항상 '아님/없음')
revoke all on function public.my_rank(), public.is_member(), public.is_officer() from public;
grant execute on function public.my_rank(), public.is_member(), public.is_officer() to anon, authenticated;

revoke all on function public.get_roster() from public;
grant execute on function public.get_roster() to anon, authenticated;

-- 등급·설정 변경은 로그인한 사람만 (함수 안에서 한 번 더 권한을 확인한다)
revoke all on function public.set_rank(uuid, public.guild_rank), public.set_setting(text, jsonb) from public, anon;
grant execute on function public.set_rank(uuid, public.guild_rank), public.set_setting(text, jsonb) to authenticated;

-- ───── 10. 처음 길마 지정 (딱 한 번, 직접 실행) ─────
-- 사이트에서 디스코드로 한 번 로그인한 뒤, 아래 둘 중 하나를 SQL Editor에서 실행한다.
--
--   (확인) select id, display_name, discord_id, created_at from public.profiles;
--   (지정) update public.profiles set rank = 'master', approved_at = now() where id = '여기에 위에서 확인한 내 id';
--
-- 이 한 줄은 대시보드(프로젝트 주인)만 실행할 수 있다. 사이트 방문자는 할 수 없다.
