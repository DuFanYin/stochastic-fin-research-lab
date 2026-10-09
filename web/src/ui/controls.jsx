// Inputs bound to the parameter store (lib/store.js): every control takes the parameter's key `k`.
import { useEffect, useState } from "preact/hooks";
import { params, setParam } from "../lib/store.js";

const box = "h-[26px] w-full min-w-0 rounded-sm border border-line bg-surface px-2 text-sm text-ink outline-none "
  + "transition-colors hover:border-line-strong focus:border-accent";

/** A labelled control in the sidebar's two-column grid; `wide` takes both columns. */
export function Field({ label, hint, wide, children }) {
  return (
    <label class={`flex min-w-0 flex-col gap-1 ${wide ? "col-span-2" : ""}`} title={hint}>
      <span class="truncate text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/** A number; empty means null. The text is kept while typing ("0.", "-"), the store gets the number. */
export function Num({ k, label, hint, wide, step = "any", min, max, placeholder = "–", readOnly, onEdit }) {
  const value = params.value[k];
  const [text, setText] = useState(value ?? "");
  useEffect(() => {  // the value changed elsewhere (live data, a reset): show it
    if (text === "" ? value != null : Number(text) !== value) setText(value ?? "");
  }, [value]);
  return (
    <Field label={label} hint={hint} wide={wide}>
      <input type="number" class={`${box} ${readOnly ? "cursor-default bg-surface-2 text-ink-2" : ""}`} step={step} min={min} max={max}
        placeholder={placeholder} readOnly={readOnly} value={text}
        onInput={(e) => {
          const t = e.currentTarget.value;
          setText(t);
          if (t === "") setParam(k, null);
          else if (Number.isFinite(Number(t))) setParam(k, Number(t));
          onEdit?.();
        }} />
    </Field>
  );
}

export function Text({ k, label, hint, wide = true, placeholder }) {
  return (
    <Field label={label} hint={hint} wide={wide}>
      <input type="text" class={box} placeholder={placeholder} value={params.value[k] ?? ""}
        onInput={(e) => setParam(k, e.currentTarget.value)} />
    </Field>
  );
}

export function Area({ k, label, hint, rows = 3, placeholder }) {
  return (
    <Field label={label} hint={hint} wide>
      <textarea rows={rows} placeholder={placeholder} spellcheck={false}
        class={`${box} h-auto resize-y py-1 font-mono text-xs leading-snug`} value={params.value[k] ?? ""}
        onInput={(e) => setParam(k, e.currentTarget.value)} />
    </Field>
  );
}

/** One of a few values, as a row of buttons. options: [value, label, title?][] */
export function Seg({ k, label, hint, options, wide = true, value, onChange }) {
  const current = value ?? params.value[k];
  return (
    <Field label={label} hint={hint} wide={wide}>
      <Segmented options={options} value={current} onChange={onChange ?? ((v) => setParam(k, v))} />
    </Field>
  );
}

export function Segmented({ options, value, onChange, size = "sm" }) {
  return (
    <div class="flex min-w-0 flex-wrap gap-px rounded-sm bg-line p-px" role="group">
      {options.map(([v, text, tip]) => (
        <button type="button" title={tip} aria-pressed={v === value} onClick={() => onChange(v)}
          class={`flex-auto whitespace-nowrap rounded-[3px] px-2 ${size === "xs" ? "h-[22px] text-xs" : "h-[24px] text-sm"} transition-colors `
            + (v === value ? "bg-surface font-medium text-ink shadow-sm" : "bg-surface-2 text-muted hover:text-ink")}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** On / off. */
export function Toggle({ k, label, hint, wide }) {
  const on = !!params.value[k];
  return (
    <Field label={label} hint={hint} wide={wide}>
      <button type="button" role="switch" aria-checked={on} onClick={() => setParam(k, !on)}
        class={`flex h-[26px] items-center gap-2 rounded-sm border px-2 text-sm transition-colors `
          + (on ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface text-muted hover:border-line-strong")}>
        <span class={`h-2 w-2 rounded-full ${on ? "bg-accent" : "bg-line-strong"}`} />{on ? "On" : "Off"}
      </button>
    </Field>
  );
}

/** A set of on / off pills (strategies, checks). items: [key, label, title?][] */
export function Chips({ label, hint, items }) {
  return (
    <Field label={label} hint={hint} wide>
      <div class="flex flex-wrap gap-1">
        {items.map(([k, text, tip]) => {
          const on = !!params.value[k];
          return (
            <button type="button" title={tip} aria-pressed={on} onClick={() => setParam(k, !on)}
              class={`h-[24px] rounded-full border px-2.5 text-xs transition-colors `
                + (on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface text-muted hover:text-ink")}>
              {text}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

export function Slider({ k, label, min, max, unit = "" }) {
  const v = params.value[k];
  return (
    <Field label={<span class="flex justify-between"><span>{label}</span><span class="text-ink-2">{v}{unit}</span></span>} wide>
      <input type="range" class="h-[18px] w-full accent-[var(--accent)]" min={min} max={max} step="1" value={v}
        onInput={(e) => setParam(k, Number(e.currentTarget.value))} />
    </Field>
  );
}

export function Select({ k, label, hint, options, wide = true, onChange }) {
  return (
    <Field label={label} hint={hint} wide={wide}>
      <select class={box} value={params.value[k] ?? ""}
        onChange={(e) => { setParam(k, e.currentTarget.value); onChange?.(e.currentTarget.value); }}>
        {options.map(([v, text]) => <option value={v}>{text}</option>)}
      </select>
    </Field>
  );
}

/** A group of controls in the sidebar, under a small heading (with an optional action on its right). */
export function Group({ title, action, children }) {
  return (
    <section class="border-b border-line px-3 py-3 last:border-b-0">
      <div class="mb-2 flex h-5 items-center justify-between">
        <h3 class="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">{title}</h3>
        {action}
      </div>
      <div class="grid grid-cols-2 gap-x-2 gap-y-2">{children}</div>
    </section>
  );
}

export function SmallButton({ children, onClick, title, disabled }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      class="h-5 rounded-sm px-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}
