# Quant Lab — 合并设计（option-screener + Option-Pricing + QF-205）

> 基线：ASIS.md（quant-lab 现状）、UPGRADE.md（分层与传播链约定）。
> 本文描述把 `option-screener`（C++ 版）、`Option-Pricing` 和 `QF-205`（Python 期权计算器）并入 quant-lab 后要做什么、落在哪一层、各层契约怎么改。

---

## 目标

合并后形成一条闭环工作流：

```
Deribit 公开 BTC / ETH 期权链（lab 现有数据源，无需 token）
  → Screener：过滤 → 穷举组合 → 策略级过滤 → 排序
    → 一键送入 Multi-Leg 定价（市场价 vs 模型价 = edge）
      → 一键送入 Stress / Hedging（压测、对冲）
```

同时把 Option-Pricing 与 QF-205 里 quant-lab 尚缺的定价方法补进 kernel，并接入 Benchmark / Convergence 对比。

## 不变的原则

沿用 UPGRADE.md 的三层约定，不例外：

- **C++ engine**：所有数值计算（包括 screener 的过滤、枚举、排序）。无 I/O。
- **Python server**：拉取行情（Deribit）、校验、路由、注解。不做数值。
- **Browser**：渲染与流程编排。

传播链不变：`kernel → engine → contracts.h → c_api + parser → engine_client.py → routes → request_models.py → workbench`。

## 来源 → 去向总览

| 来源 | 内容 | 去向 | 处理 |
|---|---|---|---|
| option-screener/cpp | Option / Filter / Generator / Strategy / Factory | `engine/src/kernel/screener/` + `engine/src/engine/screener_engine.cpp` | ✅ 已移植 |
| option-screener/python/algo.py + `ForwardVolsGenerator` | forward vol 扫描 | `kernel/screener/strategies.cpp` | ✅ 已补写为 calendar |
| option-screener/tradier.py | Tradier 拉链 | — | **丢弃**，改用 lab 现有 Deribit 数据源（见 Phase 2） |
| option-screener/main.py + inspect.html | Chain Inspector | Workbench "Chain" 视图 | 重写为前端模式，不保留独立页面 |
| option-screener/python/ | Python 版 screener | — | **丢弃**（只保留 C++） |
| Option-Pricing/trees/trinomialTree.cpp | 三叉树（滚动存储） | `kernel/pricing/trinomial_lattice.cpp` | 只取滚动存储写法；概率参数有误，以 QF-205 为准 |
| QF-205/methods/trinomial.py | Boyle 三叉树（欧式 / 美式，参数正确） | `kernel/pricing/trinomial_lattice.cpp` | **主要来源**，移植为 C++ |
| QF-205/methods/fd.py | 显式 / 隐式 / CN，美式用 PSOR | `kernel/pricing/pde.cpp` | 显式差分与**美式 PSOR** 以它为准（lab 的 PDE 目前没有美式） |
| QF-205/methods/{binomial,monte_carlo}.py | CRR 二叉树、欧式 MC | — | lab 已有，只用作对拍基准 |
| QF-205 整个 Python 包 | 全部定价方法 | `tests/reference/`（作为外部依赖调用，不复制源码） | **数值基准**：Phase 4 的 C++ 结果与它逐项对拍 |
| QF-205/main.py、cli.py、report.md | Tkinter GUI、CLI、课程报告 | — | **丢弃** |
| Option-Pricing/monteCarlo/monteCarlo*.cpp | Longstaff-Schwartz 美式 MC | `kernel/pricing/lsm_american.cpp` | 移植，并行改 OpenMP |
| Option-Pricing/explicitFDM.cpp | 显式差分 | — | 被 QF-205 的实现取代（后者支持 put / 美式 / 更合理的网格） |
| Option-Pricing/implicitFDM.cpp | 隐式差分 | — | 已被 pde.cpp θ=1.0 覆盖，不移植 |
| Option-Pricing/trees/binomialTree.cpp | 二叉树 | — | 已有 `binomial_lattice.cpp`，只取剪枝思路做对比 |
| Option-Pricing/Queue/、线程池版 MC | 无锁队列、RingBuffer、线程池 | `bench/concurrency/` | 独立 bench，不进主流程 |

---

## 已完成（Phase 0–3）

### Phase 0 — 仓库准备
README 改为相对路径与 `./run.sh build`；UPGRADE.md 的 "glob" 描述改正（CMake 是显式列表）。源码按模块移植，文件头注明来源 commit。

