-- ─────────────────────────────────────────────────────────────
-- 대양롤랜트 인사평가 프로토타입 — Supabase 데이터베이스 설정
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 전체를 붙여넣고 [Run].
-- 여러 번 실행해도 안전합니다(이미 있는 데이터는 지우지 않음).
--
-- 저장 구조
--   app_state  : 한 줄. shared = 로그인한 모든 사람이 읽는 설정(조직·평가·문항),
--                admin_only = 관리자만 읽는 것(KPI·보정·채점·메모·리포트 기록)
--   responses  : 평가 응답 한 건 = 한 줄(배정 ID)
--   admins     : 관리자 계정
-- 권한
--   표에는 직접 접근할 수 없고(RLS 켜고 정책 없음), 아래 함수로만 읽고 씀.
--   직원은 자기 응답만 읽고 쓸 수 있고(다른 사람 응답은 '상태'만), 설정은 관리자만 바꿈.
-- 계정
--   관리자 = admin@admin.daeyang-hr.app (처음 로그인한 비밀번호로 생성, 한 명)
--   직원   = <직원ID>@staff.daeyang-hr.app (첫 로그인 때 이름 + 사번이 맞으면 생성, 이후 비밀번호 변경 가능)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.app_state (
  id int primary key default 1 check (id = 1),
  shared jsonb not null default '{}'::jsonb,
  admin_only jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.responses (
  assignment_id text primary key,
  evaluator_id text not null,
  status text not null check (status in ('draft', 'submitted')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.app_state enable row level security;
alter table public.responses enable row level security;
alter table public.admins enable row level security;
-- 정책을 만들지 않음 = 브라우저(anon·authenticated)에서 표를 직접 읽고 쓸 수 없음. 아래 함수만 허용
revoke all on public.app_state, public.responses, public.admins from anon, authenticated;

-- ── 누구인가 ─────────────────────────────────────────────
create or replace function public.dy_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

/** 로그인한 직원의 직원 ID(재직 중일 때만). 관리자·미로그인·삭제된 직원은 null */
create or replace function public.dy_my_employee() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  eid text;
begin
  if em not like '%@staff.daeyang-hr.app' then return null; end if;
  eid := split_part(em, '@', 1);
  if exists (
    select 1 from public.app_state s, jsonb_array_elements(coalesce(s.shared -> 'employees', '[]'::jsonb)) e
    where s.id = 1 and lower(e ->> 'id') = eid and coalesce((e ->> 'active')::boolean, false) and not coalesce((e ->> 'isCeo')::boolean, false)
  ) then
    select e ->> 'id' into eid from public.app_state s, jsonb_array_elements(s.shared -> 'employees') e where s.id = 1 and lower(e ->> 'id') = eid limit 1;
    return eid;
  end if;
  return null;
end $$;

-- ── 로그인 도우미(로그인 전에도 부름) ─────────────────────
/** 이 이름의 재직 직원 계정 이메일 목록(동명이인이면 여러 개)과 계정이 이미 있는지. 사번 등 다른 정보는 주지 않음 */
create or replace function public.dy_login_candidates(p_name text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'email', lower(e ->> 'id') || '@staff.daeyang-hr.app',
           'hasAccount', exists (select 1 from auth.users u where u.email = lower(e ->> 'id') || '@staff.daeyang-hr.app'))), '[]'::jsonb)
  from public.app_state s, jsonb_array_elements(coalesce(s.shared -> 'employees', '[]'::jsonb)) e
  where s.id = 1 and trim(e ->> 'name') = trim(p_name)
    and coalesce((e ->> 'active')::boolean, false) and not coalesce((e ->> 'isCeo')::boolean, false);
$$;

/** 관리자 계정이 이미 있는지(없으면 처음 로그인한 비밀번호로 관리자 계정을 만든다) */
create or replace function public.dy_admin_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins);
$$;

