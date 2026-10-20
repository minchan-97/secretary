-- =====================================================================
-- 업무 비서 커널 스키마 v0.2
-- v0.2 변경: 요청 주체에서 'molang' 제거, 관제실은 사용자 명의 업무만 생성 가능
--
-- 핵심 원칙: 에이전트는 '능력'은 스스로 만들 수 있지만 '권한'은 스스로 줄 수 없다.
-- 이 원칙을 커널 코드의 성실함이 아니라 DB 구조(역할 권한 + 트리거)로 강제한다.
-- 커널 코드에 버그가 있어도 DB가 마지막 방어선이 된다.
--
-- 역할 분리
--   agent_kernel : Modal에서 도는 에이전트 커널이 접속하는 역할
--   dashboard_ui : 웹 관제실(Vercel)이 접속하는 역할 (승인·설정 변경은 여기서만)
--   샌드박스     : DB 접속 정보 자체를 받지 않음
--
-- 실행 위치: Supabase SQL Editor에서 한 번에 실행
-- 'agent' 스키마는 Supabase API(Exposed schemas)에 노출하지 말 것.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists agent;

-- ---------------------------------------------------------------------
-- 0. 역할 (비밀번호는 실행 후 별도로 설정)
--    alter role agent_kernel password '...';
--    alter role dashboard_ui password '...';
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_kernel') then
    create role agent_kernel login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_ui') then
    create role dashboard_ui login;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. 전역 설정 (킬스위치 포함) — 커널은 읽기만
-- ---------------------------------------------------------------------
create table agent.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into agent.settings (key, value) values
  ('agent_enabled',                'true'),
  ('monthly_budget_usd',           '10'),
  ('auto_promote_readonly_tools',  'false');

-- ---------------------------------------------------------------------
-- 2. 과업 유형(플레이북) — 비서가 할 수 있는 '업무 종류' 목록
--    새 업무 분야 = 새 행 추가. 활성화는 사람만.
-- ---------------------------------------------------------------------
create table agent.task_types (
  name            text primary key,
  description     text not null,
  max_level       smallint not null check (max_level between 0 and 3),
  default_budget  jsonb not null default
    '{"usd": 0.5, "sandbox_seconds": 600, "llm_calls": 50, "web_calls": 50}',
  enabled         boolean not null default false,
  created_at      timestamptz not null default now()
);

insert into agent.task_types (name, description, max_level, enabled) values
  ('grad_school_research',
   '대학원 진학 전략 컨설팅: 후보 생성(다채널), 교수 매칭, 경쟁률, 병행 부담, 진로 가치 분석',
   1, true);

-- ---------------------------------------------------------------------
-- 3. 과업
--    권한 레벨: 0 읽기·검색 / 1 초안·샌드박스 / 2 되돌릴 수 있는 내부 수정
--              / 3 외부 발송·삭제 등 비가역 (항상 승인 필요)
-- ---------------------------------------------------------------------
create type agent.task_status as enum
  ('queued', 'running', 'waiting_approval', 'done', 'failed', 'cancelled');

