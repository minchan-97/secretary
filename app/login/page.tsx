'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      setError(`로그인하지 못했습니다: ${error.message}`);
      return;
    }
    router.replace('/');
    router.refresh();
  }

  return (

    <main>
      <header className="top">
        <h1>비서</h1>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <form onSubmit={signIn}>
        <label className="field">
          <span>이메일</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="btn-primary" disabled={busy}>
          {busy ? '확인하는 중' : '로그인'}
        </button>
      </form>
    </main>
  );
}
