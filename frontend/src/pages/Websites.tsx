import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { Website } from '../services/api';
import { Button } from '../components/Button';

type Platform = 'website' | 'etsy' | 'shopify' | 'third-party';

function normalizeBaseUrl(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  try {
    const parsed = new URL(value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

export default function Websites() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [platform, setPlatform] = useState<Platform>('website');
  const [editingWebsiteId, setEditingWebsiteId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: '', url: '', sitemap_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    void loadWebsites();
  }, []);

  async function loadWebsites() {
    try {
      const response = await apiClient.listWebsites();
      setWebsites(response.data);
    } catch (error) {
      console.error('Failed to load websites:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingWebsiteId) {
        await apiClient.updateWebsite(editingWebsiteId, formData);
      } else {
        await apiClient.createWebsite(formData);
      }
      closeWizard();
      await loadWebsites();
    } catch (error) {
      console.error('Failed to save website:', error);
      alert('Failed to save website');
    } finally {
      setSubmitting(false);
    }
  }

  function closeWizard() {
    setFormData({ name: '', url: '', sitemap_url: '' });
    setEditingWebsiteId(null);
    setShowWizard(false);
    setWizardStep(1);
    setPlatform('website');
  }

  function openCreateWizard() {
    setEditingWebsiteId(null);
    setFormData({ name: '', url: '', sitemap_url: '' });
    setWizardStep(1);
    setPlatform('website');
    setShowWizard(true);
  }

  function openEditWizard(website: Website) {
    setEditingWebsiteId(website.id);
    setFormData({
      name: website.name || '',
      url: website.url || '',
      sitemap_url: website.sitemap_url || '',
    });
    setWizardStep(2);
    setPlatform('website');
    setShowWizard(true);
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this website and all its pages?')) return;
    try {
      await apiClient.deleteWebsite(id);
      await loadWebsites();
    } catch (error) {
      console.error('Failed to delete website:', error);
      alert('Failed to delete website');
    }
  }

  const platformCards: Array<{ id: Platform; title: string; description: string; disabled?: boolean }> = [
    { id: 'website', title: 'Your Website', description: 'WordPress, WooCommerce, or custom site' },
    { id: 'etsy', title: 'Etsy Shop', description: 'Products from Etsy listings', disabled: true },
    { id: 'shopify', title: 'Shopify Store', description: 'Products, collections, blog posts', disabled: true },
    { id: 'third-party', title: 'Third-Party Platform', description: 'Manual URL pasting', disabled: true },
  ];

  if (loading) {
    return <div className="text-gray-500">Loading websites...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase text-black font-mono">Websites</h1>
          <p className="text-gray-600 mt-1 font-bold font-mono">Connect websites and import content via sitemaps</p>
        </div>
        <Button onClick={openCreateWizard}>Add Website</Button>
      </div>

      {showWizard && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white border-2 border-black shadow-brutal overflow-hidden">
            <div className="bg-accent text-white px-5 py-4">
              <h2 className="text-3xl font-black">Add a Website</h2>
              <p className="text-sm opacity-90 mt-1">{editingWebsiteId ? 'Edit the website connection.' : 'Choose what you want to connect.'}</p>
              <div className="mt-3 flex gap-2 text-xs font-bold">
                <span className={`px-2 py-1 border border-white ${wizardStep === 1 ? 'bg-white text-accent' : ''}`}>{editingWebsiteId ? '1. Edit' : '1. Choose platform'}</span>
                <span className={`px-2 py-1 border border-white ${wizardStep === 2 ? 'bg-white text-accent' : ''}`}>2. Configure</span>
              </div>
            </div>

            {wizardStep === 1 && !editingWebsiteId && (
              <div className="p-5 space-y-4">
                <h3 className="text-2xl font-black text-black">What do you want to connect?</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {platformCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => !card.disabled && setPlatform(card.id)}
                      className={`text-left border-2 p-4 transition ${
                        platform === card.id ? 'border-black bg-bg-secondary' : 'border-gray-300'
                      } ${card.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-black'}`}
                    >
                      <p className="font-black text-base">{card.title}</p>
                      <p className="text-xs text-gray-600 mt-1">{card.description}</p>
                      {card.id === 'website' && <span className="text-[10px] mt-2 inline-block px-2 py-0.5 bg-accent text-white font-bold">Recommended</span>}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={closeWizard}>Cancel</Button>
                  <Button onClick={() => setWizardStep(2)} disabled={platform !== 'website'}>Continue</Button>
                </div>
              </div>
            )}

            {wizardStep === 2 && (
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1">Website Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border-2 border-black"
                    placeholder="Nia Cooks"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">Website URL</label>
                  <input
                    type="url"
                    required
                    value={formData.url}
                    onChange={(e) => {
                      const url = e.target.value;
                      const base = normalizeBaseUrl(url);
                      setFormData((prev) => ({
                        ...prev,
                        url,
                        sitemap_url: base ? `${base}/sitemap_index.xml` : prev.sitemap_url,
                      }));
                    }}
                    className="w-full px-3 py-2 border-2 border-black"
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">Sitemap URL</label>
                  <input
                    type="url"
                    value={formData.sitemap_url}
                    onChange={(e) => setFormData((prev) => ({ ...prev, sitemap_url: e.target.value }))}
                    className="w-full px-3 py-2 border-2 border-black"
                    placeholder="https://example.com/sitemap_index.xml"
                  />
                </div>
                <div className="flex justify-between gap-2">
                  <Button type="button" variant="secondary" onClick={() => (editingWebsiteId ? closeWizard() : setWizardStep(1))}>
                    {editingWebsiteId ? 'Close' : 'Back'}
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={closeWizard}>Cancel</Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting ? 'Saving...' : editingWebsiteId ? 'Save Website' : 'Create Website'}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {websites.length === 0 ? (
        <div className="bg-white border-2 border-black shadow-brutal p-12 text-center">
          <p className="text-gray-500 font-mono">No websites yet. Start by adding a website.</p>
        </div>
      ) : (
        <div className="bg-white border-2 border-black shadow-brutal overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead className="bg-bg-secondary border-b-2 border-black">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase hidden sm:table-cell">URL</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase">Pages</th>
                  <th className="px-4 py-3 text-left text-xs font-black uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black">
                {websites.map((website) => (
                  <tr key={website.id} className="hover:bg-bg-secondary">
                    <td className="px-4 py-4 text-sm font-bold">{website.name}</td>
                    <td className="px-4 py-4 hidden sm:table-cell text-sm text-gray-600 truncate max-w-xs">{website.url}</td>
                    <td className="px-4 py-4 text-sm font-bold">
                      {website.enabled_pages_count || 0} / {website.pages_count || 0}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <button onClick={() => navigate(`/websites/${website.id}`)} className="text-xs font-bold uppercase hover:opacity-80">View</button>
                        <button onClick={() => openEditWizard(website)} className="text-xs font-bold uppercase hover:opacity-80">Edit</button>
                        <button onClick={() => handleDelete(website.id)} className="text-xs font-bold uppercase text-red-600 hover:opacity-80">Delete</button>
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
