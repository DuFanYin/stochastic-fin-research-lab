# Quant Lab — 合并设计（option-screener + Option-Pricing）

> 基线：ASIS.md（quant-lab 现状）、UPGRADE.md（分层与传播链约定）。
> 本文描述把 `option-screener`（C++ 版）和 `Option-Pricing` 并入 quant-lab 后要做什么、落在哪一层、各层契约怎么改。
> 分支：`merge/options-platform`。

---

## 目标

合并后形成一条闭环工作流：

```
Deribit 公开 BTC / ETH 期权链（lab 现有数据源，无需 token）
  → Screener：过滤 → 穷举组合 → 策略级过滤 → 排序
    → 一键送入 Multi-Leg 定价（市场价 vs 模型价 = edge）
      → 一键送入 Stress / Hedging（压测、对冲）
```

同时把 Option-Pricing 里 quant-lab 尚缺的定价方法补进 kernel，并接入 Benchmark / Convergence 对比。

## 不变的原则

沿用 UPGRADE.md 的三层约定，不例外：

- **C++ engine**：所有数值计算（包括 screener 的过滤、枚举、排序）。无 I/O。
- **Python server**：拉取行情（Deribit）、校验、路由、注解。不做数值。
- **Browser**：渲染与流程编排。

传播链不变：`kernel → engine → contracts.h → c_api + parser → engine_client.py → routes → request_models.py → workbench`。

## 来源 → 去向总览

| 来源 | 内容 | 去向 | 处理 |
|---|---|---|---|
| option-screener/cpp | Option / Filter / Generator / Strategy / Factory | `engine/src/kernel/screener/` + `engine/src/engine/screener_engine.cpp` | 重构后移植 |
| option-screener/python/algo.py + `ForwardVolsGenerator` | forward vol 扫描 | `kernel/screener/forward_vol.cpp` | C++ 版本缺失，补写 |
| option-screener/tradier.py | Tradier 拉链 | — | **丢弃**，改用 lab 现有 Deribit 数据源（见 Phase 2） |
| option-screener/main.py + inspect.html | Chain Inspector | Workbench "Chain" 视图 | 重写为前端模式，不保留独立页面 |
| option-screener/python/ | Python 版 screener | — | **丢弃**（只保留 C++） |
| Option-Pricing/trees/trinomialTree.cpp | 三叉树（滚动存储） | `kernel/pricing/trinomial_lattice.cpp` | 移植，补 call / 欧式 / 股息 |
| Option-Pricing/monteCarlo/monteCarlo*.cpp | Longstaff-Schwartz 美式 MC | `kernel/pricing/lsm_american.cpp` | 移植，并行改 OpenMP |
| Option-Pricing/explicitFDM.cpp | 显式差分 | `kernel/pricing/pde.cpp` 新增 method=2 | 并入现有 PDE |
| Option-Pricing/implicitFDM.cpp | 隐式差分 | — | 已被 pde.cpp θ=1.0 覆盖，不移植 |
| Option-Pricing/trees/binomialTree.cpp | 二叉树 | — | 已有 `binomial_lattice.cpp`，只取剪枝思路做对比 |
| Option-Pricing/Queue/、线程池版 MC | 无锁队列、RingBuffer、线程池 | `bench/concurrency/` | 独立 bench，不进主流程 |

---

## Phase 0 — 仓库准备 ✅ 已完成

> 实际改动：README 改为相对路径与 `./run.sh build`；UPGRADE.md 中 "glob" 描述改正。源码按模块移植（文件头注明来源 commit），未整仓复制。


- 三个 repo 的历史：用 `git subtree add --prefix=legacy/<name>` 或直接复制源码二选一。**建议直接复制**并在提交信息里注明来源 commit（option-screener `8b31b95`、Option-Pricing `69af98d`），避免把 build 产物、`.DS_Store` 带进来。
- `.gitignore` 已覆盖 build / .venv / .env / dylib，无需改动；chain 快照存 `~/.quant-lab/`，不进仓库。
- README 里写死的 `/Users/hang/Downloads/Y3S2/...` 路径改为相对路径；`build_cpp.sh` 在 README 中被引用但仓库里不存在，统一改成 `./run.sh build`。
- 不引入任何新的 API token；Deribit public 接口无需鉴权。

