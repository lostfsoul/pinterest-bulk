import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { Website } from '../services/api';
import { Button } from '../components/Button';

export default function Websites() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', url: '', sitemap_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadWebsites();
  }, []);

  const loadWebsites = async () => {
    try {
      const response = await apiClient.listWebsites();
      setWebsites(response.data);
    } catch (error) {
      console.error('Failed to load websites:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await apiClient.createWebsite(formData);
      setFormData({ name: '', url: '', sitemap_url: '' });
      setShowForm(false);
      loadWebsites();
    } catch (error) {
      console.error('Failed to create website:', error);
      alert('Failed to create website');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this website and all its pages?')) return;

    try {
      await apiClient.deleteWebsite(id);
      loadWebsites();
    } catch (error) {
      console.error('Failed to delete website:', error);
      alert('Failed to delete website');
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading websites...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase text-black font-mono">Websites</h1>
          <p className="text-gray-600 mt-1 font-bold font-mono">Manage websites and import pages from sitemaps</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Website'}
        </Button>
      </div>

      {showForm && (
        <div className="bg-white border-2 border-black shadow-brutal p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-black mb-1">
                Name
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black focus:outline-none focus:shadow-brutal-sm"
                placeholder="My Blog"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-black mb-1">
                Website URL
              </label>
              <input
                type="url"
                required
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black focus:outline-none focus:shadow-brutal-sm"
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-black mb-1">
                Sitemap URL (optional)
              </label>
              <input
                type="url"
                value={formData.sitemap_url}
                onChange={(e) => setFormData({ ...formData, sitemap_url: e.target.value })}
                className="w-full px-3 py-2 border-2 border-black focus:outline-none focus:shadow-brutal-sm"
                placeholder="https://example.com/sitemap.xml"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Website'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {websites.length === 0 ? (
        <div className="bg-white border-2 border-black shadow-brutal p-8 sm:p-12 text-center">
          <p className="text-gray-500 font-mono">No websites yet. Add your first website to get started.</p>
        </div>
      ) : (
        <div className="bg-white border-2 border-black shadow-brutal overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead className="bg-bg-secondary border-b-2 border-black">
                <tr>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-black uppercase">Name</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-black uppercase hidden sm:table-cell">URL</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-black uppercase">Pages</th>
                  <th className="px-4 sm:px-6 py-3 text-left text-xs font-black uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {websites.map((website) => (
                  <tr key={website.id} className="hover:bg-bg-secondary">
                    <td className="px-4 sm:px-6 py-4">
                      <div className="text-sm font-bold text-black">{website.name}</div>
                    </td>
                    <td className="px-4 sm:px-6 py-4 hidden sm:table-cell">
                      <div className="text-sm text-gray-600 truncate max-w-[150px] lg:max-w-xs">{website.url}</div>
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <span className="text-sm font-bold text-black">
                        {website.enabled_pages_count || 0} / {website.pages_count || 0}
                      </span>
                      <span className="text-xs text-gray-500 ml-1 hidden sm:inline">enabled</span>
                    </td>
                    <td className="px-4 sm:px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigate(`/websites/${website.id}`)}
                          className="text-xs sm:text-sm font-bold uppercase hover:opacity-80"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDelete(website.id)}
                          className="text-xs sm:text-sm font-bold uppercase text-red-600 hover:opacity-80"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
