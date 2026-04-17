import { renderShell, markRunStart, getDataMode } from "./core/shell.js";
import { showErrorToast } from "./ui/core.js";
import { initSelectButtons, initSwitchButtons } from "./ui/controls.js";
import { content } from "./page/layout.js";
import {
  fetchLiveData,
  resolveFromSnapshot,
  applyDataMode,
  runPricingMain,
  runScenario,
  runHedge,
  runPde,
  runMeasureMain,
  runConvergence,
  runBenchmark,
  runValidationForCompute,
  runValidationOnly,
} from "./page/runners.js";
import {
  initModeSwitch,
  initToggleButton,
  initParamFlash,
  isPicked,
  setActiveParamGroups,
} from "./ui/interactions.js";

/* ─── Bootstrap ──────────────────────────────────────────────────────────── */

renderShell(content);
initSelectButtons();
initSwitchButtons();

initModeSwitch(["pricingModeSingle", "pricingModeBatch"]);
initModeSwitch(["measureModePQ", "measureModeRN"]);

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
  "resultCardScenario",
  "resultCardHedge",
  "resultCardPde",
  "resultCardMeasure",
  "resultCardConvergence",
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

const RUN_MODE_BTN_IDS = [
  "runBtnPricing", "runBtnScenario", "runBtnHedge", "runBtnPde",
  "runBtnMeasure", "runBtnConvergence", "runBtnBenchmark", "runBtnValidation",
];

function setActiveModeBtn(id) {
  RUN_MODE_BTN_IDS.forEach((i) => document.getElementById(i)?.classList.remove("run-active"));
  document.getElementById(id)?.classList.add("run-active");
}

document.getElementById("runBtnPricing")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnPricing");
  runWithOptionalValidation(runPricingMain, "resultCardPricing");
});
document.getElementById("runBtnScenario")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnScenario");
  runWithOptionalValidation(runScenario, "resultCardScenario");
});
document.getElementById("runBtnHedge")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnHedge");
  runWithOptionalValidation(runHedge, "resultCardHedge");
});
document.getElementById("runBtnPde")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnPde");
  runWithOptionalValidation(runPde, "resultCardPde");
});
document.getElementById("runBtnMeasure")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnMeasure");
  runWithOptionalValidation(runMeasureMain, "resultCardMeasure");
});
document.getElementById("runBtnConvergence")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnConvergence");
  runWithOptionalValidation(runConvergence, "resultCardConvergence");
});
document.getElementById("runBtnBenchmark")?.addEventListener("click", () => {
  setActiveModeBtn("runBtnBenchmark");
  runWithOptionalValidation(runBenchmark, "resultCardBenchmark");
});
document.getElementById("runBtnValidation")?.addEventListener("click", async () => {
  setActiveModeBtn("runBtnValidation");
  markRunStart();
  try {
    if (getDataMode() === "live") await fetchLiveData().catch(() => {});
    await runValidationOnly(showOnlyResultSection, isPicked);
  } catch (err) {
    showErrorToast(err?.message ?? String(err), "Validation Failed");
  }
});

/* ─── Active param group highlight ──────────────────────────────────────── */

RUN_MODE_BTN_IDS.forEach((id) => {
  document.getElementById(id)?.addEventListener("click", () => setActiveParamGroups(id));
});

/* ─── Param flash ────────────────────────────────────────────────────────── */

initParamFlash();