-- ── 계정 생성 검사(가입 = 이 규칙을 통과한 것만) ─────────────
create or replace function public.dy_on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  em text := lower(coalesce(new.email, ''));
  eid text;
  emp jsonb;
begin
  if em = 'admin@admin.daeyang-hr.app' then
    if exists (select 1 from public.admins) then raise exception 'admin already exists'; end if;
    insert into public.admins (user_id) values (new.id);
    return new;
  end if;
  if em like '%@staff.daeyang-hr.app' then
    eid := split_part(em, '@', 1);
    select e into emp from public.app_state s, jsonb_array_elements(coalesce(s.shared -> 'employees', '[]'::jsonb)) e
      where s.id = 1 and lower(e ->> 'id') = eid and coalesce((e ->> 'active')::boolean, false) and not coalesce((e ->> 'isCeo')::boolean, false) limit 1;
    -- 첫 로그인 = 이름 + 사번이 맞을 때만(가입 요청에 실어 보낸 사번이 직원 정보와 같아야 함)
    if emp is null or coalesce(new.raw_user_meta_data ->> 'empNo', '') <> coalesce(emp ->> 'empNo', '~') then
      raise exception 'not an employee';
    end if;
    return new;
  end if;
  raise exception 'signup not allowed';
end $$;

drop trigger if exists dy_on_new_user on auth.users;
create trigger dy_on_new_user after insert on auth.users for each row execute function public.dy_on_new_user();

-- ── 설정 읽기·쓰기 ─────────────────────────────────────────
/** 화면 데이터. 관리자 = 전부, 직원 = 공유 설정(다른 직원 사번은 빼고), 그 밖 = 오류 */
create or replace function public.dy_get_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st public.app_state;
  sh jsonb;
begin
  select * into st from public.app_state where id = 1;
  if public.dy_is_admin() then
    return jsonb_build_object('state', st.shared || st.admin_only, 'version', st.version, 'role', 'admin');
  end if;
  if public.dy_my_employee() is null then raise exception 'not allowed'; end if;
  sh := st.shared;
  if sh ? 'employees' then
    sh := jsonb_set(sh, '{employees}', coalesce((select jsonb_agg(e - 'empNo') from jsonb_array_elements(sh -> 'employees') e), '[]'::jsonb));
  end if;
  return jsonb_build_object('state', sh, 'version', st.version, 'role', 'participant', 'employeeId', public.dy_my_employee());
end $$;

/** 관리자만: 설정 저장. 다른 사람이 먼저 저장했으면(버전이 다르면) 'conflict' */
create or replace function public.dy_save_state(p_shared jsonb, p_admin jsonb, p_version bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.dy_is_admin() then raise exception 'not allowed'; end if;
  update public.app_state set shared = p_shared, admin_only = p_admin, version = version + 1, updated_at = now()
    where id = 1 and version = p_version returning version into v;
  if v is null then raise exception 'conflict'; end if;
  return v;
end $$;

/** 지금 버전만(바뀌었는지 가볍게 확인) */
create or replace function public.dy_state_version() returns bigint
language sql stable security definer set search_path = public as $$
  select version from public.app_state where id = 1;
$$;

-- ── 응답 ──────────────────────────────────────────────────
/** 응답 목록. 관리자 = 전부, 직원 = 내 응답 전부 + 다른 사람 응답은 상태만(단계 잠금 판단용) */
create or replace function public.dy_get_responses() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me text := public.dy_my_employee();
begin
  if public.dy_is_admin() then
    return coalesce((select jsonb_object_agg(assignment_id, data) from public.responses), '{}'::jsonb);
  end if;
  if me is null then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_object_agg(assignment_id,
      case when evaluator_id = me then data
           else jsonb_build_object('assignmentId', assignment_id, 'answers', '{}'::jsonb, 'status', status, 'savedAt', data ->> 'savedAt', 'submittedAt', data -> 'submittedAt', 'lang', 'ko') end)
    from public.responses), '{}'::jsonb);
