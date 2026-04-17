/* ─── Runner functions ────────────────────────────────────────────────────────
   In Live mode: fetchLiveData() pulls spot/vol/rate/mu from market APIs and
   populates the readonly inputs before each compute run.
   In Sim mode: inputs are editable, no network fetch, applyDataMode() manages
   the transition between the two states.
────────────────────────────────────────────────────────────────────────────── */

import { getJson, postJson } from "../core/api.js";
import { getSelectButtonValue, getSwitchValue, setRunning } from "../ui/controls.js";
import { getDataMode, setHtml, statusError, resultWrap, showErrorToast } from "../ui/core.js";
import {
  renderPricing,
  renderPricingBatch,
  renderScenario,
  renderHedging,
  renderPde,
  renderMeasure,
  renderMeasureCompare,
  renderConvergence,
  renderBenchmark,
  renderKv,
  renderValidation,
} from "../ui/renderers.js";

/* ─── Live data fetch ─────────────────────────────────────────────────────── */

/** Write a value into a readonly live input and flash it briefly. */
function setLiveField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.classList.add("live-flash");
  setTimeout(() => el.classList.remove("live-flash"), 1200);
}

function setBanner(state, fields /* {spot,iv,r,mu,ts} | string for error/loading */) {
  const el = document.getElementById("liveDataBanner");
  if (!el) return;
  el.className = `live-banner live-banner--${state}`;
  if (typeof fields === "string") {
    // error / loading — just set all value spans to the message
    ["bannerSpot","bannerIV","bannerR","bannerMu","bannerTs"].forEach((id, i) => {
      const s = document.getElementById(id);
      if (s) s.textContent = i === 0 ? fields : "—";
    });
    return;
  }
  const set = (id, v) => { const s = document.getElementById(id); if (s) s.textContent = v; };
  set("bannerSpot", fields.spot);
  set("bannerIV",   fields.iv);
  set("bannerR",    fields.r);
  set("bannerMu",   fields.mu);
  set("bannerTs",   fields.ts);
}

/* ─── Cached last snapshot ────────────────────────────────────────────────── */

let _lastSnap = null;

/* ─── Info row helper ─────────────────────────────────────────────────────── */

function setInfoLine(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ─── Backend resolve call (replaces all client-side picking logic) ──────── */

/**
 * POST /market/resolve — asks the backend (→ C++ engine) to interpolate
 * vol and rate for a given (strike, maturity) from the cached snapshot.
 * Returns the ResolveResponse dict, or null on network failure.
 */
async function callResolve(snap, targetStrike, targetMaturity) {
  if (!snap) return null;
  try {
    return await postJson("/market/resolve", {
      target_strike:   targetStrike,
      target_maturity: targetMaturity,
      spot:            snap.spot,
      iv_surface:      snap.iv_surface  ?? [],
      rate_curve:      snap.rate_curve  ?? {},
    });
  } catch (err) {
    log.warn?.("resolve failed:", err);
    return null;
  }
}

/** Apply a ResolveResponse (from /market/resolve) into the live input fields. */
function applyResolve(resolved, snap) {
  if (!resolved) {
    setLiveField("vol", snap.vol);
    setInfoLine("ivLine1", `instrument  DVOL index (no surface)`);
    setInfoLine("ivLine2", `method      fallback`);
    setLiveField("rate", snap.rate);
    setInfoLine("rateLine1", `tenor  3m (fallback)`);
    setInfoLine("rateLine2", `curve  —`);
    return;
  }

  // ── sigma info ──
  setLiveField("vol", resolved.vol);
  if (resolved.iv_instrument) {
    setInfoLine("ivLine1", `instrument  ${resolved.iv_instrument}`);
    setInfoLine("ivLine2", `match       K=${resolved.iv_matched_strike.toLocaleString()}  T=${resolved.iv_matched_years}y  [${resolved.interp_method}]`);
  } else {
    setInfoLine("ivLine1", `instrument  DVOL index (no surface)`);
    setInfoLine("ivLine2", `method      fallback`);
  }

  // ── r info ──
  setLiveField("rate", resolved.rate);
  setInfoLine("rateLine1", `tenor  ${resolved.rate_tenor}  →  ${resolved.rate_pct}%`);
  const chips = document.getElementById("rateCurveChips");
  if (chips) {
    chips.innerHTML = Object.entries(snap.rate_curve_pct || {})
      .map(([k, v]) => `<span class="live-chip">${k}<em>${v}%</em></span>`)
      .join("");
  }
}

/* ─── Data mode: toggle live inputs editable/readonly ────────────────────── */

const LIVE_INPUT_IDS  = ["spot", "vol", "rate", "mu"];
const LIVE_LABEL_IDS  = ["labelSpot", "labelVol", "labelRate", "labelMu"];

export function applyDataMode(mode) {
  const isLive = mode === "live";
  const banner = document.getElementById("liveDataBanner");
  const fetchBtn = document.getElementById("btnFetchLive");

  LIVE_INPUT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isLive) {
      el.setAttribute("readonly", "");
      el.classList.add("live-input");
    } else {
      el.removeAttribute("readonly");
      el.classList.remove("live-input");
      el.classList.remove("live-flash");
    }
  });

  LIVE_LABEL_IDS.forEach((id) => {
    document.getElementById(id)?.classList.toggle("live-label", isLive);
  });

  if (banner) banner.style.display = isLive ? "" : "none";
  if (fetchBtn) fetchBtn.style.display = isLive ? "" : "none";

  if (!isLive) {
    _lastSnap = null;
  }
}

