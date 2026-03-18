# PRD: 自动采集模式

## 1. 概述

在 sidepanel 外链采集模块新增"自动采集"功能，支持：
1. **单次采集**: 串行执行四个步骤，从 Blog 评论 URL 到可评论站点
2. **循环采集**: 将步骤4 输出的可评论站点作为下一轮输入，形成递归采集循环

---

## 2. 工作流定义

### 2.1 步骤一：从当前活动页面提取
**触发**: 点击"从当前活动页面提取"按钮
**输入**: 当前活动 Tab 的 Blog 评论页面 URL
**处理**:
1. 通过 `chrome.tabs.sendMessage` 向 content script 发送 `extractCommentUrls` 消息
2. Content script 提取评论区链接，解析域名并去重
3. 返回域名列表，通过 `saveExploreBatchWithExcludeFilter` 保存到 batch

**输出**: `exploreCurrentBatch.dugDomains`（挖到的域名列表）

**UI 更新**: 渲染 `exploreDugDomainsList`，显示挖到的域名数量

### 2.2 步骤二: 加入 Ahrefs 输入
**触发**: 点击"加入 Ahrefs 输入"按钮
**输入**: `exploreCurrentBatch.dugDomains`（上一步输出的域名列表）
**处理**:
1. 调用 `filterDomainsByAge(domains, 5)` 批量查询 WHOIS
2. 筛选近 5 年内注册的域名
3. 通过筛选的域名加入 `exploreAhrefsDomains`
4. 调用 `renderExploreAhrefsDomainList()` 渲染 UI

**输出**: `exploreAhrefsDomains`（通过 WHOIS 筛选的域名列表）

**UI 更新**: 渲染 Ahrefs 域名列表，显示通过筛选的域名数量

### 2.3 步骤三: 拉取反链
**触发**: 点击"拉取反链" 按钮
**输入**: `exploreAhrefsDomains`（上一步输出的域名列表）
**处理**:
1. 将域名列表加入 `exploreAhrefsDomainsQueue` 队列
2. 调用 `runAhrefsFetchingLoop` 循环拉取每个域名的反链
3. 通过 CapSolver + Ahrefs API 获取反链数据
4. 结果存入 `exploreUrlList`（反链 URL 列表）
5. 更新 batch 并保存

**输出**: `exploreUrlList`（反链 URL 列表）

**UI 更新**: 渲染反链 URL 列表，显示拉取进度和反链数量

### 2.4 步骤四: 遍历检测可评论站点
**触发**: 点击"遍历检测可评论站点" 按钮
**输入**: `exploreUrlList`（上一步输出的反链 URL 列表）
**处理**:
1. 应用排除过滤器（spam 服务、特定后缀、 DR 阈值）
2. 遍历每个 URL:
   - 打开页面检测是否为 Blog 站点
   - 计算 BlogCommentScore
   - 检测是否需要登录
   - 检测是否为导航站
3. 可评论站点存入 `exploreDiscoveredList` / `discoveredSites`
4. 更新 batch 并保存

**输出**: `exploreDiscoveredList`（可评论站点列表）

**UI 更新**: 渲染发现列表，显示可评论站点数量

---

## 3. 数据流转图

### 3.1 单次采集流程
```
┌─────────────┐      ┌──────────────┐      ┌──────────────┐      ┌────────────────┐
│ 当前页面    │ ───→ │ 步骤1: 提取  │ ───→ │ 步骤2: WHOIS │ ───→ │ 步骤3: 拉取反链 │
│ (Blog评论URL)│      │ 域名列表     │      │ 筛选通过域名 │      │ 反链URL列表    │
└─────────────┘      └──────────────┘      └──────────────┘      └──────┬───────┘
                                                              │
                                                              ▼
                                                       ┌──────────────────┐
                                                       │ 步骤4: 遍历检测  │
                                                       │ 可评论站点列表   │
                                                       └────────┬─────────┘
                                                                │
                                              ┌─────────────────┴─────────────────┐
                                              │                                   │
                                              ▼                                   ▼
                                       循环模式关闭                      循环模式开启
                                        (结束)                          (进入下一轮)
```

