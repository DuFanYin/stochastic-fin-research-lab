// Parameter groups shared by several modes: the market inputs, the option, the validation pre-check.
import { market, markStrikeEdited, reresolve } from "../lib/live.js";
import { settings } from "../lib/store.js";
import { Chips, Group, Num, Seg, Toggle } from "../ui/controls.jsx";

const Info = ({ children }) => <p class="col-span-2 -mt-1 truncate font-mono text-2xs text-muted">{children}</p>;

export function MarketGroup({ drift }) {
  const live = settings.value.dataMode === "live";
  const m = market.value;
  return (
    <Group title={live ? "Market · live" : "Market · simulated"}>
      <Num k="spot" label="Spot" hint="BTC/USD index (Binance)" readOnly={live} />
      <Num k="strike" label="Strike" onEdit={() => { markStrikeEdited(); if (live) reresolve(); }} />
      <Num k="vol" label="σ" hint="Implied vol matched to strike and T (Deribit surface)" step="0.01" readOnly={live} />
      <Num k="rate" label="r" hint="US Treasury yield interpolated to T" step="0.0001" readOnly={live} />
      {live && m.ivSource && <Info>σ {m.ivSource} · {m.ivMatch}</Info>}
      {live && m.rateTenor && <Info>r tenor {m.rateTenor}</Info>}
      <Num k="maturity" label="T (years)" step="0.05" onEdit={() => live && reresolve()} />
      <Num k="dividendYield" label="q" hint="BTC pays no dividend" step="0.01" />
      {drift && <Num k="mu" label="μ (drift)" hint="Annualised BTC perpetual funding rate (Binance)" step="0.001" readOnly={live} wide />}
      {drift && live && m.funding8h != null && <Info>8h funding {m.funding8h}% → {m.muPct}% a year</Info>}
    </Group>
  );
}

export const OPTION_TYPES = [["call", "Call"], ["put", "Put"]];
export const EXERCISE = [["european", "European"], ["american", "American"]];

export function OptionGroup({ mc = true }) {
  return (
    <Group title="Option">
      <Seg k="optionType" label="Type" options={OPTION_TYPES} wide={false} />
      {mc ? <Num k="nPaths" label="MC paths" step="1000" /> : <span />}
      <Seg k="exercise" label="Exercise" options={EXERCISE} />
      {mc && <Seg k="numeraire" label="Numeraire" options={[["money_market", "Money market"], ["stock", "Stock"]]} />}
      {mc && <Toggle k="fxMode" label="FX mode" />}
      {mc && <Seg k="mcSampler" label="MC sampler" options={[["pseudorandom", "Pseudo"], ["antithetic", "Antithetic"], ["sobol", "Sobol"]]} />}
    </Group>
  );
}

export const CHECKS = [["pickStats", "Stats"], ["pickIto", "Itô"], ["pickSimulation", "Simulation"],
  ["pickLattice", "Lattice", "Trinomial vs BS; LSM and PSOR finite differences vs the binomial American put"]];

export function PrecheckGroup() {
  return (
    <Group title="Pre-check">
      <Toggle k="precheck" label="Validate first" hint="Run the validation gate before the computation" />
      <Toggle k="blockOnFail" label="Block on fail" hint="Stop when the gate fails" />
      <Chips label="Checks (parameters under Validation)" items={CHECKS} />
    </Group>
  );
}
