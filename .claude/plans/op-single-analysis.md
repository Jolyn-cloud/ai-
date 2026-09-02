# 操作题解析态改"单题解析"

## 背景
操作题（type=operation，含 analysis/comprehensive 同结构）在解析态（交卷/背题已答后）当前是"双份平铺"：
- 题目区 `renderOperationAll`（L1441）：纵向平铺所有子题（题干+选项/填空+对错着色）
- 解析区 `renderAnalysis` ②节（L1566-1585）：又逐子题平铺解析（题干+答案+详解）+ 末尾"整题总评"

而作答态（未交卷）已是分屏 tab（L1397 `renderOperation`）：一次只看一道子题。

PM 拍板（2026-09-02）：解析态也走分屏单题——一次只看一道子题的题干+作答+解析，tab 切换子题时题目和解析同步切；删掉整题总评（`q.analysis`，与各子题解析重复）。

## 改动点

### 1. 做题页.html · renderOperation（L1397-1435）
解析态不再走 `renderOperationAll`，改为复用作答态的分屏结构（stem pane + divider + answer pane + tabs），区别仅：
- 子题作答组件带对错着色（reveal=true 时 `renderSubOptions`/`renderSubFill` 已支持，传 reveal=true 即可）
- 输入框 disabled（reveal=true 时 renderSubFill L1438 已处理）
- 删掉 `if (reveal) return renderOperationAll(q, ans);` 分支，让 reveal 态也走分屏
- tab 的完成态：解析态下用"答对/答错"色替代"已答✓"？——保持简单：解析态 tab 仍标✓（已答），对错在作答区着色体现，不额外加色（避免改 CSS 面）

### 2. 做题页.html · renderAnalysis（L1561-1585）
②解析节操作题分支：
- 删 `q.sub.forEach` 平铺（L1567-1576）
- 改为只渲染当前 `opSubIdx` 子题：题干 + 答案 + 你的答案 + 该子题详解
- 删"整题总评"（L1581 `op-total-ana` 那行）—— 非操作题仍用 `q.analysis` 文本
- ①答题结果行（L1541-1547）保持不变：操作题只显示整体对/错 + 子题答对 N/M

### 3. 做题页.html · renderQuestion（L1335-1338）
`applyOpLayout` 调用条件 `&& !reveal` 去掉 reveal 限制 → 解析态分屏也要校准高度。
即：`if (OP_TYPES.indexOf(q.type) >= 0)` 就调 `applyOpLayout`。

### 4. 做题页.html · renderOperationAll（L1441-1455）
删除该函数（不再被调用）。同时删 CSS `.sub-q`/`.sub-label`/`.sub-stem`（L88-90）若仅此处用——先确认无其它引用再删（grep 确认）。

### 5. 做题页.html · CSS
- `.op-total-ana`（L183 附近）样式可删（无引用）
- `.op-sub-anas`/`.sub-ana` 系列样式：解析区不再平铺，但这些 class 改为单题用，保留（单题解析卡仍用同款样式，只是只渲染一张）
- 分屏 tab 解析态可复用，不动

### 6. 03_PRD.md §五（一.1）判分与交卷展示条款（L482-488）
SSOT 反向改写：
- 旧：「交卷后不再分屏，当作单题解析→平铺全部子题…逐子题列解析卡片+整题总评」
- 新：「交卷/背题已答后**仍走分屏**，与作答态同结构；tab 切换子题时，题目区（题干+作答+对错）与解析区（该子题答案+你的答案+详解）同步切；**不再平铺全部子题**；①答题结果行只显示整体对/错+子题答对 N/M；各子题详解独立成块，**无整题总评**（q.analysis 不再展示）」
- 同步改 L486-487 两条子项
- 变更记录表追加一行（L626 表格下方）

## 不动
- 非操作题（单选/多选/判断/填空/简答）解析逻辑零改动
- 作答态分屏逻辑零改动
- 答题卡 `renderSheet` 零改动（格子仍按整题判定色，点格子跳整题）
- 手势翻整题逻辑零改动
- 数据层（闪卡题库.js / demo 数据）零改动——q.analysis 字段保留在数据里，只是不再展示

## 风险/边界
1. **opSubIdx 跨态保持**：作答时在第3子题，交卷后 opSubIdx 仍是3？——`doSubmit`（L1984）交卷后 `idx=0` 重渲，但未 reset opSubIdx。需在交卷进入解析态时 `resetOp` 或保持当前 opSubIdx。检查：交卷后 `renderQuestion` 对操作题会走分屏，opSubIdx 默认上一次值。**保险起见**：交卷/进解析态时 opSubIdx 归 0（首题子题）。但背题模式逐题看解析时，opSubIdx 应跟随用户在作答态停留的子题——保留当前值更自然。结论：**不强制归零**，跟随用户当前位置；若跨题跳转（jumpTo/nextQuestion）已调 resetOp(true) 归零（L1979），OK。
2. **背题模式操作题**：背题下操作题是否支持"逐子题看解析"？背题 reveal = submitted || (study && studyReveal)，操作题 studyReveal 逻辑 = getAnswered（L1307，操作题任一答即 reveal？）——检查 getAnswered 对 operation 的判定。若背题下操作题作答后整题 reveal，分屏单题解析同样适用，OK。

## 验证
- `_cdp_op_split.mjs` 自动化脚本可能断言旧"平铺"结构——改完同步更新断言
- 手动：做题页进操作题→作答→交卷→解析态验证分屏 tab 切换、题目/解析同步、无整题总评
- 背题模式操作题同验