create table agent.tasks (
  id                uuid primary key default gen_random_uuid(),
  task_type         text not null references agent.task_types(name),
  goal              text not null,
  success_criteria  text not null,
  scope             jsonb not null default '{}',
  max_level         smallint not null check (max_level between 0 and 3),
  budget_limit      jsonb,
  budget_used       jsonb not null default '{}',
  status            agent.task_status not null default 'queued',
  requested_by      text not null
                    check (requested_by in ('user', 'schedule', 'agent')),
  parent_task_id    uuid references agent.tasks(id),
  report            jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create function agent.check_task_insert() returns trigger
language plpgsql as $$
declare
  v_type    agent.task_types;
  v_parent  agent.tasks;
begin
  select * into v_type from agent.task_types
   where name = new.task_type and enabled;
  if not found then
    raise exception '비활성 또는 없는 과업 유형: %', new.task_type;
  end if;

  if new.max_level > v_type.max_level then
    raise exception '과업 레벨(%)이 유형 상한(%)을 넘음', new.max_level, v_type.max_level;
  end if;

  -- 커널은 사용자 명의로 과업을 만들 수 없고, 관제실은 사용자 명의로만 만든다
  if current_user = 'agent_kernel'
     and new.requested_by not in ('agent', 'schedule') then
    raise exception '커널은 agent/schedule 과업만 생성 가능';
  end if;
  if current_user = 'dashboard_ui' and new.requested_by <> 'user' then
    raise exception '관제실은 user 과업만 생성 가능';
  end if;

  -- 에이전트가 만든 하위 과업은 부모보다 높은 권한을 가질 수 없다
  if new.requested_by = 'agent' then
    if new.parent_task_id is null then
      raise exception '에이전트 하위 과업에는 부모 과업이 필요';
    end if;
    select * into v_parent from agent.tasks where id = new.parent_task_id;
    if new.max_level > v_parent.max_level then
      raise exception '하위 과업 레벨이 부모 과업을 넘을 수 없음';
    end if;
  end if;

  -- 예약 과업은 최대 레벨 1
  if new.requested_by = 'schedule' and new.max_level > 1 then
    raise exception '예약 과업은 레벨 1 이하만 가능';
  end if;

  new.budget_limit := coalesce(new.budget_limit, v_type.default_budget);
  new.budget_used  := '{}';
  new.status       := 'queued';
  return new;
end $$;

create trigger tasks_check_insert
  before insert on agent.tasks
  for each row execute function agent.check_task_insert();

-- ---------------------------------------------------------------------
-- 4. 감사 로그 — 추가만 가능, 수정·삭제·비우기 불가
-- ---------------------------------------------------------------------
create table agent.tools (  -- action_log가 참조하므로 먼저 생성
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  version          int not null default 1,
  description      text not null,
  code             text not null,
  tests            text not null,
  manifest         jsonb not null,  -- {"level":0,"kernel_actions":["web_search"],"inputs":{},"outputs":{}}
  status           text not null default 'candidate'
                   check (status in ('candidate', 'approved', 'deprecated', 'rejected')),
  created_by_task  uuid references agent.tasks(id),
  approval_id      uuid,
  runs             int not null default 0,
  failures         int not null default 0,
  created_at       timestamptz not null default now(),
  unique (name, version)
);

create type agent.approval_kind as enum
  ('tool_promotion', 'external_action', 'knowhow',
   'budget_increase', 'level_raise', 'task_type_proposal');

create table agent.approvals (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid references agent.tasks(id),
  kind           agent.approval_kind not null,
  target_id      uuid,          -- 도구 승격이면 tools.id
  summary        text not null, -- 대시보드·알림에 쓰는 짧은 요약 (민감 정보 금지)
  payload        jsonb not null default '{}',
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'expired')),
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decision_note  text
);

alter table agent.tools
  add constraint tools_approval_fk
  foreign key (approval_id) references agent.approvals(id);

create table agent.action_log (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  task_id      uuid references agent.tasks(id),
  actor        text not null check (actor in ('agent', 'kernel', 'human', 'system')),
  action       text not null,
  level        smallint check (level between 0 and 3),
  tool_id      uuid references agent.tools(id),
  approval_id  uuid references agent.approvals(id),
  summary      text not null,
  detail       jsonb not null default '{}',
  outcome      text not null check (outcome in ('ok', 'denied', 'error', 'pending'))
);

create function agent.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '%는 추가 전용 테이블입니다', tg_table_name;
end $$;

create trigger action_log_no_update_delete
  before update or delete on agent.action_log
  for each row execute function agent.forbid_mutation();

create trigger action_log_no_truncate
  before truncate on agent.action_log
  for each statement execute function agent.forbid_mutation();

