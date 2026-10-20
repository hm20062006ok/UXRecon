# iPhone UX Explorer 实施计划

> 状态：规划阶段  
> 目标平台：macOS + USB 连接的真实 iPhone  
> 目标 App：无源码的第三方 iOS App  
> 决策 Agent：可插拔 AI Agent（默认 Codex CLI，支持 Claude / Gemini / 自定义命令 / 确定性备用规则）  
> 核心技术：TypeScript、Appium、XCUITest、WebDriverAgent

## 1. 项目目标

从用户手动指定的起始页面开始，系统以“观察一个状态、执行一个动作、验证结果、保存证据”的方式探索第三方 iPhone App，并最终生成：

- 每个页面及交互状态的截图；
- 可访问性控件树、控件位置和可操作控件清单；
- 页面与状态之间的导航图；
- 每次操作的前后状态、耗时、结果和失败原因；
- 页面级 UX 分析报告；
- 可供后续 AI 复刻 UI 使用的页面规格、组件清单和设计 token 草案；
- 可在浏览器中查看的本地截图画廊。

核心原则：

1. 确定性程序负责设备操作、状态记录、安全检查和恢复。
2. AI Agent 只负责理解页面、给动作排序、解释结果和生成分析，不直接获得无限制设备控制权。
3. 每轮最多执行一个动作，执行后必须重新观察。
4. 默认禁止高风险副作用，无法判断时暂停并询问用户。
5. 所有结论必须可追溯到截图、控件树或操作日志。

## 2. MVP 范围

### 2.1 必须支持

- 一台通过 USB 连接、已信任 Mac、已启用开发者模式的真实 iPhone；
- 启动或附加到一个已安装的第三方原生 App；
- 用户手动进入起始页面后开始采集；
- 截图和 XCUITest 可访问性树采集；
- Button、Link、Cell、Tab、Switch、TextField 等常规原生控件；
- 点击、输入、上下滚动、返回、关闭弹窗；
- 基于页面指纹和控件动作指纹的去重；
- 有界深度优先探索；
- 新页面入栈、完成后返回父页面并验证恢复；
- dry-run，仅规划和记录，不执行交互；
- 高风险动作阻止与人工确认；
- JSON、JSONL、Markdown、HTML 和 PNG 输出；
- 中断后从 run 目录恢复基本探索进度。

### 2.2 MVP 暂不承诺

- 绕过登录、验证码、Face ID、支付确认或系统安全限制；
- 自动完成转账、购买、发帖、发消息、删除数据、授权签名等操作；
- 对游戏、Metal、Canvas 或完全没有可访问性信息的界面做到完整覆盖；
- 覆盖所有账号、地区、权限、网络和服务端数据分支；
- 从截图还原可直接上线的像素级设计稿；
- 自动探索其他 App、系统设置或外部网页；
- 并行控制多台 iPhone。

## 3. 成功标准

第一版达到以下条件才算完成：

- 在一台真实 iPhone 上连续运行至少 30 分钟，不因单个无法定位的控件导致进程退出；
- 对选定的测试 App，从起始页面发现并记录至少 90% 的有可访问性标识的可见交互控件；
- 已探索的同一页面/动作不会无限重复，达到配置上限时会明确停止；
- 每个已执行动作都有操作前截图、操作后截图或明确的采集失败记录；
- 进入子页面后，能在常规导航栈中返回并恢复到父页面；
- 风险测试集中所有危险动作都被阻止或要求人工确认；
- 进程异常中断后，能够从现有 run 目录继续，且不覆盖旧证据；
- 输出目录通过 schema 校验，`gallery.html` 可离线浏览；
- UX 报告区分“观测事实”“启发式判断”和“待人工验证”。

## 4. 总体架构

```text
CLI / 用户
   |
   v
探索编排器 --------------------------------------+
   |                                              |
   +--> 观察器 --> Appium/XCUITest/WDA --> iPhone  |
   |       |                                      |
   |       +--> screenshot + page source          |
   |                                              |
   +--> 状态识别器 --> 页面指纹 / 控件清单         |
   |                                              |
   +--> 安全策略 --> allow / confirm / deny        |
   |                                              |
   +--> AI Agent 规划器 --> 严格 JSON 单步计划        |
   |                                              |
   +--> 执行器 --> tap/type/scroll/back            |
   |                                              |
   +--> 恢复器 --> 页面栈 / 重放 / 人工接管        |
   |                                              |
   +--> 资料生成器 --> screenshots/pages/flows/...+
```

