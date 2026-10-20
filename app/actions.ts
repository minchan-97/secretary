'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { UUID_RE } from '@/lib/labels';

function readId(formData: FormData, key = 'id') {
  const id = String(formData.get(key) ?? '');
  if (!UUID_RE.test(id)) throw new Error('잘못된 식별자');
  return id;
}

function readNote(formData: FormData) {
  const note = String(formData.get('note') ?? '').trim();
  return note ? note.slice(0, 1000) : null;
}

async function decide(formData: FormData, approve: boolean) {
  await requireUser();
  const id = readId(formData);
  const note = readNote(formData);
  // 승인 결정은 DB 함수 하나로만 가능하고, 이 함수는 dashboard_ui 역할만 실행할 수 있다.
  await sql`select agent.decide_approval(${id}::uuid, ${approve}::boolean, ${note}::text)`;
  revalidatePath('/');
}

export async function approveRequest(formData: FormData) {
  await decide(formData, true);
}

export async function rejectRequest(formData: FormData) {
  await decide(formData, false);
}

export async function setWorking(formData: FormData) {
  await requireUser();
  const enabled = formData.get('enabled') === 'true';
  await sql`select agent.set_setting('agent_enabled', ${JSON.stringify(enabled)}::jsonb)`;
  revalidatePath('/');
}

export async function createTask(formData: FormData) {
  await requireUser();
  const taskType = String(formData.get('task_type') ?? '');
  const goal = String(formData.get('goal') ?? '').trim();
  const criteria = String(formData.get('success_criteria') ?? '').trim();
  const level = Number(formData.get('max_level'));

  let error: string | null = null;
  let newId: string | null = null;

  if (!taskType || !goal || !criteria) {
    error = '업무 종류, 목표, 완료 기준을 모두 적어주세요.';
  } else if (![0, 1, 2, 3].includes(level)) {
    error = '권한 수준을 골라주세요.';
  } else {
    try {
      const rows = await sql<{ id: string }[]>`
        insert into agent.tasks (task_type, goal, success_criteria, max_level, requested_by)
        values (${taskType}, ${goal}, ${criteria}, ${level}::smallint, 'user')
        returning id`;
      newId = rows[0].id;
    } catch (e) {
      // DB 트리거가 막은 이유(예: 업무 종류의 권한 상한 초과)를 그대로 보여준다
      error = e instanceof Error ? e.message : '업무를 만들지 못했습니다.';
    }
  }

  if (error || !newId) {
    redirect(`/tasks/new?error=${encodeURIComponent(error ?? '업무를 만들지 못했습니다.')}`);
  }
  revalidatePath('/');
  redirect(`/tasks/${newId}`);
}

export async function cancelTask(formData: FormData) {
  await requireUser();
  const id = readId(formData);
  await sql`
    update agent.tasks
       set status = 'cancelled', updated_at = now()
     where id = ${id}::uuid
       and status in ('queued', 'running', 'waiting_approval')`;
  revalidatePath('/');
  revalidatePath(`/tasks/${id}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