create function agent.check_log_actor() returns trigger
language plpgsql as $$
begin
  if current_user = 'agent_kernel' and new.actor = 'human' then
    raise exception '커널은 사람 명의로 기록할 수 없음';
  end if;
  return new;
end $$;

create trigger action_log_check_actor
  before insert on agent.action_log
  for each row execute function agent.check_log_actor();

-- ---------------------------------------------------------------------
-- 5. 기술 라이브러리(가스 코드 블록) 규칙
--    - 새 도구는 항상 candidate로 시작
--    - 코드·테스트·명세는 불변: 고치려면 새 버전을 만든다 (출처 보존)
--    - 폐기·거절된 도구는 되살릴 수 없다
-- ---------------------------------------------------------------------
create function agent.tools_on_insert() returns trigger
language plpgsql as $$
begin
  new.status      := 'candidate';
  new.approval_id := null;
  new.runs        := 0;
  new.failures    := 0;
  return new;
end $$;

create trigger tools_insert
  before insert on agent.tools
  for each row execute function agent.tools_on_insert();

create function agent.tools_on_update() returns trigger
language plpgsql as $$
begin
  if new.code     is distinct from old.code
  or new.tests    is distinct from old.tests
  or new.manifest is distinct from old.manifest
  or new.name     is distinct from old.name
  or new.version  is distinct from old.version
  or new.created_by_task is distinct from old.created_by_task then
    raise exception '도구의 코드·테스트·명세는 수정 불가 — 새 버전을 만드세요';
  end if;
  if old.status in ('rejected', 'deprecated') and new.status <> old.status then
    raise exception '폐기·거절된 도구는 되살릴 수 없음';
  end if;
  return new;
end $$;

create trigger tools_update
  before update on agent.tools
  for each row execute function agent.tools_on_update();

-- ---------------------------------------------------------------------
-- 6. 기억 3층 중 영속 2층
--    observations : 관측 로그 (신념 아님, 커널이 자유롭게 기록)
--    knowhow      : 확정 노하우 (승인을 거쳐서만 생성)
--    작업 메모는 과업 실행 중 메모리에만 두고 DB에 넣지 않는다
-- ---------------------------------------------------------------------
create table agent.observations (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references agent.tasks(id),
  channel       text not null,   -- 예: school_first, topic_first, society, network
  query         text,
  source_url    text,
  content       jsonb not null,
  content_hash  text,
  created_at    timestamptz not null default now()
);

create index observations_task_idx on agent.observations (task_id);
create index observations_hash_idx on agent.observations (content_hash);

create table agent.knowhow (
  id               uuid primary key default gen_random_uuid(),
  domain           text not null,
  statement        text not null,
  source_approval  uuid not null references agent.approvals(id),
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create function agent.knowhow_requires_approval() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from agent.approvals
     where id = new.source_approval and kind = 'knowhow' and status = 'approved'
  ) then
    raise exception '노하우는 승인된 요청을 통해서만 생성 가능';
  end if;
  return new;
end $$;

create trigger knowhow_check
  before insert on agent.knowhow
  for each row execute function agent.knowhow_requires_approval();

-- ---------------------------------------------------------------------
-- 7. 사용자 프로필(고정 입력 층)
--    sensitive 행은 커널이 아예 볼 수 없다 (RLS)
-- ---------------------------------------------------------------------
create table agent.profile_facts (
  key          text primary key,
  value        text not null,
  sensitivity  text not null default 'normal'
               check (sensitivity in ('normal', 'sensitive')),
  updated_at   timestamptz not null default now()
);

alter table agent.profile_facts enable row level security;

create policy kernel_reads_normal on agent.profile_facts
  for select to agent_kernel
  using (sensitivity = 'normal');

create policy dashboard_full on agent.profile_facts
  for all to dashboard_ui
  using (true) with check (true);

-- ---------------------------------------------------------------------
-- 8. 커널 전용 함수
-- ---------------------------------------------------------------------

