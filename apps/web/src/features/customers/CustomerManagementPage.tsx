import './CustomerManagementPage.css';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

type CustomerStatus = 'active' | 'archived';
type CustomerStatusFilter = CustomerStatus | 'all';
type CustomerDialog = 'create' | 'edit' | null;

interface Customer {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: CustomerStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface CustomerPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface CustomerForm {
  fullName: string;
  phone: string;
  email: string;
  notes: string;
}

const PAGE_SIZE = 25;
const EMPTY_FORM: CustomerForm = { fullName: '', phone: '', email: '', notes: '' };
const EMPTY_META: CustomerPageMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'The customer request could not be completed. Please try again.';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

function customerListPath(query: string, status: CustomerStatusFilter, page: number): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  params.set('status', status);
  params.set('page', String(page));
  params.set('pageSize', String(PAGE_SIZE));
  return '/customers?' + params.toString();
}

function CustomerStatusLabel({ status }: { status: CustomerStatus }) {
  return <span className={'customer-status ' + status}>{status}</span>;
}

export function CustomerManagementPage({ permissions }: { permissions: string[] }) {
  const canCreate = permissions.includes('customers.create');
  const canUpdate = permissions.includes('customers.update');
  const canArchive = permissions.includes('customers.archive');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [meta, setMeta] = useState<CustomerPageMeta>(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>('active');
  const [appliedStatus, setAppliedStatus] = useState<CustomerStatusFilter>('active');

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<CustomerDialog>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<Customer | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadCustomers = useCallback(
    async (query: string, status: CustomerStatusFilter, page: number) => {
      const requestId = requestSequence.current + 1;
      requestSequence.current = requestId;
      setLoading(true);
      setListError(null);
      try {
        const result = await api.getPage<Customer[], CustomerPageMeta>(
          customerListPath(query, status, page),
        );
        if (requestSequence.current !== requestId) return;
        setCustomers(result.data);
        setMeta(result.meta);
      } catch (loadError) {
        if (requestSequence.current === requestId) {
          setListError(errorMessage(loadError));
        }
      } finally {
        if (requestSequence.current === requestId) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadCustomers('', 'active', 1);
  }, [loadCustomers]);

  async function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedSearch(search);
    setAppliedStatus(statusFilter);
    await loadCustomers(search, statusFilter, 1);
  }

  async function changeStatus(nextStatus: CustomerStatusFilter) {
    setStatusFilter(nextStatus);
    setAppliedSearch(search);
    setAppliedStatus(nextStatus);
    await loadCustomers(search, nextStatus, 1);
  }

  async function changePage(nextPage: number) {
    if (nextPage < 1 || (meta.totalPages > 0 && nextPage > meta.totalPages)) return;
    await loadCustomers(appliedSearch, appliedStatus, nextPage);
  }

  async function openCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setDetailLoading(true);
    setDetailError(null);
    setNotice(null);
    try {
      const current = await api.get<Customer>('/customers/' + customer.id);
      setSelectedCustomer(current);
    } catch (loadError) {
      setDetailError(errorMessage(loadError));
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialog('create');
    setNotice(null);
  }

  function openEditDialog() {
    if (!selectedCustomer) return;
    setForm({
      fullName: selectedCustomer.fullName,
      phone: selectedCustomer.phone ?? '',
      email: selectedCustomer.email ?? '',
      notes: selectedCustomer.notes ?? '',
    });
    setFormError(null);
    setDialog('edit');
  }

  function closeFormDialog() {
    if (saving) return;
    setDialog(null);
    setFormError(null);
  }

  function updateForm<K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    if (dialog === 'edit' && !selectedCustomer) return;

    const payload = {
      fullName: form.fullName.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
    };

    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const csrf = await getCsrfToken();
      const saved =
        dialog === 'create'
          ? await api.post<Customer>('/customers', payload, csrf)
          : await api.patch<Customer>('/customers/' + selectedCustomer!.id, payload, csrf);
      setSelectedCustomer(saved);
      setDialog(null);
      setForm(EMPTY_FORM);
      setNotice(dialog === 'create' ? 'Customer created.' : 'Customer details updated.');
      if (dialog === 'create') {
        setSearch('');
        setAppliedSearch('');
        setStatusFilter('active');
        setAppliedStatus('active');
        await loadCustomers('', 'active', 1);
      } else {
        await loadCustomers(appliedSearch, appliedStatus, meta.page);
      }
    } catch (saveError) {
      setFormError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  function requestArchive() {
    if (!selectedCustomer || selectedCustomer.status !== 'active' || !canArchive) return;
    setPendingArchive(selectedCustomer);
    setArchiveError(null);
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setSaving(true);
    setArchiveError(null);
    try {
      const archived = await api.post<Customer>(
        '/customers/' + pendingArchive.id + '/archive',
        {},
        await getCsrfToken(),
      );
      setSelectedCustomer(archived);
      setPendingArchive(null);
      setNotice('Customer archived. The record has been retained.');
      await loadCustomers(appliedSearch, appliedStatus, 1);
    } catch (archiveRequestError) {
      setArchiveError(errorMessage(archiveRequestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="customer-page">
      <div className="page-heading customer-page-heading">
        <div>
          <p className="eyebrow">CUSTOMER MANAGEMENT</p>
          <h1>Customers</h1>
          <p className="muted-copy">
            Maintain customer contact records and profile details. Customer records are retained
            when archived.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="primary-button customer-primary-action"
            onClick={openCreateDialog}
          >
            Add customer
          </button>
        )}
      </div>

      {notice && (
        <p className="customer-alert success" role="status">
          {notice}
        </p>
      )}

      {selectedCustomer ? (
        <section
          className="customer-card customer-detail"
          aria-labelledby="customer-detail-title"
          aria-label="Customer profile"
        >
          <div className="customer-detail-toolbar">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSelectedCustomer(null);
                setDetailError(null);
                setNotice(null);
              }}
            >
              ← Back to customers
            </button>
            <CustomerStatusLabel status={selectedCustomer.status} />
          </div>

          {detailError && (
            <div className="customer-error-row">
              <p className="customer-alert error" role="alert">
                {detailError}
              </p>
              <button
                type="button"
                className="customer-retry-button"
                onClick={() => void openCustomer(selectedCustomer)}
                disabled={detailLoading}
              >
                Retry
              </button>
            </div>
          )}

          {detailLoading ? (
            <div className="customer-state" role="status">
              Loading customer details…
            </div>
          ) : (
            <>
              <div className="customer-detail-heading">
                <div>
                  <p className="eyebrow">CUSTOMER RECORD</p>
                  <h2 id="customer-detail-title">{selectedCustomer.fullName}</h2>
                </div>
                <div className="customer-detail-actions">
                  {canUpdate && (
                    <button type="button" className="secondary-button" onClick={openEditDialog}>
                      Edit customer
                    </button>
                  )}
                  {canArchive && selectedCustomer.status === 'active' && (
                    <button type="button" className="danger-button" onClick={requestArchive}>
                      Archive customer
                    </button>
                  )}
                </div>
              </div>

              <dl className="customer-facts">
                <div>
                  <dt>Full name</dt>
                  <dd>{selectedCustomer.fullName}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{selectedCustomer.phone || '—'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selectedCustomer.email || '—'}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <CustomerStatusLabel status={selectedCustomer.status} />
                  </dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(selectedCustomer.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatDate(selectedCustomer.updatedAt)}</dd>
                </div>
                <div className="customer-notes-fact">
                  <dt>Notes</dt>
                  <dd>{selectedCustomer.notes || '—'}</dd>
                </div>
              </dl>
            </>
          )}
        </section>
      ) : (
        <section className="customer-card" aria-labelledby="customer-register-title">
          <div className="customer-card-heading">
            <div>
              <p className="eyebrow">CUSTOMER RECORDS</p>
              <h2 id="customer-register-title">Customer register</h2>
            </div>
            <span className="customer-record-count">
              {meta.total.toLocaleString('en-NG')} records
            </span>
          </div>

          <form
            className="customer-filters"
            aria-label="Customer search and filters"
            onSubmit={(event) => void applySearch(event)}
          >
            <label>
              Search customers
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, phone or email…"
                maxLength={100}
              />
            </label>
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(event) => void changeStatus(event.target.value as CustomerStatusFilter)}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All customers</option>
              </select>
            </label>
            <button
              type="submit"
              className="secondary-button customer-search-button"
              disabled={loading}
            >
              Search
            </button>
          </form>

          {listError ? (
            <div className="customer-error-row">
              <p className="customer-alert error" role="alert">
                {listError}
              </p>
              <button
                type="button"
                className="customer-retry-button"
                onClick={() => void loadCustomers(appliedSearch, appliedStatus, meta.page)}
                disabled={loading}
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="customer-state" role="status">
              Loading customers…
            </div>
          ) : customers.length === 0 ? (
            <div className="customer-state empty">
              <strong>No customers found</strong>
              <span>
                {appliedSearch.trim()
                  ? 'Try another search or change the status filter.'
                  : 'There are no customer records for this status filter.'}
              </span>
              {canCreate && (
                <button type="button" className="table-link-button" onClick={openCreateDialog}>
                  Add the first customer
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="customer-table-wrap">
                <table className="customer-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <tr key={customer.id}>
                        <td>
                          <strong>{customer.fullName}</strong>
                        </td>
                        <td>
                          <CustomerStatusLabel status={customer.status} />
                        </td>
                        <td>{formatDate(customer.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="table-link-button"
                            onClick={() => void openCustomer(customer)}
                            disabled={detailLoading}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="customer-pagination" aria-label="Customer pagination">
                <span>
                  Showing {customers.length.toLocaleString('en-NG')} of{' '}
                  {meta.total.toLocaleString('en-NG')} customers
                </span>
                <div className="customer-pagination-controls">
                  <span>
                    Page {meta.page} of {Math.max(meta.totalPages, 1)}
                  </span>
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
        <div className="customer-modal-backdrop">
          <section
            className="customer-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-form-title"
          >
            <div className="customer-modal-heading">
              <div>
                <p className="eyebrow">CUSTOMER RECORD</p>
                <h2 id="customer-form-title">
                  {dialog === 'create' ? 'Add a customer' : 'Edit customer'}
                </h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={closeFormDialog}
                aria-label="Close customer form"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="customer-record-form" onSubmit={(event) => void submitCustomer(event)}>
              <label htmlFor="customer-full-name">Full name</label>
              <input
                id="customer-full-name"
                name="fullName"
                required
                maxLength={160}
                autoComplete="name"
                value={form.fullName}
                onChange={(event) => updateForm('fullName', event.target.value)}
              />

              <label htmlFor="customer-phone">Phone</label>
              <input
                id="customer-phone"
                name="phone"
                type="tel"
                maxLength={40}
                autoComplete="tel"
                value={form.phone}
                onChange={(event) => updateForm('phone', event.target.value)}
              />

              <label htmlFor="customer-email">Email</label>
              <input
                id="customer-email"
                name="email"
                type="email"
                maxLength={254}
                autoComplete="email"
                value={form.email}
                onChange={(event) => updateForm('email', event.target.value)}
              />

              <label htmlFor="customer-notes">Notes</label>
              <textarea
                id="customer-notes"
                name="notes"
                maxLength={1000}
                rows={4}
                value={form.notes}
                onChange={(event) => updateForm('notes', event.target.value)}
              />

              {formError && (
                <p className="customer-alert error" role="alert">
                  {formError}
                </p>
              )}
              <div className="customer-modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeFormDialog}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : dialog === 'create' ? 'Create customer' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {pendingArchive && (
        <div className="customer-modal-backdrop">
          <section
            className="customer-modal customer-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-archive-title"
          >
            <div className="customer-modal-heading">
              <div>
                <p className="eyebrow">CUSTOMER STATUS</p>
                <h2 id="customer-archive-title">Archive customer?</h2>
              </div>
            </div>
            <p>
              Archive <strong>{pendingArchive.fullName}</strong>? The customer record will be
              retained and will no longer appear in the active register.
            </p>
            {archiveError && (
              <p className="customer-alert error" role="alert">
                {archiveError}
              </p>
            )}
            <div className="customer-modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setPendingArchive(null)}
                disabled={saving}
              >
                Keep active
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void confirmArchive()}
                disabled={saving}
              >
                {saving ? 'Archiving…' : 'Confirm archive'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
