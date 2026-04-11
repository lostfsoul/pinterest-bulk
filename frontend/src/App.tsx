import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import './index.css';
import apiClient, { GenerationJob, Website } from './services/api';
import { Button } from './components/Button';

// Lazy load pages
const Websites = lazy(() => import('./pages/Websites'));
const WebsiteDetail = lazy(() => import('./pages/WebsiteDetail'));
const Generate = lazy(() => import('./pages/Generate'));
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
  const [activeWebsiteHasPins, setActiveWebsiteHasPins] = useState(false);
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
    if (!activeWebsiteId) {
      setActiveWebsiteHasPins(false);
      return;
    }

    let cancelled = false;
    void apiClient.listPins({ website_id: Number(activeWebsiteId) })
      .then((response) => {
        if (!cancelled) {
          setActiveWebsiteHasPins(response.data.length > 0);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load website pin mode in layout:', error);
          setActiveWebsiteHasPins(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWebsiteId]);

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
  const workflowLabel = activeWebsiteHasPins ? 'Calendar' : 'Onboarding';

  const generationBannerTitle =
    activeGenerationJob?.status === 'completed'
      ? 'Generation Complete'
      : activeGenerationJob?.status === 'failed'
        ? 'Generation Failed'
        : 'Generation Running';

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile Header */}
        <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b-2 border-black z-40 flex items-center justify-between px-4 shadow-brutal-sm">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 -ml-2"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="min-w-0 text-center px-2">
          <h1 className="text-sm font-black uppercase">Pinterest CSV</h1>
          <div
            className="mt-1 inline-flex h-9 max-w-full items-center gap-2 border-2 border-black bg-lime-300 px-3"
          >
            <span className="inline-flex h-3 w-3 shrink-0 rounded-full border border-black bg-green-600" />
            <span className="max-w-[220px] truncate text-sm font-black">
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
              <NavItem to="/generate" onClick={() => setSidebarOpen(false)}>{workflowLabel}</NavItem>
              <NavItem to="/export" onClick={() => setSidebarOpen(false)}>Export</NavItem>
              <NavItem to="/websites" onClick={() => setSidebarOpen(false)}>Websites</NavItem>
              <NavItem to="/settings" onClick={() => setSidebarOpen(false)}>Settings</NavItem>
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
          <h1 className="text-xl font-black uppercase">CSV Pin Tool</h1>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem to="/generate">{workflowLabel}</NavItem>
          <NavItem to="/export">Export</NavItem>
          <NavItem to="/websites">Websites</NavItem>
          <NavItem to="/settings">Settings</NavItem>
        </nav>

        <div className="pt-4 border-t-2 border-black text-xs space-y-3">
          <Button
            size="sm"
            onClick={() => navigate('/websites')}
            className="w-full"
          >
            Add Website
          </Button>
          <div>
            <label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Switch Website</label>
            <select
              value={activeWebsiteId}
              onChange={(event) => handleWebsiteSwitch(event.target.value ? Number(event.target.value) : '')}
              className="w-full px-2 py-1 border-2 border-black text-xs"
            >
              <option value="">Select Website</option>
              {websites.map((website) => (
                <option key={website.id} value={website.id}>{website.name}</option>
              ))}
            </select>
          </div>
          <div className="text-[10px] bg-bg-secondary border border-black px-2 py-1">
            Website connected • Pinterest not connected
          </div>
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
      <main className="flex-1 overflow-auto pt-16 lg:pt-0">
        <div className="hidden lg:flex h-14 items-center justify-between px-6 border-b-2 border-black bg-white sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-7 h-7 bg-accent text-white border border-black flex items-center justify-center text-xs font-black">P</span>
            <div
              className="min-w-[420px] max-w-[620px] h-12 border-2 border-black bg-lime-300 px-4 flex items-center justify-between gap-4 overflow-hidden"
            >
              <div className="min-w-0 flex items-center gap-3 overflow-hidden">
                <span className="inline-flex h-3.5 w-3.5 shrink-0 rounded-full border border-black bg-green-600" />
                <div className="shrink-0 text-[10px] font-black uppercase tracking-[0.14em] text-black/75">
                  Active Website
                </div>
                <div
                  className="min-w-0 truncate text-lg font-black leading-none text-black"
                  style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif" }}
                >
                  {activeWebsiteDomain || activeWebsiteLabel}
                </div>
              </div>
              <span className="shrink-0 border border-black bg-white/70 px-2 py-0.5 text-[10px] font-black uppercase text-black">
                {activeWebsite ? 'Live' : 'None'}
              </span>
              {activeWebsite && (
                <span className="shrink-0 border border-black bg-white/70 px-2 py-0.5 text-[10px] font-black uppercase text-black">
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
          <div className="sticky top-0 lg:top-14 z-10 border-b-2 border-black bg-yellow-100 px-4 lg:px-6 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-black uppercase">
                  <span>{generationBannerTitle}</span>
                  <span>{mapJobPercent(activeGenerationJob)}%</span>
                </div>
                <div className="mt-1 text-sm font-medium text-black truncate">
                  {activeGenerationJob.message || 'Background generation in progress'}
                </div>
                <div className="mt-2 h-3 max-w-xl border border-black bg-white overflow-hidden">
                  <div
                    className="h-full bg-accent"
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
        <div className="p-4 lg:p-8">
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
          <Route path="/export" element={<Export />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/ai-settings" element={<Navigate to="/settings" replace />} />
          <Route path="/keywords" element={<Navigate to="/settings" replace />} />
          <Route path="/templates" element={<Navigate to="/settings" replace />} />
          <Route path="/images" element={<Navigate to="/generate" replace />} />
          <Route path="/schedule" element={<Navigate to="/generate" replace />} />
          <Route path="/activity" element={<Navigate to="/generate" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
