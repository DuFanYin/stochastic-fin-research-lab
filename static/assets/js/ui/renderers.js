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
} from "./charts.js";

export function renderPricing(elId, data) {
  if (!data) return setHtml(elId, statusError("No response"));
  const s = data.result_summary || {};
  const g = s.greeks || {};
  const e = s.error_decomposition || {};
  setDiagBadge("diagPricing", data.diagnostics || {});

  const ciLow  = s.mc_ci_low  != null ? fmt(s.mc_ci_low)  : "-";
  const ciHigh = s.mc_ci_high != null ? fmt(s.mc_ci_high) : "-";

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Black-Scholes Price", s.bs],
      ["Monte Carlo Price", s.mc],
      ["Binomial Price", s.binomial],
      ["Method Spread", s.method_spread],
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
      ["Vega (BS)", g.vega_bs],
      ["Rho (BS)", g.rho_bs],
      ["Relative Spread", s.relative_spread],
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

  const crossSection = css ? `
    ${sectionLabel("Cross-Scenario Robustness")}
    ${metricsRow([
      ["Robustness Score", css.robustness_score],
      ["Key Driver", css.key_driver],
      ["Key Driver Contribution", css.key_driver_contribution_pct != null ? css.key_driver_contribution_pct + "%" : "-"],
      ["Worst Scenario", css.worst_scenario],
      ["Worst P&L Impact", css.worst_pnl_impact],
      ["Scenarios Breaching 5% Threshold", css.scenarios_breaching_threshold],
      ["Hedge Resilience Mean ES95", css.hedge_resilience_mean],
      ["Hedge Resilience Worst ES95", css.hedge_resilience_worst],
    ])}
    ${sectionLabel("Scenario Ranking by Severity")}
    ${tableHtml(css.scenario_ranking || [], ["rank", "name", "pnl_impact", "severity_score"])}
  ` : "";

  setHtml(elId, resultWrap(`
    ${metricsRow([
      ["Scenario Pack", s.pack],
      ["Severity", s.severity],
      ["Scenario Count", s.scenario_count],
      ["Base MC", s.base_mc],
      ["Worst Scenario", s.worst_scenario],
      ["Worst MC Shift", s.worst_mc_shift],
    ])}
    ${crossSection}
    ${sectionLabel("Stress Severity Tornado")}
    <div class="sparkline-wrap">${tornadoChart(tornadoPoints)}</div>
    ${sectionLabel("Scenario Ranking")}
    ${tableHtml(ranking, ["scenario", "severity_score", "mc_shift_vs_base"])}
    ${sectionLabel("Portfolio Correlation Ranking")}
    ${tableHtml(corrRanking, ["scenario", "portfolio_correlation_score", "mc_shift_vs_base"])}
    ${sectionLabel("Hedge Resilience Ranking")}
    ${tableHtml(hedgeResilience, ["scenario", "hedge_normalized_std", "hedge_best_strategy"])}
    ${sectionLabel("Scenario Details")}
    ${tableHtml(rows.map((r) => ({
      Scenario: r.scenario,
      Description: r.description,
      Spot: r.spot,
      Vol: r.vol,
      Rate: r.rate,
      "MC Shift vs Base": r.mc_shift_vs_base,
      "BS Shift vs Base": r.bs_shift_vs_base,
      "Binomial Shift vs Base": r.binomial_shift_vs_base,
      "Portfolio Correlation Score": r.portfolio_correlation_score,
      "Hedge Norm Std": r.hedge?.normalized_std,
      "Hedge ES95": r.hedge?.es95,
      "Best Hedge Strategy": r.hedge?.best_strategy,
      "Attribution (spot/vol/rate)": `${fmt(r.attribution?.spot_component)} / ${fmt(r.attribution?.vol_component)} / ${fmt(r.attribution?.rate_component)}`,
    })), ["Scenario", "Description", "Spot", "Vol", "Rate", "MC Shift vs Base", "BS Shift vs Base", "Binomial Shift vs Base", "Portfolio Correlation Score", "Hedge Norm Std", "Hedge ES95", "Best Hedge Strategy", "Attribution (spot/vol/rate)"])}
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
    const badge = quality === "good" ? "✓ Good fit"
                : quality === "fair" ? "~ Fair fit" : "✗ Poor fit";
    const residuals = rd.residuals || [];
    const modelPrices = rd.model_prices || [];
    setHtml(elId, resultWrap(`
      ${sectionLabel("Heston Calibration")}
      <div class="diag-line">${badge} — RMSE: ${fmt(s.rmse)}, Max err: ${fmt(s.max_abs_error)}, Iters: ${s.iterations}</div>
      ${metricsRow(params)}
      ${modelPrices.length ? `<table class="data-table"><thead><tr><th>#</th><th>Model</th><th>Residual</th></tr></thead>
        <tbody>${modelPrices.map((p,i) => `<tr><td>${i+1}</td><td>${fmt(p)}</td><td>${fmt(residuals[i]??0)}</td></tr>`).join("")}</tbody></table>` : ""}
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
    grid_min:   s.grid_min  ?? 0,
    grid_max:   s.grid_max  ?? 1,
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