/** Fetch BTC snapshot from backend and populate all live fields. */
export async function fetchLiveData() {
  if (getDataMode() === "sim") return;   // Sim mode: skip network fetch entirely
  setBanner("loading", "Fetching live market data…");
  try {
    const snap = await getJson("/market/btc");
    _lastSnap = snap;

    // ── Spot ──────────────────────────────────────────────────────────────────
    setLiveField("spot", snap.spot);

    // Sync strike to spot ATM if user hasn't touched it
    const strikeEl = document.getElementById("strike");
    if (strikeEl && !strikeEl.dataset.userEdited) {
      strikeEl.value = snap.spot;
    }

    // ── mu — annualised funding rate ──────────────────────────────────────────
    setLiveField("mu", snap.mu);
    setInfoLine("fundingLine1", `8h rate  ${snap.funding_8h_pct}%  →  ${snap.mu_pct}% ann`);
    setInfoLine("fundingLine2", `source   Binance perpetual funding`);

    // ── Vol + Rate — resolved via C++ engine on backend ───────────────────────
    const maturity     = Number(document.getElementById("maturity")?.value) || 0.25;
    const targetStrike = Number(strikeEl?.value) || snap.spot;
    const resolved     = await callResolve(snap, targetStrike, maturity);
    applyResolve(resolved, snap);

    const volPct  = resolved ? resolved.vol_pct  : snap.vol_pct;
    const ratePct = resolved ? resolved.rate_pct : snap.rate_pct;
    const ts = snap.fetched_at ? new Date(snap.fetched_at).toLocaleTimeString() : "now";
    setBanner("ok", {
      spot: `${snap.spot.toLocaleString()} USD`,
      iv:   `${volPct}%`,
      r:    `${ratePct}%`,
      mu:   `${snap.mu_pct}% ann`,
      ts,
    });
    return snap;
  } catch (err) {
    setBanner("error", `Fetch failed: ${err.message}`);
    throw err;
  }
}

/**
 * Re-resolve vol + rate from the cached snapshot when the user changes
 * strike or maturity — calls the backend (C++ engine) without re-fetching
 * market data.
 */
export async function resolveFromSnapshot() {
  if (!_lastSnap) return;
  const snap         = _lastSnap;
  const maturity     = Number(document.getElementById("maturity")?.value) || 0.25;
  const strikeEl     = document.getElementById("strike");
  const targetStrike = Number(strikeEl?.value) || snap.spot;
  const resolved     = await callResolve(snap, targetStrike, maturity);
  applyResolve(resolved, snap);
}

/* ─── Shared payload helpers ──────────────────────────────────────────────── */

export function basePayload() {
  return {
    spot:           Number(document.getElementById("spot").value),
    strike:         Number(document.getElementById("strike").value),
    rate:           Number(document.getElementById("rate").value),
    vol:            Number(document.getElementById("vol").value),
    maturity:       Number(document.getElementById("maturity").value),
    n_paths:        Number(document.getElementById("nPaths").value),
    product_type:   getSelectButtonValue("productType"),
    dividend_yield: Number(document.getElementById("dividendYield").value),
    numeraire:      getSelectButtonValue("numeraire"),
    fx_mode:        getSwitchValue("fxMode"),
    is_american:    getSwitchValue("isAmerican"),
  };
}


function activeModeSwitch(ids) {
  return ids.find((id) => document.getElementById(id)?.classList.contains("active"));
}

/* ─── Validation gate ─────────────────────────────────────────────────────── */

