'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// 링크 대신 6자리 코드로 로그인한다.
// 폰에서 홈 화면 앱(PWA)으로 쓸 때, 메일 앱이 링크를 다른 브라우저로 열어
// 로그인이 풀리는 문제를 피하기 위해서다.
export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      setError('코드를 보내지 못했습니다. 등록된 이메일인지 확인해주세요.');
      return;
    }
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) {
      setError('코드가 맞지 않거나 만료됐습니다. 다시 받아주세요.');
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

      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <label className="field">
            <span>이메일</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={busy}>
            {busy ? '보내는 중' : '로그인 코드 받기'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <label className="field">
            <span>메일로 받은 6자리 코드</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <small>{email}로 보냈습니다.</small>
          </label>
          <button className="btn-primary" disabled={busy}>
            {busy ? '확인하는 중' : '로그인'}
          </button>{' '}
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setStep('email');
              setCode('');
            }}
          >
            이메일 다시 입력
          </button>
        </form>
      )}
    </main>
  );
}
