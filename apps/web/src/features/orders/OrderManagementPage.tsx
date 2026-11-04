import './OrderManagementPage.css';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

type OrderStatus =
  | 'received'
  | 'confirmed'
  | 'processing'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'failed_delivery'
  | 'fulfilment_hold';
type SourceChannel = 'whatsapp' | 'instagram' | 'website' | 'phone';

interface OrderItem {
  productId: string;
  productVariantId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string | null;
  unitOfMeasureSnapshot: string;
  unitPriceMinor: string;
  quantity: number;
  discountMinor: string;
  lineTotalMinor: string;
}

interface OrderRecord {
  id: string;
  customerId: string;
  customerNameSnapshot: string;
  customerPhoneSnapshot: string | null;
  customerEmailSnapshot: string | null;
  sourceChannel: SourceChannel;
  status: OrderStatus;
  fulfilmentLocationId: string;
  items: OrderItem[];
  currency: 'NGN';
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  totalMinor: string;
  deliveryAddressSnapshot: string | null;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Customer {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: 'active' | 'archived';
}

interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  unitOfMeasure: string;
  sellingPrice: string;
  isActive: boolean;
  isDefault: boolean;
}

interface Product {
  id: string;
  name: string;
  internalCode: string | null;
  status: 'active' | 'archived';
  variants: ProductVariant[];
}

export interface OrderLocationOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface OrderDraftItem {
  productId: string;
  variantId: string;
  quantity: number;
}

interface OrderFormState {
  customerId: string;
  sourceChannel: SourceChannel | '';
  fulfilmentLocationId: string;
  deliveryAddress: string;
  notes: string;
  items: OrderDraftItem[];
}

const emptyForm: OrderFormState = {
  customerId: '',
  sourceChannel: '',
  fulfilmentLocationId: '',
  deliveryAddress: '',
  notes: '',
  items: [],
};

const statusOptions: { value: OrderStatus; label: string }[] = [
  { value: 'received', label: 'Received' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'processing', label: 'Processing' },
  { value: 'packed', label: 'Packed' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed_delivery', label: 'Failed delivery' },
  { value: 'fulfilment_hold', label: 'Fulfilment hold' },
];

const sourceOptions: { value: SourceChannel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'website', label: 'Website' },
  { value: 'phone', label: 'Phone' },
];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function formatMoney(minor: string): string {
  try {
    const amount = BigInt(minor);
    const whole = amount / 100n;
    const fraction = (amount % 100n).toString().padStart(2, '0');
    return '₦' + whole.toLocaleString('en-NG') + '.' + fraction;
  } catch {
    return '₦0.00';
  }
}

