// Number formatting for every value the workbench shows; the precision is the user's setting.
import { settings } from "./store.js";

export function fmt(v) {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    const a = Math.abs(v);
    if (a >= 1e7 || (a > 0 && a < 1e-4)) return v.toExponential(3);
    return Number(v.toFixed(settings.value.precision)).toLocaleString(undefined, { maximumFractionDigits: 10 });
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
export const ms = (v) => (v == null ? "–" : `${Number(v) < 10 ? Number(v).toFixed(2) : Math.round(Number(v)).toLocaleString()} ms`);
export const usd = (v) => (v == null || !Number.isFinite(Number(v)) ? "–"
  : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pct = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "–" : `${(Number(v) * 100).toFixed(d)}%`);
export const fixed = (v, d = 4) => (v == null || !Number.isFinite(Number(v)) ? "–" : Number(v).toFixed(d));
export const bound = (v, unbounded) => (unbounded ? "∞" : usd(v));
export const title = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "");

// a short tick label for chart axes
export function tick(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return +n.toFixed(2) + "";
  if (a === 0) return "0";
  if (a >= 1e-3) return +n.toFixed(4) + "";
  return n.toExponential(1);
}
