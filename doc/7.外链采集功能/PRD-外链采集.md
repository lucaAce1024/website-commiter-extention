# PRD — 外链采集（Chrome Side Panel 新 Tab）

> 产品需求文档 | 版本 1.2 | 2026-03-11

---

## 1. 文档信息

| 项目     | 说明 |
|----------|------|
| 文档名称 | 外链采集 PRD |
| 版本     | 1.2 |
| 输出路径 | doc/7.外链采集功能/PRD-外链采集.md |

---

## 2. 背景与目标

### 2.1 背景

- 现有扩展侧边栏包含「导航站」「Blog 评论」「批量提交」三个 Tab，聚焦于在已知页面上填充表单或提交评论。
- 用户需要**发现**新的可发评论外链站点：从已有外链或 Ahrefs 等工具获取的反向链接列表中，筛选出「可提交评论」的博客/站点，并沉淀到飞书等表格中，形成可复用的外链采集工作流。

### 2.2 目标

**一句话**：在 Chrome Side Panel 中新增「外链采集」Tab，实现「外链输入 → Ahrefs 反链拉取 → 可评论站点检测 → 飞书沉淀 + 评论区域名挖掘 → 循环扩量」的闭环。

**核心价值**：

- 从用户提供的**外链页面**或 **Ahrefs 反链列表**中获取候选 URL。
- 自动判断页面是否具备**可提交评论的表单**（复用项目内评论表单识别能力）。
- 将符合条件的站点写入**可配置的飞书表格**，并可从评论区抓取更多站长留下的域名，用于下一轮 Ahrefs 采集。

---

## 3. 用户场景

### 场景 1：从外链评论区提取 URL

用户有一个外链落地页 URL（例如某博客文章）。希望扩展能打开该页，从**评论区**中解析出评论者留下的**网站 URL**（如个人主页、博客地址），得到一批候选域名/URL，供后续 Ahrefs 或直接访问使用。

### 场景 2：通过 Ahrefs 获取反链列表

用户输入一个域名（如 `new.web.cafe`），扩展：

1. 打开 Ahrefs 免费反链检查页：`https://ahrefs.com/backlink-checker?input={domain}&mode=subdomains`
2. 点击「Check backlinks」按钮。
3. 若出现 **Cloudflare 人机验证**，自动检测并协助用户完成（如点击验证）。
4. **拦截**页面发起的 `https://ahrefs.com/v4/stGetFreeBacklinksList` 网络请求，解析响应得到反链列表（含 `urlFrom`、`urlTo`、`anchor`、`domainRating` 等）。

用户可在 Side Panel 中看到反链列表，并选择「遍历检测可评论站点」。

### 场景 3：遍历 URL 检测可评论站点

用户有一批 URL（来自场景 1 或 2）。扩展逐个在 Tab 中打开这些 URL，检测页面是否存在**可提交评论的表单**。识别逻辑复用项目既有能力：存在可填充「站点名 / 网站 URL / 昵称 / 评论」等语义的表单区域（字段名可为变种，如 site name、author、website、comment 等，参照 `content/formHandler.js` 的 `COMMENT_FIELD_KEYWORDS` 及 `lib/fullAiAgent.js` 的 `SLOT_KEYWORDS` 进行匹配）。

### 场景 4：Blog 评论站沉淀到飞书 + 评论区挖域名

对判定为「Blog 评论站」的 URL：

- **4.1 飞书沉淀**：将一条记录写入用户配置的**飞书多维表格**（表格与字段可配置）。字段包括：URL、域名、发现时间、发现来源域名、是否有 CAPTCHA 验证、是否必须登录才能评论。
- **4.2 评论区挖站**：在该博客文章页抓取**所有已有评论**，从评论内容中解析出其他站长留下的**网站/域名**（如个人主页链接），作为新一轮采集的种子，回到「Ahrefs 反链拉取」或「遍历检测」循环使用。

### 场景 5：循环扩量

