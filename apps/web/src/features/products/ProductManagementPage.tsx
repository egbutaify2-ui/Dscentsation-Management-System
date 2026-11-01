import './ProductManagementPage.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

interface Variant {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  unitOfMeasure: string;
  sellingPrice: string;
  costPrice: string;
  currency: string;
  isActive: boolean;
  isDefault: boolean;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  internalCode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: 'active' | 'archived';
  variants: Variant[];
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  isActive: boolean;
  productCount: number;
}

interface ProductForm {
  name: string;
  description: string;
  internalCode: string;
  categoryId: string;
  variantName: string;
  sku: string;
  unitOfMeasure: string;
  sellingPrice: string;
  costPrice: string;
}

interface VariantForm {
  name: string;
  sku: string;
  unitOfMeasure: string;
  sellingPrice: string;
  costPrice: string;
}

interface CategoryForm {
  name: string;
  description: string;
  parentId: string;
}

const emptyProductForm: ProductForm = {
  name: '',
  description: '',
  internalCode: '',
  categoryId: '',
  variantName: 'Default',
  sku: '',
  unitOfMeasure: 'unit',
  sellingPrice: '0.00',
  costPrice: '0.00',
};

const emptyVariantForm: VariantForm = {
  name: '',
  sku: '',
  unitOfMeasure: 'unit',
  sellingPrice: '0.00',
  costPrice: '0.00',
};

const emptyCategoryForm: CategoryForm = { name: '', description: '', parentId: '' };

