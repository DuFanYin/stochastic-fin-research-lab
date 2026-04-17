/* ─── UI interactions: picks, param highlight, mode switches ─────────────────── */

/* ─── Active param group highlighting ────────────────────────────────────────── */

const RUN_BTN_PARAM_GROUPS = {
  runBtnPricing:    ["Global Params", "Pricing", "Batch Pricing"],
  runBtnScenario:   ["Global Params", "Pricing"],
  runBtnHedge:      ["Global Params", "Hedging"],
  runBtnPde:        ["Global Params", "PDE"],
  runBtnMeasure:    ["Global Params", "Measure"],
  runBtnConvergence:["Global Params", "Convergence / Benchmark"],
  runBtnBenchmark:  ["Global Params", "PDE", "Convergence / Benchmark"],
  runBtnValidation: ["Stats", "Itô", "Simulation"],
};

export function setActiveParamGroups(btnId) {
  document.querySelectorAll(".param-group-label.param-active, .field.param-active")
    .forEach((el) => el.classList.remove("param-active"));

  const groups = RUN_BTN_PARAM_GROUPS[btnId];
  if (!groups) return;

  document.querySelectorAll(".param-group-label").forEach((label) => {
    const text = label.textContent.trim();
    const normalised = text.replace(/\u00f4/g, "ô");
    if (!groups.some((g) => normalised === g || text === g)) return;

    label.classList.add("param-active");
    let sib = label.nextElementSibling;
    while (sib && !sib.classList.contains("param-group-label")) {
      if (sib.classList.contains("field")) sib.classList.add("param-active");
      sib = sib.nextElementSibling;
    }
  });
}

/* ─── Mode / pick button helpers ─────────────────────────────────────────────── */

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

/* ─── Param change highlight ─────────────────────────────────────────────────── */

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
