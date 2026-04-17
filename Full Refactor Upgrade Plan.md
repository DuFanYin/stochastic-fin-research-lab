# Quant Lab 完整升级重构计划（一次性到位版）

> 目标：将当前 `quant-lab` 从“课程型工具集合”重构为“模型驱动、可校准、可验证、可观测、可扩展”的工业级随机金融计算平台。  
> 原则：**不考虑向后兼容**、**不做渐进双轨**、**直接切换到最终架构**。

---

## 1. 最终目标定义（Target State）

重构完成后，系统应具备以下能力：

- **统一模型层**：所有定价/模拟/测度/对冲共用一套模型接口与参数定义
- **统一任务层**：计算任务标准化（输入契约、输出契约、错误模型、诊断信息）
- **统一验证层**：Validation 从“可选”升级为“可配置强制质量门禁”
- **统一实验层**：支持批量实验、基准对比、收敛分析、再现实验

---

## 2. 顶层架构（Final Architecture）

## 2.1 逻辑分层

- `core-domain`：模型、产品、测度、市场状态、风险因子、契约定义
- `core-numerics`：SDE 路径、PDE 求解、树模型、蒙卡引擎、随机数与方差缩减
- `core-validation`：统计检验、数值稳定性检验、模型一致性检验
- `core-experiment`：批量任务、参数网格、收敛实验
- `adapters-engine-cpp`：C++高性能实现 + C ABI 导出
- `adapters-server-api`：FastAPI 编排、鉴权（如需要）、任务调度、结果持久化
- `adapters-frontend`：Workbench（任务配置 + 结果解释 + 报告导出）

## 2.2 单一执行主线

`Request -> Contract Validation -> Model Build -> Numerical Solve -> Validation Gate -> Result Explain -> Persist/Report`

---

## 3. 代码重组方案（Repo Restructure）

建议目录（替换现有散式结构）：

```text
quant-lab/
  engine/
    include/
      domain/
      numerics/
      validation/
      ffi/
    src/
      domain/
      numerics/
      validation/
      ffi/
      infra/
    tests/
  server/
    app/
      api/
      services/
      contracts/
      orchestration/
    tests/
  frontend/
    src/
      app/
      features/
      shared/
      contracts/
  specs/
    api/
    model/
    validation/
  docs/
```

---

## 4. 领域模型重构（Domain Model）

## 4.1 核心实体（必须统一）

- `ModelSpec`：模型类型 + 参数（GBM / LocalVol / Heston / Vasicek ...）
- `ProductSpec`：产品定义（European Call / Digital / American / Barrier）
- `MeasureSpec`：`P / Q / T-forward` 等测度定义
- `SolverSpec`：`MC/PDE/Tree` + 数值参数
- `ValidationPolicy`：规则阈值、阻断策略、告警策略

## 4.2 统一接口（C++）

- `IStochasticModel`：`drift(state,t)`, `diffusion(state,t)`, `step(...)`
- `IPricer`：`price(context) -> PriceResult`
- `IPathSimulator`：`simulate(context) -> PathBundle`
- `IValidator`：`validate(result, policy) -> ValidationReport`

---

## 5. 数值引擎重构（Numerics）

## 5.1 Monte Carlo 引擎

- 统一 RNG 管理（seed、stream、子流、可复现）
- 方差缩减：Antithetic、Control Variate、Moment Matching
- 路径并行：OpenMP + 批任务调度
- 统一误差输出：标准误、置信区间、收敛斜率

## 5.2 PDE 引擎

- CN / Implicit / ADI（多因子预留）
- 边界条件策略对象化
- 网格自适应（可选）
- 数值稳定性报告（CFL-like 指标、边界敏感度）

## 5.3 Tree 引擎

- CRR / JR / Tian 参数化
- 美式早行权策略模块化
- 与 BS/MC 统一误差口径

## 5.4 Measure & SDE

- P/Q 路径模拟统一到同一 drift policy
- Radon-Nikodym 密度输出标准化
- Girsanov 验证项内置

---

## 6. Validation Gate 升级（强制质量系统）

## 6.1 规则体系

- `StatisticalRules`：矩误差、尾部分位差、分布形状约束
- `NumericalRules`：收敛性、单调性、稳定性、离散误差上界
- `ModelConsistencyRules`：PDE vs MC vs BS gap、Greeks sanity
- `RiskRules`：hedge PnL tail / normalized std / stress sensitivity

## 6.2 决策输出

- `decision`: `pass | warn | block`
- `severity`: `info | low | medium | high | critical`
- `root_causes[]`: 失败归因
- `actions[]`: 修复建议（提高 paths / steps、切换 solver、调整模型）

