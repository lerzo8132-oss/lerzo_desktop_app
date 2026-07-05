import React, { Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Book,
  Briefcase,
  ChevronDown,
  ClipboardList,
  Clock,
  Crown,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageCircle,
  Settings,
  Tag,
  Users,
} from 'lucide-react';
import AppErrorBoundary from './components/AppErrorBoundary';
import LerzoLogoLoader from './components/LerzoLogoLoader';
import { AppShellProvider } from './context/AppShellContext';
import { AuthProvider, useAuth, useBootRouteReady } from './context/AuthContext';
import { useExistingFlaskScripts } from './hooks/useExistingFlaskScripts';
import AuthErrorPage from './pages/AuthErrorPage';
import DashboardLoadErrorPage from './pages/DashboardLoadErrorPage';
import { defaultPagePath, templatePages } from './pages/templateRegistry.ts';
import ServerDownPage from './pages/ServerDownPage';
import WhatsAppPage from './pages/WhatsAppPage';
import { APP_LOGO_SRC } from './config/assets';

const publicPaths = new Set([
  '/auth-login',
  '/auth-register',
  '/auth-complete_registration',
  '/auth-error',
  '/server-down',
]);

const settingsNavItems = [
  ['Profile', '/settings-profile', Settings],
  ['Billing & Invoices', '/settings-invoices', FileText],
  ['Attendance', '/settings-attendance', MapPin],
  ['Backup', '/settings-backup', Book],
] as const;

const navGroups = [
  {
    label: 'Main Menu',
    items: [
      ['Dashboard', '/dashboard', LayoutDashboard],
      ['WhatsApp', '/whatsapp-dashboard', MessageCircle],
      ['Students', '/students-list', Users],
      ['Enquiries', '/enquiries-list', ClipboardList],
      ['Batches', '/batches-list', Clock],
      ['Schemes', '/schemes-list', Tag],
      ['Courses', '/courses-list', Book],
    ],
  },
  {
    label: 'Analytics & Tools',
    items: [
      ['Reports', '/reports', BarChart3],
      ['Staff', '/staff-list', Briefcase],
      ['Subscription', '/subscription-plans', Crown],
      ['Notifications', '/notifications', Bell],
    ],
  },
] as const;

