import type { AuthenticatedUser } from '../auth/AuthProvider.js';

const futureModules = ['Orders', 'Inventory', 'Customers', 'Suppliers', 'Finance', 'Reports'];

export function DashboardPage({ user }: { user: AuthenticatedUser }) {
  return (
    <div className="dashboard-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Welcome, {user.displayName.split(' ')[0]}</h1>
          <p className="muted-copy">
            Your Dscentsation workspace is ready. Business modules will appear here as they are
            implemented.
          </p>
        </div>
        <span className="foundation-status">
          <span className="status-dot" />
          Foundation
        </span>
      </div>
      <section className="foundation-panel" aria-labelledby="foundation-title">
        <div className="panel-icon" aria-hidden="true">
          D
        </div>
        <div>
          <p className="eyebrow">APPLICATION FOUNDATION</p>
          <h2 id="foundation-title">A clear place to manage the operation.</h2>
          <p>
            Authentication, role-aware access and the secure application shell are in place.
            Operational data will be shown when its business modules are delivered.
          </p>
        </div>
      </section>
      <section className="module-section" aria-labelledby="modules-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h2 id="modules-title">Business modules</h2>
          </div>
          <span className="section-note">Planned</span>
        </div>
        <div className="module-grid">
          {futureModules.map((module, index) => (
            <article className="module-card" key={module}>
              <div className="module-number">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <h3>{module}</h3>
                <p>Not available in this foundation release</p>
              </div>
              <span className="module-lock" aria-label="Not yet available">
                —
              </span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
