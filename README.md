# Quant Lab

高性能随机金融工具平台（C++ 计算 + FastAPI + 单页 Workbench）。

## 项目目标

- 用工具化 API 和统一前端工作台覆盖课程核心计算任务
- 将计算密集部分下沉到 C++，保留 Python 负责编排和服务化
- 提供可重复运行、可比较、可验证（Validation Gate）的计算流程

## 目录结构

- `engine`：C++ 计算层（定价/树模型/对冲/统计等）
- `server`：FastAPI 服务层（`/api/tool/*`）
- `static`：单页前端工作台（`workbench.html`）

## 当前前端形态

- 单入口：`static/workbench.html`
- Workbench 三列布局：
  - 参数区
  - 模式区
  - 结果区（按需显示）
- Validation 融合：
  - 可选“前置校验”
  - 可选“失败阻断”
  - 输出校验能力、解释与建议动作

## 快速启动

在项目根目录执行：

```bash
./run.sh          # 只启动服务（使用已有的 engine/build）
./run.sh build    # 先以 Release 重新构建 C++ 引擎，再启动服务
```

访问地址：

- Web：`http://127.0.0.1:8000/`
- API 文档：`http://127.0.0.1:8000/docs`
- 健康检查：`http://127.0.0.1:8000/api/health`

## 构建 C++ 引擎

```bash
./run.sh build
```

Debug 构建（直接调用 CMake）：

```bash
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Debug
cmake --build engine/build -j
```

主要产物：

- `engine/build/libsf_engine.a`
- `engine/build/libsf_engine_c.dylib`（Python 调用）

### macOS OpenMP 说明

- 优先使用 Homebrew LLVM（`/opt/homebrew/opt/llvm/bin/clang++`）
- 若不可用则回退系统编译器，可能降级为单线程

## API（当前主线）

- `POST /api/tool/pricing/run`
- `POST /api/tool/pricing/batch`
- `POST /api/tool/simulation/run`
- `POST /api/tool/scenario/run`
- `POST /api/tool/hedging/run`
- `POST /api/tool/stats/run`
- `POST /api/tool/ito/run`
- `POST /api/tool/measure/run`
- `POST /api/tool/measure/compare`
- `POST /api/tool/pde/run`
- `POST /api/tool/convergence/run`
- `POST /api/tool/benchmark/run`

## 技术状态（简述）

- 前端：已收敛为单页 Workbench（不再维护多页面入口）
- 后端：以 `/api/tool/*` 为唯一主线
- 计算层：核心计算已对接 C++ 动态库
- Validation：已融合进 Compute 运行流程（前置校验/阻断）

