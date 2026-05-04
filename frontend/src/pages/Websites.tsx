import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import apiClient, { Website } from '../services/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';

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
        const response = await apiClient.createWebsite(formData);
        const websiteId = response.data.id;
        localStorage.setItem('active_website_id', String(websiteId));
        window.dispatchEvent(new CustomEvent<number>('website-switch', { detail: websiteId }));
        window.dispatchEvent(new CustomEvent<number>('website-refresh', { detail: websiteId }));
        window.dispatchEvent(new CustomEvent<number>('open-onboarding', { detail: websiteId }));
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
  }

  function openCreateWizard() {
    setEditingWebsiteId(null);
    setFormData({ name: '', url: '', sitemap_url: '' });
    setShowWizard(true);
  }

  function openEditWizard(website: Website) {
    setEditingWebsiteId(website.id);
    setFormData({
      name: website.name || '',
      url: website.url || '',
      sitemap_url: website.sitemap_url || '',
    });
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

  if (loading) {
    return <div className="text-slate-500">Loading websites...</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Websites</CardTitle>
            <CardDescription>Connect websites and import content via sitemap sources.</CardDescription>
          </div>
          <Button onClick={openCreateWizard}>
            <Plus className="h-4 w-4" />
            Add Website
          </Button>
        </CardHeader>
      </Card>

      <Dialog open={showWizard} onOpenChange={(open) => (!open ? closeWizard() : setShowWizard(true))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingWebsiteId ? 'Edit Website' : 'Add Website'}</DialogTitle>
            <DialogDescription>
              Configure the base URL and sitemap so pages can be discovered for generation.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Website Name</label>
              <Input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Nia Cooks"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Website URL</label>
              <Input
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
                placeholder="https://example.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Sitemap URL</label>
              <Input
                type="url"
                value={formData.sitemap_url}
                onChange={(e) => setFormData((prev) => ({ ...prev, sitemap_url: e.target.value }))}
                placeholder="https://example.com/sitemap_index.xml"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeWizard}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : editingWebsiteId ? 'Save Website' : 'Create Website'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {websites.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center gap-3 text-center">
              <Globe className="h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-500">No websites yet. Add your first website to continue.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">URL</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {websites.map((website) => (
                  <TableRow key={website.id}>
                    <TableCell className="font-medium text-slate-900">{website.name}</TableCell>
                    <TableCell className="hidden max-w-xs truncate sm:table-cell">{website.url}</TableCell>
                    <TableCell>
                      {website.enabled_pages_count || 0} / {website.pages_count || 0}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => navigate(`/websites/${website.id}`)}>
                          View
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openEditWizard(website)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void handleDelete(website.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
