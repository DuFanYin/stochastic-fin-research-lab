// The workbench: top bar (data source, live market, precision), mode tabs, the mode's inputs on the left
// with the Run button, its results on the right.
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { budget } from "./lib/api.js";
import { ms } from "./lib/format.js";
import { fetchLive, market } from "./lib/live.js";
import { anyCheck } from "./lib/payloads.js";
import { drop, end } from "./lib/runner.js";
import { params, resetParams, results, runs, setParam, setSetting, settings } from "./lib/store.js";
import { MODES, byId } from "./modes/index.js";
import { handOff } from "./modes/screener.jsx";
import { Report, gate } from "./modes/validation.jsx";
import { Slot } from "./ui/blocks.jsx";
import { Segmented } from "./ui/controls.jsx";
import { Toasts, toast } from "./ui/toast.jsx";

const busy = signal(false);
const current = () => byId[settings.value.tab] ?? MODES[0];

async function run(mode = current()) {
  if (busy.value) return;
  busy.value = true;
  const pre = `pre:${mode.id}`;
  try {
    if (settings.value.dataMode === "live" && mode.id !== "screener") await fetchLive().catch(() => {});
    if (mode.precheck && params.value.precheck && anyCheck(params.value)) {
      const passed = await gate(pre, "gate");
      if (!passed && params.value.blockOnFail) {
        toast("The validation gate failed and Block on fail is on: the run was stopped.", "Blocked by the pre-check");
        return;
      }
    } else {
      drop(pre, "gate");
    }
    await mode.run();
  } catch (err) {
    toast(err?.message ?? String(err), `${mode.label} failed`);
  } finally {
    end(mode.id);
    busy.value = false;
  }
}

handOff.to = (where, position) => {
  setParam(where === "multileg" ? "multiLegLegs" : "stressLegs", JSON.stringify(position, null, 1));
  setSetting("tab", where);
  run(byId[where]);
};

function select(id) {
  setSetting("tab", id);
  byId[id]?.enter?.();
}

// ── top bar

