interface Placeholder {
  name: string;
  description: string;
}

interface PlaceholderButtonsProps {
  onInsert: (placeholder: string) => void;
  placeholders: Placeholder[];
}

export function PlaceholderButtons({ onInsert, placeholders }: PlaceholderButtonsProps) {
  if (placeholders.length === 0) {
    placeholders = [
      { name: 'title', description: 'Page title' },
      { name: 'description', description: 'Page meta description' },
      { name: 'keywords', description: 'Comma-separated keywords' },
      { name: 'url', description: 'Full page URL' },
      { name: 'website_name', description: 'Website name' },
      { name: 'section', description: 'Page section/category' },
    ];
  }

  return (
    <div className="flex flex-wrap gap-1 mb-2">
      <span className="text-xs text-gray-500 mr-1">Insert:</span>
      {placeholders.map(p => (
        <button
          key={p.name}
          type="button"
          onClick={() => onInsert(p.name)}
          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
          title={p.description}
        >
          {`{{ ${p.name} }}`}
        </button>
      ))}
    </div>
  );
}