from pydantic import BaseModel, Field


class PricingRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    n_paths: int = Field(10000, ge=100, le=20_000_000)
    product_type: str = "european_call"
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    fx_mode: bool = False
    numeraire: str = "money_market"
    is_american: bool = False
    mc_sampler: str = "pseudorandom"  # "pseudorandom" | "antithetic" | "sobol"


class PricingBatchRequest(BaseModel):
    jobs: list[PricingRequest] = Field(..., min_length=1, max_length=500)


class PricingBatchGridRequest(BaseModel):
    """Build a spot/vol shock grid server-side from a single base spec."""
    base: PricingRequest
    n_jobs: int = Field(16, ge=1, le=500)
    spot_shock: float = Field(0.02, ge=0.0, le=1.0)


class HedgingRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    n_rebalances: int = Field(52, ge=1, le=10_000)
    n_paths: int = Field(500, ge=50, le=200_000)
    transaction_cost_bps: float = Field(5.0, ge=0.0, le=1000.0)
    rebalance_threshold: float = Field(0.02, ge=0.0, le=1.0)
    vol_mismatch_mult: float = Field(1.15, ge=0.1, le=5.0)


class SimulationRequest(BaseModel):
    model: str = "brownian"
    n_steps: int = Field(100, ge=1, le=500_000)
    dt: float = Field(0.01, gt=0, le=10.0)
    sigma: float = Field(0.2, gt=0, le=5.0)
    kappa: float = Field(1.2, ge=0, le=100.0)
    theta: float = Field(0.03, ge=-10.0, le=10.0)
    x0: float = 0.0


class StatsRequest(BaseModel):
    mu: float = 0.0
    sigma: float = Field(1.0, gt=0, le=100.0)
    theta: float = 1.0
    sample_size: int = Field(10000, ge=10, le=10_000_000)


class ItoCheckRequest(BaseModel):
    function_type: str = "exp_martingale"
    theta: float = 0.7
    t: float = Field(1.0, gt=0, le=100.0)
    n_steps: int = Field(2000, ge=100, le=2_000_000)


class MeasureChangeRequest(BaseModel):
    mu: float = 0.08
    r: float = 0.02
    sigma: float = Field(0.2, gt=0, le=5.0)
    t: float = Field(1.0, gt=0, le=100.0)
    n_steps: int = Field(200, ge=20, le=2_000_000)


class MeasureCompareRequest(BaseModel):
    mu: float = 0.08
    r: float = 0.02
    sigma: float = Field(0.2, gt=0, le=5.0)
    t: float = Field(1.0, gt=0, le=100.0)
    n_steps: int = Field(400, ge=40, le=200_000)
    n_paths: int = Field(2000, ge=100, le=200_000)
    x0: float = 1.0


class PdeRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    s_steps: int = Field(200, ge=40, le=2000)
    t_steps: int = Field(200, ge=40, le=4000)
    method: str = "crank_nicolson"
    option_type: str = "call"


class ConvergenceRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    step_ladder: list[int] = Field(default_factory=lambda: [10, 20, 40, 80, 120, 200, 320, 500], min_length=2, max_length=30)


class BenchmarkRequest(BaseModel):
    pricing: PricingRequest
    pde_method: str = "crank_nicolson"
    pde_s_steps: int = Field(160, ge=40, le=2000)
    pde_t_steps: int = Field(160, ge=40, le=4000)
    benchmark_baseline: str = "pde"


