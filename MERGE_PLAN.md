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
| QF-205/methods/trinomial.py | Boyle 三叉树（欧式 / 美式，参数正确） | `kernel/pricing/trinomial_lattice.cpp` | ✅ 已移植 |
| QF-205/methods/fd.py | 显式 / 隐式 / CN，美式用 PSOR | `kernel/pricing/pde.cpp` | ✅ 已移植（含 3 处修正） |
| QF-205/methods/{binomial,monte_carlo}.py | CRR 二叉树、欧式 MC | — | lab 已有，只用作对拍基准 |
| QF-205 整个 Python 包 | 全部定价方法 | `tests/reference/`（作为外部依赖调用，不复制源码） | ✅ 对拍测试 `tests/reference/` |
| QF-205/main.py、cli.py、report.md | Tkinter GUI、CLI、课程报告 | — | **丢弃** |
| Option-Pricing/monteCarlo/monteCarlo*.cpp | Longstaff-Schwartz 美式 MC | `kernel/pricing/lsm_american.cpp` | ✅ 已移植（`lsm_american.cpp`） |
| Option-Pricing/explicitFDM.cpp | 显式差分 | — | 被 QF-205 的实现取代（后者支持 put / 美式 / 更合理的网格） |
| Option-Pricing/implicitFDM.cpp | 隐式差分 | — | 已被 pde.cpp θ=1.0 覆盖，不移植 |
| Option-Pricing/trees/binomialTree.cpp | 二叉树 | — | 已有 `binomial_lattice.cpp`，只取剪枝思路做对比 |
| Option-Pricing/Queue/、线程池版 MC | 无锁队列、RingBuffer、线程池 | `bench/concurrency/` | ✅ 已迁入（修正 SPSC / ring buffer 的用法） |

---

## 已完成（Phase 0–5）

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

### Phase 4 — 补全定价方法（QF-205 + Option-Pricing）
- Kernel：`trinomial_lattice.cpp`（Boyle 三叉树 + 通用 CRR 二叉树，均支持股息率和美式）、`lsm_american.cpp`（Longstaff-Schwartz，基函数 {1, S/K, (S/K)²}，固定种子、按固定大小的路径块生成随机数和部分和，结果与线程数无关）、`pde.cpp` 重写为 `pde_solve`（call / put，CN / 隐式 / 显式，美式用 PSOR；显式格式违反稳定条件时自动加密时间步并报告）。
- Pricing：新增 `trinomial`；`is_american` 时输出 `american_methods`（二叉树 / 三叉树 / CN+PSOR / LSM±stderr、提前行权溢价），`american` 字段保持为二叉树结果。PDE 路由支持 put / 美式 / explicit，参照价按情况取 BS 或 1000 步二叉树美式。Convergence 同时给出三叉树的误差曲线和收敛阶；Benchmark 增加 trinomial 一行。Validation 新增 `lattice` 能力（前端 Lattice 开关，默认关闭）。
- 修掉的原有问题：前端选 Put 时 `option_type` 被 pydantic 丢弃，引擎一直按 call 定价；美式二叉树只支持 call；PDE 只支持 call；q≠0 时欧式价格多了 e^{qT} 倍，greeks 把 q 扣了两次，put 的 greeks 用的是 call 的公式；`pricing_bundle` 忽略 `steps` 参数；切到 Sim 后，仍在进行中的 Live 请求返回时会覆盖用户输入。
- 与 QF-205 对拍（`tests/reference/test_qf205_reference.py`，用 QF-205 自己的 venv 运行）：二叉树、三叉树差 2e-13；有限差分修正 QF-205 的边界剩余期限后差 1e-14；美式 PSOR 差 ≤ 6e-4，来自 QF-205 的 PSOR 在边界节点把边界项算了两遍。证据：无股息美式 call 应等于欧式 call，C++ 差 3.5e-10，QF-205 差 2.9e-4。
- 测试：`tests/test_pricing_methods.py`（11 项）。验收数据：三叉树收敛阶 −1.00；LSM（10 万路径）与 2000 步二叉树差 < 1%；美式 PDE 与二叉树差 < 0.5%；显式与 CN 差 5e−4。

### Phase 5 — 并发 bench
- `bench/concurrency/`：独立 CMake 工程，不链接进 `sf_engine_c`，`run.sh` 一键构建并输出表格，结果和结论见其 README。
- LSM 核心抽成与执行器无关的 `engine/src/kernel/pricing/lsm_impl.h`：引擎用 OpenMP 执行器实例化，bench 用单线程和线程池执行器实例化，测的是同一份代码；所有执行器、所有线程数下价格逐位相同。
- 迁入并修正：SPSC 无锁队列（原版的 MPMC 用法有竞争，测试只数条数）、加锁 ring buffer（原版无同步却跨线程使用）、线程池（加 `parallel_for`）。`LockFreeQueue.hpp`（`volatile` 而非原子变量）、编译产物和 `raw/` 副本不迁入。
- 结论（M1 Pro）：OpenMP 与线程池在大规模下持平，小规模下 OpenMP 快约 15%；8 线程时加速比约 4.4 倍，受能效核和内存带宽限制；峰值内存只取决于路径矩阵的大小。SPSC 吞吐约为加锁队列的 1.4 倍。

---

## 契约版本

- `contract_version` → `"v1.3"`：screener、per-leg vol / maturity / forward、trinomial、LSM、explicit / 美式 PDE（均已完成）。
- 全部为新增字段 / 新增路由；`PricingResult` 新字段带默认值，旧前端不受影响。

## 验收标准

- ✅ Phase 1–3 的各项（移植回归、delta 对比、2 个请求、IV 曲面字段不变、IC 性能、断网回退、screener 路由与前端）均已通过，见上文。
- ✅ Phase 4 各项（三叉树收敛阶、LSM / PDE 对二叉树美式、显式对 CN、QF-205 对拍）均已通过，见上文；美式 PSOR 与 QF-205 的差异由 QF-205 自身 bug 造成，已单独测试说明。

## 建议顺序

全部完成。
