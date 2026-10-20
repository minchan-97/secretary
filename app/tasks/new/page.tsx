import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { LEVEL_LABEL } from '@/lib/labels';
import { createTask } from '../../actions';

export const dynamic = 'force-dynamic';

type TaskType = { name: string; description: string; max_level: number };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;

  const types = await sql<TaskType[]>`
    select name, description, max_level
      from agent.task_types
     where enabled
     order by name`;

  return (
    <main>
      <header className="top">
        <Link className="back" href="/">
          돌아가기
        </Link>
      </header>

      <h1 className="prose" style={{ fontSize: '1.5rem', fontWeight: 700 }}>
        새 업무 맡기기
      </h1>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {types.length === 0 ? (
        <p className="empty">켜진 업무 종류가 없습니다. 업무 종류를 먼저 켜야 일을 맡길 수 있습니다.</p>
      ) : (
        <form action={createTask}>
          <label className="field">
            <span>업무 종류</span>
            <select name="task_type" required defaultValue={types[0].name}>
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.description} (최대 권한 {t.max_level})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>목표</span>
            <textarea
              name="goal"
              required
              placeholder="예: 내 연구와 맞는 교육공학·인접 분야 대학원 연구실 후보를 넓게 찾아줘"
            />
          </label>

          <label className="field">
            <span>완료 기준</span>
            <textarea
              name="success_criteria"
              required
              placeholder="예: 교수 후보 3명 이내, 각 후보의 맞는 이유와 안 맞을 이유, 출처 링크"
            />
            <small>비서는 이 기준을 채우면 보고하고 멈춥니다.</small>
          </label>

          <label className="field">
            <span>권한 수준</span>
            <select name="max_level" defaultValue="1">
              {[0, 1, 2, 3].map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
            <small>업무 종류의 최대 권한을 넘기면 저장되지 않습니다.</small>
          </label>

          <button className="btn-primary">업무 맡기기</button>
        </form>
      )}
    </main>
  );
}
