export type Tool = 'library' | 'palette' | 'picker' | 'values' | 'layers';

/** Tools that have nothing to show until an image is open. */
export const NEEDS_IMAGE: Tool[] = ['palette', 'picker', 'values', 'layers'];

const TOOLS: {
  id: Tool;
  label: string;
  short: string;
  hint: string;
  icon: string;
}[] = [
  {
    id: 'library',
    label: 'Library',
    short: 'Library',
    hint: 'Your images and collections',
    icon: '▤',
  },
  {
    id: 'palette',
    label: 'Palette',
    short: 'Palette',
    hint: 'Five colours, drag to re-pick',
    icon: '▦',
  },
  {
    id: 'picker',
    label: 'Colour Picker',
    short: 'Picker',
    hint: 'Every colour, with codes',
    icon: '◎',
  },
  {
    id: 'values',
    label: 'Value Study',
    short: 'Values',
    hint: 'Tone alone, colour removed',
    icon: '◐',
  },
  {
    id: 'layers',
    label: 'Layer Extractor',
    short: 'Layers',
    hint: 'Rebuild it from the palette',
    icon: '◧',
  },
];

type Props = {
  tool: Tool;
  onChange: (tool: Tool) => void;
  /** without an image, only the Library has anything to show */
  hasImage: boolean;
};

/**
 * Rail on the left from `lg` up, tab bar across the top below it, so the
 * narrow layout stays a single column.
 */
export default function Sidebar({ tool, onChange, hasImage }: Props) {
  return (
    <nav
      aria-label="Tools"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-shell p-2 lg:w-56 lg:flex-col lg:overflow-x-visible lg:border-b-0 lg:border-r lg:p-3"
    >
      {TOOLS.map((item) => {
        const active = tool === item.id;
        const disabled = !hasImage && NEEDS_IMAGE.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            title={disabled ? 'Open an image first' : undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange(item.id)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition-colors disabled:opacity-40 lg:flex-none lg:justify-start lg:gap-2.5 lg:px-3 ${
              active ? 'bg-raised text-ink' : 'text-muted hover:bg-surface hover:text-ink'
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {item.icon}
            </span>
            <span className="min-w-0 text-left">
              {/* Four tabs across a phone: short names below lg, full above. */}
              <span className="block truncate text-xs font-medium lg:hidden">
                {item.short}
              </span>
              <span className="hidden truncate text-sm font-medium lg:block">
                {item.label}
              </span>
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
