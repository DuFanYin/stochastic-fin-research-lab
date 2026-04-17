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
