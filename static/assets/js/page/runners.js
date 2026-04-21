/* ─── Runner functions ────────────────────────────────────────────────────────
   In Live mode: fetchLiveData() pulls spot/vol/rate/mu from market APIs and
   populates the readonly inputs before each compute run.
   In Sim mode: inputs are editable, no network fetch, applyDataMode() manages
   the transition between the two states.
────────────────────────────────────────────────────────────────────────────── */

import {
  getSelectButtonValue,
  getSwitchValue,
  setRunning,
  getDataMode,
  setHtml,
  statusError,
  resultWrap,
  showErrorToast,
  renderPricing,
  renderPricingBatch,
  renderScenario,
  renderIv,
  renderStress,
  renderHedging,
  renderPde,
  renderMeasure,
  renderMeasureCompare,
  renderConvergence,
  renderBenchmark,
  renderKv,
  renderValidation,
  renderGreekSurface,
  renderMultiLeg,
  renderCalibration,
} from "../ui/core.js";

const API_BASE = `${window.location.origin}/api`;

async function readErrorDetail(res) {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) return JSON.stringify(data.detail);
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`GET ${path} failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return res.json();
}

async function postJson(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`POST ${path} failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return res.json();
}

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

/** Fetch BTC market data concurrently; update UI as each source resolves. */
export async function fetchLiveData() {
  if (getDataMode() === "sim") return;
  setBanner("loading", "Fetching…");

  // Shared mutable state assembled across concurrent callbacks
  const snap = { rate_curve: {}, rate_curve_pct: {}, iv_surface: [] };
  _lastSnap = snap;

  let spotResolved = null;
  let volPct = null, ratePct = null, muPct = null;
  let ts = new Date().toLocaleTimeString();

  function refreshBanner() {
    setBanner("ok", {
      spot: spotResolved != null ? `${spotResolved.toLocaleString()} USD` : "…",
      iv:   volPct  != null ? `${volPct}%`       : "…",
      r:    ratePct != null ? `${ratePct}%`       : "…",
      mu:   muPct   != null ? `${muPct}% ann`     : "…",
      ts,
    });
  }

  const strikeEl = document.getElementById("strike");

  // ── 1. Spot (needed first for ATM strike sync + surface fetch) ────────────
  const spotPromise = getJson("/market/spot").then((d) => {
    snap.spot = d.spot;
    spotResolved = d.spot;
    setLiveField("spot", d.spot);
    if (strikeEl && !strikeEl.dataset.userEdited) strikeEl.value = d.spot;
    refreshBanner();
    return d.spot;
  });

  // ── 2. DVOL (independent) ─────────────────────────────────────────────────
  getJson("/market/dvol").then((d) => {
    snap.vol = d.vol;
    snap.vol_pct = d.vol_pct;
    volPct = d.vol_pct;
    setLiveField("vol", d.vol);
    refreshBanner();
  }).catch(() => {});

  // ── 3. Funding / mu (independent) ────────────────────────────────────────
  getJson("/market/funding").then((d) => {
    snap.mu = d.mu;
    snap.mu_pct = d.mu_pct;
    snap.funding_8h_pct = d.funding_8h_pct;
    muPct = d.mu_pct;
    setLiveField("mu", d.mu);
    setInfoLine("fundingLine1", `8h rate  ${d.funding_8h_pct}%  →  ${d.mu_pct}% ann`);
    setInfoLine("fundingLine2", `source   Binance perpetual funding`);
    refreshBanner();
  }).catch(() => {});

  // ── 4. Rate curve (independent) ──────────────────────────────────────────
  const ratePromise = getJson("/market/rates").then((d) => {
    snap.rate = d.rate;
    snap.rate_pct = d.rate_pct;
    snap.rate_curve = d.rate_curve;
    snap.rate_curve_pct = d.rate_curve_pct;
    ratePct = d.rate_pct;
    refreshBanner();
    return d;
  }).catch(() => null);

  // ── 5. IV surface — after spot resolves ───────────────────────────────────
  const surfacePromise = spotPromise.then((spot) =>
    getJson(`/market/surface?spot=${encodeURIComponent(spot)}`)
  ).then((d) => {
    snap.iv_surface = d.iv_surface;
    return d.iv_surface;
  }).catch(() => []);

  // ── 6. Resolve vol+rate once surface+rates ready — updates input fields and
  //       info lines only; banner iv/r slots already show DVOL/rate from above
  Promise.all([surfacePromise, ratePromise]).then(async () => {
    snap.fetched_at = new Date().toISOString();
    ts = new Date(snap.fetched_at).toLocaleTimeString();
    const maturity     = Number(document.getElementById("maturity")?.value) || 0.25;
    const targetStrike = Number(strikeEl?.value) || snap.spot;
    const resolved     = await callResolve(snap, targetStrike, maturity);
    applyResolve(resolved, snap);
    // Update banner rate slot once resolved; keep iv slot as DVOL (already shown)
    if (resolved) ratePct = resolved.rate_pct;
    refreshBanner();
  }).catch(() => {});

  // Return after spot (so callers get snap quickly), rest streams in
  return spotPromise.then(() => snap).catch((err) => {
    setBanner("error", `Fetch failed: ${err.message}`);
    throw err;
  });
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
    mc_sampler:     getSelectButtonValue("mcSampler") || "pseudorandom",
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
    explainable_qa: gateData.result_details?.explainable_qa || null,
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

export async function runIv(showResultCard) {
  showResultCard("resultCardIv");
  setRunning("ivOut", "iv diagnostics");
  try {
    const lowerQ = Number(document.getElementById("burstLowerQ")?.value ?? 10) / 100;
    const upperQ = Number(document.getElementById("burstUpperQ")?.value ?? 90) / 100;
    const data = await postJson("/market/iv/diagnostics", {
      spot: Number(document.getElementById("spot").value),
      strike: Number(document.getElementById("strike").value),
      maturity: Number(document.getElementById("maturity").value),
      smile_points: Number(document.getElementById("ivSmilePoints")?.value || 11),
      moneyness_steps: Number(document.getElementById("ivKSteps")?.value || 9),
      tenor_steps: Number(document.getElementById("ivTSteps")?.value || 7),
      burst_lower_quantile: lowerQ,
      burst_upper_quantile: upperQ,
    });
    renderIv("ivOut", data);
  } catch (err) { showError("ivOut", err); }
}

export async function runStress(showResultCard) {
  showResultCard("resultCardStress");
  setRunning("stressOut", "stress library");
  try {
    const base = basePayload();
    const data = await postJson("/tool/stress/run", {
      spot: base.spot,
      strike: base.strike,
      rate: base.rate,
      vol: base.vol,
      maturity: base.maturity,
      n_paths: base.n_paths,
      dividend_yield: base.dividend_yield,
      n_rebalances: Number(document.getElementById("nReb").value),
      hedge_paths: Number(document.getElementById("hedgePaths").value),
      transaction_cost_bps: Number(document.getElementById("hedgeTcBps").value),
      rebalance_threshold: Number(document.getElementById("hedgeThreshold").value),
      vol_mismatch_mult: Number(document.getElementById("hedgeVolMismatchMult").value),
      stress_pack: getSelectButtonValue("stressPack"),
      stress_severity: getSelectButtonValue("stressSeverity"),
      include_hedge_compare: getSwitchValue("stressIncludeHedge"),
    });
    renderStress("stressOut", data);
  } catch (err) { showError("stressOut", err); }
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

export async function runGreekSurface(showResultCard) {
  showResultCard("resultCardGreekSurface");
  setRunning("greekSurfaceOut", "greek surface");
  try {
    const base  = basePayload();
    const spot  = base.spot;
    const data  = await postJson("/tool/greek/surface", {
      strike:         base.strike,
      rate:           base.rate,
      vol:            base.vol,
      dividend_yield: base.dividend_yield,
      spot_min:       spot * 0.6,
      spot_max:       spot * 1.4,
      mat_min:        0.05,
      mat_max:        Math.max(0.1, base.maturity * 2),
      n_spots:        Number(document.getElementById("greekSurfaceNSpots")?.value || 21),
      n_mats:         Number(document.getElementById("greekSurfaceNMats")?.value  || 11),
      greek:          getSelectButtonValue("greekSelector") || "delta",
    });
    renderGreekSurface("greekSurfaceOut", data);
  } catch (err) { showError("greekSurfaceOut", err); }
}

export async function runCalibration(showResultCard) {
  showResultCard("resultCardCalibration");
  setRunning("calibrationOut", "calibration");
  try {
    const base  = basePayload();
    const model = getSelectButtonValue("calibrationModel") || "bs_iv";

    if (model === "bs_iv") {
      // Single BS IV: back-solve from the BS price at current params
      const bsPrice = base.spot * 0.1; // fallback; ideally use live market price
      const data = await postJson("/tool/calibration/iv", {
        market_price:   bsPrice > 0 ? bsPrice : base.spot * 0.05,
        spot:           base.spot,
        strike:         base.strike,
        rate:           base.rate,
        maturity:       base.maturity,
        dividend_yield: base.dividend_yield,
      });
      renderCalibration("calibrationOut", data, "bs_iv");
    } else {
      // Heston: build a synthetic smile grid from current params for calibration demo
      const S = base.spot, K = base.strike, r = base.rate;
      const v = base.vol, T = base.maturity, q = base.dividend_yield;
      const kMult  = [0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15];
      const tMult  = [0.5, 1.0];
      const strikes = [], maturities = [], prices = [];
      for (const km of kMult) {
        for (const tm of tMult) {
          strikes.push(K * km);
          maturities.push(T * tm);
          // Generate "market" price = BS price + small smile adjustment
          const moneyness = Math.log(K * km / S);
          const skew = -0.1 * moneyness;  // mild negative skew
          const adjVol = Math.max(0.01, v + skew);
          // We'll just pass the base vol price as market price (identity calibration)
          prices.push(null);  // will be filled by the engine itself
        }
      }
      // For a meaningful demo: calibrate to BS prices at slightly different vols
      const synthPrices = strikes.map((k, i) => {
        const mono = Math.log(k / S) / Math.sqrt(maturities[i]);
        const adjV = Math.max(0.05, v * (1 + 0.15 * mono * mono - 0.1 * mono));
        const d1 = (Math.log(S/k) + (r + 0.5*adjV*adjV)*maturities[i]) / (adjV*Math.sqrt(maturities[i]));
        const d2 = d1 - adjV*Math.sqrt(maturities[i]);
        const erf1 = 0.5*(1+Math.sign(d1)*Math.sqrt(1-Math.exp(-d1*d1*2/Math.PI)));
        const erf2 = 0.5*(1+Math.sign(d2)*Math.sqrt(1-Math.exp(-d2*d2*2/Math.PI)));
        return Math.max(S*erf1 - k*Math.exp(-r*maturities[i])*erf2, 0.001);
      });

      const maxIter = Number(document.getElementById("calibrationMaxIter")?.value || 500);
      const data = await postJson("/tool/calibration/heston", {
        spot:               S,
        rate:               r,
        dividend_yield:     q,
        market_strikes:     strikes,
        market_maturities:  maturities,
        market_prices:      synthPrices,
        init_v0:    v * v,
        init_kappa: 1.5,
        init_theta: v * v,
        init_xi:    0.5,
        init_rho:   -0.7,
        max_iter:   maxIter,
      });
      renderCalibration("calibrationOut", data, "heston");
    }
  } catch (err) { showError("calibrationOut", err); }
}

export async function runMultiLeg(showResultCard) {
  showResultCard("resultCardMultiLeg");
  setRunning("multiLegOut", "multi-leg");
  try {
    const base = basePayload();
    let legs;
    try {
      legs = JSON.parse(document.getElementById("multiLegLegs")?.value || "[]");
    } catch {
      legs = [{ option_type: "call", strike: base.strike, quantity: 1 }];
    }
    const data = await postJson("/tool/pricing/multi-leg", {
      spot:           base.spot,
      rate:           base.rate,
      vol:            base.vol,
      maturity:       base.maturity,
      dividend_yield: base.dividend_yield,
      n_paths:        base.n_paths,
      legs,
    });
    renderMultiLeg("multiLegOut", data);
  } catch (err) { showError("multiLegOut", err); }
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

/* ─── Stress pack dynamic loader ─────────────────────────────────────────── */

export async function loadStressPacks() {
  try {
    const data = await getJson("/tool/stress/packs");
    const container = document.getElementById("stressPack");
    if (!container || !Array.isArray(data.packs)) return;
    const current = container.querySelector(".select-btn.active")?.dataset.value ?? "core4";
    container.innerHTML = data.packs.map((pack, i) => {
      const isActive = pack.id === current || (i === 0 && !data.packs.find(p => p.id === current));
      return `<button type="button" class="select-btn${isActive ? " active" : ""}" data-value="${pack.id}" title="${pack.description}">${pack.name}</button>`;
    }).join("");
    // Re-init select-button listeners for this group
    container.querySelectorAll(".select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".select-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  } catch {
    // Leave hardcoded fallback buttons in place
  }
}

/* ─── Burst slider wiring ────────────────────────────────────────────────── */

export function initBurstSliders() {
  const lower = document.getElementById("burstLowerQ");
  const upper = document.getElementById("burstUpperQ");
  const lowerVal = document.getElementById("burstLowerVal");
  const upperVal = document.getElementById("burstUpperVal");
  if (lower && lowerVal) {
    lower.addEventListener("input", () => { lowerVal.textContent = `${lower.value}%`; });
  }
  if (upper && upperVal) {
    upper.addEventListener("input", () => { upperVal.textContent = `${upper.value}%`; });
  }
}
