import {
  fmt,
  fmtMs,
  setHtml,
  statusError,
  resultWrap,
  sectionLabel,
  setDiagBadge,
  tableHtml,
  metricsRow,
} from "./core.js";

function pass(text) { return `<span class="text-success">${text}</span>`; }
function fail(text) { return `<span class="text-danger">${text}</span>`; }
function warn(text) { return `<span class="text-warning">${text}</span>`; }
function badge(cls, text) { return `<span class="signal-badge signal-badge--${cls}">${text}</span>`; }
import {
  sparkline,
  groupedBarChart,
  lineChart,
  dualLineChart,
  tornadoChart,
  ivHeatmap,
  greekSurfaceHeatmap,
  redrawTermStructure,
  redrawSmile,
  pnlHistogramCanvas,
  thresholdCompareChart,
  efficiencyFrontierChart,
  horizontalBarChart,
  residualBarChart,
  rankingBarChart,
  payoffChart,
} from "./charts.js";

export function renderPricing(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const g = s.greeks || {};
  const e = s.error_decomposition || {};
  setDiagBadge("diagPricing", data.diagnostics || {});

  const ciLow  = s.mc_ci_low  != null ? fmt(s.mc_ci_low)  : "-";
  const ciHigh = s.mc_ci_high != null ? fmt(s.mc_ci_high) : "-";
  const spreadOk = s.method_spread != null && Math.abs(Number(s.method_spread)) < 0.01;
  const spreadFmt = s.method_spread != null ? (spreadOk ? pass(fmt(s.method_spread)) : warn(fmt(s.method_spread))) : "-";
  const relSpreadFmt = s.relative_spread != null
    ? (Math.abs(Number(s.relative_spread)) < 0.005 ? pass(fmt(s.relative_spread)) : warn(fmt(s.relative_spread)))
    : "-";

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Black-Scholes Price", s.bs],
      ["Monte Carlo Price", s.mc],
      ["Binomial Price", s.binomial],
      ["Method Spread", spreadFmt],
    ])}
    ${metricsRow([
      ["MC Std Error", s.mc_std_err],
      ["MC 95% CI", `[${ciLow}, ${ciHigh}]`],
      ["MC − BS", e.mc_minus_bs],
      ["Binomial − BS", e.binomial_minus_bs],
    ])}
    ${metricsRow([
      ["Delta (BS)", g.delta_bs],
      ["Gamma (BS)", g.gamma_bs],
      ["Theta (BS)", g.theta_bs],
      ["Vega (BS)",  g.vega_bs],
      ["Rho (BS)",   g.rho_bs],
      ["Relative Spread", relSpreadFmt],
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
  `));
}

export function renderIv(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const details = data.result_details || {};
  const term = details.term_structure_rows || [];
  const smile = details.smile_rows || [];
  const surface = details.surface_grid_rows || [];
  const smilesByExpiry = details.smiles_by_expiry || {};
  setDiagBadge("diagIv", data.diagnostics);

  const expiryKeys = Object.keys(smilesByExpiry);
  const defaultExpiry = s.smile_selected_expiry || expiryKeys[0] || "";
  const uid = Date.now();
  const dropdownId = `iv-expiry-sel-${uid}`;
  const termCanvasId = `iv-term-canvas-${uid}`;
  const smileCanvasId = `iv-smile-canvas-${uid}`;
  const smileCaptionId = `iv-smile-caption-${uid}`;

  const dropdownHtml = expiryKeys.length > 1 ? `
    <div class="iv-expiry-row">
      <label class="iv-expiry-label">Expiry</label>
      <select id="${dropdownId}" class="iv-expiry-select">
        ${expiryKeys.map((k) => `<option value="${k}"${k === defaultExpiry ? " selected" : ""}>${k}</option>`).join("")}
      </select>
    </div>` : "";

  const initialSmileRows = expiryKeys.length ? (smilesByExpiry[defaultExpiry] || smile) : smile;

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Interpolated IV", s.interp_iv != null ? (s.interp_iv_pct?.toFixed ? s.interp_iv_pct.toFixed(2) + "%" : s.interp_iv_pct) : "-"],
      ["Interp Method", s.interp_method],
      ["Smile Expiry", s.smile_selected_expiry],
      ["Skew Slope", s.local_skew_slope],
      ["Curvature", s.local_curvature],
      ["Confidence", s.confidence_label ? `${s.confidence_label} (${s.confidence_score})` : "-"],
    ])}
    ${sectionLabel("Term Structure — ATM IV by Expiry")}
    ${dropdownHtml}
    <div class="sparkline-wrap"><canvas id="${termCanvasId}" class="chart-canvas" style="width:100%;"></canvas></div>
    <div class="chart-caption">ATM implied volatility across expiries · ${term.length} points · select expiry to highlight.</div>
    ${sectionLabel("Volatility Smile")}
    <div class="sparkline-wrap"><canvas id="${smileCanvasId}" class="chart-canvas" style="width:100%;"></canvas></div>
    <div id="${smileCaptionId}" class="chart-caption">IV vs log-moneyness ln(K/S) · expiry ${defaultExpiry} · shaded area shows smile shape.</div>
    ${sectionLabel("IV Surface Heatmap (K/S × T)")}
    <div class="sparkline-wrap">${ivHeatmap(surface)}</div>
    <div class="chart-caption">Color = IV level · Red = burst high vol · Blue = suppressed · colorbar on right.</div>
  `));

  // Draw initial charts onto stable canvas elements (no innerHTML swap needed)
  requestAnimationFrame(() => {
    redrawTermStructure(termCanvasId, term, { highlightExpiry: defaultExpiry });
    redrawSmile(smileCanvasId, initialSmileRows);
  });

  if (expiryKeys.length > 1) {
    document.getElementById(dropdownId)?.addEventListener("change", (e) => {
      const key = e.target.value;
      const rows = smilesByExpiry[key] || [];
      redrawTermStructure(termCanvasId, term, { highlightExpiry: key });
      redrawSmile(smileCanvasId, rows);
      const caption = document.getElementById(smileCaptionId);
      if (caption) caption.textContent = `IV vs log-moneyness ln(K/S) · expiry ${key} · ${rows.length} strikes.`;
    });
  }
}

