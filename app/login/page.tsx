'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const validationMessage = 'Wpisz email i hasło';

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!supabase) {
      setError('Brak konfiguracji Supabase (sprawdź env).');
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail === '' || password === '') {
      setError(validationMessage);
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push('/debug-db');
  };

  const handleSignUp = async () => {
    setError(null);
    setStatus(null);

    if (!supabase) {
      setError('Brak konfiguracji Supabase (sprawdź env).');
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail === '' || password === '') {
      setError(validationMessage);
      return;
    }

    setLoading(true);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (signUpData.session) {
      router.push('/debug-db');
      return;
    }

    setStatus(
      'Sprawdź email i potwierdź konto, potem zaloguj się',
    );
  };

  return (
    <main style={{ padding: '2rem', display: 'grid', gap: '1rem', maxWidth: 420 }}>
      <h1>Logowanie</h1>
      <form
        onSubmit={handleSignIn}
        style={{ display: 'grid', gap: '0.75rem' }}
      >
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          Hasło
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="submit" disabled={loading}>
            Zaloguj
          </button>
          <button type="button" onClick={handleSignUp} disabled={loading}>
            Utwórz konto
          </button>
        </div>
      </form>
      {status && <p style={{ color: 'green' }}>{status}</p>}
      {error && (
        <p style={{ color: 'crimson' }}>
          <strong>Błąd:</strong> {error}
        </p>
      )}
    </main>
  );
}