function MarketStrip() {
  const m = market.value, p = params.value, live = settings.value.dataMode === "live";
  if (!live) return <span class="truncate text-xs text-muted">Simulated inputs: edit spot, σ, r and μ freely</span>;
  const dot = { loading: "bg-warn animate-pulse", ok: "bg-up", error: "bg-down" }[m.state] ?? "bg-line-strong";
  const item = (k, v) => <span class="whitespace-nowrap"><span class="text-muted">{k}</span> {v}</span>;
  return (
    <div class="flex min-w-0 items-center gap-3 overflow-hidden text-xs">
      <span class={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} title={m.error ?? m.state} />
      {item("BTC", p.spot != null ? Number(p.spot).toLocaleString() : "–")}
      {item("DVOL", m.ivPct != null ? `${m.ivPct}%` : "–")}
      <span class="hidden sm:contents">
        {item("r", m.ratePct != null ? `${m.ratePct}%` : "–")}
        {item("μ", m.muPct != null ? `${m.muPct}%` : "–")}
        {m.at && <span class="text-muted">{m.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </span>
      <button type="button" class="text-muted hover:text-ink" title="Refresh market data" onClick={() => fetchLive().catch((e) => toast(e.message, "Market data"))}>↻</button>
    </div>
  );
}

const REPO = "https://github.com/DuFanYin/stochastic-fin-research-lab";

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

function Topbar() {
  const s = settings.value;
  return (
    <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur sm:gap-4 sm:px-4">
      <div class="flex shrink-0 items-center gap-2.5">
        <span class="grid h-8 w-8 place-items-center rounded-md bg-ink font-mono text-lg font-bold text-surface">σ</span>
        <div class="hidden leading-tight sm:block">
          <h1 class="text-[17px] font-semibold tracking-tight">Quant Lab</h1>
          <p class="text-2xs text-muted">Stochastic finance workbench</p>
        </div>
      </div>
      <div class="w-[104px] shrink-0">
        <Segmented size="xs" value={s.dataMode} options={[["live", "Live"], ["sim", "Sim"]]}
          onChange={(v) => { setSetting("dataMode", v); if (v === "live") fetchLive().catch(() => {}); else market.value = { state: "idle" }; }} />
      </div>
      <div class="min-w-0 flex-1"><MarketStrip /></div>
      <label class="flex shrink-0 items-center gap-1.5 text-xs text-muted" title="Decimal places shown">
        <span class="hidden sm:inline">dp</span>
        <input type="number" min="0" max="10" class="h-6 w-11 rounded-sm border border-line bg-surface px-1.5 text-xs text-ink" value={s.precision}
          onInput={(e) => { const n = Math.trunc(Number(e.currentTarget.value)); if (Number.isFinite(n)) setSetting("precision", Math.min(10, Math.max(0, n))); }} />
      </label>
      <a class="flex h-8 shrink-0 items-center gap-2 rounded-full border border-gh-line bg-gh-soft px-2.5 text-sm font-medium text-gh transition-colors hover:border-gh md:pr-3.5"
        href={REPO} target="_blank" rel="noopener" title="The source on GitHub">
        <GitHubMark /><span class="hidden md:inline">Star on GitHub</span>
      </a>
    </header>
  );
}

function Tabs() {
  const tab = current().id;
  return (
    <nav class="sticky top-14 z-10 flex h-9 items-end gap-1 overflow-x-auto border-b border-line bg-page px-3" aria-label="Modes">
      {MODES.map((m) => {
        const r = runs.value[m.id];
        return (
          <button type="button" onClick={() => select(m.id)} aria-current={m.id === tab ? "page" : undefined}
            class={`relative flex h-9 shrink-0 items-center gap-1.5 px-2.5 text-sm transition-colors `
              + (m.id === tab ? "font-medium text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-muted hover:text-ink")}>
            {m.label}
            {r?.running && <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          </button>
        );
      })}
    </nav>
  );
}

// ── inputs and results

/** The one Run button: at the top right of the results on a wide screen, under the inputs on a narrow one. */
function RunButton({ class: cls = "" }) {
  const mode = current();
  return (
    <button type="button" disabled={busy.value} onClick={() => run()} title={`Run ${mode.label} (⌘↵ or Ctrl+Enter)`}
      class={`btn-run h-9 items-center justify-center gap-2.5 rounded-lg pl-1.5 pr-4 text-sm font-semibold tracking-tight ${cls}`}>
      <span class="icon grid h-6 w-6 place-items-center rounded-md">
        {busy.value
          ? <span class="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />
          : <svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M2.5 1.3v7.4a.6.6 0 0 0 .92.5l5.6-3.7a.6.6 0 0 0 0-1L3.42.8a.6.6 0 0 0-.92.5" /></svg>}
      </span>
      {busy.value ? "Running…" : `Run ${mode.label}`}
    </button>
  );
}

function Sidebar() {
  const mode = current();
  return (
    <aside class="flex min-h-0 flex-col border-line bg-surface lg:sticky lg:top-[92px] lg:h-[calc(100vh-92px)] lg:border-r">
      <div class="min-h-0 flex-1 overflow-y-auto"><mode.Params /></div>
      <div class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface p-3 lg:py-2">
        <RunButton class="flex flex-1 lg:hidden" />
        <button type="button" class="h-8 rounded-sm px-2 text-xs text-muted hover:bg-surface-2 hover:text-ink lg:h-6" title="Put every input back to its default"
          onClick={() => { if (confirm("Reset every input to its default?")) { resetParams(); if (settings.value.dataMode === "live") fetchLive().catch(() => {}); } }}>
          Reset inputs
        </button>
      </div>
    </aside>
  );
}

function ResultsPane() {
  const mode = current(), r = runs.value[mode.id], has = Object.keys(results.value[mode.id] ?? {}).length > 0;
  const pre = results.value[`pre:${mode.id}`]?.gate;
  return (
    <main class="min-w-0 p-3 lg:p-4">
      <div class="mb-3 flex min-h-8 items-center justify-between gap-3">
        <h2 class="text-lg font-semibold tracking-tight">{mode.label}</h2>
        <div class="flex items-center gap-3">
          <span class="text-xs text-muted">{r?.running ? "running…" : r?.wall != null ? `last run ${ms(r.wall)} wall` : ""}</span>
          {budget.value != null && (
            <span class={`hidden text-xs sm:inline ${budget.value < 20 ? "text-warn" : "text-muted"}`}
              title="The public lab gives each visitor 120 s of computing time, refilled over 10 minutes. Run it yourself for no limits.">
              · {Math.floor(budget.value)} s of compute left
            </span>
          )}
          <RunButton class="hidden lg:flex" />
        </div>
      </div>
      {!has && !pre ? (
        <div class="grid min-h-[40vh] place-items-center rounded-md border border-dashed border-line p-6 text-center">
          <div class="max-w-xl">
            <p class="text-base leading-relaxed text-ink-2">{mode.about}</p>
            <p class="mt-3 text-sm text-muted">Set the inputs, then run (⌘↵ or Ctrl+Enter).</p>
          </div>
        </div>
      ) : (
        <div class="grid grid-flow-row-dense grid-cols-1 items-start gap-3 xl:grid-cols-2 min-[1800px]:grid-cols-3">
          {pre && <Slot mode={`pre:${mode.id}`} slot="gate" title="Pre-check" wide>{(d) => <Report data={d} compact />}</Slot>}
          <mode.Results />
        </div>
      )}
    </main>
  );
}

export function App() {
  useEffect(() => {
    if (settings.value.dataMode === "live") fetchLive().catch(() => {});
    current().enter?.();
    const key = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); } };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <>
      <Topbar />
      <Tabs />
      <div class="grid min-h-[calc(100vh-92px)] lg:grid-cols-[304px_minmax(0,1fr)]">
        <Sidebar />
        <ResultsPane />
      </div>
      <Toasts />
    </>
  );
}

