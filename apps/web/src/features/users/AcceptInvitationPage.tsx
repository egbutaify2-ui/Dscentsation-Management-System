import { useState, type FormEvent } from 'react';
import { api, getCsrfToken } from '../../lib/api/client.js';

export function AcceptInvitationPage({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: () => Promise<void>;
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
      await api.post('/users/invitations/accept', { token, password }, await getCsrfToken());
      await onAccepted();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'The invitation could not be accepted.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="invitation-heading">
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
          <p className="eyebrow">EMPLOYEE ACCOUNT SETUP</p>
          <h1 id="invitation-heading">Set your password</h1>
          <p>Create your own password to activate your individual Dscentsation account.</p>
        </div>
        <form onSubmit={(event) => void submit(event)} className="login-form">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            name="new-password"
            autoComplete="new-password"
            minLength={12}
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <label htmlFor="confirm-password">Confirm password</label>
          <input
            id="confirm-password"
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
            {submitting ? 'Activating account…' : 'Set password and activate'}
          </button>
        </form>
        <p className="login-footnote">
          Invitation links are single-use and expire. Ask the Dscentsation Owner for a new
          invitation if this link has expired or been revoked.
        </p>
      </section>
    </main>
  );
}