export async function runValidationForCompute(isPicked, showOnly) {
  const hasAnyPick =
    isPicked("pickStats") || isPicked("pickIto") || isPicked("pickSimulation");
  if (!hasAnyPick) {
    return { passed: true, rows: [] };
  }
  const base = basePayload();
  const ladder = document.getElementById("convSteps").value
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 1);
  const gateData = await postJson("/tool/validation/gate", {
    pick_stats: isPicked("pickStats"),
    pick_ito: isPicked("pickIto"),
    pick_simulation: isPicked("pickSimulation"),
    compute_block_on_validation: isPicked("computeBlockOnValidation"),
    spot: base.spot,
    strike: base.strike,
    rate: base.rate,
    vol: base.vol,
    maturity: base.maturity,
    n_paths: base.n_paths,
    dividend_yield: base.dividend_yield,
    mu: Number(document.getElementById("mu").value),
    stats_theta: Number(document.getElementById("statsTheta").value),
    stats_n: Number(document.getElementById("statsN").value),
    ito_function_type: getSelectButtonValue("itoFunctionType"),
    ito_theta: Number(document.getElementById("itoTheta").value),
    ito_t: Number(document.getElementById("itoT").value),
    ito_n: Number(document.getElementById("itoN").value),
    model: getSelectButtonValue("model"),
    sim_steps: Number(document.getElementById("steps").value),
    sim_dt: Number(document.getElementById("dt").value),
    sim_kappa: Number(document.getElementById("kappa").value),
    sim_theta: Number(document.getElementById("theta").value),
    measure_n: Number(document.getElementById("measureN").value),
    cmp_steps: Number(document.getElementById("cmpSteps").value),
    cmp_paths: Number(document.getElementById("cmpPaths").value),
    conv_steps: ladder.length ? ladder : [10, 20, 40, 80, 120, 200, 320, 500],
    pde_s_steps: Number(document.getElementById("pdeSSteps").value),
    pde_t_steps: Number(document.getElementById("pdeTSteps").value),
    pde_method: getSelectButtonValue("pdeMethod"),
    n_rebalances: Number(document.getElementById("nReb").value),
    hedge_paths: Number(document.getElementById("hedgePaths").value),
    batch_jobs: Number(document.getElementById("batchJobs").value),
    batch_spot_shock: Number(document.getElementById("batchSpotShock").value),
  });
  const summary = gateData.result_summary || {};
  const rows = gateData.result_details?.rows || [];
  const passed = summary.gate_decision === "go";

  if (typeof showOnly === "function") {
    showOnly("resultCardValidation");
  } else {
    document.getElementById("resultCardValidation")?.classList.remove("is-hidden");
  }
  renderKv("validationSummaryOut", summary, "validation gate report");
  renderValidation("validationOut", rows, {
    checks_total: summary.checks_total ?? rows.length,
    checks_failed: summary.checks_failed ?? rows.filter((r) => r.status === "fail").length,
    gate_decision: summary.gate_decision ?? (passed ? "go" : "warning"),
    fail_rate: summary.fail_rate,
    failed_by_capability: summary.failed_by_capability,
    max_excess: summary.max_excess,
    max_excess_item: summary.max_excess_item,
    threshold_rows: gateData.result_details?.threshold_rows || rows,
  });
  return { passed, rows };
}

export async function runValidationOnly(showOnly, isPicked) {
  const hasAny =
    isPicked("pickStats") || isPicked("pickIto") || isPicked("pickSimulation");
  if (!hasAny) {
    showOnly("resultCardValidation");
    renderKv("validationSummaryOut", { hint: "Select at least one validation capability (Stats / Ito / Simulation)." }, "Hint");
    renderKv("validationOut", { detail: "No validation checks available to run." }, "");
    return;
  }
  await runValidationForCompute(isPicked, showOnly);
}

/* ─── Error display helper ────────────────────────────────────────────────── */

function showError(elId, err) {
  const msg = err?.message ?? String(err);
  setHtml(elId, resultWrap(statusError(msg)));
  showErrorToast(msg);
}

/* ─── Individual tool runners (identical logic, live spot/vol/rate routed in) */

export async function runPricingMain(showResultCard) {
  showResultCard("resultCardPricing");
  const isBatch = activeModeSwitch(["pricingModeSingle", "pricingModeBatch"]) === "pricingModeBatch";
  if (isBatch) {
    document.getElementById("pricingOut").innerHTML = "";
    setRunning("pricingBatchOut", "pricing batch");
    try {
      const base = basePayload();
      const data = await postJson("/tool/pricing/batch/grid", {
        base:       base,
        n_jobs:     Number(document.getElementById("batchJobs").value),
        spot_shock: Number(document.getElementById("batchSpotShock").value),
      });
      renderPricingBatch("pricingBatchOut", data);
    } catch (err) { showError("pricingBatchOut", err); }
  } else {
    document.getElementById("pricingBatchOut").innerHTML = "";
    setRunning("pricingOut", "pricing");
    try {
      const data = await postJson("/tool/pricing/run", basePayload());
      renderPricing("pricingOut", data);
    } catch (err) { showError("pricingOut", err); }
  }
}

