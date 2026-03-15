import { useEffect, useState } from 'react';
import apiClient, { Template } from '../services/api';
import { Button } from '../components/Button';

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({ name: '', file: null as File | null });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const response = await apiClient.listTemplates();
      setTemplates(response.data);
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.file || !formData.name) return;

    setSubmitting(true);

    console.log('Uploading template:', {
      name: formData.name,
      file: formData.file.name,
      size: formData.file.size,
      type: formData.file.type,
    });

    try {
      await apiClient.uploadTemplate(formData.name, formData.file);
      setFormData({ name: '', file: null });
      setShowForm(false);
      loadTemplates();
    } catch (error) {
      console.error('Failed to upload template:', error);

      // Extract error message properly
      let errorMessage = 'Unknown error';
      if (error && typeof error === 'object') {
        const errObj = error as any;

        console.log('Error object:', errObj);
        console.log('Response:', errObj.response);
        console.log('Response data:', errObj.response?.data);

        // Check for response data
        if (errObj.response?.data) {
          const data = errObj.response.data;

          // If data has detail, use it
          if (data.detail) {
            errorMessage = String(data.detail);
          }
          // If data is an array, join the messages
          else if (Array.isArray(data)) {
            errorMessage = data.map((item: any) =>
              typeof item === 'string' ? item : (item?.detail || JSON.stringify(item))
            ).join(', ');
          }
          // If data is an object, stringify it properly
          else if (typeof data === 'object') {
            errorMessage = JSON.stringify(data);
          }
          else {
            errorMessage = String(data);
          }
        }
        // Check for message
        else if (errObj.message) {
          errorMessage = String(errObj.message);
        }
        else {
          errorMessage = 'Upload failed - check console for details';
        }
      } else if (typeof error === 'string') {
        errorMessage = error;
      }

      alert(`Failed to upload template: ${errorMessage}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return;

    try {
      await apiClient.deleteTemplate(id);
      loadTemplates();
      if (selectedTemplate?.id === id) {
        setSelectedTemplate(null);
      }
    } catch (error) {
      console.error('Failed to delete template:', error);
      alert('Failed to delete template');
    }
  };

  const viewTemplate = async (template: Template) => {
    try {
      const response = await apiClient.getTemplate(template.id);
      setSelectedTemplate(response.data);
    } catch (error) {
      console.error('Failed to load template details:', error);
    }
  };

  const downloadTemplate = (template: Template) => {
    window.open(`/api/templates/${template.id}/file`, '_blank');
  };

  if (loading) {
    return <div className="text-gray-500">Loading templates...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
          <p className="text-gray-500 mt-1">Upload SVG templates for pin generation</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Upload Template'}
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-2">SVG Template Format</h3>
        <p className="text-sm text-gray-600 mb-3">
          The template parser automatically detects zones from{' '}
          <code className="bg-gray-100 px-1 rounded">clipPath</code> elements in your SVG.
        </p>
        <p className="text-sm text-gray-600 mb-2">
          <strong>Image zones:</strong> Detected from clipPaths around <code className="bg-gray-100 px-1 rounded">&lt;image&gt;</code> elements
        </p>
        <p className="text-sm text-gray-600">
          <strong>Text zone:</strong> Auto-detected from the gap between image zones
        </p>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Template Name
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="My Pin Template"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SVG File
              </label>
              <input
                type="file"
                accept=".svg"
                required
                onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] || null })}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting || !formData.file}>
                {submitting ? 'Uploading...' : 'Upload Template'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">No templates yet. Upload an SVG template to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <div key={template.id} className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-semibold text-gray-900">{template.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => downloadTemplate(template)}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                    title="Download SVG"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <p>Size: {template.width} × {template.height}</p>
                <p>Zones: {template.zones?.length || 0}</p>
              </div>
              <button
                onClick={() => viewTemplate(template)}
                className="mt-4 w-full text-sm text-blue-600 hover:text-blue-800 border border-blue-600 rounded-md py-2 hover:bg-blue-50"
              >
                View Details
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelectedTemplate(null)}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">{selectedTemplate.name}</h2>
              <button onClick={() => setSelectedTemplate(null)} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Width:</span> {selectedTemplate.width}
                </div>
                <div>
                  <span className="text-gray-500">Height:</span> {selectedTemplate.height}
                </div>
              </div>
              {selectedTemplate.zones && selectedTemplate.zones.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Auto-Detected Zones</h3>
                  <div className="space-y-2">
                    {selectedTemplate.zones.map((zone) => (
                      <div key={zone.id} className="bg-gray-50 rounded p-3 text-sm">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${
                            zone.zone_type === 'text' ? 'text-blue-700' : 'text-green-700'
                          }`}>
                            {zone.zone_type.toUpperCase()}
                          </span>
                          <span className="text-gray-500">x:{zone.x}, y:{zone.y}</span>
                          <span className="text-gray-500">size: {zone.width} × {zone.height}</span>
                        </div>
                        {zone.props && Object.keys(zone.props).length > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            Props: {JSON.stringify(zone.props)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!selectedTemplate.zones || selectedTemplate.zones.length === 0) && (
                <div className="text-center py-6 bg-gray-50 rounded">
                  <p className="text-gray-500">No zones detected from SVG clipPath elements</p>
                </div>
              )}
            </div>
            <div className="mt-6 flex gap-2">
              <Button onClick={() => downloadTemplate(selectedTemplate)}>
                Download SVG
              </Button>
              <Button variant="ghost" onClick={() => setSelectedTemplate(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