---

## Phase 1 — Screener 引擎（C++）✅ 已完成

> 实现位置：`engine/src/kernel/screener/{screener.h, option_filter.cpp, strategies.cpp}`、`engine/src/engine/screener_engine.cpp`、`parser.cpp::run_screener_json`、ABI `sf_run_screener_json`、`engine_client.screener()`（含 buffer 扩容重试）。
> 测试：`tests/test_screener.py`（21 项，合成链）；`tests/legacy/test_legacy_regression.py`（与原 C++ 二进制逐条对比 5 组配置，含 PLTR 全链约 204 万个 IC：原版 ~8 s，移植版引擎 ~12 ms）。
> 与下文设计的差异：`model_vol` 取值为 `mark | flat | surface | heston | none`，"dvol" 由 Phase 2 的 Python 侧取 DVOL 后以 `flat` + `model_vol_flat` 传入；期权过滤用 `days_to_expiry_range`（天，由 years×365 得出）而非 `years_range`；新增 `price_mode`（`executable` | `mid`）与 `compute_greeks` 开关（回归测试用 `mid` + 文件自带 greeks）。


### 移植时必须修的问题

原 C++ 版有几处问题，移植时一并修掉，不原样搬：

1. **OptionFilter 改写共享数据**：Generator 通过 `const_cast` 把 `options_` 传给 `OptionFilter`，后者 `universe_ = std::move(filtered)` 直接覆盖 Factory 持有的原始链。第一个 generator 跑完后，后续 generator 看到的是已过滤的数据（同一 filter 时结果恰好一致，但属于 UB，且并行化后会出数据竞争）。→ 改为纯函数 `filter_options(span<const Option>, cfg) -> vector<Option>`。
2. **`cfg.direction.value()` 在 direction 为 null 时抛异常**。→ 默认 LONG，或对 IC 固定 SHORT premium 语义。
3. **Iron Condor 的 `max_loss` 只用 call 翼宽度**：应为 `max(call_width, put_width) − credit`。
4. **SingleLeg SELL 的 `max_loss = cost()` 为负数**，且 SELL call 的风险实为无限。→ 按 action 分别处理。
5. **README 声明的 `rank("credit")` 在 C++ 中未实现**。→ 补上。
6. **`StrategyList` 靠 `dynamic_cast` + clone 拷贝多态对象**。→ 改成值类型 `StrategyRecord`（legs + 预计算指标），排序直接作用于 `vector<StrategyRecord>`，无需虚函数和 clone。
7. **ForwardVols 只有 Python 版**。→ C++ 补写，并做成可交易的 calendar（LONG = 卖近月 / 买远月）。
8. **Iron Condor 的 `max_gain` 用的是毛权利金**（只算卖出腿，没扣买入翼的成本），`max_loss` 也基于毛权利金。→ 改为净权利金。（实现时发现，第 3 条的同类问题。）
9. **`direction` 对 Iron Condor 不起作用**。→ LONG = 收权利金的标准 IC（与原版一致），SHORT = 反向 IC（买内侧、卖外侧）。

### Kernel 层（`kernel/screener/`）