### 3.2 循环采集流程
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              循环采集模式                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────┐                                                               │
│  │ 第1轮循环   │  初始 Blog 评论页                                            │
│  │ Batch #1    │                                                               │
│  └──────┬──────┘                                                               │
│         │                                                                       │
│         ▼                                                                       │
│  步骤1→步骤2→步骤3→步骤4 → 发现 15 个可评论 Blog 站点                           │
│                              │                                                  │
│                              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐           │
│  │ 第2轮循环 (为每个发现的 Blog 站点创建独立 Batch)                  │           │
│  ├─────────────────────────────────────────────────────────────────┤           │
│  │ Batch #2-1: blog1.com → 步骤1→2→3→4 → 发现 8 个新站点          │           │
│  │ Batch #2-2: blog2.com → 步骤1→2→3→4 → 发现 5 个新站点          │           │
│  │ Batch #2-3: blog3.com → 步骤1→2→3→4 → 发现 12 个新站点         │           │
│  │ ...                                                              │           │
│  └─────────────────────────────────────────────────────────────────┘           │
│                              │                                                  │
│                              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐           │
│  │ 第3轮循环 (继续处理第2轮发现的新站点)                             │           │
│  │ Batch #3-1, #3-2, #3-3...                                       │           │
│  └─────────────────────────────────────────────────────────────────┘           │
│                              │                                                  │
│                              ▼                                                  │
│                         循环继续...                                             │
│                              │                                                  │
│                              ▼                                                  │
│                    无新站点 / 手动停止 → 结束                                   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 循环模式设计

### 4.1 循环模式开关
- **位置**: 自动采集按钮旁边
- **样式**: Toggle Switch 开关
- **状态**:
  - 关闭: 灰色，单次采集模式
  - 开启: 绿色/蓝色，循环采集模式

### 4.2 循环控制逻辑
```javascript
// 循环模式配置
const LOOP_CONFIG = {
  maxDepth: 3,              // 最大循环深度（防止无限循环）
  maxSitesPerRound: 50,     // 每轮最多处理的站点数
  dedupEnabled: true,       // 是否去重（避免重复处理同一站点）
  stopOnNoNewSites: true    // 无新站点时自动停止
};
```

### 4.3 循环终止条件
| 条件 | 说明 |
|------|------|
| 达到最大深度 | 默认 3 层，可配置 |
| 无新站点 | 本轮没有发现新的可评论站点 |
| 已处理站点去重 | 所有发现站点都已被处理过 |
| 手动停止 | 用户点击停止按钮 |
| 错误过多 | 连续失败次数超过阈值 |

### 4.4 去重机制
```javascript
// 全局已处理站点集合
let globalProcessedSites = new Set();

// 检查是否为新站点
function isNewSite(url) {
  const normalized = normalizeUrl(url);
  return !globalProcessedSites.has(normalized);
}

// 标记为已处理
function markAsProcessed(url) {
  globalProcessedSites.add(normalizeUrl(url));
}
```

---

## 5. 任务批次管理（核心功能）