用户可多次执行「从 Ahrefs 拉反链 → 遍历检测 → 飞书沉淀 + 评论区挖域名」，用新挖到的域名再查 Ahrefs，获取更多反链 URL，形成采集闭环。

### 场景 6：中断后恢复与暂停/停止

- **进度不丢**：任务执行到一半时（如正在遍历 100 个 URL 中的第 30 个），用户关闭 Side Panel、刷新扩展或浏览器崩溃，再次打开后不应从头开始；扩展应能按**任务批次 ID** 找到上次进度，并提示「是否从批次 batch_20260311_143052 继续」。
- **暂停/继续**：用户点击「暂停」后，当前批次立即停止打开新 Tab，已得到的反链、已检测结果等写入存储；之后点击「继续」从下一个待处理 URL 接着执行。
- **停止**：用户点击「停止」后，该批次标记为已终止并保存进度；用户可查看本批次已处理结果与未处理列表，必要时再选「从本批次继续」做完剩余 URL。

---

## 4. 功能需求

### FR-1：Side Panel 新 Tab「外链采集」

| 项目     | 说明 |
|----------|------|
| **描述** | 在 Chrome Side Panel 的 mode-tabs 中新增一个 Tab，名称为「外链采集」。 |
| **位置** | 与现有「导航站」「Blog 评论」「批量提交」并列；可放在最后或按产品顺序调整。 |
| **验收** | AC-1：点击 Tab 可切换至对应面板；AC-2：面板内包含本 PRD 所述各功能入口与配置区。 |

### FR-2：从外链页面评论区提取网站 URL

| 项目       | 说明 |
|------------|------|
| **描述**   | 用户输入一个「外链链接」（目标文章/博客 URL），扩展打开该页并从**评论区**中解析出评论者留下的**网站 URL**。 |
| **输入**   | 单个 URL（文本框或从剪贴板）。 |
| **输出**   | 列表：从评论区提取到的 URL/域名（去重、可导出或直接作为「待检测 URL 列表」）。 |
| **实现要点** | 在目标页注入 content script，定位评论区 DOM（如 `.comments`、`#comments`、常见主题 class），在评论块中查找 `a[href]`，过滤出「疑似个人网站」的链接（可结合 href 与锚文本启发式过滤站内链接、广告链接）。 |
| **验收**   | AC-1：给定一篇含评论的博客文章 URL，能输出至少一条来自评论区的站外 URL；AC-2：结果列表可在 UI 中查看并用于下一步「遍历检测」。 |

### FR-3：Ahrefs 反链检查 + 人机验证 + 拦截反链 API

| 项目       | 说明 |
|------------|------|
| **描述**   | 打开 Ahrefs 免费反链检查页，填入用户输入的域名，点击「Check backlinks」，若出现 Cloudflare 人机验证则检测并协助点击通过，并拦截 `stGetFreeBacklinksList` 获取反链数据。 |
| **输入**   | 域名（如 `new.web.cafe`）或已拼接好的 Ahrefs URL。 |
| **目标页** | `https://ahrefs.com/backlink-checker?input={domain}&mode=subdomains`。 |
| **人机验证** | 检测到 CF 验证（如 challenge 弹层、iframe、典型文案/按钮）时，在可行范围内自动点击通过；若无法自动通过，需在 UI 提示用户手动完成，完成后可重试拉取。 |
| **拦截请求** | 目标请求：`https://ahrefs.com/v4/stGetFreeBacklinksList`，方法 POST，body 为 JSON（含 `signedInput`、`reportType` 等）。拦截该请求的**响应**，解析 JSON 得到反链列表。 |
| **响应结构** | 参考用户提供的格式：顶层为数组 `["TopBacklinks", { "backlinks": [ { "anchor", "domainRating", "urlFrom", "urlTo", "title", "textPre", "textPost", "inRendered", "inRaw" }, ... ] } ]`。需提取 `backlinks[].urlFrom`（以及可选 `urlTo`）作为候选 URL 列表。 |
| **验收**   | AC-1：在 Ahrefs 页完成检查后，扩展能拿到并展示至少一条反链；AC-2：CF 出现时能检测并尝试点击，或明确提示用户手动完成；AC-3：反链列表可在「外链采集」面板中展示并用于「遍历检测」。 |