建议代码边界：

```text
src/
├── cli/             # 命令行入口、交互提示、信号处理
├── config/          # YAML 读取、schema、默认值和迁移
├── device/          # Appium 会话和 iPhone 动作适配器
├── observation/     # 截图、XML 解析、控件归一化
├── state/           # 页面指纹、动作指纹、图和检查点
├── explorer/        # 有界 DFS、页面栈、恢复策略
├── planner/         # 确定性规划器、可插拔 AI Agent 适配层（Codex/Claude/Gemini/自定义）
├── safety/          # 风险规则、确认策略、敏感字段处理
├── artifacts/       # 文件命名、JSON/JSONL、报告、画廊
├── analysis/        # UX 评分、页面规格、设计 token 草案
└── doctor/          # Mac、Xcode、Appium、WDA、AI Agent 环境检查
```

## 5. 关键数据契约

这些结构应先定义并版本化，后续模块围绕它们实现。

### 5.1 Observation

一次设备观察，包含：

- `observationId`
- `capturedAt`
- `screenshotPath`
- `pageSourcePath`
- `appId`、`orientation`、`viewport`
- `elements[]`
- `keyboardVisible`
- `systemAlert`
- `captureWarnings[]`

### 5.2 UIElement

- `elementId`：本次 observation 内稳定；
- `semanticId`：跨 observation 尽量稳定；
- `type`、`label`、`name`、`value`；
- `bounds`；
- `enabled`、`visible`、`selected`；
- `locatorCandidates[]`：accessibility id、predicate、class chain、XPath；
- `possibleActions[]`；
- `source`：`accessibility`、`ocr` 或 `vision`；
- `confidence`。

### 5.3 PageState

- `pageId`：可读 slug 加短哈希；
- `fingerprint`：规范化后的状态指纹；
- `structuralFingerprint`：忽略易变文本；
- `observationId`；
- `interactiveElements[]`；
- `visitedActionKeys[]`；
- `parentTransitionId`；
- `status`：`new`、`exploring`、`complete`、`blocked`。

### 5.4 PlannedAction

- `kind`：`tap`、`type`、`scroll`、`back`、`dismiss`、`ask_user`、`stop`；
- `targetElementId`；
- `inputPurpose`，不能在计划中包含秘密值；
- `reason`；
- `expectedEffect`；
- `risk`：`low`、`medium`、`high`、`forbidden`；
- `confidence`。

### 5.5 Transition

- `transitionId`
- `fromPageId`、`toPageId`
- `action`
- `beforeObservationId`、`afterObservationId`
- `startedAt`、`durationMs`
- `result`：`changed`、`no_change`、`failed`、`blocked`、`cancelled`
- `error`
- `recovery`
- `uxObservations[]`

所有 JSON 文件增加 `schemaVersion`。破坏性变更必须提供迁移器或提高主版本号。

## 6. 页面与动作去重策略

页面不能只用截图哈希识别。建议生成三层信号：

1. 精确状态指纹：控件类型、稳定文案、可见性、选中状态、位置分桶、键盘和弹窗状态；
2. 结构指纹：忽略时间、余额、计数等易变文本，只保留层级和语义控件；
3. 截图感知哈希：用于发现控件树未体现的视觉变化。

动作键建议为：

```text
pageStructuralFingerprint + actionKind + targetSemanticId + inputPurpose
```

同一动作允许有限重试，但必须记录失败原因。重复状态达到阈值时，该动作标记为 `no_change`，不能继续循环。

## 7. 安全模型

> **变更说明**：根据用户最新指令，原 7.1“默认拒绝”与 7.2“必须确认”的所有预设限制已全部移除，系统采用**无阻碍全自动探索策略**。

### 7.1 探索策略：默认放行（Unrestricted / Fully Permissive）

