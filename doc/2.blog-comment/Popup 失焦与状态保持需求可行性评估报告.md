# Popup 失焦与状态保持 — 需求可行性评估报告

## 一、需求归纳

| 需求点 | 描述 |
|--------|------|
| A | 失去焦点后再点回来时，popup **不要自动收起** |
| B | 自动收起后，**运行状态与展示信息不要消失** |
| C | 为 **每个 URL** 保留一份状态信息 |
| D | 只有 **再次点击 popup 按钮** 时才收起；收起时 **不重置** 当前运行状态与展示信息 |

---

## 二、平台约束（Chrome 扩展 Popup）

- Chrome 扩展的 **popup 在失去焦点时会自动关闭**，这是浏览器既定行为，**没有官方 API 可以禁止**。
- 用户点击页面其他区域、切换标签页、点击地址栏等都会导致 popup 失焦并立即关闭。
- 因此：
  - **需求 A（失焦后不自动收起）**：**不可行**。
  - **需求 D 中「只有再次点击 popup 按钮才收起」**：**不可行**（无法改变「失焦即关闭」的机制）。

---

## 三、可行性结论总览

| 需求点 | 可行性 | 说明 |
|--------|--------|------|
| A：失焦后不自动收起 | ❌ 不可行 | 平台限制，无法实现 |
| B：状态不消失 | ✅ 可行 | 通过持久化 + 恢复实现 |
| C：每个 URL 一份状态 | ✅ 可行 | 以 URL/tab 为 key 持久化 |
| D：仅点击按钮才收起且不重置状态 | ⚠️ 部分可行 | 「仅点击才收起」不可行；「收起不重置状态」可行（见 B） |

---

## 四、可行方案说明

### 4.1 状态持久化 + 恢复（满足 B、C、D 中“不重置”）

**思路**：popup 每次打开时都会重新加载页面，内存中的 `blogStatusLine`、`blogStatusMessage`、`commentPageState` 等会丢失。若在**状态变更时写入存储**，并在 **popup 打开时按当前 tab URL 读回**，即可做到「再打开时看到上次的运行状态与展示信息」。

**实现要点**：

1. **存储 key**：以「当前 tab 的 URL」或「hostname + pathname」为 key（与现有 `getCommentCacheKeyForTab` 思路一致），例如 `blog_popup_state_${cacheKey}`。
2. **需要持久化的状态**（建议）：
   - 运行状态栏文案：`blogStatusLine` 的 text（如 "AI 耗时 3.2s · 已填充 4 个字段..."）
   - 结果消息：`blogStatusMessage` 的 type + text（成功/失败/警告及文案）
   - 可选：当前是否处于「进行中」（如生成中/识别中/填充中），用于恢复时禁用按钮或显示 loading
3. **写入时机**：
   - `setBlogStatusLine(text)` 被调用时，顺带写入 storage；
   - `showBlogMessage(message, type)` 被调用时，顺带写入 storage；
   - 若存在「进行中」状态，在流程开始/结束处写入。
4. **恢复时机**：popup 的 `init()`（或 Blog 面板显示时）中，根据 `currentTab` 取 key，从 storage 读取该 URL 的 state，还原 `blogStatusLine`、`blogStatusMessage` 的展示；若有「进行中」状态，可恢复按钮为 loading 或禁用（若 background 有任务可再轮询/拉取结果）。
5. **存储介质**：`chrome.storage.local` 或 `chrome.storage.session`。若希望「仅当前会话、关浏览器即丢」可用 session；若希望多会话间保留可用 local。建议 per-URL 状态用 local，并可按需做条数/大小上限与过期清理。

这样即可实现：
- **B**：自动收起后再打开，运行状态与展示信息仍然存在；
- **C**：每个 URL 一份独立状态；
- **D** 中「收起不重置状态」：收起时不做清除，仅关闭窗口；再打开时从 storage 恢复，相当于不重置。