-- 킬스위치 확인
create function agent.is_enabled() returns boolean
language sql stable security definer set search_path = agent, pg_temp as $$
  select coalesce((select (value)::text::boolean from agent.settings
                    where key = 'agent_enabled'), false);
$$;

-- 예산 소비: 한도 안이면 차감 후 true, 넘으면 거부 기록 후 false
create function agent.consume_budget(p_task uuid, p_resource text, p_amount numeric)
returns boolean
language plpgsql security definer set search_path = agent, pg_temp as $$
declare
  v_limit numeric;
  v_used  numeric;
begin
  if p_amount < 0 then
    raise exception '음수 소비 불가';
  end if;

  select coalesce((budget_limit ->> p_resource)::numeric, 0),
         coalesce((budget_used  ->> p_resource)::numeric, 0)
    into v_limit, v_used
    from agent.tasks where id = p_task
     for update;
  if not found then
    raise exception '과업 없음: %', p_task;
  end if;

  if v_used + p_amount > v_limit then
    insert into agent.action_log (task_id, actor, action, summary, detail, outcome)
    values (p_task, 'kernel', 'budget_denied', p_resource || ' 한도 초과',
            jsonb_build_object('limit', v_limit, 'used', v_used, 'requested', p_amount),
            'denied');
    return false;
  end if;

  update agent.tasks
     set budget_used = jsonb_set(budget_used, array[p_resource], to_jsonb(v_used + p_amount)),
         updated_at  = now()
   where id = p_task;
  return true;
end $$;

-- 도구 실행 결과 기록 (성공·실패 통계 → 강등 판단 근거)
create function agent.record_tool_run(p_tool uuid, p_ok boolean)
returns void
language sql security definer set search_path = agent, pg_temp as $$
  update agent.tools
     set runs = runs + 1,
         failures = failures + case when p_ok then 0 else 1 end
   where id = p_tool;
$$;

-- 도구 폐기: 권한을 줄이는 방향이므로 커널에게 허용
create function agent.deprecate_tool(p_tool uuid, p_reason text)
returns void
language plpgsql security definer set search_path = agent, pg_temp as $$
begin
  update agent.tools set status = 'deprecated'
   where id = p_tool and status in ('candidate', 'approved');
  insert into agent.action_log (actor, action, tool_id, summary, outcome)
  values ('kernel', 'deprecate_tool', p_tool, coalesce(p_reason, '사유 없음'), 'ok');
end $$;

