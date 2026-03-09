# AI 增强解决方案 — 提高评论提交成功率

> 基于当前"程序主控"架构的渐进式增强，不做大规模重构，聚焦于**弹窗处理、元素识别灵活性、流程容错**三个核心瓶颈。

### v2.1 迭代（2026-03-09）

在 v2 基础上新增四项规则，详见 [PRD.md](./PRD.md) FR-3.1、FR-7、FR-8、FR-9：

| 规则 | 说明 |
|------|------|
| **全量填充** | 采集表单全部可填字段，AI 判断尽量填充（含 Nickname、Author 等非常规命名） |
| **登录重定向** | 提交后若跳转登录页，二次 Snapshot + 从飞书表格账号密码缓存查找凭据完成登录，找不到则提醒用户 |
| **验证优化** | 从页面底部向上查找新评论（历史评论可能在上方） |
| **完成判定** | 不到验证提交成功不算完成，仅点提交不验证不标记 success |

---

## 一、现状问题诊断

### 1.1 两套系统割裂，标准流程缺乏弹窗处理

当前存在两条独立的评论提交路径：

| 路径 | 入口 | 弹窗处理 | 元素识别 | 适用场景 |
|------|------|----------|----------|----------|
| **标准流程** (`formHandler.js`) | `blogCommentGenerateAndFill` | ❌ 无 | `<form>` 标签 + `querySelectorAll` + 关键词/AI | 结构规范的评论表单 |
| **完全AI识别** (`fullAiAgent.js`) | `fullAiRunTask` | ✅ 多轮 LLM 弹窗 | DOM Snapshot + 启发式映射 | 非标准表单 |

**问题**：标准流程（也是批量模式的唯一路径）完全没有弹窗处理能力。当页面打开后出现 Cookie/隐私同意弹窗时，表单被遮挡，检测失败，直接返回"找不到form表单"。

### 1.2 表单检测过于依赖 `<form>` 标签

`getCommentFormMetadata()` 以 `document.querySelectorAll('form')` 为起点，如果评论区不在 `<form>` 标签内（如 Disqus iframe、自定义 React 组件、WordPress 某些主题），直接判定"无表单"。

### 1.3 启发式关键词覆盖不足

`fullAiAgent.js` 的 `SLOT_KEYWORDS` 只覆盖了英文和中文：

```javascript
name: ['name', 'author', '姓名', '昵称', 'your name', 'display name'],
email: ['email', 'mail', '邮箱', 'e-mail', 'your email'],
```

遇到日语（名前）、德语（Name/E-Mail）、斯洛文尼亚语（Ime/E-pošta）等页面时全部匹配失败。

### 1.4 流程缺少失败重试与回退

- 标准流程中，如果关键词匹配失败且 AI 也没返回有效映射，直接报错退出
- 完全AI识别中，`buildStepsFromSnapshot` 匹配失败后没有 fallback 到 LLM
- 元素执行时如果 `element_not_found`，不会重新拍 Snapshot 重试

### 1.5 勾选确认项识别不完整

- 标准流程的 `getCommentConsentCheckboxes()` 依赖 DOM `querySelectorAll('input[type="checkbox"]')` + 文本匹配
- 完全AI识别的 `CHECKBOX_KEYWORDS` 范围有限，且不识别非 `<input type="checkbox">` 的自定义勾选组件（如 toggle switch、自定义 div checkbox）

---

## 二、增强策略：统一管道 + 分层容错

### 2.1 核心理念

**不做大改，分层叠加**：在现有两套系统之上增加一个统一的调度层，按优先级尝试多种策略，任一成功即执行。

```
┌─────────────────────────────────────────────────┐
│              统一调度层 (Orchestrator)             │
│                                                   │
│  1. 弹窗预处理（新增，所有流程共享）               │
│  2. 表单检测增强（宽松检测 + Snapshot 检测）       │
│  3. 分层识别：启发式 → AI Snapshot → LLM OneShot  │
│  4. 执行 + 重试（失败时重拍 Snapshot 再匹配）     │
│  5. 提交后验证                                    │
└─────────────────────────────────────────────────┘
```

### 2.2 设计原则

1. **渐进增强**：每个增强点独立可控，可单独开关
2. **最小 LLM 调用**：优先程序识别，LLM 仅作为兜底
3. **模拟人工**：保持按字符输入、随机延迟，不改变执行层
4. **批量兼容**：所有增强必须在批量模式下同样生效

---

## 三、具体增强方案

### 3.1 弹窗预处理层（Priority 1 — 投入小，收益大）

**目标**：在任何评论填充流程开始前，先检测并关闭页面上的遮挡弹窗。

**改动范围**：`fullAiContent.js`（新增纯程序弹窗检测）+ `fullAiAgent.js`（复用已有 `runOverlayDismissLoop`）

#### 方案：程序启发式 + LLM 兜底的两级弹窗处理

**第一级：纯程序检测（不调用 LLM，延迟 < 500ms）**

