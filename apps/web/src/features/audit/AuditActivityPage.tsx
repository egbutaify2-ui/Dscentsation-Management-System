import './AuditActivityPage.css';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../lib/api/client.js';

const PAGE_SIZE = 25;
const EMPTY_FILTERS: AuditFilters = {
  actorUserId: '',
  action: '',
  entityType: '',
  entityId: '',
  from: '',
  to: '',
};

interface AuditFilters {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  from: string;
  to: string;
}

interface AuditActor {
  id?: string;
  userId?: string;
  actorUserId?: string;
  displayName?: string | null;
  name?: string | null;
  label?: string | null;
}

interface AuditActivity {
  id?: string;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  actorName?: string | null;
  actor?: {
    id?: string | null;
    displayName?: string | null;
    name?: string | null;
  } | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt?: string | null;
  occurredAt?: string | null;
}

interface AuditResponse {
  items: AuditActivity[];
  actors: AuditActor[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The activity history could not be loaded.';
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

function readableLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function actorIdentifier(actor: AuditActor): string {
  return actor.id ?? actor.userId ?? actor.actorUserId ?? '';
}

function actorName(actor: AuditActor): string {
  return actor.displayName ?? actor.name ?? actor.label ?? '';
}

function activityActorLabel(entry: AuditActivity, actors: AuditActor[]): string {
  const id = entry.actorUserId ?? entry.actor?.id ?? null;
  const matchedActor = id ? actors.find((actor) => actorIdentifier(actor) === id) : undefined;
  const label =
    actorName(matchedActor ?? {}) ||
    entry.actorDisplayName ||
    entry.actorName ||
    entry.actor?.displayName ||
    entry.actor?.name;
  if (label?.trim()) return label;
  return id ? 'Employee' : 'System';
}

function dateBoundary(value: string, endOfDay: boolean): string {
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
  return new Date(value + 'T' + time + '+01:00').toISOString();
}

function activityPath(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.action.trim()) params.set('action', filters.action.trim());
  if (filters.entityType.trim()) params.set('entityType', filters.entityType.trim());
  if (filters.entityId.trim()) params.set('entityId', filters.entityId.trim());
  if (filters.from) params.set('from', dateBoundary(filters.from, false));
  if (filters.to) params.set('to', dateBoundary(filters.to, true));
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  return '/audit-logs?' + params.toString();
}

export function AuditActivityPage() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS);
  const [response, setResponse] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestedPage, setRequestedPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadActivity = useCallback(async (nextFilters: AuditFilters, page: number) => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setRequestedPage(page);
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<AuditResponse>(activityPath(nextFilters, page));
      if (requestSequence.current !== requestId) return;
      if (!result || !Array.isArray(result.items) || !Array.isArray(result.actors)) {
        throw new Error('The audit service returned an unexpected response.');
      }
      setResponse(result);
    } catch (loadError) {
      if (requestSequence.current === requestId) setError(errorMessage(loadError));
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity(EMPTY_FILTERS, 1);
  }, [loadActivity]);

  const actors = response?.actors ?? [];
  const actorOptions = useMemo(
    () =>
      actors
        .map((actor) => ({ id: actorIdentifier(actor), label: actorName(actor) }))
        .filter((actor) => actor.id && actor.label),
    [actors],
  );
  const actionOptions = useMemo(
    () => Array.from(new Set((response?.items ?? []).map((item) => item.action).filter(Boolean))),
    [response],
  );
  const entityTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (response?.items ?? [])
            .map((item) => item.entityType ?? '')
            .filter((value) => value.length > 0),
        ),
      ),
    [response],
  );

  function updateFilter<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (filters.from && filters.to && filters.from > filters.to) {
      setError('The start date must be on or before the end date.');
      return;
    }
    void loadActivity(filters, 1);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    void loadActivity(EMPTY_FILTERS, 1);
  }

  const currentPage = response?.page ?? requestedPage;
  const totalPages = response?.totalPages ?? 0;
  const total = response?.total ?? 0;

  return (
    <div className="audit-page">
      <div className="page-heading audit-page-heading">
        <div>
          <p className="eyebrow">GOVERNANCE &amp; COMPLIANCE</p>
          <h1>Activity history</h1>
          <p className="muted-copy">
            Review recorded changes across the workspace. This is a read-only view of the audit
            trail.
          </p>
        </div>
        <span className="audit-readonly-label">Read only</span>
      </div>

      <section className="audit-card" aria-labelledby="audit-filter-heading">
        <div className="audit-card-heading">
          <div>
            <p className="eyebrow">REFINE THE AUDIT TRAIL</p>
            <h2 id="audit-filter-heading">Filters</h2>
          </div>
          <span className="audit-timezone">All times · Africa/Lagos</span>
        </div>
        <form className="audit-filters" aria-label="Activity filters" onSubmit={submitFilters}>
          <label>
            Employee
            <select
              value={filters.actorUserId}
              onChange={(event) => updateFilter('actorUserId', event.target.value)}
            >
              <option value="">All employees and system</option>
              {actorOptions.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <input
              value={filters.action}
              onChange={(event) => updateFilter('action', event.target.value)}
              list="audit-action-options"
              placeholder="e.g. product.updated"
              autoComplete="off"
            />
            <datalist id="audit-action-options">
              {actionOptions.map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
          </label>
          <label>
            Record type
            <input
              value={filters.entityType}
              onChange={(event) => updateFilter('entityType', event.target.value)}
              list="audit-entity-options"
              placeholder="e.g. product"
              autoComplete="off"
            />
            <datalist id="audit-entity-options">
              {entityTypeOptions.map((entityType) => (
                <option key={entityType} value={entityType} />
              ))}
            </datalist>
          </label>
          <label className="audit-uuid-field">
            Record UUID
            <input
              value={filters.entityId}
              onChange={(event) => updateFilter('entityId', event.target.value)}
              placeholder="Search by record UUID"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            Start date
            <input
              type="date"
              value={filters.from}
              onChange={(event) => updateFilter('from', event.target.value)}
            />
          </label>
          <label>
            End date
            <input
              type="date"
              value={filters.to}
              onChange={(event) => updateFilter('to', event.target.value)}
            />
          </label>
          <div className="audit-filter-actions">
            <button className="primary-button audit-apply-button" type="submit" disabled={loading}>
              Apply filters
            </button>
            <button className="secondary-button" type="button" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="audit-card audit-results-card" aria-labelledby="audit-results-heading">
        <div className="audit-card-heading">
          <div>
            <p className="eyebrow">RECENT EVENTS</p>
            <h2 id="audit-results-heading">Activity log</h2>
          </div>
          <span className="audit-result-count">
            {loading ? 'Loading…' : total.toLocaleString('en-NG') + ' events'}
          </span>
        </div>

        {error && (
          <div className="audit-state audit-state-error" role="alert">
            <strong>We could not load activity history.</strong>
            <span>{error}</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadActivity(filters, requestedPage)}
              disabled={loading}
            >
              Try again
            </button>
          </div>
        )}

        {!error && loading && (
          <div className="audit-state" role="status">
            <span className="audit-loading-mark" aria-hidden="true" />
            <strong>Loading activity history…</strong>
            <span>Fetching the latest recorded events.</span>
          </div>
        )}

        {!error && !loading && response && response.items.length === 0 && (
          <div className="audit-state">
            <strong>No activity found</strong>
            <span>There are no audit events matching these filters.</span>
            <button className="text-button" type="button" onClick={resetFilters}>
              Clear filters
            </button>
          </div>
        )}

        {!error && !loading && response && response.items.length > 0 && (
          <>
            <div className="audit-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th scope="col">Employee / actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Record type</th>
                    <th scope="col">Record identifier</th>
                    <th scope="col">Date and time</th>
                  </tr>
                </thead>
                <tbody>
                  {response.items.map((item, index) => (
                    <tr key={item.id ?? item.entityId ?? String(index)}>
                      <td>
                        <span className="audit-actor">{activityActorLabel(item, actors)}</span>
                        <small>{item.actorUserId ? 'Employee' : 'System event source'}</small>
                      </td>
                      <td>
                        <span className="audit-action">{readableLabel(item.action)}</span>
                      </td>
                      <td>{readableLabel(item.entityType)}</td>
                      <td>
                        {item.entityId ? (
                          <code className="audit-record-id">{item.entityId}</code>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="audit-date-cell">
                        {formatDateTime(item.createdAt ?? item.occurredAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="audit-pagination">
              <span>
                Showing {response.items.length.toLocaleString('en-NG')} of{' '}
                {total.toLocaleString('en-NG')} events
              </span>
              <div className="audit-pagination-controls">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadActivity(filters, currentPage - 1)}
                  disabled={loading || currentPage <= 1}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <span>
                  Page {currentPage} of {Math.max(totalPages, 1)}
                </span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadActivity(filters, currentPage + 1)}
                  disabled={loading || currentPage >= totalPages}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
