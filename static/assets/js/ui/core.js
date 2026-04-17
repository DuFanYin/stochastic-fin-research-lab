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
  const engineMs = diag?.compute_ms ?? diag?.runtime_ms ?? null;
  const server  = engineMs != null ? `engine ${fmtMs(engineMs)}` : null;
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

  initShellControls();
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

/* ─── Charts ───────────────────────────────────────────────────────────────── */

export function sparkline(values, w = 320, h = 48) {
  if (!values || !values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1 || 1);
  const pts = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="1.5" />
  </svg>`;
}

export function timingsBar(timings, w = 320, h = 40) {
  if (!timings || !timings.length) return "";
  const max = Math.max(...timings) || 1;
  const bw = w / timings.length;
  const bars = timings.map((t, i) => {
    const bh = (t / max) * h;
    return `<rect x="${i * bw}" y="${h - bh}" width="${bw - 1}" height="${bh}" fill="var(--brand)" opacity="0.7" />`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bars}</svg>`;
}

function num(v, fallback = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function normalize(values) {
  const nums = values.map((v) => num(v));
  const maxAbs = Math.max(...nums.map((v) => Math.abs(v)), 1e-12);
  return { nums, maxAbs };
}

export function groupedBarChart(rows, keys, opts = {}) {
  if (!rows?.length || !keys?.length) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 180;
  const pad = 24;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const values = rows.flatMap((r) => keys.map((k) => num(r?.[k])));
  const { maxAbs } = normalize(values);
  const groupW = innerW / rows.length;
  const barW = Math.max(4, (groupW - 6) / keys.length);
  const colors = ["#8e8e8e", "#b0b0b0", "#d2d2d2", "#6f6f6f"];
  const bars = [];
  rows.forEach((row, gi) => {
    keys.forEach((k, ki) => {
      const v = num(row?.[k]);
      const bh = (Math.abs(v) / maxAbs) * innerH;
      const x = pad + gi * groupW + 3 + ki * barW;
      const y = pad + (innerH - bh);
      bars.push(`<rect x="${x}" y="${y}" width="${Math.max(2, barW - 2)}" height="${bh}" fill="${colors[ki % colors.length]}" opacity="0.85" />`);
    });
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <line x1="${pad}" y1="${pad + innerH}" x2="${pad + innerW}" y2="${pad + innerH}" stroke="#6a6a6a" stroke-width="1" />
    ${bars.join("")}
  </svg>`;
}

export function lineChart(points, opts = {}) {
  if (!points?.length) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 180;
  const pad = 24;
  const xs = points.map((p) => num(p?.x));
  const ys = points.map((p) => num(p?.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const pts = points.map((p) => {
    const x = pad + ((num(p?.x) - minX) / dx) * (w - pad * 2);
    const y = h - pad - ((num(p?.y) - minY) / dy) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="#c9c9c9" stroke-width="1.8" />
  </svg>`;
}

export function dualLineChart(seriesA, seriesB, opts = {}) {
  const n = Math.min(seriesA?.length || 0, seriesB?.length || 0);
  if (!n) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 180;
  const pad = 24;
  const xs = Array.from({ length: n }, (_, i) => i);
  const allY = [...seriesA.slice(0, n), ...seriesB.slice(0, n)].map((v) => num(v));
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const dy = maxY - minY || 1;
  const dx = (n - 1) || 1;
  const mk = (arr) => xs.map((x, i) => {
    const px = pad + (x / dx) * (w - pad * 2);
    const py = h - pad - ((num(arr[i]) - minY) / dy) * (h - pad * 2);
    return `${px},${py}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${mk(seriesA)}" fill="none" stroke="#d6d6d6" stroke-width="1.8" />
    <polyline points="${mk(seriesB)}" fill="none" stroke="#7f7f7f" stroke-width="1.8" />
  </svg>`;
}

export function tornadoChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const w = opts.w ?? 560;
  const h = Math.max(120, rows.length * 24 + 24);
  const cx = w / 2;
  const pad = 16;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(num(r?.value))), 1e-12);
  const bwMax = (w / 2) - 90;
  const bars = rows.map((r, i) => {
    const v = num(r?.value);
    const bw = (Math.abs(v) / maxAbs) * bwMax;
    const y = pad + i * 24;
    const x = v >= 0 ? cx : (cx - bw);
    const fill = v >= 0 ? "#b8b8b8" : "#6f6f6f";
    return `<rect x="${x}" y="${y}" width="${bw}" height="16" fill="${fill}" opacity="0.9" />`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <line x1="${cx}" y1="6" x2="${cx}" y2="${h - 6}" stroke="#7a7a7a" stroke-width="1" />
    ${bars}
  </svg>`;
}

let _histId = 0;

export function pnlHistogramCanvas(histogram, opts = {}) {
  if (!histogram?.edges?.length || !histogram?.counts?.length) return "";
  const edges = histogram.edges;
  const counts = histogram.counts;
  const n = counts.length;
  const w = opts.w ?? 560;
  const h = opts.h ?? 160;
  const padL = opts.padL ?? 8;
  const padR = opts.padR ?? 8;
  const padT = opts.padT ?? 8;
  const padB = opts.padB ?? 20;
  const q05 = opts.q05 ?? null;
  const q50 = opts.q50 ?? null;
  const q95 = opts.q95 ?? null;

  const id = `pnl-hist-${++_histId}`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const lo = edges[0];
    const hi = edges[n];
    const xSpan = hi - lo || 1;
    const maxC = Math.max(...counts, 1);
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const toX = (v) => padL + ((v - lo) / xSpan) * innerW;
    const barW = innerW / n;

    ctx.strokeStyle = "rgba(120,120,120,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    counts.forEach((c, i) => {
      const bh = (c / maxC) * innerH;
      const x = padL + i * barW;
      const y = padT + innerH - bh;
      const mid = (edges[i] + edges[i + 1]) / 2;
      ctx.fillStyle = mid < 0 ? "rgba(200,100,100,0.65)" : "rgba(100,180,130,0.65)";
      ctx.fillRect(x + 0.5, y, Math.max(barW - 1, 1), bh);
    });

    const drawVLine = (v, color, label) => {
      if (v == null || v < lo || v > hi) return;
      const x = toX(v);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, padT + innerH + 13);
      ctx.restore();
    };
    drawVLine(q05, "rgba(200,120,80,0.9)", "q05");
    drawVLine(q50, "rgba(180,180,180,0.9)", "med");
    drawVLine(q95, "rgba(100,180,130,0.9)", "q95");

    if (lo < 0 && hi > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(200,200,200,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(0), padT);
      ctx.lineTo(toX(0), padT + innerH);
      ctx.stroke();
      ctx.restore();
    }
  });

  return `<canvas id="${id}" width="${w}" height="${h}" style="display:block;width:${w}px;height:${h}px"></canvas>`;
}

export function thresholdCompareChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const w = opts.w ?? 560;
  const h = Math.max(120, rows.length * 24 + 24);
  const pad = 18;
  const maxV = Math.max(
    ...rows.map((r) => Math.max(Math.abs(num(r?.value)), Math.abs(num(r?.threshold)))),
    1e-12
  );
  const bwMax = w - 2 * pad;
  const bars = rows.map((r, i) => {
    const y = pad + i * 24;
    const vW = (Math.abs(num(r?.value)) / maxV) * bwMax;
    const tW = (Math.abs(num(r?.threshold)) / maxV) * bwMax;
    return `
      <rect x="${pad}" y="${y}" width="${tW}" height="14" fill="#5f5f5f" opacity="0.45" />
      <rect x="${pad}" y="${y + 2}" width="${vW}" height="10" fill="${r?.status === "pass" ? "#a8a8a8" : "#d09a9a"}" />
    `;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">${bars}</svg>`;
}

/* ─── Renderers ────────────────────────────────────────────────────────────── */

export function renderPricing(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const g = s.greeks || {};
  const e = s.error_decomposition || {};
  const diag = data.diagnostics || {};
  const p = data.input_params || {};
  setDiagBadge("diagPricing", diag);

  const ciLow = s.mc_ci_low != null ? fmt(s.mc_ci_low) : "-";
  const ciHigh = s.mc_ci_high != null ? fmt(s.mc_ci_high) : "-";

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Black-Scholes Price", s.bs],
      ["Monte Carlo Price", s.mc],
      ["Binomial Price", s.binomial],
      ["Method Spread", s.method_spread],
    ])}
    ${metricsRow([
      ["Monte Carlo Std Error", s.mc_std_err],
      ["Monte Carlo 95% CI", `[${ciLow}, ${ciHigh}]`],
      ["Monte Carlo − Black-Scholes", e.mc_minus_bs],
      ["Binomial − Black-Scholes", e.binomial_minus_bs],
    ])}
    ${metricsRow([
      ["Delta (Black-Scholes)", g.delta_bs],
      ["Vega (Black-Scholes)", g.vega_bs],
      ["Relative Spread", s.relative_spread],
      ["Paths", p.n_paths],
    ])}
    ${metricsRow([
      ["Spot", p.spot],
      ["Strike", p.strike],
      ["Volatility", p.vol],
      ["Maturity", p.maturity],
    ])}
    ${s.american != null ? metricsRow([["American Price (Binomial Tree)", s.american]]) : ""}
  `));
}

export function renderScenario(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const rows = data.result_details?.rows || [];
  const tornadoPoints = data.result_details?.tornado_points || [];
  setDiagBadge("diagScenario", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${sectionLabel("Scenario Black-Scholes Prices")}
    <div class="sparkline-wrap">${tornadoChart(tornadoPoints)}</div>
    <div class="chart-caption">Tornado sensitivity chart: left negative impact, right positive impact (vs base).</div>
    ${tableHtml(rows, ["rank", "scenario", "base_price", "bs_price", "vs_base_diff", "abs_vs_base_diff", "vs_base_pct", "vs_base_bps"])}
  `));
}