### FR-4：遍历 URL 检测可评论站点

| 项目       | 说明 |
|------------|------|
| **描述**   | 对一批 URL（来自 FR-2 或 FR-3）逐个打开 Tab 访问，判断页面是否为「可提交评论」的博客站。 |
| **判定标准** | 页面存在**评论表单区域**，且能匹配到可填充的「站点名 / 网站 URL / 昵称 / 评论」等语义字段。字段名称可为多种变体，需复用项目既有逻辑：`content/formHandler.js` 中的 `COMMENT_FIELD_KEYWORDS`（name/author/website/comment 等中英文及多语言关键词）、以及 `lib/fullAiAgent.js` 的 `SLOT_KEYWORDS`（name, author, email, website, comment）。不要求与现有字段名完全一致，但匹配规则需与「Blog 评论」Tab 的识别逻辑一致或复用。 |
| **输出**   | 每个 URL 得到：是否可评论、是否有 CAPTCHA、是否需登录才能评论（可选，能检测则填）。 |
| **验收**   | AC-1：对已知可评论的 WordPress/常见博客主题页面，判定为「可评论」；AC-2：对无评论表单或已关闭评论的页面，判定为「不可评论」；AC-3：结果可汇总并进入 FR-5 的飞书写入与 FR-6 的评论区抓取。 |

### FR-5：飞书表格写入（可配置）

| 项目       | 说明 |
|------------|------|
| **描述**   | 对 FR-4 判定为「Blog 评论站」的 URL，将一条记录写入**飞书多维表格**。 |
| **可配置项** | 飞书表格的 **app_token**、**table_id**（或等效标识）需可在扩展内配置（如选项页或「外链采集」面板内的设置）；若飞书 API 需要 **tenant_access_token** 等，也需可配置或通过 OAuth 等安全方式获取。 |
| **字段格式** | 至少包含以下列（列名可配置或与飞书表头映射）：URL（当前页面 URL）、域名（从 URL 解析的 hostname）、发现时间（写入时间，建议 ISO 8601）、发现来源域名（该 URL 来自哪次采集）、是否有 CAPTCHA 验证（是/否）、是否必须登录才能评论（是/否）。 |
| **验收**   | AC-1：在扩展中配置好飞书表格后，检测到的可评论站能成功写入一条记录；AC-2：列与上述含义一致且可配置映射。 |

### FR-6：博客评论区抓取并提取站长域名

| 项目       | 说明 |
|------------|------|
| **描述**   | 对判定为 Blog 评论站的页面，抓取该页**所有评论内容**，从评论中解析出其他站长留下的**网站/域名**（例如评论者个人主页、博客 URL）。 |
| **实现要点** | 在页面 DOM 的评论区中遍历评论块，收集每条评论内的链接（`a[href]`）；通过启发式规则（或简单策略）过滤掉站内链接、社交平台、广告，保留「疑似个人站点」的域名，去重后输出。 |
| **用途**   | 该列表可作为新种子：用于再次调用 Ahrefs（FR-3）或直接加入「待检测 URL 列表」（FR-4），实现循环扩量（FR-7）。 |
| **验收**   | AC-1：对含多条带外链评论的博客页，能输出至少一个站外域名；AC-2：结果可在面板中查看并一键加入「下一轮 Ahrefs 输入」或「待检测列表」。 |

### FR-7：循环扩量（重复 Ahrefs 拉取）

| 项目       | 说明 |
|------------|------|
| **描述**   | 用户可将 FR-2 / FR-6 得到的域名或 FR-3 得到的反链 URL 再次作为输入，重复执行「Ahrefs 反链拉取（FR-3）→ 遍历检测（FR-4）→ 飞书写入（FR-5）+ 评论区挖站（FR-6）」，以获取更多可评论外链。 |
| **验收**   | AC-1：面板支持将「评论区挖出的域名」或「反链列表中的域名」一键加入「待查 Ahrefs 列表」或「待检测 URL 列表」；AC-2：可多次执行上述流程而不必重新输入种子。 |