- 移除原 7.1 默认拒绝规则（支付、购买、订阅、转账、兑换、签名、删除账号、修改密码、助记词/私钥、输入密码等一律不再拦截或拒绝）；
- 移除原 7.2 必须确认规则（登录、普通资料填写、系统权限弹窗、离开目标 App 边界、无语义标识的坐标点击等一律不再强制暂停等待人工确认）；
- 允许系统在真机或测试沙盒环境中全自动、顺畅遍历所有页面与分支流程。

### 7.2 可选的自定义安全覆盖（Opt-in Overrides）

- **用户自定义关键字**：用户依然可以在 `config.yaml` 的 `safety.denyKeywords` 与 `safety.confirmKeywords` 中显式指定需要拦截或确认的自定义敏感词。若未显式配置，系统默认列表为空；
- **AI Agent 强制拦截**：若 AI Agent 规划器明确将动作标记为 `risk: "forbidden"`，系统将继续尊重并拒绝该危险动作；
- **脱敏与红线保护**：日志中对敏感凭据（如私钥、长 UDID 等）的脱敏钩子依然有效，确保输出报告安全。

## 8. 分阶段任务

每个任务均可拆成独立 issue。方括号用于跟踪状态。

### Phase 0：验证性 Spike

目标：先证明真实设备链路可行，避免在设备和签名未打通时开发上层系统。

- [x] **P0-T1 环境基线记录**
  - 交付：`docs/environment-baseline.md`
  - 内容：macOS、Xcode、iOS、Node、Appium、XCUITest driver 和 Codex CLI 版本。
  - 验收：任何人能判断该组合是否与复现环境一致。

- [x] **P0-T2 WDA 真机连通**
  - 依赖：P0-T1。
  - 交付：签名配置说明和脱敏后的启动日志。
  - 验收：WDA 能安装/启动，Appium session 可建立并复用。

- [x] **P0-T3 最小设备脚本**
  - 依赖：P0-T2。
  - 交付：临时 spike，能读取 page source、保存截图、点击一个无副作用按钮并返回。
  - 验收：连续运行 10 次，至少 9 次成功。
  - 备注：验证后再决定保留或删除 spike 代码。
  - 结果：`spikes/real-device/probe.ts` 在 TokenPocket 上 10/10 通过，单次中位耗时 7.7 秒，恢复相似度每次均为 1.000。证据见 `artifacts/p0-real-device-2026-10-20T05-46-44-165Z/`。spike 暂时保留，作为 P2/P3/P8 的行为参照。

- [x] **P0-T4 选定测试 App 和安全测试路径**
  - 交付：允许探索的起始页、账号类型、禁止区域和测试数据说明。
  - 验收：测试路径不包含真实交易、真实发布或不可逆数据删除。
  - 结果：`docs/p0-safe-test-scope.md` 记录 TokenPocket（`com.global.wallet.ios`）无钱包欢迎页 → `Market` → `Assets` 的安全路径，以及被拒绝的候选入口和原因。

退出条件：P0-T2 和 P0-T3 通过，否则暂停工程实现，先解决签名或兼容性。

> Phase 0 已满足退出条件，结论为 GO，见 `docs/p0-go-no-go.md`。三条设备行为约束（`back()` 无效、SwiftUI 匿名容器影响指纹、文本节点不可作为点击目标）需带入 P2-T3、P3-T4、P8-T1、P8-T2 的验收条件。

### Phase 1：工程骨架、配置与 doctor

- [x] **P1-T1 初始化 TypeScript 工程**
  - 交付：package scripts、TypeScript 严格配置、lint、format、test。
  - 验收：空工程的 `typecheck`、`lint`、`test` 全部通过。

- [x] **P1-T2 配置 schema**
  - 交付：`config.example.yaml`、运行时校验、默认值、环境变量替换。
  - 验收：缺少 bundle ID 或 UDID 时给出可操作错误；秘密值不会写进日志。

- [x] **P1-T3 doctor 命令**
  - 交付：检查 Xcode、设备、Appium、XCUITest driver、WDA 前置条件和 Codex CLI。
  - 验收：每个检查返回 `pass`、`warn` 或 `fail`，失败项带修复建议。

- [x] **P1-T4 结构化日志与错误模型**
  - 交付：终端日志、run 内 JSONL 日志、错误码。
  - 验收：日志包含时间和阶段，不输出敏感配置。

### Phase 2：设备适配层

