/* ─── Per-tool render functions ──────────────────────────────────────────────── */

import {
  setHtml,
  fmt,
  fmtMs,
  metricsRow,
  sectionLabel,
  resultWrap,
  tableHtml,
  statusError,
  setDiagBadge,
} from "./core.js";
import {
  sparkline,
  timingsBar,
  groupedBarChart,
  lineChart,
  dualLineChart,
  tornadoChart,
  thresholdCompareChart,
  pnlHistogramCanvas,
} from "./charts.js";

export function renderPricing(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const g = s.greeks || {};
  const e = s.error_decomposition || {};
  const diag = data.diagnostics || {};
  const p = data.input_params || {};
  setDiagBadge("diagPricing", diag);

  const ciLow  = s.mc_ci_low  != null ? fmt(s.mc_ci_low)  : "-";
  const ciHigh = s.mc_ci_high != null ? fmt(s.mc_ci_high) : "-";
  const stdErr = s.mc_std_err != null ? fmt(s.mc_std_err) : "-";

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
    "Method":          m.method,
    "Avg":             m.avg,
    "Min":             m.min,
    "Max":             m.max,
    "Std Dev":         m.std,
    "Avg Err vs BS":   m.avg_err_vs_bs,
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
      ["Best Job",  s.best_spread_job_index],
    ])}
    ${sectionLabel("Method Summary")}
    ${tableHtml(methodSummary, ["Method", "Avg", "Min", "Max", "Std Dev", "Avg Err vs BS"])}
    ${sectionLabel("Per-Job Results")}
    ${tableHtml(rows.map((r) => ({
      "#": r["#"],
      "Spot": r.spot,
      "Strike": r.strike,
      "Vol": r.vol,
      "Black-Scholes": r.bs,
      "Monte Carlo": r.mc,
      "Binomial": r.binomial,
      "MC − BS": r["mc-bs"],
      "Bin − BS": r["bin-bs"],
      "Spread": r.spread,
    })), ["#", "Spot", "Strike", "Vol", "Black-Scholes", "Monte Carlo", "Binomial", "MC − BS", "Bin − BS", "Spread"])}
  `));
}

export function renderHedging(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s    = data.result_summary || {};
  const hist = data.result_details?.histogram || {};
  setDiagBadge("diagHedge", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Strategy",    s.strategy],
      ["Rebalances",  s.n_rebalances],
      ["Paths",       s.n_paths],
      ["PnL Mean",    s.pnl_mean],
      ["PnL Std",     s.pnl_std],
      ["Norm Std",    s.normalized_std],
    ])}
    ${metricsRow([
      ["Q05",              s.pnl_q05],
      ["Median",           s.pnl_q50],
      ["Q95",              s.pnl_q95],
      ["IQR (tail span)",  s.tail_span],
      ["Left tail",        s.left_tail],
      ["Right tail",       s.right_tail],
      ["Tail skew",        s.tail_skew_proxy],
      ["Tail ratio Q95/Q05", s.tail_ratio_q95_q05],
      ["Std × √N",         s.scaling_proxy_std_sqrt_n],
    ])}
    ${sectionLabel("P&L Distribution")}
    <div class="sparkline-wrap">
      ${pnlHistogramCanvas(hist, { q05: s.pnl_q05, q50: s.pnl_q50, q95: s.pnl_q95 })}
    </div>
    <div class="chart-caption">
      Delta-hedge P&amp;L across ${s.n_paths ?? "?"} paths · ${s.n_rebalances ?? "?"} rebalances.
      Red bars = loss, green bars = gain. Dashed lines: q05 / median / q95.
    </div>
  `));
}

export function renderStats(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  setDiagBadge("diagValidation", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["MGF", s.mgf],
      ["Mean", s.mean],
      ["Variance", s.variance],
      ["Sample Size", s.sample_size],
    ])}
  `));
}

export function renderIto(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const pairs = Object.entries(s).map(([k, v]) => [k, v]);
  setDiagBadge("diagValidation", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow(pairs)}
  `));
}

export function renderSimulation(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const preview = data.result_details?.values_preview || [];
  setDiagBadge("diagValidation", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Model", s.model],
      ["Steps", s.n_steps],
      ["Final X", s.x_final],
    ])}
    ${sectionLabel("Path Preview")}
    <div class="sparkline-wrap">${sparkline(preview)}</div>
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
    ${previewP.length ? `${sectionLabel("Path Preview (P Measure)")} <div class="sparkline-wrap">${sparkline(previewP)}</div>` : ""}
    ${previewQ.length ? `${sectionLabel("Path Preview (Q Measure)")} <div class="sparkline-wrap">${sparkline(previewQ)}</div>` : ""}
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
    <div class="chart-caption">Convergence line: x=binomial steps, y=absolute pricing error.</div>
    ${tableHtml(rows.map((r) => ({
      "Steps": r.steps,
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
    <div class="chart-legend">
      <span><i class="swatch swatch-1"></i>price</span>
      <span><i class="swatch swatch-2"></i>runtime_ms</span>
      <span><i class="swatch swatch-3"></i>accuracy_abs_error</span>
    </div>
    ${tableHtml(rows.map((r) => ({
      "Method": r.method,
      "Price": r.price,
      "Runtime (ms)": r.runtime_ms,
      "Abs Error": r.accuracy_abs_error,
      "Rel Error": r.accuracy_rel_error,
      "Runtime Rank": r.runtime_rank,
      "Accuracy Rank": r.accuracy_rank,
      "Efficiency": r.efficiency,
      "Efficiency Rank": r.efficiency_rank,
      "Stability": r.stability,
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
    <div class="chart-legend">
      <span><i class="swatch swatch-threshold"></i>threshold</span>
      <span><i class="swatch swatch-pass"></i>value (pass)</span>
      <span><i class="swatch swatch-fail"></i>value (fail)</span>
    </div>
    ${tableHtml(data, ["capability", "metric", "value", "threshold", "excess", "status", "interpretation", "action"])}
  `));
}

export function renderPerfProfile(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const timings = data.result_details?.timings_ms || [];
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Runs", s.runs],
      ["Average", fmtMs(s.avg_ms)],
      ["Min", fmtMs(s.min_ms)],
      ["Max", fmtMs(s.max_ms)],
      ["Average Spread", s.avg_spread],
      ["Max Threads", s.current_max_threads],
    ])}
    ${timings.length ? `
      ${sectionLabel("Per-Run Timing (ms)")}
      <div class="timings-bar-wrap">${timingsBar(timings)}</div>
    ` : ""}
  `));
}

/* ─── Generic fallback renderers ─────────────────────────────────────────────── */

export function renderKv(elId, data, title = "") {
  const rows = Object.entries(data || {});
  const body = rows.map(([k, v]) => `<dt>${k}</dt><dd>${fmt(v)}</dd>`).join("");
  setHtml(elId, resultWrap(`
    ${title ? sectionLabel(title) : ""}
    <dl class="kv-list">${body || "<dt>status</dt><dd>empty</dd>"}</dl>
  `));
}

export function renderTable(elId, rows, preferredColumns = null, title = "") {
  const data = Array.isArray(rows) ? rows : [];
  const cols = preferredColumns?.length ? preferredColumns : Object.keys(data[0] || {});
  setHtml(elId, resultWrap(`
    ${title ? sectionLabel(title) : ""}
    ${tableHtml(data, cols)}
  `));
}
