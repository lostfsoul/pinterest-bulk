import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { WebsiteOverview } from '../services/api';
import { Button } from '../components/Button';

function getStatusBadge(status: WebsiteOverview['status']) {
  if (status === 'scheduled') return 'bg-green-100 text-green-700';
  if (status === 'generated') return 'bg-blue-100 text-blue-700';
  if (status === 'indexed') return 'bg-yellow-100 text-yellow-800';
  if (status === 'paused') return 'bg-gray-100 text-gray-700';
  return 'bg-gray-100 text-gray-700';
}

export default function Dashboard() {
  const [websites, setWebsites] = useState<WebsiteOverview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    try {
      const response = await apiClient.getWebsitesOverview();
      setWebsites(response.data);
    } catch (error) {
      console.error('Failed to load dashboard overview:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-gray-500">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black uppercase text-black font-mono">Dashboard</h1>
          <p className="text-gray-600 mt-1 font-bold font-mono">Indexed websites, scraping coverage, generated pins, and schedule status</p>
        </div>
        <div className="flex gap-2">
          <Link to="/websites"><Button size="sm" variant="secondary">Manage Websites</Button></Link>
          <Link to="/generate"><Button size="sm">Open Onboarding</Button></Link>
        </div>
      </div>

      {websites.length === 0 ? (
        <div className="bg-white border-2 border-black shadow-brutal p-10 text-center">
          <p className="text-gray-500 font-mono">No websites yet. Add one to start importing and scheduling.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {websites.map((site) => (
            <div key={site.id} className="bg-white border-2 border-black shadow-brutal p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-black uppercase truncate">{site.name}</h2>
                  <p className="text-xs text-gray-500 truncate">{site.url}</p>
                </div>
                <span className={`text-[10px] uppercase px-2 py-1 rounded ${getStatusBadge(site.status)}`}>
                  {site.status.replace('_', ' ')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="border border-black p-2">
                  <p className="text-xs text-gray-500">Enabled Pages</p>
                  <p className="font-black">{site.enabled_pages}</p>
                </div>
                <div className="border border-black p-2">
                  <p className="text-xs text-gray-500">Scraped Pages</p>
                  <p className="font-black">
                    {site.scraped_pages}
                    <span className="ml-1 text-xs text-gray-500">
                      / {site.enabled_pages}
                    </span>
                  </p>
                </div>
                <div className="border border-black p-2">
                  <p className="text-xs text-gray-500">Generated Pins</p>
                  <p className="font-black">{site.total_pins}</p>
                </div>
                <div className="border border-black p-2">
                  <p className="text-xs text-gray-500">Generated Pages</p>
                  <p className="font-black">{site.generated_pages}</p>
                </div>
                <div className="border border-black p-2 col-span-2">
                  <p className="text-xs text-gray-500">Scheduled Until</p>
                  <p className="font-black">
                    {site.scheduled_until ? new Date(site.scheduled_until).toLocaleString() : 'Not scheduled'}
                  </p>
                </div>
                <div className="border border-black p-2 col-span-2">
                  <p className="text-xs text-gray-500">Scheduled Pins</p>
                  <p className="font-black">{site.scheduled_pins}</p>
                </div>
              </div>

              <div className="pt-2">
                <Link to={`/websites/${site.id}`}>
                  <Button size="sm" variant="secondary">Open Website</Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