```cpp
// kernel.h 新增
struct ChainOption {
    std::string symbol, expiry;      // symbol: "BTC-27JUN25-65000-C"；expiry: "27JUN25"
    double strike = 0.0;
    bool   is_call = true;
    double forward = 0.0;            // 该到期的期货价（Deribit underlying_price），ATM/OTM 判断用它而不是现货
    double bid = NAN, ask = NAN, mark = 0.0;   // 均已换算为 USD（见 Phase 2）
    double iv = 0.0, volume = 0.0, oi = 0.0;   // iv = mark_iv（小数）
    double years = 0.0;              // 精确到秒的剩余年限（加密有日内到期）
    // greeks 不由数据源提供，由 C++ 在 screen_compute_greeks() 中按 Black-76 计算
    double delta = 0.0, gamma = 0.0, theta = 0.0, vega = 0.0;
};

struct ScreenLeg { int option_index; int qty; };   // qty: +1 买 / −1 卖（合约乘数由 ScreenerParams.multiplier 给出）

struct ScreenMetrics {
    double debit, credit, cost, max_gain, max_loss, rr;
    double net_delta, net_gamma, net_theta, net_vega, avg_iv;
    double model_value;   // BS 理论价（逐腿用各自 IV）
    double edge;          // model_value − cost（正 = 市场便宜）
};

struct StrategyRecord {
    std::string kind;      // "single" | "iron_condor" | "straddle" | "strangle" | "forward_vol"
    std::string direction; // "LONG" | "SHORT"
    std::string expiry;
    std::vector<ScreenLeg> legs;
    ScreenMetrics m;
};

void screen_compute_greeks(std::span<ChainOption> chain, double rate);   // OpenMP；复用 pricing_greeks()
std::vector<int> screen_filter_options(std::span<const ChainOption> chain, const ScreenOptionFilter& f);
void screen_generate_single     (..., std::vector<StrategyRecord>& out);
void screen_generate_iron_condor(..., std::vector<StrategyRecord>& out);   // OpenMP over short_call
void screen_generate_straddle   (..., std::vector<StrategyRecord>& out);
void screen_generate_strangle   (..., std::vector<StrategyRecord>& out);
void screen_generate_forward_vol(..., std::vector<StrategyRecord>& out);   // calendar：同 strike 跨期
void screen_compute_metrics(std::span<const ChainOption>, StrategyRecord&, double spot, double rate);
bool screen_pass_strategy_filter(const StrategyRecord&, const ScreenStrategyFilter& f);
void screen_rank(std::vector<StrategyRecord>&, std::string_view key, bool descending, int top_n); // partial_sort
```

要点：

- 腿只存 `option_index`，不拷贝 `Option`；IC 是 O(n⁴) 的枚举，减少拷贝是主要收益。
- IC 枚举按 `(expiry, short_call)` 外层 `#pragma omp parallel for`，每线程本地 vector，最后合并；**策略级过滤在生成时立刻做**，不先物化全部组合。
- 排序用 `std::partial_sort` 取 top_n，不全排。
- **合约乘数参数化**：原代码把美股的 ×100 写死在 debit / credit / greeks 里，Deribit 一张合约 = 1 BTC（或 1 ETH）。改为 `ScreenerParams.multiplier`，默认 1。
- **OTM / ATM 判断用该到期的 forward**：加密期权各到期的期货价相差可达数个百分点，原代码用单一 spot 判断 IC 短腿、strangle 两腿会选错。
- **Greeks 自己算**：Deribit 的批量接口不带 greeks，逐个 `ticker` 要上千次请求。改为 C++ 用 Black-76 计算（S = forward、q = r，复用 `pricing_greeks()`），OpenMP 并行，千级期权耗时在毫秒量级。
- **成本用可成交价**：买腿按 ask、卖腿按 bid 计 `cost`；缺失一侧报价时该腿不可成交，直接剔除（`ScreenOptionFilter.require_two_sided`，默认 true）。
- **`model_value` 与 `edge`**：用 mark_iv 算出的理论价约等于 Deribit mark price，这样 edge 只剩买卖价差，没有信息量。改为由 `ScreenerParams.model_vol` 选择参考波动率：
  - `"mark"`：逐腿 mark_iv，edge = 价差成本（衡量流动性）
  - `"dvol"`：DVOL 平值波动率，edge 反映 smile 偏离
  - `"surface"`：lab 现有 C++ 双线性插值曲面
  - `"heston"`：先跑现有 Heston 校准，再用校准参数定价（edge = 相对模型的贵 / 便宜）

  这一列是"筛选 + 定价"合并后才有的新指标。

### Engine 层