```javascript
// 常见弹窗特征检测
const OVERLAY_SELECTORS = [
  // Cookie consent 弹窗
  '[class*="cookie"] button[class*="accept"]',
  '[class*="cookie"] button[class*="agree"]',
  '[id*="cookie"] button',
  '[class*="consent"] button[class*="accept"]',
  '.cc-compliance .cc-btn',
  '#onetrust-accept-btn-handler',
  '[data-testid*="cookie-accept"]',
  // GDPR / Privacy
  '[class*="gdpr"] button[class*="accept"]',
  '[class*="privacy"] button[class*="accept"]',
  // 通用关闭按钮（遮挡层上的）
  '[class*="overlay"] button[class*="close"]',
  '[class*="modal"] button[class*="close"]',
  '[role="dialog"] button[class*="close"]',
  '[role="dialog"] button[class*="accept"]',
];

const OVERLAY_BUTTON_TEXT = [
  /accept\s*(all)?/i, /agree/i, /allow\s*(all)?/i,
  /got\s*it/i, /i\s*understand/i, /ok(ay)?/i,
  /同意/i, /接受/i, /允许/i, /确定/i, /我知道了/i
];
```

检测逻辑：
1. 遍历 `OVERLAY_SELECTORS`，找到可见的匹配元素直接点击
2. 如果选择器没匹配到，扫描所有 `position:fixed` 或 `position:sticky` 且 `z-index > 100` 的元素，在其内部查找文本匹配 `OVERLAY_BUTTON_TEXT` 的按钮
3. 点击后等待 800ms，检查弹窗是否消失（该 fixed 元素是否 `display:none` 或已从 DOM 移除）
4. 最多 2 轮

**第二级：LLM 辅助（仅在第一级无效时触发）**

复用现有 `runOverlayDismissLoop` 的 Snapshot + LLM 方案，但缩短超时（10s/轮），最多 1 轮。

#### 接入方式

在 `blogCommentGenerateAndFill` 和 `executeBatchTask` 流程**最前面**插入弹窗预处理调用：

```
[页面加载完成]
    ↓
[弹窗预处理] ← 新增
    ↓
[表单检测]（现有逻辑）
    ↓
[字段识别 + 评论生成 + 填充]
```

---

### 3.2 表单检测增强（Priority 1）

**目标**：解决"评论区不在 `<form>` 标签内"和"页面已不允许评论"两种场景。

#### 3.2.1 宽松表单检测

在现有 `getCommentFormMetadata()` 返回 `hasForm: false` 时，不直接放弃，增加 Snapshot 辅助检测：

```
getCommentFormMetadata()
    ↓ hasForm=false
[Snapshot 快速检测] ← 新增
    ↓ 在 Snapshot 中搜索 role=textbox 且 name 含 comment/reply/message 的节点
    ↓ 如果找到，说明有评论区但不在 <form> 内
    ↓ 如果没找到，确认该页面不可评论，提前结束
```

#### 3.2.2 页面是否可评论的快速判断

在 Snapshot 中搜索以下特征，如果全部缺失则判定"页面不可评论"并提前终止：

- 任何 `role=textbox` 的节点（textarea、input[type=text]）且 name/placeholder 含评论相关关键词
- 任何 "Comment"、"Leave a Reply"、"评论"、"コメント" 等标志文本
- 含 `id=respond` 或 `class*=comment-form` 的容器

**收益**：快速跳过已关闭评论的页面，避免在批量模式下浪费时间。

---

### 3.3 元素识别增强（Priority 1）

**目标**：提升启发式关键词匹配的多语言覆盖和准确率。

#### 3.3.1 扩展多语言关键词库

```javascript
const SLOT_KEYWORDS_ENHANCED = {
  name: [
    // English
    'name', 'author', 'your name', 'display name', 'full name',
    // Chinese
    '姓名', '昵称', '名字', '称呼',
    // Japanese
    '名前', 'なまえ', 'お名前',
    // German
    'Name', 'Ihr Name',
    // Slovenian / Czech / Slovak
    'Ime', 'Jméno', 'Meno',
    // French / Spanish / Portuguese / Italian
    'Nom', 'Nombre', 'Nome',
    // Korean
    '이름',
    // Russian
    'Имя',
  ],
  email: [
    'email', 'e-mail', 'mail', 'your email', 'email address',
    '邮箱', '电子邮件', 'メール', 'メールアドレス',
    'E-pošta', 'E-mail', 'Correo', 'Courriel', 'Email-Adresse',
    '이메일', 'Эл. почта',
  ],
  website: [
    'website', 'url', 'site', 'web', 'homepage', 'your website', 'blog',
    '网址', '链接', '网站', 'ウェブサイト', 'サイト', 'URL',
    'Spletišče', 'Spletna stran', 'Webseite', 'Sitio web', 'Site web',
    '웹사이트', 'Сайт',
  ],
  comment: [
    'comment', 'message', 'reply', 'write', 'your comment', 'leave a comment',
    'comment body', 'your message', 'feedback', 'text',
    '内容', '评论', '留言', '回复', '消息',
    'コメント', 'メッセージ',
    'Komentar', 'Komentář', 'Kommentar', 'Comentario', 'Commentaire',
    '댓글', 'Комментарий',
  ]
};
```

#### 3.3.2 增加 `<label>` 关联匹配

当前 `buildStepsFromSnapshot` 只用节点自身的 `name` 和 `placeholder`。增强为同时查看：