export function renderStress(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const rows = data.result_details?.rows || [];
  const ranking = data.result_details?.severity_ranking || [];
  const corrRanking = data.result_details?.portfolio_correlation_ranking || [];
  const hedgeResilience = data.result_details?.hedge_resilience_ranking || [];
  const tornadoPoints = data.result_details?.tornado_points || [];
  const css = data.result_details?.cross_scenario_summary || null;
  setDiagBadge("diagStress", data.diagnostics);

  const worstShiftFmt = s.worst_mc_shift != null ? fail(fmt(s.worst_mc_shift)) : "-";
  const robustFmt = css?.robustness_score != null
    ? (Number(css.robustness_score) >= 0.7 ? pass(fmt(css.robustness_score))
     : Number(css.robustness_score) >= 0.4 ? warn(fmt(css.robustness_score))
     : fail(fmt(css.robustness_score)))
    : null;

  const crossSection = css ? `
    ${sectionLabel("Cross-Scenario Robustness")}
    ${metricsRow([
      ["Robustness Score", robustFmt ?? css.robustness_score],
      ["Key Driver", css.key_driver],
      ["Key Driver Contribution", css.key_driver_contribution_pct != null ? css.key_driver_contribution_pct + "%" : "-"],
      ["Worst Scenario", css.worst_scenario],
      ["Worst P&L Impact", css.worst_pnl_impact != null ? fail(fmt(css.worst_pnl_impact)) : "-"],
      ["Scenarios Breaching 5% Threshold", css.scenarios_breaching_threshold > 0 ? warn(css.scenarios_breaching_threshold) : pass(css.scenarios_breaching_threshold ?? 0)],
      ["Hedge Resilience Mean ES95", css.hedge_resilience_mean],
      ["Hedge Resilience Worst ES95", css.hedge_resilience_worst != null ? fail(fmt(css.hedge_resilience_worst)) : "-"],
    ])}
  ` : "";

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Scenario Pack", s.pack],
      ["Severity", s.severity],
      ["Scenario Count", s.scenario_count],
      ["Base MC", s.base_mc],
      ["Worst Scenario", s.worst_scenario],
      ["Worst MC Shift", worstShiftFmt],
    ])}
    ${crossSection}
    ${sectionLabel("Stress Severity Tornado")}
    <div class="sparkline-wrap">${tornadoChart(tornadoPoints)}</div>
    ${sectionLabel("Scenario Ranking")}
    <div class="sparkline-wrap">${rankingBarChart(ranking, "scenario", "severity_score")}</div>
    ${sectionLabel("Portfolio Correlation Ranking")}
    <div class="sparkline-wrap">${rankingBarChart(corrRanking, "scenario", "portfolio_correlation_score")}</div>
    ${sectionLabel("Hedge Resilience Ranking")}
    <div class="sparkline-wrap">${rankingBarChart(hedgeResilience, "scenario", "hedge_normalized_std")}</div>
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

  const spreadPoints = rows.map((r, i) => ({ x: i, y: Number.isFinite(Number(r.spread)) ? Number(r.spread) : 0 }));
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
    ${sectionLabel("Spread by Job")}
    <div class="sparkline-wrap">${lineChart(spreadPoints)}</div>
  `));
}

export function renderHedging(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s    = data.result_summary || data.summary || {};
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

  const frontierCanvasId = `hedgeFrontier_${Date.now()}`;
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Strategy",   s.strategy],
      ["Rebalances", s.n_rebalances],
      ["Paths",      s.n_paths],
      ["PnL Mean",   s.pnl_mean],
      ["PnL Std",    s.pnl_std],
      ["Norm Std",   s.normalized_std],
      ["Q05",        s.pnl_q05],
      ["Median",     s.pnl_q50],
      ["Q95",        s.pnl_q95],
      ["Tail Skew",  s.tail_skew_proxy],
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
      ${sectionLabel("Hedge Efficiency Frontier")}
      <div class="sparkline-wrap">
        <canvas id="${frontierCanvasId}" class="chart-canvas" style="width:100%;height:220px;"></canvas>
      </div>
      <div class="chart-caption">Cost (x) vs. risk ES95 (y). Green = Pareto-optimal. Lower-left is better.</div>
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

  // Draw efficiency frontier after DOM is updated
  if (strategyRows.length) {
    requestAnimationFrame(() => {
      const canvas = document.getElementById(frontierCanvasId);
      if (canvas) efficiencyFrontierChart(canvas, strategyRows);
    });
  }
}


export function renderMeasure(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const preview = data.result_details?.density_preview || [];
  setDiagBadge("diagMeasure", data.diagnostics);
  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Theta (MPR)", s.theta_market_price_of_risk],
      ["Terminal Density", s.final_density],
      ["Density CV", s.density_cv],
      ["Density Autocorr", s.density_autocorr_lag1],
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
      ["Theta (MPR)",       s.theta_market_price_of_risk],
      ["Drift P",           s.drift_p],
      ["Drift Q",           s.drift_q],
      ["Mean Shift %",      s.mean_shift_pct],
      ["Drift Ratio",       s.drift_ratio],
      ["Variance Ratio",    s.variance_ratio],
      ["Path Dispersion Δ", s.path_dispersion_gap],
    ])}
    ${sectionLabel("Distribution Comparison: Physical Measure vs Risk-Neutral Measure")}
    <div class="sparkline-wrap">${groupedBarChart(distributionRows, ["mean", "variance", "q05", "q50", "q95"])}</div>
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
      ["Price vs Black-Scholes Gap", s.price_vs_bs_gap != null ? (Math.abs(Number(s.price_vs_bs_gap)) < 0.001 ? pass(fmt(s.price_vs_bs_gap)) : warn(fmt(s.price_vs_bs_gap))) : "-"],
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
      ["Min Absolute Error", s.best_abs_error != null ? pass(fmt(s.best_abs_error)) : "-"],
      ["Max Absolute Error", s.worst_abs_error != null ? fail(fmt(s.worst_abs_error)) : "-"],
      ["Ladder Size", s.ladder_size],
      ["Best Steps", s.best_steps],
      ["Last Error", s.last_error],
      ["Improvement Ratio", s.improvement_ratio != null ? (Number(s.improvement_ratio) > 2 ? pass(fmt(s.improvement_ratio)) : warn(fmt(s.improvement_ratio))) : "-"],
      ["Log Slope", s.log_slope],
      ["First to Best Improvement", s.first_to_best_improvement],
      ["Last Two Improvement Ratio", s.last_two_improvement_ratio],
      ["Monotonicity Breaks", s.monotonicity_break_count > 0 ? warn(s.monotonicity_break_count) : pass(s.monotonicity_break_count ?? 0)],
    ])}
    ${sectionLabel("Convergence")}
    <div class="sparkline-wrap">${lineChart(curvePoints)}</div>
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
      ["Winner Method", s.winner_method ? pass(s.winner_method) : "-"],
      ["Winner Relative Error", s.winner_rel_error != null ? (Number(s.winner_rel_error) < 0.001 ? pass(fmt(s.winner_rel_error)) : warn(fmt(s.winner_rel_error))) : "-"],
    ])}
    ${sectionLabel("Method Comparison")}
    <div class="sparkline-wrap">${groupedBarChart(chartRows, ["price", "runtime_ms", "accuracy_abs_error"])}</div>
  `));
}