---

## 7. API 重构（Contract-First）

## 7.1 原则

- OpenAPI First：先定义契约再实现
- 严格版本：`/api/v1/...`（不保留旧路由）
- 统一错误模型：`code/message/details/trace_id`
- 统一响应模型：`summary/details/diagnostics/validation/report_ref`

## 7.2 目标接口簇

- `/api/v1/pricing/*`
- `/api/v1/simulation/*`
- `/api/v1/measure/*`
- `/api/v1/hedging/*`
- `/api/v1/validation/*`
- `/api/v1/experiment/*`
- `/api/v1/system/*`

---

## 8. 前端 Workbench 重构（任务中心）

## 8.1 定位

- 从“按钮驱动”升级为“任务配置 + 执行编排 + 分析报告”

## 8.2 功能块

- `Job Builder`：模型/产品/求解器/验证策略可视化配置
- `Run Console`：执行状态、耗时分解、错误弹窗、trace_id
- `Result Studio`：价格、误差、路径、分布、收敛、基准图
- `Experiment Manager`：批量实验、参数扫描、结果比对
- `Report Export`：Markdown/PDF/JSON 输出

## 8.3 前端工程化

- TypeScript + 模块化状态管理
- API 契约类型自动生成
- 全链路错误处理（toast + 卡片内错误 + 诊断面板）

---

## 9. 可观测性与性能工程

## 9.1 观测标准

- 结构化日志（JSON）
- 指标：吞吐、延迟、错误率、阻断率、数值失败率
- Trace：每次 run 全链路 trace_id

## 9.2 性能基线

- 标准输入集 + 标准硬件说明
- 每个 solver 的 latency/error 前沿曲线
- 回归预算（超预算 CI 失败）

---

## 10. 测试与质量门禁（必须满足）

## 10.1 测试矩阵

- 单元测试：域模型、数值核、验证规则
- 契约测试：API 请求/响应 schema
- 数值回归测试：关键场景 golden set
- 端到端测试：前端发起 -> 后端执行 -> 报告输出

## 10.2 Gate 条件

- 覆盖率阈值（例如：核心层 > 90%）
- 数值误差阈值（按产品/模型定义）
- 性能回归阈值（P95/P99）
- lint/type/security scan 全绿

---

## 11. 一次性替换实施清单（No Backward Compatibility）

## 11.1 必删项

- 删除旧路由命名与旧 payload 结构
- 删除 placeholder 模型和散落逻辑
- 删除旧前端模式分叉代码（live/sim 临时拼接式流程）

## 11.2 必改项

- C++ 接口：从函数集合升级到任务上下文输入
- Python 层：从“薄封装函数调用”升级到“orchestration + policy engine”
- 前端：从“按钮即接口”升级到“任务对象执行器”

## 11.3 必增项

- 契约文档（OpenAPI + JSON schema）
- 回归数据集与 benchmark 套件
- 统一错误码表与诊断字典

---

## 12. 交付物定义（Definition of Done）

满足以下条件才算重构完成：

- 新架构目录与模块边界全部落地
- 全量接口切换到 `/api/v1`
- Workbench 基于新契约完整可用
- Validation Gate 强制执行并可配置
- 数值/性能/稳定性测试全部通过
- 文档完整：架构、接口、运行、排障、基准

---

## 13. 风险与应对（一次性重构视角）

- **风险：重构体量大导致交付延迟**  
  应对：严格按模块里程碑验收，先跑通端到端骨架再补全深度能力

- **风险：数值结果偏移**  
  应对：建立 golden set 与容差策略，任何漂移必须归因

- **风险：性能下降**  
  应对：每个阶段绑定 benchmark，对关键热点持续 profile

- **风险：前后端契约错位**  
  应对：类型自动生成 + 契约测试 + CI 强制检查

---

## 14. 推荐执行顺序（完整版单次切换）

1. 先冻结现有分支，建立重构主干分支  
2. 搭建新目录与新契约骨架（domain/contracts/api）  
3. 重写 C++ 模型层与数值层统一接口  
4. 重写 FastAPI orchestration 与 validation policy engine  
5. 重写前端任务编排与结果分析面板  
6. 完成测试矩阵、基准体系、CI Gate  
7. 一次性切换到新系统并移除旧代码

---

## 15. 最终结论

这不是“修补式改造”，而是一次**架构级重建**。  
完成后，`quant-lab` 将从课程演示型平台升级为可持续演进的“知识到工具（Knowledge-to-Tool）”计算引擎，为后续 calibration、risk、portfolio、自动报告与策略实验提供统一底座。