export function renderPricingBatch(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const rows = data.result_details?.flat_rows || [];
  const methodSummary = (data.result_details?.method_summary || []).map((m) => ({
    Method: m.method,
    Avg: m.avg,
    Min: m.min,
    Max: m.max,
    "Std Dev": m.std,
    "Avg Err vs BS": m.avg_err_vs_bs,
  }));
  setDiagBadge("diagPricing", data.diagnostics);

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Jobs", s.job_count],
      ["Total Runtime", fmtMs(s.total_compute_ms)],
      ["Average Spread", s.avg_method_spread],
      ["Median Spread", s.p50_method_spread],
      ["95th Pct Spread", s.p95_method_spread],
      ["Max Spread", s.max_method_spread],
      ["Spread Std Dev", s.spread_std],
      ["Spread Coeff of Variation", s.spread_cv],
      ["Worst Job", s.worst_spread_job_index],
      ["Best Job", s.best_spread_job_index],
    ])}
    ${sectionLabel("Method Summary")}
    ${tableHtml(methodSummary, ["Method", "Avg", "Min", "Max", "Std Dev", "Avg Err vs BS"])}
    ${sectionLabel("Per-Job Results")}
    ${tableHtml(rows.map((r) => ({
      "#": r["#"],
      Spot: r.spot,
      Strike: r.strike,
      Vol: r.vol,
      "Black-Scholes": r.bs,
      "Monte Carlo": r.mc,
      Binomial: r.binomial,
      "MC − BS": r["mc-bs"],
      "Bin − BS": r["bin-bs"],
      Spread: r.spread,
    })), ["#", "Spot", "Strike", "Vol", "Black-Scholes", "Monte Carlo", "Binomial", "MC − BS", "Bin − BS", "Spread"])}
  `));
}

export function renderHedging(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || data.summary || {};
  const details = data.result_details || data.details || {};
  const hist = details.histogram || {};
  const strategyCompare = details.strategy_compare || {};
  const compareConfig = details.compare_config || {};
  const bestStrategy = details.best_strategy || data.strategy_recommendation || {};
  const strategyRows = Object.entries(strategyCompare).map(([name, stats]) => ({
    strategy: name,
    mean: stats?.mean,
    std: stats?.std,
    q05: stats?.q05,
    q50: stats?.q50,
    q95: stats?.q95,
    var95: stats?.var95,
    es95: stats?.es95,
    turnover: stats?.turnover,
    transaction_cost: stats?.transaction_cost,
  }));
  setDiagBadge("diagHedge", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Strategy", s.strategy],
      ["Rebalances", s.n_rebalances],
      ["Paths", s.n_paths],
      ["PnL Mean", s.pnl_mean],
      ["PnL Std", s.pnl_std],
      ["Norm Std", s.normalized_std],
    ])}
    ${metricsRow([
      ["Q05", s.pnl_q05],
      ["Median", s.pnl_q50],
      ["Q95", s.pnl_q95],
      ["IQR (tail span)", s.tail_span],
      ["Left tail", s.left_tail],
      ["Right tail", s.right_tail],
      ["Tail skew", s.tail_skew_proxy],
      ["Tail ratio Q95/Q05", s.tail_ratio_q95_q05],
      ["Std × √N", s.scaling_proxy_std_sqrt_n],
    ])}
    ${sectionLabel("P&L Distribution")}
    <div class="sparkline-wrap">
      ${pnlHistogramCanvas(hist, { q05: s.pnl_q05, q50: s.pnl_q50, q95: s.pnl_q95 })}
    </div>
    <div class="chart-caption">
      Delta-hedge P&amp;L across ${s.n_paths ?? "?"} paths · ${s.n_rebalances ?? "?"} rebalances.
      Red bars = loss, green bars = gain. Dashed lines: q05 / median / q95.
    </div>
    ${strategyRows.length ? `
      ${sectionLabel("Strategy Compare")}
      ${metricsRow([
        ["TC (bps)", compareConfig.transaction_cost_bps],
        ["Threshold", compareConfig.rebalance_threshold],
        ["Vol mismatch x", compareConfig.vol_mismatch_mult],
        ["Best strategy", bestStrategy.name],
      ])}
      ${metricsRow([
        ["Best reason", bestStrategy.reason],
        ["Best ES95", bestStrategy.es95],
        ["Best Std", bestStrategy.std],
        ["Best Mean", bestStrategy.mean],
      ])}
      ${tableHtml(strategyRows, ["strategy", "mean", "std", "q05", "q50", "q95", "var95", "es95", "turnover", "transaction_cost"])}
    ` : ""}
  `));
}