1. 节点自身的 `name`、`placeholder`、`aria-label`
2. 通过 `aria-labelledby` 引用的标签文本
3. 相邻 DOM 中的 `<label for="...">` 文本（在 Snapshot 采集时就附加到节点信息中）
4. 前序/后序兄弟 StaticText 节点的文本

**改动**：在 `fullAiContent.js` 的 `createNodeFromElement` 中，为 input/textarea 额外采集关联 label 文本：

```javascript
if (element.id) {
  const label = rootDocument.querySelector(`label[for="${element.id}"]`);
  if (label) node.labelText = normalizeTextContent(label.textContent);
}
```

在 `fullAiAgent.js` 的 `scoreSlot` 中，同时对 `name + placeholder + labelText` 做关键词匹配。

#### 3.3.3 textarea 回退策略

如果所有关键词都没匹配到 comment 字段，但页面上只有一个 `role=textbox` 且 `tagName=textarea` 的节点（或为最大的那个 textarea），默认将其视为评论输入框。

```javascript
if (!slotCandidates.comment.length) {
  const textareas = inputs.filter(n => n.tagName === 'textarea');
  if (textareas.length === 1) {
    slotCandidates.comment.push({ node: textareas[0], score: 0.5 });
  } else if (textareas.length > 1) {
    // 取 placeholder 或 name 最长的（通常是主输入框）
    textareas.sort((a, b) => 
      ((b.placeholder || '').length + (b.name || '').length) - 
      ((a.placeholder || '').length + (a.name || '').length)
    );
    slotCandidates.comment.push({ node: textareas[0], score: 0.3 });
  }
}
```

#### 3.3.4 提交按钮增强

扩展提交按钮识别：

```javascript
const SUBMIT_KEYWORDS_ENHANCED = [
  // English
  'submit', 'post', 'post comment', 'submit comment', 'send', 'publish',
  'leave a reply', 'add comment', 'reply',
  // Chinese
  '发布', '提交', '发表', '提交评论', '发表评论', '回复',
  // Japanese
  'コメントする', '送信', '投稿',
  // German / French / Spanish / Slovenian / Czech
  'Absenden', 'Envoyer', 'Enviar', 'Objavi', 'Odeslat', 'Komentovat',
  // Korean / Russian
  '제출', 'Отправить',
];
```

同时增加 `type="submit"` 的 `<input>` 和 `<button>` 的直接匹配（不依赖文本）：

```javascript
if (!submitNode) {
  submitNode = buttons.find(n => n.inputType === 'submit') || null;
}
```

---

### 3.4 勾选确认项增强（Priority 2）

**目标**：识别更多类型的"需勾选后才能提交"的确认项。

#### 增强策略

1. **扩展 checkbox 关键词**：
```javascript
const CHECKBOX_KEYWORDS_ENHANCED = [
  'notify', 'agree', 'terms', 'accept', 'consent',
  'robot', 'not a robot', 'i am human',
  'privacy', 'policy', 'subscribe', 'newsletter',
  '机器人', '同意', '条款', '隐私', '订阅',
  'save my name', 'save my info',
];
```

2. **识别非标准 checkbox**：在 Snapshot 中除了 `role=checkbox`，同时检测：
   - `role=switch` 的元素
   - 含 `aria-checked` 属性的 `<div>`/`<span>`
   - `<label>` 内包含隐藏 `<input type="checkbox">` 的整行区域（点击 label 即可切换）

3. **"Save my name" 类 checkbox 默认勾选**：WordPress 常见的 "Save my name, email, and website in this browser" checkbox，默认勾选可减少下次填充工作量。

---

### 3.5 失败重试与回退机制（Priority 2）

**目标**：当某一步失败时，不直接终止，而是尝试替代方案。

#### 分层回退链

```
尝试 1：程序启发式（buildStepsFromSnapshot）
    ↓ 失败（未匹配到评论框或提交按钮）
尝试 2：放宽条件重试（textarea 回退 + type=submit 回退）
    ↓ 仍然失败
尝试 3：LLM 规划（runOneShotRound）← 现有代码已有
    ↓ 仍然失败
终止，报告具体失败原因
```

#### 执行失败重试

当 `fullAiExecute` 报告 `element_not_found` 时：

1. 等待 500ms（元素可能尚未渲染）
2. 重新 `takeSnapshot`，获取新的 UID 映射
3. 在新 Snapshot 中重新匹配失败的字段
4. 如果匹配成功，用新 UID 重试执行
5. 最多重试 1 次

---

### 3.6 流程统一：标准模式融合 Snapshot（Priority 2）

**目标**：让标准流程 `blogCommentGenerateAndFill` 也能使用 Snapshot 能力，而不需要用户手动切换"完全AI识别"。

#### 改动方案

在 `blogCommentGenerateAndFill` 中，当标准的"关键词识别"或"AI OneShot"失败后，自动 fallback 到 Snapshot 启发式流程：

```
blogCommentGenerateAndFill:
  1. [弹窗预处理] ← 新增
  2. 表单检测（现有 getCommentFormMetadata）
  3. 缓存/关键词/AI 识别（现有逻辑）
      ↓ 如果识别成功 → 填充 → 提交
      ↓ 如果识别失败 ↓
  4. [Snapshot 回退] ← 新增
      → takeSnapshot（全页或限定范围）
      → buildStepsFromSnapshot（增强版）
      → 如果匹配成功 → fullAiExecute 执行
      → 如果仍然失败 → LLM Snapshot 规划（可选）
```