-- ---------------------------------------------------------------------
-- 9. 사람 전용 함수 — 승인 결정 (관제실만 실행 가능)
-- ---------------------------------------------------------------------
create function agent.decide_approval(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = agent, pg_temp as $$
declare
  a         agent.approvals;
  v_typemax smallint;
  v_newmax  smallint;
begin
  select * into a from agent.approvals where id = p_id for update;
  if not found then
    raise exception '승인 요청 없음';
  end if;
  if a.status <> 'pending' then
    raise exception '이미 결정된 요청';
  end if;

  update agent.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(),
         decision_note = p_note
   where id = p_id;

  if p_approve then
    if a.kind = 'tool_promotion' then
      update agent.tools set status = 'approved', approval_id = p_id
       where id = a.target_id and status = 'candidate';
      if not found then
        raise exception '후보 상태가 아닌 도구';
      end if;

    elsif a.kind = 'knowhow' then
      insert into agent.knowhow (domain, statement, source_approval)
      values (a.payload ->> 'domain', a.payload ->> 'statement', p_id);

    elsif a.kind = 'budget_increase' then
      update agent.tasks
         set budget_limit = budget_limit || (a.payload -> 'budget_limit'),
             updated_at = now()
       where id = a.task_id;

    elsif a.kind = 'level_raise' then
      select tt.max_level into v_typemax
        from agent.tasks t join agent.task_types tt on tt.name = t.task_type
       where t.id = a.task_id;
      v_newmax := (a.payload ->> 'max_level')::smallint;
      if v_newmax > v_typemax then
        raise exception '유형 상한(%)을 넘는 레벨 상향 불가', v_typemax;
      end if;
      update agent.tasks set max_level = v_newmax, updated_at = now()
       where id = a.task_id;

    elsif a.kind = 'task_type_proposal' then
      -- 에이전트가 제안한 새 업무 유형: 승인돼도 최대 레벨 1로 시작
      insert into agent.task_types (name, description, max_level, enabled)
      values (a.payload ->> 'name',
              a.payload ->> 'description',
              least(coalesce((a.payload ->> 'max_level')::smallint, 0), 1),
              true);
    end if;
    -- external_action: 상태만 approved로 남고, 실행은 커널이 이 상태를 확인한 뒤 수행

  else
    if a.kind = 'tool_promotion' then
      update agent.tools set status = 'rejected'
       where id = a.target_id and status = 'candidate';
    end if;
  end if;

  update agent.tasks set status = 'queued', updated_at = now()
   where id = a.task_id and status = 'waiting_approval';

  insert into agent.action_log (task_id, actor, action, approval_id, summary, outcome)
  values (a.task_id, 'human', 'decide_approval', p_id,
          case when p_approve then '승인: ' else '거절: ' end || a.summary, 'ok');
end $$;

-- 설정 변경 (킬스위치 등) — 관제실 전용
create function agent.set_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer set search_path = agent, pg_temp as $$
begin
  update agent.settings set value = p_value, updated_at = now() where key = p_key;
  if not found then
    raise exception '없는 설정: %', p_key;
  end if;
  insert into agent.action_log (actor, action, summary, detail, outcome)
  values ('human', 'set_setting', p_key || ' 변경', jsonb_build_object('value', p_value), 'ok');
end $$;

-- 관제실용 뷰
create view agent.pending_approvals as
  select a.id, a.kind, a.summary, a.requested_at, t.goal as task_goal
    from agent.approvals a
    left join agent.tasks t on t.id = a.task_id
   where a.status = 'pending'
   order by a.requested_at;

-- ---------------------------------------------------------------------
-- 10. 권한 부여
--     함수는 기본적으로 PUBLIC 실행 권한이 있으므로 먼저 전부 회수한다
-- ---------------------------------------------------------------------
revoke all on all functions in schema agent from public;
revoke all on schema agent from public;

grant usage on schema agent to agent_kernel, dashboard_ui;
grant usage on all sequences in schema agent to agent_kernel;

-- 커널: 읽기
grant select on agent.settings, agent.task_types, agent.tasks, agent.tools,
               agent.approvals, agent.action_log, agent.observations,
               agent.knowhow, agent.profile_facts
  to agent_kernel;

-- 커널: 추가
grant insert on agent.tasks, agent.tools, agent.approvals,
               agent.action_log, agent.observations
  to agent_kernel;

-- 커널: 과업은 상태와 보고서만 수정 가능 (레벨·예산 한도는 불가)
grant update (status, report, updated_at) on agent.tasks to agent_kernel;

grant execute on function
  agent.is_enabled(),
  agent.consume_budget(uuid, text, numeric),
  agent.record_tool_run(uuid, boolean),
  agent.deprecate_tool(uuid, text)
  to agent_kernel;

-- 관제실: 전체 읽기 + 사용자 과업 생성·취소 + 프로필·유형 관리 + 승인
grant select on all tables in schema agent to dashboard_ui;
grant insert on agent.tasks to dashboard_ui;
grant update (status, updated_at) on agent.tasks to dashboard_ui;
grant insert, update, delete on agent.profile_facts to dashboard_ui;
grant insert, update on agent.task_types to dashboard_ui;

grant execute on function
  agent.is_enabled(),
  agent.decide_approval(uuid, boolean, text),
  agent.set_setting(text, jsonb)
  to dashboard_ui;