export function renderMeasure(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const preview = data.result_details?.density_preview || [];
  const p = data.input_params || {};
  setDiagBadge("diagMeasure", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Theta (Market Price of Risk)", s.theta_market_price_of_risk],
      ["Terminal Density", s.final_density],
      ["Steps", p.n_steps],
      ["Density Count", s.density_count],
      ["Density Integral", s.density_integral_proxy],
      ["Density Coeff of Variation", s.density_cv],
      ["Density Tail Ratio Q95/Q05", s.density_tail_ratio_q95_q05],
      ["Density Autocorrelation Lag 1", s.density_autocorr_lag1],
    ])}
    ${sectionLabel("Risk-Neutral Density Preview")}
    <div class="sparkline-wrap">${sparkline(preview)}</div>
  `));
}

export function renderMeasureCompare(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const d = data.result_details || {};
  const distributionRows = d.distribution_rows || [];
  const previewP = d.path_preview?.P || [];
  const previewQ = d.path_preview?.Q || [];
  setDiagBadge("diagMeasure", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Theta (Market Price of Risk)", s.theta_market_price_of_risk],
      ["Drift (Physical)", s.drift_p],
      ["Drift (Risk-Neutral)", s.drift_q],
      ["Drift Gap", s.drift_diff],
      ["Terminal Mean (Physical)", s.terminal_mean_p],
      ["Terminal Mean (Risk-Neutral)", s.terminal_mean_q],
      ["Mean Shift", s.mean_shift],
      ["Mean Shift %", s.mean_shift_pct],
      ["Drift Ratio", s.drift_ratio],
      ["Variance Ratio", s.variance_ratio],
      ["Q95 Gap", s.q95_gap],
      ["Variance Gap", s.var_gap],
      ["Path Dispersion Gap", s.path_dispersion_gap],
    ])}
    ${sectionLabel("Distribution Comparison: Physical Measure vs Risk-Neutral Measure")}
    ${tableHtml(distributionRows, ["measure", "mean", "variance", "q05", "q50", "q95"])}
    ${previewP.length && previewQ.length ? `
      ${sectionLabel("P/Q Dual-Path Comparison")}
      <div class="sparkline-wrap">${dualLineChart(previewP, previewQ)}</div>
      <div class="chart-legend">
        <span><i class="swatch swatch-light"></i>P path</span>
        <span><i class="swatch swatch-dark"></i>Q path</span>
      </div>
    ` : ""}
  `));
}