### 5.1 批次层级结构
```
┌─────────────────────────────────────────────────────────────────────┐
│                        自动采集任务                                 │
│                     (autoCollectTaskId)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ├── Batch #1 (第1轮)                                              │
│  │   ├── sourceUrl: 初始页面 URL                                   │
│  │   ├── depth: 0                                                  │
│  │   ├── status: completed                                         │
│  │   └── discoveredSites: [blog1.com, blog2.com, ...]              │
│  │                                                                 │
│  ├── Batch #2-1 (第2轮, 站点1)                                     │
│  │   ├── sourceUrl: blog1.com                                      │
│  │   ├── parentBatchId: #1                                         │
│  │   ├── depth: 1                                                  │
│  │   ├── status: in_progress                                       │
│  │   ├── currentPosition: 3 (步骤3, 第3个域名)                      │
│  │   └── discoveredSites: [...]                                    │
│  │                                                                 │
│  ├── Batch #2-2 (第2轮, 站点2)                                     │
│  │   ├── sourceUrl: blog2.com                                      │
│  │   ├── parentBatchId: #1                                         │
│  │   ├── depth: 1                                                  │
│  │   ├── status: pending                                           │
│  │   └── ...                                                       │
│  │                                                                 │
│  └── Batch #2-3, #2-4, ... (第2轮其他站点)                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 批次数据结构
```javascript
// 单个批次
{
  batchId: string,              // 批次唯一 ID
  autoCollectTaskId: string,    // 所属自动采集任务 ID

  // 层级关系
  parentBatchId: string | null, // 父批次 ID（第1轮为 null）
  depth: number,                // 循环深度（0, 1, 2, ...）
  roundIndex: number,           // 轮次索引（1, 2, 3, ...）
  batchIndexInRound: number,    // 本轮中的批次索引

  // 来源信息
  sourceUrl: string,            // 来源页面 URL
  sourceType: 'initial' | 'discovered', // 来源类型

  // 当前状态
  status: 'pending' | 'in_progress' | 'completed' | 'paused' | 'failed',
  currentStep: number,          // 当前步骤: 1-4
  currentPosition: {            // 精确位置（用于断点续传）
    step: number,               // 步骤号
    phase: string,              // 阶段: 'domain' | 'url' | 'site'
    index: number,              // 列表中的索引
    total: number,              // 列表总数
    currentItem: string         // 当前处理的域名/URL
  },

  // 步骤输出
  stepOutputs: {
    step1: { domains: [...], count: number },
    step2: { filteredDomains: [...], passed: number, failed: number },
    step3: { backlinks: [...], count: number },
    step4: { discoveredSites: [...], count: number }
  },

  // 统计
  stats: {
    extractedDomains: number,
    filteredDomains: number,
    backlinks: number,
    discoveredSites: number,
    newSites: number            // 去重后的新站点数
  },

  // 时间
  startedAt: string,
  updatedAt: string,
  completedAt: string | null
}
```

### 5.3 自动采集任务结构
```javascript
// 顶层任务
{
  taskId: string,               // 任务唯一 ID
  taskType: 'single' | 'loop',  // 单次 / 循环

  // 循环配置（仅 loop 模式）
  loopConfig: {
    enabled: boolean,
    maxDepth: number,
    currentDepth: number,
    stopOnNoNewSites: boolean
  },

  // 批次队列
  batches: string[],            // batchId 列表
  currentBatchIndex: number,    // 当前执行的批次索引
  pendingBatches: string[],     // 待执行的 batchId
  completedBatches: string[],   // 已完成的 batchId

  // 去重集合
  processedSites: string[],     // 已处理的站点 URL

  // 全局统计
  totalStats: {
    rounds: number,             // 已完成轮次
    batches: number,            // 总批次数
    discoveredSites: number,    // 发现的站点总数
    newSites: number            // 新站点数（去重后）
  },

  // 状态
  status: 'pending' | 'running' | 'paused' | 'completed' | 'stopped',
  startedAt: string,
  updatedAt: string
}
```

---

## 6. 精确进度追踪

### 6.1 步骤内进度定义
| 步骤 | 进度阶段 | 进度单位 | 记录字段 |
|------|----------|----------|----------|
| 1 | 域名提取 | 域名 | `currentDomainIndex` / `totalDomains` |
| 2 | WHOIS 查询 | 域名 | `currentWhoisIndex` / `totalWhois` |
| 3 | 反链拉取 | 域名 | `currentBacklinkIndex` / `totalBacklinks` |
| 4 | 遍历检测 | URL | `currentUrlIndex` / `totalUrls` |

### 6.2 进度存储示例
```javascript
{
  currentStep: 3,
  currentPosition: {
    step: 3,
    phase: 'backlink',
    index: 5,              // 正在处理第 6 个域名（0-indexed）
    total: 10,             // 共 10 个域名
    currentItem: 'example.com'  // 当前域名
  }
}
```

### 6.3 断点续传恢复逻辑
```javascript
async function resumeFromPosition(batch, position) {
  const { step, phase, index, currentItem } = position;

  switch (step) {
    case 1:
      // 重新从当前页面提取，跳过已处理的域名
      return resumeExtractDomains(batch, index);

    case 2:
      // 继续从第 index 个域名开始 WHOIS 查询
      return resumeWhoisFilter(batch, index);

    case 3:
      // 继续从第 index 个域名开始拉取反链
      return resumeBacklinks(batch, index);

    case 4:
      // 继续从第 index 个 URL 开始遍历检测
      return resumeTraverse(batch, index);
  }
}
```

---

## 7. UI 设计

### 7.1 顶部控制区
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 外链采集模式                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  🤖 自动采集                                          [▶ 开始]      │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ 🔄 循环模式                                        [○ OFF] │   │   │
│  │  │   将发现的 Blog 站点作为下一轮输入                           │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 进度: ████████████████████░░░░░░░░░░░░░░░░░░  60%                 │   │
│  │ 第2轮/共3轮 • Batch 5/15 • 步骤 3/4 • 处理 example.com (5/10)      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [⏸ 暂停]  [▶ 继续]  [⏹ 停止]                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 循环模式开关样式
```
┌─────────────────────────────────────────────────────────────────┐
│ 🔄 循环模式                                              [● ON] │
│   ✓ 自动将发现的 Blog 站点作为下一轮输入                         │
│   ✓ 最大深度: 3 轮                                              │
│   ✓ 已处理: 127 个站点（自动去重）                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 🔄 循环模式                                             [○ OFF] │
│   关闭后仅执行单次采集                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 批次队列视图
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📋 任务队列                                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  第1轮 (已完成) ───────────────────────────────────────────────── ✅ 15/15  │
│  ├── ✅ Batch #1: initial-page.com → 发现 15 个站点                         │
│                                                                             │
│  第2轮 (进行中) ───────────────────────────────────────── 🔄 3/15           │
│  ├── ✅ Batch #2-1: blog1.com → 发现 8 个站点                               │
│  ├── ✅ Batch #2-2: blog2.com → 发现 5 个站点                               │
│  ├── 🔄 Batch #2-3: blog3.com → 步骤 3/4, 处理 domain5.com (3/10)           │
│  ├── ⏳ Batch #2-4: blog4.com → 等待中                                      │
│  ├── ⏳ Batch #2-5: blog5.com → 等待中                                      │
│  └── ... 还有 10 个批次等待中                                                │
│                                                                             │
│  第3轮 (待执行) ─────────────────────────────────────── ⏳ 0/23             │
│  └── 等待第2轮完成...                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 实时日志视图
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📜 实时日志                                                 [▼ 展开] [清除] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ [14:30:15] ✅ Batch #2-1 完成: 发现 8 个新站点                              │
│ [14:30:12] ✅ blog1.com WHOIS 通过: 2022-05-01                             │
│ [14:30:10] 🔄 正在处理 blog1.com 的反链... (3/10)                           │
│ [14:30:08] ✅ Batch #2-2 完成: 发现 5 个新站点                              │
│ [14:30:05] ⚠️ blog5.com WHOIS 不通过: 超过5年                               │
│ [14:30:02] ❌ domain3.com 反链拉取失败: API 限流                            │
│ [14:29:58] ✅ Batch #1 完成: 发现 15 个新站点                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. 状态流转

