import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api/client.js';
import { useAuth } from '../auth/AuthProvider.js';
import type { AuthenticatedUser } from '../auth/AuthProvider.js';
import './DashboardPage.css';

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface AuditActivity {
  id: string;
  actorDisplayName: string;
  action: string;
  entityType: string | null;
  occurredAt: string;
}

interface AuditResponse {
  items: AuditActivity[];
}

type MetricKind = 'orders' | 'customers' | 'products';
type ResourceStatus = 'loading' | 'success' | 'restricted' | 'unavailable' | 'error';

interface MetricState {
  status: ResourceStatus;
  total?: number;
  message?: string;
}

interface ActivityState {
  status: 'loading' | 'success' | 'restricted' | 'error';
  items?: AuditActivity[];
  message?: string;
}

const METRICS: {
  kind: MetricKind;
  title: string;
  description: string;
  permission: string;
  icon: string;
}[] = [
  {
    kind: 'orders',
    title: 'Orders',
    description: 'All recorded orders',
    permission: 'orders.view',
    icon: 'O',
  },
  {
    kind: 'customers',
    title: 'Active customers',
    description: 'Customers with active status',
    permission: 'customers.view',
    icon: 'C',
  },
  {
    kind: 'products',
    title: 'Active products',
    description: 'Products currently available',
    permission: 'products.view',
    icon: 'P',
  },
];

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-NG');
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

function readableLabel(value: string | null): string {
  if (!value) return 'Workspace activity';
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function fetchMetricTotal(kind: Exclude<MetricKind, 'products'>): Promise<number> {
  const path =
    kind === 'orders' ? '/orders?page=1&pageSize=1' : '/customers?status=active&page=1&pageSize=1';
  const response = await api.getPage<unknown[], PaginationMeta>(path);
  const total = response.meta.total;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('The server did not return a valid total count.');
  }
  return total;
}

function MetricCard({
  kind,
  title,
  description,
  permission,
  icon,
  permissions,
}: {
  kind: MetricKind;
  title: string;
  description: string;
  permission: string;
  icon: string;
  permissions: string[];
}) {
  const allowed = permissions.includes(permission);
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<MetricState>({ status: 'loading' });

  useEffect(() => {
    let current = true;

    if (!allowed) {
      setState({ status: 'restricted' });
      return () => {
        current = false;
      };
    }

    if (kind === 'products') {
      // The existing product endpoint returns an unpaginated record list, not a count.
      // Do not download the full product dataset just to calculate a dashboard total.
      setState({
        status: 'unavailable',
        message: 'The product API does not currently expose server-side count metadata.',
      });
      return () => {
        current = false;
      };
    }

    setState({ status: 'loading' });
    void fetchMetricTotal(kind)
      .then((total) => {
        if (current) setState({ status: 'success', total });
      })
      .catch((error: unknown) => {
        if (current) {
          setState({
            status: 'error',
            message: errorMessage(error, 'This count could not be loaded.'),
          });
        }
      });

    return () => {
      current = false;
    };
  }, [allowed, kind, retryCount]);

  const value =
    state.status === 'success'
      ? formatCount(state.total ?? 0)
      : state.status === 'loading'
        ? '…'
        : state.status === 'restricted'
          ? 'No access'
          : state.status === 'unavailable'
            ? 'Unavailable'
            : '—';

  return (
    <article className="dashboard-metric-card" aria-labelledby={`dashboard-metric-${kind}`}>
      <div className="dashboard-metric-top">
        <span className={`dashboard-metric-icon dashboard-metric-icon-${kind}`} aria-hidden="true">
          {icon}
        </span>
        <span className={`dashboard-metric-indicator is-${state.status}`}>
          {state.status === 'success'
            ? 'Available'
            : state.status === 'loading'
              ? 'Loading'
              : state.status === 'restricted'
                ? 'Restricted'
                : state.status === 'unavailable'
                  ? 'Unavailable'
                  : 'Needs attention'}
        </span>
      </div>
      <div className="dashboard-metric-copy">
        <p id={`dashboard-metric-${kind}`} className="dashboard-metric-title">
          {title}
        </p>
        <p className="dashboard-metric-value" aria-live="polite">
          {value}
        </p>
        <p className="dashboard-metric-description">{description}</p>
      </div>

      {state.status === 'loading' && (
        <p className="dashboard-metric-note" role="status">
          Loading from the server…
        </p>
      )}
      {state.status === 'success' && (
        <p className="dashboard-metric-note">
          {state.total === 0 ? 'No matching records yet.' : 'Count supplied by the server.'}
        </p>
      )}
      {state.status === 'restricted' && (
        <p className="dashboard-metric-note">Your account does not have {permission} access.</p>
      )}
      {state.status === 'unavailable' && (
        <p className="dashboard-metric-note">{state.message}</p>
      )}
      {state.status === 'error' && (
        <div className="dashboard-metric-error" role="alert">
          <span>{state.message}</span>
          <button
            className="dashboard-retry-button"
            type="button"
            aria-label={`Retry ${title.toLowerCase()} count`}
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      )}
    </article>
  );
}

