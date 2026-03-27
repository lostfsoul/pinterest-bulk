import { useEffect, useState } from 'react';
import apiClient from '../services/api';
import { Button } from '../components/Button';

export default function Schedule() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    pins_per_day: 10,
    start_hour: 8,
    end_hour: 20,
    min_days_reuse: 31,
    random_minutes: true,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await apiClient.getScheduleSettings();
      setFormData({
        pins_per_day: response.data.pins_per_day,
        start_hour: response.data.start_hour,
        end_hour: response.data.end_hour,
        min_days_reuse: response.data.min_days_reuse,
        random_minutes: response.data.random_minutes,
      });
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      await apiClient.updateScheduleSettings(formData);
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Schedule Settings</h1>
        <p className="text-gray-500 mt-1">Configure how pins are scheduled when exported</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-xl">
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pins Per Day
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={formData.pins_per_day}
              onChange={(e) => setFormData({ ...formData, pins_per_day: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Number of pins to schedule per day during export
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Hour
              </label>
              <select
                value={formData.start_hour}
                onChange={(e) => setFormData({ ...formData, start_hour: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Hour
              </label>
              <select
                value={formData.end_hour}
                onChange={(e) => setFormData({ ...formData, end_hour: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minimum Days Before URL Reuse
            </label>
            <input
              type="number"
              min="31"
              max="365"
              value={formData.min_days_reuse}
              onChange={(e) => setFormData({ ...formData, min_days_reuse: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Minimum is 31 days. The scheduler will never reuse the same URL before 31 days.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="random_minutes"
              checked={formData.random_minutes}
              onChange={(e) => setFormData({ ...formData, random_minutes: e.target.checked })}
              className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="random_minutes" className="text-sm font-medium text-gray-700">
              Add random minutes to publish times
            </label>
          </div>

          <div className="pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              With current settings, pins will be scheduled approximately every{' '}
              <strong>
                {formData.pins_per_day > 0
                  ? Math.round(24 / formData.pins_per_day)
                  : 0} hours
              </strong>{' '}
              between {formData.start_hour}:00 and {formData.end_hour}:00.
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
