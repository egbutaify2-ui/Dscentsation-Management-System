import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '../features/auth/AuthProvider.js';

type Section = 'overview' | 'products' | 'employees';
type NavigationItem = { label: string; section?: Section; symbol: string; enabled: boolean };

export function AppShell({
  user,
  permissions,
  activeSection,
  onNavigate,
  onLogout,
  children,
}: {
  user: AuthenticatedUser;
  permissions: string[];
  activeSection: Section;
  onNavigate: (section: Section) => void;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const productVisible = permissions.includes('products.view');
  const employeesVisible = permissions.includes('users.view');
  const navigation: NavigationItem[] = [
    { label: 'Overview', section: 'overview' as const, symbol: '◫', enabled: true },
    ...(productVisible
      ? [{ label: 'Products', section: 'products' as const, symbol: '◈', enabled: true }]
      : []),
    ...(employeesVisible
      ? [{ label: 'Employees', section: 'employees' as const, symbol: '♙', enabled: true }]
      : []),
    { label: 'Orders', symbol: '▤', enabled: false },
    { label: 'Inventory', symbol: '▥', enabled: false },
    { label: 'Customers', symbol: '♙', enabled: false },
    { label: 'Suppliers', symbol: '▧', enabled: false },
    { label: 'Finance', symbol: '₦', enabled: false },
    { label: 'Reports', symbol: '▦', enabled: false },
  ];

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await onLogout();
    } catch {
      setLogoutError('We could not safely end the session. Please try again.');
      setLoggingOut(false);
    }
  }

  function navigate(section: Section) {
    onNavigate(section);
    setMenuOpen(false);
  }

  const activeLabel =
    activeSection === 'products'
      ? 'Products'
      : activeSection === 'employees'
        ? 'Employees'
        : 'Overview';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            D
          </div>
          <div>
            <p className="brand-name">
              DSCENT<span>ATION</span>
            </p>
            <p className="brand-caption">MANAGEMENT SYSTEM</p>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="main-navigation">
          {navigation.map((item) => {
            const active = item.enabled && item.section === activeSection;
            return (
              <button
                key={item.label}
                type="button"
                className={`nav-item ${active ? 'nav-active' : ''} ${!item.enabled ? 'nav-disabled' : ''}`}
                disabled={!item.enabled}
                aria-current={active ? 'page' : undefined}
                title={item.enabled ? item.label : 'Module not yet implemented'}
                onClick={() => {
                  if (item.enabled && item.section) navigate(item.section);
                }}
              >
                <span className="nav-symbol" aria-hidden="true">
                  {item.symbol}
                </span>
                <span>{item.label}</span>
                {!item.enabled && <span className="nav-soon">Soon</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="status-dot" />
            Internal workspace
          </div>
          <div className="sidebar-user">
            <div className="user-avatar" aria-hidden="true">
              {user.displayName.trim().charAt(0).toUpperCase()}
            </div>
            <div className="user-summary">
              <strong>{user.displayName}</strong>
              <span>{user.roleName}</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button
            className="mobile-menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ☰
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{activeLabel}</strong>
          </div>
          <div className="topbar-right">
            <span className="topbar-role">{user.roleName}</span>
            <button
              type="button"
              className="logout-button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>
        {logoutError && (
          <p className="toast-error" role="alert">
            {logoutError}
          </p>
        )}
        <main>{children}</main>
        <footer className="app-footer">
          <span>Dscentsation Management System</span>
          <span>Internal workspace · Account and Product Management</span>
        </footer>
      </div>
    </div>
  );
}