### Phase 1 — Screener 引擎（C++）
- 代码：`engine/src/kernel/screener/`、`engine/src/engine/screener_engine.cpp`、`parser.cpp::run_screener_json`、ABI `sf_run_screener_json`、`engine_client.screener()`。请求 / 响应字段以 `parse_screener_params()` 为准，`contract_version` 为 v1.3。
- 关键设计：腿只存期权索引；IC 按 (到期, 短 call) 用 OpenMP 并行；策略级过滤在生成时完成，只保留 top-N（有界缓冲，按 seq 打破平局，结果与线程数无关）；OTM 判断用各到期 forward；greeks 由 Black-76 自算；成本按可成交价（买 ask / 卖 bid），`price_mode=mid` 可切回原版语义；合约乘数可配，默认 1。
- `model_vol`：`mark | flat | surface | heston | none`（DVOL 由 Python 取值后以 `flat` 传入），决定 `model_value` 与 `edge = model_value − cost`。
- 修掉的原版问题：过滤器改写共享数据、direction 为空时抛异常、IC 的 max_gain / max_loss 用毛权利金且只算 call 翼、卖出单腿 max_loss 为负、IC 忽略 direction（现 SHORT = 反向 IC）、缺 `rank("credit")`、forward vol 只有 Python 版（现为可交易 calendar）。
- `engine_client`：buffer 不够时按引擎报告的大小加余量重试（最多 3 次）。
- 测试：`tests/test_screener.py`（21 项）；`tests/legacy/test_legacy_regression.py` 与原二进制逐条对比 5 组配置，全部一致。PLTR 全链约 204 万个 IC：原版 ~8 s，移植版 ~12 ms。

### Phase 2 — Deribit 期权链
- 代码：`market_data.py` 的 `fetch_option_chain(currency)`（BTC / ETH，2 个批量请求：`get_instruments` + `get_book_summary_by_currency`）、`normalize_deribit_chain`、快照 `list_chain_snapshots` / `load_chain_snapshot` / `load_chain_fixture`；fixture 与录制脚本在 `server/fixtures/`。
- 规范化：币价 × 该行 `underlying_price` → USD；`forward` 取每个到期的中位数（批量接口非原子快照，同一到期内有 2–4 个略有差异的值）；mark_iv / 100，越界视为无效；到期时间精确到秒；无报价一侧为 null。
- 默认利率用 Deribit 的 `interest_rate`（目前为 0），与交易所 mark 对齐（实测 delta 差 < 0.006）；spot 取 Deribit 指数；每个到期输出 `implied_carry` 作为诊断字段。
- 缓存：内存 60 s；磁盘 `~/.quant-lab/chains/`（`QUANT_LAB_HOME` 可改），每个币种保留 20 份。断网时依次回退到最新快照、fixture，`source` 字段注明来源。
- `fetch_iv_surface` / `fetch_iv_smile_slice` 改为复用期权链数据（原来约 84 个请求，现在 2 个），只用实时数据，字段不变。
- 实测：BTC 948 个合约 0.35 s，ETH 810 个 0.28 s。不足 7 天的虚值期权，Black-76 复现 mark 的误差可达 2%（时间戳差几秒造成），属于数据特性。
- 测试：`tests/test_market_chain.py`（12 项离线；`QUANT_LAB_LIVE=1` 时额外做实网 delta 对比）。需用 `server/.venv/bin/python` 运行。
- 未处理：原有的国债利率接口单次请求约 17 s，是 `/api/market/btc` 首次调用慢的主要原因。

### Phase 3 — API 与前端
- 路由（`routes/screener.py`）：`POST /api/tool/screener/run`（`currency` 或 `snapshot_id`）、`GET /api/tool/screener/chain?currency&max_days&snapshot_id`、`GET /api/tool/screener/snapshots`。非实时数据会在 `diagnostics.notes` 里注明来源和时间。
- `model_vol`：`mark | dvol | flat | surface | heston | none`。`dvol` 由路由取 DVOL 后以 `flat` 传入，取不到时在 notes 里注明用了回退值；`surface` 用同一份链数据构建稀疏 ATM 曲面（`surface_rows_from_chain`，不额外请求）；`heston` 需要显式给参数（不在路由里自动校准）。
- Multi-Leg：每条腿可以单独指定 `vol` / `maturity` / `forward`，带 `forward` 的腿按 Black-76 定价；`strategy_hint` 新增 `iron_condor` / `reverse_iron_condor` / `calendar`。legs 输入框也接受 `{spot, rate, legs}` 形式，用来覆盖全局 spot / rate。
- 组合压测：`StressLibraryRequest.legs` 不为空时，每个场景都对整个组合重新定价；spot 冲击同时作用于各腿的 forward，vol 冲击作用于各腿自己的 vol。对冲引擎只支持单期权，所以组合模式下跳过对冲比较，也不输出 binomial 列。
- Workbench：新增 Screener 模式，含 Strategies / Chain 两个视图。Strategies 视图有漏斗计数、Top N 表、行详情（各腿明细、到期损益图和精确盈亏平衡点）；每行可一键发送到 Multi-Leg 或 Risk（自动切换模式并运行）。Chain 视图有到期列表（含 implied carry）、OTM smile 和期权链表格。Screener 不走 Validation 预检。
- 测试：`tests/test_screener_api.py`（10 项）。已用 Playwright + 系统 Chrome 在真实页面中走通全部流程，无 JS 报错。
- 已知问题：`market_data` 的模块级 httpx 客户端绑定在单个事件循环上，uvicorn 下没有问题；测试中需要 `with TestClient(...)`。

