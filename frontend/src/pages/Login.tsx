import { FormEvent, useState } from 'react';
import apiClient from '../services/api';
import { Button } from '../components/Button';

type LoginProps = {
  onAuthenticated: () => void;
};

export default function Login({ onAuthenticated }: LoginProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await apiClient.login(password);
      setPassword('');
      onAuthenticated();
    } catch (submitError) {
      console.error('Login failed:', submitError);
      setError('Invalid password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#dbeafe,transparent_45%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-white/70 bg-white/90 shadow-2xl shadow-slate-200 p-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-600">Protected App</p>
          <h1 className="mt-3 text-3xl font-black text-slate-900">Pinterest Bulk Tool</h1>
          <p className="mt-2 text-sm text-slate-500">Enter the app password to continue.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="App password"
              autoFocus
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button className="w-full justify-center" disabled={submitting || !password.trim()}>
            {submitting ? 'Unlocking...' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  );
}
