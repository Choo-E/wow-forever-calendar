-- ════════════════════════════════════════════════════════════════
-- 3단계: 레이드 신청 (정기 레이드 템플릿 → 주간 레이드 자동 생성 → 역할별 선착순 신청 → 공대장 확정)
--
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run
-- (supabase/schema.sql 을 먼저 실행한 뒤에 실행한다. 여러 번 실행해도 안전하다.)
--
-- 보안 원칙
--  1) 신청·취소·확정은 표를 직접 고치지 못하고 아래 함수로만 한다. (함수 안에서 권한·시간·정원을 확인)
--  2) 선착순은 함수 안에서 레이드 한 줄을 잠그고(for update) 판정해서, 동시에 눌러도 정원을 넘지 않는다.
--  3) 승인된 길드원(신입 이상)만 신청 목록을 볼 수 있다.
-- ════════════════════════════════════════════════════════════════

-- ───── 1. 정기 레이드 템플릿 ─────
create table if not exists public.raid_templates (
  id                 text primary key,                 -- 예: 'raid-sat-1800'
  name               text not null,
  weekday            smallint not null check (weekday between 0 and 6),   -- 0=일 1=월 ... 6=토
  start_time         time not null,                    -- 한국 시간
  dungeon            text,                             -- 미정이면 null
  size               int  check (size is null or size > 0),
  tank_slots         int  check (tank_slots is null or tank_slots >= 0),  -- null = 제한 없음
  healer_slots       int  check (healer_slots is null or healer_slots >= 0),
  dps_slots          int  check (dps_slots is null or dps_slots >= 0),
  leader_id          uuid references public.profiles (id) on delete set null,
  open_weekday       smallint not null default 4 check (open_weekday between 0 and 6),  -- 신청 오픈 요일 (기본 목요일)
  open_time          time not null default '21:00',    -- 신청 오픈 시각 (한국 시간)
  close_minutes_before int check (close_minutes_before is null or close_minutes_before >= 0),  -- null = 시작 시각까지
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);
alter table public.raid_templates enable row level security;

insert into public.raid_templates (id, name, weekday, start_time) values
  ('raid-sat-1800', '정기 레이드 · 토요일', 6, '18:00'),
  ('raid-sun-1800', '정기 레이드 · 일요일', 0, '18:00')
on conflict (id) do nothing;

-- ───── 2. 레이드 (템플릿에서 주마다 자동으로 생긴다) ─────
create table if not exists public.raids (
  id                 uuid primary key default gen_random_uuid(),
  template_id        text references public.raid_templates (id) on delete set null,
  name               text not null,
  starts_at          timestamptz not null,
  signup_opens_at    timestamptz not null,
  signup_closes_at   timestamptz,                      -- null = 시작 시각까지
  dungeon            text,
  size               int,
  tank_slots         int,
  healer_slots       int,
  dps_slots          int,
  leader_id          uuid references public.profiles (id) on delete set null,
  status             text not null default 'open' check (status in ('open', 'cancelled', 'done')),
  created_at         timestamptz not null default now(),
  unique (template_id, starts_at)
);
alter table public.raids enable row level security;

