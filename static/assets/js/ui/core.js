/* ─── Precision setting ──────────────────────────────────────────────────────── */

const PRECISION_KEY = "sf_answer_precision";
const DEFAULT_PRECISION = 5;

export function getDisplayPrecision() {
  const raw = Number(localStorage.getItem(PRECISION_KEY));
  if (!Number.isFinite(raw)) return DEFAULT_PRECISION;
  return Math.min(10, Math.max(0, Math.trunc(raw)));
}

/* ─── Formatting ─────────────────────────────────────────────────────────────── */

export function fmt(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 1e6 || (Math.abs(value) > 0 && Math.abs(value) < 0.001))
      return value.toExponential(3);
    const p = getDisplayPrecision();
    return Number(value.toFixed(p)).toString();
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function fmtMs(ms) {
  if (ms === null || ms === undefined) return "-";
  return `${Number(ms).toFixed(2)} ms`;
}

/* ─── DOM helpers ────────────────────────────────────────────────────────────── */

export function getEl(id) {
  return document.getElementById(id);
}

export function setHtml(id, html) {
  const el = getEl(id);
  if (el) el.innerHTML = html;
}

/* ─── Low-level building blocks ──────────────────────────────────────────────── */

export function tableHtml(rows, cols) {
  if (!rows || !rows.length) return `<div class="muted-sm">No data</div>`;
  const head = cols.map((c) => `<th>${c}</th>`).join("");
  const body = rows.map((row) =>
    `<tr>${cols.map((c) => `<td>${fmt(row?.[c])}</td>`).join("")}</tr>`
  ).join("");
  return `<table class="dense-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function metricsRow(pairs) {
  const rows = (pairs || []).map(([k, v]) => ({ item: k, value: v }));
  if (!rows.length) return `<div class="muted-sm">No data</div>`;
  const body = rows.map((r) =>
    `<tr><td>${fmt(r.item)}</td><td>${fmt(r.value)}</td></tr>`
  ).join("");
  return `<table class="dense-table kv-table"><tbody>${body}</tbody></table>`;
}

export function diagLine(_diag) {
  // Timing is now shown in the section label badge — nothing to render inline.
  return "";
}

// Wall-clock start time set by the runner before it fires, cleared after render.
let _runStartMs = null;

export function markRunStart() {
  _runStartMs = performance.now();
}

export function setDiagBadge(badgeId, diag) {
  const el = document.getElementById(badgeId);
  if (!el) return;
  const wallMs  = _runStartMs != null ? performance.now() - _runStartMs : null;
  const server  = diag?.compute_ms != null ? `engine ${fmtMs(diag.compute_ms)}` : null;
  const wall    = wallMs            != null ? `wall ${fmtMs(wallMs)}`            : null;
  el.textContent = [wall, server].filter(Boolean).join("  ·  ");
}

export function sectionLabel(text) {
  return `<div class="res-section-label">${text}</div>`;
}

export function resultWrap(inner) {
  return `<div class="result-panel">${inner}</div>`;
}

export function statusRunning(label) {
  return resultWrap(`<div class="diag-line"><span class="status-dot running"></span>Running... ${label}</div>`);
}

export function statusError(msg) {
  return resultWrap(`<div class="diag-line error">${msg}</div>`);
}

/* ─── Error toast popup ─────────────────────────────────────────────────────── */

let _toastTimer = null;

export function showErrorToast(message, title = "Request Failed") {
  const host = document.getElementById("toastHost");
  if (!host) return;
  if (_toastTimer) {
    clearTimeout(_toastTimer);
    _toastTimer = null;
  }

  host.innerHTML = `
    <div class="error-toast" role="alert" aria-live="assertive">
      <div class="error-toast-title">${title}</div>
      <div class="error-toast-body">${String(message ?? "Unknown error")}</div>
      <button type="button" class="error-toast-close" aria-label="Close error popup">Dismiss</button>
    </div>
  `;
  host.classList.add("is-visible");

  const closeBtn = host.querySelector(".error-toast-close");
  closeBtn?.addEventListener("click", () => hideErrorToast());

  _toastTimer = setTimeout(() => hideErrorToast(), 6000);
}

export function hideErrorToast() {
  const host = document.getElementById("toastHost");
  if (!host) return;
  host.classList.remove("is-visible");
  host.innerHTML = "";
  if (_toastTimer) {
    clearTimeout(_toastTimer);
    _toastTimer = null;
  }
}

/* ─── Live / Sim mode ────────────────────────────────────────────────────────── */

const MODE_KEY = "sf_data_mode";   // "live" | "sim"

export function getDataMode() {
  return localStorage.getItem(MODE_KEY) === "sim" ? "sim" : "live";
}

function setDataMode(mode) {
  localStorage.setItem(MODE_KEY, mode);
}

/* ─── Shell frame ────────────────────────────────────────────────────────────── */

export function renderShell(contentHtml) {
  const app = document.getElementById("app");
  if (!app) return;

  if (localStorage.getItem(PRECISION_KEY) === null) {
    localStorage.setItem(PRECISION_KEY, String(DEFAULT_PRECISION));
  }
  const precision = getDisplayPrecision();
  const mode = getDataMode();

  app.innerHTML = `
    <header class="app-header">
      <div class="app-header-inner">
        <div class="header-top">
          <div class="header-side header-side--left">
            <div class="mode-toggle-wrap">
              <button id="modeToggleLive" class="mode-toggle-btn${mode === "live" ? " active" : ""}">Live</button>
              <button id="modeToggleSim"  class="mode-toggle-btn${mode === "sim"  ? " active" : ""}">Sim</button>
            </div>
          </div>
          <div class="header-center">
            <h1>Quantitative Stochastic Finance Lab</h1>
          </div>
          <div class="header-side header-side--right">
            <label class="precision-ctl">
              <span>Precision</span>
              <input id="precisionInput" type="number" min="0" max="10" step="1" value="${precision}">
            </label>
          </div>
        </div>
      </div>
    </header>
    <div class="app-shell">
      <main class="main">${contentHtml}</main>
    </div>
    <div id="toastHost" class="toast-host" aria-live="polite"></div>
  `;

  const precisionEl = document.getElementById("precisionInput");
  if (precisionEl) {
    precisionEl.addEventListener("change", () => {
      const n = Number(precisionEl.value);
      const p = Number.isFinite(n) ? Math.min(10, Math.max(0, Math.trunc(n))) : DEFAULT_PRECISION;
      localStorage.setItem(PRECISION_KEY, String(p));
      precisionEl.value = String(p);
    });
  }

  document.getElementById("modeToggleLive")?.addEventListener("click", () => {
    setDataMode("live");
    document.getElementById("modeToggleLive")?.classList.add("active");
    document.getElementById("modeToggleSim")?.classList.remove("active");
    window.dispatchEvent(new CustomEvent("sf:modechange", { detail: "live" }));
  });
  document.getElementById("modeToggleSim")?.addEventListener("click", () => {
    setDataMode("sim");
    document.getElementById("modeToggleSim")?.classList.add("active");
    document.getElementById("modeToggleLive")?.classList.remove("active");
    window.dispatchEvent(new CustomEvent("sf:modechange", { detail: "sim" }));
  });
}
