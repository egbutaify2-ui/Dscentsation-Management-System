import { useEffect, useState } from 'react';
import { AppShell } from './components/AppShell.js';
import { useAuth } from './features/auth/AuthProvider.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { ProductManagementPage } from './features/products/ProductManagementPage.js';

type Section = 'overview' | 'products';

export function App() {
  const { status, user, permissions, error, login, logout, refresh } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const canViewProducts = permissions.includes('products.view');

  useEffect(() => {
    if (!canViewProducts && activeSection === 'products') setActiveSection('overview');
  }, [activeSection, canViewProducts]);

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
      ) : (
        <DashboardPage user={user} />
      )}
    </AppShell>
  );
}