-- ───── 3. 신청 ─────
create table if not exists public.raid_signups (
  id            uuid primary key default gen_random_uuid(),
  raid_id       uuid not null references public.raids (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  character_id  uuid not null references public.characters (id) on delete cascade,
  role          text not null check (role in ('tank', 'healer', 'dps')),
  status        text not null default 'signed' check (status in ('signed', 'waitlist', 'confirmed', 'declined', 'cancelled')),
  signed_at     timestamptz not null default now(),
  cancelled_at  timestamptz,
  late_cancel   boolean not null default false,
  unique (raid_id, profile_id)                         -- 한 사람은 같은 레이드에 캐릭터 1개만
);
create index if not exists raid_signups_raid_idx on public.raid_signups (raid_id, role, status, signed_at);
alter table public.raid_signups enable row level security;
-- 신청 표에는 읽기·쓰기 규칙을 일부러 만들지 않는다. (아래 함수로만 접근)

-- 승인된 길드원은 템플릿과 레이드 일정을 읽을 수 있다. (수정은 함수로만)
drop policy if exists "길드원 템플릿 읽기" on public.raid_templates;
create policy "길드원 템플릿 읽기" on public.raid_templates for select to authenticated using (public.is_member());
drop policy if exists "길드원 레이드 읽기" on public.raids;
create policy "길드원 레이드 읽기" on public.raids for select to authenticated using (public.is_member());

-- ───── 4. 도우미: 이 레이드를 관리할 수 있는가 (간부·길마 또는 그 레이드의 공대장) ─────
create or replace function public.can_manage_raid(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_officer()
    or exists (select 1 from public.raids r where r.id = rid and r.leader_id = (select auth.uid())),
    false);
$$;

-- ───── 5. 주간 레이드 자동 만들기 (앞으로 14일치, 이미 있으면 건너뜀) ─────
create or replace function public.ensure_raids() returns void
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  d date;
  start_ts timestamptz;
  back int;
  today_kst date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public.is_member() then
    return;
  end if;
  -- 여러 명이 동시에 화면을 열어도 레이드 생성은 한 번에 한 요청씩 처리한다 (서로 엉키는 교착 방지)
  perform pg_advisory_xact_lock(hashtext('ensure_raids'));
  for t in select * from public.raid_templates where active loop
    for d in select g::date from generate_series(today_kst, today_kst + 13, interval '1 day') g loop
      if extract(dow from d)::int = t.weekday then
        start_ts := (d + t.start_time) at time zone 'Asia/Seoul';
        if start_ts > now() then
          back := (t.weekday - t.open_weekday + 7) % 7;   -- 레이드 직전에 돌아오는 오픈 요일까지 거꾸로 센다
          insert into public.raids (template_id, name, starts_at, signup_opens_at, signup_closes_at, dungeon, size, tank_slots, healer_slots, dps_slots, leader_id)
          values (
            t.id, t.name, start_ts,
            ((d - back) + t.open_time) at time zone 'Asia/Seoul',
            case when t.close_minutes_before is null then null else start_ts - make_interval(mins => t.close_minutes_before) end,
            t.dungeon, t.size, t.tank_slots, t.healer_slots, t.dps_slots, t.leader_id)
          on conflict (template_id, starts_at) do nothing;
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- ───── 6. 레이드 목록 (인원 현황과 내 신청 상태 포함) ─────
create or replace function public.get_raids() returns table (
  id uuid, name text, starts_at timestamptz, signup_opens_at timestamptz, signup_closes_at timestamptz,
  dungeon text, size int, tank_slots int, healer_slots int, dps_slots int,
  leader_id uuid, leader_name text, status text,
  tank_count int, healer_count int, dps_count int, waitlist_count int,
  my_signup_id uuid, my_status text, my_role text, can_manage boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.starts_at, r.signup_opens_at, r.signup_closes_at,
         r.dungeon, r.size, r.tank_slots, r.healer_slots, r.dps_slots,
         r.leader_id, p.display_name, r.status,
         (select count(*)::int from public.raid_signups s where s.raid_id = r.id and s.role = 'tank'   and s.status in ('signed', 'confirmed')),
         (select count(*)::int from public.raid_signups s where s.raid_id = r.id and s.role = 'healer' and s.status in ('signed', 'confirmed')),
         (select count(*)::int from public.raid_signups s where s.raid_id = r.id and s.role = 'dps'    and s.status in ('signed', 'confirmed')),
         (select count(*)::int from public.raid_signups s where s.raid_id = r.id and s.status = 'waitlist'),
         ms.id, ms.status, ms.role,
         public.can_manage_raid(r.id)
  from public.raids r
  left join public.profiles p on p.id = r.leader_id
  left join public.raid_signups ms on ms.raid_id = r.id and ms.profile_id = (select auth.uid()) and ms.status <> 'cancelled'
  where public.is_member() and r.status <> 'cancelled' and r.starts_at > now() - interval '12 hours'
  order by r.starts_at;
$$;

-- ───── 7. 신청자 목록 (길드원 모두 캐릭터·직업·역할·상태를 본다. 디스코드 이름은 관리자만) ─────
create or replace function public.get_raid_signups(p_raid uuid) returns table (
  signup_id uuid, character_name text, class text, role text, status text,
  signed_at timestamptz, late_cancel boolean, is_me boolean, who text)
language sql stable security definer set search_path = '' as $$
  select s.id, c.name, c.class, s.role, s.status, s.signed_at,
         case when public.can_manage_raid(p_raid) then s.late_cancel else false end,
         s.profile_id = (select auth.uid()),
         case when public.can_manage_raid(p_raid) then p.display_name else null end
  from public.raid_signups s
  join public.characters c on c.id = s.character_id
  join public.profiles   p on p.id = s.profile_id
  where s.raid_id = p_raid
    and public.is_member()
    and (s.status <> 'cancelled' or (s.late_cancel and public.can_manage_raid(p_raid)))
  order by case s.status when 'confirmed' then 1 when 'signed' then 2 when 'waitlist' then 3 when 'declined' then 4 else 5 end, s.signed_at;
$$;

-- ───── 8. 신청 (선착순: 레이드 한 줄을 잠그고 정원을 센다) ─────
create or replace function public.signup_raid(p_raid uuid, p_character uuid, p_role text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  r public.raids%rowtype;
  slots int;
  taken int;
  result_status text;
begin
  if not public.is_member() then
    raise exception '승인된 길드원만 신청할 수 있습니다.';
  end if;
  if p_role not in ('tank', 'healer', 'dps') then
    raise exception '역할이 올바르지 않습니다.';
  end if;

  select * into r from public.raids where id = p_raid for update;   -- 같은 레이드의 동시 신청을 한 줄로 세운다
  if not found or r.status <> 'open' then
    raise exception '신청할 수 없는 레이드입니다.';
  end if;
  if now() < r.signup_opens_at then
    raise exception '아직 신청이 열리지 않았습니다.';
  end if;
  if now() >= coalesce(r.signup_closes_at, r.starts_at) then
    raise exception '신청이 마감되었습니다.';
  end if;
  if not exists (select 1 from public.characters c where c.id = p_character and c.owner = uid) then
    raise exception '내 캐릭터가 아닙니다.';
  end if;
  if exists (select 1 from public.raid_signups s where s.raid_id = p_raid and s.profile_id = uid and s.status <> 'cancelled') then
    raise exception '이미 신청했습니다. 바꾸려면 먼저 취소해 주세요.';
  end if;

  slots := case p_role when 'tank' then r.tank_slots when 'healer' then r.healer_slots else r.dps_slots end;
  select count(*) into taken from public.raid_signups s where s.raid_id = p_raid and s.role = p_role and s.status in ('signed', 'confirmed');
  result_status := case when slots is null or taken < slots then 'signed' else 'waitlist' end;

  insert into public.raid_signups (raid_id, profile_id, character_id, role, status)
  values (p_raid, uid, p_character, p_role, result_status)
  on conflict (raid_id, profile_id) do update
    set character_id = excluded.character_id, role = excluded.role, status = excluded.status,
        signed_at = now(), cancelled_at = null, late_cancel = false;
  return result_status;
end $$;

-- ───── 9. 취소 (정원 자리가 나면 대기 1순위가 자동으로 올라온다) ─────
create or replace function public.cancel_signup(p_raid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  r public.raids%rowtype;
  s public.raid_signups%rowtype;
begin
  select * into r from public.raids where id = p_raid for update;
  if not found then
    raise exception '레이드를 찾을 수 없습니다.';
  end if;
  select * into s from public.raid_signups where raid_id = p_raid and profile_id = uid and status <> 'cancelled';
  if not found then
    raise exception '취소할 신청이 없습니다.';
  end if;
  if now() >= r.starts_at then
    raise exception '이미 시작한 레이드는 취소할 수 없습니다.';
  end if;

  update public.raid_signups
     set status = 'cancelled', cancelled_at = now(),
         late_cancel = (s.status in ('signed', 'confirmed') and r.starts_at - now() < interval '3 hours')   -- 시작 3시간 이내 취소는 기록만
   where id = s.id;

  -- 자리를 차지하고 있던 신청이면 같은 역할의 대기 1순위를 올린다
  if s.status in ('signed', 'confirmed') then
    update public.raid_signups
       set status = 'signed'
     where id = (select w.id from public.raid_signups w
                  where w.raid_id = p_raid and w.role = s.role and w.status = 'waitlist'
                  order by w.signed_at limit 1);
  end if;
end $$;

-- ───── 10. 공대장·간부가 신청 상태 정하기 (확정 / 신청 / 대기 / 제외) ─────
create or replace function public.set_signup_status(p_signup uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rid uuid;
begin
  if p_status not in ('confirmed', 'signed', 'waitlist', 'declined') then
    raise exception '상태가 올바르지 않습니다.';
  end if;
  select raid_id into rid from public.raid_signups where id = p_signup;
  if rid is null then
    raise exception '신청을 찾을 수 없습니다.';
  end if;
  if not public.can_manage_raid(rid) then
    raise exception '권한이 없습니다.';
  end if;
  perform 1 from public.raids where id = rid for update;
  update public.raid_signups set status = p_status where id = p_signup and status <> 'cancelled';
end $$;

-- ───── 11. 개별 레이드 수정 (던전·정원·공대장). 공대장 변경은 간부·길마만 ─────
create or replace function public.update_raid(p_raid uuid, p_dungeon text, p_size int, p_tank int, p_healer int, p_dps int, p_leader uuid, p_change_leader boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_raid(p_raid) then
    raise exception '권한이 없습니다.';
  end if;
  if p_change_leader and not public.is_officer() then
    raise exception '공대장 지정은 간부·길마만 할 수 있습니다.';
  end if;
  if coalesce(p_size, 1) < 1 or coalesce(p_tank, 0) < 0 or coalesce(p_healer, 0) < 0 or coalesce(p_dps, 0) < 0 then
    raise exception '숫자가 올바르지 않습니다.';
  end if;
  update public.raids
     set dungeon = nullif(trim(p_dungeon), ''), size = p_size, tank_slots = p_tank, healer_slots = p_healer, dps_slots = p_dps,
         leader_id = case when p_change_leader then p_leader else leader_id end
   where id = p_raid;
end $$;

-- ───── 12. 정기 레이드 템플릿 저장 (간부·길마). 앞으로 열릴 레이드에도 반영 ─────
create or replace function public.save_template(
  p_id text, p_dungeon text, p_size int, p_tank int, p_healer int, p_dps int, p_leader uuid,
  p_open_weekday smallint, p_open_time time, p_close_minutes int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_officer() then
    raise exception '권한이 없습니다.';
  end if;
  if coalesce(p_size, 1) < 1 or coalesce(p_tank, 0) < 0 or coalesce(p_healer, 0) < 0 or coalesce(p_dps, 0) < 0 or coalesce(p_close_minutes, 0) < 0 then
    raise exception '숫자가 올바르지 않습니다.';
  end if;
  update public.raid_templates
     set dungeon = nullif(trim(p_dungeon), ''), size = p_size, tank_slots = p_tank, healer_slots = p_healer, dps_slots = p_dps,
         leader_id = p_leader, open_weekday = p_open_weekday, open_time = p_open_time, close_minutes_before = p_close_minutes
   where id = p_id;
  if not found then
    raise exception '템플릿을 찾을 수 없습니다.';
  end if;
  -- 아직 시작하지 않은 레이드에도 던전·정원·공대장·마감을 반영한다 (신청 오픈 시각은 이미 열린 신청을 흔들지 않도록 그대로 둔다)
  update public.raids r
     set dungeon = t.dungeon, size = t.size, tank_slots = t.tank_slots, healer_slots = t.healer_slots, dps_slots = t.dps_slots,
         leader_id = t.leader_id,
         signup_closes_at = case when t.close_minutes_before is null then null else r.starts_at - make_interval(mins => t.close_minutes_before) end
    from public.raid_templates t
   where t.id = p_id and r.template_id = t.id and r.starts_at > now() and r.status = 'open';
end $$;

-- ───── 13. 함수 실행 권한: 로그인한 사람만 (각 함수가 안에서 길드원·관리자 여부를 다시 확인한다) ─────
revoke all on function
  public.can_manage_raid(uuid), public.ensure_raids(), public.get_raids(), public.get_raid_signups(uuid),
  public.signup_raid(uuid, uuid, text), public.cancel_signup(uuid), public.set_signup_status(uuid, text),
  public.update_raid(uuid, text, int, int, int, int, uuid, boolean),
  public.save_template(text, text, int, int, int, int, uuid, smallint, time, int)
  from public, anon;
grant execute on function
  public.can_manage_raid(uuid), public.ensure_raids(), public.get_raids(), public.get_raid_signups(uuid),
  public.signup_raid(uuid, uuid, text), public.cancel_signup(uuid), public.set_signup_status(uuid, text),
  public.update_raid(uuid, text, int, int, int, int, uuid, boolean),
  public.save_template(text, text, int, int, int, int, uuid, smallint, time, int)
  to authenticated;
