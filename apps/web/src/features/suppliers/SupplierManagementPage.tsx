import './SupplierManagementPage.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

type SupplierStatus = 'active' | 'inactive';
type SupplierStatusFilter = SupplierStatus | 'all';

interface Supplier {
  id: string;
  supplierCode: string;
  displayName: string;
  status: SupplierStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface SupplierPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SupplierForm {
  displayName: string;
}

const PAGE_SIZE = 25;
const emptyForm: SupplierForm = { displayName: '' };
const emptyMeta: SupplierPageMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 };

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SupplierStatusLabel({ status }: { status: SupplierStatus }) {
  return <span className={`status-label ${status === 'active' ? 'active' : 'inactive'}`}>{status}</span>;
}

export function SupplierManagementPage({ permissions }: { permissions: string[] }) {
  const canCreate = permissions.includes('suppliers.create');
  const canUpdate = permissions.includes('suppliers.update');
  const canManageStatus = permissions.includes('suppliers.manage_status');

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [meta, setMeta] = useState<SupplierPageMeta>(emptyMeta);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SupplierStatusFilter>('active');
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [duplicateMatches, setDuplicateMatches] = useState<Supplier[] | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<Supplier | null>(null);

  const loadSuppliers = useCallback(
    async (query: string, filter: SupplierStatusFilter, nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        params.set('status', filter);
        params.set('page', String(nextPage));
        params.set('pageSize', String(PAGE_SIZE));
        const result = await api.getPage<Supplier[], SupplierPageMeta>(
          `/suppliers?${params.toString()}`,
        );
        setSuppliers(result.data);
        setMeta(result.meta);
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadSuppliers('', 'active', 1);
  }, [loadSuppliers]);

  function openCreateSupplier() {
    setForm(emptyForm);
    setDuplicateMatches(null);
    setDialog('create');
    setError(null);
    setNotice(null);
  }

  function openEditSupplier(supplier: Supplier) {
    setForm({ displayName: supplier.displayName });
    setDuplicateMatches(null);
    setDialog('edit');
    setError(null);
    setNotice(null);
  }

  async function openSupplier(supplier: Supplier) {
    setSelectedSupplier(supplier);
    setDetailLoading(true);
    setDetailError(null);
    setError(null);
    try {
      setSelectedSupplier(await api.get<Supplier>(`/suppliers/${supplier.id}`));
    } catch (loadError) {
      setDetailError(getErrorMessage(loadError));
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;

    const displayName = form.displayName.trim();
    if (!displayName) {
      setError('Enter a supplier business name.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (dialog === 'create' && duplicateMatches === null) {
        const matches = await api.get<Supplier[]>(
          `/suppliers/duplicate-check?name=${encodeURIComponent(displayName)}`,
        );
        if (matches.length > 0) {
          setDuplicateMatches(matches);
          return;
        }
      }

      const csrf = await getCsrfToken();
      const saved =
        dialog === 'create'
          ? await api.post<Supplier>('/suppliers', { displayName }, csrf)
          : selectedSupplier
            ? await api.patch<Supplier>(
                `/suppliers/${selectedSupplier.id}`,
                { displayName },
                csrf,
              )
            : null;

      if (!saved) return;
      setSelectedSupplier(saved);
      setDialog(null);
      setDuplicateMatches(null);
      setNotice(dialog === 'create' ? 'Supplier created successfully.' : 'Supplier name updated.');
      await loadSuppliers(search, statusFilter, 1);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeSupplierStatus(supplier: Supplier, nextStatus: SupplierStatus) {
    setSaving(true);
    setError(null);
    try {
      const action = nextStatus === 'active' ? 'activate' : 'deactivate';
      await api.postEmpty(`/suppliers/${supplier.id}/${action}`, await getCsrfToken());
      const updated = await api.get<Supplier>(`/suppliers/${supplier.id}`);
      setSelectedSupplier(updated);
      setPendingDeactivation(null);
      setNotice(nextStatus === 'active' ? 'Supplier activated.' : 'Supplier deactivated.');
      await loadSuppliers(search, statusFilter, meta.page);
    } catch (statusError) {
      setError(getErrorMessage(statusError));
    } finally {
      setSaving(false);
    }
  }

  function requestStatusChange(supplier: Supplier) {
    if (supplier.status === 'active') {
      setPendingDeactivation(supplier);
      return;
    }
    void changeSupplierStatus(supplier, 'active');
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadSuppliers(search, statusFilter, 1);
  }

  async function changeStatusFilter(nextFilter: SupplierStatusFilter) {
    setStatusFilter(nextFilter);
    await loadSuppliers(search, nextFilter, 1);
  }

  async function changePage(nextPage: number) {
    if (nextPage < 1 || (meta.totalPages > 0 && nextPage > meta.totalPages)) return;
    await loadSuppliers(search, statusFilter, nextPage);
  }

  return (
    <div className="supplier-page">
      <div className="page-heading supplier-page-heading">
        <div>
          <p className="eyebrow">SUPPLIER MANAGEMENT</p>
          <h1>Suppliers</h1>
          <p className="muted-copy">
            Maintain the business names used in Dscentsation purchasing records. Supplier
            references are generated by the system and remain unchanged when a name is edited.
          </p>
        </div>
        <div className="supplier-heading-actions">
          <span className="module-status-pill">Internal records</span>
          {canCreate && (
            <button
              type="button"
              className="primary-button supplier-action-button"
              onClick={openCreateSupplier}
            >
              Add supplier
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="supplier-error-row">
          <p className="supplier-alert error" role="alert">
            {error}
          </p>
          <button
            type="button"
            className="supplier-retry-button"
            onClick={() => void loadSuppliers(search, statusFilter, meta.page)}
            disabled={loading}
          >
            Retry
          </button>
        </div>
      )}
      {notice && (
        <p className="supplier-alert success" role="status">
          {notice}
        </p>
      )}

      {selectedSupplier ? (
        <section className="supplier-card supplier-detail" aria-labelledby="supplier-detail-title">
          <div className="supplier-detail-toolbar">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSelectedSupplier(null);
                setDetailError(null);
                setError(null);
              }}
            >
              ← Back to suppliers
            </button>
            <SupplierStatusLabel status={selectedSupplier.status} />
          </div>

          {detailError && (
            <div className="supplier-error-row">
              <p className="supplier-alert error" role="alert">
                {detailError}
              </p>
              <button
                type="button"
                className="supplier-retry-button"
                onClick={() => void openSupplier(selectedSupplier)}
                disabled={detailLoading}
              >
                Retry
              </button>
            </div>
          )}
          {detailLoading ? (
            <div className="supplier-state" role="status">Loading supplier details…</div>
          ) : (
            <>
              <div className="supplier-detail-heading">
                <div>
                  <p className="eyebrow">SUPPLIER RECORD</p>
                  <h2 id="supplier-detail-title">{selectedSupplier.displayName}</h2>
                  <p className="supplier-reference">{selectedSupplier.supplierCode}</p>
                </div>
                <div className="supplier-detail-actions">
                  {canUpdate && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openEditSupplier(selectedSupplier)}
                    >
                      Edit name
                    </button>
                  )}
                  {canManageStatus && (
                    <button
                      type="button"
                      className={
                        selectedSupplier.status === 'active'
                          ? 'danger-button'
                          : 'secondary-button'
                      }
                      disabled={saving}
                      onClick={() => requestStatusChange(selectedSupplier)}
                    >
                      {selectedSupplier.status === 'active'
                        ? 'Deactivate supplier'
                        : 'Activate supplier'}
                    </button>
                  )}
                </div>
              </div>

              <dl className="supplier-facts">
                <div>
                  <dt>Supplier reference</dt>
                  <dd>{selectedSupplier.supplierCode}</dd>
                </div>
                <div>
                  <dt>Business name</dt>
                  <dd>{selectedSupplier.displayName}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd><SupplierStatusLabel status={selectedSupplier.status} /></dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(selectedSupplier.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatDate(selectedSupplier.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Created by (user ID)</dt>
                  <dd className="supplier-id-value">{selectedSupplier.createdBy}</dd>
                </div>
                <div>
                  <dt>Updated by (user ID)</dt>
                  <dd className="supplier-id-value">{selectedSupplier.updatedBy}</dd>
                </div>
              </dl>
            </>
          )}
        </section>
      ) : (
        <section className="supplier-card" aria-labelledby="supplier-list-title">
          <div className="supplier-card-heading">
            <div>
              <p className="eyebrow">BUSINESS RECORDS</p>
              <h2 id="supplier-list-title">Supplier directory</h2>
            </div>
            <span className="record-count">{meta.total.toLocaleString('en-NG')} records</span>
          </div>

          <form className="supplier-search" onSubmit={(event) => void handleSearch(event)}>
            <label className="supplier-search-control">
              <span>Search by supplier business name</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search suppliers…"
                maxLength={100}
              />
            </label>
            <label className="supplier-filter-control">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  void changeStatusFilter(event.target.value as SupplierStatusFilter)
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All suppliers</option>
              </select>
            </label>
            <button className="secondary-button supplier-search-button" type="submit">
              Search
            </button>
          </form>

          {loading ? (
            <div className="supplier-state" role="status">Loading suppliers…</div>
          ) : suppliers.length === 0 ? (
            <div className="supplier-state empty">
              <strong>No suppliers found</strong>
              <span>
                {search.trim()
                  ? 'Try another business name or change the status filter.'
                  : 'No supplier records match this status filter.'}
              </span>
              {canCreate && (
                <button type="button" className="table-link-button" onClick={openCreateSupplier}>
                  Add the first supplier
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="supplier-table-wrap">
                <table className="supplier-table">
                  <thead>
                    <tr>
                      <th>Supplier reference</th>
                      <th>Business name</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id}>
                        <td className="supplier-code-cell">{supplier.supplierCode}</td>
                        <td><strong>{supplier.displayName}</strong></td>
                        <td><SupplierStatusLabel status={supplier.status} /></td>
                        <td>{formatDate(supplier.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="table-link-button"
                            disabled={detailLoading}
                            onClick={() => void openSupplier(supplier)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="supplier-pagination" aria-label="Supplier pagination">
                <span>
                  Page {meta.page} of {Math.max(meta.totalPages, 1)}
                </span>
                <div>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loading || meta.page <= 1}
                    onClick={() => void changePage(meta.page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={loading || meta.totalPages === 0 || meta.page >= meta.totalPages}
                    onClick={() => void changePage(meta.page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {dialog && (
        <div className="supplier-modal-backdrop">
          <section
            className="supplier-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-form-title"
          >
            <div className="supplier-modal-heading">
              <div>
                <p className="eyebrow">SUPPLIER DIRECTORY</p>
                <h2 id="supplier-form-title">
                  {dialog === 'create' ? 'Add a supplier' : 'Edit supplier name'}
                </h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => {
                  setDialog(null);
                  setDuplicateMatches(null);
                }}
                aria-label="Close supplier form"
              >
                ×
              </button>
            </div>

            <form className="supplier-record-form" onSubmit={(event) => void submitSupplier(event)}>
              <label htmlFor="supplier-business-name">Business name</label>
              <input
                id="supplier-business-name"
                required
                minLength={1}
                maxLength={200}
                autoComplete="organization"
                value={form.displayName}
                onChange={(event) => {
                  setForm({ displayName: event.target.value });
                  setDuplicateMatches(null);
                }}
              />
              <p className="supplier-field-help">
                Enter the registered or commonly used business name. No contact or financial
                details are collected in this directory.
              </p>

              {duplicateMatches && (
                <div className="supplier-duplicate-warning" role="status" aria-live="polite">
                  <strong>Possible matching suppliers found</strong>
                  <p>
                    Review these records before continuing. Similar names are advisory only; a
                    separate supplier can still be created when appropriate.
                  </p>
                  <ul>
                    {duplicateMatches.map((match) => (
                      <li key={match.id}>
                        <span>{match.displayName}</span>
                        <small>{match.supplierCode} · {match.status}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && (
                <p className="supplier-alert error" role="alert">
                  {error}
                </p>
              )}
              <div className="supplier-modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setDialog(null);
                    setDuplicateMatches(null);
                  }}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving
                    ? 'Saving…'
                    : dialog === 'edit'
                      ? 'Save changes'
                      : duplicateMatches
                        ? 'Create supplier anyway'
                        : 'Check for possible matches'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {pendingDeactivation && (
        <div className="supplier-modal-backdrop">
          <section
            className="supplier-modal supplier-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-deactivate-title"
          >
            <div className="supplier-modal-heading">
              <div>
                <p className="eyebrow">SUPPLIER STATUS</p>
                <h2 id="supplier-deactivate-title">Deactivate supplier?</h2>
              </div>
            </div>
            <p>
              Deactivate <strong>{pendingDeactivation.displayName}</strong> ({pendingDeactivation.supplierCode})?
              The supplier record will be retained and can be reactivated later.
            </p>
            {error && (
              <p className="supplier-alert error" role="alert">
                {error}
              </p>
            )}
            <div className="supplier-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPendingDeactivation(null)}
                disabled={saving}
              >
                Keep active
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={saving}
                onClick={() =>
                  void changeSupplierStatus(pendingDeactivation, 'inactive')
                }
              >
                {saving ? 'Deactivating…' : 'Confirm deactivation'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