### FR-8：任务批次 ID（带时间）

| 项目       | 说明 |
|------------|------|
| **描述**   | 每次用户发起一轮完整采集流程（如「从 Ahrefs 拉反链 + 遍历检测」或「遍历检测当前列表」）时，为该轮分配一个**唯一任务批次 ID**，便于区分不同批次、查看历史与恢复进度。 |
| **格式**   | 批次 ID 必须**包含时间信息**，建议格式：`batch_{YYYYMMDD}_{HHmmss}` 或 `batch_{ISO8601 短格式}`（如 `batch_20260311_143052`），保证同一用户在同一秒内发起的多批次也可通过追加序号区分（如 `batch_20260311_143052_1`）。 |
| **用途**   | 进度持久化、暂停/恢复/停止时均以「当前批次 ID」为键保存；恢复时用户可选择「按批次 ID」继续；飞书写入的「发现来源」可关联批次 ID 便于溯源。 |
| **验收**   | AC-1：每轮任务都有唯一批次 ID 且含时间；AC-2：列表中或详情处可清晰看到批次 ID，便于区分。 |

### FR-9：进度记录与持久化

| 项目       | 说明 |
|------------|------|
| **描述**   | 任务执行过程中**持续记录进度**并持久化（如 `chrome.storage.local`），避免扩展崩溃、关闭 Side Panel 或浏览器重启后**从头开始**。 |
| **记录内容** | 至少包含：当前批次 ID、当前阶段（如「拉取反链中」「遍历检测中」）、已处理的 URL 列表及每条状态（待处理/进行中/已完成/失败）、当前处理到第几条、已发现的可评论站列表、已挖到的评论区域名列表、任务状态（running / paused / stopped / completed）。 |
| **写入时机** | 每完成一个 URL 的检测、每拉取到一页反链、每写入一条飞书记录后，立即持久化增量进度；暂停或停止时执行一次完整保存。 |
| **验收**   | AC-1：任务执行到一半关闭面板或刷新后，再次打开可从「上次进度」恢复或选择批次继续；AC-2：进度数据与批次 ID 一一对应，不串批。 |

### FR-10：暂停 / 继续 / 停止（均保存进度）

| 项目       | 说明 |
|------------|------|
| **描述**   | 面板提供**暂停**、**继续**、**停止**三个操作按钮；**暂停**与**停止**时都必须**保存当前进度**（与 FR-9 一致），以便后续从该批次继续或查看结果。 |
| **暂停**   | 点击后当前批次任务暂停（不再打开新 Tab、不再请求 Ahrefs）；已取得的反链列表、已检测结果、已挖域名等全部落盘；再次点击「继续」时从该批次未完成的 URL/步骤接着执行。 |
| **停止**   | 点击后当前批次任务终止，同样保存进度；该批次标记为 `stopped`，不再自动继续，但用户可查看该批次已处理结果与未处理列表；若需「接着做完剩余 URL」，可提供「从本批次继续」入口（与「继续」行为一致）。 |
| **继续**   | 仅当存在处于 `paused` 或 `stopped` 的批次时可操作；从该批次上次保存的进度继续执行（如从下一个待检测 URL 开始）。 |
| **验收**   | AC-1：暂停后进度已保存，关闭再打开后点击「继续」能从断点继续；AC-2：停止后进度已保存，该批次结果可查且可选「从本批次继续」；AC-3：UI 上能明确区分当前是运行中 / 已暂停 / 已停止，并显示当前批次 ID。 |

### FR-11：存储时对外链 URL 去重