```cpp
// engine.h
struct ScreenerParams {
    double spot = 0.0, rate = 0.0;
    double multiplier = 1.0;               // Deribit: 1 张 = 1 BTC / 1 ETH
    std::string model_vol = "mark";        // mark | flat | surface | heston | none
    double model_vol_flat = 0.0;           // model_vol == "flat" 时使用（DVOL 走这里）
    std::vector<ChainOption> chain;
    ScreenStrategyToggles strategies;   // single_calls / iron_condors / straddles / strangles / forward_vols
    ScreenOptionFilter    option_filter;  // min_volume, min_oi, min_price, expiry, days_to_expiry_range, volume_ratio_range,
                                          // max_bid_ask_spread（改为相对 mark 的百分比，绝对值在 BTC 价位下无意义）,
                                          // moneyness_range（K/F）, require_two_sided
    ScreenStrategyFilter  strategy_filter; // direction, debit/credit/gain/loss/rr/delta/theta/vega/iv ranges, min_edge
    std::string rank_key = "rr";          // rr | gain | loss | cost | credit | edge
    bool   rank_desc = true;
    int    top_n = 20;
};
ScreenerResult run_screener(const ScreenerParams& p);
```

```cpp
// contracts.h
struct ScreenerResult {
    std::vector<StrategyRecord> top;
    int n_options_in = 0, n_options_after_filter = 0;
    int n_generated = 0, n_passed = 0;
    std::map<std::string, int> generated_by_kind;
    double runtime_ms = 0.0;
    std::string contract_version = "v1.3";
};
```

### ABI 层

- `c_api.h`：`int sf_run_screener_json(const char*, char*, int, int*);`
- `parser.cpp`：`run_screener_json`。JSON 中 `null` 表示该过滤项关闭（与原 config.json 语义一致）。
- 响应里每条策略的 legs 展开成 `{option_type, strike, expiry, qty, mid, iv, delta, ...}`，前端无需再查链。
- **缓冲区**：`run_engine_task` 原本固定 1MB buffer，C ABI 返回 1（buffer 太小）时直接报错。✅ 已补：rc == 1 时按 `out_written` 加余量重新分配，最多重试 3 次；初始容量提为模块常量 `_INITIAL_BUFFER`。top_n 上限为 500。

### CMake

`CMakeLists.txt` 是显式列表（不是 glob，UPGRADE.md 中"glob"的描述已过时），需手动加入：
`src/kernel/screener/*.cpp`、`src/engine/screener_engine.cpp`。

---

## Phase 2 — Deribit 期权链（Python，复用 lab 现有数据源）✅ 已完成

> 实现位置：`server/src/services/market_data.py`（`fetch_option_chain`、`normalize_deribit_chain`、`list_chain_snapshots` / `load_chain_snapshot` / `load_chain_fixture`、`_fetch_spot(currency)` / `_fetch_dvol(currency)`）；fixture 与录制脚本在 `server/fixtures/`；测试 `tests/test_market_chain.py`（12 项离线 + 1 项 `QUANT_LAB_LIVE=1` 实网对比 delta）。
> 实测：BTC 全链 948 个合约 0.35 s、ETH 810 个 0.28 s，各 2 个请求；`fetch_iv_surface()` 原来每个合约单独请求一次（约 84 次），现在复用同一份链数据。
> 与下文设计的差异（均由实测数据决定）：
> - **默认利率用 Deribit 自己的 `interest_rate`（目前为 0），不用国债**：实测 `mark_price × underlying_price` 与 r=0 的 Black-76 一致，delta 与 Deribit ticker 差 < 0.006。用国债利率会让 greeks 和 model_value 与交易所 mark 系统性偏离。国债曲线仍可由调用方传入。
> - **`forward` 取每个到期的中位数**：批量接口不是原子快照，同一到期内 call / put 的 `underlying_price` 有 2–4 个不同值（相差约 0.015%）。USD 换算仍按每行自己的 `underlying_price`（Deribit 计算 mark 用的就是它），建模统一用中位数，避免同一 strike 的 call / put 对 OTM 判断不一致。
> - **spot 取 Deribit 指数（`estimated_delivery_price`）**，随批量接口一起返回，不再额外请求 Binance。
> - **`fetch_iv_surface` / `fetch_iv_smile_slice` 只用实时数据**（`allow_stale=False`）：快照的价格水平可能与当前 spot 不同，失败时与改造前一样返回空。surface 行改为按到期时间排序（原来按 "27JUN25" 这类字符串排序），字段不变。
> - 同时录制了 ETH fixture，ETH 断网时也能回退。
> - 不足 7 天到期的虚值期权，Black-76 复现 mark 的误差可达 2%：mark 的计算时刻与快照时间戳有几秒差，这类期权对时间极敏感。属于数据本身的特性，不是换算错误。
> - 另修了 Phase 1 留下的一个 bug：buffer 扩容重试时正好按引擎报告的大小分配，但重跑生成的响应里耗时字段的位数可能变化，会多出几个字节，导致再次失败（测试中偶发）。现改为扩容时留余量并最多重试 3 次。
> - 顺带发现：原有的国债利率接口单次请求约 17 s（有 1 h 缓存），是 `/api/market/btc` 首次调用慢的主要原因，与本次改动无关，未处理。