**关键点**：这不是"替换"标准流程，而是在标准流程末尾增加一个 Snapshot fallback 分支。现有缓存、关键词、AI 识别仍然优先生效，仅在全部失败时才触发 Snapshot 路径。

---

## 四、执行优先级与开发计划

### Phase 1：高优先级（预计 2-3 天，显著提升成功率）

| 编号 | 任务 | 改动文件 | 预期效果 |
|------|------|----------|----------|
| P1-1 | 纯程序弹窗预处理 | `fullAiContent.js` 新增 `dismissOverlays()` | 解决 Cookie/隐私弹窗遮挡问题 |
| P1-2 | 标准流程接入弹窗预处理 | `formHandler.js` `blogCommentGenerateAndFill` 开头调用 | 标准流程 + 批量模式都能关弹窗 |
| P1-3 | 扩展多语言关键词库 | `fullAiAgent.js` `SLOT_KEYWORDS` / `SUBMIT_KEYWORDS` | 支持日/德/法/西/斯/捷/韩/俄语 |
| P1-4 | 增加 label 关联 + textarea 回退 | `fullAiContent.js` + `fullAiAgent.js` | 减少"未匹配到评论框"失败 |
| P1-5 | 标准流程 Snapshot 回退 | `formHandler.js` | 标准模式失败时自动尝试 Snapshot |

### Phase 2：中优先级（预计 2 天，进一步提升）

| 编号 | 任务 | 改动文件 | 预期效果 |
|------|------|----------|----------|
| P2-1 | 执行失败重拍 Snapshot 重试 | `fullAiAgent.js` | 减少 element_not_found 失败 |
| P2-2 | Snapshot 辅助的表单可用性判断 | `fullAiContent.js` | 快速跳过已关闭评论的页面 |
| P2-3 | 勾选确认项增强 | `fullAiAgent.js` + `fullAiContent.js` | 识别更多 checkbox/switch |
| P2-4 | 程序启发式 → LLM 分层回退 | `fullAiAgent.js` | 启发式失败时自动调用 LLM |

### Phase 3：优化（持续迭代）

| 编号 | 任务 | 说明 |
|------|------|------|
| P3-1 | 提交后 Snapshot 验证 | 拍快照检查是否出现成功消息或错误提示 |
| P3-2 | 批量模式性能优化 | 复用弹窗检测结果（同域名），减少重复检测 |
| P3-3 | 失败案例收集与关键词持续扩充 | 记录每次失败的 Snapshot，分析并补充关键词 |

---

## 五、改动范围与影响评估

### 5.1 文件改动清单

| 文件 | 改动类型 | 改动量 |
|------|----------|--------|
| `content/fullAiContent.js` | 新增弹窗检测函数、Snapshot 采集增强（label 关联） | +80 行 |
| `lib/fullAiAgent.js` | 扩展关键词、textarea 回退、执行重试 | +60 行，改 ~30 行 |
| `content/formHandler.js` | 接入弹窗预处理、Snapshot 回退分支 | +40 行，改 ~15 行 |
| `background.js` | 无改动或极少改动（调度层不变） | ~0 |

**总改动量**：新增约 180 行，修改约 45 行。不涉及架构变更，不改动消息协议。

### 5.2 风险评估

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 弹窗检测误点击（把正常按钮当弹窗关掉） | 低 | 仅检测 fixed/sticky + 高 z-index 元素 |
| 多语言关键词匹配到错误字段 | 低 | 关键词精确匹配（包含而非前缀），且有 AI 兜底 |
| Snapshot 回退路径增加单次执行耗时 | 低 | 仅在前置所有方法失败时触发，且无额外 LLM 调用 |
| 批量模式下弹窗处理增加每页 1-2s | 可接受 | 相比提交失败需要人工介入，增加的时间完全值得 |

---

## 六、架构示意图

### 6.1 增强后的完整流程

```
页面加载完成
    │
    ▼
┌──────────────────────────┐
│  Stage 0: 弹窗预处理      │  ← 新增
│                            │
│  1. 程序检测 fixed/sticky  │
│     元素中的 accept 按钮   │
│  2. LLM 兜底（可选）       │
│  3. 最多 2 轮              │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Stage 1: 表单检测        │  ← 增强
│                            │
│  1. getCommentFormMetadata │
│  2. 若无 form → Snapshot   │
│     快速搜索 textbox       │
│  3. 均无 → 判定不可评论    │
│     → 提前终止             │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Stage 2: 分层识别                    │
│                                        │
│  ┌───────────┐  ┌──────────────────┐  │
│  │  缓存命中  │→│ 直接使用缓存映射  │  │
│  └─────┬─────┘  └──────────────────┘  │
│     未命中                              │
│        ▼                                │
│  ┌───────────┐  ┌──────────────────┐  │
│  │ 关键词匹配 │→│ 成功 → 使用映射   │  │  ← 增强（多语言）
│  └─────┬─────┘  └──────────────────┘  │
│      失败                               │
│        ▼                                │
│  ┌───────────┐  ┌──────────────────┐  │
│  │ AI OneShot │→│ 成功 → 使用映射   │  │  （现有）
│  └─────┬─────┘  └──────────────────┘  │
│      失败                               │
│        ▼                                │
│  ┌────────────────────┐                 │  ← 新增回退
│  │ Snapshot 启发式匹配  │                │
│  │ (buildStepsFromSnapshot 增强版)│     │
│  └─────┬──────────────┘                 │
│      失败                               │
│        ▼                                │
│  ┌────────────────────┐                 │  ← 新增回退
│  │ LLM Snapshot 规划   │                │
│  │ (runOneShotRound)   │                │
│  └────────────────────┘                 │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────┐
│  Stage 3: 执行            │
│                            │
│  fills → checks → clicks  │
│  模拟人工输入（按字符）    │
│                            │
│  如果 element_not_found:   │
│  → 重拍 Snapshot           │  ← 新增
│  → 重新匹配 → 重试执行    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Stage 4: 提交后验证      │  （现有）
│                            │
│  等待页面刷新              │
│  检查站点链接是否出现      │
└──────────────────────────┘
```

