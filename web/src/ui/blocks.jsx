// Building blocks of the results: cards, key-value lists, tables, run states, notes.
import { fmt, ms } from "../lib/format.js";
import { results } from "../lib/store.js";

/** A result card. `wide` spans the whole results grid; `meta` sits at the right of the title. */
export function Card({ title, meta, wide, children, actions }) {
  return (
    <section class={`flex min-w-0 flex-col rounded-md border border-line bg-surface shadow-[var(--shadow)] ${wide ? "col-span-full" : ""}`}>
      <header class="flex min-h-9 items-center justify-between gap-3 border-b border-line px-3 py-1.5">
        <h2 class="truncate text-sm font-semibold">{title}</h2>
        <div class="flex shrink-0 items-center gap-2 text-xs text-muted">{meta}{actions}</div>
      </header>
      <div class="flex min-w-0 flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

/** A small heading inside a card. */
export const Sub = ({ children }) => <h3 class="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">{children}</h3>;

/** Value tones: good / bad / warn colouring for a number or text. */
export const Good = ({ children }) => <span class="text-up">{children}</span>;
export const Bad = ({ children }) => <span class="text-down">{children}</span>;
export const Warn = ({ children }) => <span class="text-warn">{children}</span>;
export function tone(value, ok, text = fmt(value)) {
  if (value == null) return "–";
  return ok ? <Good>{text}</Good> : <Warn>{text}</Warn>;
}

export function Badge({ kind = "muted", children }) {
  const cls = { good: "bg-up-soft text-up", bad: "bg-down-soft text-down", warn: "bg-warn-soft text-warn", muted: "bg-surface-2 text-ink-2",
    accent: "bg-accent-soft text-accent" }[kind];
  return <span class={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Label / value pairs in two columns (one on a phone). Values that are not JSX go through fmt(). */
export function Kv({ rows, cols = 2 }) {
  const items = rows.filter(Boolean);
  if (!items.length) return <Empty />;
  return (
    <dl class={`grid gap-x-6 ${cols === 1 ? "" : "sm:grid-cols-2"}`}>
      {items.map(([k, v]) => (
        <div class="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/70 py-[3px] text-sm">
          <dt class="max-w-[60%] shrink-0 truncate text-ink-2">{k}</dt>
          <dd class="m-0 min-w-0 text-right font-medium tabular-nums [overflow-wrap:anywhere]">{isNode(v) ? v : fmt(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

const isNode = (v) => v !== null && typeof v === "object" && ("type" in v || Array.isArray(v));

/** A table. cols: [{ key, label, fmt?, align?, cls? }]; rows: objects. */
export function Table({ cols, rows, onRow, selected, compact, maxHeight }) {
  if (!rows?.length) return <Empty />;
  return (
    <div class="min-w-0 overflow-auto rounded-sm border border-line" style={maxHeight ? { maxHeight } : undefined}>
      <table class="w-full border-collapse text-sm">
        <thead class="sticky top-0 z-[1] bg-surface-2">
          <tr>{cols.map((c) => <th class={`whitespace-nowrap px-2 py-1 text-xs font-medium text-muted ${c.align === "left" ? "text-left" : "text-right"}`}>{c.label ?? c.key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr onClick={onRow ? () => onRow(r, i) : undefined}
              class={`border-t border-line ${onRow ? "cursor-pointer hover:bg-surface-2" : ""} ${selected === i ? "bg-accent-soft" : ""}`}>
              {cols.map((c) => {
                const v = c.fmt ? c.fmt(r[c.key], r) : r[c.key];
                return <td class={`whitespace-nowrap px-2 ${compact ? "py-0.5" : "py-1"} ${c.align === "left" ? "text-left" : "text-right"} ${c.cls ?? ""}`}>{isNode(v) ? v : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Empty = ({ children = "No data" }) => <p class="text-sm text-muted">{children}</p>;
export const Note = ({ children }) => <p class="text-xs leading-relaxed text-muted">{children}</p>;

/** A result card bound to one slot of a mode's results: running, error, or `children(data)`. */
export function Slot({ mode, slot, title, wide, meta, children }) {
  const s = results.value[mode]?.[slot];
  if (!s) return null;
  const engine = s.data?.diagnostics?.compute_ms ?? s.data?.diagnostics?.runtime_ms;
  return (
    <Card title={title} wide={wide} meta={meta ?? (s.state === "ok" && engine != null ? <span title="engine time">{ms(engine)}</span> : null)}>
      {s.state === "running" ? <Running /> : s.state === "error" ? <ErrorText>{s.error}</ErrorText> : children(s.data)}
    </Card>
  );
}

export const Running = () => (
  <div class="flex flex-col gap-2 py-1" aria-busy="true">
    {[72, 56, 64].map((w) => <div class="h-3 animate-pulse rounded-sm bg-surface-2" style={{ width: `${w}%` }} />)}
  </div>
);

export const ErrorText = ({ children }) => (
  <p class="rounded-sm bg-down-soft px-2 py-1.5 font-mono text-xs leading-relaxed break-words text-down">{children}</p>
);