class ValidationGateRequest(BaseModel):
    pick_stats: bool = False
    pick_ito: bool = False
    pick_simulation: bool = False
    compute_block_on_validation: bool = False

    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    n_paths: int = Field(10000, ge=100, le=20_000_000)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)

    mu: float = 0.0
    stats_theta: float = 1.0
    stats_n: int = Field(10000, ge=10, le=10_000_000)

    ito_function_type: str = "exp_martingale"
    ito_theta: float = 0.7
    ito_t: float = Field(1.0, gt=0, le=100.0)
    ito_n: int = Field(2000, ge=100, le=2_000_000)

    model: str = "brownian"
    sim_steps: int = Field(100, ge=1, le=500_000)
    sim_dt: float = Field(0.01, gt=0, le=10.0)
    sim_kappa: float = Field(1.2, ge=0, le=100.0)
    sim_theta: float = Field(0.03, ge=-10.0, le=10.0)

    measure_n: int = Field(200, ge=20, le=2_000_000)
    cmp_steps: int = Field(400, ge=40, le=200_000)
    cmp_paths: int = Field(2000, ge=100, le=200_000)

    conv_steps: list[int] = Field(default_factory=lambda: [10, 20, 40, 80, 120, 200, 320, 500], min_length=2, max_length=30)

    pde_s_steps: int = Field(200, ge=40, le=2000)
    pde_t_steps: int = Field(200, ge=40, le=4000)
    pde_method: str = "crank_nicolson"

    n_rebalances: int = Field(52, ge=1, le=10_000)
    hedge_paths: int = Field(500, ge=50, le=200_000)

    batch_jobs: int = Field(7, ge=1, le=500)
    batch_spot_shock: float = Field(0.02, ge=0.0, le=1.0)


class GreekSurfaceRequest(BaseModel):
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    spot_min: float = Field(..., gt=0)
    spot_max: float = Field(..., gt=0)
    mat_min: float = Field(0.1, gt=0, le=100.0)
    mat_max: float = Field(3.0, gt=0, le=100.0)
    n_spots: int = Field(21, ge=5, le=50)
    n_mats: int = Field(11, ge=5, le=30)
    greek: str = "delta"


class ImpliedVolRequest(BaseModel):
    market_price: float = Field(..., gt=0)
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    maturity: float = Field(..., gt=0, le=100.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)


class ImpliedVolBatchRequest(BaseModel):
    market_prices: list[float] = Field(..., min_length=1, max_length=500)
    strikes: list[float] = Field(..., min_length=1, max_length=500)
    expiries: list[float] = Field(..., min_length=1, max_length=500)
    spot: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)


class HestonPriceRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    maturity: float = Field(..., gt=0, le=100.0)
    v0: float = Field(0.04, gt=0)
    kappa: float = Field(1.5, gt=0)
    theta: float = Field(0.04, gt=0)
    xi: float = Field(0.5, gt=0)
    rho: float = Field(-0.7, ge=-1.0, le=1.0)


class HestonCalibrateRequest(BaseModel):
    spot: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    market_strikes: list[float] = Field(..., min_length=2, max_length=200)
    market_maturities: list[float] = Field(..., min_length=2, max_length=200)
    market_prices: list[float] = Field(..., min_length=2, max_length=200)
    init_v0: float = Field(0.04, gt=0)
    init_kappa: float = Field(1.5, gt=0)
    init_theta: float = Field(0.04, gt=0)
    init_xi: float = Field(0.5, gt=0)
    init_rho: float = Field(-0.7, ge=-1.0, le=1.0)
    max_iter: int = Field(500, ge=50, le=5000)


class LegSpecRequest(BaseModel):
    option_type: str = "call"    # "call" | "put"
    strike: float = Field(..., gt=0)
    quantity: float = Field(1.0, ge=-100.0, le=100.0)


class MultiLegRequest(BaseModel):
    spot: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    n_paths: int = Field(10000, ge=100, le=20_000_000)
    legs: list[LegSpecRequest] = Field(..., min_length=1, max_length=10)


class StressLibraryRequest(BaseModel):
    spot: float = Field(..., gt=0)
    strike: float = Field(..., gt=0)
    rate: float = Field(..., ge=-1.0, le=1.0)
    vol: float = Field(..., gt=0, le=5.0)
    maturity: float = Field(..., gt=0, le=100.0)
    n_paths: int = Field(10000, ge=100, le=20_000_000)
    dividend_yield: float = Field(0.0, ge=-1.0, le=1.0)
    n_rebalances: int = Field(52, ge=1, le=10_000)
    hedge_paths: int = Field(1000, ge=50, le=200_000)
    transaction_cost_bps: float = Field(5.0, ge=0.0, le=1000.0)
    rebalance_threshold: float = Field(0.02, ge=0.0, le=1.0)
    vol_mismatch_mult: float = Field(1.15, ge=0.1, le=5.0)
    stress_pack: str = "core4"
    stress_severity: str = "moderate"
    include_hedge_compare: bool = True

