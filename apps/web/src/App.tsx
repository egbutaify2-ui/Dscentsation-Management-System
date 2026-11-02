import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell.js';
import { useAuth } from './features/auth/AuthProvider.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { ExpenseManagementPage } from './features/expenses/ExpenseManagementPage.js';
import { ProductManagementPage } from './features/products/ProductManagementPage.js';
import { SupplierManagementPage } from './features/suppliers/SupplierManagementPage.js';
import { EmployeeManagementPage } from './features/users/EmployeeManagementPage.js';
import { AcceptInvitationPage } from './features/users/AcceptInvitationPage.js';

type Section = 'overview' | 'products' | 'employees' | 'expenses' | 'suppliers';

function invitationTokenFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith('#/invite/accept?')) return null;
  const token = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('token');
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function App() {
  const { status, user, permissions, error, login, logout, refresh } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [invitationToken, setInvitationToken] = useState<string | null>(
    invitationTokenFromLocation,
  );
  const canViewProducts = permissions.includes('products.view');
  const canViewEmployees = permissions.includes('users.view');
  const canViewSuppliers = permissions.includes('suppliers.view');
  const canViewExpenses =
    permissions.includes('expenses.view') || permissions.includes('expense_categories.view');

  useEffect(() => {
    if (!canViewProducts && activeSection === 'products') setActiveSection('overview');
    if (!canViewEmployees && activeSection === 'employees') setActiveSection('overview');
    if (!canViewSuppliers && activeSection === 'suppliers') setActiveSection('overview');
    if (!canViewExpenses && activeSection === 'expenses') setActiveSection('overview');
  }, [activeSection, canViewProducts, canViewEmployees, canViewSuppliers, canViewExpenses]);

  useEffect(() => {
    if (invitationToken && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [invitationToken]);

  if (invitationToken) {
    return (
      <AcceptInvitationPage
        token={invitationToken}
        onAccepted={async () => {
          setInvitationToken(null);
          await refresh();
        }}
      />
    );
  }

  if (status === 'loading') {
    return (
      <main className="loading-screen">
        <div className="loading-mark">D</div>
        <p>Opening your workspace…</p>
      </main>
    );
  }
  if (status === 'error') {
    return (
      <main className="loading-screen">
        <div className="loading-mark">D</div>
        <h1>We could not connect</h1>
        <p>{error}</p>
        <button className="primary-button retry-button" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  }
  if (status !== 'authenticated' || !user) return <LoginPage onLogin={login} />;
  return (
    <AppShell
      user={user}
      permissions={permissions}
      activeSection={activeSection}
      onNavigate={setActiveSection}
      onLogout={logout}
    >
      {activeSection === 'products' && canViewProducts ? (
        <ProductManagementPage />
      ) : activeSection === 'employees' && canViewEmployees ? (
        <EmployeeManagementPage canManage={permissions.includes('users.manage')} />
      ) : activeSection === 'expenses' && canViewExpenses ? (
        <ExpenseManagementPage permissions={permissions} />
      ) : activeSection === 'suppliers' && canViewSuppliers ? (
        <SupplierManagementPage permissions={permissions} />
      ) : (
        <DashboardPage user={user} />
      )}
    </AppShell>
  );
}
