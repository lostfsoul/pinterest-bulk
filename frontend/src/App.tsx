import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import './index.css';
import apiClient from './services/api';

// Lazy load pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Websites = lazy(() => import('./pages/Websites'));
const WebsiteDetail = lazy(() => import('./pages/WebsiteDetail'));
const Keywords = lazy(() => import('./pages/Keywords'));
const Templates = lazy(() => import('./pages/Templates'));
const Images = lazy(() => import('./pages/Images'));
const Generate = lazy(() => import('./pages/Generate'));
const AISettings = lazy(() => import('./pages/AISettings'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Export = lazy(() => import('./pages/Export'));
const Activity = lazy(() => import('./pages/Activity'));
const Login = lazy(() => import('./pages/Login'));

function NavItem({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`block px-4 py-2 text-sm font-bold uppercase transition-transform hover:translate-x-[-2px] ${
        isActive
          ? 'bg-accent text-white border-2 border-black shadow-brutal-sm'
          : 'text-black hover:bg-bg-secondary border-2 border-transparent'
      }`}
    >
      {children}
    </Link>
  );
}

function Layout({
  children,
  onLogout,
  sidebarOpen,
  setSidebarOpen,
}: {
  children: React.ReactNode;
  onLogout: () => Promise<void>;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b-2 border-black z-40 flex items-center justify-between px-4 shadow-brutal-sm">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="text-sm font-black uppercase">Pinterest CSV</h1>
        <div className="w-10" />
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white border-r-2 border-black shadow-brutal p-4 flex flex-col">
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-xl font-black uppercase">Menu</h1>
              <button onClick={() => setSidebarOpen(false)} className="p-1">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <nav className="flex-1 space-y-1">
              <NavItem to="/" onClick={() => setSidebarOpen(false)}>Dashboard</NavItem>
              <NavItem to="/websites" onClick={() => setSidebarOpen(false)}>Websites</NavItem>
              <NavItem to="/keywords" onClick={() => setSidebarOpen(false)}>Keywords</NavItem>
              <NavItem to="/templates" onClick={() => setSidebarOpen(false)}>Templates</NavItem>
              <NavItem to="/images" onClick={() => setSidebarOpen(false)}>Images</NavItem>
              <NavItem to="/generate" onClick={() => setSidebarOpen(false)}>Generate</NavItem>
              <NavItem to="/ai-settings" onClick={() => setSidebarOpen(false)}>AI Settings</NavItem>
              <NavItem to="/schedule" onClick={() => setSidebarOpen(false)}>Schedule</NavItem>
              <NavItem to="/export" onClick={() => setSidebarOpen(false)}>Export</NavItem>
              <NavItem to="/activity" onClick={() => setSidebarOpen(false)}>Activity</NavItem>
            </nav>

            <div className="pt-4 border-t-2 border-black text-xs">
              <button
                onClick={() => {
                  void onLogout();
                }}
                className="mt-3 text-sm font-bold uppercase"
              >
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r-2 border-black shadow-brutal p-4 flex-col">
        <div className="mb-8">
          <h1 className="text-xl font-black uppercase">Pinterest CSV</h1>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem to="/">Dashboard</NavItem>
          <NavItem to="/websites">Websites</NavItem>
          <NavItem to="/keywords">Keywords</NavItem>
          <NavItem to="/templates">Templates</NavItem>
          <NavItem to="/images">Images</NavItem>
          <NavItem to="/generate">Generate</NavItem>
          <NavItem to="/ai-settings">AI Settings</NavItem>
          <NavItem to="/schedule">Schedule</NavItem>
          <NavItem to="/export">Export</NavItem>
          <NavItem to="/activity">Activity</NavItem>
        </nav>

        <div className="pt-4 border-t-2 border-black text-xs">
          <button
            onClick={() => {
              void onLogout();
            }}
            className="text-sm font-bold uppercase"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-4 lg:p-8 overflow-auto pt-16 lg:pt-8">
        <Suspense fallback={<div className="text-gray-500">Loading...</div>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    loadAuthStatus().catch((error) => {
      console.error('Failed to load auth status:', error);
      setAuthLoading(false);
    });
  }, []);

  async function loadAuthStatus() {
    const response = await apiClient.authStatus();
    setAuthEnabled(response.data.enabled);
    setAuthenticated(response.data.authenticated || !response.data.enabled);
    setAuthLoading(false);
  }

  async function handleLogout() {
    try {
      await apiClient.logout();
    } finally {
      setAuthenticated(false);
      setAuthEnabled(true);
    }
  }

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>;
  }

  if (authEnabled && !authenticated) {
    return (
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>}>
          <Login onAuthenticated={() => setAuthenticated(true)} />
        </Suspense>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Layout onLogout={handleLogout} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/websites" element={<Websites />} />
          <Route path="/websites/:id" element={<WebsiteDetail />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/images" element={<Images />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/ai-settings" element={<AISettings />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/export" element={<Export />} />
          <Route path="/activity" element={<Activity />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
