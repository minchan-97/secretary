import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import {
  ACTOR_LABEL,
  KIND_LABEL,
  OUTCOME_LABEL,
  STATUS_LABEL,
  when,
} from '@/lib/labels';
import { approveRequest, rejectRequest, setWorking, signOut } from './actions';

export const dynamic = 'force-dynamic';

type Pending = {
  id: string;
  kind: string;
  summary: string;
  payload: unknown;
  requested_at: Date;
  task_id: string | null;
  goal: string | null;
  tool_name: string | null;
  tool_version: number | null;
  tool_manifest: unknown;
  tool_code: string | null;
  tool_tests: string | null;
};

type TaskRow = {
  id: string;
  goal: string;
  task_type: string;
  status: string;
  created_at: Date;
};

type LogRow = {
  id: string;
  ts: Date;
  actor: string;
  action: string;
  summary: string;
  outcome: string;
};

function hasContent(v: unknown) {
  return v != null && !(typeof v === 'object' && Object.keys(v as object).length === 0);
}

export default async function Home() {
  await requireUser();

  const [setting] = await sql<{ value: unknown }[]>`
    select value from agent.settings where key = 'agent_enabled'`;
  const working = setting?.value === true;

  const pending = await sql<Pending[]>`
    select a.id, a.kind::text as kind, a.summary, a.payload, a.requested_at,
           a.task_id, t.goal,
           tl.name as tool_name, tl.version as tool_version,
           tl.manifest as tool_manifest, tl.code as tool_code, tl.tests as tool_tests
      from agent.approvals a
      left join agent.tasks t on t.id = a.task_id
      left join agent.tools tl on tl.id = a.target_id and a.kind = 'tool_promotion'
     where a.status = 'pending'
     order by a.requested_at`;

  const tasks = await sql<TaskRow[]>`
    select id, goal, task_type, status::text as status, created_at
      from agent.tasks
     order by case when status in ('waiting_approval', 'running', 'queued') then 0 else 1 end,
              created_at desc
     limit 15`;

  const logs = await sql<LogRow[]>`
    select id::text as id, ts, actor, action, summary, outcome
      from agent.action_log
     order by id desc
     limit 15`;

  return (
    <main>
      <header className="top">
        <h1>비서</h1>
        <form action={setWorking}>
          <input type="hidden" name="enabled" value={working ? 'false' : 'true'} />
          <button
            className="switch"
            aria-pressed={working}
            title={working ? '누르면 비서가 하던 일을 멈춥니다' : '누르면 비서가 다시 일합니다'}
          >
            <span className="dot" aria-hidden />
            {working ? '업무 중' : '멈춤'}
          </button>
        </form>
      </header>

      <section aria-labelledby="pending-h">
        <div className="section-head">
          <h2 id="pending-h">
            결재 대기
            {pending.length > 0 && <span className="count">{pending.length}</span>}
          </h2>
        </div>

        {pending.length === 0 && (
          <p className="empty">결재할 것이 없습니다. 비서가 허락이 필요한 일에 닿으면 여기에 올라옵니다.</p>
        )}

        {pending.map((p) => (
          <article className="slip" key={p.id}>
            <div className="slip-meta">
              <span className="slip-kind">{KIND_LABEL[p.kind] ?? p.kind}</span>
              <time dateTime={new Date(p.requested_at).toISOString()}>{when(p.requested_at)}</time>
            </div>
            <p className="slip-summary">{p.summary}</p>
            {p.goal && p.task_id && (
              <p className="slip-task">
                업무: <Link href={`/tasks/${p.task_id}`}>{p.goal}</Link>
              </p>
            )}

            {p.tool_code && (
              <details>
                <summary>
                  도구 코드 보기 ({p.tool_name} v{p.tool_version})
                </summary>
                <pre>{JSON.stringify(p.tool_manifest, null, 2)}</pre>
                <pre>{p.tool_code}</pre>
                <pre>{p.tool_tests}</pre>
              </details>
            )}
            {hasContent(p.payload) && (
              <details>
                <summary>세부 내용 보기</summary>
                <pre>{JSON.stringify(p.payload, null, 2)}</pre>
              </details>
            )}

            <form className="decide" action={approveRequest}>
              <input type="hidden" name="id" value={p.id} />
              <input
                className="note"
                name="note"
                placeholder="메모 (반려할 때는 이유를 적어주세요)"
                aria-label="결재 메모"
              />
              <button className="btn-reject" formAction={rejectRequest}>
                반려
              </button>
              <button className="seal" aria-label="승인">
                승인
              </button>
            </form>
          </article>
        ))}
      </section>

      <section aria-labelledby="tasks-h">
        <div className="section-head">
          <h2 id="tasks-h">업무</h2>
          <Link href="/tasks/new">새 업무 맡기기</Link>
        </div>
        {tasks.length === 0 ? (
          <p className="empty">아직 맡긴 업무가 없습니다.</p>
        ) : (
          <ul className="rows">
            {tasks.map((t) => (
              <li key={t.id}>
                <div className="row-main">
                  <Link className="row-title" href={`/tasks/${t.id}`}>
                    {t.goal}
                  </Link>
                  <span className="row-sub">{when(t.created_at)}</span>
                </div>
                <span className="tag" data-status={t.status}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="log-h">
        <div className="section-head">
          <h2 id="log-h">최근 기록</h2>
        </div>
        {logs.length === 0 ? (
          <p className="empty">비서가 움직이면 모든 행동이 여기에 남습니다.</p>
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

      <form action={signOut} className="foot">
        <button className="btn-quiet">로그아웃</button>
      </form>
    </main>
  );
}
