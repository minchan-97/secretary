import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import {
  ACTOR_LABEL,
  LEVEL_LABEL,
  OUTCOME_LABEL,
  STATUS_LABEL,
  UUID_RE,
  when,
} from '@/lib/labels';
import { cancelTask } from '../../actions';

export const dynamic = 'force-dynamic';

type Task = {
  id: string;
  task_type: string;
  goal: string;
  success_criteria: string;
  max_level: number;
  status: string;
  requested_by: string;
  budget_limit: Record<string, number> | null;
  budget_used: Record<string, number>;
  report: unknown;
  created_at: Date;
  updated_at: Date;
};

type LogRow = {
  id: string;
  ts: Date;
  actor: string;
  summary: string;
  outcome: string;
};

const REQUESTER: Record<string, string> = {
  user: '나',
  schedule: '예약',
  agent: '비서 (하위 업무)',
};

const RESOURCE: Record<string, string> = {
  usd: '비용(달러)',
  sandbox_seconds: '샌드박스(초)',
  llm_calls: '모델 호출',
  web_calls: '웹 검색',
};

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [task] = await sql<Task[]>`
    select id, task_type, goal, success_criteria, max_level, status::text as status,
           requested_by, budget_limit, budget_used, report, created_at, updated_at
      from agent.tasks where id = ${id}::uuid`;
  if (!task) notFound();

  const [{ count: observationCount }] = await sql<{ count: number }[]>`
    select count(*)::int as count from agent.observations where task_id = ${id}::uuid`;

  const logs = await sql<LogRow[]>`
    select id::text as id, ts, actor, summary, outcome
      from agent.action_log
     where task_id = ${id}::uuid
     order by id desc
     limit 50`;

  const active = ['queued', 'running', 'waiting_approval'].includes(task.status);
  const limits = task.budget_limit ?? {};

  return (
    <main>
      <header className="top">
        <Link className="back" href="/">
          돌아가기
        </Link>
        <span className="tag" data-status={task.status}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </header>

      <section>
        <p className="prose" style={{ fontSize: '1.35rem' }}>
          {task.goal}
        </p>
        <dl className="facts">
          <dt>완료 기준</dt>
          <dd>{task.success_criteria}</dd>
          <dt>업무 종류</dt>
          <dd>{task.task_type}</dd>
          <dt>권한</dt>
          <dd>{LEVEL_LABEL[task.max_level]}</dd>
          <dt>맡긴 쪽</dt>
          <dd>{REQUESTER[task.requested_by] ?? task.requested_by}</dd>
          <dt>맡긴 때</dt>
          <dd>{when(task.created_at)}</dd>
          <dt>모은 자료</dt>
          <dd>{observationCount}건</dd>
        </dl>
      </section>

      <section aria-labelledby="budget-h">
        <div className="section-head">
          <h2 id="budget-h">예산</h2>
        </div>
        <ul className="rows">
          {Object.keys(limits).map((k) => (
            <li key={k}>
              <span>{RESOURCE[k] ?? k}</span>
              <span className="tag">
                {task.budget_used[k] ?? 0} / {limits[k]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="report-h">
        <div className="section-head">
          <h2 id="report-h">보고서</h2>
        </div>
        {task.report ? (
          <pre>{JSON.stringify(task.report, null, 2)}</pre>
        ) : (
          <p className="empty">비서가 업무를 마치면 보고서가 여기에 붙습니다.</p>
        )}
      </section>

      <section aria-labelledby="log-h">
        <div className="section-head">
          <h2 id="log-h">이 업무의 기록</h2>
        </div>
        {logs.length === 0 ? (
          <p className="empty">아직 기록이 없습니다.</p>
        ) : (
          <ul className="rows">
            {logs.map((l) => (
              <li key={l.id}>
                <div className="row-main">
                  <span className="row-title">{l.summary}</span>
                  <span className="row-sub">
                    {ACTOR_LABEL[l.actor] ?? l.actor}, {when(l.ts)}
                  </span>
                </div>
                <span className="tag" data-outcome={l.outcome}>
                  {OUTCOME_LABEL[l.outcome] ?? l.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {active && (
        <form action={cancelTask}>
          <input type="hidden" name="id" value={task.id} />
          <button className="btn-quiet">이 업무 취소하기</button>
        </form>
      )}
    </main>
  );
}