| 项目       | 说明 |
|------------|------|
| **描述**   | 在**写入存储**（进度持久化、批次 urlList、飞书写入前的可评论站列表、评论区挖到的域名列表等）时，对所有外链 URL/域名进行**去重**，避免同一 URL 在同一批次内重复检测或重复写入，并减少存储冗余。 |
| **适用范围** | ① 从 Ahrefs 解析得到的 `urlFrom` 列表写入本批次 `urlList` 前；② 从评论区提取的 URL/域名加入待检测列表或 `dugDomains` 前；③ 本批次内 `discoveredSites` 写入前；④ 与已有批次合并或「加入待检测」时，与当前批次或全局已处理集合去重（可选，建议至少做批次内去重）。 |
| **去重规则** | 对 URL 做**标准化**后再比对，例如：统一为小写、去掉末尾斜杠、去掉 fragment（`#xxx`）、可选去掉默认端口，再以集合去重；若以「域名」为粒度（如 dugDomains），则按 hostname 标准化后去重。 |
| **验收**   | AC-1：同一 Ahrefs 反链列表中重复的 `urlFrom` 写入 urlList 后仅保留一条；AC-2：同一批次内已存在的 URL 不再重复加入 urlList / discoveredSites / dugDomains；AC-3：持久化到 storage 的 urlList、dugDomains、discoveredSites 中无重复 URL/域名。 |

---

## 5. 数据与接口约定

### 5.1 Ahrefs 反链 API 响应（拦截目标）

- **请求**：`POST https://ahrefs.com/v4/stGetFreeBacklinksList`
- **响应**（用户提供的示例结构，扩展按此解析）：

```json
[
  "TopBacklinks",
  {
    "backlinks": [
      {
        "anchor": "landing page here",
        "domainRating": 66,
        "redirectChain": [],
        "textPost": ".",
        "textPre": "more of their pricing features...",
        "title": "24 best SEO tools...",
        "urlFrom": "https://www.marketermilk.com/blog/best-seo-tools",
        "urlTo": "https://ahrefs.com/pricing",
        "inRendered": true,
        "inRaw": true
      }
    ]
  }
]
```

- **扩展需提取**：`backlinks[].urlFrom` 作为候选外链 URL；可选展示 `urlTo`、`anchor`、`domainRating`、`title`。

### 5.2 飞书表格字段（与 FR-5 对应）

| 字段名（中文）     | 说明                     | 建议类型   |
|--------------------|--------------------------|------------|
| URL                | 当前页面 URL             | 文本/URL   |
| 域名               | hostname                 | 文本       |
| 发现时间           | 发现/写入时间            | 日期时间   |
| 发现来源域名       | 种子或 Ahrefs 查询域名   | 文本       |
| 是否有 CAPTCHA 验证 | 是/否                    | 单选/布尔  |
| 是否必须登录才能评论 | 是/否                    | 单选/布尔  |

具体列名与飞书表头映射可在配置中维护。

### 5.3 评论表单字段匹配（与现有项目一致）

复用现有逻辑，标准语义包括（名称可有变体）：

- **站点名/昵称**：siteName, name, author, nickname, 网站名, 昵称, 作者 等。
- **网站 URL**：siteUrl, website, url, 网址, 网站地址 等。
- **评论内容**：comment, message, 评论, 留言 等。

实现时参照 `content/formHandler.js` 的 `COMMENT_FIELD_KEYWORDS` 与 `lib/fullAiAgent.js` 的 `SLOT_KEYWORDS`，保证「外链采集」与「Blog 评论」Tab 的判定一致。

### 5.4 任务批次与进度数据模型（FR-8 / FR-9 / FR-10）

**任务批次**：每轮采集对应一个批次，建议结构：

