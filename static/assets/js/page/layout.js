/* ─── Live BTC Workbench HTML layout ─────────────────────────────────────────
   Identical param panel to workbench.html, but:
   • Spot / sigma / r fields are read-only (filled by live fetch).
   • A live-data status banner sits at the top of the left column.
   • q (dividend_yield) defaults to 0 — BTC pays no dividend.
   • Strike / maturity / mu and all tool params remain user-editable.
────────────────────────────────────────────────────────────────────────────── */

export const content = `
  <section class="panel compute-3col">

    <article class="compute-col">
      <div class="param-grid">

        <div class="param-group-label param-group-label--with-action">
          <span>Live Market Data</span>
          <button id="btnFetchLive" type="button" class="mode-switch param-group-btn">Refresh</button>
        </div>
        <div class="field param-full">
          <div id="liveDataBanner" class="live-banner live-banner--idle">
            <div class="live-banner-grid">
              <span class="lbk">spot</span><span class="lbv" id="bannerSpot">—</span>
              <span class="lbk">IV</span>  <span class="lbv" id="bannerIV">—</span>
              <span class="lbk">r</span>   <span class="lbv" id="bannerR">—</span>
              <span class="lbk">mu</span>  <span class="lbv" id="bannerMu">—</span>
              <span class="lbk">as of</span><span class="lbv" id="bannerTs">—</span>
            </div>
          </div>
        </div>

        <div class="param-group-label">Global Params</div>

        <!-- Spot + Strike: normal side-by-side pair -->
        <div class="field">
          <label id="labelSpot" title="BTC/USD spot — Binance">Spot</label>
          <input id="spot" type="number" value="65000" readonly class="live-input">
        </div>
        <div class="field">
          <label>Strike</label>
          <input id="strike" type="number" value="65000">
        </div>

        <!-- r: full-width field + structured info block -->
        <div class="field param-full">
          <label id="labelRate" title="Treasury yield interpolated to T">r</label>
          <input id="rate" type="number" value="0.045" step="0.0001" readonly class="live-input">
        </div>
        <div class="param-full live-info-block" id="rateTenorInfo">
          <span class="live-info-line" id="rateLine1">tenor  —</span>
          <div class="live-info-line live-curve-row" id="rateLine2">
            <span class="live-curve-label">curve</span>
            <span class="live-curve-chips" id="rateCurveChips">—</span>
          </div>
        </div>

        <!-- sigma: full-width field + structured info block -->
        <div class="field param-full">
          <label id="labelVol" title="ATM IV matched to strike + T — Deribit options">sigma</label>
          <input id="vol" type="number" value="0.80" step="0.01" readonly class="live-input">
        </div>
        <div class="param-full live-info-block" id="ivMatchInfo">
          <span class="live-info-line" id="ivLine1">instrument  —</span>
          <span class="live-info-line" id="ivLine2">match  —</span>
        </div>

        <!-- T + q: normal side-by-side pair -->
        <div class="field">
          <label>T</label>
          <input id="maturity" type="number" value="0.25" step="0.05">
        </div>
        <div class="field">
          <label title="BTC pays no dividend">q</label>
          <input id="dividendYield" type="number" value="0.0" step="0.01">
        </div>

        <!-- mu: full-width field + structured info block -->
        <div class="field param-full">
          <label id="labelMu" title="Annualised BTC perpetual funding rate — Binance">mu</label>
          <input id="mu" type="number" value="0.0" step="0.001" readonly class="live-input">
        </div>
        <div class="param-full live-info-block" id="fundingInfo">
          <span class="live-info-line" id="fundingLine1">8h rate  —</span>
          <span class="live-info-line" id="fundingLine2">source  —</span>
        </div>

        <div class="param-group-label">Pricing</div>
        <div class="field"><label>MC paths</label><input id="nPaths" type="number" value="20000"></div>
        <div class="field param-full">
          <label title="Product Type">Product Type</label>
          <div id="productType" class="select-buttons">
            <button type="button" class="select-btn active" data-value="european_call">European Call</button>
            <button type="button" class="select-btn" data-value="digital_call">Digital Call</button>
          </div>
        </div>
        <div class="field param-full">
          <label>Numeraire</label>
          <div id="numeraire" class="select-buttons">
            <button type="button" class="select-btn active" data-value="money_market">Money Market</button>
            <button type="button" class="select-btn" data-value="stock">Stock</button>
          </div>
        </div>
        <div class="field">
          <label>FX Mode</label>
          <button type="button" id="fxMode" class="switch-btn" data-value="false">Off</button>
        </div>
        <div class="field">
          <label>American</label>
          <button type="button" id="isAmerican" class="switch-btn" data-value="false">Off</button>
        </div>

        <div class="param-group-label">Batch Pricing</div>
        <div class="field"><label>jobs</label><input id="batchJobs" type="number" value="16"></div>
        <div class="field"><label>Spot Shock</label><input id="batchSpotShock" type="number" value="0.02" step="0.01"></div>

        <div class="param-group-label">Hedging</div>
        <div class="field"><label title="Rebalances">Rebalances</label><input id="nReb" type="number" value="52"></div>
        <div class="field"><label title="Simulation Paths">Sim Paths</label><input id="hedgePaths" type="number" value="2000"></div>

        <div class="param-group-label">PDE</div>
        <div class="field"><label>S steps</label><input id="pdeSSteps" type="number" value="160"></div>
        <div class="field"><label>T steps</label><input id="pdeTSteps" type="number" value="160"></div>
        <div class="field param-full">
          <label>Method</label>
          <div id="pdeMethod" class="select-buttons">
            <button type="button" class="select-btn active" data-value="crank_nicolson">CN</button>
            <button type="button" class="select-btn" data-value="implicit">Implicit</button>
          </div>
        </div>

        <div class="param-group-label">Measure</div>
        <div class="field"><label>P/Q steps</label><input id="cmpSteps" type="number" value="400"></div>
        <div class="field"><label>P/Q paths</label><input id="cmpPaths" type="number" value="10000"></div>
        <div class="field"><label>RN n steps</label><input id="measureN" type="number" value="500"></div>

        <div class="param-group-label">Convergence / Benchmark</div>
        <div class="field param-full">
          <label title="Step Ladder">step ladder</label>
          <input id="convSteps" type="text" value="10,20,40,80,120,200,320,500">
        </div>
        <div class="field param-full">
          <label>Baseline</label>
          <div id="benchmarkBase" class="select-buttons">
            <button type="button" class="select-btn active" data-value="pde">PDE</button>
            <button type="button" class="select-btn" data-value="bs">BS</button>
            <button type="button" class="select-btn" data-value="mc">MC</button>
            <button type="button" class="select-btn" data-value="binomial">Binomial</button>
          </div>
        </div>

      </div>
    </article>

    <article class="compute-col">
      <div class="mode-title">Mode</div>
      <div class="compute-mode-stack">
        <div class="compute-mode-section">
          <div class="button-row">
            <button id="runBtnPricing" class="mode-switch" type="button">Pricing</button>
            <button id="runBtnScenario" class="mode-switch" type="button">Scenario</button>
            <button id="runBtnHedge" class="mode-switch" type="button">Hedging</button>
          </div>
          <div class="button-row">
            <button id="runBtnPde" class="mode-switch" type="button">PDE</button>
            <button id="runBtnMeasure" class="mode-switch" type="button">Measure</button>
            <button id="runBtnConvergence" class="mode-switch" type="button">Convergence</button>
          </div>
          <div class="button-row">
            <button id="runBtnBenchmark" class="mode-switch" type="button">Benchmark</button>
            <button id="runBtnValidation" class="mode-switch" type="button">Validation Only</button>
          </div>
        </div>
        <div class="compute-mode-section">
          <div class="button-row">
            <span class="muted compute-mode-label">Validation</span>
            <button id="pickStats" class="mode-switch active" data-label="Stats">Stats</button>
            <button id="pickIto" class="mode-switch active" data-label="Ito">Ito</button>
            <button id="pickSimulation" class="mode-switch active" data-label="Simulation">Simulation</button>
          </div>
        </div>
        <div class="compute-mode-section">
          <div class="button-row">
            <span class="muted compute-mode-label">Pricing</span>
            <button id="pricingModeSingle" class="mode-switch active">Single</button>
            <button id="pricingModeBatch" class="mode-switch">Batch</button>
          </div>
        </div>
        <div class="compute-mode-section">
          <div class="button-row">
            <span class="muted compute-mode-label">Measure</span>
            <button id="measureModePQ" class="mode-switch active">P vs Q</button>
            <button id="measureModeRN" class="mode-switch">RN Density</button>
          </div>
        </div>
        <div class="compute-mode-section">
          <div class="button-row">
            <span class="muted compute-mode-label">Pipeline</span>
            <button id="computeUseValidation" class="mode-switch active" data-label="Pre-check">Pre-check</button>
            <button id="computeBlockOnValidation" class="mode-switch" data-label="Block on Fail">Block on Fail</button>
          </div>
        </div>
      </div>

      <div class="param-grid param-grid--top-gap">

        <div class="param-group-label">Stats</div>
        <div class="field"><label>theta</label><input id="statsTheta" type="number" value="1.0" step="0.1"></div>
        <div class="field"><label>sample</label><input id="statsN" type="number" value="50000"></div>

        <div class="param-group-label">Itô</div>
        <div class="field"><label>theta</label><input id="itoTheta" type="number" value="0.7" step="0.1"></div>
        <div class="field"><label>t</label><input id="itoT" type="number" value="1.0" step="0.1"></div>
        <div class="field"><label>n steps</label><input id="itoN" type="number" value="5000"></div>
        <div class="field param-full">
          <label>Function</label>
          <div id="itoFunctionType" class="select-buttons">
            <button type="button" class="select-btn active" data-value="exp_martingale">exp martingale</button>
            <button type="button" class="select-btn" data-value="w2_minus_t">W²−t</button>
            <button type="button" class="select-btn" data-value="w3">W³</button>
          </div>
        </div>

        <div class="param-group-label">Simulation</div>
        <div class="field"><label>steps</label><input id="steps" type="number" value="300"></div>
        <div class="field"><label>dt</label><input id="dt" type="number" value="0.01" step="0.01"></div>
        <div class="field"><label>kappa</label><input id="kappa" type="number" value="1.2" step="0.1"></div>
        <div class="field"><label>theta</label><input id="theta" type="number" value="0.03" step="0.01"></div>
        <div class="field param-full">
          <label>Model</label>
          <div id="model" class="select-buttons">
            <button type="button" class="select-btn active" data-value="brownian">Brownian Motion</button>
            <button type="button" class="select-btn" data-value="vasicek">Vasicek</button>
          </div>
        </div>

      </div>
    </article>

    <article class="compute-col">

      <section id="resultCardPricing" class="result-section is-hidden">
        <div class="result-section-label">Pricing<span id="diagPricing" class="diag-badge"></span></div>
        <div id="pricingOut"></div>
        <div id="pricingBatchOut"></div>
      </section>

      <section id="resultCardScenario" class="result-section is-hidden">
        <div class="result-section-label">Scenario Analysis<span id="diagScenario" class="diag-badge"></span></div>
        <div id="scenarioOut"></div>
      </section>

      <section id="resultCardHedge" class="result-section is-hidden">
        <div class="result-section-label">Hedging<span id="diagHedge" class="diag-badge"></span></div>
        <div id="hedgeOut"></div>
      </section>

      <section id="resultCardPde" class="result-section is-hidden">
        <div class="result-section-label">PDE Solver<span id="diagPde" class="diag-badge"></span></div>
        <div id="pdeOut"></div>
      </section>

      <section id="resultCardMeasure" class="result-section is-hidden">
        <div class="result-section-label">Measure<span id="diagMeasure" class="diag-badge"></span></div>
        <div id="measureCompareOut"></div>
        <div id="measureOut"></div>
      </section>

      <section id="resultCardConvergence" class="result-section is-hidden">
        <div class="result-section-label">Convergence<span id="diagConvergence" class="diag-badge"></span></div>
        <div id="convergenceOut"></div>
      </section>

      <section id="resultCardBenchmark" class="result-section is-hidden">
        <div class="result-section-label">Benchmark<span id="diagBenchmark" class="diag-badge"></span></div>
        <div id="benchmarkOut"></div>
      </section>

      <section id="resultCardValidation" class="result-section is-hidden">
        <div class="result-section-label">Validation<span id="diagValidation" class="diag-badge"></span></div>
        <div id="validationSummaryOut"></div>
        <div id="validationOut"></div>
      </section>

    </article>

  </section>
`;