### 8.1 自动采集任务状态
```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌───────────┐
│ pending │ ──→ │ running │ ──→ │ paused  │ ──→ │ completed │
└─────────┘     └────┬────┘     └────┬────┘     └───────────┘
                     │               │
                     │               │
                     ▼               ▼
                ┌─────────┐    ┌─────────┐
                │ stopped │    │ failed  │
                └─────────┘    └─────────┘
```

### 8.2 批次状态
```
pending → in_progress → completed
                  ↓
               paused → in_progress (恢复)
                  ↓
               failed
```

---

## 9. API 设计

### 9.1 任务管理 API
```javascript
// 创建自动采集任务
async function createAutoCollectTask(config) {
  const taskId = generateTaskId();
  const task = {
    taskId,
    taskType: config.loopMode ? 'loop' : 'single',
    loopConfig: config.loopMode ? {
      enabled: true,
      maxDepth: config.maxDepth || 3,
      currentDepth: 0,
      stopOnNoNewSites: true
    } : null,
    batches: [],
    processedSites: [],
    status: 'pending',
    startedAt: new Date().toISOString()
  };
  await saveTask(task);
  return task;
}

// 启动/继续任务
async function startOrResumeTask(taskId) {
  const task = await loadTask(taskId);

  // 检查是否有未完成的批次
  const currentBatch = task.batches.find(b => b.status === 'paused' || b.status === 'in_progress');

  if (currentBatch) {
    // 从断点恢复
    return resumeBatch(currentBatch);
  }

  // 获取下一个待执行的批次
  const nextBatch = task.batches.find(b => b.status === 'pending');
  if (nextBatch) {
    return executeBatch(nextBatch);
  }

  // 检查是否需要创建新批次（循环模式）
  if (task.taskType === 'loop' && task.loopConfig.enabled) {
    return createNextRoundBatches(task);
  }

  // 任务完成
  return completeTask(task);
}

// 暂停任务
async function pauseTask(taskId) {
  const task = await loadTask(taskId);
  task.status = 'paused';

  // 暂停当前批次
  const currentBatch = task.batches.find(b => b.status === 'in_progress');
  if (currentBatch) {
    currentBatch.status = 'paused';
    await saveBatch(currentBatch);
  }

  await saveTask(task);
}

// 停止任务
async function stopTask(taskId) {
  const task = await loadTask(taskId);
  task.status = 'stopped';
  await saveTask(task);
}
```