| 字段           | 类型     | 说明 |
|----------------|----------|------|
| batchId        | string   | 唯一批次 ID，含时间，如 `batch_20260311_143052` |
| createdAt      | string   | ISO 8601 创建时间 |
| status         | string   | `running` \| `paused` \| `stopped` \| `completed` |
| phase          | string   | 当前阶段，如 `ahrefs_fetch` / `traverse_check` / `feishu_write` / `comment_dig` |
| sourceInput    | object   | 本批次输入（如 Ahrefs 查询域名、外链 URL 列表等） |
| urlList        | string[] | 本批次待处理 URL 列表（可能来自 Ahrefs 或用户输入） |
| urlProgress    | object   | 以 URL 为键，值为 `{ status, result? }`（pending / running / done / failed，及检测结果） |
| lastProcessedIndex | number | 上次处理到的 URL 下标（便于继续） |
| discoveredSites | array  | 已发现的可评论站列表（含 URL、是否有 CAPTCHA 等） |
| dugDomains     | string[] | 从评论区挖到的域名列表（**写入前去重**，见 FR-11） |
| updatedAt      | string   | 最后进度更新时间 ISO 8601 |

**URL 去重（FR-11）**：写入存储前，对 `urlList`、`discoveredSites` 中的 URL 及 `dugDomains` 中的域名做标准化并去重（如 URL 小写、去末尾斜杠、去 fragment；域名按 hostname 去重），保证持久化结果中无重复项。

**持久化**：以 `backlinkExplorationBatches` 或按 `batchId` 分 key 存入 `chrome.storage.local`；暂停/停止时写入当前批次，恢复时按 `batchId` 读取并从中断处继续。

---

## 6. 非功能需求

### NFR-1：权限与安全

- 需使用 Chrome 扩展的 **host_permissions** 或 **optional_host_permissions** 访问 `https://ahrefs.com/*` 以及用户待检测的第三方站点；网络拦截需在扩展上下文（如 background 或 offscreen）中通过 `chrome.declarativeNetRequest` 或监听 `webRequest`/`fetch` 注入等方式获取响应，具体以 Chrome 当前 API 为准。
- 飞书 API 的 token 或密钥不得硬编码，需通过选项页或安全配置入口由用户填写。

### NFR-2：性能与体验

- 遍历检测（FR-4）时建议限流（如同时仅 1 个 Tab 检测），避免同时打开过多 Tab；支持**暂停/继续/停止**（FR-10），且暂停/停止时**保存进度**（FR-9）。
- Ahrefs 页 CF 验证若无法自动通过，需明确提示用户手动完成并支持「重试拉取」。
- 进度持久化频率需兼顾「不丢进度」与「不过度写存储」：每完成单条 URL 或单步后写入，暂停/停止时强制全量保存。

### NFR-3：与现有功能兼容

- 新增 Tab 与现有「导航站」「Blog 评论」「批量提交」互不干扰；评论表单识别复用现有 content/background 能力，不重复造轮子。

---

## 7. 不做什么（Out of Scope）

| 项目                     | 说明 |
|--------------------------|------|
| 自动绕过 reCAPTCHA/hCaptcha | 与现有 PRD 一致，不实现自动绕过，仅标记「是否有 CAPTCHA」。 |
| 自动登录第三方站点       | 「是否必须登录才能评论」仅做检测与记录，不提供账号登录。 |
| 替代 Ahrefs 官方产品     | 仅利用其免费反链检查页与现有接口响应，不做付费接口或爬虫式抓取。 |
| 飞书 OAuth 完整套件      | 首版可采用配置 token 方式；OAuth 可后续迭代。 |

---

## 8. 实现要点摘要