### 6.2 与现有代码的映射关系

| 流程阶段 | 现有代码 | 增强改动 |
|----------|----------|----------|
| Stage 0 弹窗 | `runOverlayDismissLoop`（仅完全AI识别路径） | 新增程序级 `dismissOverlays`，接入标准流程 |
| Stage 1 检测 | `getCommentFormMetadata` + `handleFullAiPrepareForComment` | 增加 Snapshot 辅助检测 |
| Stage 2 识别 | 关键词 / AI OneShot / `buildStepsFromSnapshot` | 扩展关键词 + label 关联 + textarea 回退 + 分层回退 |
| Stage 3 执行 | `fillCommentForm` / `fullAiExecute` | 增加重拍 Snapshot 重试 |
| Stage 4 验证 | `verifyCommentSubmission` | 不变 |

---

## 七、多轮对话 Agent Loop — 自修复核心机制

### 7.1 为什么需要多轮对话

当前所有 LLM 调用都是**单轮无状态**的：

```javascript
// 每次调用都只有 system + 1 条 user，AI 不知道之前发生了什么
messages: [
  { role: 'system', content: '...' },
  { role: 'user', content: '这是 Snapshot...' }
]
```

这导致一个根本问题：**流程中的每一步都是孤立的，无法自修复**。

- 弹窗没关掉？下一步不知道弹窗还在
- 执行 fill 失败？重试时 AI 不知道哪些字段已经填好了
- 提交后页面变了？AI 无法理解"提交前 vs 提交后"的变化
- 遇到预设规则之外的异常？直接中断，没有任何适应能力

多轮对话的核心价值：**让 AI 拥有完整的任务记忆，遇到任何意外都能基于上下文做出合理的下一步判断**。

### 7.2 Agent Loop 核心设计

