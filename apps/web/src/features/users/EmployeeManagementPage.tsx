import './EmployeeManagementPage.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

interface Employee {
  id: string;
  email: string;
  displayName: string;
  roleCode: 'MANAGER' | 'STAFF';
  roleName: string;
  status: 'active' | 'suspended' | 'disabled' | 'invited';
  createdAt: string;
  lastLoginAt: string | null;
}

interface InvitationResult {
  employee: Employee;
  setupUrl: string;
  expiresAt: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function dateLabel(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(new Date(value));
}

export function EmployeeManagementPage({ canManage }: { canManage: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'MANAGER' | 'STAFF'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Employee['status']>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MANAGER' | 'STAFF'>('STAFF');
  const [invitation, setInvitation] = useState<InvitationResult | null>(null);
  const [invitationMode, setInvitationMode] = useState<'created' | 'reissued'>('created');
  const [copied, setCopied] = useState(false);

  const loadEmployees = useCallback(
    async (
      query: string,
      roleValue: 'all' | 'MANAGER' | 'STAFF',
      statusValue: 'all' | Employee['status'],
    ) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (roleValue !== 'all') params.set('role', roleValue);
        if (statusValue !== 'all') params.set('status', statusValue);
        const path = `/users${params.size ? `?${params.toString()}` : ''}`;
        setEmployees(await api.get<Employee[]>(path));
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadEmployees('', 'all', 'all');
  }, [loadEmployees]);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadEmployees(search, roleFilter, statusFilter);
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    setInvitation(null);
    try {
      const result = await api.post<InvitationResult>(
        '/users/invitations',
        { displayName: displayName.trim(), email: email.trim(), role },
        await getCsrfToken(),
      );
      setInvitation(result);
      setInvitationMode('created');
      setCopied(false);
      setInviteOpen(false);
      setDisplayName('');
      setEmail('');
      setRole('STAFF');
      setNotice('Employee account created in invited status. No email was sent.');
      await loadEmployees(search, roleFilter, statusFilter);
    } catch (inviteError) {
      setError(errorMessage(inviteError));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(employee: Employee) {
    const nextStatus = employee.status === 'active' ? 'suspended' : 'active';
    const message =
      nextStatus === 'suspended'
        ? `Suspend ${employee.displayName}? All of their active sessions will be revoked immediately.`
        : `Reactivate ${employee.displayName}? They will need to sign in again.`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.patch(`/users/${employee.id}/status`, { status: nextStatus }, await getCsrfToken());
      setNotice(
        nextStatus === 'suspended'
          ? 'Employee suspended and active sessions revoked.'
          : 'Employee reactivated. Previous sessions remain revoked.',
      );
      await loadEmployees(search, roleFilter, statusFilter);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function revokeSessions(employee: Employee) {
    if (
      !window.confirm(
        `Revoke every active session for ${employee.displayName}? They will need to sign in again.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ sessionsRevoked: number }>(
        `/users/${employee.id}/sessions/revoke`,
        {},
        await getCsrfToken(),
      );
      setNotice(`${result.sessionsRevoked} active session(s) revoked for ${employee.displayName}.`);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function reissueInvitation(employee: Employee) {
    if (
      !window.confirm(
        `Reissue the setup invitation for ${employee.displayName}? The previous invitation link will stop working.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<InvitationResult>(
        `/users/${employee.id}/invitation/reissue`,
        {},
        await getCsrfToken(),
      );
      setInvitation(result);
      setInvitationMode('reissued');
      setCopied(false);
      setInviteOpen(false);
      setNotice(
        'Replacement invitation created. No email was sent; deliver the new link manually using ' +
          'the official Dscentsation company email identity.',
      );
      await loadEmployees(search, roleFilter, statusFilter);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvitation(employee: Employee) {
    if (
      !window.confirm(
        `Revoke the pending setup invitation for ${employee.displayName}? The current link will stop working.`,
      )
    )
      return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/users/${employee.id}/invitation/revoke`, {}, await getCsrfToken());
      setNotice('Pending invitation revoked.');
      await loadEmployees(search, roleFilter, statusFilter);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  async function copyInvitationLink() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.setupUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setNotice('Clipboard access is unavailable. Select and copy the invitation link below.');
    }
  }

  return (
    <div className="employee-page">
      <div className="page-heading employee-page-heading">
        <div>
          <p className="eyebrow">ACCOUNT ADMINISTRATION</p>
          <h1>Employees</h1>
          <p className="muted-copy">
            Manage individual Manager and Staff accounts. Invitations are delivered manually using
            the official Dscentsation company email identity.
          </p>
        </div>
        {canManage && (
          <button
            className="primary-button employee-primary-action"
            onClick={() => {
              setInvitation(null);
              setInvitationMode('created');
              setError(null);
              setInviteOpen((open) => !open);
            }}
          >
            {inviteOpen ? 'Close invitation' : 'Invite employee'}
          </button>
        )}
      </div>

      {error && (
        <p className="employee-alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="employee-alert success" role="status">
          {notice}
        </p>
      )}

      {invitation && (
        <section
          className="employee-card invitation-result"
          aria-labelledby="invitation-created-title"
        >
          <div>
            <p className="eyebrow">ONE-TIME SETUP LINK</p>
            <h2 id="invitation-created-title">
              {invitationMode === 'reissued'
                ? 'Invitation link reissued for'
                : 'Invitation created for'}{' '}
              {invitation.employee.displayName}
            </h2>
            <p>
              This link is shown only in this successful response. Deliver it securely from the
              official Dscentsation company email identity. DMS does not send invitations
              automatically.
            </p>
            <p className="employee-expiry">Expires: {dateLabel(invitation.expiresAt)}</p>
          </div>
          <label className="employee-link-field">
            Invitation URL
            <input
              aria-label="One-time invitation URL"
              readOnly
              value={invitation.setupUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void copyInvitationLink()}
          >
            {copied ? 'Copied' : 'Copy invitation link'}
          </button>
          <p className="employee-warning">
            Treat this URL like a password. Do not put it in chat groups, issue trackers or logs.
          </p>
        </section>
      )}

      {inviteOpen && canManage && (
        <section
          className="employee-card employee-invite-card"
          aria-labelledby="invite-employee-title"
        >
          <div className="employee-card-heading">
            <div>
              <p className="eyebrow">NEW ACCOUNT</p>
              <h2 id="invite-employee-title">Invite a Manager or Staff member</h2>
            </div>
          </div>
          <form className="employee-form" onSubmit={(event) => void submitInvitation(event)}>
            <div className="employee-form-grid">
              <label>
                Employee name
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                Company email address
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={254}
                />
              </label>
              <label>
                Employee role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as 'MANAGER' | 'STAFF')}
                >
                  <option value="STAFF">Staff</option>
                  <option value="MANAGER">Manager</option>
                </select>
              </label>
            </div>
            <p className="employee-hint">
              The employee sets their own password using the secure, single-use link. Expiry
              defaults to 24 hours. Send the link manually from the official company email identity.
            </p>
            <div className="employee-form-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create invitation'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="employee-card" aria-labelledby="employee-directory-title">
        <div className="employee-card-heading">
          <div>
            <p className="eyebrow">TEAM ACCOUNTS</p>
            <h2 id="employee-directory-title">Employee directory</h2>
          </div>
          <span className="record-count">{employees.length} records</span>
        </div>
        <form className="employee-filters" onSubmit={(event) => void submitSearch(event)}>
          <label>
            Search name or email
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder="Search employees"
            />
          </label>
          <label>
            Role
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
            >
              <option value="all">All roles</option>
              <option value="MANAGER">Manager</option>
              <option value="STAFF">Staff</option>
            </select>
          </label>
          <label>
            Account status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="suspended">Suspended</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <button className="search-button" type="submit">
            Apply filters
          </button>
        </form>

        {loading ? (
          <div className="employee-state" role="status">
            Loading employee accounts…
          </div>
        ) : employees.length === 0 ? (
          <div className="employee-state">
            <strong>No employee accounts found</strong>
            <span>Try another search or filter, or invite the first employee.</span>
          </div>
        ) : (
          <div className="employee-table-wrap">
            <table className="employee-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last login</th>
                  {canManage && <th>Account actions</th>}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>
                      <strong>{employee.displayName}</strong>
                      <small>{employee.email}</small>
                    </td>
                    <td>{employee.roleName}</td>
                    <td>
                      <span className={`employee-status ${employee.status}`}>
                        {employee.status}
                      </span>
                    </td>
                    <td>{dateLabel(employee.createdAt)}</td>
                    <td>{dateLabel(employee.lastLoginAt)}</td>
                    {canManage && (
                      <td>
                        <div className="employee-actions">
                          {employee.status === 'active' && (
                            <button
                              type="button"
                              className="table-link-button"
                              disabled={saving}
                              onClick={() => void updateStatus(employee)}
                            >
                              Suspend
                            </button>
                          )}
                          {employee.status === 'suspended' && (
                            <button
                              type="button"
                              className="table-link-button"
                              disabled={saving}
                              onClick={() => void updateStatus(employee)}
                            >
                              Reactivate
                            </button>
                          )}
                          {employee.status === 'invited' && (
                            <>
                              <button
                                type="button"
                                className="table-link-button"
                                disabled={saving}
                                onClick={() => void reissueInvitation(employee)}
                              >
                                Reissue invitation
                              </button>
                              <button
                                type="button"
                                className="table-link-button danger-link"
                                disabled={saving}
                                onClick={() => void revokeInvitation(employee)}
                              >
                                Revoke invite
                              </button>
                            </>
                          )}
                          {employee.status !== 'invited' && (
                            <button
                              type="button"
                              className="table-link-button"
                              disabled={saving}
                              onClick={() => void revokeSessions(employee)}
                            >
                              Revoke sessions
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
