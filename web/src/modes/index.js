// The modes, in tab order. Each: { id, label, about, Params, Results, run, precheck, enter? }.
import multileg from "./multileg.jsx";
import numerics from "./numerics.jsx";
import pricing from "./pricing.jsx";
import risk from "./risk.jsx";
import screener from "./screener.jsx";
import validation from "./validation.jsx";

export const MODES = [pricing, multileg, risk, numerics, screener, validation];
export const byId = Object.fromEntries(MODES.map((m) => [m.id, m]));
