/* ─── Form widget helpers ────────────────────────────────────────────────────── */

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

/* ─── Running state helper (used by workbench) ───────────────────────────────── */

import { setHtml, statusRunning } from "./core.js";

export function setRunning(id, label) {
  setHtml(id, statusRunning(label));
}

/* ─── UI interactions: picks, param highlight, mode switches ─────────────────── */

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