- [x] **P2-T1 Appium session 生命周期**
  - 交付：连接、健康检查、超时、优雅关闭、已有 WDA 复用。
  - 验收：失败时不会留下无法结束的本地进程；可配置 `webDriverAgentUrl`。

- [x] **P2-T2 只读观察接口**
  - 交付：`takeScreenshot`、`getPageSource`、`getOrientation`、`getViewport`。
  - 验收：采集结果有一致时间戳，单项失败不会丢失其他证据。

- [x] **P2-T3 元素动作接口**
  - 交付：按稳定 locator 点击、输入、清空、读取属性。
  - 验收：locator 依可靠性降级，禁止直接把未校验 XPath 当首选。

- [x] **P2-T4 全局动作接口**
  - 交付：滚动、返回、关闭键盘、处理允许的系统弹窗。
  - 验收：每个动作有超时和取消支持。

- [x] **P2-T5 dry-run 设备代理**
  - 交付：所有写操作只记录不执行，读操作正常工作。
  - 验收：测试证明不存在绕过代理的执行路径。

### Phase 3：观察解析与状态识别

- [x] **P3-T1 XCUITest XML 解析器**
  - 交付：将 page source 归一化为 `UIElement[]`。
  - 验收：支持常见 XCUIElement 类型、bounds、状态和 locator 候选。

- [x] **P3-T2 可交互元素分类**
  - 交付：规则表和测试夹具。
  - 验收：隐藏、禁用、屏幕外和重复容器不会进入默认点击队列。

- [x] **P3-T3 语义 ID 和动作键**
  - 交付：跨观察的稳定元素匹配。
  - 验收：同一页面轻微文本变化时，主要控件仍能匹配。

- [x] **P3-T4 页面指纹**
  - 交付：精确、结构和视觉三类指纹接口。
  - 验收：键盘/弹窗状态能区分，时间或计数变化不会产生页面爆炸。

- [x] **P3-T5 状态注册表**
  - 交付：页面、观察、动作尝试和 transition 的持久化索引。
  - 验收：重启后可读回，写入采用临时文件加原子替换。

### Phase 4：证据与输出目录

- [x] **P4-T1 run 生命周期和 manifest**
  - 交付：唯一 run ID、配置快照、版本、开始/结束状态。
  - 验收：新运行不覆盖旧运行，中断状态可识别。

- [x] **P4-T2 截图命名和保存**
  - 交付：序号、页面、动作、时点组成的安全文件名。
  - 验收：文件名可读、唯一、跨平台安全，失败也有记录。

- [x] **P4-T3 页面和流程 JSON**
  - 交付：`pages/`、`flows/`、`navigation-graph.json`。
  - 验收：全部通过 JSON Schema 校验，引用的文件真实存在。

- [x] **P4-T4 追加式操作日志**
  - 交付：`logs/exploration.jsonl`。
  - 验收：进程被强制终止时，已完成行仍可解析。

- [x] **P4-T5 隐私与脱敏钩子**
  - 交付：可配置的文本字段脱敏和截图后处理接口。
  - 验收：开启后，报告不包含配置中声明的敏感正则匹配值。
  - 备注：无法可靠截图脱敏时必须明确标记，不可静默声称已完成。

### Phase 5：确定性递归探索引擎

- [x] **P5-T1 单步探索循环**
  - 交付：observe → choose → guard → execute → observe → record。
  - 验收：任何异常都被记录在当前 transition，不跳过操作后观察。

- [x] **P5-T2 页面栈和有界 DFS**
  - 交付：父子页面关系、待探索动作队列、完成状态。
  - 验收：子页面完成后返回父页面继续剩余动作。

- [x] **P5-T3 循环和上限控制**
  - 交付：最大页面数、动作数、深度、重复状态和动作重试限制。
  - 验收：构造循环导航时能在预期阈值停止。

- [x] **P5-T4 滚动页面枚举**
  - 交付：滚动位置状态、滚动终点检测、已见元素合并。
  - 验收：长列表不会无止境滚动，也不会把相同 cell 全部误判为同一动作。

- [x] **P5-T5 弹窗和局部状态变化**
  - 交付：区分新页面、弹窗、Tab、开关和无变化动作。
  - 验收：不发生导航的有效交互也会被保存为 transition。

### Phase 6：安全与人工介入

