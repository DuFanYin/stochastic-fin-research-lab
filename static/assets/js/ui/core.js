import {
  sparkline,
  timingsBar,
  groupedBarChart,
  lineChart,
  dualLineChart,
  tornadoChart,
  ivHeatmap,
  greekSurfaceHeatmap,
  pnlHistogramCanvas,
  thresholdCompareChart,
  efficiencyFrontierChart,
} from "./charts.js";

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

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTemplate(templateId, replacements, fallback) {
  const tpl = document.getElementById(templateId);
  if (!(tpl instanceof HTMLTemplateElement)) return fallback();
  let html = tpl.innerHTML;
  Object.entries(replacements || {}).forEach(([k, v]) => {
    html = html.replaceAll(`{{${k}}}`, String(v ?? ""));
  });
  return html;
}

export function markRunStart() {
  _runStartMs = performance.now();
}

export function setDiagBadge(badgeId, diag) {
  const el = document.getElementById(badgeId);
  if (!el) return;
  const wallMs  = _runStartMs != null ? performance.now() - _runStartMs : null;
  const engineMs = diag?.compute_ms ?? diag?.runtime_ms ?? null;
  const server  = engineMs != null ? `engine ${fmtMs(engineMs)}` : null;
  const wall    = wallMs            != null ? `wall ${fmtMs(wallMs)}`            : null;
  el.textContent = [wall, server].filter(Boolean).join("  ·  ");
}

export function sectionLabel(text) {
  return renderTemplate("tplSectionLabel", { text: htmlEscape(text) }, () => "");
}

export function resultWrap(inner) {
  return renderTemplate("tplResultWrap", { inner: inner ?? "" }, () => inner ?? "");
}

export function statusRunning(label) {
  const line = renderTemplate(
    "tplStatusRunning",
    { label: htmlEscape(label) },
    () => `Running... ${htmlEscape(label)}`
  );
  return resultWrap(line);
}

export function statusError(msg) {
  const line = renderTemplate(
    "tplStatusError",
    { msg: htmlEscape(msg) },
    () => htmlEscape(msg)
  );
  return resultWrap(line);
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

  host.innerHTML = renderTemplate(
    "tplErrorToast",
    {
      title: htmlEscape(title),
      message: htmlEscape(String(message ?? "Unknown error")),
    },
    () => ""
  );
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

export function initShellControls() {
  if (localStorage.getItem(PRECISION_KEY) === null) {
    localStorage.setItem(PRECISION_KEY, String(DEFAULT_PRECISION));
  }
  const mode = getDataMode();
  document.getElementById("modeToggleLive")?.classList.toggle("active", mode === "live");
  document.getElementById("modeToggleSim")?.classList.toggle("active", mode === "sim");
  const precisionEl = document.getElementById("precisionInput");
  if (precisionEl) {
    precisionEl.value = String(getDisplayPrecision());
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

/* ─── Form controls + mode helpers (merged from controls.js) ───────────────── */

export function initSelectButtons(root = document) {
  root.querySelectorAll(".select-buttons").forEach((group) => {
    group.addEventListener("click", (event) => {
      const btn = event.target.closest(".select-btn");
      if (!btn) return;
      group.querySelectorAll(".select-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

export function getSelectButtonValue(id) {
  const group = document.getElementById(id);
  const active = group?.querySelector(".select-btn.active");
  return active?.dataset.value ?? "";
}

export function initSwitchButtons(root = document) {
  root.querySelectorAll(".switch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isOn = btn.dataset.value === "true";
      btn.dataset.value = isOn ? "false" : "true";
      btn.textContent = isOn ? "Off" : "On";
    });
  });
}

export function getSwitchValue(id) {
  const btn = document.getElementById(id);
  return btn?.dataset.value === "true";
}

export function setRunning(id, label) {
  setHtml(id, statusRunning(label));
}

export function setActiveParamGroups(btnId) {
  document.querySelectorAll(".mode-params").forEach((section) => {
    const modes = (section.dataset.modes || "").split(",").map((s) => s.trim());
    section.style.display = modes.includes(btnId) ? "contents" : "none";
  });
}

export function initModeParamSections() {
  document.querySelectorAll(".mode-params").forEach((s) => { s.style.display = "none"; });
}

export function initModeSwitch(ids) {
  ids.forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => {
      ids.forEach((i) => document.getElementById(i)?.classList.remove("active"));
      document.getElementById(id)?.classList.add("active");
    });
  });
}

export function isPicked(id) {
  return document.getElementById(id)?.classList.contains("active") ?? false;
}

export function initToggleButton(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", () => el.classList.toggle("active"));
}

const PARAM_AFFECTS = {
  spot:          ["runBtnPricing", "runBtnScenario", "runBtnHedge", "runBtnPde", "runBtnConvergence", "runBtnBenchmark"],
  strike:        ["runBtnPricing", "runBtnScenario", "runBtnHedge", "runBtnPde", "runBtnConvergence", "runBtnBenchmark"],
  rate:          ["runBtnPricing", "runBtnScenario", "runBtnHedge", "runBtnPde", "runBtnConvergence", "runBtnBenchmark", "runBtnMeasure"],
  vol:           ["runBtnPricing", "runBtnScenario", "runBtnHedge", "runBtnPde", "runBtnConvergence", "runBtnBenchmark", "runBtnMeasure"],
  maturity:      ["runBtnPricing", "runBtnScenario", "runBtnHedge", "runBtnPde", "runBtnConvergence", "runBtnBenchmark", "runBtnMeasure"],
  mu:            ["runBtnMeasure"],
  dividendYield: ["runBtnPricing", "runBtnScenario", "runBtnPde", "runBtnConvergence", "runBtnBenchmark"],
};

export function initParamFlash() {
  Object.entries(PARAM_AFFECTS).forEach(([inputId, btnIds]) => {
    document.getElementById(inputId)?.addEventListener("input", () => {
      btnIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add("param-changed");
        setTimeout(() => el.classList.remove("param-changed"), 800);
      });
    });
  });
}

export {
  sparkline,
  timingsBar,
  groupedBarChart,
  lineChart,
  dualLineChart,
  tornadoChart,
  ivHeatmap,
  greekSurfaceHeatmap,
  pnlHistogramCanvas,
  thresholdCompareChart,
  efficiencyFrontierChart,
};

export {
  renderPricing,
  renderScenario,
  renderIv,
  renderStress,
  renderPricingBatch,
  renderHedging,
  renderMeasure,
  renderMeasureCompare,
  renderPde,
  renderConvergence,
  renderBenchmark,
  renderValidation,
  renderKv,
  renderGreekSurface,
  renderMultiLeg,
  renderCalibration,
} from "./renderers.js";