#### 设计理念：Observe → Decide → Act → Evaluate 循环

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Loop (每个 URL 一次)             │
│                                                           │
│    ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│    │ Observe  │───→│  Decide  │───→│   Act    │         │
│    │ 拍快照    │    │ LLM 分析  │    │ 执行操作  │         │
│    └────┬─────┘    └──────────┘    └────┬─────┘         │
│         │                                │               │
│         │         ┌──────────┐           │               │
│         └─────────│ Evaluate │←──────────┘               │
│                   │ 评估结果  │                           │
│                   └────┬─────┘                           │
│                        │                                 │
│              成功？─── 否 → 继续循环（AI 带上下文修正）    │
│                │                                         │
│               是 → 结束任务                               │
│                                                           │
│  messages[] 累积每轮的 user + assistant，AI 知道全部历史   │
└─────────────────────────────────────────────────────────┘
```

#### 核心原则

1. **程序负责"观察"和"执行"，AI 负责"决策"**：Snapshot 采集、元素点击/填充由程序完成，AI 只看 Snapshot 文本做判断
2. **messages 累积上下文**：每轮的 Snapshot + 执行结果都追加到 messages，AI 可以看到完整历史
3. **结构化输出**：AI 每轮返回固定格式的 JSON 指令，程序解析后执行
4. **程序启发式优先**：简单场景（弹窗关闭、常见表单）先用程序规则处理，仅在程序规则失败时进入 Agent Loop
5. **轮次上限 + token 控制**：最多 5 轮，旧轮 Snapshot 自动截断，避免 token 爆炸

### 7.3 System Prompt 设计

```javascript
const AGENT_SYSTEM_PROMPT = `你是一个网页评论表单自动提交助手。你的任务是在目标网页上找到评论表单，填入指定信息，并提交。

## 你的能力
你能通过 DOM Snapshot 理解页面结构，输出 JSON 指令让程序执行。每轮你会收到当前页面的 Snapshot 和上一轮的执行结果。

## 可用操作
你每轮输出一个 JSON 对象，包含要执行的操作：
{
  "thought": "简要分析当前状态和下一步计划（1-2句）",
  "actions": [
    { "op": "fill", "uid": "xxx", "value": "要填入的文本" },
    { "op": "click", "uid": "xxx" },
    { "op": "check", "uid": "xxx", "checked": true }
  ],
  "status": "continue" | "done" | "no_form" | "blocked"
}

## status 含义
- "continue"：本轮操作执行后，需要再看一次页面状态（如：关了弹窗后需要看表单）
- "done"：评论已提交完成（最后一个 action 应该是点击提交按钮）
- "no_form"：确认页面没有评论表单（评论已关闭、需要登录等），终止任务
- "blocked"：遇到无法绕过的障碍（reCAPTCHA、登录墙等），终止任务

## 规则
1. 每轮 actions 中的操作按顺序执行：先 fill，再 check，最后 click
2. 填充时 value 必须与「待填数据」完全一致，不要修改或缩短
3. 遇到 Cookie/隐私弹窗，优先关闭弹窗（click 对应的 accept/agree 按钮），status 设为 "continue"
4. 遇到人机验证（简单算术如 2+3=?），在 actions 中 fill 正确答案
5. 遇到需要勾选的 checkbox（如 notify、agree、save my name），在 actions 中 check
6. 如果上一轮有操作失败（element_not_found），根据新 Snapshot 找到正确的 uid 重试
7. 提交按钮必须放在最后一个 action，且当所有必填字段填完后才点击
8. 仅输出 JSON，不要 markdown 代码块、不要解释`;
```

### 7.4 每轮 User Message 构建

```javascript
function buildRoundMessage(roundIndex, snapshot, prevResult, fillData, extras) {
  const parts = [];

  // 第 1 轮：携带待填数据
  if (roundIndex === 0) {
    parts.push(`【任务】在此页面找到评论表单，填入以下信息并提交。`);
    parts.push(`【待填数据】`);
    parts.push(`- comment（评论内容）：${fillData.comment}`);
    parts.push(`- commentName（姓名）：${fillData.commentName || '（无）'}`);
    parts.push(`- commentEmail（邮箱）：${fillData.commentEmail || '（无）'}`);
    parts.push(`- commentWebsite（网址）：${fillData.commentWebsite || '（无）'}`);
  }

  // 上一轮执行结果反馈
  if (prevResult) {
    parts.push(`【上一轮执行结果】`);
    for (const r of prevResult.results || []) {
      const status = r.ok ? '✅成功' : `❌失败(${r.error})`;
      parts.push(`- ${r.op}(${r.uid}): ${status}`);
    }
    if (prevResult.pageChanged) {
      parts.push(`注意：执行后页面发生了变化（可能是弹窗关闭或表单提交后刷新）`);
    }
  }

  // 当前 Snapshot（控制长度）
  const maxLen = roundIndex === 0 ? 6000 : 4000;
  const snapshotTrunc = snapshot.length > maxLen
    ? snapshot.slice(0, maxLen) + '\n...[截断]'
    : snapshot;
  parts.push(`【当前页面 Snapshot（第 ${roundIndex + 1} 轮）】`);
  parts.push(snapshotTrunc);

  return parts.join('\n');
}
```

### 7.5 Agent Loop 主流程

```javascript
const MAX_AGENT_ROUNDS = 5;
const ROUND_TIMEOUT_MS = 25000;

