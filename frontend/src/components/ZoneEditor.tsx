import { useState, useRef, useEffect } from 'react';
import { Template } from '../services/api';
import { Button } from './Button';

interface ZoneEditorProps {
  template: Template;
  onZoneAdd: (zone: {
    zone_type: 'text' | 'image';
    x: number;
    y: number;
    width: number;
    height: number;
    props: Record<string, unknown> | null;
  }) => void;
  onClose: () => void;
}

export function ZoneEditor({ template, onZoneAdd, onClose }: ZoneEditorProps) {
  const [zoneType, setZoneType] = useState<'text' | 'image'>('image');
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [width, setWidth] = useState(400);
  const [height, setHeight] = useState(400);
  const [propName, setPropName] = useState('');
  const [propValue, setPropValue] = useState('');
  const [props, setProps] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'move' | 'resize-br' | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; zoneX: number; zoneY: number; zoneW: number; zoneH: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const addProp = () => {
    if (propName && propValue) {
      setProps({ ...props, [propName]: propValue });
      setPropName('');
      setPropValue('');
    }
  };

  const removeProp = (key: string) => {
    const newProps = { ...props };
    delete newProps[key];
    setProps(newProps);
  };

  const handleSubmit = () => {
    onZoneAdd({
      zone_type: zoneType,
      x,
      y,
      width,
      height,
      props: Object.keys(props).length > 0 ? props : null,
    });
    onClose();
  };

  // Handle mouse events for dragging
  const handleMouseDown = (e: React.MouseEvent, mode: 'move' | 'resize-br') => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragMode(mode);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      zoneX: x,
      zoneY: y,
      zoneW: width,
      zoneH: height,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragStartRef.current || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = template.width / rect.width;
      const scaleY = template.height / rect.height;

      const dx = (e.clientX - dragStartRef.current.x) * scaleX;
      const dy = (e.clientY - dragStartRef.current.y) * scaleY;

      if (dragMode === 'move') {
        const newX = Math.max(0, Math.min(template.width - width, Math.round(dragStartRef.current.zoneX + dx)));
        const newY = Math.max(0, Math.min(template.height - height, Math.round(dragStartRef.current.zoneY + dy)));
        setX(newX);
        setY(newY);
      } else if (dragMode === 'resize-br') {
        const newW = Math.max(50, Math.min(template.width - x, Math.round(dragStartRef.current.zoneW + dx)));
        const newH = Math.max(50, Math.min(template.height - y, Math.round(dragStartRef.current.zoneH + dy)));
        setWidth(newW);
        setHeight(newH);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragMode(null);
      dragStartRef.current = null;
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragMode, template.width, template.height, width, height, x, y]);

  // Calculate position for preview
  const leftPct = (x / template.width) * 100;
  const topPct = (y / template.height) * 100;
  const widthPct = (width / template.width) * 100;
  const heightPct = (height / template.height) * 100;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Add Zone to Template</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Canvas Preview */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Template Preview ({template.width} × {template.height})
            </label>
            <div
              ref={canvasRef}
              className="relative bg-gray-100 border-2 border-gray-300 rounded"
              style={{
                width: '100%',
                aspectRatio: `${template.width}/${template.height}`,
                maxWidth: '400px',
              }}
            >
              {/* Template SVG background */}
              <img
                src={`/api/templates/${template.id}/file`}
                alt={template.name}
                className="absolute inset-0 w-full h-full object-contain"
                style={{ imageRendering: 'pixelated' }}
              />

              {/* Zone overlay */}
              <div
                className={`absolute border-2 cursor-move ${
                  zoneType === 'image'
                    ? 'border-green-500 bg-green-500/20'
                    : 'border-blue-500 bg-blue-500/20'
                }`}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
              >
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold pointer-events-none">
                  {zoneType.toUpperCase()}
                </span>
                {/* Resize handle */}
                <div
                  className="absolute bottom-0 right-0 w-3 h-3 bg-white border border-gray-400 cursor-se-resize"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleMouseDown(e, 'resize-br');
                  }}
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Drag to move • Drag corner to resize
            </p>
          </div>

          {/* Controls */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zone Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setZoneType('image')}
                  className={`flex-1 px-4 py-2 rounded-md ${
                    zoneType === 'image'
                      ? 'bg-green-100 text-green-700 border-2 border-green-500'
                      : 'bg-gray-100 text-gray-700 border-2 border-gray-300'
                  }`}
                >
                  Image
                </button>
                <button
                  type="button"
                  onClick={() => setZoneType('text')}
                  className={`flex-1 px-4 py-2 rounded-md ${
                    zoneType === 'text'
                      ? 'bg-blue-100 text-blue-700 border-2 border-blue-500'
                      : 'bg-gray-100 text-gray-700 border-2 border-gray-300'
                  }`}
                >
                  Text
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">X Position</label>
                <input
                  type="number"
                  value={x}
                  onChange={(e) => setX(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  min="0"
                  max={template.width}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Y Position</label>
                <input
                  type="number"
                  value={y}
                  onChange={(e) => setY(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  min="0"
                  max={template.height}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  min="1"
                  max={template.width}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Height</label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  min="1"
                  max={template.height}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Custom Properties (optional)
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  placeholder="Property name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <input
                  type="text"
                  value={propValue}
                  onChange={(e) => setPropValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <button
                  type="button"
                  onClick={addProp}
                  className="px-3 py-2 bg-gray-200 text-gray-700 rounded-md text-sm"
                >
                  Add
                </button>
              </div>
              {Object.keys(props).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(props).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between bg-gray-50 px-3 py-1 rounded text-sm"
                    >
                      <span>
                        <strong>{key}:</strong> {value}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeProp(key)}
                        className="text-red-600 hover:text-red-800"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <Button onClick={handleSubmit} className="flex-1">
                Add Zone
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