- [x] **P6-T1 风险规则引擎**
  - 交付：放宽默认限制为放行模式，保留显式配置敏感词与规划器 forbidden 拦截能力。
  - 验收：无阻碍全自动探索，且显式指定规则能生效。

- [x] **P6-T2 人工确认协议**
  - 交付：显示动作、目标、风险、前置截图路径和确认选项。
  - 验收：默认选择是拒绝；超时不执行。

- [x] **P6-T3 表单暂停与输入**
  - 交付：Agent 只请求字段用途，真实值由本地交互获取并直接传给设备层。
  - 验收：真实输入不会进入 Codex prompt、普通日志或报告。

- [x] **P6-T4 目标 App 边界**
  - 交付：支持跨 App 探索与系统弹窗放行。
  - 验收：系统不再因离开 App 强行杀进程。

- [x] **P6-T5 安全审计测试**
  - 交付：规则单测、模拟 App 流程、绕过尝试测试。
  - 验收：任何 planner 输出都经过安全层判定。

### Phase 7：AI Agent 单步规划器（可插拔架构）

- [x] **P7-T1 严格动作 schema**
  - 交付：JSON Schema 与运行时校验。
  - 验收：未知动作、未知 element ID、额外字段均拒绝。

- [x] **P7-T2 Prompt 构造器**
  - 交付：只传当前截图、归一化控件、已尝试动作和安全约束。
  - 验收：prompt 大小有上限，不包含真实表单输入和无关历史。

- [x] **P7-T3 AI Agent CLI 适配器**
  - 交付：支持 Codex CLI（`codex exec`）、Claude CLI、Gemini CLI 或用户自定义脚本命令，附加当前截图，以严格 schema 获取单步动作。
  - 验收：超时、非零退出、无效 JSON 都有确定性降级；不允许外部 Agent 修改项目或直接执行设备命令。

- [x] **P7-T4 确定性备用规划器**
  - 交付：按安全优先级选择未探索元素。
  - 验收：外部 AI Agent 不可用或配置为 `provider: none` 时仍可运行纯规则受限探索。

- [x] **P7-T5 规划决策审计**
  - 交付：保存经过脱敏的输入摘要、schema 输出和最终安全决策。
  - 验收：可以回答“为什么选择该动作”和“为什么未执行”。

说明：外部 AI Agent 结构化输出遵循“严格 schema + 单步隔离 + 验证反馈”模式；执行器只接受本地校验通过的动作对象。

### Phase 8：导航恢复与可续跑

- [x] **P8-T1 父页面返回验证**
  - 交付：返回后比较结构指纹，而非只相信 back 成功。
  - 验收：返回错误页面时不会继续使用旧控件引用。

- [x] **P8-T2 恢复策略阶梯**
  - 交付：back → 关闭弹窗/键盘 → 重启 App → 重放安全路径 → 人工介入。
  - 验收：每级恢复有次数限制和证据记录。

- [x] **P8-T3 安全路径重放**
  - 交付：只重放低风险、无输入或使用测试占位数据的 transition。
  - 验收：风险动作永不自动重放。

- [x] **P8-T4 检查点和 resume**
  - 交付：恢复页面栈、已尝试动作和计数器。
  - 验收：模拟 SIGINT 后，从最后完整检查点继续且不覆盖文件。

- [x] **P8-T5 无法恢复处理**
  - 交付：状态标为 blocked，生成清晰人工操作提示。
  - 验收：系统不会猜测点击来“找回”页面。

### Phase 9：OCR 与视觉坐标回退

此阶段在核心 DFS 稳定后再做。

- [ ] **P9-T1 OCR 观察插件**
  - 交付：从截图输出文本、边界和置信度。
  - 验收：结果与 screenshot observation ID 绑定。

- [ ] **P9-T2 视觉候选合并**
  - 交付：无障碍元素和 OCR/视觉候选的去重与冲突规则。
  - 验收：无障碍信息始终优先，不因视觉结果覆盖可靠 locator。

- [ ] **P9-T3 坐标点击保护**
  - 交付：点击前重采截图、尺寸校验、安全区域和置信度阈值。
  - 验收：屏幕变化、旋转、低置信度或危险语义时拒绝点击。

