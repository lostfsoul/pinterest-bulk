import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { PinDraft } from '../services/api';
import { Button } from '../components/Button';

type PinStatus = 'draft' | 'ready' | 'exported' | 'skipped';

function getStatusColor(status: PinStatus): string {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-700';
    case 'ready': return 'bg-green-100 text-green-700';
    case 'exported': return 'bg-blue-100 text-blue-700';
    case 'skipped': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

export default function Dashboard() {
  const [pins, setPins] = useState<PinDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | PinStatus>('all');
  const [selectedPins, setSelectedPins] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadPins();
  }, []);

  const loadPins = async () => {
    try {
      const response = await apiClient.listPins();
      setPins(response.data);
    } catch (error) {
      console.error('Failed to load pins:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredPins = filter === 'all' ? pins : pins.filter(p => p.status === filter);
  const sortedPins = useMemo(
    () =>
      [...filteredPins].sort((a, b) => {
        const aPrimary = a.publish_date || a.created_at;
        const bPrimary = b.publish_date || b.created_at;
        return new Date(bPrimary).getTime() - new Date(aPrimary).getTime();
      }),
    [filteredPins],
  );
  const groupedPins = useMemo(() => {
    const groups = new Map<string, PinDraft[]>();
    for (const pin of sortedPins) {
      const sourceDate = pin.publish_date || pin.created_at;
      const key = sourceDate.slice(0, 10);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(pin);
    }
    return Array.from(groups.entries());
  }, [sortedPins]);

  const togglePinSelection = (pinId: number) => {
    setSelectedPins(prev => {
      const next = new Set(prev);
      if (next.has(pinId)) {
        next.delete(pinId);
      } else {
        next.add(pinId);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedPins.size === sortedPins.length) {
      setSelectedPins(new Set());
    } else {
      setSelectedPins(new Set(sortedPins.map(p => p.id)));
    }
  };

  if (loading) {
    return <div className="text-gray-500 font-mono">Loading pins...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black uppercase text-black font-mono">Generated Pins</h1>
          <p className="text-gray-600 mt-1 font-bold font-mono">
            {pins.length} pins total • {pins.filter(p => p.status === 'ready').length} ready
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/generate">
            <Button size="sm">Generate More Pins</Button>
          </Link>
          <Link to="/export">
            <Button size="sm" variant="secondary">Export Pins</Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'draft', 'ready', 'exported', 'skipped'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filter === status
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {status !== 'all' && (
              <span className="ml-1 opacity-75">
                ({pins.filter(p => p.status === status).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pin Grid */}
      {filteredPins.length === 0 ? (
        <div className="text-center py-16 bg-white border-2 border-black">
          <p className="text-gray-500 font-mono mb-4">No pins found</p>
          <Link to="/generate">
            <Button>Generate Your First Pins</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedPins.map(([dateKey, datePins]) => (
            <section key={dateKey}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-black uppercase text-gray-700">{dateKey}</h2>
                <span className="text-xs text-gray-500">{datePins.length} pins</span>
              </div>
              <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-1.5">
                {datePins.map(pin => (
                  <div
                    key={pin.id}
                    className={`relative bg-white border overflow-hidden group cursor-pointer transition-all hover:shadow-brutal-sm ${
                      selectedPins.has(pin.id) ? 'border-accent ring-1 ring-accent' : 'border-black'
                    }`}
                    onClick={() => togglePinSelection(pin.id)}
                  >
                    <div className={`absolute top-1 left-1 z-10 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                      selectedPins.has(pin.id)
                        ? 'bg-accent border-accent'
                        : 'bg-white border-gray-400 group-hover:border-gray-600'
                    }`}>
                      {selectedPins.has(pin.id) && (
                        <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    <div className="relative aspect-[2/3] bg-gray-100">
                      {pin.media_url ? (
                        <img
                          src={pin.media_url}
                          alt={pin.title || 'Pin'}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="120"%3E%3Crect fill="%23eee" width="80" height="120"/%3E%3Ctext x="40" y="60" text-anchor="middle" dy=".3em" fill="%23999"%3ENo Image%3C/text%3E%3C/svg%3E';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}

                      <div className="absolute bottom-1 right-1">
                        <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${getStatusColor(pin.status as PinStatus)}`}>
                          {pin.status}
                        </span>
                      </div>
                    </div>

                    <div className="p-1">
                      <p className="text-[10px] font-bold truncate" title={pin.title || ''}>
                        {pin.title || 'Untitled'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      {selectedPins.size > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bg-black text-white px-4 sm:px-6 py-3 rounded-full shadow-brutal flex items-center justify-between sm:justify-center gap-4 z-50">
          <span className="font-mono font-bold">{selectedPins.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="text-xs px-3 py-1 bg-gray-700 rounded-full hover:bg-gray-600"
            >
              {selectedPins.size === sortedPins.length ? 'Deselect All' : 'Select All'}
            </button>
            <Link
              to={`/export?pins=${Array.from(selectedPins).join(',')}`}
              className="text-xs px-3 py-1 bg-accent rounded-full hover:opacity-90"
            >
              Export Selected
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
