-- ════════════════════════════════════════════════════════════════
-- 4단계: 회의록(호드평화유지단 전용) · 레이드 결과/출석 기록 · 공지 작성자 기본값
--
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
-- (schema.sql, stage3-raids.sql 을 먼저 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.)
--
-- 보안 원칙
--  1) 회의록은 호드평화유지단(간부·길마)만 읽고 쓴다. 규칙(RLS)이 데이터베이스에서 막는다.
--  2) 확정된 회의록을 고치면 고치기 전 내용이 수정 이력에 자동으로 남는다.
--  3) 출석 기록은 함수로만 쓰고, 관리자만 개인별 기록과 통계를 본다. 길드원은 레이드 결과 요약과 합계만 본다.
-- ════════════════════════════════════════════════════════════════

-- ───── 1. 공지: 작성자를 로그인한 사람으로 자동 기록 ─────
alter table public.notices alter column author set default auth.uid();

-- ───── 2. 회의록 ─────
create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  number          int not null unique check (number > 0),          -- 차수: 호드평화유지 N차 정기 총회
  title           text not null,
  held_at         timestamptz not null,
  place           text,
  secretary       text,
  attendees       text[] not null default '{}',
  absentees       text[] not null default '{}',
  agenda          jsonb not null default '[]'::jsonb check (jsonb_typeof(agenda) = 'array'),   -- [{title, discussion, decision}]
  actions         jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),  -- [{task, owner, due, done}]
  next_meeting_at timestamptz,
  public_summary  text,                                              -- 길드원에게 알릴 요약(선택)
  status          text not null default 'draft' check (status in ('draft', 'final')),
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finalized_at    timestamptz
);
alter table public.meetings enable row level security;

drop policy if exists "관리자 회의록 읽기" on public.meetings;
create policy "관리자 회의록 읽기" on public.meetings for select to authenticated using (public.is_officer());
drop policy if exists "관리자 회의록 작성" on public.meetings;
create policy "관리자 회의록 작성" on public.meetings for insert to authenticated with check (public.is_officer());
drop policy if exists "관리자 회의록 수정" on public.meetings;
create policy "관리자 회의록 수정" on public.meetings for update to authenticated using (public.is_officer()) with check (public.is_officer());
drop policy if exists "관리자 회의록 삭제" on public.meetings;
create policy "관리자 회의록 삭제" on public.meetings for delete to authenticated using (public.is_officer());

-- 수정 이력: 확정된 회의록을 고치면 고치기 전 내용을 남긴다.
create table if not exists public.meeting_revisions (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  snapshot    jsonb not null,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);
alter table public.meeting_revisions enable row level security;
drop policy if exists "관리자 수정 이력 읽기" on public.meeting_revisions;
create policy "관리자 수정 이력 읽기" on public.meeting_revisions for select to authenticated using (public.is_officer());
-- 이력 표에는 쓰기 규칙이 없다. (아래 트리거만 기록한다)

create or replace function public.meetings_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'final' then
    insert into public.meeting_revisions (meeting_id, snapshot) values (old.id, to_jsonb(old));
  end if;
  new.updated_at := now();
  if new.status = 'final' and old.status <> 'final' then
    new.finalized_at := now();
  end if;
  return new;
end $$;
drop trigger if exists meetings_revision on public.meetings;
create trigger meetings_revision before update on public.meetings
  for each row execute function public.meetings_before_update();

-- ───── 3. 레이드 결과 · 출석 ─────
create table if not exists public.raid_results (
  raid_id     uuid primary key references public.raids (id) on delete cascade,
  summary     text,                                                 -- 진행 결과 요약
  cleared     text,                                                 -- 처치한 보스 등
  recorded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);
alter table public.raid_results enable row level security;
drop policy if exists "길드원 레이드 결과 읽기" on public.raid_results;
create policy "길드원 레이드 결과 읽기" on public.raid_results for select to authenticated using (public.is_member());
-- 쓰기는 save_raid_result() 함수로만

