import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export function isAllowed(email: string | undefined | null) {
  const allowed = (process.env.ALLOWED_EMAIL ?? '').trim().toLowerCase();
  return !!allowed && !!email && email.toLowerCase() === allowed;
}

// 미들웨어와 별개로, 모든 페이지와 서버 액션에서 다시 확인한다.
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAllowed(user.email)) redirect('/login');
  return user;
}