### 9.2 批次执行 API
```javascript
// 执行批次
async function executeBatch(batch) {
  batch.status = 'in_progress';
  await saveBatch(batch);

  try {
    // 根据当前位置决定从哪步开始
    const startStep = batch.currentPosition?.step || 1;

    for (let step = startStep; step <= 4; step++) {
      batch.currentStep = step;
      await saveBatch(batch);

      const result = await executeStep(batch, step);

      // 保存步骤输出
      batch.stepOutputs[`step${step}`] = result;
      await saveBatch(batch);

      // 检查是否被暂停
      const latestBatch = await loadBatch(batch.batchId);
      if (latestBatch.status === 'paused') {
        return; // 被暂停，退出
      }
    }

    // 批次完成
    batch.status = 'completed';
    batch.completedAt = new Date().toISOString();
    await saveBatch(batch);

    // 通知任务批次完成
    await onBatchCompleted(batch);

  } catch (error) {
    batch.status = 'failed';
    await saveBatch(batch);
    throw error;
  }
}

// 从断点恢复批次
async function resumeBatch(batch) {
  const { step, index } = batch.currentPosition;

  batch.status = 'in_progress';
  await saveBatch(batch);

  // 从指定位置继续执行
  return executeStepFromPosition(batch, step, index);
}
```

### 9.3 循环控制 API
```javascript
// 创建下一轮批次
async function createNextRoundBatches(task) {
  const { currentDepth, maxDepth } = task.loopConfig;

  // 检查深度限制
  if (currentDepth >= maxDepth) {
    return completeTask(task);
  }

  // 收集所有已发现但未处理的站点
  const discoveredSites = [];
  for (const batchId of task.completedBatches) {
    const batch = await loadBatch(batchId);
    const sites = batch.stepOutputs.step4?.discoveredSites || [];
    discoveredSites.push(...sites);
  }

  // 去重
  const newSites = discoveredSites.filter(site =>
    !task.processedSites.includes(normalizeUrl(site.url))
  );

  // 无新站点，停止循环
  if (newSites.length === 0) {
    return completeTask(task);
  }

  // 为每个新站点创建批次
  const roundIndex = currentDepth + 1;
  for (let i = 0; i < newSites.length; i++) {
    const site = newSites[i];
    const batch = createBatch({
      autoCollectTaskId: task.taskId,
      parentBatchId: findParentBatch(task, site),
      depth: currentDepth + 1,
      roundIndex,
      batchIndexInRound: i,
      sourceUrl: site.url,
      sourceType: 'discovered'
    });
    task.batches.push(batch.batchId);
    task.pendingBatches.push(batch.batchId);

    // 标记为已处理
    task.processedSites.push(normalizeUrl(site.url));
  }

  // 更新深度
  task.loopConfig.currentDepth = roundIndex;
  await saveTask(task);

  // 开始执行新批次
  return startOrResumeTask(task.taskId);
}
```

---

## 10. 存储设计

### 10.1 存储键
```javascript
// 任务存储
const AUTO_COLLECT_TASK_KEY = 'autoCollectTask';
const AUTO_COLLECT_TASKS_KEY = 'autoCollectTasks';  // 所有任务列表

// 批次存储（复用现有 batch 存储）
const EXPLORE_BATCH_KEY = 'exploreBatch';

// 去重集合
const PROCESSED_SITES_KEY = 'autoCollectProcessedSites';
```

