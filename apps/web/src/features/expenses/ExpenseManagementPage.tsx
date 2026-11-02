// Expense register and draft category management workspace.
import './ExpenseManagementPage.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ExpenseRevision {
  id: string;
  expenseId: string;
  revisionNumber: number;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  description: string;
  amountMinor: string;
  currency: string;
  incurredOn: string;
  payeeName: string;
  createdBy: string;
  createdAt: string;
}

interface ExpenseRecord {
  id: string;
  status: 'draft';
  currentRevision: ExpenseRevision;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ExpenseForm {
  categoryId: string;
  description: string;
  amount: string;
  incurredOn: string;
  payeeName: string;
}

interface CategoryForm {
  code: string;
  name: string;
  description: string;
}

type WorkspaceSection = 'expenses' | 'categories';

const emptyExpenseForm: ExpenseForm = {
  categoryId: '',
  description: '',
  amount: '',
  incurredOn: '',
  payeeName: '',
};

const emptyCategoryForm: CategoryForm = { code: '', name: '', description: '' };

function formatNaira(amountMinor: string): string {
  try {
    const amount = BigInt(amountMinor);
    const whole = amount / 100n;
    const fraction = (amount % 100n).toString().padStart(2, '0');
    return '₦' + whole.toLocaleString('en-NG') + '.' + fraction;
  } catch {
    return '₦0.00';
  }
}

function nairaToKobo(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Enter a valid NGN amount with no more than two decimal places.');
  }
  const parts = normalized.split('.');
  const whole = BigInt(parts[0] || '0');
  const fraction = BigInt(((parts[1] || '') + '00').slice(0, 2));
  const minor = whole * 100n + fraction;
  if (minor <= 0n) throw new Error('The expense amount must be greater than zero.');
  return minor.toString();
}

function koboToNairaInput(amountMinor: string): string {
  const amount = BigInt(amountMinor);
  return (amount / 100n).toString() + '.' + (amount % 100n).toString().padStart(2, '0');
}