export async function runScenario(showResultCard) {
  showResultCard("resultCardScenario");
  setRunning("scenarioOut", "scenario");
  try {
    const data = await postJson("/tool/scenario/run", basePayload());
    renderScenario("scenarioOut", data);
  } catch (err) { showError("scenarioOut", err); }
}

export async function runHedge(showResultCard) {
  showResultCard("resultCardHedge");
  setRunning("hedgeOut", "hedging");
  try {
    const data = await postJson("/tool/hedging/run", {
      ...basePayload(),
      n_rebalances: Number(document.getElementById("nReb").value),
      n_paths:      Number(document.getElementById("hedgePaths").value),
      transaction_cost_bps: Number(document.getElementById("hedgeTcBps").value),
      rebalance_threshold: Number(document.getElementById("hedgeThreshold").value),
      vol_mismatch_mult: Number(document.getElementById("hedgeVolMismatchMult").value),
    });
    renderHedging("hedgeOut", data);
  } catch (err) { showError("hedgeOut", err); }
}

export async function runPde(showResultCard) {
  showResultCard("resultCardPde");
  setRunning("pdeOut", "pde");
  try {
    const base = basePayload();
    const data = await postJson("/tool/pde/run", {
      spot:           base.spot,
      strike:         base.strike,
      rate:           base.rate,
      vol:            base.vol,
      maturity:       base.maturity,
      dividend_yield: base.dividend_yield,
      s_steps:        Number(document.getElementById("pdeSSteps").value),
      t_steps:        Number(document.getElementById("pdeTSteps").value),
      method:         getSelectButtonValue("pdeMethod"),
      option_type:    "call",
    });
    renderPde("pdeOut", data);
  } catch (err) { showError("pdeOut", err); }
}

export async function runMeasureMain(showResultCard) {
  showResultCard("resultCardMeasure");
  const isRN = activeModeSwitch(["measureModePQ", "measureModeRN"]) === "measureModeRN";
  if (isRN) {
    document.getElementById("measureCompareOut").innerHTML = "";
    setRunning("measureOut", "measure");
    try {
      const data = await postJson("/tool/measure/run", {
        mu:      Number(document.getElementById("mu").value),
        r:       Number(document.getElementById("rate").value),
        sigma:   Number(document.getElementById("vol").value),
        t:       Number(document.getElementById("maturity").value),
        n_steps: Number(document.getElementById("measureN").value),
      });
      renderMeasure("measureOut", data);
    } catch (err) { showError("measureOut", err); }
  } else {
    document.getElementById("measureOut").innerHTML = "";
    setRunning("measureCompareOut", "measure compare");
    try {
      const data = await postJson("/tool/measure/compare", {
        mu:      Number(document.getElementById("mu").value),
        r:       Number(document.getElementById("rate").value),
        sigma:   Number(document.getElementById("vol").value),
        t:       Number(document.getElementById("maturity").value),
        n_steps: Number(document.getElementById("cmpSteps").value),
        n_paths: Number(document.getElementById("cmpPaths").value),
        x0:      1.0,
      });
      renderMeasureCompare("measureCompareOut", data);
    } catch (err) { showError("measureCompareOut", err); }
  }
}

export async function runConvergence(showResultCard) {
  showResultCard("resultCardConvergence");
  setRunning("convergenceOut", "convergence");
  try {
    const base   = basePayload();
    const ladder = document.getElementById("convSteps").value
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 1);
    const data = await postJson("/tool/convergence/run", {
      spot:           base.spot,
      strike:         base.strike,
      rate:           base.rate,
      vol:            base.vol,
      maturity:       base.maturity,
      dividend_yield: base.dividend_yield,
      step_ladder:    ladder.length ? ladder : [10,20,40,80,120,200,320,500],
    });
    renderConvergence("convergenceOut", data);
  } catch (err) { showError("convergenceOut", err); }
}

export async function runBenchmark(showResultCard) {
  showResultCard("resultCardBenchmark");
  setRunning("benchmarkOut", "benchmark");
  try {
    const data = await postJson("/tool/benchmark/run", {
      pricing:            basePayload(),
      pde_method:         getSelectButtonValue("pdeMethod"),
      pde_s_steps:        Number(document.getElementById("pdeSSteps").value),
      pde_t_steps:        Number(document.getElementById("pdeTSteps").value),
      benchmark_baseline: getSelectButtonValue("benchmarkBase"),
    });
    renderBenchmark("benchmarkOut", data);
  } catch (err) { showError("benchmarkOut", err); }
}