export function renderValidation(elId, rows, summary = null) {
  const data = Array.isArray(rows) ? rows : [];
  const failByCap = summary?.failed_by_capability || {};
  const thresholdRows = summary?.threshold_rows || data;
  setDiagBadge("diagValidation", summary);

  const gate = summary?.gate_decision;
  const gateFmt = gate === "pass" ? pass(gate) : gate === "fail" ? fail(gate) : gate;
  const failedFmt = summary?.checks_failed > 0 ? fail(summary.checks_failed) : pass(summary?.checks_failed ?? 0);

  const coloredRows = data.map((r) => ({
    ...r,
    status: r.status === "pass" ? pass("pass") : r.status === "fail" ? fail("fail") : r.status,
    excess: r.excess != null && Number(r.excess) > 0 ? fail(fmt(r.excess)) : fmt(r.excess ?? 0),
  }));

  setHtml(elId, resultWrap(`
    ${summary ? metricsRow([
      ["Total Checks", summary.checks_total],
      ["Failed", failedFmt],
      ["Gate Decision", gateFmt],
      ["Fail Rate", summary.fail_rate],
      ["Failed (Stats)", failByCap.stats ?? 0],
      ["Failed (Itô)", failByCap.ito ?? 0],
      ["Failed (Simulation)", failByCap.simulation ?? 0],
      ["Max Excess", summary.max_excess ?? null],
      ["Max Excess Item", summary.max_excess_item ?? null],
    ]) : ""}
    ${sectionLabel("Validation Metrics vs Thresholds")}
    <div class="sparkline-wrap">${thresholdCompareChart(thresholdRows)}</div>
    ${tableHtml(coloredRows, ["capability", "metric", "value", "threshold", "excess", "status", "interpretation", "action"])}
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

export function renderCalibration(elId, data, model) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s  = data.result_summary || {};
  const rd = data.result_details  || {};

  if (model === "heston") {
    const params = [
      ["v₀ (init vol²)", fmt(s.v0)],
      ["κ (mean rev.)",  fmt(s.kappa)],
      ["θ (long var)",   fmt(s.theta)],
      ["ξ (vol of vol)", fmt(s.xi)],
      ["ρ (correlation)",fmt(s.rho)],
    ];
    const quality = s.fit_quality || "unknown";
    const fitBadge = quality === "good" ? badge("pass", "✓ Good fit")
                   : quality === "fair" ? badge("warning", "~ Fair fit")
                   : badge("fail", "✗ Poor fit");
    const residuals = rd.residuals || [];
    const modelPrices = rd.model_prices || [];
    setHtml(elId, resultWrap(`
      ${sectionLabel("Heston Calibration")}
      <div class="diag-line">${fitBadge} — RMSE: ${fmt(s.rmse)}, Max err: ${fmt(s.max_abs_error)}, Iters: ${s.iterations}</div>
      ${metricsRow(params)}
      ${modelPrices.length ? `<div class="sparkline-wrap">${residualBarChart(modelPrices, residuals)}</div>` : ""}
    `));
  } else {
    // BS Implied Vol
    const iv = s.implied_vol ?? s.ivs?.[0];
    const converged = s.converged ?? (s.n_converged > 0);
    setHtml(elId, resultWrap(`
      ${sectionLabel("BS Implied Volatility")}
      ${metricsRow([
        ["IV", iv != null ? fmt(iv) : "—"],
        ["Converged", converged ? "Yes" : "No"],
        ["Error", fmt(s.final_error ?? 0)],
      ])}
    `));
  }
}

export function renderMultiLeg(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s  = data.result_summary || {};
  const rd = data.result_details  || {};
  const legs = rd.legs || [];

  const legsRows = legs.map((leg, i) => {
    const dir = leg.quantity >= 0 ? "Long" : "Short";
    const type = (leg.option_type || "call").toUpperCase();
    return `<tr>
      <td>${i + 1}</td>
      <td>${dir} ${type}</td>
      <td>${fmt(leg.strike)}</td>
      <td>${fmt(leg.quantity)}</td>
      <td>${fmt(leg.bs_price)}</td>
      <td>${fmt(leg.mc_price)}</td>
      <td>${fmt(leg.delta_bs)}</td>
      <td>${fmt(leg.vega_bs)}</td>
    </tr>`;
  }).join("");

  setHtml(elId, resultWrap(`
    ${sectionLabel("Multi-Leg: " + (s.strategy_hint || "custom"))}
    ${metricsRow([
      ["BS Net", fmt(s.net_bs_price)],
      ["MC Net", fmt(s.net_mc_price)],
      ["Net Delta", fmt(s.net_delta)],
      ["Net Vega", fmt(s.net_vega)],
    ])}
    <table class="data-table">
      <thead><tr><th>#</th><th>Leg</th><th>Strike</th><th>Qty</th><th>BS</th><th>MC</th><th>Delta</th><th>Vega</th></tr></thead>
      <tbody>${legsRows}</tbody>
    </table>
  `));
}

export function renderGreekSurface(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s  = data.result_summary || {};
  const rd = data.result_details  || {};
  const surfaceData = {
    greek:      s.greek     || "delta",
    spots:      rd.spots      || [],
    maturities: rd.maturities || [],
    grid:       rd.grid       || [],
    grid_min:   s.grid_min  != null ? s.grid_min : 0,
    grid_max:   s.grid_max  != null ? s.grid_max : 1,
  };
  setHtml(elId, resultWrap(`
    ${sectionLabel(surfaceData.greek.charAt(0).toUpperCase() + surfaceData.greek.slice(1) + " Surface")}
    ${metricsRow([
      ["Greek", surfaceData.greek],
      ["Grid", `${s.n_spots} × ${s.n_mats}`],
      ["Min", surfaceData.grid_min],
      ["Max", surfaceData.grid_max],
    ])}
    <div class="chart-wrap">${greekSurfaceHeatmap(surfaceData)}</div>
  `));
}

export function renderAllGreeks(elId, greekDataArray) {
  if (!greekDataArray || !greekDataArray.length) {
    document.getElementById(elId).innerHTML = "";
    return;
  }
  const sections = greekDataArray.map((data) => {
    if (!data) return "";
    const s  = data.result_summary || {};
    const rd = data.result_details  || {};
    const name = (s.greek || "").charAt(0).toUpperCase() + (s.greek || "").slice(1);
    const surfaceData = {
      greek:      s.greek      || "delta",
      spots:      rd.spots      || [],
      maturities: rd.maturities || [],
      grid:       rd.grid       || [],
      grid_min:   s.grid_min != null ? s.grid_min : 0,
      grid_max:   s.grid_max != null ? s.grid_max : 1,
    };
    return `
      ${sectionLabel(name + " Surface")}
      <div class="chart-wrap">${greekSurfaceHeatmap(surfaceData)}</div>
    `;
  }).join("");
  document.getElementById(elId).innerHTML = resultWrap(sections);
}



/* ─── Screener ─────────────────────────────────────────────────────────────── */

function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// USD amounts: two decimals with grouping.
function usd(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "-";
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function greek(v, digits = 4) {
  return v === null || v === undefined ? "-" : Number(v).toFixed(digits);
}

// Unbounded gain / loss come back as null with a *_unbounded flag.
function fmtBound(value, unbounded) {
  return unbounded ? "∞" : usd(value);
}

// RR is infinite when the gain is unbounded (serialized as null); NaN stays "-".
function fmtRr(r) {
  if (r.rr === null || r.rr === undefined) return r.max_gain_unbounded ? "∞" : "-";
  return Number(r.rr).toFixed(2);
}

function sourceBadge(s) {
  const when = s.fetched_at ? new Date(s.fetched_at).toLocaleString() : "-";
  if (s.source === "live") return `${pass("live")} · ${esc(when)}`;
  return `${warn(esc(s.source || "?"))} · ${esc(when)}`;
}

function funnelHtml(s) {
  const steps = [
    ["Options in", s.n_options_in],
    ["After option filter", s.n_options_after_filter],
    ["Combinations", s.n_generated],
    ["Passed strategy filter", s.n_passed],
    ["Returned", s.n_returned],
  ];
  const maxLog = Math.log10(Math.max(...steps.map(([, v]) => Number(v) || 0), 10) + 1);
  const rows = steps.map(([label, v]) => {
    const pct = Math.max(2, (Math.log10((Number(v) || 0) + 1) / maxLog) * 100);
    return `<div class="scr-funnel-row">
      <span class="scr-funnel-label">${label}</span>
      <span class="scr-funnel-bar"><span style="width:${pct.toFixed(1)}%"></span></span>
      <span class="scr-funnel-value">${Number(v ?? 0).toLocaleString()}</span>
    </div>`;
  }).join("");
  const kinds = Object.entries(s.by_kind || {}).map(([k, c]) =>
    `${esc(k)} ${Number(c.passed).toLocaleString()}/${Number(c.generated).toLocaleString()}`).join(" · ");
  return `<div class="scr-funnel">${rows}</div>
    <div class="chart-caption">Log-scaled. Passed / generated by kind: ${kinds || "-"}</div>`;
}

export function renderScreener(elId, data, handlers = {}) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const rows = data.result_details?.strategies || [];
  setDiagBadge("diagScreener", data.diagnostics || {});
  const notes = (data.diagnostics?.notes || []).map((n) => `<div class="muted-sm">${esc(n)}</div>`).join("");

  const body = rows.map((r, i) => `
    <tr class="scr-row" data-idx="${i}">
      <td>${r.rank}</td>
      <td class="scr-actions">
        <button type="button" class="mode-switch scr-act" data-act="multileg" data-idx="${i}" title="Price in Multi-Leg">ML</button>
        <button type="button" class="mode-switch scr-act" data-act="risk" data-idx="${i}" title="Stress in Risk">Risk</button>
      </td>
      <td class="scr-label">${esc(r.label)}</td>
      <td>${usd(r.cost)}</td>
      <td>${fmtBound(r.max_gain, r.max_gain_unbounded)}</td>
      <td>${fmtBound(r.max_loss, r.max_loss_unbounded)}</td>
      <td>${fmtRr(r)}</td>
      <td>${greek(r.net_delta, 3)}</td>
      <td>${usd(r.net_theta)}</td>
      <td>${r.avg_iv != null ? (r.avg_iv * 100).toFixed(1) + "%" : "-"}</td>
      <td>${r.edge == null ? "-" : (r.edge >= 0 ? pass(usd(r.edge)) : fail(usd(r.edge)))}</td>
    </tr>`).join("");

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Underlying", s.currency],
      ["Data", sourceBadge(s)],
      ["Spot (index)", usd(s.spot)],
      ["Rate", s.rate],
      ["Model Vol", s.model_vol_requested === s.model_vol ? s.model_vol : `${s.model_vol_requested} → ${s.model_vol}`],
      ["Prices", s.price_mode],
      ["Ranked By", `${s.rank_key} ${s.rank_descending ? "↓" : "↑"}`],
    ])}
    ${notes}
    ${sectionLabel("Funnel")}
    ${funnelHtml(s)}
    ${sectionLabel(`Top ${rows.length}`)}
    ${rows.length ? `<div class="scr-table-wrap"><table class="dense-table scr-table">
      <thead><tr><th>#</th><th>Send</th><th>Strategy</th><th>Cost</th><th>Max Gain</th><th>Max Loss</th><th>RR</th>
        <th>Δ</th><th>Θ/day</th><th>IV</th><th>Edge</th></tr></thead>
      <tbody>${body}</tbody></table></div>
      <div class="chart-caption">USD per contract (1 ${esc(s.currency)}). Click a row for legs and payoff. Edge = model value (${esc(s.model_vol)}) − cost.</div>`
      : `<div class="muted-sm">No strategy passed the filters.</div>`}
  `));

  const root = document.getElementById(elId);
  root?.querySelectorAll(".scr-row").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".scr-act")) return;
      root.querySelectorAll(".scr-row").forEach((x) => x.classList.toggle("is-selected", x === tr));
      handlers.onSelect?.(rows[Number(tr.dataset.idx)], s);
    });
  });
  root?.querySelectorAll(".scr-act").forEach((btn) => {
    btn.addEventListener("click", () => {
      const strat = rows[Number(btn.dataset.idx)];
      if (btn.dataset.act === "multileg") handlers.onMultiLeg?.(strat, s);
      else handlers.onRisk?.(strat, s);
    });
  });
}

