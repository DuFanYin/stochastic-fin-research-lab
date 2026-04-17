/**
 * shell.js — public API barrel re-exporting from ui/ and ui/core.
 */

export { renderShell, setHtml, fmt, fmtMs, markRunStart, getDataMode } from "../ui/core.js";
export { setRunning, initSelectButtons, getSelectButtonValue, initSwitchButtons, getSwitchValue } from "../ui/controls.js";
export {
  renderPricing,
  renderScenario,
  renderPricingBatch,
  renderHedging,
  renderStats,
  renderIto,
  renderSimulation,
  renderMeasure,
  renderMeasureCompare,
  renderPde,
  renderConvergence,
  renderBenchmark,
  renderValidation,
  renderPerfProfile,
  renderKv,
  renderTable,
} from "../ui/renderers.js";
