import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import './index.css';
import apiClient, { GenerationJob, Website } from './services/api';
import { Button } from './components/Button';
import {
  CalendarDays,
  FileOutput,
  FolderKanban,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';

// Lazy load pages
const Websites = lazy(() => import('./pages/Websites'));
const WebsiteDetail = lazy(() => import('./pages/WebsiteDetail'));
const Generate = lazy(() => import('./pages/Generate'));
const Playground = lazy(() => import('./pages/Playground'));
const Pages = lazy(() => import('./pages/Pages'));
const Export = lazy(() => import('./pages/Export'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

function NavItem({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: () => void }) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
        isActive
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </Link>
  );
}

function mapJobPercent(job: GenerationJob): number {
  if (job.status === 'completed' || job.phase === 'complete') return 100;
  if (job.status === 'failed' || job.phase === 'error') return 100;
  if (job.phase === 'rendering') {
    const total = Math.max(1, job.total_pins);
    return Math.round(60 + (job.rendered_pins / total) * 40);
  }
  if (job.phase === 'drafting') {
    const total = Math.max(1, job.total_pages);
    return Math.round(20 + (job.processed_pages / total) * 40);
  }
  if (job.phase === 'scraping') {
    const total = Math.max(1, job.total_pages);
    return Math.round(5 + (job.processed_pages / total) * 25);
  }
  return 5;
}

function isTerminalJob(job: GenerationJob | null): boolean {
  return Boolean(job && (job.status === 'completed' || job.status === 'failed' || job.phase === 'complete' || job.phase === 'error'));
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
  const navigate = useNavigate();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [activeWebsiteId, setActiveWebsiteId] = useState<number | ''>('');
  const [activeGenerationJob, setActiveGenerationJob] = useState<GenerationJob | null>(null);
  const [activeGenerationJobId, setActiveGenerationJobId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_generation_job_id');
    return stored ? Number(stored) : null;
  });
  const [dismissedGenerationJobId, setDismissedGenerationJobId] = useState<number | null>(() => {
    const stored = localStorage.getItem('dismissed_generation_job_id');
    return stored ? Number(stored) : null;
  });

  useEffect(() => {
    const stored = localStorage.getItem('active_website_id');
    const storedId = stored ? Number(stored) : null;
    if (storedId) setActiveWebsiteId(storedId);
    void apiClient.listWebsites().then((response) => {
      setWebsites(response.data);
      if (response.data.length > 0) {
        const id =
          (storedId && response.data.some((website) => website.id === storedId) ? storedId : null) ??
          response.data[0].id;
        setActiveWebsiteId(id);
        localStorage.setItem('active_website_id', String(id));
      }
    }).catch((error) => {
      console.error('Failed to load websites in layout:', error);
    });
  }, []);

  useEffect(() => {
    const onWebsiteSwitch = (event: Event) => {
      const custom = event as CustomEvent<number | null>;
      setActiveWebsiteId(custom.detail ?? '');
    };
    window.addEventListener('website-switch', onWebsiteSwitch as EventListener);
    return () => window.removeEventListener('website-switch', onWebsiteSwitch as EventListener);
  }, []);

  useEffect(() => {
    const onGenerationJobChange = (event: Event) => {
      const custom = event as CustomEvent<number | null>;
      setActiveGenerationJobId(custom.detail ?? null);
      if (custom.detail != null) {
        setDismissedGenerationJobId(null);
        localStorage.removeItem('dismissed_generation_job_id');
      }
    };
    window.addEventListener('generation-job-change', onGenerationJobChange as EventListener);
    return () => window.removeEventListener('generation-job-change', onGenerationJobChange as EventListener);
  }, []);

  useEffect(() => {
    if (!activeGenerationJobId) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await apiClient.getGenerationJob(activeGenerationJobId);
        if (cancelled) return;
        const job = response.data;
        setActiveGenerationJob(job);
        if (isTerminalJob(job)) {
          localStorage.removeItem('active_generation_job_id');
          setActiveGenerationJobId(null);
          window.dispatchEvent(new CustomEvent<number | null>('generation-job-change', { detail: null }));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to poll active generation job:', error);
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeGenerationJobId]);

  useEffect(() => {
    if (typeof activeWebsiteId !== 'number') {
      return;
    }
    if (activeGenerationJobId) {
      return;
    }

    let cancelled = false;
    const loadWebsiteWorkflowStatus = async () => {
      try {
        const response = await apiClient.getWorkflowStatus(activeWebsiteId);
        if (cancelled) return;
        if (response.data.has_active_job && response.data.active_job_id) {
          const nextId = response.data.active_job_id;
          localStorage.setItem('active_generation_job_id', String(nextId));
          setDismissedGenerationJobId(null);
          localStorage.removeItem('dismissed_generation_job_id');
          setActiveGenerationJobId(nextId);
          window.dispatchEvent(new CustomEvent<number>('generation-job-change', { detail: nextId }));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to resolve active workflow job for website:', error);
        }
      }
    };

    void loadWebsiteWorkflowStatus();
    return () => {
      cancelled = true;
    };
  }, [activeWebsiteId, activeGenerationJobId]);

  function handleWebsiteSwitch(value: number | '') {
    setActiveWebsiteId(value);
    if (!value) return;
    localStorage.setItem('active_website_id', String(value));
    window.dispatchEvent(new CustomEvent<number>('website-switch', { detail: Number(value) }));
  }

  function dismissGenerationBanner() {
    const jobId = activeGenerationJob?.id ?? activeGenerationJobId;
    if (jobId != null) {
      setDismissedGenerationJobId(jobId);
      localStorage.setItem('dismissed_generation_job_id', String(jobId));
      if (activeGenerationJob?.id === jobId && isTerminalJob(activeGenerationJob)) {
        setActiveGenerationJob(null);
      }
    }
  }

  const showGenerationBanner = Boolean(
    activeGenerationJob &&
      activeGenerationJob.id !== dismissedGenerationJobId,
  );
  const activeWebsite = websites.find((website) => website.id === activeWebsiteId) ?? null;
  const activeWebsiteLabel = activeWebsite?.name || 'No active website';
  const activeWebsiteDomain = activeWebsite?.url
    ? activeWebsite.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : '';
  const workflowLabel = 'Calendar';

  const generationBannerTitle =
    activeGenerationJob?.status === 'completed'
      ? 'Generation Complete'
      : activeGenerationJob?.status === 'failed'
        ? 'Generation Failed'
        : 'Generation Running';

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-40 flex items-center justify-between px-4">
        <button
          onClick={() => setSidebarOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-center px-2">
          <h1 className="text-sm font-semibold tracking-tight">Pinterest Tool</h1>
          <div
            className="mt-1 inline-flex h-8 max-w-full items-center gap-2 border border-slate-200 bg-slate-100 rounded-md px-3"
          >
            <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            <span className="max-w-[220px] truncate text-xs font-medium">
              {activeWebsiteDomain || activeWebsiteLabel}
            </span>
          </div>
        </div>
        <div className="w-10" />
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white border-r border-slate-200 p-4 flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-base font-semibold">Navigation</h1>
              <button onClick={() => setSidebarOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 space-y-1">
              <NavItem to="/generate" onClick={() => setSidebarOpen(false)}><CalendarDays className="h-4 w-4" /> {workflowLabel}</NavItem>
              <NavItem to="/pages" onClick={() => setSidebarOpen(false)}><FolderKanban className="h-4 w-4" /> Pages</NavItem>
              <NavItem to="/playground" onClick={() => setSidebarOpen(false)}><LayoutDashboard className="h-4 w-4" /> Playground</NavItem>
              <NavItem to="/export" onClick={() => setSidebarOpen(false)}><FileOutput className="h-4 w-4" /> Export</NavItem>
              <NavItem to="/websites" onClick={() => setSidebarOpen(false)}><Globe2 className="h-4 w-4" /> Websites</NavItem>
              <NavItem to="/settings" onClick={() => setSidebarOpen(false)}><SettingsIcon className="h-4 w-4" /> Settings</NavItem>
            </nav>

            <div className="pt-4 border-t border-slate-200 text-xs">
              <button
                onClick={() => {
                  void onLogout();
                }}
                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-72 bg-white border-r border-slate-200 p-5 flex-col">
        <div className="mb-7">
          <h1 className="text-lg font-semibold tracking-tight">Pinterest Pin Tool</h1>
          <p className="mt-1 text-xs text-slate-500">Content operations dashboard</p>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem to="/generate"><CalendarDays className="h-4 w-4" /> {workflowLabel}</NavItem>
          <NavItem to="/pages"><FolderKanban className="h-4 w-4" /> Pages</NavItem>
          <NavItem to="/playground"><LayoutDashboard className="h-4 w-4" /> Playground</NavItem>
          <NavItem to="/export"><FileOutput className="h-4 w-4" /> Export</NavItem>
          <NavItem to="/websites"><Globe2 className="h-4 w-4" /> Websites</NavItem>
          <NavItem to="/settings"><SettingsIcon className="h-4 w-4" /> Settings</NavItem>
        </nav>

        <div className="pt-4 border-t border-slate-200 text-xs space-y-3">
          <Button
            size="sm"
            onClick={() => navigate('/websites')}
            className="w-full"
          >
            Add Website
          </Button>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Switch Website</label>
            <select
              value={activeWebsiteId}
              onChange={(event) => handleWebsiteSwitch(event.target.value ? Number(event.target.value) : '')}
              className="w-full h-9 px-2 border border-slate-300 rounded-md text-xs bg-white"
            >
              <option value="">Select Website</option>
              {websites.map((website) => (
                <option key={website.id} value={website.id}>{website.name}</option>
              ))}
            </select>
          </div>
          <div className="text-[11px] bg-slate-100 border border-slate-200 rounded-md px-2 py-1.5 text-slate-600">
            Website connected • Pinterest not connected
          </div>
          <button
            onClick={() => {
              void onLogout();
            }}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-16 lg:pt-0">
        <div className="hidden lg:flex h-16 items-center justify-between px-6 border-b border-slate-200 bg-white sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 bg-blue-600 text-white rounded-md flex items-center justify-center text-xs font-semibold">P</span>
            <div
              className="min-w-[420px] max-w-[620px] h-11 border border-slate-200 bg-slate-50 rounded-md px-4 flex items-center justify-between gap-4 overflow-hidden"
            >
              <div className="min-w-0 flex items-center gap-3 overflow-hidden">
                <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  Active Website
                </div>
                <div
                  className="min-w-0 truncate text-sm font-semibold leading-none text-slate-900"
                  style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif" }}
                >
                  {activeWebsiteDomain || activeWebsiteLabel}
                </div>
              </div>
              <span className="shrink-0 border border-slate-200 bg-white rounded px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                {activeWebsite ? 'Live' : 'None'}
              </span>
              {activeWebsite && (
                <span className="shrink-0 border border-slate-200 bg-white rounded px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                  {activeWebsiteLabel}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => navigate('/export')}
              className="px-4 py-1.5 text-xs font-black uppercase"
            >
              Export
            </Button>
          </div>
        </div>
        {showGenerationBanner && activeGenerationJob && (
          <div className="sticky top-0 lg:top-16 z-10 border-b border-slate-200 bg-amber-50/70 px-4 lg:px-6 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase">
                  <span>{generationBannerTitle}</span>
                  <span>{mapJobPercent(activeGenerationJob)}%</span>
                </div>
                <div className="mt-1 text-sm font-medium text-black truncate">
                  {activeGenerationJob.message || 'Background generation in progress'}
                </div>
                <div className="mt-2 h-2.5 max-w-xl border border-slate-200 rounded bg-white overflow-hidden">
                  <div
                    className="h-full bg-blue-600"
                    style={{ width: `${mapJobPercent(activeGenerationJob)}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-gray-700">
                  {activeGenerationJob.phase === 'rendering'
                    ? `${activeGenerationJob.rendered_pins} / ${Math.max(1, activeGenerationJob.total_pins)} pins rendered`
                    : `${activeGenerationJob.processed_pages} / ${Math.max(1, activeGenerationJob.total_pages)} pages processed`}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {activeGenerationJob.status === 'completed' && (
                  <Button size="sm" onClick={() => navigate('/export')}>
                    Export
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={dismissGenerationBanner}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        )}
        <div className="p-4 lg:p-6 xl:p-8">
        <Suspense fallback={<div className="text-gray-500">Loading...</div>}>
          {children}
        </Suspense>
        </div>
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
          <Route path="/" element={<Navigate to="/generate" replace />} />
          <Route path="/websites" element={<Websites />} />
          <Route path="/websites/:id" element={<WebsiteDetail />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/pages" element={<Pages />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/export" element={<Export />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/ai-settings" element={<Navigate to="/settings" replace />} />
          <Route path="/keywords" element={<Navigate to="/settings" replace />} />
          <Route path="/templates" element={<Navigate to="/settings" replace />} />
          <Route path="/images" element={<Navigate to="/pages" replace />} />
          <Route path="/schedule" element={<Navigate to="/generate" replace />} />
          <Route path="/activity" element={<Navigate to="/generate" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