export function renderPde(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  setDiagBadge("diagPde", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["PDE Price", s.price],
      ["Method", s.method],
      ["Space Grid (S)", s.s_steps],
      ["Time Grid (T)", s.t_steps],
      ["Total Grid Points", s.grid_points],
      ["S/T Aspect Ratio", s.s_t_aspect_ratio],
      ["Grid Density per Maturity", s.grid_density_per_maturity],
      ["Price vs Black-Scholes Gap", s.price_vs_bs_gap],
    ])}
  `));
}

export function renderConvergence(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const rows = data.result_details?.rows || [];
  const curvePoints = data.result_details?.curve_points || [];
  setDiagBadge("diagConvergence", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Black-Scholes Reference Price", s.bs_ref],
      ["Min Absolute Error", s.best_abs_error],
      ["Max Absolute Error", s.worst_abs_error],
      ["Ladder Size", s.ladder_size],
      ["Best Steps", s.best_steps],
      ["Last Error", s.last_error],
      ["Improvement Ratio", s.improvement_ratio],
      ["Log Slope", s.log_slope],
      ["First to Best Improvement", s.first_to_best_improvement],
      ["Last Two Improvement Ratio", s.last_two_improvement_ratio],
      ["Monotonicity Breaks", s.monotonicity_break_count],
    ])}
    ${sectionLabel("Convergence Table")}
    <div class="sparkline-wrap">${lineChart(curvePoints)}</div>
    ${tableHtml(rows.map((r) => ({
      Steps: r.steps,
      "Binomial Price": r.binomial,
      "Absolute Error": r.abs_error,
      "Relative Error": r.rel_error,
      "Error Ratio vs Prev": r.error_ratio_vs_prev,
    })), ["Steps", "Binomial Price", "Absolute Error", "Relative Error", "Error Ratio vs Prev"])}
  `));
}