async function runAgentLoop(tabId, fillData, llmConfig, fetchLlmWithRetry, log) {
  const messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT }
  ];

  let lastExecResult = null;

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    log(`Agent 第 ${round + 1}/${MAX_AGENT_ROUNDS} 轮`);

    // ── Observe：拍快照 ──
    const snapRes = await chrome.tabs.sendMessage(tabId, {
      action: 'fullAiTakeSnapshot',
      scopeRootSelector: null
    });
    if (!snapRes?.success || !snapRes.snapshotText) {
      log(`Snapshot 采集失败: ${snapRes?.error}`);
      return { success: false, error: snapRes?.error || 'Snapshot 失败' };
    }

    // ── 程序快速预判（不消耗 LLM token）──
    // 第 1 轮且无弹窗：先尝试程序启发式
    if (round === 0) {
      const quickDismiss = await dismissOverlaysByProgram(tabId);
      if (quickDismiss.clicked) {
        log('程序已关闭弹窗，重新拍快照');
        continue; // 重拍快照进入下一轮（不调 LLM）
      }
      const quickMap = buildStepsFromSnapshot(snapRes.snapshotResult, fillData);
      if (quickMap.steps?.length > 0 && !quickMap.error) {
        log(`程序启发式成功：${quickMap.steps.length} 步，跳过 LLM`);
        const execRes = await chrome.tabs.sendMessage(tabId, {
          action: 'fullAiExecute', steps: quickMap.steps
        });
        if (execRes?.success) {
          return { success: true, reason: '程序启发式完成', round: round + 1 };
        }
        // 启发式执行失败 → 把失败信息带入 Agent Loop，让 AI 修正
        lastExecResult = execRes;
        log('程序启发式执行失败，进入 AI Agent Loop 修正');
      }
    }

    // ── Decide：构建 user message → 调用 LLM ──
    const userMsg = buildRoundMessage(
      round, snapRes.snapshotText, lastExecResult, fillData
    );
    messages.push({ role: 'user', content: userMsg });

    // 控制历史长度：只保留 system + 最近 4 轮（8 条 user+assistant）
    trimConversationHistory(messages, { maxUserAssistantPairs: 4 });

    const llmResponse = await callAgentLLM(messages, llmConfig, fetchLlmWithRetry);
    if (!llmResponse) {
      return { success: false, error: 'LLM 返回无法解析' };
    }
    messages.push({ role: 'assistant', content: JSON.stringify(llmResponse) });

    log(`AI 决策: status=${llmResponse.status}, thought="${llmResponse.thought}"`);
    log(`AI 操作: ${llmResponse.actions?.length || 0} 个`);

    // ── 终止条件判断 ──
    if (llmResponse.status === 'no_form') {
      return { success: false, error: '页面无评论表单', reason: llmResponse.thought };
    }
    if (llmResponse.status === 'blocked') {
      return { success: false, error: '遇到无法绕过的障碍', reason: llmResponse.thought };
    }

    // ── Act：执行 AI 输出的 actions ──
    if (llmResponse.actions?.length > 0) {
      const steps = llmResponse.actions.map(a => ({
        op: a.op, uid: a.uid,
        value: a.value, checked: a.checked
      }));
      const execRes = await chrome.tabs.sendMessage(tabId, {
        action: 'fullAiExecute', steps
      });
      lastExecResult = execRes;

      const failedCount = (execRes?.results || []).filter(r => !r.ok).length;
      log(`执行结果: ${execRes?.success ? '全部成功' : `${failedCount} 个失败`}`);
    }

    // ── Evaluate：判断是否结束 ──
    if (llmResponse.status === 'done') {
      const allOk = lastExecResult?.success !== false;
      if (allOk) {
        return { success: true, reason: llmResponse.thought, round: round + 1 };
      }
      // AI 认为 done 但执行有失败 → 继续一轮让 AI 看到失败信息
      log('AI 认为完成但执行有失败，继续修正');
    }

    // status === 'continue' → 继续下一轮
    await new Promise(r => setTimeout(r, 800));
  }

  return { success: false, error: `已达最大轮次 ${MAX_AGENT_ROUNDS}` };
}
```

### 7.6 Conversation History 管理

**关键问题**：Snapshot 文本很长（4000-8000 字符），5 轮下来 messages 可能超过 30000 tokens。

**控制策略**：

```javascript
function trimConversationHistory(messages, opts = {}) {
  const maxPairs = opts.maxUserAssistantPairs || 4;
  // messages[0] 是 system，永远保留
  // 从 messages[1] 开始，每 2 条为一个 user+assistant pair
  const nonSystem = messages.slice(1);
  const pairCount = Math.floor(nonSystem.length / 2);

  if (pairCount <= maxPairs) return; // 未超限

  // 超限：保留最近 maxPairs 对，旧的替换为摘要
  const pairsToRemove = pairCount - maxPairs;
  const removeCount = pairsToRemove * 2;
  const removed = nonSystem.slice(0, removeCount);

  // 生成摘要：提取每轮的 thought 和关键结果
  const summary = removed.map((msg, i) => {
    if (msg.role === 'assistant') {
      try {
        const obj = JSON.parse(msg.content);
        return `[轮次] thought: ${obj.thought}, status: ${obj.status}, actions: ${obj.actions?.length || 0}`;
      } catch { return null; }
    }
    return null;
  }).filter(Boolean).join('\n');

  // 替换旧消息为摘要
  messages.splice(1, removeCount, {
    role: 'user',
    content: `【前 ${pairsToRemove} 轮摘要】\n${summary}`
  });
}
```

**Token 预算估算**：

| 组成 | 单轮 tokens | 5 轮累积 |
|------|-------------|----------|
| System prompt | ~500 | 500（固定） |
| 每轮 user（Snapshot + 结果） | ~1500-2500 | 保留最近 4 轮 ≈ 8000 |
| 每轮 assistant（JSON） | ~200-400 | 保留最近 4 轮 ≈ 1200 |
| 旧轮摘要 | ~200 | 200 |
| **总计** | - | **~10000 tokens/任务** |

### 7.7 与现有架构的集成方式

Agent Loop 不替换现有流程，而是作为**增强层嵌入** `fullAiAgent.js`：

```
现有 runFullAiTask:
  1. 弹窗处理（runOverlayDismissLoop）    ──┐
  2. 表单 Snapshot                         │  保留为"快速路径"
  3. 程序启发式（buildStepsFromSnapshot）   │  简单表单走这条路径
  4. 执行                                 ──┘  （不消耗 LLM token）
                                              │
                                         失败 ↓
                                              │
新增 runAgentLoop:                            │
  多轮对话 Agent Loop                    ←────┘
  （带上下文的自修复能力）                    作为 fallback 接入
```

```javascript
async function runFullAiTask(tabId, ...) {
  // === 快速路径：程序启发式（不消耗 LLM）===
  const quickResult = await tryQuickPath(tabId, fillData, log);
  if (quickResult.success) return quickResult;

  // === 自修复路径：Agent Loop ===
  log('快速路径失败，启动 AI Agent Loop（多轮自修复）');
  return await runAgentLoop(tabId, fillData, llmConfig, fetchLlmWithRetry, log);
}
```

### 7.8 多轮对话的自修复场景示例

#### 场景 A：弹窗 → 表单 → 提交（常见，3 轮）

```
Round 1:
  User: [Snapshot 显示 Cookie 弹窗遮挡页面]
  AI: { thought: "检测到 Cookie 同意弹窗", actions: [click Accept], status: "continue" }