function nairaToMinor(value: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return 0n;
  const parts = value.trim().split('.');
  return BigInt(parts[0] || '0') * 100n + BigInt(((parts[1] || '') + '00').slice(0, 2));
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

function orderReference(id: string): string {
  return 'ORD-' + id.replace(/-/g, '').slice(0, 12).toUpperCase();
}

function locationLabel(locationId: string, locations: OrderLocationOption[]): string {
  const location = locations.find((item) => item.id === locationId);
  return location?.name ?? 'Location ID · ' + locationId;
}

function productVariantKey(productId: string, variantId: string): string {
  return productId + '|' + variantId;
}

function parseVariantKey(value: string): { productId: string; variantId: string } | null {
  const [productId, variantId] = value.split('|');
  return productId && variantId ? { productId, variantId } : null;
}

function safeQuantity(value: number): bigint {
  return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : 0n;
}

function validateOrderForm(form: OrderFormState): string | null {
  if (!form.customerId) return 'Choose a customer.';
  if (!form.sourceChannel) return 'Choose an order source channel.';
  if (!form.fulfilmentLocationId) return 'Choose an available fulfilment location.';
  if (form.items.length === 0) return 'Add at least one product to the order.';
  if (form.items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    return 'Every item quantity must be a positive whole number.';
  }
  if (form.deliveryAddress.length > 1000 || form.notes.length > 1000) {
    return 'Delivery address and notes must be 1,000 characters or fewer.';
  }
  return null;
}

export function OrderManagementPage({ permissions }: { permissions: string[] }) {
  const canViewOrders = permissions.includes('orders.view');
  const canCreateOrders = permissions.includes('orders.create');
  const canUpdateOrders = permissions.includes('orders.update');
  const canViewCustomers = permissions.includes('customers.view');
  const canViewProducts = permissions.includes('products.view');

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<OrderLocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | SourceChannel>('all');
  const [view, setView] = useState<'register' | 'create' | 'detail' | 'edit'>('register');
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [requestedOrderId, setRequestedOrderId] = useState<string | null>(null);
  const [form, setForm] = useState<OrderFormState>(emptyForm);
  const [productChoice, setProductChoice] = useState('');
  const [quantityChoice, setQuantityChoice] = useState('1');

  const activeProducts = useMemo(
    () =>
      products
        .filter((product) => product.status === 'active')
        .map((product) => ({
          ...product,
          variants: product.variants.filter((variant) => variant.isActive),
        }))
        .filter((product) => product.variants.length > 0),
    [products],
  );

  const loadLocations = useCallback(async () => {
    setLoadingLocations(true);
    setLocationError(null);
    try {
      const result = await api.get<OrderLocationOption[]>('/locations');
      if (!Array.isArray(result)) {
        throw new Error('The location service returned an invalid response.');
      }
      const accessibleLocations = result.filter(
        (location) =>
          location !== null &&
          typeof location.id === 'string' &&
          typeof location.code === 'string' &&
          typeof location.name === 'string' &&
          location.isActive === true,
      );
      setLocations(accessibleLocations);
    } catch (loadError) {
      setLocations([]);
      setLocationError(errorMessage(loadError));
    } finally {
      setLoadingLocations(false);
    }
  }, []);

  const loadOrders = useCallback(
    async (
      page: number,
      query: string,
      status: 'all' | OrderStatus,
      source: 'all' | SourceChannel,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (status !== 'all') params.set('status', status);
        if (source !== 'all') params.set('sourceChannel', source);
        params.set('page', String(page));
        params.set('pageSize', '10');
        const result = await api.getPage<OrderRecord[], PageMeta>('/orders?' + params.toString());
        setOrders(result.data);
        setPageMeta(result.meta);
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadReferenceData = useCallback(async () => {
    if (!canViewCustomers || !canViewProducts) {
      setReferenceError(
        'Order capture requires customers.view and products.view so the existing records can be selected.',
      );
      return;
    }
    setLoadingReferences(true);
    setReferenceError(null);
    try {
      const [customerPage, productRows] = await Promise.all([
        api.getPage<Customer[], PageMeta>('/customers?status=active&page=1&pageSize=100'),
        api.get<Product[]>('/products?status=all'),
      ]);
      setCustomers(customerPage.data.filter((customer) => customer.status === 'active'));
      setProducts(productRows);
    } catch (loadError) {
      setReferenceError(errorMessage(loadError));
    } finally {
      setLoadingReferences(false);
    }
  }, [canViewCustomers, canViewProducts]);

  useEffect(() => {
    if (canViewOrders) void loadOrders(1, '', 'all', 'all');
    else setLoading(false);
  }, [canViewOrders, loadOrders]);

  useEffect(() => {
    if (canViewOrders) void loadLocations();
    else setLoadingLocations(false);
  }, [canViewOrders, loadLocations]);

  useEffect(() => {
    if (canCreateOrders || canUpdateOrders) void loadReferenceData();
  }, [canCreateOrders, canUpdateOrders, loadReferenceData]);

  async function refreshRegister(): Promise<void> {
    await loadOrders(pageMeta.page, search, statusFilter, sourceFilter);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await loadOrders(1, search, statusFilter, sourceFilter);
  }

  async function openOrder(orderId: string): Promise<void> {
    setView('detail');
    setSelectedOrder(null);
    setRequestedOrderId(orderId);
    setError(null);
    setLoading(true);
    try {
      const order = await api.get<OrderRecord>('/orders/' + orderId);
      setSelectedOrder(order);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  function beginCreate(): void {
    setSelectedOrder(null);
    setForm({ ...emptyForm });
    setProductChoice('');
    setQuantityChoice('1');
    setError(null);
    setNotice(null);
    setView('create');
  }

  function beginAmendment(): void {
    if (!selectedOrder || selectedOrder.status !== 'received' || !canUpdateOrders) return;
    setForm({
      customerId: selectedOrder.customerId,
      sourceChannel: selectedOrder.sourceChannel,
      fulfilmentLocationId: selectedOrder.fulfilmentLocationId,
      deliveryAddress: selectedOrder.deliveryAddressSnapshot ?? '',
      notes: selectedOrder.notes ?? '',
      items: selectedOrder.items.map((item) => ({
        productId: item.productId,
        variantId: item.productVariantId,
        quantity: item.quantity,
      })),
    });
    setProductChoice('');
    setQuantityChoice('1');
    setError(null);
    setNotice(null);
    setView('edit');
  }

  function addItem(): void {
    const parsed = parseVariantKey(productChoice);
    const quantity = Number(quantityChoice);
    if (!parsed || !Number.isSafeInteger(quantity) || quantity < 1) {
      setError('Choose a product variant and enter a positive whole-number quantity.');
      return;
    }
    setForm((current) => {
      const existingIndex = current.items.findIndex(
        (item) => item.productId === parsed.productId && item.variantId === parsed.variantId,
      );
      if (existingIndex >= 0) {
        return {
          ...current,
          items: current.items.map((item, index) =>
            index === existingIndex ? { ...item, quantity: item.quantity + quantity } : item,
          ),
        };
      }
      return { ...current, items: [...current.items, { ...parsed, quantity }] };
    });
    setProductChoice('');
    setQuantityChoice('1');
    setError(null);
  }

  function updateItem(index: number, updates: Partial<OrderDraftItem>): void {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...updates } : item,
      ),
    }));
  }

  function removeItem(index: number): void {
    setForm((current) => ({
      ...current,
      items: current.items.filter((_item, itemIndex) => itemIndex !== index),
    }));
  }

  function selectedVariant(productId: string, variantId: string): ProductVariant | undefined {
    return products
      .find((product) => product.id === productId)
      ?.variants.find((variant) => variant.id === variantId);
  }

  function previewTotals(): { subtotal: bigint; total: bigint } {
    const subtotal = form.items.reduce((sum, item) => {
      const variant = selectedVariant(item.productId, item.variantId);
      return sum + safeQuantity(item.quantity) * nairaToMinor(variant?.sellingPrice ?? '0');
    }, 0n);
    return { subtotal, total: subtotal };
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canCreateOrders && view === 'create') return;
    if (!canUpdateOrders && view === 'edit') return;
    if (view === 'edit' && (!selectedOrder || selectedOrder.status !== 'received')) return;
    const validation = validateOrderForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    const chosenLocationIsAccessible = activeLocations.some(
      (location) => location.id === form.fulfilmentLocationId,
    );
    if (
      view === 'create' &&
      (loadingLocations || Boolean(locationError) || !chosenLocationIsAccessible)
    ) {
      setError(
        'Select an active fulfilment location returned for your account before creating the order.',
      );
      return;
    }
    if (
      view === 'edit' &&
      selectedOrder?.fulfilmentLocationId !== form.fulfilmentLocationId &&
      !chosenLocationIsAccessible
    ) {
      setError(
        'Choose an active accessible fulfilment location before changing the order location.',
      );
      return;
    }

    const fullPayload = {
      customerId: form.customerId,
      sourceChannel: form.sourceChannel,
      fulfilmentLocationId: form.fulfilmentLocationId,
      items: form.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
      })),
      deliveryAddress: form.deliveryAddress.trim() || null,
      notes: form.notes.trim() || null,
    };
    let payload: Record<string, unknown> = fullPayload;
    if (view === 'edit' && selectedOrder) {
      const changes: Record<string, unknown> = {};
      if (form.customerId !== selectedOrder.customerId) changes.customerId = form.customerId;
      if (form.sourceChannel !== selectedOrder.sourceChannel)
        changes.sourceChannel = form.sourceChannel;
      if (form.fulfilmentLocationId !== selectedOrder.fulfilmentLocationId) {
        changes.fulfilmentLocationId = form.fulfilmentLocationId;
      }
      const savedItems = selectedOrder.items.map((item) => ({
        productId: item.productId,
        variantId: item.productVariantId,
        quantity: item.quantity,
      }));
      if (JSON.stringify(fullPayload.items) !== JSON.stringify(savedItems)) {
        changes.items = fullPayload.items;
      }
      if (fullPayload.deliveryAddress !== (selectedOrder.deliveryAddressSnapshot ?? null)) {
        changes.deliveryAddress = fullPayload.deliveryAddress;
      }
      if (fullPayload.notes !== (selectedOrder.notes ?? null)) changes.notes = fullPayload.notes;
      if (Object.keys(changes).length === 0) {
        setError('There are no changes to save.');
        return;
      }
      payload = changes;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const csrf = await getCsrfToken();
      if (view === 'create') {
        const created = await api.post<OrderRecord>('/orders', payload, csrf);
        const saved = await api.get<OrderRecord>('/orders/' + created.id).catch(() => created);
        setSelectedOrder(saved);
        setView('detail');
        setNotice('Order created. The totals below are the values returned by the server.');
        await loadOrders(1, search, statusFilter, sourceFilter);
      } else if (selectedOrder) {
        await api.patch<OrderRecord>('/orders/' + selectedOrder.id, payload, csrf);
        const refreshed = await api.get<OrderRecord>('/orders/' + selectedOrder.id);
        setSelectedOrder(refreshed);
        setView('detail');
        setNotice(
          'Order amendment saved. The displayed record has been re-fetched from the server.',
        );
        await loadOrders(pageMeta.page, search, statusFilter, sourceFilter);
      }
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const preview = previewTotals();
  const canCreateWithDependencies = canCreateOrders && canViewCustomers && canViewProducts;
  const activeLocations = locations.filter((location) => location.isActive);

  if (!canViewOrders) {
    return (
      <div className="order-page">
        <section className="order-card order-state">
          <strong>You do not have access to Order Management.</strong>
          <span>Your account needs the orders.view permission.</span>
        </section>
      </div>
    );
  }

  return (
    <div className="order-page">
      <div className="page-heading order-page-heading">
        <div>
          <p className="eyebrow">SALES OPERATIONS</p>
          <h1>Orders</h1>
          <p className="muted-copy">
            Capture and review customer orders from WhatsApp, Instagram, the website and phone.
          </p>
        </div>
        <div className="order-heading-actions">
          <span className="module-status-pill">Internal records</span>
          {view === 'register' && canCreateOrders && (
            <button
              className="primary-button order-action-button"
              type="button"
              onClick={beginCreate}
            >
              Create order
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="order-alert error" role="alert">
          <span>{error}</span>
          {view === 'register' && (
            <button className="text-button" type="button" onClick={() => void refreshRegister()}>
              Retry
            </button>
          )}
        </div>
      )}
      {locationError && (
        <div className="order-alert error" role="alert">
          <span>Accessible fulfilment locations could not be loaded. {locationError}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => void loadLocations()}
            disabled={loadingLocations}
          >
            Retry locations
          </button>
        </div>
      )}
      {notice && (
        <p className="order-alert success" role="status">
          {notice}
        </p>
      )}

      {view === 'register' && (
        <section className="order-card" aria-labelledby="order-register-title">
          <div className="order-card-heading">
            <div>
              <p className="eyebrow">ORDER REGISTER</p>
              <h2 id="order-register-title">All orders</h2>
            </div>
            <span className="record-count">{pageMeta.total} records</span>
          </div>
          <form className="order-filters" onSubmit={(event) => void submitSearch(event)}>
            <label className="search-control">
              <span>Search orders</span>
              <input
                value={search}
                maxLength={100}
                placeholder="Search reference or customer…"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | OrderStatus)}
              >
                <option value="all">All statuses</option>
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Source</span>
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value as 'all' | SourceChannel)}
              >
                <option value="all">All channels</option>
                {sourceOptions.map((source) => (
                  <option key={source.value} value={source.value}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="search-button" type="submit">
              Apply filters
            </button>
          </form>

          {loading ? (
            <div className="order-state" role="status">
              Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="order-state">
              <strong>No orders found</strong>
              <span>Try another search or filter, or create a new order.</span>
            </div>
          ) : (
            <div className="order-table-wrap">
              <table className="order-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>Source</th>
                    <th>Fulfilment location</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong className="order-reference">{orderReference(order.id)}</strong>
                        <small title={order.id}>Record ID</small>
                      </td>
                      <td>
                        <strong>{order.customerNameSnapshot}</strong>
                        <small>{order.customerPhoneSnapshot ?? 'No phone recorded'}</small>
                      </td>
                      <td>
                        {sourceOptions.find((item) => item.value === order.sourceChannel)?.label ??
                          order.sourceChannel}
                      </td>
                      <td className="order-location-cell" title={order.fulfilmentLocationId}>
                        {locationLabel(order.fulfilmentLocationId, locations)}
                      </td>
                      <td className="order-money">{formatMoney(order.totalMinor)}</td>
                      <td>
                        <span className={'order-status ' + order.status}>
                          {statusOptions.find((item) => item.value === order.status)?.label ??
                            order.status}
                        </span>
                      </td>
                      <td>{formatTimestamp(order.createdAt)}</td>
                      <td>
                        <button
                          className="table-link-button"
                          type="button"
                          onClick={() => void openOrder(order.id)}
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

          <div className="order-pagination">
            <span>
              Page {pageMeta.page} of {Math.max(1, pageMeta.totalPages)}
            </span>
            <div>
              <button
                className="secondary-button"
                type="button"
                disabled={loading || pageMeta.page <= 1}
                onClick={() =>
                  void loadOrders(pageMeta.page - 1, search, statusFilter, sourceFilter)
                }
              >
                Previous
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={loading || pageMeta.page >= pageMeta.totalPages}
                onClick={() =>
                  void loadOrders(pageMeta.page + 1, search, statusFilter, sourceFilter)
                }
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}

      {(view === 'create' || view === 'edit') && (
        <section className="order-card order-form-card" aria-labelledby="order-form-title">
          <div className="order-card-heading">
            <div>
              <p className="eyebrow">
                {view === 'create' ? 'NEW ORDER' : 'RECEIVED ORDER AMENDMENT'}
              </p>
              <h2 id="order-form-title">{view === 'create' ? 'Create an order' : 'Amend order'}</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => setView(selectedOrder ? 'detail' : 'register')}
            >
              Cancel
            </button>
          </div>

          {referenceError && (
            <div className="order-alert error" role="alert">
              <span>{referenceError}</span>
              <button
                className="text-button"
                type="button"
                onClick={() => void loadReferenceData()}
              >
                Retry
              </button>
            </div>
          )}
          {loadingReferences && (
            <p className="order-helper" role="status">
              Loading customers and products…
            </p>
          )}

          {(!canViewCustomers || !canViewProducts) && (
            <p className="order-alert error" role="alert">
              Order capture requires customers.view and products.view. No additional permissions are
              granted by this frontend.
            </p>
          )}

          <form className="order-form" onSubmit={(event) => void submitOrder(event)}>
            <div className="order-form-grid">
              <label>
                Customer
                <select
                  required
                  value={form.customerId}
                  disabled={loadingReferences || !canViewCustomers}
                  onChange={(event) => setForm({ ...form, customerId: event.target.value })}
                >
                  <option value="">Choose an active customer</option>
                  {selectedOrder &&
                    selectedOrder.customerId === form.customerId &&
                    !customers.some((customer) => customer.id === selectedOrder.customerId) && (
                      <option value={selectedOrder.customerId}>
                        {selectedOrder.customerNameSnapshot} · existing order customer
                      </option>
                    )}
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.fullName}
                      {customer.phone ? ' · ' + customer.phone : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source channel
                <select
                  required
                  value={form.sourceChannel}
                  onChange={(event) =>
                    setForm({ ...form, sourceChannel: event.target.value as SourceChannel | '' })
                  }
                >
                  <option value="">Choose a channel</option>
                  {sourceOptions.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="order-location-select">
                Fulfilment location
                <select
                  aria-label="Fulfilment location"
                  required
                  value={form.fulfilmentLocationId}
                  disabled={
                    loadingLocations || Boolean(locationError) || activeLocations.length === 0
                  }
                  onChange={(event) =>
                    setForm({ ...form, fulfilmentLocationId: event.target.value })
                  }
                >
                  <option value="">Choose an available location</option>
                  {view === 'edit' &&
                    selectedOrder &&
                    !activeLocations.some(
                      (location) => location.id === selectedOrder.fulfilmentLocationId,
                    ) && (
                      <option value={selectedOrder.fulfilmentLocationId} disabled>
                        Current location (not available for reassignment)
                      </option>
                    )}
                  {activeLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
                {loadingLocations ? (
                  <small className="order-field-warning">Loading accessible locations…</small>
                ) : locationError ? (
                  <small className="order-field-warning">
                    Location lookup failed. Use Retry locations above before creating an order.
                  </small>
                ) : activeLocations.length === 0 ? (
                  <small className="order-field-warning">
                    No active fulfilment locations are available to your account. Order creation
                    remains unavailable until an accessible location is assigned.
                  </small>
                ) : (
                  <small className="order-helper">
                    Choose one of the active fulfilment locations available to your account.
                  </small>
                )}
              </label>
            </div>

            <div className="order-item-builder">
              <div className="order-section-heading">
                <div>
                  <p className="eyebrow">LINE ITEMS</p>
                  <h3>Products and variants</h3>
                </div>
              </div>
              <div className="order-add-item">
                <label>
                  Product / variant
                  <select
                    aria-label="Product / variant"
                    value={productChoice}
                    disabled={loadingReferences || !canViewProducts}
                    onChange={(event) => setProductChoice(event.target.value)}
                  >
                    <option value="">Select a product variant</option>
                    {activeProducts.map((product) =>
                      product.variants.map((variant) => (
                        <option key={variant.id} value={productVariantKey(product.id, variant.id)}>
                          {product.name} · {variant.name} · {variant.sellingPrice} NGN
                        </option>
                      )),
                    )}
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    aria-label="New item quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={quantityChoice}
                    onChange={(event) => setQuantityChoice(event.target.value)}
                  />
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={addItem}
                  disabled={!productChoice}
                >
                  Add item
                </button>
              </div>

              {form.items.length === 0 ? (
                <div className="order-empty-items">No products added yet.</div>
              ) : (
                <div className="order-line-list">
                  {form.items.map((item, index) => {
                    const product = products.find((candidate) => candidate.id === item.productId);
                    const variant = selectedVariant(item.productId, item.variantId);
                    const unitMinor = nairaToMinor(variant?.sellingPrice ?? '0').toString();
                    return (
                      <div
                        className="order-line"
                        key={productVariantKey(item.productId, item.variantId)}
                      >
                        <div className="order-line-name">
                          <strong>{product?.name ?? 'Product snapshot'}</strong>
                          <small>
                            {variant?.name ?? 'Variant snapshot'}
                            {variant?.sku ? ' · ' + variant.sku : ''}
                          </small>
                        </div>
                        <label>
                          Qty
                          <input
                            aria-label={'Quantity for item ' + (index + 1)}
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={(event) =>
                              updateItem(index, { quantity: Number(event.target.value) })
                            }
                          />
                        </label>
                        <div className="order-line-total">
                          <small>{formatMoney(unitMinor)} each</small>
                          <strong>
                            {formatMoney(
                              (safeQuantity(item.quantity) * BigInt(unitMinor)).toString(),
                            )}
                          </strong>
                        </div>
                        <button
                          className="text-button remove-line"
                          type="button"
                          onClick={() => removeItem(index)}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="order-preview-total">
                <span>Estimated subtotal</span>
                <strong>{formatMoney(preview.subtotal.toString())}</strong>
                <small>
                  Preview only. The server resolves current prices and returns the authoritative
                  totals.
                </small>
              </div>
            </div>

            <div className="order-form-grid order-form-notes">
              <label>
                Delivery address
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={form.deliveryAddress}
                  onChange={(event) => setForm({ ...form, deliveryAddress: event.target.value })}
                  placeholder="Optional delivery address"
                />
              </label>
              <label>
                Order notes
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Optional internal notes"
                />
              </label>
            </div>

            <div className="order-form-footer">
              <p className="order-helper">
                New orders are assigned the received status by the server. This form does not
                collect payment or change order lifecycle state.
              </p>
              <div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => setView(selectedOrder ? 'detail' : 'register')}
                >
                  Cancel
                </button>
                <button
                  className="primary-button order-action-button"
                  type="submit"
                  disabled={
                    saving ||
                    loadingReferences ||
                    !canViewCustomers ||
                    !canViewProducts ||
                    (view === 'create' &&
                      (!canCreateWithDependencies ||
                        loadingLocations ||
                        Boolean(locationError) ||
                        !activeLocations.some(
                          (location) => location.id === form.fulfilmentLocationId,
                        )))
                  }
                >
                  {saving ? 'Saving…' : view === 'create' ? 'Create order' : 'Save amendment'}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      {view === 'detail' && (
        <section className="order-card order-detail-card" aria-labelledby="order-detail-title">
          {loading ? (
            <div className="order-state" role="status">
              Loading order details…
            </div>
          ) : selectedOrder ? (
            <>
              <div className="order-card-heading order-detail-heading">
                <div>
                  <p className="eyebrow">ORDER DETAILS</p>
                  <h2 id="order-detail-title">{orderReference(selectedOrder.id)}</h2>
                  <p className="order-detail-id" title={selectedOrder.id}>
                    Record ID · {selectedOrder.id}
                  </p>
                </div>
                <div className="order-heading-actions">
                  <span className={'order-status ' + selectedOrder.status}>
                    {statusOptions.find((item) => item.value === selectedOrder.status)?.label ??
                      selectedOrder.status}
                  </span>
                  {canUpdateOrders && selectedOrder.status === 'received' && (
                    <button
                      className="primary-button order-action-button"
                      type="button"
                      onClick={beginAmendment}
                    >
                      Amend order
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setView('register')}
                  >
                    Back to register
                  </button>
                </div>
              </div>

              {selectedOrder.status !== 'received' && (
                <p className="order-helper">
                  This order is not amendable. Only orders in the received status can be edited.
                </p>
              )}

              <div className="order-detail-grid">
                <section>
                  <p className="eyebrow">CUSTOMER SNAPSHOT</p>
                  <h3>{selectedOrder.customerNameSnapshot}</h3>
                  <p>{selectedOrder.customerPhoneSnapshot ?? 'No phone recorded'}</p>
                  <p>{selectedOrder.customerEmailSnapshot ?? 'No email recorded'}</p>
                </section>
                <section>
                  <p className="eyebrow">ORDER INFORMATION</p>
                  <dl>
                    <div>
                      <dt>Source channel</dt>
                      <dd>
                        {sourceOptions.find((item) => item.value === selectedOrder.sourceChannel)
                          ?.label ?? selectedOrder.sourceChannel}
                      </dd>
                    </div>
                    <div>
                      <dt>Fulfilment location</dt>
                      <dd>{locationLabel(selectedOrder.fulfilmentLocationId, locations)}</dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>{formatTimestamp(selectedOrder.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Last updated</dt>
                      <dd>{formatTimestamp(selectedOrder.updatedAt)}</dd>
                    </div>
                  </dl>
                </section>
                <section>
                  <p className="eyebrow">DELIVERY AND NOTES</p>
                  <h3>Delivery address</h3>
                  <p>{selectedOrder.deliveryAddressSnapshot || 'Not provided'}</p>
                  <h3>Internal notes</h3>
                  <p>{selectedOrder.notes || 'No notes'}</p>
                </section>
              </div>

              <div className="order-detail-items">
                <div className="order-section-heading">
                  <div>
                    <p className="eyebrow">SAVED SNAPSHOTS</p>
                    <h3>Order items</h3>
                  </div>
                </div>
                <div className="order-table-wrap">
                  <table className="order-table">
                    <thead>
                      <tr>
                        <th>Product snapshot</th>
                        <th>SKU</th>
                        <th>Quantity</th>
                        <th>Unit price</th>
                        <th>Line total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((item, index) => (
                        <tr key={item.productVariantId + '-' + index}>
                          <td>
                            <strong>{item.productNameSnapshot}</strong>
                            <small>
                              {item.variantNameSnapshot} · {item.unitOfMeasureSnapshot}
                            </small>
                          </td>
                          <td>{item.skuSnapshot ?? '—'}</td>
                          <td>{item.quantity}</td>
                          <td className="order-money">{formatMoney(item.unitPriceMinor)}</td>
                          <td className="order-money">{formatMoney(item.lineTotalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="order-totals">
                <div>
                  <span>Subtotal</span>
                  <strong>{formatMoney(selectedOrder.subtotalMinor)}</strong>
                </div>
                <div>
                  <span>Discount</span>
                  <strong>{formatMoney(selectedOrder.discountMinor)}</strong>
                </div>
                <div>
                  <span>Delivery fee</span>
                  <strong>{formatMoney(selectedOrder.deliveryFeeMinor)}</strong>
                </div>
                <div className="grand-total">
                  <span>Order total</span>
                  <strong>{formatMoney(selectedOrder.totalMinor)}</strong>
                </div>
              </div>
            </>
          ) : (
            <div className="order-state">
              <strong>Order details could not be loaded</strong>
              <span>{error ?? 'The order could not be retrieved.'}</span>
              <div className="order-heading-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => requestedOrderId && void openOrder(requestedOrderId)}
                  disabled={!requestedOrderId}
                >
                  Retry
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setView('register')}
                >
                  Back to register
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
