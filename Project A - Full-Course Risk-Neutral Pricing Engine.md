# Project A：Risk-Neutral Pricing Engine（高信息密度重写版）

## 1) 当前系统定义（As-Built）

本项目当前形态是**单工作台 + 三层计算架构**，定位为课程知识工程化落地平台，而非演示页。

- 目录结构：`engine`（C++计算）、`server`（FastAPI编排）、`static`（单页Workbench）
- 运行入口：`./run.sh`（自动构建C++、修复venv、占用端口自动清理、启动API+静态站点）
- 计算主线：`/api/tool/*`
- 交互主线：统一参数 -> 选择运行卡片 ->（可选）Validation Gate -> 结果区按需显示

---

## 2) 架构与职责

### 2.1 `engine`（C++）

目标：承担数值密集型核心计算，提供可被 Python 调用的 C ABI 动态库。

覆盖能力（当前）：
- 定价：Black-Scholes、Monte Carlo、Binomial、American Binomial、Digital Call
- PDE：隐式/Crank-Nicolson 定价
- 测度：P/Q 对比、风险中性密度路径
- 模拟：Brownian / Vasicek 路径
- 对冲：Delta hedging 误差统计与分布
- 统计/Itô 校验：矩、期望差异检查

### 2.2 `server`（FastAPI）

目标：做参数校验、任务编排、统一响应记录，不承担重计算。

关键设计：
- 统一响应 `_record`：`run_id / tool_name / input_params / result_summary / result_details / diagnostics / created_at`
- 统一诊断 `_diag`：`compute_ms / engine_available / threads / notes`
- 路由聚合：按 `pricing`、`hedging`、`validation` 拆分模块并汇总

### 2.3 `static`（Workbench）

目标：单页高密度工作台，避免多页跳转与重复入口。

当前交互特征：
- 三列布局（参数/控制/结果）
- 控制区集中运行（全选/清空/运行选中）
- 结果区按需展示（无结果不显示卡片）
- 参数和模式状态本地缓存（刷新不丢）

---

## 3) Compute 主工作流

1. 在参数区统一输入（定价、PDE、测度、统计、模拟、对冲等）
2. 在控制区选择要执行的卡片（可多选）
3. 选择模式开关（定价单次/批量，测度PvsQ/RN，融合模式）
4. 可选执行 Validation Gate：
   - 前置校验（advisory）
   - 失败阻断（blocking）
5. 顺序执行选中任务并在结果区渲染

---

## 4) API 清单（当前有效）

- `POST /api/tool/pricing/run`
- `POST /api/tool/pricing/batch`
- `POST /api/tool/scenario/run`
- `POST /api/tool/hedging/run`
- `POST /api/tool/simulation/run`
- `POST /api/tool/stats/run`
- `POST /api/tool/ito/run`
- `POST /api/tool/measure/run`
- `POST /api/tool/measure/compare`
- `POST /api/tool/pde/run`
- `POST /api/tool/convergence/run`
- `POST /api/tool/benchmark/run`

补充：
- `GET /api/health`
- `GET /` -> 重定向 `/workbench.html`

---

## 5) 课程知识点映射（Session 1-9）

| Session | 理论主题 | 平台对应能力 |
|---|---|---|
| 1-2 | 概率/统计基础 | `stats/run`（均值、方差、MGF），参数合法性约束 |
| 3 | 离散过程与树模型 | `pricing/run` 中 Binomial，`convergence/run` 收敛阶梯 |
| 4 | 布朗运动 | `simulation/run`（Brownian path） |
| 5 | Itô 微积分 | `ito/run` + Validation 中 expectation gap |
| 6 | SDE 数值 | Brownian/Vasicek 路径与离散稳定性检查 |
| 7 | Girsanov/测度变换 | `measure/run` 与 `measure/compare`（P vs Q） |
| 8 | 风险中性定价 | 定价多方法并列 + benchmark 统一比较 |
| 9 | 动态对冲 | `hedging/run` + 分布统计指标 |

---

## 6) Validation 融合策略（Model Lab 服务 Compute）

当前不是独立“演示模块”，而是 Compute 的质量闸门：

- 能力来源：
  - Stats：样本矩与目标矩误差
  - Itô：期望差异
  - Simulation：终值有限性
- 产出形式：
  - `gate_decision`（go / warning / blocked）
  - `checks_total / checks_failed`
  - `blocking_reason`
  - 可执行建议（action）

意义：把“课程验证”转成“计算前置质量控制”，减少无效重算。

---

## 7) 结果解释标准（Result Semantics）

结果区不是只显示数值，应优先回答 3 个问题：

1. **算出来了什么**：核心价格/误差/分布/路径指标  
2. **是否可信**：method spread、boundary sensitivity、validation pass/fail  
3. **如何行动**：是否需要增大步数、路径数、或切换模式

当前已体现：
- 定价：多方法价格 + greeks +误差分解 + 稳定性标签
- 情景：相对 base 的差值与比例
- PDE：价格 + 边界敏感度 + 稳定性等级
- 测度：P/Q 漂移与终端统计对比
- 收敛：step ladder 全表
- benchmark：精度-耗时横向比较

---

## 8) 性能路径（现状与下一步）

### 8.1 现状
- C++ 动态库已接入，Python 层仅编排
- 支持线程控制指标回传（diagnostics）
- 批量定价支持单次批处理调用

### 8.2 下一步（工程优先级）
- 基准测试固化：固定输入集 + 固定线程组 + 版本对比
- 批处理扩展：更多工具支持 batch
- 稳定性阈值外置：把 Gate 阈值参数化（便于课程/生产双模式）

---

## 9) 运行与构建（对齐现目录）

```bash
cd "/Users/hang/Downloads/Y3S2/stochastic fin/quant-lab"
./build_cpp.sh
./run.sh
```

访问：
- Web: `http://127.0.0.1:8000/`
- Docs: `http://127.0.0.1:8000/docs`
- Health: `http://127.0.0.1:8000/api/health`

---

## 10) 交付定义（当前版本）

当前交付物定义为：

- 一个可直接运行的随机金融计算平台（非演示页）
- 一套统一且可扩展的工具化 API
- 一条“参数-校验-计算-解释”的闭环工作流
- 一份与代码现状一致的高密度工程文档（本文）