| 模块/步骤 | 要点 |
|-----------|------|
| **Side Panel** | 新增 Tab「外链采集」；面板内：外链 URL 输入、Ahrefs 域名输入、反链列表展示、待检测 URL 列表、飞书配置入口、**任务批次 ID 展示**、**暂停/继续/停止**按钮、执行按钮（拉取反链 / 遍历检测 / 写飞书 / 挖评论域名）、循环扩量入口；支持从历史批次列表选择「继续」或查看结果。 |
| **评论区 URL 提取（FR-2）** | Content script 注入目标外链页，定位评论区 DOM，收集 `a[href]`，启发式过滤得站外 URL 列表。 |
| **Ahrefs（FR-3）** | 打开 Ahrefs 页并注入脚本：填域名、点 Check backlinks；检测 CF 验证并尝试点击；通过 `chrome.webRequest` 或 declarativeNetRequest 或 fetch 拦截 `stGetFreeBacklinksList` 响应并解析 JSON。 |
| **可评论检测（FR-4）** | 对每个 URL 打开 Tab，注入现有评论表单识别逻辑（与 Blog 评论 Tab 共用 formHandler/recognizeCommentForm），根据是否识别到评论表单 + 是否有 CAPTCHA/登录墙 输出结果。 |
| **飞书（FR-5）** | 调用飞书多维表格 API（需文档确认 endpoint与鉴权），写入 FR-5 约定字段；app_token/table_id 等从扩展配置读取。 |
| **评论区挖域名（FR-6）** | 在可评论页的评论区 DOM 中抓取评论内链接，过滤得新域名列表，去重后展示并支持加入「待查 Ahrefs」或「待检测 URL」。 |
| **循环扩量（FR-7）** | UI 上支持将「反链列表」「评论区域名」加入待处理队列，再次触发 FR-3 或 FR-4。 |
| **任务批次与进度（FR-8/9/10）** | 每轮任务生成带时间的 `batchId`；进度结构见 5.4，按批次持久化到 `chrome.storage.local`；暂停/停止时写回；提供暂停/继续/停止按钮，继续时按 `lastProcessedIndex` 与 `urlProgress` 从中断处执行。 |
| **URL 去重（FR-11）** | 所有写入存储的 URL/域名集合（urlList、discoveredSites、dugDomains）在写入前做标准化 + 去重；Ahrefs 反链列表、评论区提取结果在加入批次前也先去重。 |

---

## 9. 验收标准汇总

- [ ] **FR-1**：Side Panel 存在「外链采集」Tab，可正常切换并显示对应面板。
- [ ] **FR-2**：输入外链文章 URL 后，能输出从评论区提取的网站 URL 列表。
- [ ] **FR-3**：输入域名后能打开 Ahrefs、点击 Check backlinks；遇 CF 能检测并尝试点击或提示用户；能拦截并解析 `stGetFreeBacklinksList` 得到反链列表并在面板展示。
- [ ] **FR-4**：对一批 URL 能逐个检测「是否可评论」「是否有 CAPTCHA」「是否需登录」，结果可汇总。
- [ ] **FR-5**：可配置飞书表格并成功写入一条记录，包含 URL、域名、发现时间、发现来源域名、是否有 CAPTCHA、是否需登录。
- [ ] **FR-6**：在可评论博客页能抓取评论并解析出站外域名列表，且可加入下一轮采集。
- [ ] **FR-7**：可将新域名/新 URL 再次用于 Ahrefs 或遍历检测，形成循环。
- [ ] **FR-8**：每轮任务有唯一批次 ID 且含时间，列表中可区分不同批次。
- [ ] **FR-9**：执行过程中进度持续持久化；中断后再次打开可从上次进度恢复或按批次继续。
- [ ] **FR-10**：暂停/继续/停止按钮可用；暂停与停止时均保存进度，继续时从断点执行；UI 能区分运行中/已暂停/已停止并显示当前批次 ID。
- [ ] **FR-11**：存储前对 urlList、discoveredSites、dugDomains 及 Ahrefs/评论区得到的列表做 URL（或域名）标准化与去重，持久化结果中无重复项。

---

## 10. 附录：Ahrefs 请求示例（参考）

以下为用户提供的请求示例，用于理解拦截目标；实际请求参数（如 `signedInput`）可能随 Ahrefs 前端变化，扩展以**拦截响应**为主，不依赖固定 request body。

```http
POST https://ahrefs.com/v4/stGetFreeBacklinksList
Content-Type: application/json; charset=utf-8
Origin: https://ahrefs.com
Referer: https://ahrefs.com/backlink-checker/?input=ahrefs.com&mode=subdomains

{"signedInput":{"input":{"url":"ahrefs.com/","mode":"subdomains","validUntil":"..."},"signature":"..."},"reportType":["TopBacklinks"]}
```

扩展只需在响应中解析 `backlinks` 数组即可。