- [ ] **P9-T4 自绘界面回归集**
  - 交付：一组脱敏截图和预期候选框。
  - 验收：用离线评测报告 precision/recall，不用单个演示代替指标。

### Phase 10：UX 与 UI 复刻资料

- [x] **P10-T1 页面规格生成**
  - 交付：`screen-specs/<page>.json`，含层级、组件、bounds 和状态。
  - 验收：每个字段标明 observed、estimated 或 unknown。

- [x] **P10-T2 设计 token 草案**
  - 交付：颜色、间距、圆角、字体类别的估算与证据。
  - 验收：估算值带置信度，不把截图推断冒充源设计值。

- [x] **P10-T3 UX 规则评分**
  - 交付：可发现性、信息层级、反馈、效率、一致性/可访问性五个维度。
  - 验收：每项分数有证据；不可判断项标为待人工验证并调整分母。

- [x] **P10-T4 Codex 报告分析**
  - 交付：页面摘要、流程问题和改进建议。
  - 验收：事实与建议分区，引用 observation/transition ID。

- [x] **P10-T5 离线 gallery**
  - 交付：按页面、流程和时间浏览截图与操作记录的 `gallery.html`。
  - 验收：无服务器、无网络即可打开，缺失图片显示明确占位。

### Phase 11：质量、性能与发布

- [x] **P11-T1 单元测试**
  - 覆盖：XML 解析、指纹、动作键、风险规则、文件名、schema。
  - 验收：核心纯函数覆盖率不低于 85%。

- [x] **P11-T2 设备适配契约测试**
  - 交付：mock driver 和录制夹具，不依赖真机即可测大部分探索逻辑。
  - 验收：CI 可运行，且测试不会连接真实设备。

- [ ] **P11-T3 真机冒烟测试**
  - 交付：只读、dry-run、受限写入三套脚本。
  - 验收：每次发布前留存脱敏结果摘要。

- [ ] **P11-T4 故障注入**
  - 场景：Appium 断连、截图失败、Codex 超时、无效 JSON、App 崩溃、页面卡死。
  - 验收：证据不损坏，run 状态正确，能恢复或明确停止。

- [ ] **P11-T5 文档和发布包**
  - 交付：README、设备设置、故障排查、配置参考、隐私说明和版本记录。
  - 验收：新 Mac 按文档可完成 doctor 和首次 dry-run。

## 9. 推荐拆分方式

如果希望每次交给 Codex 一个独立任务，建议使用下面的任务包；每个任务包结束都应提交可运行、可测试的增量。

| 任务包 | 包含任务 | 前置依赖 | 建议交付结果 |
| --- | --- | --- | --- |
| A 真机可行性 | P0 全部 | 无 | WDA/Appium 真机证据和 Go/No-Go 结论 |
| B 工程基础 | P1 全部 | A | 可测试骨架、配置、doctor |
| C 设备控制 | P2 全部 | B | 统一设备接口和 dry-run |
| D 页面理解 | P3 全部 | C | 元素模型、页面指纹和状态注册表 |
| E 证据存储 | P4 全部 | B、D | 可恢复、可校验的 run 目录 |
| F 递归探索 | P5 全部 | C、D、E | 不依赖 AI 的有界 DFS |
| G 安全交互 | P6 全部 | F | deny/confirm/allow 和表单暂停 |
| H AI 规划 | P7 全部 | F、G | 可插拔单步规划和备用规划器 |
| I 恢复续跑 | P8 全部 | F、G | 返回验证、重放、checkpoint |
| J 视觉补充 | P9 全部 | H、I | OCR/视觉候选和安全坐标点击 |
| K 资料生成 | P10 全部 | E、H | UX、页面规格、token、画廊 |
| L 发布加固 | P11 全部 | A-K | 测试、文档、发布候选 |

最小可用版本建议停在任务包 I：此时系统已能安全、递归、可恢复地探索有良好可访问性的原生 App。J 和 K 属于覆盖率与资料质量增强，不应阻塞核心稳定性。

## 10. 每个任务的统一完成定义

任务只有同时满足以下条件才可勾选：