不新增数据源。在现有 `market_data.py` 的 Deribit 接入上扩展，支持 BTC 和 ETH。

### 取数方式

现有 `fetch_iv_surface()` 先调 `get_instruments`，再对每个合约单独调 `get_order_book`（每个到期取 7 个 strike，请求数约为到期数 × 7）。全链筛选不能这样拉，改为两个批量请求：

| 接口 | 用途 |
|---|---|
| `public/get_instruments?currency=BTC&kind=option` | strike、option_type、`expiration_timestamp`（已在用） |
| `public/get_book_summary_by_currency?currency=BTC&kind=option` | **一次返回全部期权**的 bid / ask / mark_price / mark_iv / volume / open_interest / underlying_price |

两者按 `instrument_name` join。整条链只需 2 个请求，不会碰到限速。

```python
# market_data.py 新增
async def fetch_option_chain(currency: str = "BTC") -> dict
    # → {"currency", "spot", "fetched_at", "chain": [ChainOption 形状的 dict, ...]}
def normalize_deribit_chain(instruments: list, summaries: list, spot: float) -> list[dict]
```

顺手把 `fetch_iv_surface()` 改为基于 `fetch_option_chain()` 的结果构建，删掉原来的逐合约请求。Pricing / IV 模式的行为不变，但会快很多。

### 规范化（`normalize_deribit_chain`）中必须处理的差异

- **币本位报价**：Deribit 的 bid / ask / mark 以 BTC（或 ETH）计价，需换算成 USD：`price_usd = price_coin × underlying_price`。C++ 侧只接收 USD。
- **用 forward，不用 spot**：`underlying_price` 是该到期的期货价（或合成 forward），逐条写入 `ChainOption.forward`。
- **IV 单位**：`mark_iv` 是百分数，要除以 100。
- **到期时间**：用 `expiration_timestamp`（毫秒）算精确的 `years`，直接复用现有 `_years_to_expiry()`。不用整数天，因为 BTC 有当日到期（0DTE）合约。
- **成交量 / 持仓量单位**：以币为单位，不是合约数。前端过滤器的默认阈值要按 BTC / ETH 分别设定。
- **缺失报价**：没有买单时 `bid_price` 为 null 或 0，统一转成 NaN，交给 C++ 的 `require_two_sided` 处理。
- **深度虚值的 mark_iv 异常值**：mark_iv 不在 (0.05, 5.0) 内时标记为无效。

### 缓存与离线

- 缓存：`~/.quant-lab/chains/{currency}_{yyyymmdd_hhmm}.json`，TTL 默认 60 秒（加密市场 24/7 交易，比美股快照短）。
- 离线 fixture：录制一份 BTC 链快照放进 `server/fixtures/deribit_btc_chain.json`，用于测试和断网演示。断网时 screener 回退到最近一份缓存或 fixture，并在 diagnostics 中标明数据时间，与现有行情降级策略一致。