function SettingsNavGroup() {
  const location = useLocation();
  const isActive = settingsNavItems.some(([, path]) => location.pathname === path);
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    setOpen(isActive);
  }, [isActive]);

  return (
    <div className="nav-settings-group">
      <button
        type="button"
        className={`nav-link-item nav-settings-toggle ${isActive ? 'active' : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Settings className="w-5 h-5" />
        <span>Settings</span>
        <ChevronDown className={`w-4 h-4 nav-settings-chevron ${open ? 'open' : ''}`} />
      </button>
      {open ? (
        <div className="nav-settings-submenu">
          {settingsNavItems.map(([label, path, Icon]) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive: itemActive }) => `nav-settings-item ${itemActive ? 'active' : ''}`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const DashboardComponent = templatePages.find((page) => page.path === '/dashboard')?.component;

// Renders the dashboard and, once mounted, acknowledges a completing desktop
// login to the main process (only ever after the dashboard is on screen).
function DashboardRoute() {
  const { notifyDashboardMounted } = useAuth();
  useEffect(() => {
    notifyDashboardMounted();
  }, [notifyDashboardMounted]);
  return DashboardComponent ? <DashboardComponent /> : <DashboardLoadErrorPage />;
}
const userFacingTemplatePages = templatePages.filter((page) => (
  page.path !== '/dashboard' &&
  page.path !== '/settings-developer_tools' &&
  page.path !== '/settings-api_monitor' &&
  page.category !== 'components'
));

class PageErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Renderer Error] render crash =', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-32">
          <div className="card template-error">
            <h1 className="page-title">Page could not load</h1>
            <p className="label-meta">{this.state.error.message || 'Something went wrong while opening this page.'}</p>
            <button className="btn btn-primary" type="button" onClick={() => this.setState({ error: null })}>
              Retry
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              style={{ marginLeft: 12 }}
              onClick={() => { window.location.hash = '#/server-down'; }}
            >
              Open Recovery Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function LoadingScreen({ message = 'Loading your workspace...' }: { message?: string }) {
  return <LerzoLogoLoader visible label={message} />;
}

function Sidebar() {
  const { user, logout } = useAuth();
  const displayName = user?.name || user?.email || '';
  const subscriptionStatus = user?.subscription?.status || 'Active';
  const avatar = user?.profile_pic || user?.avatar;

  return (
    <aside className="sidebar w-64 flex flex-col px-4 py-8 h-full" id="sidebar">
      <div className="flex items-center gap-3 mb-10 px-4">
        <img src={APP_LOGO_SRC} alt="Lerzo Logo" className="app-logo" />
        <span className="text-xl font-black tracking-tight app-name">Lerzo</span>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto pr-1" style={{ minHeight: 0, scrollbarWidth: 'thin' }}>
        {navGroups.map((group) => (
          <div className="nav-section" key={group.label}>
            <p className="nav-label">{group.label}</p>
            {group.items.map(([label, to, Icon]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-link-item ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </NavLink>
            ))}
            {group.label === 'Analytics & Tools' ? <SettingsNavGroup /> : null}
          </div>
        ))}
      </nav>

      {user && (
        <div className="sidebar-footer">
          <div className="user-profile-sidebar">
            <div className="avatar">
              {avatar ? <img src={avatar} alt={displayName} /> : displayName.charAt(0).toUpperCase()}
            </div>
            <div className="user-info">
              <span className="user-name">{displayName}</span>
              <span className="user-role">{subscriptionStatus}</span>
            </div>
            <button className="btn-icon" title="Logout" onClick={() => void logout()}>
              <LogOut />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

function AppRoutes() {
  const location = useLocation();
  const { bootReady, loginCompleting, refreshing, isAuthenticated, authError } = useAuth();
  const isPublicPath = publicPaths.has(location.pathname);

  useBootRouteReady();
  useExistingFlaskScripts();

  if (!bootReady) {
    return null;
  }

  // Desktop login is an intermediate state: while it completes and we are not yet
  // authenticated, hold the loader and make NO routing decision (never bounce to
  // /auth-login). Once authenticated, fall through so the dashboard can render.
  if (loginCompleting && !isAuthenticated) {
    return <LoadingScreen message="Signing you in..." />;
  }

  if (!isAuthenticated && authError && !isPublicPath && location.pathname !== '/auth-error') {
    const message = encodeURIComponent(authError);
    return <Navigate to={`/auth-error?message=${message}`} replace />;
  }

  if (!isAuthenticated && !isPublicPath && !loginCompleting) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth-login?next=${next}`} replace />;
  }

  if (isAuthenticated && isPublicPath && location.pathname !== '/auth-error') {
    return <Navigate to={defaultPagePath} replace />;
  }

  const routes = (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingScreen message="Loading page..." />}>
        <Routes>
          <Route path="/" element={<Navigate to={isAuthenticated ? defaultPagePath : '/auth-login'} replace />} />
          <Route path="/server-down" element={<ServerDownPage />} />
          <Route path="/auth-error" element={<AuthErrorPage />} />
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/c/:unique_id/dashboard" element={<DashboardRoute />} />
          <Route path="/whatsapp-dashboard" element={<WhatsAppPage page="dashboard" />} />
          <Route path="/whatsapp-contacts" element={<WhatsAppPage page="contacts" />} />
          <Route path="/whatsapp-templates" element={<WhatsAppPage page="templates" />} />
          <Route path="/whatsapp-campaigns" element={<WhatsAppPage page="campaigns" />} />
          <Route path="/whatsapp-logs" element={<WhatsAppPage page="logs" />} />
          <Route path="/whatsapp-analytics" element={<WhatsAppPage page="analytics" />} />
          <Route path="/whatsapp-settings" element={<WhatsAppPage page="settings" />} />
          {userFacingTemplatePages.map(({ path, component: Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route path="*" element={<ServerDownPage />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  );

  if (!isAuthenticated) {
    return (
      <div className="auth-only">
        {routes}
      </div>
    );
  }

  return (
    <div className="app-container electron-mode">
      <header className="titlebar">
        <div className="titlebar-left">
          <img src={APP_LOGO_SRC} alt="Lerzo Logo" className="app-logo" />
          <span className="app-name">Lerzo</span>
        </div>
        {refreshing ? <span className="titlebar-status">Syncing account...</span> : null}
      </header>

      <div className="main-layout h-full overflow-hidden">
        <Sidebar />
        <main className="content-area">
          {refreshing ? (
            <div className="auth-refresh-banner" role="status">Refreshing your session...</div>
          ) : null}
          {routes}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <AppShellProvider>
          <AppRoutes />
        </AppShellProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}