---

## Phase 4 — 补全定价方法（来自 QF-205 与 Option-Pricing）

| 方法 | kernel 接口 | 接入点 |
|---|---|---|
| 三叉树 | `double trinomial_price(S,K,r,vol,T,steps,bool is_call,bool american,double q)` | `PricingResult` 新增 `trinomial`；Convergence 增加 trinomial 阶梯；Benchmark 增加一列 |
| LSM 美式 MC | `double lsm_american_price(S,K,r,vol,T,n_paths,n_steps,bool is_call,double q,uint64_t seed,double* out_stderr)` | `is_american=true` 时与 `binomial_american` 并列输出，并给出两者差 |
| 显式 FDM | `pde_price(..., method=2)` | `PdeParams.method` 增加 `"explicit"`；违反稳定条件 `dt ≤ 1/(σ²M² + r)` 时自动加密时间步并在 diagnostics 中提示 |
| 美式 PDE（PSOR） | `pde_price(..., bool american, double omega)` | `PdeParams.is_american`；隐式与 CN 每个时间步用 PSOR 处理提前行权约束；Pricing 的美式结果新增一列 PDE |

移植注意：

- 三叉树以 QF-205 的 Boyle 实现为准（`dx = σ√(3dt)`，`p_m = 2/3`，`p_u / p_d` 按矩匹配，概率为负时报错）。Option-Pricing 的版本直接套了二叉树公式、`m = 1`，中间概率可能为负，只借用它的滚动存储写法。
- 显式与美式 FDM 以 QF-205 为准：网格 `Smax = 4·max(K, S0)`，Thomas 三对角求解，美式用 PSOR（ω = 1.2，容差 1e−8）。移植后检查 PSOR 迭代次数，必要时改为对 CN 更快的 Brennan–Schwartz 直接法。
- **对拍**：`tests/reference/` 以可选依赖方式调用 QF-205（`pip install -e ../QF-205`，未安装时跳过），在同一组参数网格上比较 C++ 与 Python 的三叉树、显式 / 隐式 / CN、美式 PSOR 结果，要求相对误差 < 1e−6（同一算法、同一网格，应只有浮点差异）。
- 原 LSM 用 `std::random_device` 种子、二维 `vector<vector>` 存全部路径、正规方程 + 3×3 高斯消元。移植为：固定 seed（可复现）、单块连续内存（`n_paths × (n_steps+1)`）、路径生成 OpenMP 并行（每线程独立 `mt19937_64`）、可选 antithetic（复用现有 `SamplerType`）；基函数默认 `{1, S, S²}`，预留 Laguerre。
- Validation Gate 新增两条检查：`trinomial_vs_bs`（欧式时误差阈值）与 `lsm_vs_binomial_american`（美式时差异阈值）。

---

## Phase 5 — 并发 bench（可选）

`bench/concurrency/` 独立 CMake target，不链接进 `sf_engine_c`：

- `LockFreeQueue`、`RingBuffer` 及其测试原样迁入（去掉 `lf` / `rb` 二进制和 `raw/` 重复版本）。
- 同一个 LSM 任务分别用 **OpenMP / 自写线程池 / 单线程** 跑，输出耗时、峰值 RSS（沿用原 `getrusage` 写法），作为"为什么主引擎选 OpenMP"的依据，写进 README。

---

## 契约版本

- `contract_version` → `"v1.3"`：screener、per-leg vol / maturity / forward（已完成）；trinomial、LSM、explicit / 美式 PDE（Phase 4）。
- 全部为新增字段 / 新增路由；`PricingResult` 新字段带默认值，旧前端不受影响。

## 验收标准

- ✅ Phase 1–3 的各项（移植回归、delta 对比、2 个请求、IV 曲面字段不变、IC 性能、断网回退、screener 路由与前端）均已通过，见上文。
- 三叉树欧式价与 BS 误差随步数收敛，Convergence 的 log-slope ≈ −1。
- LSM 美式 put 与 binomial 美式（2000 步）差 < 1%（10 万路径）。
- 显式 FDM 在稳定条件内与 CN 结果差 < 1e−3。
- C++ 三叉树、显式 / 隐式 / CN、美式 PSOR 与 QF-205 对拍，相对误差 < 1e−6。
- 美式 PDE 与 binomial 美式（2000 步）差 < 0.5%。

## 建议顺序

4 → 5。