// Expiry payoff of a single-expiry strategy, per contract, net of cost. The
// payoff is linear between strikes, so the strikes plus two end points are an
// exact representation (and give exact breakevens by interpolation).
function payoffPoints(strategy, multiplier) {
  const legs = strategy.legs || [];
  if (!legs.length || new Set(legs.map((l) => l.expiry)).size > 1) return [];
  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(...strikes, legs[0].forward) * 0.8;
  const hi = Math.max(...strikes, legs[0].forward) * 1.2;
  const xs = [...new Set([lo, ...strikes, hi])].sort((a, b) => a - b);
  return xs.map((x) => ({
    x,
    y: legs.reduce((acc, l) => {
      const intrinsic = l.option_type === "call" ? Math.max(x - l.strike, 0) : Math.max(l.strike - x, 0);
      return acc + l.qty * intrinsic * multiplier;
    }, 0) - strategy.cost,
  }));
}

function breakevens(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if ((a.y < 0) !== (b.y < 0) && b.y !== a.y) out.push(a.x + (0 - a.y) * (b.x - a.x) / (b.y - a.y));
  }
  return out;
}

export function renderScreenerDetail(elId, strategy, summary, handlers = {}) {
  if (!strategy) return setHtml(elId, "");
  const mult = Number(summary?.multiplier ?? 1);
  const legRows = (strategy.legs || []).map((l) => `<tr>
      <td>${l.qty > 0 ? "Buy" : "Sell"} ${l.option_type.toUpperCase()}</td>
      <td>${fmt(l.strike)}</td>
      <td>${esc(l.expiry)} (${(l.years * 365).toFixed(1)}d)</td>
      <td>${usd(l.fill_price)}</td>
      <td>${usd(l.mark)}</td>
      <td>${l.iv ? (l.iv * 100).toFixed(1) + "%" : "-"}</td>
      <td>${usd(l.model_price)}</td>
      <td>${greek(l.delta)}</td>
      <td>${greek(l.vega, 2)}</td>
      <td>${usd(l.forward)}</td>
    </tr>`).join("");
  const pts = payoffPoints(strategy, mult);
  const bes = breakevens(pts);
  const payoff = pts.length
    ? `${sectionLabel("Payoff at Expiry (net of cost)")}
       <div class="sparkline-wrap">${payoffChart(pts, { marker: strategy.legs[0].forward })}</div>
       <div class="chart-caption">Breakeven ${bes.length ? bes.map((b) => usd(b)).join(", ") : "none in range"} · dashed line = forward.</div>`
    : `<div class="chart-caption">Legs span two expiries; payoff depends on the far leg's value at the near expiry, so no expiry payoff is drawn.</div>`;

  setHtml(elId, resultWrap(`
    ${sectionLabel(strategy.label)}
    ${metricsRow([
      ["Cost", usd(strategy.cost)],
      ["Max Gain", fmtBound(strategy.max_gain, strategy.max_gain_unbounded)],
      ["Max Loss", fmtBound(strategy.max_loss, strategy.max_loss_unbounded)],
      ["Model Value", usd(strategy.model_value)],
      ["Edge", usd(strategy.edge)],
      ["Net Δ / Γ / Θ / Vega", `${greek(strategy.net_delta)} / ${greek(strategy.net_gamma, 6)} / ${usd(strategy.net_theta)} / ${usd(strategy.net_vega)}`],
      ["Forward Vol", strategy.forward_vol != null ? (strategy.forward_vol * 100).toFixed(2) + "%" : "-"],
    ])}
    <table class="dense-table">
      <thead><tr><th>Leg</th><th>Strike</th><th>Expiry</th><th>Fill</th><th>Mark</th><th>IV</th><th>Model</th><th>Δ</th><th>Vega</th><th>Fwd</th></tr></thead>
      <tbody>${legRows}</tbody>
    </table>
    ${payoff}
    <div class="button-row scr-detail-actions">
      <button type="button" class="mode-switch" data-act="multileg">Send to Multi-Leg</button>
      <button type="button" class="mode-switch" data-act="risk">Send to Risk</button>
    </div>
  `));
  const root = document.getElementById(elId);
  root?.querySelector('[data-act="multileg"]')?.addEventListener("click", () => handlers.onMultiLeg?.(strategy, summary));
  root?.querySelector('[data-act="risk"]')?.addEventListener("click", () => handlers.onRisk?.(strategy, summary));
}

