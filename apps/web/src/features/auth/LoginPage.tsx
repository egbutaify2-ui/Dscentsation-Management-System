import { useState, type FormEvent } from 'react';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  error?: string | null;
}

export function LoginPage({ onLogin, error = null }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await onLogin(email.trim(), password);
    } catch (submissionError) {
      setFormError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Sign-in failed. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const visibleError = formError ?? error;
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-heading">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            D
          </div>
          <div>
            <p className="brand-name">
              DSCENT<span>ATION</span>
            </p>
            <p className="brand-caption">MANAGEMENT SYSTEM</p>
          </div>
        </div>
        <div className="login-intro">
          <p className="eyebrow">INTERNAL WORKSPACE</p>
          <h1 id="login-heading">Welcome back</h1>
          <p>Sign in with your individual Dscentsation account.</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            required
            maxLength={254}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
          />
          {visibleError && (
            <p className="form-error" role="alert">
              {visibleError}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-footnote">
          Access is provisioned by an authorised administrator. Public registration is disabled.
        </p>
      </section>
    </main>
  );
}
