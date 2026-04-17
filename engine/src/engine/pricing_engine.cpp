#include "engine.h"
#include "kernel/kernel.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <ranges>
#include <vector>
#include <omp.h>

namespace sf {

namespace {

double quantile_sorted(const std::vector<double>& sv, double q) {
    if (sv.empty()) return 0.0;
    const double pos = q * (sv.size() - 1);
    const int lo = static_cast<int>(pos);
    const int hi = std::min(lo + 1, static_cast<int>(sv.size()) - 1);
    return sv[lo] * (1.0 - (pos - lo)) + sv[hi] * (pos - lo);
}

double pop_std(const std::vector<double>& v) {
    if (v.empty()) return 0.0;
    const double m = std::accumulate(v.begin(), v.end(), 0.0) / v.size();
    double acc = 0.0;
    for (double x : v) acc += (x - m) * (x - m);
    return std::sqrt(acc / v.size());
}

MethodStats agg_method(const std::string& name, const std::vector<double>& vals,
                        const std::vector<double>* errs = nullptr) {
    MethodStats s;
    s.method = name;
    const int n = static_cast<int>(vals.size());
    if (n == 0) return s;
    s.avg = std::accumulate(vals.begin(), vals.end(), 0.0) / n;
    s.min = *std::ranges::min_element(vals);
    s.max = *std::ranges::max_element(vals);
    double var = 0.0;
    for (double v : vals) var += (v - s.avg) * (v - s.avg);
    s.std = std::sqrt(var / n);
    if (errs && !errs->empty())
        s.avg_err_vs_bs = std::accumulate(errs->begin(), errs->end(), 0.0) / n;
    return s;
}

PricingBatchResult assemble_batch(
    const std::vector<double>& spots,
    const std::vector<double>& strikes,
    const std::vector<double>& vols,
    const std::vector<double>& out_mc,
    const std::vector<double>& out_bs,
    const std::vector<double>& out_bin,
    double runtime_ms
) {
    const int n = static_cast<int>(spots.size());
    PricingBatchResult r;
    r.job_count  = n;
    r.runtime_ms = runtime_ms;

    std::vector<double> spreads(n), mc_err(n), bin_err(n);
    for (int i = 0; i < n; ++i) {
        spreads[i] = std::max({out_mc[i], out_bs[i], out_bin[i]})
                   - std::min({out_mc[i], out_bs[i], out_bin[i]});
        mc_err[i]  = out_mc[i]  - out_bs[i];
        bin_err[i] = out_bin[i] - out_bs[i];
        BatchJobResult row;
        row.spot    = spots[i];
        row.strike  = strikes[i];
        row.vol     = vols[i];
        row.mc      = out_mc[i];
        row.bs      = out_bs[i];
        row.binomial = out_bin[i];
        row.spread  = spreads[i];
        r.rows.push_back(row);
    }

    auto sorted = spreads;
    std::ranges::sort(sorted);
    const double sum = std::accumulate(spreads.begin(), spreads.end(), 0.0);
    const double mean = n > 0 ? sum / n : 0.0;
    r.avg_spread = mean;
    r.p50_spread = quantile_sorted(sorted, 0.50);
    r.p95_spread = quantile_sorted(sorted, 0.95);
    r.max_spread = sorted.empty() ? 0.0 : sorted.back();
    r.min_spread = sorted.empty() ? 0.0 : sorted.front();
    r.spread_std = pop_std(spreads);
    r.spread_cv  = r.spread_std / std::max(std::abs(mean), 1e-12);
    r.worst_idx  = -1; r.best_idx = -1;
    for (int i = 0; i < n; ++i) {
        if (r.worst_idx < 0 || spreads[i] > spreads[r.worst_idx]) r.worst_idx = i;
        if (r.best_idx  < 0 || spreads[i] < spreads[r.best_idx])  r.best_idx  = i;
    }

    r.method_summary.push_back(agg_method("bs",       out_bs,  nullptr));
    r.method_summary.push_back(agg_method("mc",       out_mc,  &mc_err));
    r.method_summary.push_back(agg_method("binomial", out_bin, &bin_err));
    return r;
}

}  // namespace

PricingResult run_pricing(const PricingParams& p) {
    const int steps = p.n_steps > 0 ? p.n_steps : std::max(10, static_cast<int>(p.maturity * 250.0));
    PricingResult r;
    r.numeraire = p.numeraire;

    if (p.product_type == "digital_call") {
        r.bs = digital_call_bs_price(p.spot, p.strike, p.rate, p.vol, p.maturity, p.dividend_yield);
        r.mc = r.bs; r.binomial = r.bs;
    } else {
        const double r_eff = p.rate - p.dividend_yield;
        r.mc      = mc_price_with_stderr(p.spot, p.strike, r_eff, p.vol, p.maturity, p.n_paths, &r.mc_std_err);
        r.bs      = bs_closed_form_price(p.spot, p.strike, r_eff, p.vol, p.maturity);
        r.binomial = binomial_price(p.spot, p.strike, r_eff, p.vol, p.maturity, steps);
        pricing_greeks(p.spot, p.strike, r_eff, p.vol, p.maturity, &r.delta_bs, &r.vega_bs);
        pricing_error_decomp(r.mc, r.bs, r.binomial, &r.mc_minus_bs, &r.binomial_minus_bs);
        if (p.is_american) {
            r.american     = binomial_american_price(p.spot, p.strike, r_eff, p.vol, p.maturity, steps, 0.0);
            r.has_american = true;
        }
    }

    if (p.fx_mode) {
        const double scale = 1.0 / std::max(p.spot, 1e-6);
        r.mc *= scale; r.bs *= scale; r.binomial *= scale;
        if (r.has_american) r.american *= scale;
    }

    r.spread     = std::max({r.mc, r.bs, r.binomial}) - std::min({r.mc, r.bs, r.binomial});
    r.rel_spread = r.spread / std::max(std::abs(r.bs), 1e-12);
    r.stability  = (r.spread < std::max(1e-6, 0.05 * std::max(std::abs(r.bs), 1.0)))
                   ? "good" : "check_model_params";
    r.in_spot     = p.spot;
    r.in_strike   = p.strike;
    r.in_vol      = p.vol;
    r.in_maturity = p.maturity;
    r.in_rate     = p.rate;
    r.in_n_paths  = p.n_paths;
    return r;
}

PricingBatchResult run_pricing_batch(const std::vector<PricingParams>& jobs, double runtime_ms) {
    const int n = static_cast<int>(jobs.size());
    std::vector<double> spots(n), strikes(n), rates(n), vols(n), mats(n), divs(n);
    std::vector<int>    npaths(n);
    for (int i = 0; i < n; ++i) {
        spots[i]   = jobs[i].spot;
        strikes[i] = jobs[i].strike;
        rates[i]   = jobs[i].rate;
        vols[i]    = jobs[i].vol;
        mats[i]    = jobs[i].maturity;
        divs[i]    = jobs[i].dividend_yield;
        npaths[i]  = jobs[i].n_paths;
    }
    std::vector<double> out_mc(n), out_bs(n), out_bin(n);
    pricing_batch(spots, strikes, rates, vols, mats, npaths, divs, out_mc, out_bs, out_bin);

    std::vector<double> final_vols(n);
    for (int i = 0; i < n; ++i) final_vols[i] = jobs[i].vol;
    return assemble_batch(spots, strikes, final_vols, out_mc, out_bs, out_bin, runtime_ms);
}

PricingBatchResult run_pricing_batch_grid(const BatchGridParams& p, double runtime_ms) {
    const int n = std::max(1, std::min(p.n_jobs, 500));
    const double center = (n - 1) / 2.0;
    std::vector<double> spots(n), strikes(n), rates(n), vols(n), mats(n), divs(n);
    std::vector<int>    npaths(n);
    for (int i = 0; i < n; ++i) {
        const double k = static_cast<double>(i) - center;
        spots[i]   = p.base.spot   * std::max(0.01, 1.0 + k * p.spot_shock);
        vols[i]    = p.base.vol    * std::max(0.05, 1.0 + k * p.spot_shock * 0.5);
        strikes[i] = p.base.strike;
        rates[i]   = p.base.rate;
        mats[i]    = p.base.maturity;
        divs[i]    = p.base.dividend_yield;
        npaths[i]  = p.base.n_paths;
    }
    std::vector<double> out_mc(n), out_bs(n), out_bin(n);
    pricing_batch(spots, strikes, rates, vols, mats, npaths, divs, out_mc, out_bs, out_bin);
    return assemble_batch(spots, strikes, vols, out_mc, out_bs, out_bin, runtime_ms);
}

}  // namespace sf