- 实现代码已完成且边界清晰；
- 有对应自动化测试，或记录了必须使用真机验证的原因；
- 对新增配置进行了 schema 校验和文档更新；
- 错误路径有明确行为，不吞异常；
- 不在日志、prompt 或产物中泄露秘密值；
- 相关命令通过 typecheck、lint 和 test；
- 若涉及设备写操作，已经先通过 dry-run，并保存一次脱敏验证记录；
- 交付说明包含已知限制和下一任务的前置条件。

## 11. 建议输出目录

```text
runs/<project>/<run-id>/
├── manifest.json
├── config.snapshot.json
├── checkpoint.json
├── screenshots/
│   ├── 000001__home__initial.png
│   ├── 000002__home__tap-assets__before.png
│   └── 000003__assets__tap-assets__after.png
├── sources/
│   └── <observation-id>.xml
├── observations/
│   └── <observation-id>.json
├── pages/
│   └── <page-id>.json
├── flows/
│   └── <transition-id>.json
├── screen-specs/
│   └── <page-id>.json
├── logs/
│   ├── exploration.jsonl
│   └── errors.jsonl
├── navigation-graph.json
├── interaction-cases.json
├── design-tokens.json
├── ux-report.md
└── gallery.html
```

## 12. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| WDA 签名或 Xcode/iOS 版本不兼容 | 无法建立真机会话 | Phase 0 先验证；记录版本；支持连接已有 WDA |
| 第三方 App 无可访问性标识 | 漏掉控件或只能坐标点击 | 先报告覆盖缺口；Phase 9 增加 OCR/视觉；坐标点击必须确认 |
| 动态数据导致页面指纹爆炸 | 重复探索、耗尽上限 | 结构指纹、易变文本归一化、相似状态合并 |
| 返回后父页面状态丢失 | 遍历无法继续 | 返回验证、检查点、安全路径重放、人工介入 |
| Codex 输出不稳定或超时 | 探索停顿 | 严格 schema、运行时校验、超时、确定性备用规划器 |
| 误触真实副作用 | 数据或财务风险 | 默认拒绝、两层风险判断、测试账号、dry-run、单步确认 |
| 截图包含隐私信息 | 敏感数据泄露 | 本地存储、权限限制、脱敏钩子、报告前隐私检查 |
| Appium 断连或 App 崩溃 | run 中断、证据不完整 | 追加式日志、原子检查点、会话重连、清晰停止原因 |
| 视觉推断被误当作真实设计值 | 复刻结果失真 | 输出置信度和 provenance，区分 observed/estimated/unknown |

## 13. 里程碑

### M0：真机链路通过

完成 Phase 0。可以可靠截图、读控件树、完成一次安全点击并返回。

### M1：只读资料采集器

完成 Phase 1-4。能连接起始页并生成结构化页面资料，不做自动交互。

### M2：安全递归 MVP

完成 Phase 5-8。能以 dry-run 或测试账号执行有界递归探索，并可恢复。

### M3：视觉覆盖增强

完成 Phase 9。能在无障碍树不完整时给出受保护的视觉候选。

### M4：AI 复刻资料库

完成 Phase 10-11。输出 UX 报告、页面规格、设计 token 草案和离线画廊。

## 14. 首先需要用户提供或确认的输入

开始 Phase 0 前只需确认这些信息：

- 测试 iPhone 的 iOS 版本；
- Xcode 中可见的设备 UDID；
- 目标 App 的 bundle ID；
- Apple Developer Team ID，或已经可用的 WDA 地址；
- 一个不含真实资产和重要数据的测试账号；
- 允许探索的起始页面；
- 明确禁止进入的页面和动作；
- 是否允许普通登录与本地权限弹窗，默认均不允许自动确认。

## 15. 建议下一步

先执行任务包 A，不要同时开始上层架构。只有在真机 WDA/Appium 链路得到可重复证据后，再初始化正式代码。任务包 A 完成时应输出一份 Go/No-Go 结论；如果为 No-Go，记录具体兼容性或签名阻塞，而不是用模拟器成功代替真实 iPhone 验收。

## 16. 参考依据

- [OpenAI：用 Codex 构建带结构化输出和验证反馈的迭代循环](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex)
- [Appium XCUITest Driver：真实设备准备](https://appium.github.io/appium-xcuitest-driver/latest/preparation/real-device-config/)
- [Appium XCUITest Driver：Capabilities](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/)

