export type Tool = 'picker' | 'layers';

const TOOLS: { id: Tool; label: string; hint: string; icon: string }[] = [
  {
    id: 'picker',
    label: 'Colour Picker',
    hint: 'Pull a palette out of the image',
    icon: '◎',
  },
  {
    id: 'layers',
    label: 'Layer Extractor',
    hint: 'Rebuild the image from that palette',
    icon: '◧',
  },
];

type Props = {
  tool: Tool;
  onChange: (tool: Tool) => void;
  disabled?: boolean;
};

/**
 * Rail on the left from `lg` up, tab bar across the top below it, so the
 * narrow layout stays a single column.
 */
export default function Sidebar({ tool, onChange, disabled }: Props) {
  return (
    <nav
      aria-label="Tools"
      className="flex shrink-0 gap-1 border-b border-line bg-shell p-2 lg:w-56 lg:flex-col lg:border-b-0 lg:border-r lg:p-3"
    >
      {TOOLS.map((item) => {
        const active = tool === item.id;
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(item.id)}
            className={`flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-40 lg:flex-none ${
              active ? 'bg-raised text-ink' : 'text-muted hover:bg-surface hover:text-ink'
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{item.label}</span>
              <span className="hidden truncate text-xs text-faint lg:block">
                {item.hint}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
