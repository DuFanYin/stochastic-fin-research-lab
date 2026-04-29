import {
  markRunStart,
  getDataMode,
  showErrorToast,
  initShellControls,
  initSelectButtons,
  initSwitchButtons,
  initModeSwitch,
  initToggleButton,
  initParamFlash,
  initModeParamSections,
  isPicked,
  setActiveParamGroups,
} from "./ui/core.js";
import {
  fetchLiveData,
  resolveFromSnapshot,
  applyDataMode,
  runPricingMain,
  runStress,
  runBenchmark,
  runValidationForCompute,
  runValidationOnly,
  runMultiLeg,
  loadStressPacks,
  initBurstSliders,
} from "./page/runners.js";

/* ─── Bootstrap ──────────────────────────────────────────────────────────── */

initShellControls();
initSelectButtons();
initSwitchButtons();
initModeParamSections();

initModeSwitch(["measureModePQ", "measureModeRN"]);

// Pricing single/batch toggle — also controls batch-only param visibility
function applyPricingMode(isBatch) {
  ["pricingModeSingle", "pricingModeBatch"].forEach((id) => {
    document.getElementById(id)?.classList.toggle("active", id === (isBatch ? "pricingModeBatch" : "pricingModeSingle"));
  });
  const batchParams = document.getElementById("batchPricingParams");
  if (batchParams) {
    const pricingActive = document.getElementById("runBtnPricing")?.classList.contains("run-active");
    batchParams.style.display = (isBatch && pricingActive) ? "contents" : "none";
  }
}
document.getElementById("pricingModeSingle")?.addEventListener("click", () => applyPricingMode(false));
document.getElementById("pricingModeBatch")?.addEventListener("click",  () => applyPricingMode(true));

const validationPickIds = ["pickStats", "pickIto", "pickSimulation"];

const modeToggleIds = [
  ...validationPickIds,
  "pricingModeSingle", "pricingModeBatch",
  "measureModePQ", "measureModeRN",
  "computeUseValidation", "computeBlockOnValidation",
];

validationPickIds.forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("click", () => el.classList.toggle("active"));
});
initToggleButton("computeUseValidation");
initToggleButton("computeBlockOnValidation");

/* ─── Apply current data mode immediately after render ───────────────────── */

applyDataMode(getDataMode());

/* ─── React to Live/Sim toggle from the header ───────────────────────────── */

window.addEventListener("sf:modechange", (e) => {
  applyDataMode(e.detail);
  if (e.detail === "live") {
    fetchLiveData().catch(() => {});
  }
});

/* ─── Mark strike as user-edited when touched ────────────────────────────── */

document.getElementById("strike")?.addEventListener("input", (e) => {
  e.target.dataset.userEdited = "1";
  if (getDataMode() === "live") resolveFromSnapshot().catch(() => {});
});

/* ─── Re-resolve rate + IV when maturity changes ─────────────────────────── */

document.getElementById("maturity")?.addEventListener("input", () => {
  if (getDataMode() === "live") resolveFromSnapshot().catch(() => {});
});

/* ─── Live data fetch on load + refresh button ───────────────────────────── */

if (getDataMode() === "live") {
  fetchLiveData().catch(() => {});
}

document.getElementById("btnFetchLive")?.addEventListener("click", () => {
  fetchLiveData().catch(() => {});
});

/* ─── Result section management ─────────────────────────────────────────── */

const RESULT_SECTIONS = [
  "resultCardPricing",
  "resultCardMultiLeg",
  "resultCardStress",
  "resultCardBenchmark",
  "resultCardValidation",
];

function showOnlyResultSection(cardId) {
  RESULT_SECTIONS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-hidden", id !== cardId);
    el.classList.toggle("is-top", id === cardId);
  });
}

async function runWithOptionalValidation(mainRun, targetCardId) {
  try {
    markRunStart();
    // In Live mode, refresh market data before each compute run
    if (getDataMode() === "live") {
      await fetchLiveData().catch(() => {});
    }

    if (isPicked("computeUseValidation")) {
      const validation = await runValidationForCompute(isPicked, showOnlyResultSection);
      if (!validation.passed && isPicked("computeBlockOnValidation")) return;
    }
    showOnlyResultSection(targetCardId);
    await mainRun(showOnlyResultSection);
  } catch (err) {
    showErrorToast(err?.message ?? String(err), "Run Failed");
  }
}

/* ─── Active mode tracking for the main Run button ──────────────────────── */

let _activeModeBtnId = null;

const MODE_RUN_MAP = {
  runBtnPricing:    () => runWithOptionalValidation(runPricingMain,    "resultCardPricing"),
  runBtnMultiLeg:      () => runWithOptionalValidation(runMultiLeg,      "resultCardMultiLeg"),
  runBtnStress:     () => runWithOptionalValidation(runStress,         "resultCardStress"),
  runBtnBenchmark:  () => runWithOptionalValidation(runBenchmark,      "resultCardBenchmark"),
  runBtnValidation: async () => {
    markRunStart();
    try {
      if (getDataMode() === "live") await fetchLiveData().catch(() => {});
      await runValidationOnly(showOnlyResultSection, isPicked);
    } catch (err) { showErrorToast(err?.message ?? String(err), "Validation Failed"); }
  },
};

document.getElementById("runBtnMain")?.addEventListener("click", () => {
  if (_activeModeBtnId && MODE_RUN_MAP[_activeModeBtnId]) {
    MODE_RUN_MAP[_activeModeBtnId]();
  }
});

const RUN_MODE_BTN_IDS = [
  "runBtnPricing", "runBtnStress", "runBtnMultiLeg",
  "runBtnBenchmark", "runBtnValidation",
];

function setActiveModeBtn(id) {
  _activeModeBtnId = id;
  RUN_MODE_BTN_IDS.forEach((i) => document.getElementById(i)?.classList.remove("run-active"));
  document.getElementById(id)?.classList.add("run-active");
}

/* ─── Mode buttons: select only, no run ─────────────────────────────────── */

RUN_MODE_BTN_IDS.forEach((id) => {
  document.getElementById(id)?.addEventListener("click", () => {
    setActiveModeBtn(id);
    setActiveParamGroups(id);
    // Re-apply after setActiveParamGroups since it overwrites batchPricingParams display
    const isBatch = document.getElementById("pricingModeBatch")?.classList.contains("active");
    const batchParams = document.getElementById("batchPricingParams");
    if (batchParams) batchParams.style.display = (id === "runBtnPricing" && isBatch) ? "contents" : "none";
  });
});

/* ─── Param flash ────────────────────────────────────────────────────────── */

initParamFlash();

/* ─── Default active mode on load ───────────────────────────────────────── */

setActiveModeBtn("runBtnPricing");
setActiveParamGroups("runBtnPricing");
// Batch params hidden by default (single mode is default)
applyPricingMode(false);

/* ─── Burst sliders + dynamic stress packs ───────────────────────────────── */

initBurstSliders();
loadStressPacks().catch(() => {});