### 4.2 替代 UI：希望「不因失焦就关闭」（可选）

若产品上强烈希望有一块 **不会因为点击页面就关闭** 的界面，可考虑以下替代方案（不改变需求 A 的不可行性，但可降低对 popup 的依赖）：

| 方案 | 说明 | 可行性 |
|------|------|--------|
| **Side Panel** | 使用 Chrome 的 Side Panel API（MV3，Chrome 114+），侧边栏在切换 tab 时可保持打开，不会因点击页面而关闭 | ✅ 可行，需增加 side_panel 配置与权限，UI 可从现有 popup 迁移或复用 |
| **独立窗口 (Panel/Window)** | 用 `chrome.windows.create()` 打开小窗口或 panel，由用户主动关闭 | ✅ 可行，交互与当前「点击图标打开」略有不同 |
| **Content 内嵌浮层** | 在页面内注入一个浮层 UI，不依赖 popup，关闭逻辑自行实现 | ✅ 可行，需处理与页面样式/布局的兼容 |

以上方案与「状态持久化」可同时做：即使用 Side Panel 或独立窗口，仍建议按 4.1 做 per-URL 状态持久化，以便刷新或重新打开时恢复。

---

## 五、当前代码与状态简要说明

- **导航站模式**：`pageState`、表单识别状态、字段数等，来自 content 的 `getPageState` / `detectForm`，每次打开 popup 会重新拉取，因此本身会「按当前页」更新；若需为每个 URL 保留历史状态，也可做类似持久化。
- **Blog 评论模式**：
  - `blogStatusLine`：运行状态栏（API 耗时、阶段、检查结果），目前仅在内存中，popup 关闭即丢失；
  - `blogStatusMessage`：成功/失败/警告消息；
  - `commentPageState`：评论表单识别状态，部分来自 content 的 `getCommentPageState`，可结合缓存与 storage 做 per-URL 持久化。

上述 Blog 相关状态均为「按 URL 保留状态」的合适对象，与 4.1 的 key 设计一致。

---

## 六、建议实施顺序与实现状态

1. **4.1（状态持久化 + 恢复）— 已实现**  
   - 已实现 per-URL 的 `blogStatusLine`、`blogStatusMessage` 的写入与恢复（`popup.js`：`saveBlogPopupState` / `restoreBlogPopupState`，存储 key：`blog_popup_state_${cacheKey}`，使用 `chrome.storage.local`）。  
   - 写入时机：`setBlogStatusLine`、`showBlogMessage`、`hideBlogMessage` 调用时顺带写入。  
   - 恢复时机：`init()` 中若为 Blog 模式则先 `restoreBlogPopupState()` 再 `tryShowLastVerifyResult()`；切换到 Blog 面板时同样先恢复再处理验证结果。  
   - 不改变 popup 的打开/关闭行为，已满足「状态不消失」「每个 URL 一份状态」「收起不重置」的诉求。

2. **若仍需「不因失焦关闭」的界面**  
   - 再评估 Side Panel 或独立窗口方案，并将现有 popup 逻辑迁移/复用到新 UI。

3. **文档与测试**  
   - 在 README 或 2.blog-comment 下记录：popup 失焦即关闭为平台限制；状态保持依赖持久化与恢复；若采用 Side Panel，在文档中说明使用方式与兼容版本（Chrome 114+）。

---

## 七、结论汇总

- **「失焦后不自动收起」「只有点击图标才收起」**：在标准 popup 下 **不可行**，受 Chrome 平台限制。
- **「状态不消失」「每个 URL 保留状态」「收起不重置状态」**：**可行**，通过 **按 URL 持久化运行状态与展示信息，并在 popup 再次打开时恢复** 即可实现。
- 若希望界面在点击页面后仍不关闭，可另行考虑 **Side Panel** 或 **独立窗口** 等替代 UI，并与上述状态持久化方案结合使用。

以上为需求可行性评估结论与实现建议。
