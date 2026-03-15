import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import './index.css';

// Lazy load pages
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Websites = lazy(() => import('./pages/Websites'));
const WebsiteDetail = lazy(() => import('./pages/WebsiteDetail'));
const Keywords = lazy(() => import('./pages/Keywords'));
const Templates = lazy(() => import('./pages/Templates'));
const Images = lazy(() => import('./pages/Images'));
const Generate = lazy(() => import('./pages/Generate'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Export = lazy(() => import('./pages/Export'));
const Activity = lazy(() => import('./pages/Activity'));

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <Link
      to={to}
      className={`block px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? 'bg-blue-50 text-blue-700'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {children}
    </Link>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-gray-900">Pinterest CSV Tool</h1>
          <p className="text-xs text-gray-500 mt-1">Local-only MVP</p>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem to="/">Dashboard</NavItem>
          <NavItem to="/websites">Websites</NavItem>
          <NavItem to="/keywords">Keywords</NavItem>
          <NavItem to="/templates">Templates</NavItem>
          <NavItem to="/images">Images</NavItem>
          <NavItem to="/generate">Generate</NavItem>
          <NavItem to="/schedule">Schedule</NavItem>
          <NavItem to="/export">Export</NavItem>
          <NavItem to="/activity">Activity</NavItem>
        </nav>

        <div className="pt-4 border-t border-gray-200 text-xs text-gray-500">
          <p>Local filesystem storage</p>
          <p>SQLite database</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        <Suspense fallback={<div className="text-gray-500">Loading...</div>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/websites" element={<Websites />} />
          <Route path="/websites/:id" element={<WebsiteDetail />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/images" element={<Images />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/export" element={<Export />} />
          <Route path="/activity" element={<Activity />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