### 利率与参考波动率

- 利率：复用 `_fetch_rate_curve()` + `pick_rate(years)`。
- 隐含 carry：可从数据反推 `r_implied = ln(F/S) / T`。只作为诊断字段输出（加密 basis 往往远高于国债利率），不作为定价默认值。
- 请求 `model_vol == "dvol"` 时，Python 复用 `_fetch_btc_dvol()` 取值，以 `model_vol="flat"` + `model_vol_flat` 传给引擎；，并扩展参数以支持 ETH（Deribit `currency=ETH` 的 DVOL 同样公开）。

### option-screener 原代码的处置

`tradier.py` 和 `data/pltr.json` 不迁入。移植是否正确靠一次性回归测试来保证：写一个仅供测试的转换脚本，把 `pltr.json` 转成 `ChainOption` 形状（multiplier=100、forward=spot），与原 C++ 版逐条对比（见验收标准）。对比通过后，脚本和数据只留在 `tests/legacy/`，不再维护。

---

## Phase 3 — API 与前端

### 路由（`routes/screener.py`）

| Route | 说明 |
|---|---|
| `GET  /api/tool/screener/chain?currency=BTC&max_days=60` | 拉链 + 规范化，返回 spot、各到期 forward 与 chain（Chain Inspector 用） |
| `POST /api/tool/screener/run` | `{currency | snapshot_id, strategies, option_filter, strategy_filter, model_vol, rank}` → C++ 筛选 |
| `GET  /api/tool/screener/snapshots` | 列出本地缓存快照 |

- Pydantic：`ScreenerRequest`、`ScreenOptionFilterModel`、`ScreenStrategyFilterModel`、`RankModel`。所有区间字段为 `tuple[float, float] | None`。
- 输出走现有 `_record()` 信封；`result_summary` 含漏斗计数（in → filtered → generated → passed → top），前端画成漏斗条。
- `engine_client._TASK_TO_SYMBOL` 注册 `"screener": "sf_run_screener_json"`。

### 联动：Screener → Multi-Leg / Stress

现有 `MultiLegParams` 只有一个全局 `vol` 和 `maturity`。为了让筛出的策略能原样定价：

- `LegSpec` 增加可选 `vol`（缺省用全局 vol）和可选 `maturity`（缺省用全局 maturity），用于 calendar / forward-vol 类跨期策略。
- `run_multi_leg` 逐腿使用自己的 vol / maturity；`strategy_hint` 增加 `iron_condor`、`calendar`。
- 前端：结果表每行一个 **"→ Multi-Leg"** 按钮，把 legs（strike / type / qty / iv / years）写入 Multi-Leg 模式的 legs 编辑器并切换模式；以及 **"→ Stress"** 按钮，以该组合为对象跑压测包。
- Stress 目前针对单期权；组合压测需要 `stress_library.py` 支持 legs 输入（逐腿重定价后求和）。这一项改动最大，可以放在 Phase 3 末尾单独做。

### Workbench

- 新模式按钮 **Screener**：左栏 BTC / ETH 与快照选择、策略类型开关、两组过滤器（option 级 / strategy 级，每项带启用勾选，对应 `null`）、排序键与 top_n。
- 结果区：漏斗计数、Top N 表（kind / legs / cost / max gain / max loss / RR / Δ / Θ / Vega / IV / **edge**）、选中行的到期 payoff 图（复用 `charts.js` 折线）。
- **Chain** 子视图：替代原 inspect.html，按到期分组展示 strike × call/put 的 mid / IV / OI，并画该期 IV smile。
- 涉及文件：`workbench.html`、`runners.js`、`renderers.js`、`charts.js`、`core.js`、`app.js`。

---

## Phase 4 — 补全定价方法（来自 Option-Pricing）