create table if not exists public.raid_attendance (
  raid_id     uuid not null references public.raids (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  attendance  text not null check (attendance in ('attended', 'late', 'noshow')),
  recorded_at timestamptz not null default now(),
  primary key (raid_id, profile_id)
);
alter table public.raid_attendance enable row level security;
-- 출석 표에는 읽기·쓰기 규칙을 일부러 만들지 않는다. (아래 함수로만 접근)

-- 지난 레이드 목록 (결과 요약과 출석 합계). 길드원 모두 볼 수 있다.
create or replace function public.get_past_raids(p_limit int default 20) returns table (
  id uuid, name text, starts_at timestamptz, dungeon text, size int, status text,
  summary text, cleared text, attended_count int, late_count int, noshow_count int, signup_count int, can_manage boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.starts_at, r.dungeon, r.size, r.status, rr.summary, rr.cleared,
         (select count(*)::int from public.raid_attendance a where a.raid_id = r.id and a.attendance = 'attended'),
         (select count(*)::int from public.raid_attendance a where a.raid_id = r.id and a.attendance = 'late'),
         (select count(*)::int from public.raid_attendance a where a.raid_id = r.id and a.attendance = 'noshow'),
         (select count(*)::int from public.raid_signups s where s.raid_id = r.id and s.status in ('signed', 'confirmed')),
         public.can_manage_raid(r.id)
  from public.raids r
  left join public.raid_results rr on rr.raid_id = r.id
  where public.is_member() and r.starts_at <= now() and r.status <> 'cancelled'
  order by r.starts_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

-- 출석 기록표 (관리자·그 레이드 공대장만): 신청/확정된 사람 목록과 지금까지 기록
create or replace function public.get_raid_attendance(p_raid uuid) returns table (
  profile_id uuid, display_name text, character_name text, class text, role text, signup_status text, attendance text)
language sql stable security definer set search_path = '' as $$
  select s.profile_id, p.display_name, c.name, c.class, s.role, s.status, a.attendance
  from public.raid_signups s
  join public.characters c on c.id = s.character_id
  join public.profiles   p on p.id = s.profile_id
  left join public.raid_attendance a on a.raid_id = s.raid_id and a.profile_id = s.profile_id
  where s.raid_id = p_raid and s.status in ('signed', 'confirmed') and public.can_manage_raid(p_raid)
  order by case s.status when 'confirmed' then 1 else 2 end, c.name;
$$;

-- 출석 기록하기. p_rows = [{"profile_id": "...", "attendance": "attended|late|noshow|null"}]
create or replace function public.record_attendance(p_raid uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.raids%rowtype;
  x record;
begin
  if not public.can_manage_raid(p_raid) then
    raise exception '권한이 없습니다.';
  end if;
  select * into r from public.raids where id = p_raid;
  if not found then
    raise exception '레이드를 찾을 수 없습니다.';
  end if;
  if now() < r.starts_at then
    raise exception '시작 전에는 출석을 기록할 수 없습니다.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '형식이 올바르지 않습니다.';
  end if;
  for x in select * from jsonb_to_recordset(p_rows) as t(profile_id uuid, attendance text) loop
    if not exists (select 1 from public.raid_signups s where s.raid_id = p_raid and s.profile_id = x.profile_id and s.status in ('signed', 'confirmed')) then
      raise exception '이 레이드에 신청한 사람이 아닙니다.';
    end if;
    if x.attendance is null or x.attendance = '' then
      delete from public.raid_attendance where raid_id = p_raid and profile_id = x.profile_id;
    elsif x.attendance in ('attended', 'late', 'noshow') then
      insert into public.raid_attendance (raid_id, profile_id, attendance) values (p_raid, x.profile_id, x.attendance)
      on conflict (raid_id, profile_id) do update set attendance = excluded.attendance, recorded_at = now();
    else
      raise exception '출석 값이 올바르지 않습니다.';
    end if;
  end loop;
end $$;

-- 레이드 결과 요약 저장 (저장하면 레이드는 "완료"가 된다)
create or replace function public.save_raid_result(p_raid uuid, p_summary text, p_cleared text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.raids%rowtype;
begin
  if not public.can_manage_raid(p_raid) then
    raise exception '권한이 없습니다.';
  end if;
  select * into r from public.raids where id = p_raid;
  if not found then
    raise exception '레이드를 찾을 수 없습니다.';
  end if;
  if now() < r.starts_at then
    raise exception '시작 전에는 결과를 기록할 수 없습니다.';
  end if;
  insert into public.raid_results (raid_id, summary, cleared)
  values (p_raid, nullif(trim(p_summary), ''), nullif(trim(p_cleared), ''))
  on conflict (raid_id) do update set summary = excluded.summary, cleared = excluded.cleared, recorded_by = (select auth.uid()), recorded_at = now();
  update public.raids set status = 'done' where id = p_raid and status = 'open';
end $$;

-- 출석 통계 (간부·길마만): 최근 N일의 사람별 기록
create or replace function public.get_attendance_stats(p_days int default 90) returns table (
  profile_id uuid, display_name text, main_character text, attended int, late int, noshow int, late_cancel int)
language sql stable security definer set search_path = '' as $$
  with rg as (
    select id from public.raids
     where starts_at <= now() and starts_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365))) and status <> 'cancelled'
  )
  select p.id, p.display_name,
         (select c.name from public.characters c where c.owner = p.id order by c.is_main desc, c.created_at limit 1),
         (select count(*)::int from public.raid_attendance a join rg on rg.id = a.raid_id where a.profile_id = p.id and a.attendance = 'attended'),
         (select count(*)::int from public.raid_attendance a join rg on rg.id = a.raid_id where a.profile_id = p.id and a.attendance = 'late'),
         (select count(*)::int from public.raid_attendance a join rg on rg.id = a.raid_id where a.profile_id = p.id and a.attendance = 'noshow'),
         (select count(*)::int from public.raid_signups s join rg on rg.id = s.raid_id where s.profile_id = p.id and s.late_cancel)
  from public.profiles p
  where public.is_officer() and p.rank <> 'pending'
  order by p.display_name;
$$;

-- ───── 4. 함수 실행 권한: 로그인한 사람만 (각 함수가 안에서 다시 권한을 확인한다) ─────
revoke all on function
  public.meetings_before_update(), public.get_past_raids(int), public.get_raid_attendance(uuid),
  public.record_attendance(uuid, jsonb), public.save_raid_result(uuid, text, text), public.get_attendance_stats(int)
  from public, anon;
grant execute on function
  public.get_past_raids(int), public.get_raid_attendance(uuid),
  public.record_attendance(uuid, jsonb), public.save_raid_result(uuid, text, text), public.get_attendance_stats(int)
  to authenticated;