export function renderBenchmark(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const rows = data.result_details?.rows || [];
  const chartRows = data.result_details?.chart_rows || rows;
  setDiagBadge("diagBenchmark", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Baseline Method", s.baseline_method],
      ["Baseline Price", s.baseline_price],
      ["Winner Method", s.winner_method],
      ["Winner Relative Error", s.winner_rel_error],
    ])}
    ${sectionLabel("Method Comparison")}
    <div class="sparkline-wrap">${groupedBarChart(chartRows, ["price", "runtime_ms", "accuracy_abs_error"])}</div>
    ${tableHtml(rows.map((r) => ({
      Method: r.method,
      Price: r.price,
      "Runtime (ms)": r.runtime_ms,
      "Abs Error": r.accuracy_abs_error,
      "Rel Error": r.accuracy_rel_error,
      "Runtime Rank": r.runtime_rank,
      "Accuracy Rank": r.accuracy_rank,
      Efficiency: r.efficiency,
      "Efficiency Rank": r.efficiency_rank,
      Stability: r.stability,
    })), ["Method", "Price", "Runtime (ms)", "Abs Error", "Rel Error", "Runtime Rank", "Accuracy Rank", "Efficiency", "Efficiency Rank", "Stability"])}
  `));
}

export function renderValidation(elId, rows, summary = null) {
  const data = Array.isArray(rows) ? rows : [];
  const failByCap = summary?.failed_by_capability || {};
  const thresholdRows = summary?.threshold_rows || data;
  setDiagBadge("diagValidation", summary);
  setHtml(elId, resultWrap(`
    ${summary ? metricsRow([
      ["Total Checks", summary.checks_total],
      ["Failed", summary.checks_failed],
      ["Gate Decision", summary.gate_decision],
      ["Fail Rate", summary.fail_rate],
      ["Failed (Stats)", failByCap.stats ?? 0],
      ["Failed (Itô)", failByCap.ito ?? 0],
      ["Failed (Simulation)", failByCap.simulation ?? 0],
      ["Max Excess", summary.max_excess ?? null],
      ["Max Excess Item", summary.max_excess_item ?? null],
    ]) : ""}
    ${sectionLabel("Validation Metrics vs Thresholds")}
    <div class="sparkline-wrap">${thresholdCompareChart(thresholdRows)}</div>
    ${tableHtml(data, ["capability", "metric", "value", "threshold", "excess", "status", "interpretation", "action"])}
  `));
}

export function renderKv(elId, data, title = "") {
  const rows = Object.entries(data || {});
  const body = rows.map(([k, v]) => `<dt>${k}</dt><dd>${fmt(v)}</dd>`).join("");
  setHtml(elId, resultWrap(`
    ${title ? sectionLabel(title) : ""}
    <dl class="kv-list">${body || "<dt>status</dt><dd>empty</dd>"}</dl>
  `));
}