| 方法 | kernel 接口 | 接入点 |
|---|---|---|
| 三叉树 | `double trinomial_price(S,K,r,vol,T,steps,bool is_call,bool american,double q)` | `PricingResult` 新增 `trinomial`；Convergence 增加 trinomial 阶梯；Benchmark 增加一列 |
| LSM 美式 MC | `double lsm_american_price(S,K,r,vol,T,n_paths,n_steps,bool is_call,double q,uint64_t seed,double* out_stderr)` | `is_american=true` 时与 `binomial_american` 并列输出，并给出两者差 |
| 显式 FDM | `pde_price(..., method=2)` | `PdeParams.method` 增加 `"explicit"`；违反稳定条件 `dt ≤ 1/(σ²M² + r)` 时自动加密时间步并在 diagnostics 中提示 |

移植注意：

- 原三叉树的 `p_u / p_d` 直接套了二叉树公式、`m = 1`，概率并非标准三叉树参数（中间概率 `1 − p_u − p_d` 可能为负）。移植时改用 Boyle 标准参数：`u = e^{σ√(3dt)}`，`p_u / p_m / p_d` 按矩匹配公式，并用 BS 与 binomial 交叉验证。
- 原 LSM 用 `std::random_device` 种子、二维 `vector<vector>` 存全部路径、正规方程 + 3×3 高斯消元。移植为：固定 seed（可复现）、单块连续内存（`n_paths × (n_steps+1)`）、路径生成 OpenMP 并行（每线程独立 `mt19937_64`）、可选 antithetic（复用现有 `SamplerType`）；基函数默认 `{1, S, S²}`，预留 Laguerre。
- 原显式 FDM 只有欧式 call，`Smax = 2K` 固定；改为与 `pde.cpp` 一致的网格（`Smax` 由 spot / vol / T 决定）、支持 put 与股息。
- Validation Gate 新增两条检查：`trinomial_vs_bs`（欧式时误差阈值）与 `lsm_vs_binomial_american`（美式时差异阈值）。

---

## Phase 5 — 并发 bench（可选）

`bench/concurrency/` 独立 CMake target，不链接进 `sf_engine_c`：

- `LockFreeQueue`、`RingBuffer` 及其测试原样迁入（去掉 `lf` / `rb` 二进制和 `raw/` 重复版本）。
- 同一个 LSM 任务分别用 **OpenMP / 自写线程池 / 单线程** 跑，输出耗时、峰值 RSS（沿用原 `getrusage` 写法），作为"为什么主引擎选 OpenMP"的依据，写进 README。

---

## 契约版本

- `contract_version` → `"v1.3"`：screener、per-leg vol/maturity、trinomial、LSM、explicit PDE。
- 全部为新增字段 / 新增路由；`PricingResult` 新字段带默认值，旧前端不受影响。

## 验收标准

- 移植回归（`tests/legacy/`）：`pltr.json` 转换后以 multiplier=100 运行，结果与原 C++ 版 `option_screener` 在修复点以外一致（同 config 下 top 10 相同；IC 的 max_loss 因修复而不同，需单独核对）。
- Deribit fixture 上：`screen_compute_greeks` 算出的 delta 与 Deribit `ticker` 接口返回的 delta 抽样对比，误差 < 0.01；USD 换算后的 mark 与 `mark_price × underlying_price` 一致。
- `fetch_option_chain("BTC")` 只发 2 个 HTTP 请求；改造后 `fetch_iv_surface()` 的输出字段与改造前一致。
- IC 全量枚举（BTC 全链，≤ 50 天）运行时间与原 C++ 版对比，在 diagnostics 中记录。
- 三叉树欧式价与 BS 误差随步数收敛，Convergence 的 log-slope ≈ −1。
- LSM 美式 put 与 binomial 美式（2000 步）差 < 1%（10 万路径）。
- 显式 FDM 在稳定条件内与 CN 结果差 < 1e−3。
- 断网时：screener 回退到缓存或 fixture 运行，并在 diagnostics 中标明数据时间；其它所有路由行为不变。

## 建议顺序

Phase 0 → 1 → 2 → 3（不含组合压测）→ 4 → 3 的组合压测 → 5。
Phase 1 与 Phase 4 互不依赖，可以并行。