end $$;

/** 응답 저장(임시저장·제출). 직원 = 내가 평가자인 배정만, 마감·확정 회차·이미 제출한 응답은 안 됨. 관리자 = 어떤 응답이든 */
create or replace function public.dy_save_response(p_aid text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me text := public.dy_my_employee();
  adm boolean := public.dy_is_admin();
  asg jsonb;
  cst text;
  cur text;
  st text := p_data ->> 'status';
begin
  if not adm and me is null then raise exception 'not allowed'; end if;
  if st not in ('draft', 'submitted') then raise exception 'bad status'; end if;
  select a, c ->> 'status' into asg, cst
    from public.app_state s, jsonb_array_elements(coalesce(s.shared -> 'cycles', '[]'::jsonb)) c, jsonb_array_elements(coalesce(c -> 'assignments', '[]'::jsonb)) a
    where s.id = 1 and a ->> 'id' = p_aid limit 1;
  if asg is null then raise exception 'no assignment'; end if;
  if not adm then
    if asg ->> 'evaluatorId' <> me or asg ? 'excluded' then raise exception 'not your assignment'; end if;
    if cst in ('마감', '확정') then raise exception 'closed'; end if;
    select status into cur from public.responses where assignment_id = p_aid;
    if cur = 'submitted' then raise exception 'already submitted'; end if;
  end if;
  insert into public.responses (assignment_id, evaluator_id, status, data, updated_at)
    values (p_aid, asg ->> 'evaluatorId', st, p_data || jsonb_build_object('assignmentId', p_aid), now())
    on conflict (assignment_id) do update set evaluator_id = excluded.evaluator_id, status = excluded.status, data = excluded.data, updated_at = now();
end $$;

/** 응답 지우기. 직원 = 내 임시저장만(빈 답으로 되돌릴 때), 관리자 = 어떤 응답이든(직원 삭제 등) */
create or replace function public.dy_delete_responses(p_aids text[]) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.dy_my_employee();
begin
  if public.dy_is_admin() then
    delete from public.responses where assignment_id = any (p_aids);
  elsif me is not null then
    delete from public.responses where assignment_id = any (p_aids) and evaluator_id = me and status = 'draft';
  else
    raise exception 'not allowed';
  end if;
end $$;

/** 관리자만: 모든 데이터 지우고 처음(빈 상태)으로 — 관리자 계정은 남김 */
create or replace function public.dy_reset_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.dy_is_admin() then raise exception 'not allowed'; end if;
  delete from public.responses where true;
  update public.app_state set shared = '{}'::jsonb, admin_only = '{}'::jsonb, version = version + 1, updated_at = now() where id = 1;
  -- 직원 계정(로그인 정보)도 지움 — 다음 첫 로그인 때 다시 이름 + 사번으로 만들어짐
  delete from auth.users where email like '%@staff.daeyang-hr.app';
end $$;

-- 함수 실행 권한: 로그인 도우미 두 개만 로그인 전(anon)에도, 나머지는 로그인한 사람만
revoke all on function public.dy_is_admin(), public.dy_my_employee(), public.dy_login_candidates(text), public.dy_admin_exists(),
  public.dy_get_state(), public.dy_save_state(jsonb, jsonb, bigint), public.dy_state_version(), public.dy_get_responses(),
  public.dy_save_response(text, jsonb), public.dy_delete_responses(text[]), public.dy_reset_all(), public.dy_on_new_user() from public, anon, authenticated;
grant execute on function public.dy_login_candidates(text), public.dy_admin_exists() to anon, authenticated;
grant execute on function public.dy_is_admin(), public.dy_get_state(), public.dy_save_state(jsonb, jsonb, bigint), public.dy_state_version(),
  public.dy_get_responses(), public.dy_save_response(text, jsonb), public.dy_delete_responses(text[]), public.dy_reset_all() to authenticated;
