import * as Popover from "@radix-ui/react-popover";
import {
  useReaderPrefs,
  FONT_LABELS,
  type FontKey,
  type WidthKey,
} from "../../stores/useReaderPrefs";

const FONTS: FontKey[] = ["serif", "lato", "inter", "georgia", "dyslexic"];
const WIDTHS: { key: WidthKey; label: string }[] = [
  { key: "narrow", label: "Narrow" },
  { key: "medium", label: "Medium" },
  { key: "wide", label: "Wide" },
];
const SPACINGS = [
  { v: 1.6, label: "Tight" },
  { v: 1.8, label: "Normal" },
  { v: 2.0, label: "Relaxed" },
  { v: 2.2, label: "Airy" },
];

function Seg<T extends string | number>({
  options,
  value,
  onChange,
  labelOf,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
            o === value
              ? "border-accent bg-accent-soft text-accent"
              : "border-line text-text-secondary hover:bg-bg-card-hover"
          }`}
        >
          {labelOf(o)}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="u-eyebrow text-text-muted">{label}</span>
      {children}
    </div>
  );
}

export function ReaderToolbar() {
  const p = useReaderPrefs();
  const pct = Math.round(p.scale * 100);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="inline-flex items-center gap-2 rounded-pill border border-line bg-bg-card px-3.5 py-2 text-sm text-text-secondary shadow-lg transition-colors hover:bg-bg-card-hover hover:text-text"
          aria-label="Reading settings"
        >
          <span className="font-display text-base leading-none">Aa</span>
          <span className="hidden sm:inline">Reading</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          className="z-50 w-72 rounded-xl border border-line bg-bg-2 p-4 shadow-2xl"
        >
          <div className="flex flex-col gap-4">
            <Row label="Typeface">
              <Seg
                options={FONTS}
                value={p.font}
                onChange={p.setFont}
                labelOf={(f) => FONT_LABELS[f]}
              />
            </Row>

            <Row label={`Text size · ${pct}%`}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => p.setScale(p.scale - 0.05)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-sm hover:bg-bg-card-hover"
                  aria-label="Smaller text"
                >
                  A−
                </button>
                <div className="h-1.5 flex-1 rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${((p.scale - 0.85) / (1.4 - 0.85)) * 100}%` }}
                  />
                </div>
                <button
                  onClick={() => p.setScale(p.scale + 0.05)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-base hover:bg-bg-card-hover"
                  aria-label="Larger text"
                >
                  A+
                </button>
              </div>
            </Row>

            <Row label="Line spacing">
              <Seg
                options={SPACINGS.map((s) => s.v)}
                value={p.lineHeight}
                onChange={p.setLineHeight}
                labelOf={(v) => SPACINGS.find((s) => s.v === v)?.label ?? String(v)}
              />
            </Row>

            <Row label="Width">
              <Seg
                options={WIDTHS.map((w) => w.key)}
                value={p.width}
                onChange={p.setWidth}
                labelOf={(k) => WIDTHS.find((w) => w.key === k)?.label ?? k}
              />
            </Row>
          </div>
          <Popover.Arrow className="fill-[color:var(--line)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