function formatDate(value: string): string {
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export function ExpenseManagementPage({ permissions }: { permissions: string[] }) {
  const canViewExpenses = permissions.includes('expenses.view');
  const canCreateExpense = permissions.includes('expenses.create');
  const canUpdateExpense = permissions.includes('expenses.update');
  const canViewCategories = permissions.includes('expense_categories.view');
  const canManageCategories = permissions.includes('expense_categories.manage');

  const [section, setSection] = useState<WorkspaceSection>(
    canViewExpenses ? 'expenses' : 'categories',
  );
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryStatus, setCategoryStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [loadingExpenses, setLoadingExpenses] = useState(canViewExpenses);
  const [loadingCategories, setLoadingCategories] = useState(canViewCategories);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);
  const [revisions, setRevisions] = useState<ExpenseRevision[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expenseDialog, setExpenseDialog] = useState<'create' | 'edit' | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>(emptyExpenseForm);
  const [categoryDialog, setCategoryDialog] = useState<'create' | 'edit' | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm);

  const loadExpenses = useCallback(async (query: string, categoryId: string) => {
    if (!canViewExpenses) return;
    setLoadingExpenses(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (categoryId) params.set('categoryId', categoryId);
      params.set('pageSize', '100');
      const response = await api.get<Page<ExpenseRecord>>(
        '/expenses?' + params.toString(),
      );
      setExpenses(response.items);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingExpenses(false);
    }
  }, [canViewExpenses]);

  const loadCategories = useCallback(async (
    query: string,
    status: 'all' | 'active' | 'inactive',
  ) => {
    if (!canViewCategories) return;
    setLoadingCategories(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      params.set('status', status);
      params.set('pageSize', '100');
      const response = await api.get<Page<ExpenseCategory>>(
        '/expense-categories?' + params.toString(),
      );
      setCategories(response.items);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoadingCategories(false);
    }
  }, [canViewCategories]);

  useEffect(() => {
    if (canViewExpenses) void loadExpenses('', '');
    if (canViewCategories) void loadCategories('', 'all');
  }, [canViewExpenses, canViewCategories, loadExpenses, loadCategories]);

  async function submitExpenseSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadExpenses(expenseSearch, expenseCategoryFilter);
  }

  async function submitCategorySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadCategories(categorySearch, categoryStatus);
  }

  async function openExpenseDetails(expenseId: string) {
    setSelectedExpense(null);
    setRevisions([]);
    setLoadingDetail(true);
    setError(null);
    try {
      const [expense, history] = await Promise.all([
        api.get<ExpenseRecord>('/expenses/' + expenseId),
        api.get<ExpenseRevision[]>('/expenses/' + expenseId + '/revisions'),
      ]);
      setSelectedExpense(expense);
      setRevisions(history);
    } catch (detailError) {
      setError(getErrorMessage(detailError));
    } finally {
      setLoadingDetail(false);
    }
  }

  function openCreateExpense() {
    setExpenseForm({
      ...emptyExpenseForm,
      categoryId: categories.find((category) => category.isActive)?.id ?? '',
    });
    setExpenseDialog('create');
    setError(null);
    setNotice(null);
  }

  function openEditExpense() {
    if (!selectedExpense) return;
    const revision = selectedExpense.currentRevision;
    setExpenseForm({
      categoryId: revision.categoryId,
      description: revision.description,
      amount: koboToNairaInput(revision.amountMinor),
      incurredOn: revision.incurredOn,
      payeeName: revision.payeeName,
    });
    setExpenseDialog('edit');
    setError(null);
    setNotice(null);
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!expenseForm.categoryId) {
      setError('Choose an active expense category before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        categoryId: expenseForm.categoryId,
        description: expenseForm.description.trim(),
        amountMinor: nairaToKobo(expenseForm.amount),
        currency: 'NGN' as const,
        incurredOn: expenseForm.incurredOn,
        payeeName: expenseForm.payeeName.trim(),
      };
      const csrf = await getCsrfToken();
      if (expenseDialog === 'create') {
        await api.post<ExpenseRecord>('/expenses', payload, csrf);
        setNotice('Expense draft created.');
        setExpenseDialog(null);
        await loadExpenses(expenseSearch, expenseCategoryFilter);
      } else if (selectedExpense) {
        const updated = await api.patch<ExpenseRecord>(
          '/expenses/' + selectedExpense.id,
          payload,
          csrf,
        );
        const history = await api.get<ExpenseRevision[]>(
          '/expenses/' + selectedExpense.id + '/revisions',
        );
        setSelectedExpense(updated);
        setRevisions(history);
        setNotice('A new expense revision has been saved. Earlier revisions are unchanged.');
        setExpenseDialog(null);
        await loadExpenses(expenseSearch, expenseCategoryFilter);
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  function openCreateCategory() {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryDialog('create');
    setError(null);
    setNotice(null);
  }

  function openEditCategory(category: ExpenseCategory) {
    setEditingCategoryId(category.id);
    setCategoryForm({
      code: category.code,
      name: category.name,
      description: category.description ?? '',
    });
    setCategoryDialog('edit');
    setError(null);
    setNotice(null);
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: categoryForm.code.trim(),
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
      };
      const csrf = await getCsrfToken();
      if (categoryDialog === 'create') {
        await api.post<ExpenseCategory>('/expense-categories', payload, csrf);
        setNotice('Expense category created.');
      } else if (editingCategoryId) {
        await api.patch<ExpenseCategory>(
          '/expense-categories/' + editingCategoryId,
          payload,
          csrf,
        );
        setNotice('Expense category updated.');
      }
      setCategoryDialog(null);
      await loadCategories(categorySearch, categoryStatus);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleCategory(category: ExpenseCategory) {
    const nextActive = !category.isActive;
    const action = nextActive ? 'activate' : 'deactivate';
    const prompt = nextActive
      ? 'Activate the "' + category.name + '" category?'
      : 'Deactivate the "' + category.name + '" category? Existing expense history will be retained.';
    if (!window.confirm(prompt)) return;
    setSaving(true);
    setError(null);
    try {
      await api.postEmpty(
        '/expense-categories/' + category.id + '/' + action,
        await getCsrfToken(),
      );
      setNotice(nextActive ? 'Category activated.' : 'Category deactivated.');
      await loadCategories(categorySearch, categoryStatus);
    } catch (statusError) {
      setError(getErrorMessage(statusError));
    } finally {
      setSaving(false);
    }
  }

  const activeCategories = categories.filter((category) => category.isActive);

  return (
    <div className="expense-page">
      <div className="page-heading expense-page-heading">
        <div>
          <p className="eyebrow">FINANCE WORKSPACE</p>
          <h1>Expenses</h1>
          <p className="muted-copy">
            Record operating expenses as drafts and retain a clear history of every change.
          </p>
        </div>
        <div className="expense-heading-actions">
          <span className="module-status-pill">NGN records</span>
          {section === 'expenses' && canCreateExpense && canViewCategories && (
            <button
              className="primary-button expense-action-button"
              type="button"
              onClick={openCreateExpense}
            >
              Add expense
            </button>
          )}
          {section === 'categories' && !canViewExpenses && canCreateExpense && canViewCategories && (
            <button
              className="primary-button expense-action-button"
              type="button"
              onClick={openCreateExpense}
            >
              Add expense
            </button>
          )}
          {section === 'categories' && canManageCategories && (
            <button
              className="primary-button expense-action-button"
              type="button"
              onClick={openCreateCategory}
            >
              Add category
            </button>
          )}
        </div>
      </div>

      {(canViewExpenses || canViewCategories) && (
        <div className="expense-tabs" role="tablist" aria-label="Expense workspace">
          {canViewExpenses && (
            <button
              type="button"
              role="tab"
              aria-selected={section === 'expenses'}
              className={section === 'expenses' ? 'expense-tab active' : 'expense-tab'}
              onClick={() => {
                setSection('expenses');
                void loadCategories('', 'all');
                setSelectedExpense(null);
                setError(null);
                setNotice(null);
              }}
            >
              Expenses
            </button>
          )}
          {canViewCategories && (
            <button
              type="button"
              role="tab"
              aria-selected={section === 'categories'}
              className={section === 'categories' ? 'expense-tab active' : 'expense-tab'}
              onClick={() => {
                setSection('categories');
                setSelectedExpense(null);
                setError(null);
                setNotice(null);
                void loadCategories(categorySearch, categoryStatus);
              }}
            >
              Categories
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="expense-alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="expense-alert success" role="status">
          {notice}
        </p>
      )}

      {section === 'expenses' && canViewExpenses && !selectedExpense && (
        <section className="expense-card" aria-labelledby="expense-list-title">
          <div className="expense-card-heading">
            <div>
              <p className="eyebrow">EXPENSE REGISTER</p>
              <h2 id="expense-list-title">Expense records</h2>
            </div>
            <span className="record-count">{expenses.length} records</span>
          </div>
          <form className="expense-search" onSubmit={(event) => void submitExpenseSearch(event)}>
            <label>
              <span>Search expenses</span>
              <input
                aria-label="Search expenses"
                value={expenseSearch}
                onChange={(event) => setExpenseSearch(event.target.value)}
                placeholder="Search payee, description or ID…"
                maxLength={100}
              />
            </label>
            <label>
              <span>Category</span>
              <select
                aria-label="Filter expenses by category"
                value={expenseCategoryFilter}
                onChange={(event) => {
                  setExpenseCategoryFilter(event.target.value);
                  void loadExpenses(expenseSearch, event.target.value);
                }}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name} {category.isActive ? '' : '(inactive)'}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button search-button" type="submit">
              Search
            </button>
          </form>

          {loadingDetail && (
            <div className="expense-state" role="status">Loading expense details…</div>
          )}
          {loadingExpenses ? (
            <div className="expense-state" role="status">
              Loading expenses…
            </div>
          ) : expenses.length === 0 ? (
            <div className="expense-state">
              <strong>No expense records found</strong>
              <span>
                Create an expense draft or adjust your search and category filters.
              </span>
            </div>
          ) : (
            <div className="expense-table-wrap">
              <table className="expense-table">
                <thead>
                  <tr>
                    <th>Payee / description</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Date incurred</th>
                    <th>Status</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>
                        <strong>{expense.currentRevision.payeeName}</strong>
                        <small>{expense.currentRevision.description}</small>
                      </td>
                      <td>
                        <strong>{expense.currentRevision.categoryName}</strong>
                        <small>{expense.currentRevision.categoryCode}</small>
                      </td>
                      <td className="amount-cell">
                        {formatNaira(expense.currentRevision.amountMinor)}
                      </td>
                      <td>{formatDate(expense.currentRevision.incurredOn)}</td>
                      <td><span className="expense-status draft">Draft</span></td>
                      <td>
                        <button
                          type="button"
                          className="table-link-button"
                          onClick={() => void openExpenseDetails(expense.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {section === 'expenses' && canViewExpenses && selectedExpense && (
        <section className="expense-card expense-detail-card">
          <div className="expense-detail-toolbar">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSelectedExpense(null);
                setRevisions([]);
                setError(null);
                setNotice(null);
              }}
            >
              ← Back to expenses
            </button>
            {canUpdateExpense && canViewCategories && (
              <button
                type="button"
                className="primary-button expense-action-button"
                onClick={openEditExpense}
              >
                Edit draft
              </button>
            )}
          </div>
          <div className="expense-card-heading expense-detail-heading">
            <div>
              <p className="eyebrow">EXPENSE DETAILS</p>
              <h2>{selectedExpense.currentRevision.payeeName}</h2>
              <p className="expense-detail-description">
                {selectedExpense.currentRevision.description}
              </p>
            </div>
            <span className="expense-status draft">Draft</span>
          </div>
          <dl className="expense-facts">
            <div><dt>Amount</dt><dd>{formatNaira(selectedExpense.currentRevision.amountMinor)}</dd></div>
            <div><dt>Category</dt><dd>{selectedExpense.currentRevision.categoryName}</dd></div>
            <div><dt>Date incurred</dt><dd>{formatDate(selectedExpense.currentRevision.incurredOn)}</dd></div>
            <div><dt>Current revision</dt><dd>Revision {selectedExpense.currentRevision.revisionNumber}</dd></div>
            <div><dt>Expense ID</dt><dd className="expense-id">{selectedExpense.id}</dd></div>
            <div><dt>Last updated</dt><dd>{formatTimestamp(selectedExpense.updatedAt)}</dd></div>
          </dl>
          <div className="expense-history-heading">
            <div>
              <p className="eyebrow">IMMUTABLE CHANGE LOG</p>
              <h3>Revision history</h3>
            </div>
            <span className="record-count">{revisions.length} revisions</span>
          </div>
          {loadingDetail ? (
            <div className="expense-state" role="status">Loading revision history…</div>
          ) : revisions.length === 0 ? (
            <div className="expense-state">No revision history is available.</div>
          ) : (
            <div className="expense-table-wrap">
              <table className="expense-table revision-table">
                <thead>
                  <tr>
                    <th>Revision</th>
                    <th>Changed at</th>
                    <th>Payee</th>
                    <th>Category</th>
                    <th>Amount</th>
                    <th>Date incurred</th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((revision) => (
                    <tr key={revision.id}>
                      <td><strong>Revision {revision.revisionNumber}</strong></td>
                      <td>{formatTimestamp(revision.createdAt)}</td>
                      <td>{revision.payeeName}<small>{revision.description}</small></td>
                      <td>{revision.categoryName}</td>
                      <td className="amount-cell">{formatNaira(revision.amountMinor)}</td>
                      <td>{formatDate(revision.incurredOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {section === 'categories' && canViewCategories && (
        <section className="expense-card" aria-labelledby="expense-category-title">
          <div className="expense-card-heading">
            <div>
              <p className="eyebrow">CONFIGURATION</p>
              <h2 id="expense-category-title">Expense categories</h2>
            </div>
            <span className="record-count">{categories.length} categories</span>
          </div>
          <form className="expense-search category-search" onSubmit={(event) => void submitCategorySearch(event)}>
            <label>
              <span>Search categories</span>
              <input
                aria-label="Search categories"
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
                placeholder="Search by category name or code…"
                maxLength={100}
              />
            </label>
            <label>
              <span>Category status</span>
              <select
                aria-label="Filter categories by status"
                value={categoryStatus}
                onChange={(event) => {
                  const value = event.target.value as 'all' | 'active' | 'inactive';
                  setCategoryStatus(value);
                  void loadCategories(categorySearch, value);
                }}
              >
                <option value="all">All categories</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <button className="secondary-button search-button" type="submit">
              Search
            </button>
          </form>
          {loadingCategories ? (
            <div className="expense-state" role="status">Loading categories…</div>
          ) : categories.length === 0 ? (
            <div className="expense-state">
              <strong>No expense categories have been added</strong>
              <span>
                Categories are entered by your team. Add one to make it available when recording an expense.
              </span>
            </div>
          ) : (
            <div className="expense-table-wrap">
              <table className="expense-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Status</th>
                    {canManageCategories && <th><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id}>
                      <td><strong>{category.name}</strong></td>
                      <td>{category.code}</td>
                      <td>{category.description || '—'}</td>
                      <td>
                        <span className={'expense-status ' + (category.isActive ? 'active' : 'inactive')}>
                          {category.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {canManageCategories && (
                        <td>
                          <div className="expense-row-actions">
                            <button
                              type="button"
                              className="table-link-button"
                              onClick={() => openEditCategory(category)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="table-link-button"
                              disabled={saving}
                              onClick={() => void toggleCategory(category)}
                            >
                              {category.isActive ? 'Deactivate' : 'Activate'}
                            </button>
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
      )}

      {!canViewExpenses && !canViewCategories && (
        <div className="expense-card expense-state">
          <strong>You do not have access to Expense Management.</strong>
          <span>Your account needs an expense or expense-category view permission.</span>
        </div>
      )}

      {expenseDialog && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="expense-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-modal-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">{expenseDialog === 'create' ? 'NEW RECORD' : 'NEW REVISION'}</p>
                <h2 id="expense-modal-title">
                  {expenseDialog === 'create' ? 'Create expense draft' : 'Edit expense draft'}
                </h2>
              </div>
              <button
                className="modal-close"
                type="button"
                aria-label="Close expense form"
                onClick={() => setExpenseDialog(null)}
              >
                ×
              </button>
            </div>
            <form className="record-form" onSubmit={(event) => void submitExpense(event)}>
              <label>
                Expense category
                <select
                  aria-label="Expense category"
                  required
                  value={expenseForm.categoryId}
                  onChange={(event) => setExpenseForm({ ...expenseForm, categoryId: event.target.value })}
                >
                  <option value="">Choose a category</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <textarea
                  aria-label="Expense description"
                  required
                  rows={3}
                  maxLength={5000}
                  value={expenseForm.description}
                  onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })}
                />
              </label>
              <div className="form-grid">
                <label>
                  Amount (NGN)
                  <input
                    aria-label="Amount (NGN)"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    required
                    value={expenseForm.amount}
                    onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Date incurred
                  <input
                    aria-label="Date incurred"
                    type="date"
                    required
                    value={expenseForm.incurredOn}
                    onChange={(event) => setExpenseForm({ ...expenseForm, incurredOn: event.target.value })}
                  />
                </label>
              </div>
              <label>
                Payee name
                <input
                  aria-label="Payee name"
                  required
                  maxLength={200}
                  value={expenseForm.payeeName}
                  onChange={(event) => setExpenseForm({ ...expenseForm, payeeName: event.target.value })}
                  placeholder="Person or business paid"
                />
              </label>
              <p className="expense-form-note">
                Saving an edit creates a new immutable revision. Previous expense details remain in the history.
              </p>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => setExpenseDialog(null)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving || activeCategories.length === 0}>
                  {saving
                    ? 'Saving…'
                    : expenseDialog === 'create'
                      ? 'Create draft'
                      : 'Save new revision'}
                </button>
              </div>
              {activeCategories.length === 0 && (
                <p className="expense-form-note">
                  Add and activate an expense category before creating a draft.
                </p>
              )}
            </form>
          </section>
        </div>
      )}

      {categoryDialog && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="expense-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-modal-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">CATEGORY SETUP</p>
                <h2 id="category-modal-title">
                  {categoryDialog === 'create' ? 'Add expense category' : 'Edit expense category'}
                </h2>
              </div>
              <button
                className="modal-close"
                type="button"
                aria-label="Close category form"
                onClick={() => setCategoryDialog(null)}
              >
                ×
              </button>
            </div>
            <form className="record-form" onSubmit={(event) => void submitCategory(event)}>
              <label>
                Category code
                <input
                  aria-label="Category code"
                  required
                  maxLength={40}
                  value={categoryForm.code}
                  onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value })}
                  placeholder="Enter a unique code"
                />
              </label>
              <label>
                Category name
                <input
                  aria-label="Category name"
                  required
                  maxLength={100}
                  value={categoryForm.name}
                  onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })}
                  placeholder="Enter a category name"
                />
              </label>
              <label>
                Description
                <textarea
                  aria-label="Category description"
                  rows={3}
                  maxLength={2000}
                  value={categoryForm.description}
                  onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })}
                  placeholder="Optional description"
                />
              </label>
              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => setCategoryDialog(null)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Save category'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
