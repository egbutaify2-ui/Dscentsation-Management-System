import { useState, type FormEvent } from 'react';
import { api, getCsrfToken } from '../../lib/api/client.js';

export function AcceptPasswordResetPage({
  token,
  onResetComplete,
}: {
  token: string;
  onResetComplete: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('Use at least 12 characters for your password.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/users/password-resets/accept', { token, password }, await getCsrfToken());
      setPassword('');
      setConfirmation('');
      await onResetComplete();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'The password could not be reset. Request a new link from the Dscentsation Owner.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="password-reset-heading">
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
          <p className="eyebrow">EMPLOYEE ACCOUNT SECURITY</p>
          <h1 id="password-reset-heading">Reset your password</h1>
          <p>Choose a new password for your individual Dscentsation account.</p>
        </div>
        <form onSubmit={(event) => void submit(event)} className="login-form">
          <label htmlFor="reset-new-password">New password</label>
          <input
            id="reset-new-password"
            type="password"
            name="new-password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <label htmlFor="reset-confirm-password">Confirm new password</label>
          <input
            id="reset-confirm-password"
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Resetting password…' : 'Reset password'}
          </button>
        </form>
        <p className="login-footnote">
          This link can be used once and expires. After your password is changed, all existing
          sessions are revoked and you must sign in again. If the link has expired or been used,
          contact the Dscentsation Owner for a new one.
        </p>
      </section>
    </main>
  );
}
