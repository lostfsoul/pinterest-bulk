import { FormEvent, useState } from 'react';
import { Database, FileX2, LockKeyhole, ShieldAlert, X } from 'lucide-react';
import apiClient from '../services/api';
import { Button } from '../components/Button';

type AdminAction = 'delete-svgs' | 'clear-database';

const actionDetails: Record<AdminAction, {
  title: string;
  description: string;
  phrase: string;
}> = {
  'delete-svgs': {
    title: 'Delete all SVG templates',
    description: 'Deletes every template and overlay. Existing pins keep their images but lose their template assignment.',
    phrase: 'DELETE SVG',
  },
  'clear-database': {
    title: 'Clear application database',
    description: 'Deletes websites, pages, keywords, images, pins, templates, jobs, logs, presets, fonts and generated files.',
    phrase: 'CLEAR DATABASE',
  },
};

export default function SuperAdmin() {
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingAction, setPendingAction] = useState<AdminAction | null>(null);
  const [confirmation, setConfirmation] = useState('');

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await apiClient.verifySuperAdmin(password);
      setUnlocked(true);
    } catch {
      setError('Invalid super admin password.');
    } finally {
      setSubmitting(false);
    }
  }

  function openConfirmation(action: AdminAction) {
    setPendingAction(action);
    setConfirmation('');
    setError('');
    setNotice('');
  }

  function closeConfirmation() {
    if (submitting) return;
    setPendingAction(null);
    setConfirmation('');
  }

  async function executeAction() {
    if (!pendingAction) return;
    const details = actionDetails[pendingAction];
    if (confirmation !== details.phrase) return;

    setSubmitting(true);
    setError('');
    try {
      const response = pendingAction === 'delete-svgs'
        ? await apiClient.deleteAllSvgs(password)
        : await apiClient.clearDatabase(password);
      setNotice(
        `${response.data.message} ${response.data.deleted_records} records and ${response.data.deleted_files} files removed.`,
      );
      setPendingAction(null);
      setConfirmation('');
      localStorage.removeItem('active_website_id');
      localStorage.removeItem('active_generation_job_id');
    } catch (actionError: any) {
      setError(actionError?.response?.data?.detail || 'The maintenance action failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
        <section className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <h1>Super Admin</h1>
          <p className="mt-2 text-sm text-slate-500">Enter the maintenance password to continue.</p>
          <form className="mt-6 space-y-4" onSubmit={unlock}>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full justify-center" disabled={submitting || !password}>
              {submitting ? 'Verifying...' : 'Unlock'}
            </Button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <div className="flex items-center gap-2 text-sm font-medium text-red-700">
          <ShieldAlert className="h-4 w-4" />
          Restricted maintenance
        </div>
        <h1 className="mt-2">Super Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Destructive operations cannot be undone.</p>
      </header>

      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <FileX2 className="h-6 w-6 text-amber-600" />
          <h2 className="mt-4 text-base">Delete SVG templates</h2>
          <p className="mt-2 min-h-10 text-sm text-slate-500">
            Remove all uploaded templates and generated overlays without deleting websites or pins.
          </p>
          <Button
            variant="danger"
            className="mt-5"
            onClick={() => openConfirmation('delete-svgs')}
          >
            Delete SVGs
          </Button>
        </section>

        <section className="rounded-lg border border-red-200 bg-white p-5 shadow-sm">
          <Database className="h-6 w-6 text-red-600" />
          <h2 className="mt-4 text-base">Clear database</h2>
          <p className="mt-2 min-h-10 text-sm text-slate-500">
            Reset all application content and generated files while keeping the application configuration.
          </p>
          <Button
            variant="danger"
            className="mt-5"
            onClick={() => openConfirmation('clear-database')}
          >
            Clear Database
          </Button>
        </section>
      </div>

      {pendingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg">{actionDetails[pendingAction].title}</h2>
                <p className="mt-2 text-sm text-slate-500">{actionDetails[pendingAction].description}</p>
              </div>
              <button
                type="button"
                onClick={closeConfirmation}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                aria-label="Close confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block text-sm font-medium text-slate-700">
              Type <span className="font-mono text-red-700">{actionDetails[pendingAction].phrase}</span> to confirm
            </label>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-2 w-full px-3 py-2 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
              autoFocus
            />

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={closeConfirmation} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={executeAction}
                disabled={submitting || confirmation !== actionDetails[pendingAction].phrase}
              >
                {submitting ? 'Deleting...' : 'Confirm Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
