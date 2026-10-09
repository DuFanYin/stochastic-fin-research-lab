// Validation: the gate on its own (statistics, Itô, simulation, lattice checks against thresholds), and
// the same report as a pre-check before the other modes.
import { post } from "../lib/api.js";
import { fixed, fmt } from "../lib/format.js";
import * as P from "../lib/payloads.js";
import { begin, fill, put } from "../lib/runner.js";
import { params } from "../lib/store.js";
import { Bad, Badge, Good, Kv, Note, Slot, Sub, Table } from "../ui/blocks.jsx";
import { Chips, Group, Num, Seg } from "../ui/controls.jsx";
import { HBars } from "../charts/Bars.jsx";
import { CHECKS, MarketGroup } from "./shared.jsx";

const ID = "validation";

function Params() {
  return (
    <>
      <Group title="Checks"><Chips items={CHECKS} /></Group>
      <Group title="Statistics">
        <Num k="statsTheta" label="θ" step="0.1" />
        <Num k="statsN" label="Sample" step="1000" />
      </Group>
      <Group title="Itô">
        <Num k="itoTheta" label="θ" step="0.1" />
        <Num k="itoT" label="t" step="0.1" />
        <Num k="itoN" label="Steps" step="500" wide />
        <Seg k="itoFunction" label="Function" options={[["exp_martingale", "exp martingale"], ["w2_minus_t", "W² − t"], ["w3", "W³"]]} />
      </Group>
      <Group title="Simulation">
        <Seg k="simModel" label="Model" options={[["brownian", "Brownian"], ["vasicek", "Vasicek"]]} />
        <Num k="simSteps" label="Steps" step="50" />
        <Num k="simDt" label="dt" step="0.01" />
        <Num k="simKappa" label="κ" step="0.1" />
        <Num k="simTheta" label="θ" step="0.01" />
      </Group>
      <MarketGroup drift />
    </>
  );
}

/** Runs the gate into `slot` of `mode`; returns whether it passed (true when nothing is picked). */
export async function gate(mode, slot) {
  const p = params.value;
  if (!P.anyCheck(p)) {
    put(mode, slot, { empty: true });
    return true;
  }
  const d = await fill(mode, slot, post("/tool/validation/gate", P.validationGate(p)));
  return d?.result_summary?.gate_decision === "go";
}

async function run() {
  begin(ID, ["gate"]);
  await gate(ID, "gate");
}

const show = (v) => (v == null ? "–" : typeof v === "object" ? Object.entries(v).map(([k, x]) => (Array.isArray(v) ? x : `${k} ${x}`)).join(Array.isArray(v) ? "," : ", ") : fmt(v));
const decision = (g) => <Badge kind={g === "go" || g === "pass" ? "good" : g === "fail" || g === "block" ? "bad" : "warn"}>{g ?? "–"}</Badge>;

/** The full report; `compact` (a pre-check) folds the details. */
export function Report({ data, compact }) {
  if (data.empty) return <Note>No check picked: Stats, Itô, Simulation or Lattice.</Note>;
  const s = data.result_summary || {}, d = data.result_details || {};
  const rows = d.rows || [], qa = d.explainable_qa;
  const failing = rows.filter((r) => r.status === "fail"), failed = s.checks_failed ?? failing.length;
  const head = (
    <div class="flex flex-wrap items-center gap-2 text-sm">
      {decision(s.gate_decision)}
      <span>{(s.checks_total ?? rows.length) - failed}/{s.checks_total ?? rows.length} checks passed</span>
      {failing.length > 0 && <span class="text-muted">· failed: {failing.map((r) => `${r.capability} ${r.metric}`).join(", ")}</span>}
    </div>
  );
  const details = (
    <>
      <Kv rows={[["Fail rate", s.fail_rate], ["Max excess", s.max_excess], ["Max excess item", s.max_excess_item]]} />
      <Sub>Value against threshold</Sub>
      <HBars rows={rows.map((r) => {
        const used = Math.abs(Number(r.value)) / Math.max(Math.abs(Number(r.threshold)), 1e-12);
        return { label: r.metric, value: Math.min(used, 2), ref: 1, text: used > 2 ? `${fixed(used, 1)}×` : fixed(used, 2), cls: r.status === "pass" ? "s3" : "down" };
      })} max={2} caption="Each check's value as a share of its threshold (grey: up to the threshold, 1; bars stop at 2)" />
      <Table compact rows={rows} cols={[
        { key: "capability", label: "Check", align: "left" }, { key: "metric", label: "Metric", align: "left" }, { key: "value", label: "Value" },
        { key: "threshold", label: "Threshold" }, { key: "excess", label: "Excess", fmt: (v) => (Number(v) > 0 ? <Bad>{fmt(v)}</Bad> : fmt(v ?? 0)) },
        { key: "status", label: "", fmt: (v) => (v === "pass" ? <Good>pass</Good> : v === "fail" ? <Bad>fail</Bad> : v) },
        { key: "interpretation", label: "Reading", align: "left", cls: "text-muted whitespace-normal min-w-48" },
      ]} />
      {qa && (qa.decision_reasoning || qa.actions_ranked?.length > 0) && (
        <>
          <Sub>What to change</Sub>
          {qa.decision_reasoning && <Note>{qa.decision_reasoning}</Note>}
          <ol class="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
            {(qa.actions_ranked || []).slice(0, 5).map((a) => (
              <li>{a.rationale ?? a.action_id}{a.param && a.proposed_value != null ? <span class="text-muted"> · {a.param} {show(a.current_value)} → {show(a.proposed_value)}</span> : null}</li>
            ))}
          </ol>
        </>
      )}
    </>
  );
  if (!compact) return <>{head}{details}</>;
  return (
    <details class="group">
      <summary class="cursor-pointer list-none">{head}<span class="text-xs text-accent group-open:hidden"> Show details</span></summary>
      <div class="mt-3 flex flex-col gap-3">{details}</div>
    </details>
  );
}

const Results = () => <Slot mode={ID} slot="gate" title="Validation gate" wide>{(d) => <Report data={d} />}</Slot>;

const about = "Run the theory checks on their own: sample moments against the normal distribution, Itô's formula on simulated paths, simulation and hedging sanity, and the lattices against closed forms. Each is held to a threshold, with ranked fixes for whatever fails.";

export default { id: ID, label: "Validation", about, Params, Results, run, precheck: false };