export function renderChain(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const expiries = data.result_details?.expiries || [];
  const chain = data.result_details?.chain || [];
  setDiagBadge("diagScreener", data.diagnostics || {});
  const uid = Date.now();
  const selId = `chain-exp-${uid}`, tableId = `chain-tbl-${uid}`, smileId = `chain-smile-${uid}`;

  const expiryRows = expiries.map((e) => ({
    Expiry: e.expiry,
    Days: Number((e.years * 365).toFixed(2)),
    Forward: usd(e.forward),
    "Carry %": e.implied_carry != null ? Number((e.implied_carry * 100).toFixed(2)) : null,
    Options: e.n_options,
  }));

  const byExpiry = {};
  chain.forEach((o) => { (byExpiry[o.expiry] ||= []).push(o); });
  const first = expiries.find((e) => byExpiry[e.expiry])?.expiry || "";

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Underlying", s.currency],
      ["Data", sourceBadge(s)],
      ["Spot (index)", usd(s.spot)],
      ["Options", s.n_options],
      ["Expiries", s.n_expiries],
    ])}
    ${sectionLabel("Expiries")}
    ${tableHtml(expiryRows, ["Expiry", "Days", "Forward", "Carry %", "Options"])}
    ${sectionLabel("Chain")}
    <div class="iv-expiry-row">
      <label class="iv-expiry-label">Expiry</label>
      <select id="${selId}" class="iv-expiry-select">
        ${expiries.filter((e) => byExpiry[e.expiry]).map((e) => `<option value="${esc(e.expiry)}">${esc(e.expiry)}</option>`).join("")}
      </select>
    </div>
    <div class="sparkline-wrap"><canvas id="${smileId}" class="chart-canvas" style="width:100%;"></canvas></div>
    <div class="chart-caption">OTM smile: mark IV vs ln(K/F) — calls above the forward, puts below.</div>
    <div id="${tableId}" class="scr-table-wrap"></div>
  `));

  const draw = (expiry) => {
    const rows = byExpiry[expiry] || [];
    const F = rows[0]?.forward || 1;
    const strikes = [...new Set(rows.map((o) => o.strike))].sort((a, b) => a - b);
    const atm = strikes.reduce((best, k) => (Math.abs(k - F) < Math.abs(best - F) ? k : best), strikes[0]);
    const cell = (o, key) => (o && o[key] != null ? (key === "oi" ? fmt(o[key]) : usd(o[key])) : "-");
    const ivCell = (o) => (o && o.iv ? (o.iv * 100).toFixed(1) + "%" : "-");
    const body = strikes.map((k) => {
      const c = rows.find((o) => o.strike === k && o.option_type === "call");
      const p = rows.find((o) => o.strike === k && o.option_type === "put");
      return `<tr class="${k === atm ? "is-selected" : ""}">
        <td>${cell(c, "bid")}</td><td>${cell(c, "ask")}</td><td>${ivCell(c)}</td><td>${cell(c, "oi")}</td>
        <td class="scr-strike">${usd(k).replace(/\.00$/, "")}</td>
        <td>${cell(p, "bid")}</td><td>${cell(p, "ask")}</td><td>${ivCell(p)}</td><td>${cell(p, "oi")}</td>
      </tr>`;
    }).join("");
    setHtml(tableId, `<table class="dense-table scr-chain-table">
      <thead><tr><th>C bid</th><th>C ask</th><th>C IV</th><th>C OI</th><th>Strike</th><th>P bid</th><th>P ask</th><th>P IV</th><th>P OI</th></tr></thead>
      <tbody>${body}</tbody></table>`);
    const smile = rows
      .filter((o) => o.iv > 0 && ((o.option_type === "call" && o.strike >= F) || (o.option_type === "put" && o.strike < F)))
      .map((o) => ({ log_moneyness: Math.log(o.strike / F), iv: o.iv }));
    redrawSmile(smileId, smile);
  };
  requestAnimationFrame(() => draw(first));
  document.getElementById(selId)?.addEventListener("change", (e) => draw(e.target.value));
}
