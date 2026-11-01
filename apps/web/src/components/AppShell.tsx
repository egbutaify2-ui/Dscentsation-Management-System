import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthenticatedUser } from '../features/auth/AuthProvider.js';

const navigation = [
  'Overview',
  'Orders',
  'Inventory',
  'Customers',
  'Suppliers',
  'Finance',
  'Reports',
];
const symbols = ['◫', '▤', '▥', '♙', '▧', '₦', '▦'];

export function AppShell({
  user,
  onLogout,
  children,
}: {
  user: AuthenticatedUser;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

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
          {navigation.map((item, index) => (
            <button
              key={item}
              type="button"
              className={`nav-item ${index === 0 ? 'nav-active' : 'nav-disabled'}`}
              disabled={index !== 0}
              aria-current={index === 0 ? 'page' : undefined}
              title={index === 0 ? 'Overview' : 'Module not yet implemented'}
            >
              <span className="nav-symbol" aria-hidden="true">
                {symbols[index]}
              </span>
              <span>{item}</span>
              {index !== 0 && <span className="nav-soon">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="status-dot" />
            Foundation environment
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
            <strong>Overview</strong>
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
          <span>Internal workspace · Foundation release</span>
        </footer>
      </div>
    </div>
  );
}