function RecentActivity({ permissions }: { permissions: string[] }) {
  const allowed = permissions.includes('users.view');
  const [retryCount, setRetryCount] = useState(0);
  const [state, setState] = useState<ActivityState>({ status: 'loading' });

  const retry = useCallback(() => setRetryCount((count) => count + 1), []);

  useEffect(() => {
    let current = true;
    if (!allowed) {
      setState({ status: 'restricted' });
      return () => {
        current = false;
      };
    }

    setState({ status: 'loading' });
    void api
      .get<AuditResponse>('/audit-logs?page=1&pageSize=5')
      .then((response) => {
        if (!response || !Array.isArray(response.items)) {
          throw new Error('The activity service returned an unexpected response.');
        }
        if (current) setState({ status: 'success', items: response.items });
      })
      .catch((error: unknown) => {
        if (current) {
          setState({
            status: 'error',
            message: errorMessage(error, 'Recent activity could not be loaded.'),
          });
        }
      });

    return () => {
      current = false;
    };
  }, [allowed, retryCount]);

  return (
    <section className="dashboard-activity-card" aria-labelledby="dashboard-activity-heading">
      <div className="dashboard-section-heading">
        <div>
          <p className="eyebrow">WORKSPACE TIMELINE</p>
          <h2 id="dashboard-activity-heading">Recent activity</h2>
        </div>
        <span className="dashboard-timezone">Africa/Lagos</span>
      </div>

      {state.status === 'restricted' && (
        <div className="dashboard-activity-state">
          <strong>Activity is restricted</strong>
          <span>Your account does not have users.view access.</span>
        </div>
      )}
      {state.status === 'loading' && (
        <div className="dashboard-activity-state" role="status">
          <span className="dashboard-loading-mark" aria-hidden="true" />
          <strong>Loading recent activity…</strong>
          <span>Checking the latest recorded workspace events.</span>
        </div>
      )}
      {state.status === 'error' && (
        <div className="dashboard-activity-state dashboard-activity-error" role="alert">
          <strong>Recent activity is unavailable</strong>
          <span>{state.message}</span>
          <button className="dashboard-retry-button" type="button" onClick={retry}>
            Retry activity
          </button>
        </div>
      )}
      {state.status === 'success' && state.items?.length === 0 && (
        <div className="dashboard-activity-state">
          <strong>No activity recorded yet</strong>
          <span>New workspace events will appear here when they are recorded.</span>
        </div>
      )}
      {state.status === 'success' && (state.items?.length ?? 0) > 0 && (
        <ol className="dashboard-activity-list">
          {state.items?.map((item) => (
            <li key={item.id} className="dashboard-activity-item">
              <span className="dashboard-activity-marker" aria-hidden="true" />
              <div className="dashboard-activity-content">
                <div className="dashboard-activity-event">
                  <strong>{readableLabel(item.action)}</strong>
                  <span>{item.actorDisplayName || 'System'}</span>
                </div>
                <p>{readableLabel(item.entityType)}</p>
                <time dateTime={item.occurredAt}>{formatTimestamp(item.occurredAt)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function DashboardPage({ user }: { user: AuthenticatedUser }) {
  const { permissions } = useAuth();
  const firstName = user.displayName.trim().split(/\s+/)[0] || 'there';

  return (
    <div className="dashboard-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Welcome back, {firstName}</h1>
          <p className="muted-copy">
            A clear view of the records and activity available to your account.
          </p>
        </div>
        <span className="dashboard-overview-label">
          <span className="dashboard-live-dot" />
          Workspace overview
        </span>
      </header>

      <section className="dashboard-metrics" aria-label="Operational summary">
        {METRICS.map((metric) => (
          <MetricCard key={metric.kind} {...metric} permissions={permissions} />
        ))}
      </section>

      <RecentActivity permissions={permissions} />
      <footer className="dashboard-footer">
        Operational counts are provided by the server. Restricted or unavailable data is never
        displayed as zero.
      </footer>
    </div>
  );
}