function formatNaira(amount: string): string {
  const [whole, fraction = '00'] = amount.split('.');
  const minor = (fraction + '00').slice(0, 2);
  return `₦${BigInt(whole || '0').toLocaleString('en-NG')}.${minor}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export function ProductManagementPage() {
  const [view, setView] = useState<'products' | 'categories'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [productDialog, setProductDialog] = useState<'create' | 'edit' | null>(null);
  const [productForm, setProductForm] = useState<ProductForm>(emptyProductForm);
  const [variantDialog, setVariantDialog] = useState<'create' | 'edit' | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [variantForm, setVariantForm] = useState<VariantForm>(emptyVariantForm);
  const [categoryDialog, setCategoryDialog] = useState<'create' | 'edit' | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm);

  const loadData = useCallback(async (query: string, filter: 'active' | 'archived' | 'all') => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (filter !== 'all') params.set('status', filter);
      const productPath = `/products${params.size ? `?${params.toString()}` : ''}`;
      const [productRows, categoryRows] = await Promise.all([
        api.get<Product[]>(productPath),
        api.get<Category[]>('/categories'),
      ]);
      setProducts(productRows);
      setCategories(categoryRows);
      setSelectedProduct((current) =>
        current ? productRows.find((item) => item.id === current.id) ?? null : null,
      );
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData('', 'active');
  }, [loadData]);

  async function refresh() {
    await loadData(search, statusFilter);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadData(search, statusFilter);
  }

  function openCreateProduct() {
    setProductForm(emptyProductForm);
    setProductDialog('create');
    setError(null);
  }

  function openEditProduct(product: Product) {
    setProductForm({
      ...emptyProductForm,
      name: product.name,
      description: product.description ?? '',
      internalCode: product.internalCode ?? '',
      categoryId: product.categoryId ?? '',
    });
    setProductDialog('edit');
    setError(null);
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const csrf = await getCsrfToken();
      const details = {
        name: productForm.name.trim(),
        description: productForm.description.trim() || null,
        internalCode: productForm.internalCode.trim() || null,
        categoryId: productForm.categoryId || null,
      };
      if (productDialog === 'create') {
        const created = await api.post<Product>(
          '/products',
          {
            ...details,
            variant: {
              name: productForm.variantName.trim() || 'Default',
              sku: productForm.sku.trim() || null,
              unitOfMeasure: productForm.unitOfMeasure.trim(),
              sellingPrice: productForm.sellingPrice.trim(),
              costPrice: productForm.costPrice.trim(),
            },
          },
          csrf,
        );
        setSelectedProduct(created);
        setNotice('Product created successfully.');
      } else if (selectedProduct) {
        const updated = await api.patch<Product>(
          `/products/${selectedProduct.id}`,
          details,
          csrf,
        );
        setSelectedProduct(updated);
        setNotice('Product details saved.');
      }
      setProductDialog(null);
      await loadData(search, statusFilter);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeProductStatus(product: Product) {
    const nextStatus = product.status === 'active' ? 'archived' : 'active';
    const message =
      nextStatus === 'archived'
        ? `Archive “${product.name}”? The product and its variants will be retained for future records.`
        : `Activate “${product.name}”?`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.patch<Product>(
        `/products/${product.id}/status`,
        { status: nextStatus },
        await getCsrfToken(),
      );
      setSelectedProduct(updated);
      setNotice(nextStatus === 'archived' ? 'Product archived.' : 'Product activated.');
      await loadData(search, statusFilter);
    } catch (statusError) {
      setError(getErrorMessage(statusError));
    } finally {
      setSaving(false);
    }
  }

  function openCreateVariant() {
    setEditingVariantId(null);
    setVariantForm(emptyVariantForm);
    setVariantDialog('create');
    setError(null);
  }

  function openEditVariant(variant: Variant) {
    setEditingVariantId(variant.id);
    setVariantForm({
      name: variant.name,
      sku: variant.sku ?? '',
      unitOfMeasure: variant.unitOfMeasure,
      sellingPrice: variant.sellingPrice,
      costPrice: variant.costPrice,
    });
    setVariantDialog('edit');
    setError(null);
  }

  async function submitVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProduct) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: variantForm.name.trim(),
        sku: variantForm.sku.trim() || null,
        unitOfMeasure: variantForm.unitOfMeasure.trim(),
        sellingPrice: variantForm.sellingPrice.trim(),
        costPrice: variantForm.costPrice.trim(),
      };
      const csrf = await getCsrfToken();
      const updated =
        variantDialog === 'create'
          ? await api.post<Variant>(
              `/products/${selectedProduct.id}/variants`,
              payload,
              csrf,
            )
          : await api.patch<Variant>(
              `/products/${selectedProduct.id}/variants/${editingVariantId}`,
              payload,
              csrf,
            );
      void updated;
      const product = await api.get<Product>(`/products/${selectedProduct.id}`);
      setSelectedProduct(product);
      setVariantDialog(null);
      setNotice(variantDialog === 'create' ? 'Variant added.' : 'Variant updated.');
      await loadData(search, statusFilter);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeVariantStatus(variant: Variant) {
    if (!selectedProduct) return;
    const nextActive = !variant.isActive;
    const message = nextActive
      ? `Activate the “${variant.name}” variant?`
      : `Deactivate the “${variant.name}” variant? Historical references will be retained.`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(
        `/products/${selectedProduct.id}/variants/${variant.id}/status`,
        { isActive: nextActive },
        await getCsrfToken(),
      );
      setSelectedProduct(await api.get<Product>(`/products/${selectedProduct.id}`));
      setNotice(nextActive ? 'Variant activated.' : 'Variant deactivated.');
      await loadData(search, statusFilter);
    } catch (statusError) {
      setError(getErrorMessage(statusError));
    } finally {
      setSaving(false);
    }
  }

  function openCreateCategory() {
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryDialog('create');
    setError(null);
  }

  function openEditCategory(category: Category) {
    setEditingCategoryId(category.id);
    setCategoryForm({
      name: category.name,
      description: category.description ?? '',
      parentId: category.parentId ?? '',
    });
    setCategoryDialog('edit');
    setError(null);
  }

  async function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: categoryForm.name.trim(),
        description: categoryForm.description.trim() || null,
        parentId: categoryForm.parentId || null,
      };
      const csrf = await getCsrfToken();
      if (categoryDialog === 'create') {
        await api.post<Category>('/categories', payload, csrf);
        setNotice('Category created.');
      } else if (editingCategoryId) {
        await api.patch<Category>(`/categories/${editingCategoryId}`, payload, csrf);
        setNotice('Category updated.');
      }
      setCategoryDialog(null);
      await refresh();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function changeCategoryStatus(category: Category) {
    const nextActive = !category.isActive;
    const message = nextActive
      ? `Activate the “${category.name}” category?`
      : `Deactivate the “${category.name}” category? Existing product links will be retained.`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(
        `/categories/${category.id}`,
        { isActive: nextActive },
        await getCsrfToken(),
      );
      setNotice(nextActive ? 'Category activated.' : 'Category deactivated.');
      await refresh();
    } catch (statusError) {
      setError(getErrorMessage(statusError));
    } finally {
      setSaving(false);
    }
  }

  const activeCategories = categories.filter(
    (category) => category.isActive && category.id !== editingCategoryId,
  );

  return (
    <div className="product-page">
      <div className="page-heading product-page-heading">
        <div>
          <p className="eyebrow">PRODUCT MANAGEMENT</p>
          <h1>Products</h1>
          <p className="muted-copy">
            Maintain the product records used by Dscentsation operations. Products are entered
            manually here; this workspace does not import the website catalogue.
          </p>
        </div>
        <div className="product-heading-actions">
          <span className="module-status-pill">Internal records</span>
          {view === 'products' ? (
            <button className="primary-button product-action-button" onClick={openCreateProduct}>
              Add product
            </button>
          ) : (
            <button className="primary-button product-action-button" onClick={openCreateCategory}>
              Add category
            </button>
          )}
        </div>
      </div>

      <div className="product-tabs" role="tablist" aria-label="Product workspace">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'products'}
          className={view === 'products' ? 'product-tab active' : 'product-tab'}
          onClick={() => {
            setView('products');
            setError(null);
            setNotice(null);
          }}
        >
          Products
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'categories'}
          className={view === 'categories' ? 'product-tab active' : 'product-tab'}
          onClick={() => {
            setView('categories');
            setSelectedProduct(null);
            setError(null);
            setNotice(null);
          }}
        >
          Categories
        </button>
      </div>

      {error && <p className="product-alert error" role="alert">{error}</p>}
      {notice && <p className="product-alert success" role="status">{notice}</p>}

      {view === 'products' && !selectedProduct && (
        <section className="product-card" aria-labelledby="product-list-title">
          <div className="product-card-heading">
            <div>
              <p className="eyebrow">CATALOGUE RECORDS</p>
              <h2 id="product-list-title">Product list</h2>
            </div>
            <span className="record-count">{products.length} records</span>
          </div>
          <form className="product-search" onSubmit={(event) => void handleSearch(event)}>
            <label className="search-control">
              <span>Search by product, internal code or SKU</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products…"
                maxLength={100}
              />
            </label>
            <label className="filter-control">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  const next = event.target.value as 'active' | 'archived' | 'all';
                  setStatusFilter(next);
                  void loadData(search, next);
                }}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All products</option>
              </select>
            </label>
            <button className="secondary-button search-button" type="submit">Search</button>
          </form>
          {loading ? (
            <div className="product-state" role="status">Loading products…</div>
          ) : products.length === 0 ? (
            <div className="product-state empty">
              <strong>No products found</strong>
              <span>Create a product manually or change your search and status filters.</span>
            </div>
          ) : (
            <div className="product-table-wrap">
              <table className="product-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Variants</th>
                    <th>Current selling price</th>
                    <th>Status</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const activeVariant = product.variants.find((variant) => variant.isActive);
                    return (
                      <tr key={product.id}>
                        <td>
                          <strong>{product.name}</strong>
                          <small>{product.internalCode || 'No internal code'}</small>
                        </td>
                        <td>{product.categoryName || 'Uncategorised'}</td>
                        <td>{product.variants.length}</td>
                        <td>{activeVariant ? formatNaira(activeVariant.sellingPrice) : '—'}</td>
                        <td>
                          <span className={product.status === 'active' ? 'status-label active' : 'status-label inactive'}>
                            {product.status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="table-link-button"
                            onClick={() => setSelectedProduct(product)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'products' && selectedProduct && (
        <section className="product-card product-detail" aria-labelledby="product-detail-title">
          <div className="detail-toolbar">
            <button type="button" className="text-button" onClick={() => setSelectedProduct(null)}>
              ← Back to products
            </button>
            <span className={selectedProduct.status === 'active' ? 'status-label active' : 'status-label inactive'}>
              {selectedProduct.status}
            </span>
          </div>
          <div className="product-card-heading detail-heading">
            <div>
              <p className="eyebrow">PRODUCT RECORD</p>
              <h2 id="product-detail-title">{selectedProduct.name}</h2>
              <p className="detail-description">
                {selectedProduct.description || 'No product description has been recorded.'}
              </p>
            </div>
            <div className="detail-actions">
              <button className="secondary-button" onClick={() => openEditProduct(selectedProduct)}>
                Edit details
              </button>
              <button
                className={selectedProduct.status === 'active' ? 'danger-button' : 'secondary-button'}
                disabled={saving}
                onClick={() => void changeProductStatus(selectedProduct)}
              >
                {selectedProduct.status === 'active' ? 'Archive product' : 'Activate product'}
              </button>
            </div>
          </div>
          <dl className="product-facts">
            <div><dt>Internal code</dt><dd>{selectedProduct.internalCode || '—'}</dd></div>
            <div><dt>Category</dt><dd>{selectedProduct.categoryName || 'Uncategorised'}</dd></div>
            <div><dt>Variants</dt><dd>{selectedProduct.variants.length}</dd></div>
          </dl>
          <div className="detail-section-heading">
            <div>
              <p className="eyebrow">SELLABLE UNITS</p>
              <h3>Variants and current prices</h3>
            </div>
            <button className="primary-button product-action-button" onClick={openCreateVariant}>
              Add variant
            </button>
          </div>
          <div className="product-table-wrap">
            <table className="product-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>SKU</th>
                  <th>Unit</th>
                  <th>Selling price</th>
                  <th>Cost price</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedProduct.variants.map((variant) => (
                  <tr key={variant.id}>
                    <td>
                      <strong>{variant.name}</strong>
                      {variant.isDefault && <small>Default variant</small>}
                    </td>
                    <td>{variant.sku || '—'}</td>
                    <td>{variant.unitOfMeasure}</td>
                    <td>{formatNaira(variant.sellingPrice)}</td>
                    <td>{formatNaira(variant.costPrice)}</td>
                    <td>
                      <span className={variant.isActive ? 'status-label active' : 'status-label inactive'}>
                        {variant.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="table-link-button" onClick={() => openEditVariant(variant)}>
                          Edit
                        </button>
                        <button
                          className="table-link-button"
                          disabled={saving}
                          onClick={() => void changeVariantStatus(variant)}
                        >
                          {variant.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === 'categories' && (
        <section className="product-card" aria-labelledby="category-list-title">
          <div className="product-card-heading">
            <div>
              <p className="eyebrow">PRODUCT ORGANISATION</p>
              <h2 id="category-list-title">Categories</h2>
            </div>
            <span className="record-count">{categories.length} categories</span>
          </div>
          {loading ? (
            <div className="product-state" role="status">Loading categories…</div>
          ) : categories.length === 0 ? (
            <div className="product-state empty">
              <strong>No categories yet</strong>
              <span>Create categories manually to organise product records.</span>
            </div>
          ) : (
            <div className="product-table-wrap">
              <table className="product-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Parent category</th>
                    <th>Products linked</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id}>
                      <td>
                        <strong>{category.name}</strong>
                        <small>{category.description || 'No description'}</small>
                      </td>
                      <td>{category.parentName || '—'}</td>
                      <td>{category.productCount}</td>
                      <td>
                        <span className={category.isActive ? 'status-label active' : 'status-label inactive'}>
                          {category.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button className="table-link-button" onClick={() => openEditCategory(category)}>
                            Edit
                          </button>
                          <button
                            className="table-link-button"
                            disabled={saving}
                            onClick={() => void changeCategoryStatus(category)}
                          >
                            {category.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {productDialog && (
        <div className="modal-backdrop">
          <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PRODUCT RECORD</p>
                <h2 id="product-form-title">{productDialog === 'create' ? 'Add a product' : 'Edit product details'}</h2>
              </div>
              <button className="modal-close" type="button" onClick={() => setProductDialog(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form className="record-form" onSubmit={(event) => void submitProduct(event)}>
              <label>
                Product name
                <input required maxLength={200} value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} />
              </label>
              <label>
                Description
                <textarea rows={3} maxLength={4000} value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} />
              </label>
              <div className="form-grid">
                <label>
                  Internal code (optional)
                  <input maxLength={80} value={productForm.internalCode} onChange={(event) => setProductForm({ ...productForm, internalCode: event.target.value })} />
                </label>
                <label>
                  Category
                  <select value={productForm.categoryId} onChange={(event) => setProductForm({ ...productForm, categoryId: event.target.value })}>
                    <option value="">No category</option>
                    {categories.filter((category) => category.isActive).map((category) => (
                      <option value={category.id} key={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {productDialog === 'create' && (
                <>
                  <div className="form-section-title">
                    <strong>Initial variant</strong>
                    <span>Every product starts with at least one variant.</span>
                  </div>
                  <div className="form-grid">
                    <label>
                      Variant / size label
                      <input required maxLength={120} value={productForm.variantName} onChange={(event) => setProductForm({ ...productForm, variantName: event.target.value })} />
                    </label>
                    <label>
                      SKU (optional)
                      <input maxLength={80} value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} />
                    </label>
                    <label>
                      Unit of measure
                      <input required maxLength={40} value={productForm.unitOfMeasure} onChange={(event) => setProductForm({ ...productForm, unitOfMeasure: event.target.value })} />
                    </label>
                    <label>
                      Selling price (NGN)
                      <input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?" value={productForm.sellingPrice} onChange={(event) => setProductForm({ ...productForm, sellingPrice: event.target.value })} />
                    </label>
                    <label>
                      Cost price (NGN)
                      <input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?" value={productForm.costPrice} onChange={(event) => setProductForm({ ...productForm, costPrice: event.target.value })} />
                    </label>
                  </div>
                </>
              )}
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setProductDialog(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? 'Saving…' : productDialog === 'create' ? 'Create product' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {variantDialog && selectedProduct && (
        <div className="modal-backdrop">
          <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="variant-form-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">VARIANT · {selectedProduct.name}</p>
                <h2 id="variant-form-title">{variantDialog === 'create' ? 'Add a variant' : 'Edit variant'}</h2>
              </div>
              <button className="modal-close" type="button" onClick={() => setVariantDialog(null)} aria-label="Close">×</button>
            </div>
            <form className="record-form" onSubmit={(event) => void submitVariant(event)}>
              <div className="form-grid">
                <label>
                  Variant / size label
                  <input required maxLength={120} value={variantForm.name} onChange={(event) => setVariantForm({ ...variantForm, name: event.target.value })} />
                </label>
                <label>
                  SKU (optional)
                  <input maxLength={80} value={variantForm.sku} onChange={(event) => setVariantForm({ ...variantForm, sku: event.target.value })} />
                </label>
                <label>
                  Unit of measure
                  <input required maxLength={40} value={variantForm.unitOfMeasure} onChange={(event) => setVariantForm({ ...variantForm, unitOfMeasure: event.target.value })} />
                </label>
                <label>
                  Selling price (NGN)
                  <input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?" value={variantForm.sellingPrice} onChange={(event) => setVariantForm({ ...variantForm, sellingPrice: event.target.value })} />
                </label>
                <label>
                  Cost price (NGN)
                  <input required inputMode="decimal" pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?" value={variantForm.costPrice} onChange={(event) => setVariantForm({ ...variantForm, costPrice: event.target.value })} />
                </label>
              </div>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setVariantDialog(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save variant'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {categoryDialog && (
        <div className="modal-backdrop">
          <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="category-form-title">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PRODUCT ORGANISATION</p>
                <h2 id="category-form-title">{categoryDialog === 'create' ? 'Add a category' : 'Edit category'}</h2>
              </div>
              <button className="modal-close" type="button" onClick={() => setCategoryDialog(null)} aria-label="Close">×</button>
            </div>
            <form className="record-form" onSubmit={(event) => void submitCategory(event)}>
              <label>
                Category name
                <input required maxLength={120} value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} />
              </label>
              <label>
                Description (optional)
                <textarea rows={3} maxLength={2000} value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} />
              </label>
              <label>
                Parent category (optional)
                <select value={categoryForm.parentId} onChange={(event) => setCategoryForm({ ...categoryForm, parentId: event.target.value })}>
                  <option value="">No parent</option>
                  {activeCategories.map((category) => (
                    <option value={category.id} key={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setCategoryDialog(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save category'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