### 10.2 存储策略
| 数据 | 存储位置 | 持久性 |
|------|----------|--------|
| 任务配置 | chrome.storage.local | 持久化 |
| 批次进度 | chrome.storage.local | 持久化 |
| 去重集合 | chrome.storage.local | 任务完成后可清除 |
| 实时日志 | 内存 | 不持久化 |

---

## 11. 错误处理

### 11.1 步骤失败处理
- 单个域名/URL 失败不阻塞整体流程
- 记录失败原因，继续处理下一个
- 步骤完成后显示成功/失败统计

### 11.2 批次失败处理
- 单个批次失败不阻塞其他批次
- 标记为 failed，继续执行下一个批次
- 任务结束时汇总失败批次

### 11.3 异常恢复
| 异常类型 | 处理方式 |
|----------|----------|
| 网络错误 | 自动重试 3 次 |
| API 限流 | 延迟后重试 |
| 页面加载超时 | 跳过当前 URL |
| 浏览器崩溃 | 下次启动时恢复 |

---

## 12. 排除与过滤

### 12.1 域名排除（步骤2）
- 超过 5 年的域名
- WHOIS 查询失败的域名（可选：保留或跳过）

### 12.2 URL 排除（步骤3）
- Spam 服务域名
- 特定后缀（.gov, .edu 等）
- 低 DR 域名（如配置了 DR 阈值）

### 12.3 站点排除（步骤4）
- 导航站（非 Blog 站点）
- 需要登录的站点（可选）
- BlogCommentScore 低于阈值的站点

### 12.4 循环去重
- 所有已处理站点存入去重集合
- 新发现的站点先检查是否已处理
- 仅处理新站点

---

## 13. 配置项

### 13.1 全局配置
| 配置项 | 说明 | 默认值 |
|-------|------|--------|
| autoModeEnabled | 是否启用自动采集 | false |
| loopModeEnabled | 是否启用循环模式 | false |
| autoRetryCount | 失败重试次数 | 3 |
| autoRetryDelay | 重试延迟(ms) | 2000 |
| whoisMaxYears | WHOIS 最大年限 | 5 |
| drThreshold | DR 阈值 | 0 |

### 13.2 循环配置
| 配置项 | 说明 | 默认值 |
|-------|------|--------|
| maxDepth | 最大循环深度 | 3 |
| maxSitesPerRound | 每轮最多处理站点数 | 50 |
| stopOnNoNewSites | 无新站点时停止 | true |
| dedupEnabled | 启用去重 | true |

---

## 14. 实现文件

| 文件 | 说明 |
|------|------|
| `sidepanel/sidepanel.js` | 添加自动采集逻辑、循环控制、断点续传 |
| `sidepanel/sidepanel.html` | 添加 UI 元素（开关、进度、队列视图） |
| `sidepanel/sidepanel.css` | 添加样式 |
| `lib/autoCollect.js` | 自动采集核心逻辑（可选，拆分文件） |

---

## 15. 验收标准

### 15.1 功能验收
- [ ] 点击"自动采集"按钮能启动工作流
- [ ] 四个步骤按顺序执行
- [ ] 每步输出正确传递到下一步
- [ ] 最终生成可评论站点列表

### 15.2 循环模式验收
- [ ] 循环模式开关可正常切换
- [ ] 步骤4 完成后自动创建下一轮批次
- [ ] 去重机制正常工作
- [ ] 达到最大深度或无新站点时自动停止

### 15.3 断点续传验收
- [ ] 暂停后点击"继续"能恢复执行
- [ ] 关闭浏览器后重新打开能恢复进度
- [ ] 进度精确到列表位置（域名/URL 索引）
- [ ] 异常崩溃后能恢复

### 15.4 批次管理验收
- [ ] 每个循环创建独立批次
- [ ] 批次队列正确显示
- [ ] 批次进度实时更新
- [ ] 批次统计准确

### 15.5 边界验收
- [ ] 当前页面非 Blog 评论页时，提示用户
- [ ] 网络错误时自动重试
- [ ] API 限流时延迟重试
- [ ] 可手动中断工作流

---

## 16. 后续优化
- [ ] 支持多标签页并行采集
- [ ] 采集历史记录
- [ ] 导出采集报告
- [ ] 定时自动采集（打开指定 URL 后自动开始）
- [ ] 循环深度可视化（树形结构）