Round 2:
  User: [弹窗已关闭，Snapshot 显示评论表单]
  AI: { thought: "弹窗已关闭，开始填充表单",
        actions: [fill Name, fill Email, fill Website, fill Comment, check SaveMyName],
        status: "continue" }

Round 3:
  User: [上轮全部成功，Snapshot 未变化]
  AI: { thought: "所有字段已填充，点击提交",
        actions: [click Submit], status: "done" }
```

#### 场景 B：element_not_found 自修复（2 轮）

```
Round 1:
  User: [Snapshot + 待填数据]
  AI: { actions: [fill uid=wce-abc Comment, fill uid=wce-def Name], status: "continue" }

  执行结果：fill(wce-abc) ✅, fill(wce-def) ❌ element_not_found

Round 2:
  User: [新 Snapshot + 执行结果反馈 "wce-def 不存在"]
  AI: { thought: "Name 输入框的 uid 已变化，从新 Snapshot 中找到 wce-xyz",
        actions: [fill uid=wce-xyz Name, click Submit], status: "done" }
```

#### 场景 C：提交后页面报错（3 轮）

```
Round 1: 填充所有字段 → status: "continue"
Round 2: 点击提交 → status: "done"

  执行结果：click ✅，但程序检测到页面出现错误消息

Round 3:
  User: [新 Snapshot 显示 "Email is required" 错误提示]
  AI: { thought: "提交失败，页面提示 Email 必填，但上轮已填过。重新检查发现 Email 字段被清空了",
        actions: [fill Email, click Submit], status: "done" }
```

#### 场景 D：页面无评论表单（1 轮快速终止）

```
Round 1:
  User: [Snapshot 中无 textbox、无 textarea、无评论相关元素]
  AI: { thought: "页面无评论表单，可能评论功能已关闭",
        actions: [], status: "no_form" }
```

#### 场景 E：遇到 reCAPTCHA（1 轮快速终止）

```
Round 1:
  User: [Snapshot 显示 reCAPTCHA iframe]
  AI: { thought: "检测到 Google reCAPTCHA，无法自动绕过",
        actions: [], status: "blocked" }
```

---

## 八、更新后的执行优先级与开发计划

### Phase 1：基础增强 + Agent Loop 框架（预计 3-4 天）

| 编号 | 任务 | 改动文件 | 说明 |
|------|------|----------|------|
| P1-1 | 纯程序弹窗预处理 | `fullAiContent.js` | 新增 `dismissOverlays()` |
| P1-2 | 标准流程接入弹窗预处理 | `formHandler.js` | 所有模式都能关弹窗 |
| P1-3 | 扩展多语言关键词 + label 关联 + textarea 回退 | `fullAiAgent.js` + `fullAiContent.js` | 提升程序启发式的覆盖率 |
| P1-4 | **Agent Loop 核心框架** | `lib/fullAiAgent.js` | `runAgentLoop` + System Prompt + 消息构建 |
| P1-5 | 快速路径 → Agent Loop fallback 接入 | `lib/fullAiAgent.js` | 程序启发式失败时自动进入 Agent Loop |

### Phase 2：Agent Loop 打磨（预计 2-3 天）

| 编号 | 任务 | 说明 |
|------|------|------|
| P2-1 | Conversation History 截断与摘要 | 旧轮 Snapshot 自动截断，控制 token |
| P2-2 | 执行结果检测增强 | 识别页面变化（弹窗消失、错误消息出现、表单提交后刷新） |
| P2-3 | 提交后 Snapshot 验证 | 拍快照检查是否有 success message 或 error message |
| P2-4 | 批量模式接入 Agent Loop | `background.js` `executeBatchTask` 使用新流程 |

### Phase 3：优化与稳定性（持续迭代）

| 编号 | 任务 | 说明 |
|------|------|------|
| P3-1 | 同域名弹窗检测结果复用 | 批量模式下同域名跳过弹窗轮 |
| P3-2 | 成功模式缓存 | 记录成功的域名 + 字段映射，下次直接复用 |
| P3-3 | 失败 Snapshot 日志 | 记录每次失败的 Snapshot，便于分析补充规则 |

---

## 九、验收标准

### 功能验收

1. **弹窗处理**：打开带 Cookie 同意弹窗的页面，弹窗能自动关闭，评论表单可见
2. **多语言表单**：日语、德语、斯洛文尼亚语等非英文评论表单能正确识别并填充
3. **非标准表单**：评论区不在 `<form>` 标签内的页面，通过 Snapshot 识别并填充
4. **关闭评论的页面**：快速判定"不可评论"并终止（status: "no_form"）
5. **勾选确认项**：各类 checkbox 能自动勾选
6. **自修复**：执行失败后 AI 能根据新 Snapshot 和错误信息修正操作
7. **批量模式**：以上所有增强在批量提交时同样生效

### 性能验收

| 场景 | 目标耗时 | LLM 调用次数 |
|------|----------|-------------|
| 简单表单（程序启发式成功） | < 5s | 0（仅评论生成 1 次） |
| 有弹窗 + 标准表单 | < 10s | 0-1 |
| 复杂表单（需 Agent Loop） | < 30s | 2-4 轮 |
| 无评论表单的页面 | < 8s | 0-1 |
| 遇到 reCAPTCHA | < 10s | 0-1 |
