/**
 * Side Panel Script - Main logic for the extension side panel
 * 阶段一：复刻 Popup 的 Blog 评论功能
 * 阶段二：批量提交与飞书集成
 * 阶段三：迁移 Popup 的导航站提交功能
 */

// ========== 常量 ==========
const BLOG_POPUP_STATE_PREFIX = 'blog_popup_state_';
const TRENDS_STATE_KEY = 'trends_keyword_digger_state_v1';
const TRENDS_HISTORY_KEY = 'trends_keyword_digger_history_v1';
const TRENDS_DEFAULT_TZ = -480;
const TRENDS_DEFAULT_HL = 'zh-CN';
/** 「打开 Trends 工作页」与首次创建工作 Tab 的默认落地页（legacy explore） */
const TRENDS_WORKER_PAGE_URL = 'https://trends.google.com/trends/explore?date=today%203-m&q=gpts&hl=en-US&legacy';
const TRENDS_BREAKOUT_RISE_PCT = 1000;
const TRENDS_DEFAULT_EXCLUDE_WORDS = ['near me', 'warmart'];

// 标准字段 → 展示名称（按字段填充列表用）
const FIELD_LABELS = {
  siteUrl: '网站 URL',
  siteName: '网站名称',
  email: '联系邮箱',
  category: '分类',
  tags: '标签',
  pricing: '定价 (Pricing)',
  tagline: '标语',
  shortDescription: '简短描述',
  longDescription: '详细描述',
  logo: 'Logo',
  screenshot: '界面截图'
};

// ========== DOM Elements ==========
const elements = {
  // Header
  refreshTabBtn: document.getElementById('refreshTabBtn'),

  // Mode tabs
  modeTabs: document.querySelectorAll('.mode-tab'),
  panelNav: document.getElementById('panel-nav'),
  panelBlog: document.getElementById('panel-blog'),
  panelBatch: document.getElementById('panel-batch'),
  panelExplore: document.getElementById('panel-explore'),
  panelTrends: document.getElementById('panel-trends'),

  // 导航站模式
  navSiteSelect: document.getElementById('navSiteSelect'),
  navCurrentSiteUrl: document.getElementById('navCurrentSiteUrl'),
  navAddSiteLink: document.getElementById('navAddSiteLink'),
  navNoSitesHint: document.getElementById('navNoSitesHint'),
  navPageDomain: document.getElementById('navPageDomain'),
  navFormStatus: document.getElementById('navFormStatus'),
  navRecognitionStatus: document.getElementById('navRecognitionStatus'),
  navFieldCount: document.getElementById('navFieldCount'),
  navNoFormHint: document.getElementById('navNoFormHint'),
  navClearCacheBtn: document.getElementById('navClearCacheBtn'),
  navFieldFillSection: document.getElementById('navFieldFillSection'),
  navFieldFillList: document.getElementById('navFieldFillList'),
  navFieldFillNoData: document.getElementById('navFieldFillNoData'),
  navFillFormBtn: document.getElementById('navFillFormBtn'),
  navAiFillFormBtn: document.getElementById('navAiFillFormBtn'),
  openNavSitesBtn: document.getElementById('openNavSitesBtn'),
  navOpenOptionsBtn: document.getElementById('navOpenOptionsBtn'),
  navAutoSubmit: document.getElementById('navAutoSubmit'),

  // Blog 评论模式
  blogSiteSelect: document.getElementById('blogSiteSelect'),
  blogCurrentSiteUrl: document.getElementById('blogCurrentSiteUrl'),
  blogManageSitesBtn: document.getElementById('blogManageSitesBtn'),
  blogAddSiteLink: document.getElementById('blogAddSiteLink'),
  blogNoSitesHint: document.getElementById('blogNoSitesHint'),
  blogPageDomain: document.getElementById('blogPageDomain'),
  blogFormStatus: document.getElementById('blogFormStatus'),
  blogRecognitionStatus: document.getElementById('blogRecognitionStatus'),
  blogFieldCountRow: document.getElementById('blogFieldCountRow'),
  blogFieldCount: document.getElementById('blogFieldCount'),
  blogFieldPrevBtn: document.getElementById('blogFieldPrevBtn'),
  blogFieldNextBtn: document.getElementById('blogFieldNextBtn'),
  blogSpamHint: document.getElementById('blogSpamHint'),
  blogNoFormHint: document.getElementById('blogNoFormHint'),
  blogCacheHint: document.getElementById('blogCacheHint'),
  blogClearCacheBtn: document.getElementById('blogClearCacheBtn'),
  blogStatusMessage: document.getElementById('blogStatusMessage'),
  blogStatusText: document.getElementById('blogStatusText'),
  blogCloseStatusBtn: document.getElementById('blogCloseStatusBtn'),
  blogStatusLine: document.getElementById('blogStatusLine'),
  blogGenerateAndFillBtn: document.getElementById('blogGenerateAndFillBtn'),
  blogVerifySubmitBtn: document.getElementById('blogVerifySubmitBtn'),
  openBlogSitesBtn: document.getElementById('openBlogSitesBtn'),
  blogOpenOptionsBtn: document.getElementById('blogOpenOptionsBtn'),
  useFullAi: document.getElementById('useFullAi'),
  autoSubmit: document.getElementById('autoSubmit'),

  // 批量提交模式 - 站点选择
  batchSiteSelect: document.getElementById('batchSiteSelect'),
  batchCurrentSiteUrl: document.getElementById('batchCurrentSiteUrl'),
  batchNoSitesHint: document.getElementById('batchNoSitesHint'),
  batchAddSiteLink: document.getElementById('batchAddSiteLink'),

  // 批量提交模式 - 飞书同步
  syncFromFeishuBtn: document.getElementById('syncFromFeishuBtn'),
  feishuLastSyncTime: document.getElementById('feishuLastSyncTime'),
  feishuStatusMessage: document.getElementById('feishuStatusMessage'),
  feishuStatusText: document.getElementById('feishuStatusText'),
  feishuSyncLimit: document.getElementById('feishuSyncLimit'),

  // 批量提交模式 - 任务控制
  batchProgress: document.getElementById('batchProgress'),
  batchStatusLine: document.getElementById('batchStatusLine'),
  batchStatusMessage: document.getElementById('batchStatusMessage'),
  batchStatusText: document.getElementById('batchStatusText'),
  batchCloseStatusBtn: document.getElementById('batchCloseStatusBtn'),
  batchUrlList: document.getElementById('batchUrlList'),
  batchTypeFilter: document.getElementById('batchTypeFilter'),
  batchStatusFilter: document.getElementById('batchStatusFilter'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  deselectAllBtn: document.getElementById('deselectAllBtn'),
  startBatchBtn: document.getElementById('startBatchBtn'),
  pauseBatchBtn: document.getElementById('pauseBatchBtn'),
  stopBatchBtn: document.getElementById('stopBatchBtn'),
  clearBatchLogBtn: document.getElementById('clearBatchLogBtn'),
  batchLogContainer: document.getElementById('batchLogContainer'),

  // 外链采集模式
  exploreBatchId: document.getElementById('exploreBatchId'),
  exploreBatchStatus: document.getElementById('exploreBatchStatus'),
  exploreResetStateBtn: document.getElementById('exploreResetStateBtn'),
  exploreClearCacheBtn: document.getElementById('exploreClearCacheBtn'),
  exploreManualDetectBtn: document.getElementById('exploreManualDetectBtn'),
  exploreManualDetectModal: document.getElementById('exploreManualDetectModal'),
  exploreDetectThreshold: document.getElementById('exploreDetectThreshold'),
  exploreDetectScore: document.getElementById('exploreDetectScore'),
  exploreDetectResult: document.getElementById('exploreDetectResult'),
  exploreDetectDomain: document.getElementById('exploreDetectDomain'),
  exploreDetectRequiresLogin: document.getElementById('exploreDetectRequiresLogin'),
  exploreManualDetectModalClose: document.getElementById('exploreManualDetectModalClose'),
  exploreCommentPageUrl: document.getElementById('exploreCommentPageUrl'),
  exploreExtractCommentUrlsBtn: document.getElementById('exploreExtractCommentUrlsBtn'),
  exploreExtractFromCurrentPageBtn: document.getElementById('exploreExtractFromCurrentPageBtn'),
  exploreAhrefsDomain: document.getElementById('exploreAhrefsDomain'),
  exploreAhrefsDomainList: document.getElementById('exploreAhrefsDomainList'),
  exploreFetchBacklinksBtn: document.getElementById('exploreFetchBacklinksBtn'),
  exploreAhrefsProgress: document.getElementById('exploreAhrefsProgress'),
  exploreAhrefsOverview: document.getElementById('exploreAhrefsOverview'),
  exploreUrlListViewToggle: document.getElementById('exploreUrlListViewToggle'),
  exploreUrlList: document.getElementById('exploreUrlList'),
  exploreStartTraverseBtn: document.getElementById('exploreStartTraverseBtn'),
  explorePauseBtn: document.getElementById('explorePauseBtn'),
  exploreResumeBtn: document.getElementById('exploreResumeBtn'),
  exploreStopBtn: document.getElementById('exploreStopBtn'),
  exploreDiscoveredList: document.getElementById('exploreDiscoveredList'),
  exploreFeishuConfigBtn: document.getElementById('exploreFeishuConfigBtn'),
  exploreWriteFeishuBtn: document.getElementById('exploreWriteFeishuBtn'),
  exploreClearDiscoveredBtn: document.getElementById('exploreClearDiscoveredBtn'),
  exploreDugDomainsList: document.getElementById('exploreDugDomainsList'),
  exploreDugDomainsCount: document.getElementById('exploreDugDomainsCount'),
  exploreAddDugToAhrefsBtn: document.getElementById('exploreAddDugToAhrefsBtn'),
  exploreExcludeFromBlogSites: document.getElementById('exploreExcludeFromBlogSites'),
  exploreAhrefsDomainList: document.getElementById('exploreAhrefsDomainList'),
  exploreAhrefsDomainCount: document.getElementById('exploreAhrefsDomainCount'),
  exploreClearAhrefsDomainListBtn: document.getElementById('exploreClearAhrefsDomainListBtn'),
  exploreUrlListCount: document.getElementById('exploreUrlListCount'),
  exploreDiscoveredCount: document.getElementById('exploreDiscoveredCount'),
  // 批次选择
  exploreLoadBatchSelect: document.getElementById('exploreLoadBatchSelect'),
  exploreLoadBatchBtn: document.getElementById('exploreLoadBatchBtn'),
  exploreLoadIncompleteFeishuBtn: document.getElementById('exploreLoadIncompleteFeishuBtn'),
  // 写入飞书按钮
  exploreWriteUrlListToFeishuBtn: document.getElementById('exploreWriteUrlListToFeishuBtn'),
  // 清空列表按钮
  exploreClearUrlListBtn: document.getElementById('exploreClearUrlListBtn'),

  // 自动采集模式
  autoCollectStartBtn: document.getElementById('autoCollectStartBtn'),
  autoCollectLoadHistoryBtn: document.getElementById('autoCollectLoadHistoryBtn'),
  autoCollectHistoryBatchSelect: document.getElementById('autoCollectHistoryBatchSelect'),
  autoCollectRestoreSelectedBtn: document.getElementById('autoCollectRestoreSelectedBtn'),
  loopModeEnabled: document.getElementById('loopModeEnabled'),
  loopModeConfig: document.getElementById('loopModeConfig'),
  loopMaxDepth: document.getElementById('loopMaxDepth'),
  loopMaxSites: document.getElementById('loopMaxSites'),
  autoCollectProgress: document.getElementById('autoCollectProgress'),
  autoCollectProgressBar: document.getElementById('autoCollectProgressBar'),
  autoCollectStatusText: document.getElementById('autoCollectStatusText'),
  autoCollectStepText: document.getElementById('autoCollectStepText'),
  autoCollectRunStateText: document.getElementById('autoCollectRunStateText'),
  autoCollectErrorText: document.getElementById('autoCollectErrorText'),
  autoCollectPauseBtn: document.getElementById('autoCollectPauseBtn'),
  autoCollectResumeBtn: document.getElementById('autoCollectResumeBtn'),
  autoCollectStopBtn: document.getElementById('autoCollectStopBtn'),
  autoCollectQueueSection: document.getElementById('autoCollectQueueSection'),
  autoCollectQueueStats: document.getElementById('autoCollectQueueStats'),
  autoCollectQueueList: document.getElementById('autoCollectQueueList'),
  autoCollectLogSection: document.getElementById('autoCollectLogSection'),
  autoCollectClearLogBtn: document.getElementById('autoCollectClearLogBtn'),
  autoCollectLogViewport: document.getElementById('autoCollectLogViewport'),
  autoCollectLogContainer: document.getElementById('autoCollectLogContainer'),

  // Trends 挖词模式
  trendsBaselineKeyword: document.getElementById('trendsBaselineKeyword'),
  trendsModePotentialBtn: document.getElementById('trendsModePotentialBtn'),
  trendsModeLongtailBtn: document.getElementById('trendsModeLongtailBtn'),
  trendsModeCardParent: document.getElementById('trendsModeCardParent'),
  trendsSeedKeywords: document.getElementById('trendsSeedKeywords'),
  trendsSeedCount: document.getElementById('trendsSeedCount'),
  trendsTimeRange: document.getElementById('trendsTimeRange'),
  trendsRiseThreshold: document.getElementById('trendsRiseThreshold'),
  trendsKeywordLimit: document.getElementById('trendsKeywordLimit'),
  trendsMaxRounds: document.getElementById('trendsMaxRounds'),
  trendsExcludeWords: document.getElementById('trendsExcludeWords'),
  trendsStartBtn: document.getElementById('trendsStartBtn'),
  trendsStopBtn: document.getElementById('trendsStopBtn'),
  trendsExportBtn: document.getElementById('trendsExportBtn'),
  trendsClearHistoryBtn: document.getElementById('trendsClearHistoryBtn'),
  trendsOpenWorkerBtn: document.getElementById('trendsOpenWorkerBtn'),
  trendsStatusRound: document.getElementById('trendsStatusRound'),
  trendsStatusProcessed: document.getElementById('trendsStatusProcessed'),
  trendsStatusFound: document.getElementById('trendsStatusFound'),
  trendsStatusError: document.getElementById('trendsStatusError'),
  trendsResultsList: document.getElementById('trendsResultsList'),
  trendsResultCount: document.getElementById('trendsResultCount'),
  trendsHistoryList: document.getElementById('trendsHistoryList'),
};

// ========== State ==========
let currentTab = null;
let sites = [];
let currentSiteId = null;
let llmEnabled = false;
let currentMode = 'nav'; // 默认为导航站模式
let pageState = null; // 导航站表单状态
let commentPageState = null;
let batchUrls = [];
let batchRunning = false;
let batchPaused = false;
let feishuSyncLimit = 10; // 默认同步 10 条

let exploreCurrentBatch = null;
let exploreSelectedUrls = new Set(); // 多选选中的 URL 索引集合
let exploreAhrefsDomains = []; // Ahrefs 域名列表

let exploreAhrefsRunning = false; // 拉取反链是否运行中
let exploreAhrefsPaused = false; // 拉取反链是否暂停
let exploreAhrefsAborted = false; // 拉取反链是否中止
let exploreAhrefsDomainsQueue = []; // 待拉取的域名队列
let exploreAhrefsCurrentIndex = 0; // 当前正在拉取的域名索引
let exploreAhrefsFeishuConfig = null; // 飞书配置缓存

// ========== Trends 挖词状态 ==========
let trendsJob = {
  running: false,
  stopping: false,
  abortController: null,
  jobId: null,
  startedAt: null,
  round: 0,
  processed: 0,
  lastError: null,
  queued: [],
  seenSeeds: new Set(),
  results: new Map(), // keywordNorm -> { keyword, risePct, riseRaw, round, parent, collectedAt }
  newlyAddedThisRound: new Set()
};

let trendsWorkerTabId = null;
let trendsWebRequestBound = false;
/** 与 trendsJob.lastError 同步，避免同一字符串重复刷屏；新任务开始会重置 */
let trendsLastErrorConsoleSnapshot = null;
let trendsExploreMode = 'potential'; // potential | longtail

function installSidepanelGlobalErrorLogging() {
  if (globalThis.__sidepanelGlobalErrorLoggingInstalled) return;
  globalThis.__sidepanelGlobalErrorLoggingInstalled = true;
  globalThis.addEventListener('error', (ev) => {
    console.error('[SidePanel] window error', ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
  });
  globalThis.addEventListener('unhandledrejection', (ev) => {
    console.error('[SidePanel] unhandledrejection', ev.reason);
    if (ev.reason && typeof ev.reason === 'object' && ev.reason.stack) console.error(ev.reason.stack);
  });
}

// ========== 自动采集模式状态 ==========
let autoCollectTask = null; // 当前自动采集任务
let autoCollectRunning = false; // 是否正在运行
let autoCollectPaused = false; // 是否暂停
let autoCollectStopped = false; // 是否停止
let autoCollectLoopRunning = false; // 循环是否真正在跑（用于区分「暂停中」与「恢复页面后点继续」）
let autoCollectCurrentBatchIndex = 0; // 当前执行的批次索引
let autoCollectLogs = []; // 实时日志
let autoCollectRunStuck = false; // 是否判定“卡住”
let autoCollectLastErrorText = ''; // 最近一次错误信息
let autoCollectLastKnownStep = 0; // 用于在 currentBatchId 清空时仍可显示“到哪一步”
let autoCollectHistoryTask = null; // 页面恢复时用于“加载历史批次”
const AUTO_COLLECT_TASK_KEY = 'autoCollectTask';
const AUTO_COLLECT_LOG_MAX = 50; // 最大日志条数（仅保留最近 N 条）
/** 用户点击「重置状态」后，阻止 saveAutoCollectTask 把任务写回 storage（避免收尾循环覆盖清空） */
let autoCollectStorageSuppressed = false;

// 循环模式配置
const LOOP_CONFIG = {
  maxDepth: 3,              // 最大循环深度（防止无限循环）
  maxSitesPerRound: 50,     // 每轮最多处理的站点数
  dedupEnabled: true,       // 是否去重（避免重复处理同一站点）
  stopOnNoNewSites: true    // 无新站点时自动停止
};

// ========== Ahrefs 拉取反链核心逻辑 ==========
async function runAhrefsFetchingLoop(domains, startIndex = 0) {
  if (typeof dedupeUrls !== 'function' || typeof filterUrlsExcludingDomains !== 'function' ||
      typeof saveExploreBatchWithExcludeFilter !== 'function' || typeof fetchAhrefsBacklinksForDomain !== 'function') {
    throw new Error('缺少必要的依赖函数');
  }

  // 确保自动采集/恢复场景也能写入「外链采集 - Ahrefs 反链」飞书表格
  // 之前 exploreAhrefsFeishuConfig 从未赋值，导致 hasFeishuConfig 恒为 false。
  if (!exploreAhrefsFeishuConfig) {
    try {
      const result = await chrome.storage.local.get(['feishuConfig']);
      exploreAhrefsFeishuConfig = result.feishuConfig || null;
      if (autoCollectRunning) {
        const cfg = exploreAhrefsFeishuConfig || {};
        addAutoCollectLog(
          `步骤3: 飞书配置加载完成（ahrefsSheetId=${cfg.ahrefsSheetId ? '已配置' : '未配置'}，ahrefsSheetToken=${cfg.ahrefsSheetToken ? '已配置' : '未配置'}）`,
          'info'
        );
      }
    } catch (e) {
      console.warn('[Ahrefs] 加载飞书配置失败:', e);
      exploreAhrefsFeishuConfig = null;
    }
  }

  const exclude = await getExploreExcludeDomainsForFilter();
  let batch = exploreCurrentBatch;
  let lastOverview = {};
  let totalCount = 0;

  for (let i = startIndex; i < domains.length; i++) {
    // 检查是否暂停或停止
    if (exploreAhrefsPaused || exploreAhrefsAborted) {
      exploreAhrefsCurrentIndex = i; // 保存当前位置
      exploreAhrefsRunning = false;
      updateExploreControls(exploreCurrentBatch?.status || null);
      showExploreMessage(`拉取反链已暂停/停止于第 ${i + 1} 个域名`, 'warning');
      return { paused: true, stopped: exploreAhrefsAborted, currentIndex: i, totalCount };
    }

    exploreAhrefsCurrentIndex = i;

    if (i > startIndex) {
      const interDomainDelay = Math.floor(Math.random() * 5000) + 3000;
      showExploreMessage(`域名间随机等待 ${(interDomainDelay / 1000).toFixed(1)} 秒,避免触发反爬…`, 'info');
      await new Promise(r => setTimeout(r, interDomainDelay));
    }

    const d = domains[i];
    showExploreMessage(`[${i + 1}/${domains.length}] 正在拉取 ${d} 的反链…`, 'info');
    if (autoCollectRunning) {
      addAutoCollectLog(`步骤3: 域名进度 ${i + 1}/${domains.length}（${d}）`, 'info');
    }

    const result = await fetchAhrefsBacklinksForDomain(d, i, domains.length);
    if (result.urlFromList.length > 0) {
      // 过滤并去重
      const filtered = filterUrlsExcludingDomains(result.urlFromList, exclude);
      const newUrls = dedupeUrls(filtered);

      // 增量更新 batch
      const existingUrls = new Set(batch.urlList || []);
      const addedUrls = newUrls.filter(u => !existingUrls.has(u));
      if (addedUrls.length > 0) {
        batch.urlList = [...(batch.urlList || []), ...addedUrls];
      }

      // 增量更新反链详情
      if (result.backlinks.length > 0) {
        const existingBacklinkUrls = new Set((batch.backlinkDetails || []).map(b => b.urlFrom));
        const newBacklinks = result.backlinks.filter(b => !existingBacklinkUrls.has(b.urlFrom));
        if (newBacklinks.length > 0) {
          batch.backlinkDetails = [...(batch.backlinkDetails || []), ...newBacklinks];
        }
      }

      // 更新 overview
      if (result.overview && result.overview.domainRating !== undefined) {
        lastOverview = result.overview;
        batch.ahrefsOverview = lastOverview;
      }

      batch.updatedAt = new Date().toISOString();
      // 自动采集过程中步骤3会产生很大的 urlList/backlinkDetails；频繁写入 storage 容易触发 QuotaBytes。
      // 步骤4会在内存中直接继续执行，并在进入遍历前再做一次必要的落盘。
      if (!autoCollectRunning) {
        await saveExploreBatchWithExcludeFilter(batch);
        if (exploreCurrentBatch && exploreCurrentBatch.batchId === batch.batchId) {
          exploreCurrentBatch = batch;
        }
      }

      // 立即渲染列表
      renderExploreUrlList();
      if (lastOverview.domainRating !== undefined) {
        renderAhrefsOverview(lastOverview, domains);
      }

      // 写入飞书（如果配置了）
      const hasFeishuConfig = exploreAhrefsFeishuConfig?.appId && exploreAhrefsFeishuConfig?.appSecret &&
                              exploreAhrefsFeishuConfig?.ahrefsSheetToken && exploreAhrefsFeishuConfig?.ahrefsSheetId;
      if (hasFeishuConfig && result.backlinks.length > 0) {
        if (autoCollectRunning) {
          addAutoCollectLog(
            `步骤3: 写入飞书「外链采集 - Ahrefs 反链」：域名=${d}，反链数=${result.backlinks.length}`,
            'info'
          );
        } else {
          console.log('[Ahrefs] 准备写入飞书:', { domain: d, backlinks: result.backlinks.length });
        }
        showExploreMessage(`[${i + 1}/${domains.length}] 正在写入 ${result.backlinks.length} 条反链到飞书…`, 'info');
        try {
          await writeBacklinksToFeishu(d, result.backlinks, result.overview, exploreAhrefsFeishuConfig);
          showExploreMessage(`[${i + 1}/${domains.length}] ${d} 完成：${addedUrls.length} 条新反链，已同步飞书`, 'success');
          if (autoCollectRunning) {
            addAutoCollectLog(`步骤3: 写入成功：${d}（反链=${result.backlinks.length}）`, 'success');
          }
        } catch (feishuErr) {
          console.warn('[Ahrefs] 飞书写入失败:', feishuErr);
          showExploreMessage(`[${i + 1}/${domains.length}] ${d} 完成：${addedUrls.length} 条新反链，飞书写入失败: ${feishuErr?.message}`, 'warning');
          if (autoCollectRunning) {
            addAutoCollectLog(`步骤3: 写入失败：${d}（原因：${feishuErr?.message || feishuErr}）`, 'error');
          }
        }
      } else {
        showExploreMessage(`[${i + 1}/${domains.length}] ${d} 完成：${addedUrls.length} 条新反链`, 'success');
        if (autoCollectRunning && exploreAhrefsFeishuConfig) {
          addAutoCollectLog(`步骤3: 飞书未写入（hasFeishuConfig=${!!hasFeishuConfig}，反链数=${result.backlinks.length}）`, 'info');
        }
      }

      totalCount += addedUrls.length;
    } else {
      showExploreMessage(`[${i + 1}/${domains.length}] ${d} 无反链数据`, 'info');
    }
  }

  // 完成
  exploreAhrefsRunning = false;
  exploreAhrefsDomainsQueue = [];
  exploreAhrefsCurrentIndex = 0;
  batch.phase = 'idle';
  if (!autoCollectRunning) {
    await saveExploreBatchWithExcludeFilter(batch);
    updateExploreControls(batch.status);
  }
  showExploreMessage(`拉取完成：共 ${totalCount} 条新反链（来自 ${domains.length} 个域名）`, 'success');
  return { paused: false, stopped: false, totalCount };
}

async function resumeAhrefsFetching() {
  if (!exploreAhrefsPaused || exploreAhrefsDomainsQueue.length === 0) {
    showExploreMessage('没有可恢复的反链任务', 'warning');
    return;
  }

  exploreAhrefsPaused = false;
  exploreAhrefsRunning = true;
  updateExploreControls('running');

  try {
    await runAhrefsFetchingLoop(exploreAhrefsDomainsQueue, exploreAhrefsCurrentIndex);
  } catch (e) {
    exploreAhrefsRunning = false;
    showExploreMessage(e?.message || '恢复拉取反链失败', 'error');
    updateExploreControls(exploreCurrentBatch?.status || null);
  }
}

// ========== Ahrefs 域名列表渲染 ==========
function renderExploreAhrefsDomainList() {
  const listEl = elements.exploreAhrefsDomainList;
  if (!listEl) return;
  const domains = exploreAhrefsDomains || [];
  const hasDomains = domains.length > 0;

  // 更新统计数字
  if (elements.exploreAhrefsDomainCount) {
    elements.exploreAhrefsDomainCount.textContent = `${domains.length} 个域名`;
    elements.exploreAhrefsDomainCount.classList.toggle('hidden', !hasDomains);
  }

  if (elements.exploreClearAhrefsDomainListBtn) {
    elements.exploreClearAhrefsDomainListBtn.disabled = !hasDomains;
  }

  if (!hasDomains) {
    listEl.innerHTML = '<div class="empty-list-hint">暂无域名</div>';
    listEl.classList.add('hidden');
  } else {
    listEl.innerHTML = domains.map((d, idx) => {
      const creationDate = d.creationDate || '';
      const dateLabel = creationDate ? `<span class="domain-date-label">${creationDate}</span>` : '';
      return `<div class="explore-url-item" data-domain="${d.domain}">
        <span class="domain-index">${idx + 1}.</span>
        <a href="https://${d.domain}" target="_blank" rel="noopener">${d.domain}</a>
        ${dateLabel}
      </div>`;
    }).join('');
    listEl.classList.remove('hidden');
  }
}

// ========== WHOIS 域名年龄查询 ==========
const WHOIS_SUPPORTED_SUFFIXES = ['com', 'box', 'net', 'org', 'me', 'xyz', 'im', 'info', 'io', 'co', 'ai', 'biz', 'us', 'app', 'sg', 'cafe', 'now', 'shop', 'life', 'cn', 'uk', 'chat', 'design', 'fun', 'website', 'link', 'site', 'online', 'cards', 'fr', 'sk', 'it', 'new', 'video'];
const WHOIS_CACHE_KEY = 'domain_whois_cache';

function isWhoisSuffixSupported(domain) {
  const parts = domain.split('.');
  const suffix = parts[parts.length - 1];
  return WHOIS_SUPPORTED_SUFFIXES.includes(suffix);
}

function parseWhoisDomain(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  const suffix = parts[parts.length - 1];
  const name = parts[parts.length - 2];
  return { name, suffix };
}

async function loadWhoisCache() {
  try {
    const result = await chrome.storage.local.get([WHOIS_CACHE_KEY]);
    return result[WHOIS_CACHE_KEY] || {};
  } catch (e) {
    return {};
  }
}

async function saveWhoisCache(cache) {
  try {
    await chrome.storage.local.set({ [WHOIS_CACHE_KEY]: cache });
  } catch (e) {
    console.warn('[WHOIS] Failed to save cache:', e);
  }
}

async function queryWhoisCreationDate(domain, cache) {
  if (cache[domain] !== undefined) {
    console.log('[WHOIS] 命中缓存:', { domain, creationDate: cache[domain] });
    return cache[domain];
  }
  if (!isWhoisSuffixSupported(domain)) {
    console.log('[WHOIS] 后缀不支持:', { domain });
    cache[domain] = null;
    return null;
  }
  const parsed = parseWhoisDomain(domain);
  if (!parsed) {
    console.log('[WHOIS] 域名解析失败:', { domain });
    cache[domain] = null;
    return null;
  }
  const { name, suffix } = parsed;
  const url = `https://whois.freeaiapi.xyz/?name=${name}&suffix=${suffix}&c=1`;
  const maxAttempts = 3;
  const retryDelayMs = 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      console.log('[WHOIS] 发起请求:', { domain, url, attempt: attempt + 1 });
      const response = await fetch(url);
      const data = await response.json();
      console.log('[WHOIS] API 响应:', { domain, status: data?.status, creation_datetime: data?.creation_datetime });
      let result = null;
      if (data && data.status === 'ok' && data.creation_datetime) {
        const dateStr = data.creation_datetime.trim();
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          result = date.toISOString().split('T')[0];
        }
      }
      cache[domain] = result;
      return result;
    } catch (e) {
      console.error('[WHOIS] Query failed:', { url, domain, attempt: attempt + 1, error: e });
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, retryDelayMs));
        continue;
      }
      cache[domain] = null;
      return null;
    }
  }
}

async function filterDomainsByAge(domains, maxYearsAgo = 5) {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - maxYearsAgo);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  console.log('[WHOIS] 开始批量筛选，截止日期:', cutoffStr, '待查询域名数:', domains.length);

  const cache = await loadWhoisCache();
  const results = [];
  const domainDates = [];

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    showExploreMessage(`[${i + 1}/${domains.length}] 查询 ${domain} 注册时间…`, 'info');
    const creationDate = await queryWhoisCreationDate(domain, cache);

    if (creationDate) {
      domainDates.push({ domain, creationDate });
      const passed = creationDate >= cutoffStr;
      console.log('[WHOIS] 查询结果:', { domain, creationDate, passed, cutoff: cutoffStr });
      if (passed) {
        results.push(domain);
      }
    } else {
      console.log('[WHOIS] 查询结果:', { domain, creationDate: null, passed: false, reason: '无法获取注册时间' });
    }
    // 域名间随机延迟 500-1000ms，避免触发限流
    if (i < domains.length - 1) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    }
  }

  await saveWhoisCache(cache);
  console.log('[WHOIS] 批量筛选完成:', { total: domains.length, passed: results.length, cutoffDate: cutoffStr });
  return { filtered: results, domainDates, cutoffDate: cutoffStr };
}

/**
 * 通过 CapSolver + Ahrefs 未公开 API 直接获取反链列表，无需打开页面。
 * 支持缓存：缓存有效期15天，过期后自动重新拉取
 * @param {string} domain
 * @param {number} idx
 * @param {number} total
 * @returns {Promise<{urlFromList: string[], backlinks: object[], overview: object, fromCache: boolean}>}
 */
async function fetchAhrefsBacklinksForDomain(domain, idx, total) {
  const maxAttempts = 3;
  const baseDelayMs = 3000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    showExploreMessage(`[${idx + 1}/${total}] 域名 ${domain}：正在通过 API 获取反链…（第 ${attempt + 1} 次尝试）`, 'info');
    try {
      // 为防止 background 卡住/通信失败：显式处理 lastError + 超时
      const resp = await new Promise((resolve, reject) => {
        let settled = false;
        const timeoutMs = 45000;
        const t = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error(`ahrefsDirectBacklinks 超时（>${timeoutMs}ms）`));
        }, timeoutMs);

        chrome.runtime.sendMessage({ action: 'ahrefsDirectBacklinks', domain }, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || String(lastErr)));
            return;
          }
          resolve(response);
        });
      });
      if (resp?.success && Array.isArray(resp.urlFromList)) {
        const result = {
          urlFromList: resp.urlFromList,
          backlinks: resp.backlinks || [],
          overview: resp.overview || {},
          fromCache: !!resp.fromCache
        };
        // Background 实际缓存在 IndexedDB；设置页「Ahrefs 域名缓存」读 chrome.storage 的 ahrefs_domain_cache，需同步一份供展示
        if (typeof saveAhrefsCacheForDomain === 'function') {
          try {
            const cacheKey = typeof normalizeDomain === 'function' ? normalizeDomain(domain) : domain;
            await saveAhrefsCacheForDomain(cacheKey, result);
          } catch (syncErr) {
            console.warn('[Ahrefs] 同步到 storage 缓存失败（设置页展示用）:', syncErr);
          }
        }
        const cacheText = result.fromCache ? '（缓存命中）' : '';
        showExploreMessage(`[${idx + 1}/${total}] 域名 ${domain} 获取到 ${resp.urlFromList.length} 条反链 ${cacheText} ✓`, 'success');
        return result;
      }

      const respErr = resp?.error || resp?.message || '未知错误';
      let respStr = '';
      try {
        respStr = JSON.stringify(resp);
      } catch {
        respStr = String(resp);
      }

      // 一些错误本质上不太可能通过重试解决：尽早返回，减少无效请求
      const lower = String(respErr).toLowerCase();
      const nonRetriable =
        lower.includes('未配置 capsolver api key') ||
        lower.includes('未配置 capsolver') ||
        lower.includes('unauthorized') ||
        lower.includes('forbidden') ||
        lower.includes('http 401') ||
        lower.includes('http 403');

      console.error('[Ahrefs] 请求失败', { action: 'ahrefsDirectBacklinks', domain, attempt: attempt + 1, respError: respErr, resp: respStr });
      showExploreMessage(
        `[${idx + 1}/${total}] 域名 ${domain} 拉取反链失败: ${respErr}（第 ${attempt + 1} 次尝试）`,
        'error'
      );

      if (nonRetriable) {
        showExploreMessage(`[${idx + 1}/${total}] 域名 ${domain} 错误类型不可重试，跳过该域名`, 'warning');
        return { urlFromList: [], backlinks: [], overview: {}, fromCache: false };
      }
    } catch (e) {
      console.error('[Ahrefs] 请求异常', {
        action: 'ahrefsDirectBacklinks',
        domain,
        attempt: attempt + 1,
        error: e
      });
      showExploreMessage(
        `[${idx + 1}/${total}] 域名 ${domain} 拉取反链异常: ${e?.message || e}（第 ${attempt + 1} 次尝试）`,
        'error'
      );
    }

    if (attempt < maxAttempts - 1) {
      const delay = baseDelayMs * (attempt + 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  showExploreMessage(`[${idx + 1}/${total}] 域名 ${domain} 多次尝试仍未成功，跳过该域名`, 'warning');
  return { urlFromList: [], backlinks: [], overview: {}, fromCache: false };
}

// ========== 初始化 ==========
async function init() {
  installSidepanelGlobalErrorLogging();

  // 获取当前活动标签页
  await updateCurrentTab();

  // 加载站点
  await loadSites();

  // 加载飞书同步条数限制
  const storage = await chrome.storage.local.get(['feishuSyncLimit']);
  if (storage.feishuSyncLimit) {
    feishuSyncLimit = storage.feishuSyncLimit;
    if (elements.feishuSyncLimit) {
      elements.feishuSyncLimit.value = String(feishuSyncLimit);
    }
  }

  // 根据当前模式获取页面状态
  if (currentMode === 'nav') {
    await getNavPageState();
  } else if (currentMode === 'blog') {
    await getCommentPageState();
  }

  // 设置事件监听
  setupEventListeners();

  // 同步站点下拉框
  syncNavSiteSelect();
  syncBlogSiteSelect();
  showModePanel(currentMode);

  // 初始化自动采集状态栏（尚未开始时也显示“未运行/无错误”）
  updateAutoCollectStatusDetails();

  // 恢复状态
  if (currentMode === 'blog') await restoreBlogPopupState();
  await tryShowLastVerifyResult();

  // 监听标签页变化
  setupTabChangeListener();

  // 加载飞书凭证
  await loadFeishuCredentials();
}

/**
 * 更新当前活动标签页
 */
async function updateCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];

    if (currentTab) {
      let hostname = '';
      try {
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
          hostname = new URL(currentTab.url).hostname;
        } else {
          hostname = currentTab.url || '—';
        }
      } catch (_) {
        hostname = currentTab.url || '—';
      }
      if (elements.navPageDomain) elements.navPageDomain.textContent = hostname;
      if (elements.blogPageDomain) elements.blogPageDomain.textContent = hostname;
    }
  } catch (error) {
    console.error('[SidePanel] Failed to get current tab:', error);
  }
}

/**
 * 设置标签页变化监听
 */
function setupTabChangeListener() {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // 仅当 Side Panel 可见时更新
    await updateCurrentTab();
    if (currentMode === 'nav') {
      await getNavPageState();
    } else if (currentMode === 'blog') {
      await getCommentPageState();
      await restoreBlogPopupState();
      await tryShowLastVerifyResult();
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tab.active && changeInfo.status === 'complete') {
      await updateCurrentTab();
      if (currentMode === 'nav') {
        await getNavPageState();
      } else if (currentMode === 'blog') {
        await getCommentPageState();
      }
    }
  });
}

// ========== 站点管理 ==========

async function loadSites() {
  try {
    const result = await chrome.storage.local.get(['sites', 'settings', 'sidePanelMode']);
    sites = result.sites || [];
    currentSiteId = result.settings?.currentSiteId;

    if (result.sidePanelMode === 'nav' || result.sidePanelMode === 'blog' || result.sidePanelMode === 'batch' || result.sidePanelMode === 'explore' || result.sidePanelMode === 'trends') {
      currentMode = result.sidePanelMode;
    }

    // 更新自动提交复选框
    if (elements.navAutoSubmit) {
      elements.navAutoSubmit.checked = result.settings?.autoSubmit ?? false;
    }
    if (elements.autoSubmit) {
      elements.autoSubmit.checked = result.settings?.autoSubmit ?? false;
    }
    if (elements.useFullAi) {
      elements.useFullAi.checked = result.settings?.useFullAi ?? false;
    }

    // 检查 LLM 是否启用
    const llmConfig = result.settings?.llmConfig;
    llmEnabled = !!(llmConfig?.enabled && llmConfig?.apiKey);

    // 更新站点下拉框
    syncNavSiteSelect();
    syncBlogSiteSelect();
    syncBatchSiteSelect();

    // 显示/隐藏无站点提示
    if (sites.length === 0) {
      elements.navNoSitesHint?.classList.remove('hidden');
      elements.navSiteSelect?.classList.add('hidden');
      elements.blogNoSitesHint?.classList.remove('hidden');
      elements.blogSiteSelect?.classList.add('hidden');
    } else {
      elements.navNoSitesHint?.classList.add('hidden');
      elements.navSiteSelect?.classList.remove('hidden');
      elements.blogNoSitesHint?.classList.add('hidden');
      elements.blogSiteSelect?.classList.remove('hidden');
    }

    updateCurrentSiteUrlDisplay();
  } catch (error) {
    console.error('[SidePanel] Failed to load sites:', error);
  }
}

function syncNavSiteSelect() {
  if (!elements.navSiteSelect) return;
  elements.navSiteSelect.innerHTML = '<option value="">-- 请选择站点 --</option>';
  sites.forEach((site) => {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = site.siteName || site.siteUrl || 'Unnamed';
    elements.navSiteSelect.appendChild(opt);
  });
  if (currentSiteId) elements.navSiteSelect.value = currentSiteId;
}

function syncBlogSiteSelect() {
  if (!elements.blogSiteSelect) return;
  elements.blogSiteSelect.innerHTML = '<option value="">-- 请选择站点 --</option>';
  sites.forEach((site) => {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = site.siteName || site.siteUrl || 'Unnamed';
    elements.blogSiteSelect.appendChild(opt);
  });
  if (currentSiteId) elements.blogSiteSelect.value = currentSiteId;
}

function syncBatchSiteSelect() {
  if (!elements.batchSiteSelect) return;
  elements.batchSiteSelect.innerHTML = '<option value="">-- 请选择站点 --</option>';
  sites.forEach((site) => {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = site.siteName || site.siteUrl || 'Unnamed';
    elements.batchSiteSelect.appendChild(opt);
  });
  if (currentSiteId) elements.batchSiteSelect.value = currentSiteId;
  updateBatchSiteUrlDisplay();
}

function updateBatchSiteUrlDisplay() {
  const site = currentSiteId ? sites.find(s => s.id === currentSiteId) : null;
  const url = site?.siteUrl?.trim() || '';

  if (elements.batchCurrentSiteUrl) {
    if (url) {
      elements.batchCurrentSiteUrl.textContent = url;
      elements.batchCurrentSiteUrl.classList.remove('hidden');
    } else {
      elements.batchCurrentSiteUrl.classList.add('hidden');
    }
  }

  // 更新提示
  if (elements.batchNoSitesHint) {
    elements.batchNoSitesHint.classList.toggle('hidden', sites.length > 0);
  }
}

function updateCurrentSiteUrlDisplay() {
  const site = currentSiteId ? sites.find(s => s.id === currentSiteId) : null;
  const url = site?.siteUrl?.trim() || '';
  if (elements.navCurrentSiteUrl) {
    if (url) {
      elements.navCurrentSiteUrl.textContent = url;
      elements.navCurrentSiteUrl.classList.remove('hidden');
    } else {
      elements.navCurrentSiteUrl.textContent = '';
      elements.navCurrentSiteUrl.classList.add('hidden');
    }
  }
  if (elements.blogCurrentSiteUrl) {
    if (url) {
      elements.blogCurrentSiteUrl.textContent = url;
      elements.blogCurrentSiteUrl.classList.remove('hidden');
    } else {
      elements.blogCurrentSiteUrl.textContent = '';
      elements.blogCurrentSiteUrl.classList.add('hidden');
    }
  }
}

// ========== 模式切换 ==========

function showModePanel(mode) {
  currentMode = mode;
  chrome.storage.local.set({ sidePanelMode: currentMode });
  elements.modeTabs?.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  if (elements.panelNav) elements.panelNav.classList.toggle('hidden', mode !== 'nav');
  if (elements.panelBlog) elements.panelBlog.classList.toggle('hidden', mode !== 'blog');
  if (elements.panelBatch) elements.panelBatch.classList.toggle('hidden', mode !== 'batch');
  if (elements.panelExplore) elements.panelExplore.classList.toggle('hidden', mode !== 'explore');
  if (elements.panelTrends) elements.panelTrends.classList.toggle('hidden', mode !== 'trends');

  if (mode === 'nav') {
    getNavPageState();
  } else if (mode === 'blog') {
    getCommentPageState();
    restoreBlogPopupState();
    tryShowLastVerifyResult();
  } else if (mode === 'batch') {
    // 切换到批量提交 tab 时，如果还没有数据则自动触发飞书同步
    autoSyncIfNeeded();
  } else if (mode === 'explore') {
    loadExploreState();
  } else if (mode === 'trends') {
    loadTrendsState().catch((e) => console.warn('[Trends] loadTrendsState failed', e));
    updateTrendsSeedCountUI();
    updateTrendsStatusUI();
    renderTrendsResults();
  }
}

// ========== Trends 挖词：核心逻辑 ==========

function normalizeKeyword(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseSeedLines(text) {
  // 支持换行或英文逗号分隔
  return String(text || '')
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function mapTimeRangeToTrends(timeRange) {
  // https://trends.google.com/trends/explore uses values like: "now 7-d", "today 3-m"
  if (timeRange === 'now_7d') return 'now 7-d';
  if (timeRange === 'today_1m') return 'today 1-m';
  if (timeRange === 'today_3m') return 'today 3-m';
  if (timeRange === 'today_12m') return 'today 12-m';
  if (timeRange === 'today_5y') return 'today 5-y';
  return 'today 3-m';
}

function safeJsonParseTrends(text) {
  // Trends API responses start with )]}'
  const cleaned = String(text || '').trim().replace(/^\)\]\}',?\s*/, '');
  return JSON.parse(cleaned);
}

function parseRisePctFromFormatted(formattedValue) {
  const raw = String(formattedValue || '').trim();
  if (!raw) return null;
  if (/breakout/i.test(raw)) return TRENDS_BREAKOUT_RISE_PCT;
  // Examples: "+120%", "120%"
  const m = raw.replace(/,/g, '').match(/(-?\d+(\.\d+)?)\s*%/);
  if (m) return Number(m[1]);
  return null;
}

function trendsSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function fetchTextWithRetry(url, { signal, credentials = 'omit' } = {}, retryOptions = {}) {
  const {
    maxAttempts = 5,
    baseDelayMs = 2500,
    maxDelayMs = 30000
  } = retryOptions || {};

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(url, { method: 'GET', credentials, signal });
      if (res.ok) return await res.text();

      const status = res.status;
      const statusText = res.statusText || '';
      const body = await res.text().catch(() => '');

      // 429/503: backoff
      if ((status === 429 || status === 503) && attempt < maxAttempts) {
        const jitter = Math.floor(Math.random() * 600);
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1) + jitter);
        trendsJob.lastError = `Trends 触发限流（${status} ${statusText}），正在第 ${attempt}/${maxAttempts} 次退避重试（等待 ${Math.round(delay / 1000)}s）`;
        updateTrendsStatusUI();
        await trendsSleep(delay, signal);
        continue;
      }

      const snippet = body ? body.slice(0, 160) : '';
      throw new Error(`HTTP ${status} ${statusText}${snippet ? ` - ${snippet}` : ''}`);
    } catch (e) {
      lastErr = e;
      // 网络错误也做退避
      if (attempt < maxAttempts && (e?.name !== 'AbortError')) {
        const jitter = Math.floor(Math.random() * 600);
        const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1) + jitter);
        console.error('[Trends挖词] fetchTextWithRetry 单次失败，将重试', { attempt, maxAttempts, url: String(url).slice(0, 240), error: e });
        await trendsSleep(delay, signal).catch(() => {});
        continue;
      }
      console.error('[Trends挖词] fetchTextWithRetry 最终失败', { attempt, maxAttempts, url: String(url).slice(0, 240), error: e });
      throw e;
    }
  }

  throw lastErr || new Error('Trends 请求失败');
}

async function ensureTrendsWorkerTab(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (trendsWorkerTabId) {
    const t = await chrome.tabs.get(trendsWorkerTabId).catch(() => null);
    if (t?.id) return t.id;
    trendsWorkerTabId = null;
  }

  const tab = await chrome.tabs.create({
    url: TRENDS_WORKER_PAGE_URL,
    active: false
  });
  trendsWorkerTabId = tab.id;
  await waitForTabCompleteInSidepanel(tab.id, 30000);
  return tab.id;
}

async function getActiveTabSafe() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isGoogleTrendsTabUrl(url) {
  try {
    if (!url) return false;
    const u = new URL(url);
    return u.hostname === 'trends.google.com' && u.pathname.startsWith('/trends/');
  } catch (_) {
    return false;
  }
}

/**
 * 获取本次任务要使用的 Trends 工作页 tabId
 * - 需求：点击“开始采集数据”时，使用当前激活 Tab，而不是另开 Tab
 */
async function getTrendsTargetTabId(signal) {
  const active = await getActiveTabSafe().catch(() => null);
  if (active?.id && isGoogleTrendsTabUrl(active.url)) {
    trendsWorkerTabId = active.id;
    return active.id;
  }
  // 回退：如果之前已有工作 Tab 还在，也允许继续用（但不再主动新建）
  if (trendsWorkerTabId) {
    const t = await chrome.tabs.get(trendsWorkerTabId).catch(() => null);
    if (t?.id) return t.id;
    trendsWorkerTabId = null;
  }
  throw new Error('请先切换到 Google Trends 页面（trends.google.com）再开始采集，或点击「打开 Trends 工作页」进入后再开始。');
}

function buildTrendsExploreUrl({ hl, timeRange, keywords }) {
  // 参考日志：/trends/explore?date=today 3-m&q=gpts,ai video&hl=en-US
  const date = mapTimeRangeToTrends(timeRange);
  const q = (Array.isArray(keywords) ? keywords : []).map((k) => String(k || '').trim()).filter(Boolean);
  const url = new URL('https://trends.google.com/trends/explore');
  url.searchParams.set('date', date);
  url.searchParams.set('q', q.join(','));
  url.searchParams.set('hl', hl || TRENDS_DEFAULT_HL);
  return url.toString();
}

function bindTrendsWebRequestOnce() {
  if (trendsWebRequestBound) return;
  trendsWebRequestBound = true;
  // 仅用于“观察 Trends 页面发出的结构化请求 URL”，body 仍需二次 fetch（与日志一致）
  chrome.webRequest.onCompleted.addListener(
    () => {},
    { urls: ['https://trends.google.com/trends/api/widgetdata/relatedsearches*'] }
  );
  chrome.webRequest.onCompleted.addListener(
    () => {},
    { urls: ['https://trends.google.com/trends/api/widgetdata/multiline*'] }
  );
}

async function collectMultilineByIntercept({ tabId, expectedKeywordsNorm, timeoutMs = 20000, signal }) {
  bindTrendsWebRequestOnce();
  let captured = null; // { url, data, keywordOrder }

  const handler = async (details) => {
    try {
      if (signal?.aborted) return;
      if (details.tabId !== tabId) return;
      const u = new URL(details.url);
      const reqParam = u.searchParams.get('req');
      if (!reqParam) return;
      const reqJson = JSON.parse(reqParam);
      const comparison = Array.isArray(reqJson?.comparisonItem) ? reqJson.comparisonItem : [];
      const keywordOrder = comparison
        .map((ci) => ci?.complexKeywordsRestriction?.keyword?.[0]?.value)
        .map((k) => normalizeKeyword(k))
        .filter(Boolean);
      for (const k of expectedKeywordsNorm) {
        if (!keywordOrder.includes(k)) return;
      }
      if (captured) return;

      const text = await fetchTextWithRetry(details.url, { signal, credentials: 'include' }, { maxAttempts: 3, baseDelayMs: 2500, maxDelayMs: 15000 });
      const json = safeJsonParseTrends(text);
      captured = { url: details.url, data: json, keywordOrder };
    } catch (err) {
      console.error('[Trends挖词] multiline 拦截/拉取失败', err, details?.url ? String(details.url).slice(0, 240) : '');
    }
  };

  chrome.webRequest.onCompleted.addListener(handler, { urls: ['https://trends.google.com/trends/api/widgetdata/multiline*'] });
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) break;
      if (captured) break;
      await trendsSleep(300, signal).catch(() => {});
    }
  } finally {
    chrome.webRequest.onCompleted.removeListener(handler);
  }

  return captured;
}

function computeAvgInterestFromMultiline(multilineJson) {
  const timeline = multilineJson?.default?.timelineData;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  const dim = Array.isArray(timeline[0]?.value) ? timeline[0].value.length : 0;
  if (!dim) return null;
  const sums = new Array(dim).fill(0);
  const counts = new Array(dim).fill(0);
  for (const row of timeline) {
    const vals = Array.isArray(row?.value) ? row.value : [];
    for (let i = 0; i < dim; i++) {
      const v = vals[i];
      if (typeof v === 'number') {
        sums[i] += v;
        counts[i] += 1;
      }
    }
  }
  return sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
}

function keywordMatchesExcludeList(keyword, excludeList) {
  const s = String(keyword || '').toLowerCase();
  for (const w of excludeList || []) {
    const ww = String(w || '').trim().toLowerCase();
    if (!ww) continue;
    if (s.includes(ww)) return ww;
  }
  return null;
}

async function collectRelatedSearchesByIntercept({ tabId, expectedKeywordsNorm, timeoutMs = 20000, signal }) {
  bindTrendsWebRequestOnce();
  const collected = new Map(); // keywordNorm -> { url, data }

  const handler = async (details) => {
    try {
      if (signal?.aborted) return;
      if (details.tabId !== tabId) return;
      const u = new URL(details.url);
      const reqParam = u.searchParams.get('req');
      if (!reqParam) return;
      const reqJson = JSON.parse(reqParam);
      const kw = reqJson?.restriction?.complexKeywordsRestriction?.keyword?.[0]?.value;
      const kwNorm = normalizeKeyword(kw);
      if (!kwNorm) return;
      if (!expectedKeywordsNorm.has(kwNorm)) return;
      if (collected.has(kwNorm)) return;

      // 二次 fetch 拿 body（这就是日志里 “onCompleted -> Fetching response data” 的做法）
      const text = await fetchTextWithRetry(details.url, { signal, credentials: 'include' }, { maxAttempts: 3, baseDelayMs: 2500, maxDelayMs: 15000 });
      const json = safeJsonParseTrends(text);
      collected.set(kwNorm, { url: details.url, data: json });
    } catch (err) {
      console.error('[Trends挖词] relatedsearches 拦截/拉取失败', err, details?.url ? String(details.url).slice(0, 280) : '');
    }
  };

  chrome.webRequest.onCompleted.addListener(handler, { urls: ['https://trends.google.com/trends/api/widgetdata/relatedsearches*'] });
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) break;
      if (collected.size >= expectedKeywordsNorm.size) break;
      await trendsSleep(350, signal).catch(() => {});
    }
  } finally {
    chrome.webRequest.onCompleted.removeListener(handler);
  }

  return collected;
}

async function checkTrendsLoggedIn(tabId) {
  // 尽量不依赖 DOM 结构：直接在页面上下文发一个最小 explore，检查 widget.request 中 userConfig.userType
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [{ hl: 'en-US', tz: TRENDS_DEFAULT_TZ }],
    func: async ({ hl, tz }) => {
      const safeJsonParseTrends = (text) => {
        const cleaned = String(text || '').trim().replace(/^\)\]\}',?\s*/, '');
        return JSON.parse(cleaned);
      };
      const exploreReq = { comparisonItem: [{ keyword: 'gpts', geo: '', time: 'today 3-m' }], category: 0, property: '' };
      const exploreUrl = new URL('https://trends.google.com/trends/api/explore');
      exploreUrl.searchParams.set('hl', hl);
      exploreUrl.searchParams.set('tz', String(tz));
      exploreUrl.searchParams.set('req', JSON.stringify(exploreReq));
      const res = await fetch(exploreUrl.toString(), { method: 'GET', credentials: 'include' });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 120) };
      const j = safeJsonParseTrends(text);
      const widgets = Array.isArray(j?.widgets) ? j.widgets : [];
      const rq = widgets.find((w) => w?.id === 'RELATED_QUERIES')?.request;
      const userType = rq?.userConfig?.userType || null;
      return { ok: true, userType };
    }
  });

  if (!result?.ok) return { ok: false, userType: null, reason: `explore 失败 ${result?.status || ''}`.trim() };
  const userType = String(result.userType || '');
  // 注意：即使用户已登录，Trends 也可能返回 USER_TYPE_SCRAPER（取决于风控、频率、地区等），不能作为“未登录”的硬条件。
  const isLegitUser = userType.includes('LEGIT_USER');
  return { ok: true, userType, isLegitUser };
}

async function fetchTrendsRisingRelatedQueriesInPageContext({ keyword, timeRange, geo = '', hl = TRENDS_DEFAULT_HL, tz = TRENDS_DEFAULT_TZ, signal }) {
  const tabId = await ensureTrendsWorkerTab(signal);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [{ keyword, timeRange, geo, hl, tz }],
    func: async ({ keyword, timeRange, geo, hl, tz }) => {
      const mapTimeRangeToTrends = (tr) => {
        if (tr === 'now_7d') return 'now 7-d';
        if (tr === 'today_1m') return 'today 1-m';
        if (tr === 'today_3m') return 'today 3-m';
        if (tr === 'today_12m') return 'today 12-m';
        if (tr === 'today_5y') return 'today 5-y';
        return 'today 3-m';
      };
      const safeJsonParseTrends = (text) => {
        const cleaned = String(text || '').trim().replace(/^\)\]\}',?\s*/, '');
        return JSON.parse(cleaned);
      };

      const exploreReq = {
        comparisonItem: [{ keyword, geo, time: mapTimeRangeToTrends(timeRange) }],
        category: 0,
        property: ''
      };

      const exploreUrl = new URL('https://trends.google.com/trends/api/explore');
      exploreUrl.searchParams.set('hl', hl);
      exploreUrl.searchParams.set('tz', String(tz));
      exploreUrl.searchParams.set('req', JSON.stringify(exploreReq));

      const exploreRes = await fetch(exploreUrl.toString(), { method: 'GET', credentials: 'include' });
      if (!exploreRes.ok) {
        const body = await exploreRes.text().catch(() => '');
        throw new Error(`Trends explore 请求失败: ${exploreRes.status} ${exploreRes.statusText}${body ? ` - ${body.slice(0, 160)}` : ''}`);
      }
      const exploreText = await exploreRes.text();
      const exploreJson = safeJsonParseTrends(exploreText);
      const widgets = Array.isArray(exploreJson?.widgets) ? exploreJson.widgets : [];

      const relatedQueriesWidget =
        widgets.find((w) => w?.id === 'RELATED_QUERIES') ||
        widgets.find((w) => String(w?.title || '').toLowerCase().includes('related queries')) ||
        widgets.find((w) => String(w?.type || '').toLowerCase().includes('related_queries'));

      if (!relatedQueriesWidget?.token || !relatedQueriesWidget?.request) {
        throw new Error('Trends 返回缺少 RELATED_QUERIES widget（可能被限流或结构变更）');
      }

      const relatedUrl = new URL('https://trends.google.com/trends/api/widgetdata/relatedsearches');
      relatedUrl.searchParams.set('hl', hl);
      relatedUrl.searchParams.set('tz', String(tz));
      relatedUrl.searchParams.set('req', JSON.stringify(relatedQueriesWidget.request));
      relatedUrl.searchParams.set('token', relatedQueriesWidget.token);

      const relatedRes = await fetch(relatedUrl.toString(), { method: 'GET', credentials: 'include' });
      if (!relatedRes.ok) {
        const body = await relatedRes.text().catch(() => '');
        throw new Error(`Trends relatedsearches 请求失败: ${relatedRes.status} ${relatedRes.statusText}${body ? ` - ${body.slice(0, 160)}` : ''}`);
      }
      const relatedText = await relatedRes.text();
      const relatedJson = safeJsonParseTrends(relatedText);

      const rankedLists = relatedJson?.default?.rankedList;
      if (!Array.isArray(rankedLists) || rankedLists.length === 0) return [];

      const risingList =
        rankedLists.find((x) => String(x?.title || '').toLowerCase().includes('rising')) ||
        rankedLists[1] ||
        rankedLists[0];

      const kws = Array.isArray(risingList?.rankedKeyword) ? risingList.rankedKeyword : [];
      return kws
        .map((k) => ({
          query: k?.query,
          formattedValue: k?.formattedValue,
          value: k?.value
        }))
        .filter((x) => x.query);
    }
  });

  if (!Array.isArray(result)) throw new Error('Trends 页面上下文返回异常');
  return result;
}

async function fetchTrendsRisingRelatedQueries({ keyword, timeRange, geo = '', hl = TRENDS_DEFAULT_HL, tz = TRENDS_DEFAULT_TZ, signal }) {
  // 优先使用“真实 Trends 页面上下文”发起请求，显著降低 429 概率（参考你给的日志实现）
  try {
    return await fetchTrendsRisingRelatedQueriesInPageContext({ keyword, timeRange, geo, hl, tz, signal });
  } catch (e) {
    // 如果 worker tab 失效/脚本注入失败，再退回到 extension fetch（仍有退避重试）
    console.error('[Trends挖词]页面上下文拉取失败，将回退到扩展内 fetch', e);
    trendsJob.lastError = e?.message || String(e);
    updateTrendsStatusUI();
  }

  const exploreReq = {
    comparisonItem: [{ keyword, geo, time: mapTimeRangeToTrends(timeRange) }],
    category: 0,
    property: ''
  };

  const exploreUrl = new URL('https://trends.google.com/trends/api/explore');
  exploreUrl.searchParams.set('hl', hl);
  exploreUrl.searchParams.set('tz', String(tz));
  exploreUrl.searchParams.set('req', JSON.stringify(exploreReq));

  const exploreText = await fetchTextWithRetry(
    exploreUrl.toString(),
    { signal, credentials: 'omit' },
    { maxAttempts: 5, baseDelayMs: 2500, maxDelayMs: 30000 }
  );
  const exploreJson = safeJsonParseTrends(exploreText);
  const widgets = Array.isArray(exploreJson?.widgets) ? exploreJson.widgets : [];

  const relatedQueriesWidget =
    widgets.find((w) => w?.id === 'RELATED_QUERIES') ||
    widgets.find((w) => String(w?.title || '').toLowerCase().includes('related queries')) ||
    widgets.find((w) => String(w?.type || '').toLowerCase().includes('related_queries'));

  if (!relatedQueriesWidget?.token || !relatedQueriesWidget?.request) {
    throw new Error('Trends 返回缺少 RELATED_QUERIES widget（可能被限流或结构变更）');
  }

  const relatedUrl = new URL('https://trends.google.com/trends/api/widgetdata/relatedsearches');
  relatedUrl.searchParams.set('hl', hl);
  relatedUrl.searchParams.set('tz', String(tz));
  relatedUrl.searchParams.set('req', JSON.stringify(relatedQueriesWidget.request));
  relatedUrl.searchParams.set('token', relatedQueriesWidget.token);

  const relatedText = await fetchTextWithRetry(
    relatedUrl.toString(),
    { signal, credentials: 'omit' },
    { maxAttempts: 5, baseDelayMs: 2500, maxDelayMs: 30000 }
  );
  const relatedJson = safeJsonParseTrends(relatedText);

  const rankedLists = relatedJson?.default?.rankedList;
  if (!Array.isArray(rankedLists) || rankedLists.length === 0) return [];

  // Prefer rising list
  const risingList =
    rankedLists.find((x) => String(x?.title || '').toLowerCase().includes('rising')) ||
    rankedLists[1] ||
    rankedLists[0];

  const kws = Array.isArray(risingList?.rankedKeyword) ? risingList.rankedKeyword : [];
  return kws
    .map((k) => ({
      query: k?.query,
      formattedValue: k?.formattedValue,
      value: k?.value
    }))
    .filter((x) => x.query);
}

function updateTrendsSeedCountUI() {
  const lines = parseSeedLines(elements.trendsSeedKeywords?.value || '');
  if (elements.trendsSeedCount) {
    elements.trendsSeedCount.textContent = `${lines.length} 条`;
    elements.trendsSeedCount.classList.toggle('hidden', lines.length === 0);
  }
}

function setTrendsExploreMode(mode) {
  trendsExploreMode = mode === 'longtail' ? 'longtail' : 'potential';
  if (elements.trendsModePotentialBtn) {
    elements.trendsModePotentialBtn.classList.toggle('active', trendsExploreMode === 'potential');
    elements.trendsModePotentialBtn.setAttribute('aria-selected', trendsExploreMode === 'potential' ? 'true' : 'false');
  }
  if (elements.trendsModeLongtailBtn) {
    elements.trendsModeLongtailBtn.classList.toggle('active', trendsExploreMode === 'longtail');
    elements.trendsModeLongtailBtn.setAttribute('aria-selected', trendsExploreMode === 'longtail' ? 'true' : 'false');
  }
  if (elements.trendsModeCardParent) {
    elements.trendsModeCardParent.classList.toggle('mode-potential', trendsExploreMode === 'potential');
    elements.trendsModeCardParent.classList.toggle('mode-longtail', trendsExploreMode === 'longtail');
  }
}

function updateTrendsStatusUI() {
  if (elements.trendsStatusRound) elements.trendsStatusRound.textContent = trendsJob.running ? String(trendsJob.round) : '-';
  if (elements.trendsStatusProcessed) elements.trendsStatusProcessed.textContent = String(trendsJob.processed || 0);
  if (elements.trendsStatusFound) elements.trendsStatusFound.textContent = String(trendsJob.results?.size || 0);
  if (elements.trendsStatusError) elements.trendsStatusError.textContent = trendsJob.lastError ? String(trendsJob.lastError) : '无';

  const errSnap = trendsJob.lastError != null && String(trendsJob.lastError).trim() !== '' ? String(trendsJob.lastError) : null;
  if (errSnap !== trendsLastErrorConsoleSnapshot) {
    trendsLastErrorConsoleSnapshot = errSnap;
    if (errSnap) console.error('[Trends挖词] 状态错误:', errSnap);
  }

  if (elements.trendsStartBtn) elements.trendsStartBtn.disabled = trendsJob.running;
  if (elements.trendsStopBtn) elements.trendsStopBtn.disabled = !trendsJob.running;
  if (elements.trendsExportBtn) elements.trendsExportBtn.disabled = (trendsJob.results?.size || 0) === 0;
}

function renderTrendsResults() {
  const el = elements.trendsResultsList;
  if (!el) return;

  const items = Array.from(trendsJob.results.values()).sort((a, b) => (b.volumePct ?? 0) - (a.volumePct ?? 0));

  if (elements.trendsResultCount) {
    elements.trendsResultCount.textContent = `${items.length} 个`;
    elements.trendsResultCount.classList.toggle('hidden', items.length === 0);
  }

  if (items.length === 0) {
    el.innerHTML = '<div class="empty-list-hint">暂无，请点击“开始采集数据”</div>';
    return;
  }

  el.innerHTML = '';
  for (const it of items.slice(0, 300)) {
    const row = document.createElement('div');
    row.className = 'explore-url-item';
    const volText = typeof it.volumePct === 'number' ? `${it.volumePct}%` : '—';
    row.innerHTML = `
      <div class="explore-url-main">
        <div class="explore-url-title" style="display:flex; gap:8px; align-items:center;">
          <span style="font-weight:600;">${escapeHtml(it.keyword)}</span>
          <span class="badge" style="margin-left:auto;">${escapeHtml(volText)}</span>
        </div>
        <div class="explore-url-meta" style="display:flex; gap:10px; opacity:.85; font-size:12px;">
          <span>轮次 ${escapeHtml(String(it.round ?? '—'))}</span>
          ${it.parent ? `<span>来自：${escapeHtml(it.parent)}</span>` : '<span>来自：种子</span>'}
          ${typeof it.avgIndex === 'number' && typeof it.baseAvgIndex === 'number' ? `<span>avg:${escapeHtml(it.avgIndex.toFixed(1))}/${escapeHtml(it.baseAvgIndex.toFixed(1))}</span>` : ''}
        </div>
      </div>
    `;
    el.appendChild(row);
  }
}

async function loadTrendsState() {
  const stored = await chrome.storage.local.get([TRENDS_STATE_KEY, TRENDS_HISTORY_KEY]);
  const state = stored[TRENDS_STATE_KEY] || null;
  const history = stored[TRENDS_HISTORY_KEY] || [];

  if (state && typeof state === 'object') {
    if (typeof state.exploreMode === 'string') setTrendsExploreMode(state.exploreMode);
    if (elements.trendsBaselineKeyword && typeof state.baseline === 'string') elements.trendsBaselineKeyword.value = state.baseline;
    if (elements.trendsSeedKeywords && typeof state.seedsText === 'string') elements.trendsSeedKeywords.value = state.seedsText;
    if (elements.trendsTimeRange && typeof state.timeRange === 'string') elements.trendsTimeRange.value = state.timeRange;
    if (elements.trendsRiseThreshold && typeof state.threshold === 'number') elements.trendsRiseThreshold.value = String(state.threshold);
    if (elements.trendsKeywordLimit && typeof state.keywordLimit === 'number') elements.trendsKeywordLimit.value = String(state.keywordLimit);
    if (elements.trendsMaxRounds && typeof state.maxRounds === 'number') elements.trendsMaxRounds.value = String(state.maxRounds);
    if (elements.trendsExcludeWords && typeof state.excludeWordsText === 'string') elements.trendsExcludeWords.value = state.excludeWordsText;
  }
  if (elements.trendsExcludeWords && !String(elements.trendsExcludeWords.value || '').trim()) {
    elements.trendsExcludeWords.value = TRENDS_DEFAULT_EXCLUDE_WORDS.join('\n');
  }
  if (!state?.exploreMode) setTrendsExploreMode('potential');

  updateTrendsSeedCountUI();
  renderTrendsHistory(history);
}

async function persistTrendsFormState() {
  const state = {
    exploreMode: trendsExploreMode,
    baseline: elements.trendsBaselineKeyword?.value || '',
    seedsText: elements.trendsSeedKeywords?.value || '',
    timeRange: elements.trendsTimeRange?.value || 'today_3m',
    threshold: Number(elements.trendsRiseThreshold?.value || 20),
    keywordLimit: Number(elements.trendsKeywordLimit?.value || 200),
    maxRounds: Number(elements.trendsMaxRounds?.value || 20),
    excludeWordsText: elements.trendsExcludeWords?.value || ''
  };
  await chrome.storage.local.set({ [TRENDS_STATE_KEY]: state });
}

function renderTrendsHistory(history) {
  const el = elements.trendsHistoryList;
  if (!el) return;
  const list = Array.isArray(history) ? history : [];
  if (list.length === 0) {
    el.innerHTML = '<div class="empty-list-hint">暂无</div>';
    return;
  }
  el.innerHTML = '';
  for (const item of list.slice(0, 50)) {
    const row = document.createElement('div');
    row.className = 'explore-url-item';
    const seedsPreview = Array.isArray(item.seeds) ? item.seeds.slice(0, 3).join(', ') : '';
    row.innerHTML = `
      <div class="explore-url-main">
        <div class="explore-url-title" style="display:flex; gap:8px; align-items:center;">
          <span style="font-weight:600;">${escapeHtml(item.time || '')}</span>
          <span class="badge" style="margin-left:auto;">${escapeHtml(item.status || '')}</span>
        </div>
        <div class="explore-url-meta" style="font-size:12px; opacity:.85;">
          <div>种子：${escapeHtml(seedsPreview || '—')}</div>
          <div>时间范围：${escapeHtml(item.timeRange || '—')}，阈值：${escapeHtml(String(item.threshold ?? '—'))}%，上限：${escapeHtml(String(item.keywordLimit ?? '—'))}</div>
        </div>
      </div>
    `;
    el.appendChild(row);
  }
}

async function appendTrendsHistory(entry) {
  const stored = await chrome.storage.local.get([TRENDS_HISTORY_KEY]);
  const history = Array.isArray(stored[TRENDS_HISTORY_KEY]) ? stored[TRENDS_HISTORY_KEY] : [];
  history.unshift(entry);
  await chrome.storage.local.set({ [TRENDS_HISTORY_KEY]: history.slice(0, 100) });
  renderTrendsHistory(history);
}

function buildTrendsCsv() {
  const rows = [['keyword', 'volumePct', 'avgIndex', 'baseAvgIndex', 'round', 'parent', 'collectedAt']];
  for (const it of Array.from(trendsJob.results.values()).sort((a, b) => (b.volumePct ?? 0) - (a.volumePct ?? 0))) {
    rows.push([
      it.keyword,
      String(it.volumePct ?? ''),
      String(it.avgIndex ?? ''),
      String(it.baseAvgIndex ?? ''),
      String(it.round ?? ''),
      String(it.parent ?? ''),
      String(it.collectedAt ?? '')
    ]);
  }
  return rows
    .map((r) =>
      r
        .map((c) => {
          const v = String(c ?? '');
          if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
          return v;
        })
        .join(',')
    )
    .join('\n');
}

function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function startTrendsJob() {
  if (trendsJob.running) return;
  await persistTrendsFormState();

  const baseline = String(elements.trendsBaselineKeyword?.value || '').trim();
  const seeds = parseSeedLines(elements.trendsSeedKeywords?.value || '');
  const timeRange = elements.trendsTimeRange?.value || 'today_3m';
  const threshold = Number(elements.trendsRiseThreshold?.value || 20);
  const keywordLimit = Number(elements.trendsKeywordLimit?.value || 200);
  const maxRounds = Number(elements.trendsMaxRounds?.value || 20);
  const excludeWords = parseSeedLines(elements.trendsExcludeWords?.value || '').map((x) => x.toLowerCase()).filter(Boolean);
  const exploreMode = trendsExploreMode; // potential | longtail

  if (seeds.length === 0) {
    trendsJob.lastError = '请至少输入 1 个种子关键词';
    updateTrendsStatusUI();
    return;
  }
  if (!baseline) {
    trendsJob.lastError = '请填写基准关键词（例如 gpts）';
    updateTrendsStatusUI();
    return;
  }
  if (!Number.isFinite(threshold) || threshold < 1) {
    trendsJob.lastError = '有效词阈值需为 >= 1 的整数（表示相对基准词的百分比）';
    updateTrendsStatusUI();
    return;
  }
  if (!Number.isFinite(keywordLimit) || keywordLimit < 1) {
    trendsJob.lastError = '关键词上限需为 >= 1 的整数';
    updateTrendsStatusUI();
    return;
  }
  if (!Number.isFinite(maxRounds) || maxRounds < 1) {
    trendsJob.lastError = '最大轮次需为 >= 1 的整数';
    updateTrendsStatusUI();
    return;
  }

  const jobId = `trends_${Date.now()}`;
  trendsJob = {
    running: true,
    stopping: false,
    abortController: new AbortController(),
    jobId,
    startedAt: Date.now(),
    round: 0,
    processed: 0,
    lastError: null,
    queued: seeds.slice(),
    seenSeeds: new Set(seeds.map(normalizeKeyword)),
    results: new Map(),
    newlyAddedThisRound: new Set()
  };
  trendsLastErrorConsoleSnapshot = null;
  updateTrendsStatusUI();
  renderTrendsResults();

  try {
    await appendTrendsHistory({
      jobId,
      time: new Date().toLocaleString(),
      status: '运行中',
      baseline,
      seeds: seeds.slice(0, 20),
      timeRange,
      threshold,
      keywordLimit,
      maxRounds
    });
  } catch (e) {
    console.error('[Trends挖词] 写入「运行中」历史失败', e);
  }

  const signal = trendsJob.abortController.signal;
  const globalSeenResult = new Set();

  try {
    // 1) 确保在 Trends 界面（按你的限定条件：必须在 Google Trends 界面）
    const workerTabId = await getTrendsTargetTabId(signal);

    for (let r = 1; r <= maxRounds; r++) {
      if (signal.aborted) break;
      trendsJob.round = r;
      trendsJob.newlyAddedThisRound = new Set();
      updateTrendsStatusUI();

      const currentQueue = trendsJob.queued.slice();
      trendsJob.queued = [];

      if (currentQueue.length === 0) {
        const msg = `第 ${r} 轮：下一轮种子为空，任务结束（没有可继续拓展的关键词）。`;
        console.info('[Trends挖词] stop reason:', msg);
        trendsJob.lastError = msg;
        updateTrendsStatusUI();
        break;
      }
      console.info('[Trends挖词] round start', { round: r, seeds: currentQueue.length, thresholdPct: threshold, keywordLimit, maxRounds });

      // 2) 按日志模式：在 explore 页面里“跳转新路径”触发请求，并拦截 multiline + relatedsearches 结构化请求
      // 每次 explore 最多放 1 个 baseline + 4 个关键词
      const batchSize = 4;
      const seedsForRound = currentQueue.slice();
      for (let i = 0; i < seedsForRound.length; i += batchSize) {
        if (signal.aborted) break;
        const batchSeeds = seedsForRound.slice(i, i + batchSize);
        const batchSeedsFiltered = batchSeeds.filter((kw) => !keywordMatchesExcludeList(kw, excludeWords));
        if (batchSeedsFiltered.length === 0) continue;
        const exploreKeywords = [baseline, ...batchSeedsFiltered].filter(Boolean);
        const expectedNorm = new Set(batchSeedsFiltered.map(normalizeKeyword).filter(Boolean));
        const expectedWithBaseline = new Set([normalizeKeyword(baseline), ...Array.from(expectedNorm)]);

        // 2.1 跳转到 explore 新路径（满足“可操作界面跳转新路径”）
        const exploreUrl = buildTrendsExploreUrl({ hl: 'en-US', timeRange, keywords: exploreKeywords });
        await chrome.tabs.update(workerTabId, { url: exploreUrl, active: false });
        await waitForTabCompleteInSidepanel(workerTabId, 30000);

        // 2.2 拦截 multiline（用于计算“相对基准词”的搜索量百分比）
        const multilineCaptured = await collectMultilineByIntercept({
          tabId: workerTabId,
          expectedKeywordsNorm: expectedWithBaseline,
          timeoutMs: 20000,
          signal
        });
        const avgArr = multilineCaptured?.data ? computeAvgInterestFromMultiline(multilineCaptured.data) : null;
        const order = multilineCaptured?.keywordOrder || [];
        const baseIdx = order.indexOf(normalizeKeyword(baseline));
        const baseAvg = avgArr && baseIdx >= 0 ? avgArr[baseIdx] : null;

        // 2.3 拦截 relatedsearches，并二次 fetch body（用于拓展下一轮）
        const intercepted = await collectRelatedSearchesByIntercept({
          tabId: workerTabId,
          expectedKeywordsNorm: expectedNorm,
          timeoutMs: 20000,
          signal
        });
        console.info('[Trends挖词] intercepted', { round: r, batchSeeds: batchSeedsFiltered.length, relatedCaptured: intercepted.size, hasMultiline: !!avgArr, baseAvg });

        for (const seed of batchSeedsFiltered) {
          if (signal.aborted) break;
          const seedNorm = normalizeKeyword(seed);
          if (!seedNorm) continue;
          const hit = keywordMatchesExcludeList(seed, excludeWords);
          if (hit) continue;

          trendsJob.processed += 1;
          updateTrendsStatusUI();

          // 2.4 有效词筛选：计算其平均热度相对基准的百分比（>= threshold）
          let volumePct = null;
          let avgIndex = null;
          let baseAvgIndex = null;
          if (avgArr && typeof baseAvg === 'number' && baseAvg > 0 && order.length) {
            const idx = order.indexOf(seedNorm);
            if (idx >= 0) {
              avgIndex = avgArr[idx];
              baseAvgIndex = baseAvg;
              volumePct = Math.round((avgIndex / baseAvg) * 100);
            }
          }
          const isEffective = typeof volumePct === 'number' && volumePct >= threshold;
          if (isEffective && !trendsJob.results.has(seedNorm)) {
            trendsJob.results.set(seedNorm, {
              keyword: seed,
              volumePct,
              avgIndex,
              baseAvgIndex,
              round: r,
              parent: r === 1 ? null : '拓展',
              collectedAt: new Date().toISOString()
            });
          }

          const captured = intercepted.get(seedNorm);
          if (!captured?.data) continue;
          const rankedLists = captured.data?.default?.rankedList;
          if (!Array.isArray(rankedLists) || rankedLists.length === 0) continue;
          const topList = rankedLists[0];
          const risingList = rankedLists[1] || rankedLists[0];
          const kwsRising = Array.isArray(risingList?.rankedKeyword) ? risingList.rankedKeyword : [];
          const kwsTop = Array.isArray(topList?.rankedKeyword) ? topList.rankedKeyword : [];
          const kws = exploreMode === 'longtail' ? [...kwsTop, ...kwsRising] : kwsRising;

          for (const k of kws) {
            const kw = String(k?.query || '').trim();
            const kwNorm = normalizeKeyword(kw);
            if (!kwNorm) continue;
            if (keywordMatchesExcludeList(kw, excludeWords)) continue;

            const risePct = parseRisePctFromFormatted(k?.formattedValue);
            // Rising 筛选：>100%（Breakout 会被 parse 为 1000%）
            const ok = exploreMode === 'longtail' ? true : (typeof risePct === 'number' && risePct > 100);
            if (!ok) continue;

            if (!globalSeenResult.has(kwNorm)) {
              globalSeenResult.add(kwNorm);
              trendsJob.newlyAddedThisRound.add(kwNorm);
            }
          }
        }

        renderTrendsResults();
        updateTrendsStatusUI();

        if (trendsJob.results.size >= keywordLimit) {
          trendsJob.lastError = `已达到关键词上限 ${keywordLimit}，任务自动停止`;
          trendsJob.stopping = true;
          break;
        }

        // 按日志节奏：随机等待 4-8s
        const jitterMs = 4000 + Math.floor(Math.random() * 4500);
        await trendsSleep(jitterMs, signal).catch(() => {});
      }

      if (signal.aborted) break;
      if (trendsJob.stopping) break;

      const nextSeeds = Array.from(trendsJob.newlyAddedThisRound.values())
        .map((k) => k)
        .filter(Boolean);
      const nextQueue = [];
      for (const kw of nextSeeds) {
        const n = normalizeKeyword(kw);
        if (!n) continue;
        if (trendsJob.seenSeeds.has(n)) continue;
        trendsJob.seenSeeds.add(n);
        nextQueue.push(kw);
      }
      trendsJob.queued = nextQueue;

      console.info('[Trends挖词] round end', { round: r, newlyAdded: trendsJob.newlyAddedThisRound.size, nextSeeds: nextQueue.length, total: trendsJob.results.size });
      if (nextQueue.length === 0) {
        const msg = exploreMode === 'longtail'
          ? `第 ${r} 轮结束：本轮无新增可拓展的相关查询词，任务结束。`
          : `第 ${r} 轮结束：本轮无新增 Rising >100% 的词，任务结束。`;
        console.info('[Trends挖词] stop reason:', msg);
        trendsJob.lastError = msg;
        updateTrendsStatusUI();
        break;
      }
    }
  } catch (e) {
    console.error('[Trends挖词] 采集任务异常', e);
    if (!trendsJob.lastError) trendsJob.lastError = e?.message || String(e);
    updateTrendsStatusUI();
  } finally {
    const doneStatus = signal.aborted ? '已停止' : (trendsJob.stopping ? '已停止' : '成功');
    trendsJob.running = false;
    trendsJob.stopping = false;
    updateTrendsStatusUI();
    renderTrendsResults();

    try {
      await appendTrendsHistory({
        jobId,
        time: new Date().toLocaleString(),
        status: doneStatus,
        baseline,
        seeds: seeds.slice(0, 20),
        timeRange,
        threshold,
        keywordLimit,
        maxRounds,
        processed: trendsJob.processed,
        found: trendsJob.results.size,
        error: trendsJob.lastError || null
      });
    } catch (e) {
      console.error('[Trends挖词]写入历史失败', e);
    }
  }
}

function stopTrendsJob() {
  if (!trendsJob.running) return;
  trendsJob.stopping = true;
  if (trendsJob.abortController) {
    try { trendsJob.abortController.abort(); } catch (_) {}
  }
  trendsJob.running = false;
  updateTrendsStatusUI();
}

function updateAhrefsProgress(message, type) {
  const el = elements.exploreAhrefsProgress;
  if (!el) return;
  el.textContent = message;
  el.className = 'explore-ahrefs-progress';
  if (type && type !== 'info') el.classList.add('type-' + type);
  el.classList.remove('hidden');
  if (type === 'success' || type === 'error') {
    setTimeout(() => el.classList.add('hidden'), 8000);
  }
}

function showExploreMessage(message, type) {
  if (typeof showToast === 'function') {
    showToast(message, type || 'info');
  } else {
    console.log('[Explore]', type, message);
  }
}

function updateExploreControls(status) {
  // 自动采集在跑时：统一只保留上方的自动采集控制区
  if (autoCollectRunning || autoCollectPaused || autoCollectStopped || autoCollectHistoryTask) {
    if (elements.explorePauseBtn) elements.explorePauseBtn.classList.add('hidden');
    if (elements.exploreResumeBtn) elements.exploreResumeBtn.classList.add('hidden');
    if (elements.exploreStopBtn) elements.exploreStopBtn.classList.add('hidden');
    if (elements.explorePauseBtn) elements.explorePauseBtn.disabled = true;
    if (elements.exploreResumeBtn) elements.exploreResumeBtn.disabled = true;
    if (elements.exploreStopBtn) elements.exploreStopBtn.disabled = true;
    return;
  }

  // 同时考虑拉取反链和遍历检测的状态
  const ahrefsRunning = exploreAhrefsRunning && !exploreAhrefsPaused;
  const ahrefsPaused = exploreAhrefsRunning && exploreAhrefsPaused;
  const traverseRunning = status === 'running';
  const traversePaused = status === 'paused';
  const traverseStopped = status === 'stopped';

  // 只要有一个流程在运行，就显示暂停和停止按钮
  const anyRunning = ahrefsRunning || traverseRunning;
  // 只要有一个流程暂停或停止，就显示继续按钮
  const anyPausedOrStopped = ahrefsPaused || traversePaused || traverseStopped;
  // 可以继续的条件：有暂停的反链任务或暂停的遍历任务
  const canResume = ahrefsPaused || (traversePaused && exploreCurrentBatch?.traverseBacklinkList?.length > 0);

  if (elements.explorePauseBtn) {
    elements.explorePauseBtn.classList.toggle('hidden', !anyRunning);
    elements.explorePauseBtn.disabled = !anyRunning;
  }
  if (elements.exploreResumeBtn) {
    elements.exploreResumeBtn.classList.toggle('hidden', !canResume);
    elements.exploreResumeBtn.disabled = !canResume;
  }
  if (elements.exploreStopBtn) {
    elements.exploreStopBtn.classList.toggle('hidden', !anyRunning);
    elements.exploreStopBtn.disabled = !anyRunning;
  }
  if (elements.exploreBatchStatus) {
    let statusText = status || '—';
    if (exploreAhrefsRunning) {
      statusText = exploreAhrefsPaused ? '拉取反链已暂停' : '拉取反链中';
    }
    elements.exploreBatchStatus.textContent = statusText + (exploreCurrentBatch?.phase ? ' · ' + exploreCurrentBatch.phase : '');
  }
}

let exploreUrlListDetailView = false;

function renderAhrefsOverview(overview, domains) {
  const el = elements.exploreAhrefsOverview;
  if (!el) return;
  if (!overview || overview.domainRating === undefined) {
    el.classList.add('hidden');
    return;
  }
  const domainLabel = domains && domains.length === 1 ? domains[0] : `${domains?.length || '?'} 个域名`;
  const dr = Number(overview.domainRating ?? 0) || 0;
  let drClass = 'overview-value-dr-low';
  if (dr >= 60) drClass = 'overview-value-dr-high';
  else if (dr >= 40) drClass = 'overview-value-dr-mid';
  else if (dr >= 20) drClass = 'overview-value-dr-low';
  else drClass = 'overview-value-dr-very-low';

  const totalBacklinks = Number(overview.backlinks ?? 0) || 0;
  const dofollowBacklinks = Number(overview.dofollowBacklinks ?? 0) || 0;
  const totalRefdomains = Number(overview.refdomains ?? 0) || 0;
  const dofollowRefdomains = Number(overview.dofollowRefdomains ?? 0) || 0;

  const backlinkPct = totalBacklinks > 0 ? Math.round((dofollowBacklinks / totalBacklinks) * 100) : null;
  const refdomainPct = totalRefdomains > 0 ? Math.round((dofollowRefdomains / totalRefdomains) * 100) : null;

  el.innerHTML = `
    <div class="overview-title">${domainLabel} — Ahrefs 概览</div>
    <div class="overview-grid">
      <div class="overview-item">
        <span class="overview-label">DR</span>
        <span class="overview-value overview-value-dr ${drClass}">${dr}</span>
      </div>
      <div class="overview-item">
        <span class="overview-label">引用域名</span>
        <span class="overview-value">
          ${totalRefdomains || '—'}${refdomainPct !== null ? ` , ${refdomainPct}% dofollow` : ''}
        </span>
      </div>
      <div class="overview-item">
        <span class="overview-label">总反链</span>
        <span class="overview-value">
          ${totalBacklinks || '—'}${backlinkPct !== null ? ` , ${backlinkPct}% dofollow` : ''}
        </span>
      </div>
    </div>`;
  el.classList.remove('hidden');
}

function drBadgeClass(dr) {
  if (dr >= 50) return 'dr-high';
  if (dr >= 20) return 'dr-mid';
  return 'dr-low';
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * 渲染批次选择下拉框（从 backlinkExplorationBatches 加载）
 */
async function renderExploreBatchSelect() {
  const selectEl = elements.exploreLoadBatchSelect;
  const loadBtn = elements.exploreLoadBatchBtn;
  if (!selectEl) return;

  try {
    const result = await chrome.storage.local.get(['backlinkExplorationBatches']);
    const batches = result.backlinkExplorationBatches || {};
    const batchList = Object.values(batches).sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    );

    // 保留当前选择
    const currentVal = selectEl.value;
    selectEl.innerHTML = '<option value="">-- 选择批次 --</option>' +
      batchList.map(batch => {
        const urlCount = (batch.urlList || []).length;
        const status = batch.status || 'unknown';
        const time = batch.updatedAt ? new Date(batch.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return `<option value="${batch.batchId}">${batch.batchId} (${urlCount} URLs, ${status}) ${time}</option>`;
      }).join('');

    // 恢复选择
    if (currentVal && batches[currentVal]) {
      selectEl.value = currentVal;
    }

    // 更新加载按钮状态
    if (loadBtn) {
      loadBtn.disabled = !selectEl.value;
    }
  } catch (e) {
    console.error('[Explore] Failed to render batch select:', e);
  }
}

/**
 * 从选中的批次加载 URL 到待检测列表
 */
async function loadUrlsFromSelectedBatch() {
  const selectEl = elements.exploreLoadBatchSelect;
  if (!selectEl || !selectEl.value) return;

  const batchId = selectEl.value;

  try {
    const result = await chrome.storage.local.get(['backlinkExplorationBatches']);
    const batches = result.backlinkExplorationBatches || {};
    const sourceBatch = batches[batchId];

    if (!sourceBatch) {
      showExploreMessage('未找到选中的批次', 'error');
      return;
    }

    const sourceUrls = sourceBatch.urlList || [];
    if (sourceUrls.length === 0) {
      showExploreMessage('选中批次没有 URL 数据', 'warning');
      return;
    }

    // 获取或创建当前批次
    let batch = exploreCurrentBatch;
    if (!batch) {
      const newBatchId = 'explore_' + Date.now();
      batch = {
        batchId: newBatchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'idle',
        phase: 'idle',
        urlList: [],
        backlinkDetails: [],
        discoveredSites: [],
        dugDomains: [],
        sourceInput: { domains: [], commentPageUrl: '' }
      };
    }

    // 增量合并 URL（去重）
    const existingUrls = new Set(batch.urlList || []);
    const newUrls = sourceUrls.filter(u => !existingUrls.has(u));

    if (newUrls.length === 0) {
      showExploreMessage('选中批次的 URL 已全部存在于当前列表', 'info');
      return;
    }

    batch.urlList = [...(batch.urlList || []), ...newUrls];

    // 同时合并反链详情（如果有）
    const sourceDetails = sourceBatch.backlinkDetails || [];
    const existingDetailsMap = new Map((batch.backlinkDetails || []).map(d => [d.urlFrom, d]));
    for (const d of sourceDetails) {
      if (d.urlFrom && !existingDetailsMap.has(d.urlFrom)) {
        (batch.backlinkDetails || (batch.backlinkDetails = [])).push(d);
      }
    }

    batch.updatedAt = new Date().toISOString();

    // 保存并更新 UI
    await saveExploreBatchWithExcludeFilter(batch);
    exploreCurrentBatch = batch;

    // 更新批次 ID 显示
    if (elements.exploreBatchId) {
      elements.exploreBatchId.textContent = batch.batchId;
    }
    if (elements.exploreBatchStatus) {
      elements.exploreBatchStatus.textContent = batch.status + ' · ' + (batch.phase || 'idle');
      elements.exploreBatchStatus.classList.remove('hidden');
    }

    renderExploreUrlList();
    showExploreMessage(`已从批次 ${batchId} 加载 ${newUrls.length} 条 URL`, 'success');

  } catch (e) {
    console.error('[Explore] Failed to load batch URLs:', e);
    showExploreMessage('加载批次失败: ' + e.message, 'error');
  }
}

/**
 * 将待检测 URL 列表写入飞书表格（外链采集 - Ahrefs 反链）
 */
async function writeUrlListToFeishu() {
  try {
    if (!exploreCurrentBatch) {
      showExploreMessage('请先选择或创建批次', 'warning');
      return;
    }

    const urls = exploreCurrentBatch.urlList || [];
    const details = exploreCurrentBatch.backlinkDetails || [];
    const queryDomains = exploreCurrentBatch.sourceInput?.domains || [];

    if (urls.length === 0) {
      showExploreMessage('待检测 URL 列表为空', 'warning');
      return;
    }

    // 构建 backlinks 数据结构
    const backlinks = urls.map((url, index) => {
      // 尝试从 details 中查找匹配的反链详情
      const detail = details.find(d => d.urlFrom === url) || {};

      // 从 URL 提取域名
      let domain = '';
      try {
        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        domain = urlObj.hostname;
      } catch (e) {
        // 忽略无效 URL
      }

      return {
        urlFrom: url,
        urlTo: detail.urlTo || '',
        anchor: detail.anchor || detail.anchorText || '',
        domainRating: detail.domainRating || detail.dr || 0,
        title: detail.title || '',
        domain: domain
      };
    });

    // 使用查询域名作为 domain 参数（如果有多个则用逗号分隔）
    const domain = queryDomains.join(',') || (backlinks[0]?.domain || '');

    showExploreMessage(`正在写入 ${backlinks.length} 条 URL 到飞书...`, 'info');

    const overviewForSheet = (exploreCurrentBatch && exploreCurrentBatch.ahrefsOverview) || {};
    const result = await writeAhrefsBacklinksToFeishu(domain, backlinks, overviewForSheet);

    if (result.success) {
      const rangeInfo = result.range ? ` (${result.range})` : '';
      showExploreMessage(`成功写入 ${backlinks.length} 条 URL 到飞书${rangeInfo}`, 'success');
    } else {
      showExploreMessage('写入飞书失败: ' + (result.error || '未知错误'), 'error');
    }

  } catch (e) {
    console.error('[Explore] Failed to write URL list to Feishu:', e);
    showExploreMessage('写入飞书失败: ' + e.message, 'error');
  }
}

function renderExploreUrlList() {
  const listEl = elements.exploreUrlList;
  if (!listEl) return;
  const urls = exploreCurrentBatch?.urlList || [];
  const details = exploreCurrentBatch?.backlinkDetails || [];
  const hasDetails = details.length > 0;
  const hasUrls = urls.length > 0;

  // 更新统计数字
  if (elements.exploreUrlListCount) {
    elements.exploreUrlListCount.textContent = `${urls.length} 条`;
    elements.exploreUrlListCount.classList.toggle('hidden', !hasUrls);
  }

  if (elements.exploreUrlListViewToggle) {
    if (hasDetails) {
      elements.exploreUrlListViewToggle.classList.remove('hidden');
      elements.exploreUrlListViewToggle.textContent = exploreUrlListDetailView ? '简略' : '详情';
    } else {
      elements.exploreUrlListViewToggle.classList.add('hidden');
    }
  }

  if (!hasUrls) {
    listEl.innerHTML = '<div class="empty-list-hint">暂无，可从上方提取或拉取反链后加入，或从缓存批次加载</div>';
    // 清空选中状态
    exploreSelectedUrls.clear();
  } else if (exploreUrlListDetailView && hasDetails) {
    const detailMap = new Map();
    for (const bl of details) {
      if (bl.urlFrom) detailMap.set(bl.urlFrom, bl);
    }
    // 多选栏头部
    const selectedCount = exploreSelectedUrls.size;
    const headerHtml = `
      <div class="explore-url-list-header">
        <input type="checkbox" class="select-all-checkbox" id="exploreSelectAllCheckbox" ${selectedCount === urls.length ? 'checked' : ''}>
        <label for="exploreSelectAllCheckbox" class="select-all-label">全选</label>
        <span class="selected-count" id="exploreSelectedCount">${selectedCount > 0 ? `已选 ${selectedCount} 项` : ''}</span>
        <button type="button" class="batch-delete-btn ${selectedCount > 0 ? 'active' : ''}" id="exploreBatchDeleteBtn" ${selectedCount === 0 ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
          </svg>
          删除选中
        </button>
      </div>`;

    listEl.innerHTML = headerHtml + urls.map((u, idx) => {
      const bl = detailMap.get(u);
      const isSelected = exploreSelectedUrls.has(idx);
      if (bl) {
        const drClass = drBadgeClass(bl.domainRating);
        return `<div class="explore-url-item rich ${isSelected ? 'selected' : ''}" data-index="${idx}">
          <input type="checkbox" class="url-checkbox" data-index="${idx}" ${isSelected ? 'checked' : ''}>
          <a href="${escHtml(u)}" target="_blank" rel="noopener">${escHtml(u)}</a>
          <div class="backlink-meta">
            <span class="dr-badge ${drClass}">DR ${bl.domainRating}</span>
            <span class="anchor-text" title="锚文本: ${escHtml(bl.anchor)}">${escHtml(bl.anchor || '—')}</span>
            <span class="page-title" title="${escHtml(bl.title)}">${escHtml(bl.title || '')}</span>
          </div>
          <button type="button" class="btn-delete-url" data-index="${idx}" title="删除">✕</button>
        </div>`;
      }
      return `<div class="explore-url-item ${isSelected ? 'selected' : ''}" data-index="${idx}">
        <input type="checkbox" class="url-checkbox" data-index="${idx}" ${isSelected ? 'checked' : ''}>
        <a href="${escHtml(u)}" target="_blank" rel="noopener">${escHtml(u)}</a>
        <button type="button" class="btn-delete-url" data-index="${idx}" title="删除">✕</button>
      </div>`;
    }).join('');
  } else {
    // 简略视图 - 也添加多选栏
    const selectedCount = exploreSelectedUrls.size;
    const headerHtml = `
      <div class="explore-url-list-header">
        <input type="checkbox" class="select-all-checkbox" id="exploreSelectAllCheckbox" ${selectedCount === urls.length ? 'checked' : ''}>
        <label for="exploreSelectAllCheckbox" class="select-all-label">全选</label>
        <span class="selected-count" id="exploreSelectedCount">${selectedCount > 0 ? `已选 ${selectedCount} 项` : ''}</span>
        <button type="button" class="batch-delete-btn ${selectedCount > 0 ? 'active' : ''}" id="exploreBatchDeleteBtn" ${selectedCount === 0 ? 'disabled' : ''}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
          </svg>
          删除选中
        </button>
      </div>`;

    listEl.innerHTML = headerHtml + urls.map((u, idx) => {
      const isSelected = exploreSelectedUrls.has(idx);
      return `<div class="explore-url-item ${isSelected ? 'selected' : ''}" data-index="${idx}">
        <input type="checkbox" class="url-checkbox" data-index="${idx}" ${isSelected ? 'checked' : ''}>
        <a href="${escHtml(u)}" target="_blank" rel="noopener">${escHtml(u)}</a>
        <button type="button" class="btn-delete-url" data-index="${idx}" title="删除">✕</button>
      </div>`;
    }).join('');
  }

  // 绑定事件
  bindExploreUrlListEvents();

  // 更新按钮状态
  if (elements.exploreStartTraverseBtn) elements.exploreStartTraverseBtn.disabled = !hasUrls;
  if (elements.exploreWriteUrlListToFeishuBtn) elements.exploreWriteUrlListToFeishuBtn.disabled = !hasUrls;
  if (elements.exploreClearUrlListBtn) elements.exploreClearUrlListBtn.disabled = !hasUrls;
}

/**
 * 绑定 URL 列表多选相关事件
 */
function bindExploreUrlListEvents() {
  const listEl = elements.exploreUrlList;
  if (!listEl) return;

  // 全选复选框事件
  const selectAllCheckbox = document.getElementById('exploreSelectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const urls = exploreCurrentBatch?.urlList || [];
      if (e.target.checked) {
        // 全选
        exploreSelectedUrls = new Set(urls.map((_, i) => i));
      } else {
        // 取消全选
        exploreSelectedUrls.clear();
      }
      renderExploreUrlList();
    });
  }

  // 单个复选框事件
  listEl.querySelectorAll('.url-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      const itemEl = e.target.closest('.explore-url-item');
      if (e.target.checked) {
        exploreSelectedUrls.add(index);
        itemEl?.classList.add('selected');
      } else {
        exploreSelectedUrls.delete(index);
        itemEl?.classList.remove('selected');
      }
      updateExploreSelectAllState();
      updateExploreBatchDeleteBtn();
      updateExploreSelectedCount();
    });
  });

  // 批量删除按钮事件
  const batchDeleteBtn = document.getElementById('exploreBatchDeleteBtn');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', async () => {
      await batchDeleteExploreUrls();
    });
  }

  // 单个删除按钮事件
  listEl.querySelectorAll('.btn-delete-url').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index, 10);
      await deleteUrlFromList(index);
    });
  });
}

/**
 * 更新全选复选框状态
 */
function updateExploreSelectAllState() {
  const checkbox = document.getElementById('exploreSelectAllCheckbox');
  if (!checkbox) return;
  const urls = exploreCurrentBatch?.urlList || [];
  checkbox.checked = exploreSelectedUrls.size === urls.length && urls.length > 0;
}

/**
 * 更新批量删除按钮状态
 */
function updateExploreBatchDeleteBtn() {
  const btn = document.getElementById('exploreBatchDeleteBtn');
  if (!btn) return;
  const hasSelected = exploreSelectedUrls.size > 0;
  btn.disabled = !hasSelected;
  btn.classList.toggle('active', hasSelected);
}

/**
 * 更新选中数量显示
 */
function updateExploreSelectedCount() {
  const countEl = document.getElementById('exploreSelectedCount');
  if (!countEl) return;
  const count = exploreSelectedUrls.size;
  countEl.textContent = count > 0 ? `已选 ${count} 项` : '';
}

/**
 * 批量删除选中的 URL
 */
async function batchDeleteExploreUrls() {
  try {
    if (!exploreCurrentBatch || exploreSelectedUrls.size === 0) return;

    const urls = exploreCurrentBatch.urlList || [];
    const details = exploreCurrentBatch.backlinkDetails || [];

    // 从大到小排序索引，避免删除时索引错乱
    const indicesToDelete = Array.from(exploreSelectedUrls).sort((a, b) => b - a);
    const deletedUrls = indicesToDelete.map(i => urls[i]);

    // 从后往前删除
    for (const idx of indicesToDelete) {
      urls.splice(idx, 1);
    }

    // 删除对应的 backlinkDetails
    exploreCurrentBatch.backlinkDetails = details.filter(d => !deletedUrls.includes(d.urlFrom));
    exploreCurrentBatch.updatedAt = new Date().toISOString();

    await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);

    // 清空选中状态
    exploreSelectedUrls.clear();
    renderExploreUrlList();
    showExploreMessage(`已删除 ${deletedUrls.length} 条 URL`, 'success');
  } catch (e) {
    console.error('[Explore] Failed to batch delete URLs:', e);
    showExploreMessage('批量删除失败: ' + e.message, 'error');
  }
}

/**
 * 删除待检测 URL 列表中的单条记录
 */
async function deleteUrlFromList(index) {
  try {
    if (!exploreCurrentBatch) return;

    const urls = exploreCurrentBatch.urlList || [];
    if (index < 0 || index >= urls.length) return;

    const deletedUrl = urls[index];
    urls.splice(index, 1);

    // 同时删除对应的 backlinkDetails
    const details = exploreCurrentBatch.backlinkDetails || [];
    exploreCurrentBatch.backlinkDetails = details.filter(d => d.urlFrom !== deletedUrl);

    exploreCurrentBatch.updatedAt = new Date().toISOString();

    await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);
    renderExploreUrlList();
    showExploreMessage(`已删除: ${deletedUrl}`, 'info');

  } catch (e) {
    console.error('[Explore] Failed to delete URL:', e);
    showExploreMessage('删除失败: ' + e.message, 'error');
  }
}

/**
 * 清空待检测 URL 列表
 */
async function clearExploreUrlList() {
  try {
    if (!exploreCurrentBatch) return;

    const urls = exploreCurrentBatch.urlList || [];
    if (urls.length === 0) return;

    const count = urls.length;
    exploreCurrentBatch.urlList = [];
    exploreCurrentBatch.backlinkDetails = [];
    exploreCurrentBatch.updatedAt = new Date().toISOString();

    await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);
    renderExploreUrlList();
    showExploreMessage(`已清空 ${count} 条 URL`, 'success');

  } catch (e) {
    console.error('[Explore] Failed to clear URL list:', e);
    showExploreMessage('清空失败: ' + e.message, 'error');
  }
}

function renderExploreDiscoveredList() {
  const listEl = elements.exploreDiscoveredList;
  if (!listEl) return;
  const sites = exploreCurrentBatch?.discoveredSites || [];
  const hasSites = sites.length > 0;

  // 更新统计数字
  if (elements.exploreDiscoveredCount) {
    elements.exploreDiscoveredCount.textContent = `${sites.length} 个`;
    elements.exploreDiscoveredCount.classList.toggle('hidden', !hasSites);
  }

  if (!hasSites) {
    listEl.innerHTML = '<div class="empty-list-hint">暂无</div>';
  } else {
    listEl.innerHTML = sites.map((s) => {
      const u = (s && s.url) || s;
      const scoreText = s && typeof s.blogCommentScore === 'number' ? String(s.blogCommentScore) : '—';
      const loginBadge = s && s.requiresLogin ? '<span class="explore-requires-login" title="需要登录后才能评论">需登录</span>' : '';
      return `<div class="explore-url-item"><span class="explore-score" title="Blog 评论站得分">${scoreText}</span>${loginBadge}<a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a></div>`;
    }).join('');
  }

  // 更新写入飞书按钮状态
  if (elements.exploreWriteFeishuBtn) {
    elements.exploreWriteFeishuBtn.disabled = !hasSites;
  }
  // 更新清空按钮状态
  if (elements.exploreClearDiscoveredBtn) {
    elements.exploreClearDiscoveredBtn.disabled = !hasSites;
  }
}

function renderExploreDugDomainsList() {
  const listEl = elements.exploreDugDomainsList;
  if (!listEl) return;
  const domains = exploreCurrentBatch?.dugDomains || [];
  const hasDomains = domains.length > 0;

  // 更新统计数字
  if (elements.exploreDugDomainsCount) {
    elements.exploreDugDomainsCount.textContent = `${domains.length} 个`;
    elements.exploreDugDomainsCount.classList.toggle('hidden', !hasDomains);
  }

  // 更新按钮状态
  if (elements.exploreAddDugToAhrefsBtn) {
    elements.exploreAddDugToAhrefsBtn.disabled = !hasDomains;
  }

  if (!hasDomains) {
    listEl.innerHTML = '<div class="empty-list-hint">暂无</div>';
  } else {
    listEl.innerHTML = domains.map((d) => {
      return `<div class="explore-url-item"><a href="https://${d}" target="_blank" rel="noopener">${d}</a></div>`;
    }).join('');
  }
}

async function loadExploreState() {
  if (elements.exploreBatchId) elements.exploreBatchId.textContent = '—';
  if (elements.exploreBatchStatus) {
    elements.exploreBatchStatus.classList.add('hidden');
  }
  try {
    const st = await chrome.storage.local.get(['exploreExcludeFromBlogSites']);
    if (elements.exploreExcludeFromBlogSites) elements.exploreExcludeFromBlogSites.checked = st.exploreExcludeFromBlogSites !== false;
  } catch (_) {}
  if (typeof listBatches === 'function') {
    try {
      const batches = await listBatches();
      const runningOrPaused = batches.find(b => b.status === 'running' || b.status === 'paused');
      if (runningOrPaused && elements.exploreBatchId) {
        exploreCurrentBatch = runningOrPaused;
        elements.exploreBatchId.textContent = runningOrPaused.batchId;
        if (elements.exploreBatchStatus) {
          elements.exploreBatchStatus.textContent = `${runningOrPaused.status} · ${runningOrPaused.phase || 'idle'}`;
          elements.exploreBatchStatus.classList.remove('hidden');
        }
        updateExploreControls(runningOrPaused.status);
      } else {
        updateExploreControls(null);
      }
    } catch (e) {
      console.warn('[Explore] loadExploreState listBatches:', e);
    }
  }
  renderExploreUrlList();
  renderExploreDiscoveredList();
  renderExploreDugDomainsList();
  // 渲染批次选择下拉框
  await renderExploreBatchSelect();

  // 恢复自动采集任务状态
  await restoreAutoCollectState();
}

/** 遍历进度 urlProgress 仅保留「最近已处理」窗口，避免每条 URL 持久化后撑满 5MB 总配额 */
const EXPLORE_URL_PROGRESS_STORAGE_WINDOW = 180;

/**
 * 写入 backlinkExplorationBatches 前裁剪批次，避免 chrome.storage.local QuotaBytes。
 * 根因：① 扩展的 chrome.storage.local 约 5MB 为**全键共享**配额，IndexedDB 只用于 Ahrefs 反链缓存，批次仍在 local；
 * ② 遍历步骤每处理一条 URL 就 saveBatch，urlProgress 会按条累积；③ step3 大字段等。
 * prepareAutoCollectTaskForStorage 只裁剪 autoCollectTask，不会处理本存储键。
 * @param {object} batch
 * @returns {object} 可安全持久化的新对象（不修改入参）
 */
function prepareExploreBatchForStorage(batch) {
  if (!batch || typeof batch !== 'object') return batch;
  const b = { ...batch };

  if (b.stepOutputs && typeof b.stepOutputs === 'object') {
    const so = { ...b.stepOutputs };

    if (so.step1 && typeof so.step1 === 'object') {
      so.step1 = {
        count: typeof so.step1.count === 'number'
          ? so.step1.count
          : (Array.isArray(so.step1.domains) ? so.step1.domains.length : 0)
      };
    }
    if (so.step2 && typeof so.step2 === 'object') {
      so.step2 = {
        passed: so.step2.passed,
        failed: so.step2.failed || 0
      };
    }
    if (so.step3 && typeof so.step3 === 'object') {
      so.step3 = {
        count: typeof so.step3.count === 'number'
          ? so.step3.count
          : (Array.isArray(so.step3.backlinks) ? so.step3.backlinks.length : 0)
      };
    }
    if (so.step4 && typeof so.step4 === 'object') {
      const ds = Array.isArray(so.step4.discoveredSites) ? so.step4.discoveredSites : [];
      const trimmed = ds.slice(0, 500).map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return { url: item };
        if (typeof item === 'object' && item.url) return { url: item.url };
        const url = item.urlFrom || item.siteUrl || item.link;
        return url ? { url } : null;
      }).filter(Boolean);
      so.step4 = {
        count: typeof so.step4.count === 'number' ? so.step4.count : ds.length,
        discoveredSites: trimmed
      };
    }
    b.stepOutputs = so;
  }

  // 仅保留「待遍历 URL」所需的 DR 行，避免 backlinkDetails 与全量反链同体积
  if (Array.isArray(b.traverseBacklinkList) && b.traverseBacklinkList.length > 0 && Array.isArray(b.backlinkDetails)) {
    const need = new Set();
    for (const u of b.traverseBacklinkList) {
      const n = typeof normalizeUrl === 'function' ? normalizeUrl(u) : u;
      if (n) need.add(n);
    }
    b.backlinkDetails = b.backlinkDetails.filter((d) => {
      if (!d || !d.urlFrom) return false;
      const n = typeof normalizeUrl === 'function' ? normalizeUrl(d.urlFrom) : d.urlFrom;
      return need.has(n);
    });
  }

  // 每条详情只保留 urlFrom + DR，去掉 title/anchor 等大字段
  if (Array.isArray(b.backlinkDetails)) {
    b.backlinkDetails = b.backlinkDetails.map((d) => {
      if (!d || !d.urlFrom) return null;
      const dr = d.domainRating !== undefined ? d.domainRating : (d.dr !== undefined ? d.dr : 0);
      return { urlFrom: d.urlFrom, domainRating: dr };
    }).filter(Boolean);
  }

  // urlProgress：只保留「当前 lastProcessedIndex 之前一小段」窗口内键，已回写飞书的不必长期占存储
  if (b.urlProgress && typeof b.urlProgress === 'object' && !Array.isArray(b.urlProgress)) {
    const trav = Array.isArray(b.traverseBacklinkList) ? b.traverseBacklinkList : null;
    const li = typeof b.lastProcessedIndex === 'number' ? b.lastProcessedIndex : 0;
    const keep = new Set();
    if (trav && trav.length > 0) {
      const from = Math.max(0, li - EXPLORE_URL_PROGRESS_STORAGE_WINDOW);
      for (let i = from; i < li && i < trav.length; i++) {
        const nu = typeof normalizeUrl === 'function' ? normalizeUrl(trav[i]) : trav[i];
        if (nu) keep.add(nu);
      }
    } else {
      const keys = Object.keys(b.urlProgress);
      for (const k of keys.slice(-EXPLORE_URL_PROGRESS_STORAGE_WINDOW)) keep.add(k);
    }
    const np = {};
    for (const k of Object.keys(b.urlProgress)) {
      if (keep.has(k)) np[k] = b.urlProgress[k];
    }
    b.urlProgress = np;
  }

  // 批次级 discoveredSites 仅保留尾部若干条并降维（stepOutputs.step4 另有裁剪）
  if (Array.isArray(b.discoveredSites) && b.discoveredSites.length > 0) {
    const tail = b.discoveredSites.slice(-450);
    b.discoveredSites = tail.map((item) => {
      if (!item) return null;
      if (typeof item === 'string') return { url: item };
      const url = item.url || item;
      if (!url) return null;
      return {
        url: typeof url === 'string' ? url : String(url),
        discoveredAt: item.discoveredAt,
        blogCommentScore: item.blogCommentScore,
        requiresLogin: item.requiresLogin,
        isNavigationSite: item.isNavigationSite
      };
    }).filter(Boolean);
  }

  return b;
}

async function saveExploreBatchWithExcludeFilter(batch) {
  if (!batch || typeof saveBatch !== 'function') return;
  const exclude = await getExploreExcludeDomainsForFilter();
  let b;
  if (exclude && typeof filterUrlsExcludingDomains === 'function' && typeof filterDomainsExcludingDomains === 'function') {
    b = { ...batch };
    b.urlList = filterUrlsExcludingDomains(b.urlList || [], exclude);
    b.dugDomains = filterDomainsExcludingDomains(b.dugDomains || [], exclude);
    if (Array.isArray(b.discoveredSites) && typeof normalizeDomain === 'function' && typeof getExcludeDomainSet === 'function') {
      const set = getExcludeDomainSet(exclude);
      b.discoveredSites = b.discoveredSites.filter(s => {
        const url = (s && s.url) || s;
        const host = normalizeDomain(url);
        return !host || !set.has(host);
      });
    }
  } else {
    b = { ...batch };
  }

  const toSave = prepareExploreBatchForStorage(b);
  try {
    await saveBatch(toSave);
  } catch (e) {
    if (isQuotaExceededError(e)) {
      console.warn('[Explore] saveBatch 配额超限，尝试极简裁剪后重试:', e?.message);
      const minimal = prepareExploreBatchForStorage(b);
      if (minimal.urlProgress && typeof minimal.urlProgress === 'object' && !Array.isArray(minimal.urlProgress)) {
        const keys = Object.keys(minimal.urlProgress);
        const cap = EXPLORE_URL_PROGRESS_STORAGE_WINDOW;
        if (keys.length > cap) {
          const keep = new Set(keys.slice(-cap));
          const np = {};
          for (const k of keys) {
            if (keep.has(k)) np[k] = minimal.urlProgress[k];
          }
          minimal.urlProgress = np;
        }
      }
      if (Array.isArray(minimal.backlinkDetails) && minimal.backlinkDetails.length > 400) {
        minimal.backlinkDetails = minimal.backlinkDetails.slice(-400);
      }
      if (Array.isArray(minimal.traverseBacklinkList) && minimal.traverseBacklinkList.length > 8000) {
        minimal.traverseBacklinkList = minimal.traverseBacklinkList.slice(0, 8000);
      }
      await saveBatch(minimal);
    } else {
      throw e;
    }
  }
  // 有排除域名时：与旧逻辑一致，用浅拷贝更新列表（避免污染原引用）
  if (exclude && exploreCurrentBatch && exploreCurrentBatch.batchId === batch.batchId) {
    exploreCurrentBatch = b;
  }
}

async function getExploreExcludeDomainsForFilter() {
  const r = await chrome.storage.local.get(['exploreExcludeFromBlogSites', 'blogCommentSites']);
  if (r.exploreExcludeFromBlogSites === false) return '';
  const sites = r.blogCommentSites || [];
  if (!sites.length) return '';
  if (typeof normalizeDomain !== 'function') return '';
  const domains = [...new Set(sites.map((s) => (s && s.url) ? normalizeDomain(s.url) : '').filter(Boolean))];
  return domains.join(',');
}

// 自动飞书同步（仅在数据为空或上次同步超过5分钟时）
async function autoSyncIfNeeded() {
  // 如果已有数据且是本次会话中同步的，不自动同步
  if (batchUrls.length > 0) {
    return;
  }

  // 检查是否配置了飞书
  const result = await chrome.storage.local.get(['feishuConfig', 'feishuLastSyncTime']);
  const config = result.feishuConfig || {};
  if (!config.appToken || !config.tableId) {
    return; // 没有配置飞书，不自动同步
  }

  // 检查上次同步时间，避免频繁同步（5分钟内不重复同步）
  const lastSyncTime = result.feishuLastSyncTime;
  if (lastSyncTime) {
    const lastSync = new Date(lastSyncTime);
    const now = new Date();
    const minutesSinceSync = (now - lastSync) / 1000 / 60;
    if (minutesSinceSync < 5 && batchUrls.length > 0) {
      return;
    }
  }

  // 执行自动同步
  await syncFromFeishu();
}

// ========== 导航站功能 ==========

async function getNavPageState() {
  if (!currentTab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageState' });
    if (response && response.success) {
      pageState = response.state;
      updateNavFormStatus();
    } else {
      const detectResponse = await chrome.tabs.sendMessage(currentTab.id, { action: 'detectForm' });
      if (detectResponse && detectResponse.success) {
        updateNavFormStatusFromDetect(detectResponse.result);
      } else {
        showNavNoForm();
      }
    }
  } catch (error) {
    console.error('[SidePanel] Failed to get nav page state:', error);
    if (error?.message?.includes('Receiving end does not exist') || error?.message?.includes('Could not establish connection')) {
      showNavMessage('无法在此页面使用（请打开普通网页，如 https://... 的提交页）', 'error');
    } else {
      showNavNoForm();
    }
  }
}

function updateNavFormStatus() {
  if (!pageState) {
    showNavNoForm();
    return;
  }

  if (elements.navFormStatus) elements.navFormStatus.classList.remove('hidden');
  if (elements.navNoFormHint) elements.navNoFormHint.classList.add('hidden');

  // 识别状态
  const statusTexts = {
    idle: '未识别',
    recognizing: '识别中...',
    done: '已完成',
    failed: '失败'
  };
  if (elements.navRecognitionStatus) {
    elements.navRecognitionStatus.textContent = statusTexts[pageState.recognitionStatus] || pageState.recognitionStatus;

    if (pageState.recognitionMethod === 'ai') {
      elements.navRecognitionStatus.textContent += ' (AI)';
    } else if (pageState.recognitionMethod === 'cache') {
      elements.navRecognitionStatus.textContent += ' (缓存)';
    }
  }

  // 字段数量
  if (elements.navFieldCount) {
    if (pageState.fieldMappings) {
      elements.navFieldCount.textContent = pageState.fieldMappings.length + ' 个字段';
    } else {
      elements.navFieldCount.textContent = '-';
    }
  }

  // 主按钮「自动识别并填充」
  if (elements.navFillFormBtn) {
    elements.navFillFormBtn.disabled = !currentSiteId;
  }

  // AI 按钮
  if (elements.navAiFillFormBtn) {
    elements.navAiFillFormBtn.disabled = !currentSiteId || !llmEnabled;
    if (!llmEnabled) {
      elements.navAiFillFormBtn.title = '请在设置中启用 LLM 并配置 GLM API Key';
    }
  }

  // 如果有表单但未识别
  if (pageState.hasForm && !pageState.fieldMappings) {
    if (elements.navRecognitionStatus) {
      elements.navRecognitionStatus.textContent = '待识别';
    }
  }

  updateNavFieldFillList();
}

function updateNavFormStatusFromDetect(detectResult) {
  if (detectResult.hasForm) {
    if (elements.navFormStatus) elements.navFormStatus.classList.remove('hidden');
    if (elements.navNoFormHint) elements.navNoFormHint.classList.add('hidden');
    if (elements.navRecognitionStatus) elements.navRecognitionStatus.textContent = '待识别';
    if (elements.navFieldCount) elements.navFieldCount.textContent = detectResult.inputCount + ' 个输入项';
    if (elements.navFillFormBtn) elements.navFillFormBtn.disabled = !currentSiteId;
  } else {
    showNavNoForm();
  }
}

function showNavNoForm() {
  if (elements.navFormStatus) elements.navFormStatus.classList.add('hidden');
  if (elements.navNoFormHint) elements.navNoFormHint.classList.remove('hidden');
  if (elements.navFillFormBtn) elements.navFillFormBtn.disabled = true;
  if (elements.navAiFillFormBtn) elements.navAiFillFormBtn.disabled = true;
  updateNavFieldFillList();
}

function updateNavFieldFillList() {
  const list = elements.navFieldFillList;
  const section = elements.navFieldFillSection;
  const noData = elements.navFieldFillNoData;
  if (!list || !section || !noData) return;

  const mappings = pageState?.fieldMappings;
  const hasMappings = mappings && mappings.length > 0 && currentSiteId;
  const currentSite = sites.find(s => s.id === currentSiteId);

  if (!hasMappings || !currentSite) {
    section.classList.add('hidden');
    noData.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }

  noData.classList.add('hidden');
  section.classList.remove('hidden');

  const seen = new Set();
  const rows = [];
  for (const m of mappings) {
    if (seen.has(m.standardField)) continue;
    seen.add(m.standardField);
    const label = FIELD_LABELS[m.standardField] || m.standardField;
    let preview = currentSite[m.standardField];
    if (preview == null) preview = '';
    if (m.standardField === 'logo' && (currentSite.logoDataUrl || preview)) preview = '(图片)';
    else if (m.standardField === 'screenshot' && (currentSite.screenshotDataUrl || preview)) preview = '(图片)';
    else preview = String(preview).trim();
    if (preview.length > 22) preview = preview.slice(0, 20) + '…';
    rows.push({ standardField: m.standardField, label, preview });
  }

  list.innerHTML = rows.map(({ standardField, label, preview }) => {
    const previewEsc = escapeHtml(preview || '—');
    return `<li data-field="${escapeHtml(standardField)}" title="点击填充：${escapeHtml(label)}">
      <span class="field-name">${escapeHtml(label)}</span>
      <span class="field-preview">${previewEsc}</span>
      <span class="field-action">填充</span>
    </li>`;
  }).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => onNavFieldFillClick(li.dataset.field));
  });
}

async function onNavFieldFillClick(standardField) {
  if (!currentTab?.id || !standardField) return;
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'fillSingleField', standardField });
    if (response?.success) {
      const n = response.result?.filledCount ?? 0;
      showNavMessage(n > 0 ? `已填充「${FIELD_LABELS[standardField] || standardField}」` : '该字段无内容或未找到对应控件', n > 0 ? 'success' : 'warning');
    } else {
      showNavMessage(response?.error || '填充失败', 'error');
    }
  } catch (e) {
    showNavMessage(e?.message?.includes('Receiving end') ? '请刷新页面后再试' : (e?.message || '填充失败'), 'error');
  }
}

function showNavMessage(message, type = 'info') {
  // 只在导航站模式下显示
  if (currentMode !== 'nav') return;
  console.log(`[Nav] ${type}: ${message}`);
  showToast(message, type);
}

function showToast(message, type = 'info') {
  // 创建临时toast消息
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 4px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : type === 'warning' ? '#ff9800' : '#2196f3'};
    color: white;
    font-size: 14px;
    z-index: 10000;
    max-width: 80%;
    text-align: center;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== Blog 评论功能 ==========

function getCommentCacheKeyForTab(tab) {
  if (!tab?.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return null;
  try {
    const u = new URL(tab.url);
    return 'blog_' + u.hostname + u.pathname;
  } catch {
    return null;
  }
}

async function getCommentPageState() {
  if (!currentTab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getCommentPageState' });
    if (response?.success) {
      commentPageState = response.state;
      updateBlogFormStatus();
    } else {
      const rec = await chrome.tabs.sendMessage(currentTab.id, { action: 'recognizeCommentForm', useLlm: false });
      if (rec?.success && rec.result?.status === 'success') {
        commentPageState = {
          hasForm: true,
          fieldMappings: rec.result.mappings,
          recognitionStatus: 'done',
          hasSpamVerification: rec.result.hasSpamVerification
        };
        updateBlogFormStatusFromRec(rec.result);
      } else {
        setBlogNoForm();
      }
    }
  } catch (e) {
    if (e?.message?.includes('Receiving end')) setBlogNoForm();
    else setBlogNoForm();
  }
  await updateBlogClearCacheState();
}

function updateBlogFormStatus() {
  if (!commentPageState) {
    setBlogNoForm();
    return;
  }
  if (elements.blogFormStatus) elements.blogFormStatus.classList.remove('hidden');
  if (elements.blogNoFormHint) elements.blogNoFormHint.classList.add('hidden');
  if (elements.blogRecognitionStatus) {
    const s = commentPageState.recognitionStatus;
    elements.blogRecognitionStatus.textContent = s === 'done' ? '已识别' : s === 'recognizing' ? '识别中...' : s === 'failed' ? '失败' : '未识别';
    if (commentPageState.recognitionMethod) {
      elements.blogRecognitionStatus.textContent += ` (${commentPageState.recognitionMethod === 'ai' ? 'AI' : commentPageState.recognitionMethod === 'cache' ? '缓存' : '关键词'})`;
    }
  }
  const count = commentPageState.fieldMappings?.length ?? 0;
  if (elements.blogFieldCount) elements.blogFieldCount.textContent = count + ' 个字段';
  if (elements.blogSpamHint) elements.blogSpamHint.classList.toggle('hidden', !commentPageState.hasSpamVerification);
  if (elements.blogGenerateAndFillBtn) elements.blogGenerateAndFillBtn.disabled = !currentSiteId;
  if (elements.blogVerifySubmitBtn) elements.blogVerifySubmitBtn.disabled = !currentSiteId;
}

function updateBlogFormStatusFromRec(rec) {
  commentPageState = {
    hasForm: true,
    fieldMappings: rec.mappings,
    recognitionStatus: 'done',
    hasSpamVerification: false,
    recognitionMethod: rec.method
  };
  updateBlogFormStatus();
  if (elements.blogSpamHint) elements.blogSpamHint.classList.add('hidden');
}

function setBlogNoForm() {
  commentPageState = null;
  if (elements.blogFormStatus) elements.blogFormStatus.classList.add('hidden');
  if (elements.blogNoFormHint) elements.blogNoFormHint.classList.remove('hidden');
  if (elements.blogGenerateAndFillBtn) elements.blogGenerateAndFillBtn.disabled = true;
  if (elements.blogVerifySubmitBtn) elements.blogVerifySubmitBtn.disabled = true;
  updateBlogClearCacheState();
}

async function updateBlogClearCacheState() {
  if (!elements.blogClearCacheBtn) return;
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) {
    elements.blogClearCacheBtn.disabled = true;
    elements.blogClearCacheBtn.classList.remove('blog-cache-has');
    elements.blogFieldCount?.classList.remove('blog-field-count-has-cache');
    if (elements.blogFieldPrevBtn) elements.blogFieldPrevBtn.disabled = true;
    if (elements.blogFieldNextBtn) elements.blogFieldNextBtn.disabled = true;
    if (elements.blogCacheHint) elements.blogCacheHint.classList.add('hidden');
    return;
  }
  const result = await chrome.storage.local.get(['blogCommentFieldMappings']);
  const mappings = result.blogCommentFieldMappings || {};
  const cached = mappings[cacheKey];
  const hasCache = !!(cached && (cached.mappings?.length || (Array.isArray(cached) && cached.length)));
  const cacheFieldCount = hasCache && cached ? (cached.mappings?.length ?? (Array.isArray(cached) ? cached.length : 0)) : 0;
  elements.blogClearCacheBtn.disabled = !hasCache;
  elements.blogClearCacheBtn.classList.toggle('blog-cache-has', hasCache);
  elements.blogFieldCount?.classList.toggle('blog-field-count-has-cache', hasCache);
  if (elements.blogFieldPrevBtn) elements.blogFieldPrevBtn.disabled = !hasCache;
  if (elements.blogFieldNextBtn) elements.blogFieldNextBtn.disabled = !hasCache;
  if (hasCache && elements.blogFieldCount) {
    elements.blogFieldCount.textContent = cacheFieldCount + ' 个字段';
  }
  if (elements.blogCacheHint) {
    if (hasCache) {
      elements.blogCacheHint.textContent = '当前页已有缓存';
      elements.blogCacheHint.classList.remove('hidden');
    } else {
      elements.blogCacheHint.classList.add('hidden');
    }
  }
}

// ========== 状态持久化 ==========

function saveBlogPopupState() {
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) return;
  const statusLineText = elements.blogStatusLine?.textContent?.trim() || '';
  const statusMessageVisible = elements.blogStatusMessage && !elements.blogStatusMessage.classList.contains('hidden');
  const statusMessageText = statusMessageVisible ? (elements.blogStatusText?.textContent?.trim() || '') : '';
  let statusMessageType = 'info';
  if (statusMessageVisible && elements.blogStatusMessage?.className) {
    if (elements.blogStatusMessage.className.includes('success')) statusMessageType = 'success';
    else if (elements.blogStatusMessage.className.includes('warning')) statusMessageType = 'warning';
    else if (elements.blogStatusMessage.className.includes('error')) statusMessageType = 'error';
  }
  const payload = { statusLineText, statusMessageText, statusMessageType };
  chrome.storage.local.set({ [BLOG_POPUP_STATE_PREFIX + cacheKey]: payload }).catch(() => {});
}

function applyBlogPopupStateToDom(state) {
  if (!state || typeof state !== 'object') return;
  if (state.statusLineText !== undefined && elements.blogStatusLine) {
    elements.blogStatusLine.textContent = state.statusLineText || '';
    elements.blogStatusLine.classList.toggle('hidden', !state.statusLineText);
    if (state.statusLineText) elements.blogStatusLine.scrollLeft = 0;
  }
  if (state.statusMessageText !== undefined && elements.blogStatusText && elements.blogStatusMessage) {
    elements.blogStatusText.textContent = state.statusMessageText || '';
    elements.blogStatusMessage.className = 'status-message status-message-above-actions ' + (state.statusMessageType || 'info');
    elements.blogStatusMessage.classList.toggle('hidden', !state.statusMessageText);
  }
}

async function restoreBlogPopupState() {
  if (currentMode !== 'blog') return;
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) return;
  try {
    const key = BLOG_POPUP_STATE_PREFIX + cacheKey;
    const stored = await chrome.storage.local.get(key);
    applyBlogPopupStateToDom(stored[key]);
  } catch (_) {}
}

async function tryShowLastVerifyResult() {
  if (!currentTab?.id || currentMode !== 'blog') return;
  try {
    const key = 'lastVerifyResult_' + currentTab.id;
    const stored = await chrome.storage.session.get(key);
    const result = stored[key];
    if (result && (result.message || result.success !== undefined)) {
      showBlogMessage(result.message || (result.success ? '已在页面中找到您的站点链接' : '未在页面中检测到您的站点链接'), result.success ? 'success' : 'warning');
      await chrome.storage.session.remove(key);
    }
  } catch (_) {}
}

// ========== 消息展示 ==========

function showBlogMessage(message, type = 'info') {
  if (!elements.blogStatusText || !elements.blogStatusMessage) return;
  elements.blogStatusText.textContent = message;
  elements.blogStatusMessage.className = 'status-message status-message-above-actions ' + type;
  elements.blogStatusMessage.classList.remove('hidden');
  if (type === 'success' || type === 'warning') {
    setTimeout(hideBlogMessage, 5000);
  }
  saveBlogPopupState();
}

function hideBlogMessage() {
  if (elements.blogStatusMessage) elements.blogStatusMessage.classList.add('hidden');
  saveBlogPopupState();
}

function setBlogStatusLine(text) {
  if (!elements.blogStatusLine) return;
  elements.blogStatusLine.textContent = text || '';
  elements.blogStatusLine.classList.toggle('hidden', !text);
  if (text) elements.blogStatusLine.scrollLeft = 0;
  saveBlogPopupState();
}

// ========== Batch 消息展示 ==========

function showBatchMessage(message, type = 'info') {
  if (!elements.batchStatusText || !elements.batchStatusMessage) return;
  elements.batchStatusText.textContent = message;
  elements.batchStatusMessage.className = 'status-message status-message-above-actions ' + type;
  elements.batchStatusMessage.classList.remove('hidden');
  if (type === 'success' || type === 'warning') {
    setTimeout(hideBatchMessage, 5000);
  }
}

function hideBatchMessage() {
  if (elements.batchStatusMessage) elements.batchStatusMessage.classList.add('hidden');
}

function setBatchStatusLine(text) {
  if (!elements.batchStatusLine) return;
  elements.batchStatusLine.textContent = text || '';
  elements.batchStatusLine.classList.toggle('hidden', !text);
  if (text) elements.batchStatusLine.scrollLeft = 0;
}

function showFeishuMessage(message, type = 'info') {
  if (!elements.feishuStatusText || !elements.feishuStatusMessage) return;
  elements.feishuStatusText.textContent = message;
  elements.feishuStatusMessage.className = 'status-message ' + type;
  elements.feishuStatusMessage.classList.remove('hidden');
  if (type === 'success' || type === 'warning') {
    setTimeout(() => {
      if (elements.feishuStatusMessage) elements.feishuStatusMessage.classList.add('hidden');
    }, 5000);
  }
}

/**
 * 仅执行遍历检测循环（与「遍历检测可评论站点」按钮共用）
 * 必须在 setupEventListeners 之前定义为顶层函数，供自动采集步骤4调用。
 * @param {string} currentBatchId
 */
async function runTraverseLoopOnly(currentBatchId) {
  const TRAVERSE_DELAY_MS = 800;
  const DR_MIN_THRESHOLD = 20;
  let batch = await loadBatch(currentBatchId);
  if (!batch || !batch.traverseBacklinkList || batch.traverseBacklinkList.length === 0) return;
  const traverseList = batch.traverseBacklinkList;

  const backlinkDetails = batch.backlinkDetails || [];
  const urlToDrMap = new Map();
  for (const detail of backlinkDetails) {
    if (detail.urlFrom) {
      const normUrl = normalizeUrl(detail.urlFrom);
      urlToDrMap.set(normUrl, detail.domainRating || 0);
    }
  }

  for (let i = batch.lastProcessedIndex || 0; i < traverseList.length; i++) {
    if (autoCollectStopped) {
      const b = await loadBatch(currentBatchId);
      if (b) {
        b.status = 'stopped';
        b.updatedAt = new Date().toISOString();
        await saveExploreBatchWithExcludeFilter(b);
        if (exploreCurrentBatch?.batchId === currentBatchId) exploreCurrentBatch = b;
      }
      addAutoCollectLog('步骤4: 已停止', 'warning');
      return;
    }
    if (autoCollectRunning) {
      addAutoCollectLog(`步骤4: 待检测 URL ${i + 1}/${traverseList.length}`, 'info');
    }
    const loaded = await loadBatch(currentBatchId);
    if (loaded && (loaded.status === 'paused' || loaded.status === 'stopped')) {
      exploreCurrentBatch = loaded;
      updateExploreControls(loaded.status);
      showExploreMessage(loaded.status === 'stopped' ? '已停止' : '已暂停', 'info');
      return;
    }
    if (loaded) batch = loaded;
    const url = traverseList[i];
    const urlNorm = normalizeUrl(url);

    const urlDr = urlToDrMap.get(urlNorm) ?? 0;
    if (urlDr < DR_MIN_THRESHOLD) {
      console.log(`[Traverse] 跳过 DR=${urlDr} < ${DR_MIN_THRESHOLD}: ${urlNorm}`);
      batch.urlProgress = batch.urlProgress || {};
      batch.urlProgress[urlNorm] = { commentable: false, blogCommentScore: 0, requiresLogin: false, skipped: true, skipReason: `DR ${urlDr} < ${DR_MIN_THRESHOLD}` };
      batch.lastProcessedIndex = i + 1;
      batch.updatedAt = new Date().toISOString();
      await saveExploreBatchWithExcludeFilter(batch);
      if (exploreCurrentBatch?.batchId === currentBatchId) exploreCurrentBatch = batch;
      continue;
    }

    showExploreMessage(`检测可评论 (${i + 1}/${traverseList.length}): ${urlNorm.slice(0, 50)}…`, 'info');
    let tab;
    try {
      tab = await new Promise((resolve) => chrome.tabs.create({ url: urlNorm || url }, resolve));
    } catch (e) {
      batch.urlProgress = batch.urlProgress || {};
      batch.urlProgress[urlNorm] = { commentable: false, error: e?.message };
      batch.lastProcessedIndex = i + 1;
      batch.updatedAt = new Date().toISOString();
      await saveExploreBatchWithExcludeFilter(batch);
      if (exploreCurrentBatch?.batchId === currentBatchId) exploreCurrentBatch = batch;
      continue;
    }
    const tabId = tab.id;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 12000);
      const listener = (id, changeInfo) => {
        if (id === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await new Promise((r) => setTimeout(r, 1500));
    const response = await chrome.tabs.sendMessage(tabId, { action: 'recognizeCommentForm', useLlm: false }).catch(() => null);
    chrome.tabs.remove(tabId).catch(() => {});

    const loadedAfter = await loadBatch(currentBatchId);
    if (loadedAfter && (loadedAfter.status === 'paused' || loadedAfter.status === 'stopped')) {
      exploreCurrentBatch = loadedAfter;
      updateExploreControls(loadedAfter.status);
      showExploreMessage(loadedAfter.status === 'stopped' ? '已停止' : '已暂停', 'info');
      return;
    }

    const commentable = response?.success && response?.result?.isBlogCommentSite === true;
    const blogCommentScore = response?.result?.blogCommentScore;
    const requiresLogin = response?.result?.requiresLogin === true;
    const isNavigationSite = false;

    batch.urlProgress = batch.urlProgress || {};
    batch.urlProgress[urlNorm] = { commentable, blogCommentScore, requiresLogin, isNavigationSite };

    if (typeof updateBacklinkFlagsInFeishu === 'function') {
      try {
        const flagsResult = await updateBacklinkFlagsInFeishu(urlNorm, {
          isBlogComment: commentable,
          requiresLogin: requiresLogin,
          isNavigationSite: isNavigationSite,
          blogCommentScore: blogCommentScore
        });
        if (!flagsResult.ok && !flagsResult.skipped && flagsResult.error) {
          console.warn('[Traverse] 回写飞书标记失败:', flagsResult.error);
        } else if (flagsResult.updated) {
          console.log('[Traverse] 已回写飞书标记:', urlNorm);
        }
      } catch (e) {
        console.warn('[Traverse] 回写飞书标记异常:', e);
      }
    }

    if (commentable) {
      batch.discoveredSites = batch.discoveredSites || [];
      const exists = batch.discoveredSites.some((s) => normalizeUrl((s && s.url) || s) === urlNorm);
      if (!exists) {
        const newSite = { url: urlNorm, discoveredAt: new Date().toISOString(), blogCommentScore, requiresLogin, isNavigationSite };
        batch.discoveredSites.push(newSite);
      }
    }
    batch.lastProcessedIndex = i + 1;
    batch.updatedAt = new Date().toISOString();
    await saveExploreBatchWithExcludeFilter(batch);
    if (exploreCurrentBatch && exploreCurrentBatch.batchId === currentBatchId) exploreCurrentBatch = batch;
    renderExploreDiscoveredList();
    await new Promise((r) => setTimeout(r, TRAVERSE_DELAY_MS));
  }
  batch.phase = 'idle';
  batch.status = 'idle';
  batch.updatedAt = new Date().toISOString();
  await saveExploreBatchWithExcludeFilter(batch);
  if (exploreCurrentBatch && exploreCurrentBatch.batchId === currentBatchId) exploreCurrentBatch = batch;
  updateExploreControls(batch.status);
  const total = (batch.discoveredSites || []).length;
  showExploreMessage(`遍历结束：已发现 ${total} 个可评论站`, 'success');
  if (autoCollectRunning) {
    addAutoCollectLog(`步骤4: 遍历结束，发现 ${total} 个可评论站`, 'success');
  }
}

/**
 * 重置外链采集「运行状态」：清空 storage 中的外链批次与自动采集任务，并重置侧栏内存与 UI。
 * 不调用 clearAllAhrefsCache，保留 Ahrefs 域名/反链缓存以便继续复用。
 */
async function resetExploreCollectionState() {
  if (autoCollectRunning) {
    autoCollectStopped = true;
  }
  exploreAhrefsAborted = true;
  exploreAhrefsPaused = false;

  autoCollectStorageSuppressed = true;

  await chrome.storage.local.remove(['backlinkExplorationBatches', AUTO_COLLECT_TASK_KEY]);

  exploreCurrentBatch = null;
  exploreSelectedUrls = new Set();
  exploreAhrefsDomains = [];
  exploreAhrefsRunning = false;
  exploreAhrefsPaused = false;
  exploreAhrefsAborted = false;
  exploreAhrefsDomainsQueue = [];
  exploreAhrefsCurrentIndex = 0;
  exploreAhrefsFeishuConfig = null;

  autoCollectTask = null;
  autoCollectRunning = false;
  autoCollectPaused = false;
  autoCollectStopped = false;
  autoCollectLoopRunning = false;
  autoCollectRunStuck = false;
  autoCollectHistoryTask = null;
  autoCollectLogs = [];
  autoCollectLastKnownStep = 0;
  setAutoCollectErrorText('');

  if (elements.autoCollectProgress) {
    elements.autoCollectProgress.classList.add('hidden');
  }
  if (elements.autoCollectQueueSection) {
    elements.autoCollectQueueSection.classList.add('hidden');
  }
  if (elements.autoCollectLogSection) {
    elements.autoCollectLogSection.classList.add('hidden');
  }
  renderAutoCollectLogs();
  updateAutoCollectProgress(0, '准备中...');
  updateAutoCollectControls(false, false);
  updateAutoCollectStatusDetails();
  renderAutoCollectQueue();

  if (elements.exploreBatchId) elements.exploreBatchId.textContent = '—';
  if (elements.exploreBatchStatus) {
    elements.exploreBatchStatus.textContent = '';
    elements.exploreBatchStatus.classList.add('hidden');
  }
  if (elements.exploreAhrefsOverview) {
    elements.exploreAhrefsOverview.innerHTML = '';
    elements.exploreAhrefsOverview.classList.add('hidden');
  }
  if (elements.exploreAhrefsProgress) {
    elements.exploreAhrefsProgress.innerHTML = '';
    elements.exploreAhrefsProgress.classList.add('hidden');
  }
  renderExploreUrlList();
  renderExploreDiscoveredList();
  renderExploreDugDomainsList();
  await renderExploreBatchSelect();
  updateExploreControls(null);
}

// ========== 事件监听设置 ==========

function setupEventListeners() {
  // 模式切换
  elements.modeTabs?.forEach((tab) => {
    tab.addEventListener('click', async () => {
      showModePanel(tab.dataset.mode);
    });
  });

  // 刷新当前页面
  elements.refreshTabBtn?.addEventListener('click', async () => {
    if (!currentTab?.id) return;
    try {
      await chrome.tabs.reload(currentTab.id);
      if (currentMode === 'nav') {
        showNavMessage('页面刷新中…', 'info');
      } else {
        showBlogMessage('页面刷新中…', 'info');
      }
    } catch (e) {
      if (currentMode === 'nav') {
        showNavMessage('无法刷新该页面', 'error');
      } else {
        showBlogMessage('无法刷新该页面', 'error');
      }
    }
  });

  // ========== 导航站模式事件 ==========

  // 导航站站点选择
  elements.navSiteSelect?.addEventListener('change', async () => {
    const newId = elements.navSiteSelect?.value || null;
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.currentSiteId = newId;
    await chrome.storage.local.set({ settings });
    currentSiteId = newId;
    updateCurrentSiteUrlDisplay();
    updateNavFormStatus();
  });

  // 添加站点链接
  elements.navAddSiteLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 自动提交复选框
  elements.navAutoSubmit?.addEventListener('change', async () => {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.autoSubmit = elements.navAutoSubmit.checked;
    await chrome.storage.local.set({ settings });
  });

  // 自动识别并填充按钮
  elements.navFillFormBtn?.addEventListener('click', async () => {
    if (!currentSiteId) {
      showNavMessage('请先选择一个站点', 'warning');
      return;
    }

    elements.navFillFormBtn.disabled = true;

    try {
      // 1. 先识别表单
      elements.navFillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 识别中...';
      const recognizeResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'recognizeForm',
        useLlm: false
      });

      const result = recognizeResponse.result || {};
      if (!recognizeResponse.success || result.status !== 'success') {
        const errMsg = result.status === 'no_form' ? (result.message || '当前页面未检测到可填表单') : (recognizeResponse.error || result.error || '识别失败');
        showNavMessage(errMsg, 'error');
        return;
      }

      const count = result.fieldCount ?? (Array.isArray(result.mappings) ? result.mappings.length : 0);
      let domain = pageState?.domain;
      try {
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
          domain = domain || new URL(currentTab.url).hostname;
        }
      } catch (_) {}
      pageState = {
        hasForm: true,
        fieldMappings: result.mappings || [],
        recognitionStatus: 'done',
        recognitionMethod: result.method,
        domain
      };
      updateNavFormStatus();

      if (count === 0) {
        showNavMessage('未匹配到可填字段，请检查页面或尝试在其它提交页使用', 'warning');
        return;
      }

      // 2. 再填充
      elements.navFillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 填充中...';
      const fillResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'fillForm',
        siteId: currentSiteId
      });

      if (fillResponse.success) {
        const fillResult = fillResponse.result;
        let message = `已填充 ${fillResult.filledCount} 个字段`;
        if (fillResult.hasCaptcha) {
          message += '\n\n检测到验证码，请手动完成验证后提交。';
        }
        if (fillResult.errors && fillResult.errors.length > 0) {
          message += `\n\n部分字段填充失败:\n${fillResult.errors.join('\n')}`;
        }
        showNavMessage(message, 'success');
      } else {
        showNavMessage(fillResponse.error || '填充失败', 'error');
      }
    } catch (error) {
      console.error('[SidePanel] Nav recognize or fill error:', error);
      showNavMessage(error?.message?.includes('Receiving end') ? '无法在此页面使用（请打开普通网页）' : '操作失败: ' + error.message, 'error');
    } finally {
      elements.navFillFormBtn.disabled = false;
      elements.navFillFormBtn.innerHTML = '<span class="btn-icon">✏️</span> 自动识别并填充';
    }
  });

  // AI 智能识别按钮
  elements.navAiFillFormBtn?.addEventListener('click', async () => {
    if (!currentSiteId) {
      showNavMessage('请先选择一个站点', 'warning');
      return;
    }

    if (!llmEnabled) {
      showNavMessage('请先在设置中启用 LLM 并配置 GLM API Key', 'warning');
      return;
    }

    elements.navAiFillFormBtn.disabled = true;

    try {
      // 1. 先使用 AI 识别表单
      elements.navAiFillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> AI 识别中...';
      const recognizeResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'recognizeForm',
        useLlm: true
      });

      const result = recognizeResponse.result || {};
      if (!recognizeResponse.success || result.status !== 'success') {
        const errMsg = result.status === 'no_form' ? (result.message || '当前页面未检测到可填表单') : (recognizeResponse.error || result.error || 'AI 识别失败');
        showNavMessage(errMsg, 'error');
        return;
      }

      const count = result.fieldCount ?? (Array.isArray(result.mappings) ? result.mappings.length : 0);
      let domain = pageState?.domain;
      try {
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
          domain = domain || new URL(currentTab.url).hostname;
        }
      } catch (_) {}
      pageState = {
        hasForm: true,
        fieldMappings: result.mappings || [],
        recognitionStatus: 'done',
        recognitionMethod: result.method,
        domain
      };
      updateNavFormStatus();

      if (count === 0) {
        showNavMessage('AI 未识别到可填字段，请检查页面或尝试使用「自动识别并填充」', 'warning');
        return;
      }

      // 2. 再填充
      elements.navAiFillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 填充中...';
      const fillResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'fillForm',
        siteId: currentSiteId
      });

      if (fillResponse.success) {
        const fillResult = fillResponse.result;
        let message = `AI 识别 + 已填充 ${fillResult.filledCount} 个字段`;
        if (fillResult.hasCaptcha) {
          message += '\n\n检测到验证码，请手动完成验证后提交。';
        }
        if (fillResult.errors && fillResult.errors.length > 0) {
          message += `\n\n部分字段填充失败:\n${fillResult.errors.join('\n')}`;
        }
        showNavMessage(message, 'success');
      } else {
        showNavMessage(fillResponse.error || '填充失败', 'error');
      }
    } catch (error) {
      console.error('[SidePanel] AI recognize or fill error:', error);
      showNavMessage(error?.message?.includes('Receiving end') ? '无法在此页面使用（请打开普通网页）' : '操作失败: ' + error.message, 'error');
    } finally {
      elements.navAiFillFormBtn.disabled = false;
      elements.navAiFillFormBtn.innerHTML = '<span class="btn-icon">🤖</span> AI 智能识别';
    }
  });

  // 清除缓存按钮
  elements.navClearCacheBtn?.addEventListener('click', async () => {
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'clearMapping' });
      if (response?.success) {
        showNavMessage('已清除本页缓存，请再次点击「自动识别并填充」', 'success');
        await getNavPageState();
      } else {
        showNavMessage('清除失败', 'error');
      }
    } catch (error) {
      if (error?.message?.includes('Receiving end')) {
        showNavMessage('无法在此页面使用（请打开普通网页）', 'error');
      } else {
        showNavMessage('清除失败: ' + error.message, 'error');
      }
    }
  });

  // 快捷操作
  elements.openNavSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?tab=navSites') });
  });

  elements.navOpenOptionsBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // ========== Blog 评论模式事件 ==========

  // Blog 站点选择
  elements.blogSiteSelect?.addEventListener('change', async () => {
    const newId = elements.blogSiteSelect?.value || null;
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.currentSiteId = newId;
    await chrome.storage.local.set({ settings });
    currentSiteId = newId;
    updateCurrentSiteUrlDisplay();
    updateBlogFormStatus();
  });

  // ========== 批量提交模式事件 ==========

  // 批量提交站点选择
  elements.batchSiteSelect?.addEventListener('change', async () => {
    const newId = elements.batchSiteSelect?.value || null;
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.currentSiteId = newId;
    await chrome.storage.local.set({ settings });
    currentSiteId = newId;
    updateBatchSiteUrlDisplay();
    updateBatchStartButton();
  });

  // 添加站点链接（批量提交）
  elements.batchAddSiteLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 管理站点按钮
  elements.blogManageSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 添加站点链接
  elements.blogAddSiteLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 自动提交复选框
  elements.autoSubmit?.addEventListener('change', async () => {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.autoSubmit = elements.autoSubmit.checked;
    await chrome.storage.local.set({ settings });
  });

  elements.useFullAi?.addEventListener('change', async () => {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.useFullAi = elements.useFullAi.checked;
    await chrome.storage.local.set({ settings });
  });

  // 生成评论并填充
  elements.blogGenerateAndFillBtn?.addEventListener('click', async () => {
    if (!currentSiteId || !currentTab?.id) {
      showBlogMessage('请先选择当前站点', 'warning');
      return;
    }
    const useFullAi = elements.useFullAi?.checked ?? false;
    if (useFullAi && !llmEnabled) {
      showBlogMessage('完全 AI 识别需要先配置 LLM API', 'warning');
      return;
    }

    elements.blogGenerateAndFillBtn.disabled = true;
    elements.blogGenerateAndFillBtn.innerHTML = '<span class="btn-icon">⏳</span> 生成中...';
    setBlogStatusLine('');
    const t0 = Date.now();
    try {
      const metaRes = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageMetadata' });
      const title = metaRes?.title ?? '';
      const description = metaRes?.description ?? '';
      const h1 = metaRes?.h1 ?? '';
      const site = sites.find((s) => s.id === currentSiteId);

      if (useFullAi) {
        setBlogStatusLine('完全 AI 识别：生成评论中...');
        const genRes = await chrome.runtime.sendMessage({
          action: 'generateBlogComment',
          title,
          description,
          h1,
          siteUrl: site?.siteUrl
        });
        if (!genRes?.success || !genRes?.comment) {
          showBlogMessage(genRes?.error || '评论生成失败', 'error');
          setBlogStatusLine(`失败 · 已耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          return;
        }
        setBlogStatusLine('完全 AI 识别：多轮决策执行中...');
        const res = await chrome.runtime.sendMessage({
          action: 'fullAiRunTask',
          tabId: currentTab.id,
          siteUrl: site?.siteUrl || '',
          generatedComment: genRes.comment,
          siteId: currentSiteId
        });
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        if (!res?.success) {
          showBlogMessage(res?.error || '完全 AI 识别失败', 'error');
          setBlogStatusLine(`失败 · 已耗时 ${elapsed}s`);
          return;
        }
        setBlogStatusLine(`耗时 ${elapsed}s (完全AI) · ${res.reason || '已完成'}`);
        showBlogMessage(res.reason || '完全 AI 识别已完成', 'success');
        return;
      }

      const statusHint = llmEnabled ? 'AI 评论生成与表单识别中...' : '评论生成与表单识别中...';
      setBlogStatusLine(statusHint);

      const res = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'blogCommentGenerateAndFill',
        title,
        description,
        h1,
        siteId: currentSiteId,
        autoSubmit: elements.autoSubmit?.checked ?? false,
        llmEnabled,
        tabId: currentTab.id,
        siteUrl: site?.siteUrl
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res?.success) {
        showBlogMessage(res?.error || '操作失败', 'error');
        setBlogStatusLine(`失败 · 已耗时 ${elapsed}s`);
        return;
      }

      const r = res.result;
      const totalFields = r.fieldCount ?? r.filledCount ?? 0;
      const allFilled = totalFields > 0 && r.filledCount >= totalFields;
      let checkText = '';
      if (allFilled && !r.hasSpamVerification && r.clickedSubmit) {
        checkText = '完整检查：已填充全部字段并已自动提交。';
      } else if (allFilled && r.hasSpamVerification) {
        checkText = '完整检查：已填充全部字段，因检测到验证项未自动提交。';
      } else if (allFilled) {
        checkText = '完整检查：已填充全部字段，可手动提交。';
      } else {
        checkText = `完整检查：已填充 ${r.filledCount}/${totalFields} 个字段，未完全填充。`;
      }
      const methodHint = r.method === 'oneShot' ? '一发' : r.method === 'cache' ? '缓存' : '关键词';
      setBlogStatusLine(
        `耗时 ${elapsed}s (${methodHint}) · 已填充 ${r.filledCount} 个字段${r.consentCheckboxesChecked > 0 ? `，已勾选 ${r.consentCheckboxesChecked} 个选项` : ''} · ${checkText}`
      );

      let msg = `已填充 ${r.filledCount} 个字段。`;
      if (r.consentCheckboxesChecked > 0) msg += ` 已勾选 ${r.consentCheckboxesChecked} 个选项。`;
      if (r.hasSpamVerification) {
        msg += ' 检测到验证项，请手动完成验证后点击提交。';
      } else if (r.clickedSubmit) {
        msg += ' 已自动点击提交。页面刷新后将自动验证本站链接是否出现。';
      }
      showBlogMessage(msg, 'success');
    } catch (err) {
      showBlogMessage(err?.message?.includes('Receiving end') ? '请刷新页面后再试' : (err?.message || '操作失败'), 'error');
      setBlogStatusLine(`出错 · 已耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } finally {
      elements.blogGenerateAndFillBtn.disabled = false;
      elements.blogGenerateAndFillBtn.innerHTML = '<span class="btn-icon">💬</span> 生成评论并填充';
    }
  });

  // 验证本次提交
  elements.blogVerifySubmitBtn?.addEventListener('click', async () => {
    if (!currentSiteId || !currentTab?.id) return;
    const site = sites.find((s) => s.id === currentSiteId);
    if (!site?.siteUrl) {
      showBlogMessage('当前站点未设置网站 URL', 'warning');
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'verifyCommentSubmission', siteUrl: site.siteUrl });
      if (res?.success && res.result?.success) showBlogMessage(res.result.message, 'success');
      else showBlogMessage(res?.result?.message || '未在页面中检测到您的站点链接', 'warning');
    } catch (e) {
      showBlogMessage(e?.message || '验证失败', 'error');
    }
  });

  // 关闭状态消息
  elements.blogCloseStatusBtn?.addEventListener('click', hideBlogMessage);

  // 清除缓存
  elements.blogClearCacheBtn?.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(currentTab.id, { action: 'clearCommentMapping' });
      showBlogMessage('已清除本页评论缓存', 'success');
      await getCommentPageState();
      await updateBlogClearCacheState();
    } catch (e) {
      showBlogMessage('清除失败', 'error');
    }
  });

  // 点击可填字段行高亮
  elements.blogFieldCountRow?.addEventListener('click', async (e) => {
    if (e.target.closest('.blog-field-nav-btns')) return;
    if (!currentTab?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'highlightCommentFieldsFromCache' });
      if (res?.success) {
        if (res.cleared) {
          showBlogMessage('已取消高亮', 'info');
        } else if (res.highlightedCount != null && res.highlightedCount > 0) {
          showBlogMessage(`已在页面用蓝色虚线框标出 ${res.highlightedCount} 个可填字段`, 'success');
        } else {
          showBlogMessage('已在页面标出可填字段', 'success');
        }
      } else {
        showBlogMessage(res?.error || '高亮失败', 'warning');
      }
    } catch (e) {
      const msg = e?.message?.includes('Receiving end') ? '请打开目标网页后再试' : (e?.message || '高亮失败');
      showBlogMessage(msg, 'warning');
    }
  });

  // 上/下箭头跳转
  elements.blogFieldPrevBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentTab?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'highlightCommentFieldPrev' });
      if (res?.success) {
        showBlogMessage(`第 ${(res.index ?? 0) + 1}/${res.total ?? 0} 个字段`, 'info');
      } else {
        showBlogMessage(res?.error || '跳转失败', 'warning');
      }
    } catch (err) {
      showBlogMessage(err?.message?.includes('Receiving end') ? '请打开目标网页后再试' : '跳转失败', 'warning');
    }
  });

  elements.blogFieldNextBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentTab?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'highlightCommentFieldNext' });
      if (res?.success) {
        showBlogMessage(`第 ${(res.index ?? 0) + 1}/${res.total ?? 0} 个字段`, 'info');
      } else {
        showBlogMessage(res?.error || '跳转失败', 'warning');
      }
    } catch (err) {
      showBlogMessage(err?.message?.includes('Receiving end') ? '请打开目标网页后再试' : '跳转失败', 'warning');
    }
  });

  // 快捷操作
  elements.openBlogSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?tab=blogSites') });
  });

  elements.blogOpenOptionsBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // ========== 批量提交模式事件 ==========

  // 保存飞书凭证
  elements.saveFeishuCredentialsBtn?.addEventListener('click', async () => {
    const credentials = {
      feishuAppId: elements.feishuAppId?.value?.trim() || '',
      feishuAppSecret: elements.feishuAppSecret?.value?.trim() || '',
      feishuAppToken: elements.feishuAppToken?.value?.trim() || '',
      feishuTableId: elements.feishuTableId?.value?.trim() || ''
    };

    if (!credentials.feishuAppId || !credentials.feishuAppSecret || !credentials.feishuAppToken || !credentials.feishuTableId) {
      showFeishuMessage('请填写所有飞书凭证字段', 'warning');
      return;
    }

    await chrome.storage.local.set({ feishuCredentials: credentials });
    showFeishuMessage('飞书凭证已保存', 'success');
    elements.syncFromFeishuBtn.disabled = false;
  });

  // 从飞书同步
  elements.syncFromFeishuBtn?.addEventListener('click', async () => {
    await syncFromFeishu();
  });

  // 同步条数限制变化
  elements.feishuSyncLimit?.addEventListener('change', async () => {
    feishuSyncLimit = parseInt(elements.feishuSyncLimit?.value || '10', 10);
    // 保存到存储
    await chrome.storage.local.set({ feishuSyncLimit });
  });

  // 筛选器变化
  elements.batchTypeFilter?.addEventListener('change', () => renderBatchUrlList());
  elements.batchStatusFilter?.addEventListener('change', () => renderBatchUrlList());

  // 全选/取消全选
  elements.selectAllBtn?.addEventListener('click', () => {
    batchUrls.forEach(item => item.selected = true);
    const checkboxes = elements.batchUrlList?.querySelectorAll('input[type="checkbox"]');
    checkboxes?.forEach(cb => cb.checked = true);
    updateBatchStartButton();
  });

  elements.deselectAllBtn?.addEventListener('click', () => {
    batchUrls.forEach(item => item.selected = false);
    const checkboxes = elements.batchUrlList?.querySelectorAll('input[type="checkbox"]');
    checkboxes?.forEach(cb => cb.checked = false);
    updateBatchStartButton();
  });

  // 开始批量提交
  elements.startBatchBtn?.addEventListener('click', async () => {
    await startBatchSubmit();
  });

  // 暂停
  elements.pauseBatchBtn?.addEventListener('click', () => {
    batchPaused = !batchPaused;
    if (elements.pauseBatchBtn) {
      elements.pauseBatchBtn.innerHTML = batchPaused ? '<span class="btn-icon">▶️</span>继续' : '<span class="btn-icon">⏸️</span>暂停';
    }
  });

  // 停止
  elements.stopBatchBtn?.addEventListener('click', () => {
    batchRunning = false;
    batchPaused = false;
    updateBatchControls(false);
    addBatchLog('批量任务已停止', 'warning');
  });

  // 清除日志
  elements.clearBatchLogBtn?.addEventListener('click', () => {
    if (elements.batchLogContainer) {
      elements.batchLogContainer.innerHTML = '<div class="empty-log-hint">暂无日志</div>';
    }
  });

  // 关闭状态消息
  elements.batchCloseStatusBtn?.addEventListener('click', () => {
    hideBatchMessage();
  });

  // ========== 外链采集模式事件 ==========
  /** 仅清除 Ahrefs 域名缓存（storage 元数据 + IndexedDB），不影响批次与自动采集任务 */
  elements.exploreClearCacheBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    if (!confirm(
      '确定清除 Ahrefs 域名缓存吗？\n\n' +
      '将删除元数据（storage）与 IndexedDB 中的反链缓存；不会清空外链批次与自动采集任务。'
    )) return;
    try {
      if (typeof clearAllAhrefsCache === 'function') {
        await clearAllAhrefsCache();
        console.log('[Explore] Ahrefs 域名缓存已清除');
      }
      showExploreMessage('已清除 Ahrefs 域名缓存', 'success');
    } catch (e) {
      showExploreMessage(e?.message || '清除失败', 'error');
    }
  });

  /** 清空任务/批次并重置侧栏，保留 Ahrefs 缓存，便于重新开始采集 */
  elements.exploreResetStateBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    if (!confirm(
      '确定要重置外链采集运行状态吗？\n\n' +
      '将删除：全部外链批次（storage）、自动采集任务记录（若存在）；\n' +
      '不会删除 Ahrefs 域名缓存。\n' +
      '若自动采集正在运行，会先请求停止再清空。\n\n此操作不可撤销。'
    )) return;
    try {
      await resetExploreCollectionState();
      showExploreMessage('已重置外链采集状态（已保留 Ahrefs 缓存）', 'success');
    } catch (e) {
      showExploreMessage(e?.message || '重置失败', 'error');
    }
  });

  function closeExploreDetectModal() {
    if (elements.exploreManualDetectModal) {
      elements.exploreManualDetectModal.classList.add('hidden');
      elements.exploreManualDetectModal.setAttribute('aria-hidden', 'true');
    }
  }
  function showExploreDetectModal(threshold, score, isBlogCommentSite, domain, requiresLogin) {
    if (elements.exploreDetectThreshold) elements.exploreDetectThreshold.textContent = String(threshold);
    if (elements.exploreDetectScore) elements.exploreDetectScore.textContent = typeof score === 'number' ? String(score) : '—';
    if (elements.exploreDetectResult) {
      elements.exploreDetectResult.textContent = isBlogCommentSite ? '✅ 是 Blog 评论站' : '❌ 否';
      elements.exploreDetectResult.setAttribute('aria-label', isBlogCommentSite ? '是 Blog 评论站' : '否');
    }
    if (elements.exploreDetectDomain) {
      elements.exploreDetectDomain.textContent = domain ? `（${domain}）` : '';
    }
    if (elements.exploreDetectRequiresLogin) {
      if (requiresLogin === true) {
        elements.exploreDetectRequiresLogin.textContent = '是';
      } else if (requiresLogin === false) {
        elements.exploreDetectRequiresLogin.textContent = '否';
      } else {
        elements.exploreDetectRequiresLogin.textContent = '—';
      }
    }
    if (elements.exploreManualDetectModal) {
      elements.exploreManualDetectModal.classList.remove('hidden');
      elements.exploreManualDetectModal.setAttribute('aria-hidden', 'false');
    }
  }
  elements.exploreManualDetectBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !tab.url) {
        showExploreMessage('无法获取当前活动页', 'error');
        return;
      }
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
        showExploreMessage('当前页不是 http(s) 页面，无法检测', 'error');
        return;
      }
      showExploreMessage('检测中…', 'info');
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'recognizeCommentForm', useLlm: false }).catch((e) => ({ success: false, error: e?.message }));
      const storage = await chrome.storage.local.get(['blogCommentSiteThreshold']);
      const threshold = typeof storage.blogCommentSiteThreshold === 'number' && storage.blogCommentSiteThreshold >= 0
        ? storage.blogCommentSiteThreshold
        : 3;
      if (!response?.success) {
        if (response?.error && response.error.includes('Could not establish connection. Receiving end does not exist.') && tab.id) {
          console.warn('[Explore] recognizeCommentForm 连接失败，自动刷新当前标签页', { tabId: tab.id, error: response.error });
          chrome.tabs.reload(tab.id);
        }
        showExploreMessage('检测失败: ' + (response?.error || '未注入或页面未加载'), 'error');
        return;
      }
      const score = response.result?.blogCommentScore;
      const isBlog = response.result?.isBlogCommentSite === true;
      const requiresLogin = response.result?.requiresLogin;
      let domain = '';
      try {
        domain = tab.url ? new URL(tab.url).hostname : '';
      } catch (_) {}
      showExploreDetectModal(threshold, score, isBlog, domain, requiresLogin);
    } catch (e) {
      showExploreMessage('检测异常: ' + (e && e.message ? e.message : String(e)), 'error');
    }
  });
  elements.exploreManualDetectModalClose?.addEventListener('click', closeExploreDetectModal);
  if (elements.exploreManualDetectModal?.querySelector('.explore-detect-modal-backdrop')) {
    elements.exploreManualDetectModal.querySelector('.explore-detect-modal-backdrop').addEventListener('click', closeExploreDetectModal);
  }

  elements.exploreExtractCommentUrlsBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    const pageUrl = elements.exploreCommentPageUrl?.value?.trim() || '';
    if (!pageUrl) {
      showExploreMessage('请输入含评论的博客文章 URL', 'warning');
      return;
    }
    let targetUrl = pageUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) targetUrl = 'https://' + targetUrl;
    try {
      new URL(targetUrl);
    } catch (_) {
      showExploreMessage('URL 格式无效', 'error');
      return;
    }
    if (typeof generateBatchId !== 'function' || typeof createBatch !== 'function' || typeof dedupeUrls !== 'function') return;
    try {
      showExploreMessage('正在打开页面并提取评论区链接…', 'info');
      const tab = await new Promise((resolve) => {
        chrome.tabs.create({ url: targetUrl }, resolve);
      });
      const tabId = tab.id;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('页面加载超时'));
        }, 20000);
        const listener = (id, changeInfo) => {
          if (id === tabId && changeInfo.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      const response = await chrome.tabs.sendMessage(tabId, { action: 'extractCommentUrls' }).catch((e) => ({ success: false, error: e?.message || '无法与页面通信' }));
      if (!response || !response.success) {
        showExploreMessage(response?.error || '提取失败', 'error');
        return;
      }
      const rawUrls = response.urls || [];
      const exclude = await getExploreExcludeDomainsForFilter();
      const filtered = typeof filterUrlsExcludingDomains === 'function' ? filterUrlsExcludingDomains(rawUrls, exclude) : rawUrls;
      let batch = exploreCurrentBatch;
      if (!batch) {
        const batchId = await generateBatchId();
        batch = createBatch(batchId, { type: 'comment_extract', sourceUrl: targetUrl });
        exploreCurrentBatch = batch;
        if (elements.exploreBatchId) elements.exploreBatchId.textContent = batch.batchId;
        if (elements.exploreBatchStatus) {
          elements.exploreBatchStatus.textContent = batch.status + ' · ' + (batch.phase || 'idle');
          elements.exploreBatchStatus.classList.remove('hidden');
        }
        updateExploreControls(batch.status);
      }
      const prevLen = (batch.urlList || []).length;
      const merged = dedupeUrls([...(batch.urlList || []), ...filtered]);
      batch.urlList = merged;
      // 将提取的 URL 转换为域名并保存到 dugDomains
      const extractedDomains = (typeof normalizeDomain === 'function')
        ? rawUrls.map(u => normalizeDomain(u)).filter(Boolean)
        : [];
      const dedupedDomains = (typeof dedupeDomains === 'function')
        ? dedupeDomains([...(batch.dugDomains || []), ...extractedDomains])
        : [...new Set([...(batch.dugDomains || []), ...extractedDomains])];
      batch.dugDomains = dedupedDomains;
      batch.updatedAt = new Date().toISOString();
      await saveExploreBatchWithExcludeFilter(batch);
      if (exploreCurrentBatch && exploreCurrentBatch.batchId === batch.batchId) exploreCurrentBatch = batch;
      renderExploreUrlList();
      renderExploreDugDomainsList();
      const addedCount = merged.length - prevLen;
      showExploreMessage(`已提取 ${rawUrls.length} 条链接，新增 ${addedCount} 条至待检测列表（共 ${merged.length} 条），挖到 ${dedupedDomains.length} 个域名`, 'success');
    } catch (e) {
      showExploreMessage(e?.message || '提取失败', 'error');
    }
  });

  elements.exploreExtractFromCurrentPageBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    if (typeof generateBatchId !== 'function' || typeof createBatch !== 'function' || typeof dedupeUrls !== 'function') return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab?.url) {
        showExploreMessage('无法获取当前活动标签页', 'warning');
        return;
      }
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
        showExploreMessage('当前页面不是 http/https，无法提取', 'warning');
        return;
      }
      showExploreMessage('正在从当前页面提取评论区链接…', 'info');
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractCommentUrls' }).catch((e) => ({ success: false, error: e?.message || '无法与页面通信' }));
      if (!response || !response.success) {
        if (response?.error && response.error.includes('Could not establish connection. Receiving end does not exist.') && tab.id) {
          console.warn('[Explore] extractCommentUrls 连接失败，自动刷新当前标签页', { tabId: tab.id, error: response.error });
          chrome.tabs.reload(tab.id);
        }
        showExploreMessage(response?.error || '提取失败（请刷新当前页后重试）', 'error');
        return;
      }
      const rawUrls = response.urls || [];
      const exclude = await getExploreExcludeDomainsForFilter();
      const filtered = typeof filterUrlsExcludingDomains === 'function' ? filterUrlsExcludingDomains(rawUrls, exclude) : rawUrls;
      let batch = exploreCurrentBatch;
      if (!batch) {
        const batchId = await generateBatchId();
        batch = createBatch(batchId, { type: 'comment_extract', sourceUrl: tab.url });
        exploreCurrentBatch = batch;
        if (elements.exploreBatchId) elements.exploreBatchId.textContent = batch.batchId;
        if (elements.exploreBatchStatus) {
          elements.exploreBatchStatus.textContent = batch.status + ' · ' + (batch.phase || 'idle');
          elements.exploreBatchStatus.classList.remove('hidden');
        }
        updateExploreControls(batch.status);
      }
      // 将提取的 URL 转换为域名并保存到 dugDomains（不填充待检测列表）
      const extractedDomains = (typeof normalizeDomain === 'function')
        ? rawUrls.map(u => normalizeDomain(u)).filter(Boolean)
        : [];
      const prevDomainsLen = (batch.dugDomains || []).length;
      const dedupedDomains = (typeof dedupeDomains === 'function')
        ? dedupeDomains([...(batch.dugDomains || []), ...extractedDomains])
        : [...new Set([...(batch.dugDomains || []), ...extractedDomains])];
      batch.dugDomains = dedupedDomains;
      batch.updatedAt = new Date().toISOString();
      await saveExploreBatchWithExcludeFilter(batch);
      if (exploreCurrentBatch && exploreCurrentBatch.batchId === batch.batchId) exploreCurrentBatch = batch;
      renderExploreDugDomainsList();
      const addedDomainsCount = dedupedDomains.length - prevDomainsLen;
      showExploreMessage(`已从当前页挖到 ${addedDomainsCount} 个新域名（共 ${dedupedDomains.length} 个）`, 'success');
    } catch (e) {
      showExploreMessage(e?.message || '提取失败', 'error');
    }
  });

  elements.exploreUrlListViewToggle?.addEventListener('click', () => {
    exploreUrlListDetailView = !exploreUrlListDetailView;
    renderExploreUrlList();
  });

  elements.exploreFetchBacklinksBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    if (typeof generateBatchId !== 'function' || typeof createBatch !== 'function' || typeof saveBatch !== 'function' ||
        typeof dedupeUrls !== 'function' || typeof dedupeDomains !== 'function' || typeof normalizeDomain !== 'function') return;
    let domains = [];
    // 优先从 Ahrefs 域名列表获取
    if (exploreAhrefsDomains.length > 0) {
      domains = exploreAhrefsDomains.map(d => d.domain).filter(Boolean);
    } else {
      // 仅从输入框获取；不再从批次 URL 列表推断域名，避免在「Ahrefs 域名列表为空」时隐式加载缓存
      const inputDomain = elements.exploreAhrefsDomain?.value?.trim() || '';
      if (inputDomain) {
        domains = inputDomain.split(/[,，\s]+/).map(d => normalizeDomain(d.trim())).filter(Boolean);
      }
    }
    if (domains.length === 0) {
      showExploreMessage('请先点击"加入 Ahrefs 输入"筛选域名，或手动输入域名', 'warning');
      return;
    }

    // 检查飞书配置
    const feishuResult = await chrome.storage.local.get(['feishuConfig']);
    const feishuConfig = feishuResult.feishuConfig || {};
    const hasFeishuConfig = feishuConfig.appId && feishuConfig.appSecret &&
                            feishuConfig.ahrefsSheetToken && feishuConfig.ahrefsSheetId;

    try {
      let batch = exploreCurrentBatch;
      if (!batch) {
        const batchId = await generateBatchId();
        batch = createBatch(batchId, { type: 'ahrefs', domains });
        exploreCurrentBatch = batch;
        if (elements.exploreBatchId) elements.exploreBatchId.textContent = batch.batchId;
        if (elements.exploreBatchStatus) {
          elements.exploreBatchStatus.textContent = batch.status + ' · ' + (batch.phase || 'idle');
          elements.exploreBatchStatus.classList.remove('hidden');
        }
        updateExploreControls(batch.status);
      }
      batch.phase = 'ahrefs_fetch';
      batch.urlList = batch.urlList || [];
      batch.backlinkDetails = batch.backlinkDetails || [];
      await saveExploreBatchWithExcludeFilter(batch);

      const exclude = await getExploreExcludeDomainsForFilter();
      let lastOverview = {};
      let totalCount = 0;

      for (let i = 0; i < domains.length; i++) {
        // 检查是否暂停或停止
        if (exploreAhrefsPaused || exploreAhrefsAborted) {
          showExploreMessage(`拉取反链已暂停/停止`, 'warning');
          return;
        }

        if (i > 0) {
          const interDomainDelay = Math.floor(Math.random() * 5000) + 3000;
          showExploreMessage(`域名间随机等待 ${(interDomainDelay / 1000).toFixed(1)} 秒,避免触发反爬…`, 'info');
          await new Promise(r => setTimeout(r, interDomainDelay));
        }
        const d = domains[i];
        showExploreMessage(`[${i + 1}/${domains.length}] 正在拉取 ${d} 的反链…`, 'info');

        const result = await fetchAhrefsBacklinksForDomain(d, i, domains.length);
        if (result.urlFromList.length > 0) {
          // 过滤并去重
          const filtered = typeof filterUrlsExcludingDomains === 'function'
            ? filterUrlsExcludingDomains(result.urlFromList, exclude)
            : result.urlFromList;
          const newUrls = dedupeUrls(filtered);

          // 增量更新 batch
          const existingUrls = new Set(batch.urlList || []);
          const addedUrls = newUrls.filter(u => !existingUrls.has(u));
          if (addedUrls.length > 0) {
            batch.urlList = [...(batch.urlList || []), ...addedUrls];
          }

          // 增量更新反链详情
          if (result.backlinks.length > 0) {
            const existingBacklinkUrls = new Set((batch.backlinkDetails || []).map(b => b.urlFrom));
            const newBacklinks = result.backlinks.filter(b => !existingBacklinkUrls.has(b.urlFrom));
            if (newBacklinks.length > 0) {
              batch.backlinkDetails = [...(batch.backlinkDetails || []), ...newBacklinks];
            }
          }

          // 更新 overview
          if (result.overview && result.overview.domainRating !== undefined) {
            lastOverview = result.overview;
            batch.ahrefsOverview = lastOverview;
          }

          batch.updatedAt = new Date().toISOString();
          await saveExploreBatchWithExcludeFilter(batch);
          if (exploreCurrentBatch && exploreCurrentBatch.batchId === batch.batchId) {
            exploreCurrentBatch = batch;
          }

          // 立即渲染列表
          renderExploreUrlList();
          if (lastOverview.domainRating !== undefined) {
            renderAhrefsOverview(lastOverview, domains);
          }

          // 写入飞书（如果配置了）
          if (hasFeishuConfig && result.backlinks.length > 0) {
            showExploreMessage(`[${i + 1}/${domains.length}] 正在写入 ${result.backlinks.length} 条反链到飞书…`, 'info');
            try {
              await writeBacklinksToFeishu(d, result.backlinks, result.overview, feishuConfig);
              showExploreMessage(`[${i + 1}/${domains.length}] ${d} 完成：${addedUrls.length} 条新反链，已同步飞书`, 'success');
            } catch (feishuErr) {
              console.warn('[Ahrefs] 飞书写入失败:', feishuErr);
              showExploreMessage(`[${i + 1}/${domains.length}] ${d} 完成：${addedUrls.length} 条新反链，飞书写入失败: ${feishuErr?.message}`, 'warning');
            }
          } else {
            showExploreMessage(`[${i + 1}/${domains.length}] ${d} 完成：${addedUrls.length} 条新反链`, 'success');
          }

          totalCount += addedUrls.length;
        } else {
          showExploreMessage(`[${i + 1}/${domains.length}] ${d} 无反链数据`, 'info');
        }
      }

      batch.phase = 'idle';
      await saveExploreBatchWithExcludeFilter(batch);
      showExploreMessage(`拉取完成：共 ${totalCount} 条新反链（来自 ${domains.length} 个域名）`, 'success');
    } catch (e) {
      showExploreMessage(e?.message || '拉取反链失败', 'error');
    }
  });

  elements.exploreStartTraverseBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    if (typeof loadBatch !== 'function' || typeof saveBatch !== 'function' || typeof normalizeUrl !== 'function' ||
        typeof dedupeUrls !== 'function') return;
    try {
      let batch = exploreCurrentBatch;
      if (!batch) {
        if (typeof generateBatchId !== 'function' || typeof createBatch !== 'function') return;
        const batchId = await generateBatchId();
        batch = createBatch(batchId, { type: 'traverse' });
        exploreCurrentBatch = batch;
      }
      const currentBatchId = batch.batchId;
      let traverseList = batch.traverseBacklinkList || [];
      const lastIdx = batch.lastProcessedIndex || 0;
      const isResuming = traverseList.length > 0 && lastIdx < traverseList.length;

      if (!isResuming) {
        // 直接使用 urlList 进行遍历，不调用 Ahrefs API
        const urlList = batch.urlList || [];
        if (urlList.length === 0) {
          showExploreMessage('待检测 URL 列表为空，请先从评论区提取或拉取反链', 'warning');
          return;
        }

        // 排除指定域名
        const exclude = await getExploreExcludeDomainsForFilter();
        const filtered = typeof filterUrlsExcludingDomains === 'function' ? filterUrlsExcludingDomains(urlList, exclude) : urlList;
        traverseList = dedupeUrls(filtered);

        if (traverseList.length === 0) {
          showExploreMessage('过滤后无可检测的 URL', 'warning');
          return;
        }

        showExploreMessage(`开始遍历检测 ${traverseList.length} 条 URL…`, 'info');
        batch.status = 'running';
        batch.phase = 'traverse_check';
        batch.traverseBacklinkList = traverseList;
        batch.lastProcessedIndex = 0;
        batch.urlProgress = batch.urlProgress || {};
        batch.discoveredSites = batch.discoveredSites || [];
        if (elements.exploreBatchId) elements.exploreBatchId.textContent = batch.batchId;
        if (elements.exploreBatchStatus) {
          elements.exploreBatchStatus.textContent = batch.status + ' · ' + batch.phase;
          elements.exploreBatchStatus.classList.remove('hidden');
        }
        updateExploreControls(batch.status);
        await saveExploreBatchWithExcludeFilter(batch);
        if (exploreCurrentBatch && exploreCurrentBatch.batchId === batch.batchId) exploreCurrentBatch = batch;
      } else {
        // 恢复遍历
        batch.status = 'running';
        batch.phase = 'traverse_check';
        if (elements.exploreBatchId) elements.exploreBatchId.textContent = batch.batchId;
        if (elements.exploreBatchStatus) {
          elements.exploreBatchStatus.textContent = batch.status + ' · ' + batch.phase;
          elements.exploreBatchStatus.classList.remove('hidden');
        }
        updateExploreControls(batch.status);
        await saveExploreBatchWithExcludeFilter(batch);
      }

      await runTraverseLoopOnly(currentBatchId);
    } catch (e) {
      showExploreMessage('遍历失败: ' + (e?.message || e), 'error');
    }
  });
  elements.explorePauseBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    // 暂停拉取反链流程
    if (exploreAhrefsRunning) {
      exploreAhrefsPaused = true;
      showExploreMessage('拉取反链已暂停', 'success');
    }
    // 暂停遍历检测流程
    if (exploreCurrentBatch && typeof saveBatch !== 'function') return;
    if (exploreCurrentBatch) {
      exploreCurrentBatch.status = 'paused';
      exploreCurrentBatch.updatedAt = new Date().toISOString();
      await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);
    }
    updateExploreControls('paused');
    if (exploreCurrentBatch) {
      showExploreMessage('已暂停，进度已保存', 'success');
    }
  });
  elements.exploreResumeBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    try {
      // 继续拉取反链流程
      if (exploreAhrefsPaused && exploreAhrefsDomainsQueue.length > 0) {
        exploreAhrefsPaused = false;
        updateExploreControls('running');
        showExploreMessage('继续拉取反链，从第 ' + (exploreAhrefsCurrentIndex + 1) + ' 个域名开始', 'success');
        // 继续拉取反链（从当前索引继续）
        await resumeAhrefsFetching();
        return;
      }
      // 继续遍历检测流程
      if (!exploreCurrentBatch) return;
      if (typeof loadBatch !== 'function' || typeof saveBatch !== 'function') return;
      const loaded = await loadBatch(exploreCurrentBatch.batchId);
      if (loaded) exploreCurrentBatch = loaded;
      const list = exploreCurrentBatch.traverseBacklinkList || [];
      const lastIdx = exploreCurrentBatch.lastProcessedIndex || 0;
      if (list.length === 0 || lastIdx >= list.length) {
        showExploreMessage('当前批次无可继续的遍历任务', 'warning');
        return;
      }
      exploreCurrentBatch.status = 'running';
      exploreCurrentBatch.phase = 'traverse_check';
      await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);
      updateExploreControls('running');
      showExploreMessage('已继续，从第 ' + (lastIdx + 1) + ' 条开始遍历检测', 'success');
      await runTraverseLoopOnly(exploreCurrentBatch.batchId);
    } catch (e) {
      showExploreMessage('继续失败: ' + (e.message || e), 'error');
    }
  });
  elements.exploreStopBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    // 停止拉取反链流程
    if (exploreAhrefsRunning) {
      exploreAhrefsAborted = true;
      showExploreMessage('拉取反链已停止', 'success');
    }
    // 停止遍历检测流程
    if (exploreCurrentBatch && typeof saveBatch !== 'function') return;
    if (exploreCurrentBatch) {
      exploreCurrentBatch.status = 'stopped';
      exploreCurrentBatch.updatedAt = new Date().toISOString();
      await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);
    }
    updateExploreControls('stopped');
    if (exploreCurrentBatch) {
      showExploreMessage('已停止，进度已保存', 'success');
    }
  });
  elements.exploreFeishuConfigBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });
  elements.exploreWriteFeishuBtn?.addEventListener('click', async () => {
    await writeExploreDiscoveredSitesToFeishu();
  });

  elements.exploreAddDugToAhrefsBtn?.addEventListener('click', async () => {
    if (currentMode !== 'explore') return;
    const domains = exploreCurrentBatch?.dugDomains || [];
    if (domains.length === 0) {
      showExploreMessage('暂无挖到的域名', 'warning');
      return;
    }
    try {
      console.log('[Explore] 开始批量 WHOIS 查询，待处理域名:', domains);
      showExploreMessage(`开始批量查询 ${domains.length} 个域名的注册时间，筛选近5年的域名…`, 'info');
      const { filtered, domainDates, cutoffDate } = await filterDomainsByAge(domains, 5);

      console.log('[Explore] WHOIS 查询完成:', {
        total: domains.length,
        passed: filtered.length,
        cutoffDate,
        allResults: domainDates,
        passedDomains: filtered
      });

      if (filtered.length === 0) {
        showExploreMessage(`所有 ${domains.length} 个域名都超过5年（截止日期 ${cutoffDate}），未加入 Ahrefs 列表`, 'warning');
        return;
      }

      const toAdd = domainDates.filter(d => filtered.includes(d.domain));
      exploreAhrefsDomains = [...(exploreAhrefsDomains || []), ...toAdd];
      renderExploreAhrefsDomainList();

      console.log('[Explore] 已加入 Ahrefs 域名列表:', toAdd);
      showExploreMessage(`${filtered.length}/${domains.length} 个域名通过近5年筛选，已加入 Ahrefs 域名列表`, 'success');
    } catch (e) {
      console.error('[Explore] WHOIS 批量查询失败:', e);
      showExploreMessage(e?.message || 'WHOIS 查询失败', 'error');
    }
  });

  elements.exploreClearAhrefsDomainListBtn?.addEventListener('click', () => {
    exploreAhrefsDomains = [];
    renderExploreAhrefsDomainList();
    showExploreMessage('Ahrefs 域名列表已清空', 'success');
  });
  elements.exploreExcludeFromBlogSites?.addEventListener('change', async () => {
    const checked = !!elements.exploreExcludeFromBlogSites?.checked;
    await chrome.storage.local.set({ exploreExcludeFromBlogSites: checked });
  });

  // 批次选择下拉框变化时更新加载按钮状态
  elements.exploreLoadBatchSelect?.addEventListener('change', () => {
    if (elements.exploreLoadBatchBtn) {
      elements.exploreLoadBatchBtn.disabled = !elements.exploreLoadBatchSelect.value;
    }
  });

  // 点击加载按钮
  elements.exploreLoadBatchBtn?.addEventListener('click', async () => {
    await loadUrlsFromSelectedBatch();
  });

  elements.exploreLoadIncompleteFeishuBtn?.addEventListener('click', async () => {
    try {
      await loadIncompleteAhrefsMarksIntoExploreUrlList();
    } catch (e) {
      showExploreMessage('加载飞书未标记行失败: ' + (e?.message || e), 'error');
    }
  });

  // 点击写入飞书按钮（待检测 URL 列表）
  elements.exploreWriteUrlListToFeishuBtn?.addEventListener('click', async () => {
    await writeUrlListToFeishu();
  });

  // 点击清空列表按钮
  elements.exploreClearUrlListBtn?.addEventListener('click', async () => {
    if (confirm('确定要清空待检测 URL 列表吗？此操作不可撤销。 ')) {
      await clearExploreUrlList();
    }
  });

  // 点击清空已发现可评论站列表按钮
  elements.exploreClearDiscoveredBtn?.addEventListener('click', async () => {
    if (confirm('确定要清空已发现可评论站列表吗？此操作不可撤销。 ')) {
      exploreCurrentBatch.discoveredSites = [];
      renderExploreDiscoveredList();
      saveExploreCurrentBatch();
      showExploreMessage('已发现可评论站列表已清空', 'success');
    }
  });

  // ========== 自动采集模式事件绑定 ==========
  // 循环模式开关
  elements.loopModeEnabled?.addEventListener('change', (e) => {
    const configEl = elements.loopModeConfig;
    if (configEl) {
      configEl.classList.toggle('hidden', !e.target.checked);
    }
  });

  // 开始自动采集
  elements.autoCollectStartBtn?.addEventListener('click', async () => {
    await startAutoCollect();
  });

  // 加载历史批次任务（paused/stopped 时手动恢复）
  elements.autoCollectLoadHistoryBtn?.addEventListener('click', async () => {
    try {
      await loadAutoCollectHistoryBatches();
    } catch (e) {
      showExploreMessage('加载历史批次失败: ' + (e?.message || e), 'error');
    }
  });

  // 选中批次后启用“重新恢复”
  elements.autoCollectHistoryBatchSelect?.addEventListener('change', () => {
    updateAutoCollectHistoryRestoreButton();
  });

  elements.autoCollectRestoreSelectedBtn?.addEventListener('click', async () => {
    try {
      const batchId = elements.autoCollectHistoryBatchSelect?.value;
      await restoreAutoCollectSelectedBatch(batchId);
    } catch (e) {
      showExploreMessage('重新恢复失败: ' + (e?.message || e), 'error');
    }
  });

  // 暂停自动采集
  elements.autoCollectPauseBtn?.addEventListener('click', () => {
    pauseAutoCollect();
  });

  // 继续自动采集
  elements.autoCollectResumeBtn?.addEventListener('click', () => {
    resumeAutoCollect();
  });

  // 停止自动采集
  elements.autoCollectStopBtn?.addEventListener('click', () => {
    stopAutoCollect();
  });

  // 清除自动采集日志
  elements.autoCollectClearLogBtn?.addEventListener('click', () => {
    autoCollectLogs = [];
    renderAutoCollectLogs();
  });

  // ========== Trends 挖词模式事件 ==========
  elements.trendsSeedKeywords?.addEventListener('input', () => {
    updateTrendsSeedCountUI();
  });
  elements.trendsBaselineKeyword?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsSeedKeywords?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsTimeRange?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsModePotentialBtn?.addEventListener('click', () => {
    setTrendsExploreMode('potential');
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsModeLongtailBtn?.addEventListener('click', () => {
    setTrendsExploreMode('longtail');
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsRiseThreshold?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsKeywordLimit?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsMaxRounds?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });
  elements.trendsExcludeWords?.addEventListener('change', () => {
    persistTrendsFormState().catch(() => {});
  });

  elements.trendsStartBtn?.addEventListener('click', async () => {
    if (currentMode !== 'trends') showModePanel('trends');
    try {
      await startTrendsJob();
    } catch (e) {
      console.error('[Trends挖词] startTrendsJob 外层异常', e);
    }
  });
  elements.trendsStopBtn?.addEventListener('click', () => {
    stopTrendsJob();
  });
  elements.trendsExportBtn?.addEventListener('click', () => {
    const csv = buildTrendsCsv();
    downloadTextFile(`trends-keywords-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  });
  elements.trendsClearHistoryBtn?.addEventListener('click', async () => {
    if (!confirm('确定要清空 Trends 挖词历史吗？此操作不可撤销。')) return;
    await chrome.storage.local.set({ [TRENDS_HISTORY_KEY]: [] });
    renderTrendsHistory([]);
  });

  elements.trendsOpenWorkerBtn?.addEventListener('click', async () => {
    try {
      // 这里仍然允许创建/复用一个工作页，方便用户手动登录与操作
      const tabId = await ensureTrendsWorkerTab();
      await chrome.tabs.update(tabId, { url: TRENDS_WORKER_PAGE_URL, active: true });
      await waitForTabCompleteInSidepanel(tabId, 30000);
    } catch (e) {
      console.error('[Trends挖词] 打开工作页失败', e);
      trendsJob.lastError = e?.message || String(e);
      updateTrendsStatusUI();
    }
  });

  // 监听 storage 变更
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (currentMode !== 'blog' || !currentTab) return;
    const cacheKey = getCommentCacheKeyForTab(currentTab);
    if (!cacheKey) return;
    const key = BLOG_POPUP_STATE_PREFIX + cacheKey;
    if (changes[key] && changes[key].newValue) {
      applyBlogPopupStateToDom(changes[key].newValue);
    }
  });
}

// ========== 飞书集成 ==========

async function loadFeishuCredentials() {
  try {
    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    // 更新同步按钮状态
    if (config.appId && config.appSecret && config.appToken && config.tableId) {
      if (elements.syncFromFeishuBtn) elements.syncFromFeishuBtn.disabled = false;
      if (elements.feishuLastSyncTime) {
        elements.feishuLastSyncTime.textContent = config.lastSyncTime || '';
        elements.feishuLastSyncTime.classList.remove('hidden');
      } else {
        elements.feishuLastSyncTime.classList.add('hidden');
      }
    } else {
      if (elements.syncFromFeishuBtn) elements.syncFromFeishuBtn.disabled = true;
      showToast('请先在设置页面配置飞书凭证', 'warning');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to load Feishu config:', error);
  }
}

async function getFeishuAccessToken() {
  const result = await chrome.storage.local.get(['feishuConfig']);
  const config = result.feishuConfig || {};

  if (!config.appId || !config.appSecret) {
    throw new Error('请先配置飞书凭证');
  }

  // 获取 tenant_access_token
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  });

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(data.msg || '获取飞书 Token 失败');
  }

  return data.tenant_access_token;
}

async function syncFromFeishu() {
  try {
    if (elements.syncFromFeishuBtn) {
      elements.syncFromFeishuBtn.disabled = true;
      elements.syncFromFeishuBtn.innerHTML = '同步中...';
    }

    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    if (!config.appToken || !config.tableId) {
      showFeishuMessage('请先配置飞书 App Token 和 Table ID', 'warning');
      return;
    }

    const accessToken = await getFeishuAccessToken();

    // 获取表格记录（限制条数）
    const limit = feishuSyncLimit || 10;
    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records?limit=${limit}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(data.msg || '获取飞书表格数据失败');
    }

    // 字段类型验证和错误收集
    const fieldErrors = [];
    const validItems = [];
    const allItems = data.data?.items || [];

    // 强制限制处理的条数（即使API返回更多，也只处理指定的条数）
    const itemsToProcess = allItems.slice(0, limit);

    itemsToProcess.forEach((item, index) => {
      const fields = item.fields || {};
      const rowNum = index + 1;
      const itemErrors = [];

      // 验证 URL 字段
      let urlValue = fields['外链 URL'] || fields.url || fields.link_url;
      if (urlValue === undefined || urlValue === null || urlValue === '') {
        itemErrors.push('URL字段为空');
      } else if (typeof urlValue === 'object') {
        // 飞书链接字段返回对象 {link: "url", text: "显示文本"}
        if (urlValue.link || urlValue.url) {
          urlValue = urlValue.link || urlValue.url;
        } else {
          itemErrors.push(`URL字段类型错误(对象缺少link属性): ${JSON.stringify(urlValue)}`);
        }
      } else if (typeof urlValue !== 'string') {
        itemErrors.push(`URL字段类型错误: 期望字符串, 实际为 ${typeof urlValue}`);
      }

      // 验证类型字段（可选，但如果有值需要是字符串）
      const typeValue = fields['类型'] || fields.type;
      if (typeValue !== undefined && typeValue !== null && typeof typeValue !== 'string') {
        if (Array.isArray(typeValue)) {
          // 飞书多选字段返回数组
          if (typeValue.length > 0 && typeof typeValue[0] !== 'string') {
            itemErrors.push(`类型字段格式异常: ${JSON.stringify(typeValue)}`);
          }
        } else {
          itemErrors.push(`类型字段类型错误: 期望字符串, 实际为 ${typeof typeValue}`);
        }
      }

      // 验证状态字段（可选，但如果有值需要是字符串）
      const statusValue = fields['提交状态'] || fields.status || fields.submit_status;
      if (statusValue !== undefined && statusValue !== null && typeof statusValue !== 'string') {
        if (Array.isArray(statusValue)) {
          if (statusValue.length > 0 && typeof statusValue[0] !== 'string') {
            itemErrors.push(`状态字段格式异常: ${JSON.stringify(statusValue)}`);
          }
        } else {
          itemErrors.push(`状态字段类型错误: 期望字符串, 实际为 ${typeof statusValue}`);
        }
      }

      // 验证备注字段
      const remarkValue = fields['备注'] || fields.remark || fields.note;
      if (remarkValue !== undefined && remarkValue !== null && typeof remarkValue !== 'string') {
        itemErrors.push(`备注字段类型错误: 期望字符串, 实际为 ${typeof remarkValue}`);
      }

      if (itemErrors.length > 0) {
        fieldErrors.push({
          row: rowNum,
          record_id: item.record_id,
          errors: itemErrors,
          rawFields: fields
        });
      } else {
        // 验证通过，添加到有效列表
        urlValue = String(urlValue || '').trim();
        if (urlValue) {
          // 处理类型字段
          let finalType = typeValue;
          if (Array.isArray(typeValue)) {
            finalType = typeValue.join(', ') || '其他';
          }
          finalType = String(finalType || '其他');

          // 处理状态字段
          let finalStatus = statusValue;
          if (Array.isArray(statusValue)) {
            finalStatus = statusValue[0] || '待提交';
          }
          finalStatus = String(finalStatus || '待提交');

          validItems.push({
            record_id: item.record_id,
            url: urlValue,
            type: finalType,
            status: finalStatus,
            remark: String(remarkValue || ''),
            index: validItems.length,
            selected: false
          });
        }
      }
    });

    // 如果有字段错误，记录日志并提示用户
    if (fieldErrors.length > 0) {
      console.warn('[SidePanel] 飞书字段验证警告:', fieldErrors);
      addBatchLog(`发现 ${fieldErrors.length} 条记录存在字段问题`, 'warning');

      // 构建详细的错误消息
      const errorDetails = fieldErrors.slice(0, 5).map(e =>
        `第${e.row}行: ${e.errors.join('; ')}`
      ).join('\n');

      const moreCount = fieldErrors.length > 5 ? ` (还有 ${fieldErrors.length - 5} 条...)` : '';

      showBatchMessage(
        `同步完成: ${validItems.length} 条有效, ${fieldErrors.length} 条有字段问题${moreCount}`,
        fieldErrors.length > 0 ? 'warning' : 'success'
      );

      // 在控制台输出完整错误信息
      console.log('[SidePanel] 字段错误详情:\n' + errorDetails + moreCount);
    }

    batchUrls = validItems;

    // 保存到本地
    await chrome.storage.local.set({
      batchUrls: batchUrls,
      feishuLastSyncTime: new Date().toISOString()
    });

    updateSyncStatus('synced', new Date().toISOString());
    renderBatchUrlList();

    if (fieldErrors.length === 0) {
      const syncedCount = batchUrls.length;
      const totalAvailable = allItems.length;
      const message = totalAvailable > syncedCount
        ? `已同步 ${syncedCount} 条记录（表格共 ${totalAvailable} 条，已按同步条数限制配置处理）`
        : `已从飞书同步 ${syncedCount} 条记录`;
      showFeishuMessage(message, 'success');
      addBatchLog(`从飞书同步 ${syncedCount} 条记录${totalAvailable > syncedCount ? `（表格共 ${totalAvailable} 条）` : ''}`, 'info');
    }

  } catch (error) {
    console.error('[SidePanel] Failed to sync from Feishu:', error);
    updateSyncStatus('failed');
    showFeishuMessage(error.message || '同步失败', 'error');
    addBatchLog(`同步失败: ${error.message}`, 'error');
  } finally {
    if (elements.syncFromFeishuBtn) {
      elements.syncFromFeishuBtn.disabled = false;
      elements.syncFromFeishuBtn.innerHTML = '从飞书同步';
    }
  }
}

function updateSyncStatus(status, lastSyncTime) {
  if (elements.feishuSyncStatus) {
    if (status === 'synced') {
      elements.feishuSyncStatus.textContent = '已同步';
      elements.feishuSyncStatus.className = 'sync-status synced';
    } else if (status === 'failed') {
      elements.feishuSyncStatus.textContent = '同步失败';
      elements.feishuSyncStatus.className = 'sync-status failed';
    } else {
      elements.feishuSyncStatus.textContent = '未同步';
      elements.feishuSyncStatus.className = 'sync-status';
    }
  }

  if (lastSyncTime && elements.feishuLastSyncTime) {
    const date = new Date(lastSyncTime);
    elements.feishuLastSyncTime.textContent = `最近同步: ${formatDateTime(date)}`;
    elements.feishuLastSyncTime.classList.remove('hidden');
  }
}

function formatDateTime(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ========== 外链采集飞书写入 ==========

function feishuColumnLettersToIndex(letters) {
  let n = 0;
  const s = String(letters || '').toUpperCase().replace(/[^A-Z]/g, '');
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return Math.max(0, n - 1);
}

function feishuColumnIndexToLetters(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

function isEmptyFeishuMarkCell(v) {
  if (v === undefined || v === null) return true;
  const t = typeof v === 'string' ? v.trim() : String(v).trim();
  return t === '';
}

/**
 * 读取飞书电子表格指定范围（GET /sheets/v2/spreadsheets/.../values）
 */
async function fetchFeishuSpreadsheetValues(spreadsheetToken, range) {
  const accessToken = await getFeishuAccessToken();
  const encoded = encodeURIComponent(range);
  const url = `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encoded}?valueRenderOption=ToString`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(data.msg || '读取飞书表格失败');
  }
  return data.data?.valueRange?.values || [];
}

/**
 * 从 Ahrefs 反链表中筛选：A 列有 URL，且 K/L/M/N（或你在设置里配置的列）中任一空白的行，返回标准化 URL（去重）
 */
async function fetchAhrefsSheetUrlsWithIncompleteMarkColumns() {
  const result = await chrome.storage.local.get(['feishuConfig']);
  const config = result.feishuConfig || {};
  if (!config.appId || !config.appSecret || !config.ahrefsSheetToken || !config.ahrefsSheetId) {
    throw new Error('请先在设置中配置飞书应用凭证与「外链采集 - Ahrefs 反链」表格');
  }
  const blogCommentCol = config.ahrefsBlogCommentCol || 'K';
  const requiresLoginCol = config.ahrefsRequiresLoginCol || 'L';
  const navigationSiteCol = config.ahrefsNavigationSiteCol || 'M';
  const blogCommentScoreCol = config.ahrefsBlogCommentScoreCol || 'N';

  const iK = feishuColumnLettersToIndex(blogCommentCol);
  const iL = feishuColumnLettersToIndex(requiresLoginCol);
  const iM = feishuColumnLettersToIndex(navigationSiteCol);
  const iN = feishuColumnLettersToIndex(blogCommentScoreCol);
  const maxIdx = Math.max(iK, iL, iM, iN, 0);
  const endCol = feishuColumnIndexToLetters(maxIdx);
  const sheetId = config.ahrefsSheetId;
  const maxDataRow = 5000;
  const range = `${sheetId}!A2:${endCol}${maxDataRow}`;

  const rows = await fetchFeishuSpreadsheetValues(config.ahrefsSheetToken, range);
  const urls = [];
  const seen = new Set();
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const urlRaw = row[0];
    if (isEmptyFeishuMarkCell(urlRaw)) continue;
    const cellK = row[iK];
    const cellL = row[iL];
    const cellM = row[iM];
    const cellN = row[iN];
    const incomplete =
      isEmptyFeishuMarkCell(cellK) ||
      isEmptyFeishuMarkCell(cellL) ||
      isEmptyFeishuMarkCell(cellM) ||
      isEmptyFeishuMarkCell(cellN);
    if (!incomplete) continue;
    let u = String(urlRaw).trim();
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    const norm = typeof normalizeUrl === 'function' ? normalizeUrl(u) : u;
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    urls.push(norm);
  }
  return urls;
}

/**
 * 将飞书表格中「Blog Comment / 登录 / 导航 / 评分」未写全的行载入待检测 URL 列表，便于再点「遍历检测」回写
 */
async function loadIncompleteAhrefsMarksIntoExploreUrlList() {
  showExploreMessage('正在从飞书读取未标记行…', 'info');
  const urls = await fetchAhrefsSheetUrlsWithIncompleteMarkColumns();
  if (urls.length === 0) {
    showExploreMessage('没有需要补填的行（A 列有 URL 且标记列未写全）', 'info');
    return;
  }

  let batch = exploreCurrentBatch;
  if (!batch) {
    if (typeof generateBatchId !== 'function' || typeof createBatch !== 'function') return;
    const batchId = await generateBatchId();
    batch = createBatch(batchId, { type: 'feishu_incomplete' });
    batch.status = 'idle';
    batch.phase = 'idle';
    exploreCurrentBatch = batch;
  }

  const hadTraverseProgress =
    (Array.isArray(batch.traverseBacklinkList) && batch.traverseBacklinkList.length > 0) &&
    (batch.lastProcessedIndex || 0) > 0;
  if (hadTraverseProgress) {
    const ok = confirm('合并飞书待补填 URL 将重置当前批次的遍历进度，是否继续？');
    if (!ok) return;
  }

  const merged = typeof dedupeUrls === 'function'
    ? dedupeUrls([...(batch.urlList || []), ...urls])
    : [...new Set([...(batch.urlList || []), ...urls])];
  batch.urlList = merged;
  batch.traverseBacklinkList = [];
  batch.lastProcessedIndex = 0;
  batch.updatedAt = new Date().toISOString();
  await saveExploreBatchWithExcludeFilter(batch);
  exploreCurrentBatch = batch;
  if (elements.exploreBatchId) elements.exploreBatchId.textContent = batch.batchId;
  if (elements.exploreBatchStatus) {
    elements.exploreBatchStatus.textContent = (batch.status || 'idle') + ' · ' + (batch.phase || 'idle');
    elements.exploreBatchStatus.classList.remove('hidden');
  }
  renderExploreUrlList();
  updateExploreControls(batch.status);
  showExploreMessage(`已载入 ${urls.length} 条待补填 URL（与列表合并去重后共 ${merged.length} 条），请点击「遍历检测可评论站点」`, 'success');
}

/**
 * 将 discoveredSites 写入飞书普通电子表格
 * 字段映射（PRD 5.2）：
 * - URL: 当前页面 URL
 * - 域名: hostname
 * - 发现时间: 发现/写入时间
 * - 发现来源域名: 种子或 Ahrefs 查询域名
 * - 是否有 CAPTCHA 验证: 是/否
 * - 是否必须登录才能评论: 是/否
 */

/**
 * 写入 Ahrefs 反链数据到飞书表格（增量写入）
 * @param {string} queryDomain - 查询的种子域名
 * @param {Array} backlinks - 反链数据数组
 * @param {object} overview - 域名概览数据（domainRating, refdomains, dofollowRefdomains）
 * @param {object} config - 飞书配置对象
 */
async function writeBacklinksToFeishu(queryDomain, backlinks, overview, config) {
  if (!backlinks || backlinks.length === 0) {
    return;
  }

  // 获取 access token
  const accessToken = await getFeishuAccessToken();

  const now = new Date().toISOString();

  // 构建行数据：反链 URL、目标 URL、锚文本、来源 DR、来源标题、拉取时间、查询域名、域名 DR、引用域名数、Dofollow 域名数
  const rows = backlinks.map(bl => {
    return [
      bl.urlFrom || '',                              // 反链 URL
      bl.urlTo || '',                                // 目标 URL
      bl.anchor || '',                               // 锚文本
      bl.domainRating || '',                         // 来源 DR
      bl.title || '',                                // 来源标题
      now,                                           // 拉取时间
      queryDomain || '',                             // 查询域名
      overview?.domainRating || '',                  // 域名 DR
      overview?.refdomains || '',                    // 引用域名数
      overview?.dofollowRefdomains || ''             // Dofollow 域名数
    ];
  });

  if (rows.length === 0) {
    return;
  }

  const spreadsheetToken = config.ahrefsSheetToken;
  const sheetId = config.ahrefsSheetId;

  // 先获取表格元数据以确定起始行
  const metaResponse = await fetch(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );
  const metaData = await metaResponse.json();

  let startRow = 2; // 默认从第2行开始（跳过表头）
  if (metaData.code === 0 && metaData.data?.sheets) {
    const sheet = metaData.data.sheets.find(s => s.sheetId === sheetId);
    if (sheet && sheet.rowCount) {
      startRow = sheet.rowCount + 1; // 追加到最后一行之后
    }
  }

  // 写入数据到普通电子表格（列数根据 rows 长度动态计算）
  const colCount = rows[0]?.length || 1;
  // 将 0 -> A, 1 -> B, ... 转为列字母
  function toColLetter(idx) {
    let n = idx + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  const endCol = toColLetter(colCount - 1);
  const range = `${sheetId}!A${startRow}:${endCol}${startRow + rows.length - 1}`;
  const response = await fetch(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        valueRange: {
          range: range,
          values: rows
        }
      })
    }
  );

  const data = await response.json();

  if (data.code !== 0) {
    console.error('[Ahrefs] 飞书写入反链失败:', data.msg, data);
    throw new Error(data.msg || '飞书写入失败');
  }

  console.log(`[Ahrefs] 成功写入 ${rows.length} 条反链到飞书`);
}

/**
 * 将指定发现站点追加写入飞书表格（供遍历时单条写入或批量写入复用）
 * @param {object} batch - 当前批次，含 sourceInput、urlProgress
 * @param {Array<{url:string, discoveredAt?:string, blogCommentScore?:number}>} sitesToAppend - 要追加的站点列表
 * @returns {Promise<{ok:boolean, written:number, error?:string, skipped?:boolean}>}
 */
async function appendDiscoveredSitesToFeishu(batch, sitesToAppend) {
  if (!sitesToAppend || sitesToAppend.length === 0) return { ok: true, written: 0 };
  const result = await chrome.storage.local.get(['feishuConfig']);
  const config = result.feishuConfig || {};
  if (!config.appId || !config.appSecret || !config.exploreSheetToken || !config.exploreSheetId) {
    return { ok: false, written: 0, skipped: true };
  }
  const sourceDomains = batch?.sourceInput?.domains ||
    batch?.sourceInput?.ahrefsInput?.split(/[,，\s]+/).filter(Boolean) ||
    [];
  const sourceDomainStr = sourceDomains.slice(0, 3).join(', ') + (sourceDomains.length > 3 ? '...' : '');
  const rows = sitesToAppend.map((site) => {
    const url = (site && site.url) || site;
    if (!url) return null;
    let domain = '';
    try {
      const u = new URL(url);
      domain = u.hostname || '';
    } catch (e) {
      domain = url.replace(/^https?:\/\//, '').split('/')[0];
    }
    const urlNorm = typeof normalizeUrl === 'function' ? normalizeUrl(url) : url;
    const progress = (batch && batch.urlProgress && batch.urlProgress[urlNorm]) || {};
    const requiresLoginVal = site.requiresLogin === true || progress.requiresLogin === true;
    const blogCommentScoreVal = site.blogCommentScore != null ? String(site.blogCommentScore) : (progress.blogCommentScore != null ? String(progress.blogCommentScore) : '');
    return [
      url,
      domain,
      site.discoveredAt || new Date().toISOString(),
      sourceDomainStr || '未知',
      progress.hasCaptcha ? '是' : '否',
      requiresLoginVal ? '是' : '否',
      blogCommentScoreVal
    ];
  }).filter(Boolean);
  if (rows.length === 0) return { ok: true, written: 0 };
  try {
    const accessToken = await getFeishuAccessToken();
    const spreadsheetToken = config.exploreSheetToken;
    const sheetId = config.exploreSheetId;
    const metaResponse = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`,
      { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const metaData = await metaResponse.json();
    let startRow = 1;
    if (metaData.code === 0 && metaData.data?.sheets) {
      const sheet = metaData.data.sheets.find(s => s.sheetId === sheetId);
      if (sheet && sheet.rowCount) startRow = sheet.rowCount + 1;
    }
    const range = `${sheetId}!A${startRow}:G${startRow + rows.length - 1}`;
    const response = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueRange: { range: range, values: rows } })
      }
    );
    const data = await response.json();
    if (data.code !== 0) return { ok: false, written: 0, error: data.msg || '未知错误' };
    return { ok: true, written: rows.length };
  } catch (e) {
    return { ok: false, written: 0, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * 将检测结果的标记回写到第一个 Ahrefs 反链飞书表格中
 * 通过 URL 匹配找到对应行，更新三个标记字段：
 * - 是否为 Blog Comment 评论外链
 * - 是否需要登录
 * - 是否是导航站
 * @param {string} url - 要标记的 URL
 * @param {object} flags - 标记值 { isBlogComment: boolean, requiresLogin: boolean, isNavigationSite: boolean }
 * @returns {Promise<{ok:boolean, updated:boolean, error?:string, skipped?:boolean}>}
 */
async function updateBacklinkFlagsInFeishu(url, flags) {
  if (!url) return { ok: false, updated: false, error: 'URL 为空' };

  const result = await chrome.storage.local.get(['feishuConfig']);
  const config = result.feishuConfig || {};

  // 检查必要配置
  if (!config.appId || !config.appSecret) {
    return { ok: false, updated: false, skipped: true, error: '请先配置飞书应用凭证' };
  }
  if (!config.ahrefsSheetToken || !config.ahrefsSheetId) {
    return { ok: false, updated: false, skipped: true, error: '请先配置「外链采集 - Ahrefs 反链」表格' };
  }

  // 获取标记列配置，默认为 K、L、M 列，blogcommentScore 在 N 列
  const blogCommentCol = config.ahrefsBlogCommentCol || 'K';
  const requiresLoginCol = config.ahrefsRequiresLoginCol || 'L';
  const navigationSiteCol = config.ahrefsNavigationSiteCol || 'M';
  const blogCommentScoreCol = config.ahrefsBlogCommentScoreCol || 'N';

  try {
    const accessToken = await getFeishuAccessToken();
    const spreadsheetToken = config.ahrefsSheetToken;
    const sheetId = config.ahrefsSheetId;

    // 标准化 URL 用于匹配（移除尾部斜杠）
    const normalizedUrl = typeof normalizeUrl === 'function' ? normalizeUrl(url) : url;
    // 同时准备带尾部斜杠的版本，以应对飞书表格中可能存在的斜杠差异
    const normalizedUrlWithSlash = normalizedUrl + '/';

    // 辅助函数：执行查找请求
    async function findUrlInSheet(searchUrl) {
      const findResponse = await fetch(
        `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/${sheetId}/find`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            find_condition: {
              range: `${sheetId}!A:A`,
              match_case: false,
              match_entire_cell: true,
              search_by_regex: false
            },
            find: searchUrl
          })
        }
      );
      return await findResponse.json();
    }

    // 1. 使用 Find API 查找 URL 对应的行（先尝试无尾部斜杠版本）
    let findData = await findUrlInSheet(normalizedUrl);

    // 如果没找到，再尝试带尾部斜杠版本
    if (findData.code === 0) {
      const matchedCells = findData.data?.find_result?.matched_cells || [];
      if (matchedCells.length === 0) {
        // 尝试带尾部斜杠的版本
        findData = await findUrlInSheet(normalizedUrlWithSlash);
      }
    }

    if (findData.code !== 0) {
      console.warn('[Ahrefs] 查找 URL 失败:', findData.msg);
      return { ok: false, updated: false, error: findData.msg || '查找失败' };
    }

    const matchedCells = findData.data?.find_result?.matched_cells || [];

    if (matchedCells.length === 0) {
      // URL 不在表格中，不报错但返回未更新
      console.log('[Ahrefs] URL 不在飞书表格中:', normalizedUrl, '(也尝试过带斜杠版本)');
      return { ok: true, updated: false, skipped: true };
    }

    // 提取行号
    const rowNumbers = matchedCells.map(cell => parseInt(cell.replace(/^[A-Z]+/, ''), 10));

    // 2. 更新每个匹配行的标记列
    const blogCommentValue = flags.isBlogComment === true ? '是' : '否';
    const requiresLoginValue = flags.requiresLogin === true ? '是' : '否';
    const navigationSiteValue = flags.isNavigationSite === true ? '是' : '否';
    const blogCommentScoreValue = flags.blogCommentScore != null ? String(flags.blogCommentScore) : '';

    let updatedCount = 0;

    for (const rowNum of rowNumbers) {
      // 更新四个标记列：K(是否评论)、L(是否登录)、M(是否导航站)、N(评分)
      const updateResponse = await fetch(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            valueRange: {
              range: `${sheetId}!${blogCommentCol}${rowNum}:${blogCommentScoreCol}${rowNum}`,
              values: [[blogCommentValue, requiresLoginValue, navigationSiteValue, blogCommentScoreValue]]
            }
          })
        }
      );

      const updateData = await updateResponse.json();

      if (updateData.code === 0) {
        updatedCount++;
      } else {
        console.warn('[Ahrefs] 更新行失败:', rowNum, updateData.msg);
      }
    }

    console.log(`[Ahrefs] 成功更新 ${updatedCount} 行标记:`, normalizedUrl);
    return { ok: true, updated: updatedCount > 0, updatedCount };

  } catch (e) {
    console.error('[Ahrefs] 更新飞书标记异常:', e);
    return { ok: false, updated: false, error: e && e.message ? e.message : String(e) };
  }
}

async function writeExploreDiscoveredSitesToFeishu() {
  try {
    if (!exploreCurrentBatch) {
      showExploreMessage('请先选择或创建批次', 'warning');
      return;
    }

    const discoveredSites = exploreCurrentBatch.discoveredSites || [];
    if (discoveredSites.length === 0) {
      showExploreMessage('没有可写入的发现站点', 'warning');
      return;
    }

    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    if (!config.appId || !config.appSecret) {
      showExploreMessage('请先在设置页面配置飞书应用凭证（App ID、Secret）', 'warning');
      return;
    }
    if (!config.exploreSheetToken || !config.exploreSheetId) {
      showExploreMessage('请先在设置页面配置「外链采集 - 遍历检测结果」表格（Spreadsheet Token、Sheet ID）', 'warning');
      return;
    }

    showExploreMessage('正在写入飞书...', 'info');

    const feishuResult = await appendDiscoveredSitesToFeishu(exploreCurrentBatch, discoveredSites);
    if (!feishuResult.ok) {
      showExploreMessage('写入飞书失败: ' + (feishuResult.error || '未知错误'), 'error');
      return;
    }

    exploreCurrentBatch.phase = 'feishu_written';
    exploreCurrentBatch.feishuWrittenAt = new Date().toISOString();
    exploreCurrentBatch.feishuWrittenCount = (exploreCurrentBatch.feishuWrittenCount || 0) + feishuResult.written;
    exploreCurrentBatch.updatedAt = new Date().toISOString();
    await saveExploreBatchWithExcludeFilter(exploreCurrentBatch);

    showExploreMessage(`成功写入 ${feishuResult.written} 条记录到飞书`, 'success');

  } catch (error) {
    console.error('[Explore] 飞书写入异常:', error);
    showExploreMessage('写入飞书失败: ' + (error.message || error), 'error');
  }
}

/**
 * 将 Ahrefs 反链数据写入飞书普通电子表格
 */
async function writeAhrefsBacklinksToFeishu(domain, backlinks, overview) {
  try {
    if (!backlinks || backlinks.length === 0) {
      return { success: false, error: '没有反链数据可写入' };
    }

    // 获取飞书配置
    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    if (!config.appId || !config.appSecret) {
      return { success: false, error: '请先配置飞书应用凭证' };
    }
    if (!config.ahrefsSheetToken || !config.ahrefsSheetId) {
      return { success: false, error: '请先配置「外链采集 - Ahrefs 反链」表格' };
    }

    // 获取 access token
    const accessToken = await getFeishuAccessToken();

    const spreadsheetToken = config.ahrefsSheetToken;
    const sheetId = config.ahrefsSheetId;
    const now = new Date().toISOString();

    // 构建行数据
  const ovDr = overview && overview.domainRating !== undefined ? String(overview.domainRating) : '';
  const ovRefdomains = overview && overview.refdomains !== undefined ? String(overview.refdomains) : '';
  const ovDofollowRefdomains = overview && overview.dofollowRefdomains !== undefined ? String(overview.dofollowRefdomains) : '';

  const rows = backlinks.map(b => [
    b.urlFrom || '',
    b.urlTo || '',
    b.anchor || '',
    b.domainRating?.toString() || '',
    b.title || '',
    now,
    domain || '',
    ovDr,
    ovRefdomains,
    ovDofollowRefdomains
  ]);

    // 获取当前行数
    const metaResponse = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/metainfo`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );
    const metaData = await metaResponse.json();

    console.log('[Ahrefs] 元数据响应:', metaData);

    let startRow = 2; // 默认从第2行开始（跳过表头）
    if (metaData.code === 0 && metaData.data?.sheets) {
      const sheet = metaData.data.sheets.find(s => s.sheetId === sheetId);
      console.log('[Ahrefs] 找到的工作表:', sheet);
      if (sheet && sheet.rowCount) {
        startRow = sheet.rowCount + 1;
      }
    } else {
      console.warn('[Ahrefs] 获取元数据失败或找不到工作表, 使用默认起始行:', metaData);
    }

    console.log('[Ahrefs] 写入参数:', {
      spreadsheetToken,
      sheetId,
      startRow,
      rowsCount: rows.length,
      firstRow: rows[0]
    });

    // 写入数据（A-J 共10列）
    const range = `${sheetId}!A${startRow}:J${startRow + rows.length - 1}`;
    console.log('[Ahrefs] 写入范围:', range);

    const response = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          valueRange: { range, values: rows }
        })
      }
    );

    const data = await response.json();
    console.log('[Ahrefs] 写入响应:', data);

    if (data.code !== 0) {
      console.error('[Ahrefs] 飞书写入失败:', data.msg, data);
      return { success: false, error: data.msg };
    }

    console.log('[Ahrefs] 飞书写入成功, 共', rows.length, '条');
    return { success: true, count: rows.length, range: range };

  } catch (error) {
    console.error('[Ahrefs] 飞书写入异常:', error);
    return { success: false, error: error.message };
  }
}

// ========== 批量提交 UI ==========

function renderBatchUrlList() {
  if (!elements.batchUrlList) return;

  const typeFilter = elements.batchTypeFilter?.value || '';
  const statusFilter = elements.batchStatusFilter?.value || '';

  const filteredUrls = batchUrls.filter(item => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });

  if (filteredUrls.length === 0) {
    elements.batchUrlList.innerHTML = '<div class="empty-list-hint">没有符合条件的记录</div>';
    return;
  }

  elements.batchUrlList.innerHTML = filteredUrls.map((item, i) => `
    <div class="batch-url-item ${getItemStatusClass(item.status)}" data-index="${item.index}">
      <input type="checkbox" data-record-id="${item.record_id}" ${item.selected ? 'checked' : ''}>
      <div class="url-info">
        <span class="url-text" title="${escapeHtml(item.url)}">${escapeHtml(truncateUrl(item.url, 50))}</span>
        <div class="url-meta">
          <span class="url-type">${escapeHtml(item.type)}</span>
          <span class="url-status status-${getStatusKey(item.status)}">${escapeHtml(item.status)}</span>
        </div>
      </div>
    </div>
  `).join('');

  // 绑定复选框事件
  elements.batchUrlList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const recordId = e.target.dataset.recordId;
      const item = batchUrls.find(u => u.record_id === recordId);
      if (item) {
        item.selected = e.target.checked;
      }
      updateBatchStartButton();
    });
  });

  updateBatchStartButton();
  updateBatchProgress();
}

function getItemStatusClass(status) {
  switch (status) {
    case '检测成功': return 'success';
    case '检测失败': return 'failed';
    case '提交中': return 'running';
    default: return '';
  }
}

function getStatusKey(status) {
  switch (status) {
    case '待提交': return 'pending';
    case '提交中': return 'running';
    case '检测成功': return 'success';
    case '检测失败': return 'failed';
    default: return 'pending';
  }
}

function truncateUrl(url, maxLen) {
  // 确保 url 是字符串类型
  if (typeof url !== 'string') {
    url = url?.link || url?.url || String(url || '');
  }
  if (!url || url.length <= maxLen) return url || '';
  return url.slice(0, maxLen - 3) + '...';
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function updateBatchProgress() {
  const selected = batchUrls.filter(u => u.selected).length;
  const total = batchUrls.length;
  if (elements.batchProgress) {
    if (total > 0) {
      elements.batchProgress.textContent = `${selected}/${total}`;
      elements.batchProgress.classList.remove('hidden');
    } else {
      elements.batchProgress.classList.add('hidden');
    }
  }
}

function updateBatchStartButton() {
  const selectedCount = batchUrls.filter(u => u.selected).length;
  if (elements.startBatchBtn) {
    elements.startBatchBtn.disabled = selectedCount === 0 || batchRunning;
  }
  updateBatchProgress();
}

function updateBatchControls(running) {
  if (elements.startBatchBtn) {
    elements.startBatchBtn.classList.toggle('hidden', running);
    elements.startBatchBtn.disabled = running;
  }
  if (elements.pauseBatchBtn) {
    elements.pauseBatchBtn.classList.toggle('hidden', !running);
    elements.pauseBatchBtn.disabled = !running;
  }
  if (elements.stopBatchBtn) {
    elements.stopBatchBtn.classList.toggle('hidden', !running);
    elements.stopBatchBtn.disabled = !running;
  }
}

function addBatchLog(message, type = 'info') {
  if (!elements.batchLogContainer) return;

  // 移除空提示
  const emptyHint = elements.batchLogContainer.querySelector('.empty-log-hint');
  if (emptyHint) emptyHint.remove();

  const time = new Date();
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;

  const logItem = document.createElement('div');
  logItem.className = `batch-log-item log-${type}`;
  logItem.innerHTML = `<span class="log-time">[${timeStr}]</span>${escapeHtml(message)}`;

  elements.batchLogContainer.appendChild(logItem);
  elements.batchLogContainer.scrollTop = elements.batchLogContainer.scrollHeight;
}

// ========== 批量提交执行 ==========

async function startBatchSubmit() {
  const selectedUrls = batchUrls.filter(u => u.selected);
  if (selectedUrls.length === 0) {
    showBatchMessage('请先选择要提交的 URL', 'warning');
    return;
  }

  if (!currentSiteId) {
    showBatchMessage('请先选择当前站点', 'warning');
    return;
  }

  batchRunning = true;
  batchPaused = false;
  updateBatchControls(true);
  addBatchLog(`开始批量提交，共 ${selectedUrls.length} 条`, 'info');

  const site = sites.find(s => s.id === currentSiteId);

  for (let i = 0; i < selectedUrls.length; i++) {
    if (!batchRunning) break;

    // 等待暂停解除
    while (batchPaused && batchRunning) {
      await sleep(500);
    }
    if (!batchRunning) break;

    const item = selectedUrls[i];
    addBatchLog(`处理 ${i + 1}/${selectedUrls.length}: ${truncateUrl(item.url, 40)}`, 'info');

    // 更新状态为提交中
    item.status = '提交中';
    renderBatchUrlList();

    try {
      // 打开新标签页
      const tab = await chrome.tabs.create({ url: item.url, active: false });

      // 等待页面加载完成
      await waitForTabComplete(tab.id, 30000);

      // 执行评论生成和填充
      const result = await executeBlogComment(tab.id, site);

      if (result.success) {
        // 等待页面刷新后验证
        await sleep(3000);
        const verifyResult = await verifySubmission(tab.id, site.siteUrl);

        if (verifyResult.success) {
          item.status = '检测成功';
          addBatchLog(`✓ 成功: ${truncateUrl(item.url, 40)}`, 'success');
        } else {
          item.status = '检测失败';
          addBatchLog(`✗ 验证失败: ${truncateUrl(item.url, 40)}`, 'warning');
        }
      } else {
        item.status = result.error?.includes('验证项') ? '需人工验证' : '识别失败';
        addBatchLog(`⚠ ${item.status}: ${truncateUrl(item.url, 40)} - ${result.error}`, 'warning');
      }

      // 关闭标签页
      await chrome.tabs.remove(tab.id);

    } catch (error) {
      item.status = '超时';
      addBatchLog(`✗ 超时: ${truncateUrl(item.url, 40)} - ${error.message}`, 'error');
    }

    // 回写到飞书
    await updateFeishuRecord(item);

    // 更新 UI
    renderBatchUrlList();

    // 间隔
    if (i < selectedUrls.length - 1) {
      await sleep(2000);
    }
  }

  batchRunning = false;
  batchPaused = false;
  updateBatchControls(false);
  addBatchLog('批量提交完成', 'info');

  // 统计结果
  const successCount = selectedUrls.filter(u => u.status === '检测成功').length;
  const failCount = selectedUrls.filter(u => u.status === '检测失败' || u.status === '超时' || u.status === '识别失败').length;
  showBatchMessage(`批量提交完成：成功 ${successCount}，失败 ${failCount}`, successCount > failCount ? 'success' : 'warning');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeout);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function executeBlogComment(tabId, site) {
  try {
    // 获取页面元数据
    const metaRes = await chrome.tabs.sendMessage(tabId, { action: 'getPageMetadata' });
    const title = metaRes?.title ?? '';
    const description = metaRes?.description ?? '';
    const h1 = metaRes?.h1 ?? '';

    // 执行评论生成和填充
    const res = await chrome.tabs.sendMessage(tabId, {
      action: 'blogCommentGenerateAndFill',
      title,
      description,
      h1,
      siteId: currentSiteId,
      autoSubmit: elements.autoSubmit?.checked ?? false,
      llmEnabled,
      tabId: tabId,
      siteUrl: site?.siteUrl
    });

    return {
      success: res?.success,
      error: res?.error,
      result: res?.result
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifySubmission(tabId, siteUrl) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'verifyCommentSubmission', siteUrl });
    return {
      success: res?.success && res.result?.success,
      message: res?.result?.message
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function updateFeishuRecord(item) {
  try {
    const accessToken = await getFeishuAccessToken();
    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    const now = new Date();
    const updatedAt = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishuAppToken}/tables/${config.feishuTableId}/records/${item.record_id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            '提交状态': item.status,
            '最后更新时间': updatedAt
          }
        })
      }
    );

    const data = await response.json();
    if (data.code !== 0) {
      console.error('[SidePanel] Failed to update Feishu record:', data.msg);
      addBatchLog(`飞书写入失败: ${data.msg}`, 'warning');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to update Feishu record:', error);
    addBatchLog(`飞书写入失败: ${error.message}`, 'warning');
  }
}

// ========== 监听 Background 消息 ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'batchProgress') {
    handleBatchProgress(request.data);
  } else if (request.action === 'batchComplete') {
    handleBatchComplete(request.data);
  } else if (request.action === 'ahrefsProgress') {
    if (currentMode === 'explore') {
      updateAhrefsProgress(request.message, request.type || 'info');
    }
  }
});

/**
 * 处理批量任务进度更新
 */
function handleBatchProgress(data) {
  if (!data) return;

  // 更新进度显示
  if (elements.batchProgress) {
    const progress = data.total > 0 ? `${data.currentIndex + 1}/${data.total}` : '';
    elements.batchProgress.textContent = progress;
    elements.batchProgress.classList.toggle('hidden', !progress);
  }

  // 更新运行状态栏（一行显示）
  if (data.url && data.status) {
    const statusText = data.status === 'running'
      ? `正在处理 ${data.currentIndex + 1}/${data.total}: ${truncateUrl(data.url, 30)}`
      : data.status === 'success'
        ? `✓ 成功 ${data.currentIndex + 1}/${data.total}: ${truncateUrl(data.url, 30)}`
        : `✗ 失败 ${data.currentIndex + 1}/${data.total}: ${truncateUrl(data.url, 30)}`;
    setBatchStatusLine(statusText);
  }

  // 更新状态消息
  if (data.url && data.status) {
    const statusText = data.status === 'running'
      ? `正在处理: ${truncateUrl(data.url, 40)}`
      : data.status === 'success'
        ? `✓ 成功: ${truncateUrl(data.url, 40)}`
        : `✗ ${data.result?.status || '失败'}: ${truncateUrl(data.url, 40)}`;

    showBatchMessage(statusText, data.status === 'success' ? 'success' : data.status === 'running' ? 'info' : 'warning');
  }

  // 添加日志
  if (data.url) {
    const logType = data.status === 'success' ? 'success' : data.status === 'failed' ? 'error' : 'info';
    const logMsg = data.status === 'running'
      ? `开始处理: ${truncateUrl(data.url, 50)}`
      : data.status === 'success'
        ? `✓ 成功: ${truncateUrl(data.url, 50)}`
        : `✗ ${data.result?.status || '失败'}: ${truncateUrl(data.url, 50)}${data.result?.message ? ` - ${data.result.message}` : ''}`;
    addBatchLog(logMsg, logType);
  }

  // 更新 URL 列表中的状态
  if (data.url && data.status) {
    const item = batchUrls.find(u => u.url === data.url);
    if (item) {
      item.status = data.status === 'success' ? '检测成功' : data.status === 'failed' ? (data.result?.status || '检测失败') : '提交中';
      renderBatchUrlList();
    }
  }
}

/**
 * 处理批量任务完成
 */
function handleBatchComplete(data) {
  batchRunning = false;
  batchPaused = false;
  updateBatchControls(false);

  // 清除运行状态栏
  setBatchStatusLine('');

  if (data.error) {
    showBatchMessage(`批量任务失败: ${data.error}`, 'error');
    addBatchLog(`批量任务失败: ${data.error}`, 'error');
  } else {
    const successCount = data.results?.filter(r => r.success).length || 0;
    const failCount = (data.total || 0) - successCount;
    showBatchMessage(`批量任务完成: 成功 ${successCount}，失败 ${failCount}`, successCount > failCount ? 'success' : 'warning');
    addBatchLog(`批量任务完成: 共 ${data.total} 条，成功 ${successCount}，失败 ${failCount}`, successCount > 0 ? 'success' : 'warning');
  }
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', init);

// ========== 自动采集模式核心函数 ==========

/**
 * 生成唯一 ID
 */
function generateAutoCollectId() {
  return 'ac_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 创建自动采集任务
 */
async function createAutoCollectTask(config) {
  const taskId = generateAutoCollectId();
  const task = {
    taskId,
    taskType: config.loopMode ? 'loop' : 'single',
    loopConfig: config.loopMode ? {
      enabled: true,
      maxDepth: config.maxDepth || LOOP_CONFIG.maxDepth,
      currentDepth: 0,
      stopOnNoNewSites: LOOP_CONFIG.stopOnNoNewSites
    } : null,
    batches: [],
    currentBatchIndex: 0,
    currentBatchId: null,
    pendingBatches: [],
    completedBatches: [],
    processedSites: [],
    totalStats: {
      rounds: 0,
      batches: 0,
      discoveredSites: 0,
      newSites: 0
    },
    status: 'pending',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveAutoCollectTask(task);
  return task;
}

const AUTO_COLLECT_STORAGE_MAX_BYTES = 4.5 * 1024 * 1024; // chrome.storage.local 约 5MB，预留裕量
const AUTO_COLLECT_MAX_DISCOVERED_SITES_PER_BATCH = 300; // 存储时只保留 url，避免爆体积
const AUTO_COLLECT_MAX_PROCESSED_SITES = 8000; // 去重依赖它，裁剪避免超配额

function estimateObjectBytes(obj) {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    // UTF-16 字符近似：2 bytes/char
    const s = JSON.stringify(obj) || '';
    return s.length * 2;
  }
}

function isQuotaExceededError(e) {
  const msg = String(e?.message || e || '');
  const lower = msg.toLowerCase();
  return lower.includes('quota exceeded') || lower.includes('quotabytes') || lower.includes('kquotabytes');
}

/**
 * 为了避免 chrome.storage.local 超配额：对任务进行裁剪/降维（不修改内存中的 task）
 * - 清空 step1 domains / step2 domainDates / step3 backlinks 的大字段
 * - step4.discoveredSites 只保留前 N 条，并把每项降为 { url }
 */
function prepareAutoCollectTaskForStorage(task, opts = {}) {
  const discoveredCap = typeof opts.discoveredCap === 'number'
    ? opts.discoveredCap
    : AUTO_COLLECT_MAX_DISCOVERED_SITES_PER_BATCH;
  const processedCap = typeof opts.processedCap === 'number'
    ? opts.processedCap
    : AUTO_COLLECT_MAX_PROCESSED_SITES;

  const safeTask = { ...task };

  // processedSites 可能持续增长；保存只保留尾部一段
  if (Array.isArray(task.processedSites)) {
    safeTask.processedSites = task.processedSites.slice(-processedCap);
  } else {
    safeTask.processedSites = [];
  }

  safeTask.batches = (Array.isArray(task.batches) ? task.batches : []).map((batch) => {
    const b = { ...batch };

    // 避免运行时大字段进入 storage（即使定义了，也会持续膨胀）
    delete b.urlList;
    delete b.backlinkDetails;
    delete b.traverseBacklinkList;
    delete b.discoveredSites;

    if (b.stepOutputs && typeof b.stepOutputs === 'object') {
      const so = { ...b.stepOutputs };

      // step1 domains（域名列表）体积大：只保留 count
      if (so.step1 && typeof so.step1 === 'object') {
        so.step1 = { count: so.step1.count || 0 };
      }

      // step2 域名列表/注册日期信息也较大：只保留 passed/failed
      if (so.step2 && typeof so.step2 === 'object') {
        so.step2 = {
          passed: so.step2.passed || 0,
          failed: so.step2.failed || 0
        };
      }

      // step3 backlinks（反链列表）在 step4 后不再需要用于循环：只保留 count
      if (so.step3 && typeof so.step3 === 'object') {
        so.step3 = { count: so.step3.count || 0 };
      }

      // step4 discoveredSites 用于后续创建下一轮：只保留 url
      if (so.step4 && typeof so.step4 === 'object') {
        const ds = Array.isArray(so.step4.discoveredSites) ? so.step4.discoveredSites : [];
        const trimmed = ds
          .slice(0, discoveredCap)
          .map((item) => {
            if (!item) return null;
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item.url) return { url: item.url };
            // 尝试兜底（避免存储时丢失结构）
            if (typeof item === 'object') {
              const url = item.urlFrom || item.siteUrl || item.link || item.sourceUrl;
              return url ? { url } : null;
            }
            return null;
          })
          .filter(Boolean);
        so.step4 = {
          discoveredSites: trimmed,
          count: typeof so.step4.count === 'number' ? so.step4.count : trimmed.length
        };
      }

      b.stepOutputs = so;
    }

    return b;
  });

  return safeTask;
}

/**
 * 保存自动采集任务
 */
async function saveAutoCollectTask(task) {
  if (autoCollectStorageSuppressed) {
    return;
  }
  try {
    // 先走常规裁剪
    let toSave = prepareAutoCollectTaskForStorage(task);
    let bytes = estimateObjectBytes(toSave);

    // 如果仍然过大：进一步激进裁剪（主要再砍 discoveredSites/processedSites）
    if (bytes > AUTO_COLLECT_STORAGE_MAX_BYTES) {
      toSave = prepareAutoCollectTaskForStorage(task, {
        discoveredCap: Math.floor(AUTO_COLLECT_MAX_DISCOVERED_SITES_PER_BATCH / 3),
        processedCap: Math.floor(AUTO_COLLECT_MAX_PROCESSED_SITES / 3)
      });
      bytes = estimateObjectBytes(toSave);
    }

    await chrome.storage.local.set({ [AUTO_COLLECT_TASK_KEY]: toSave });
    autoCollectTask = task;
  } catch (e) {
    // 配额错误时再做一次更激进裁剪兜底
    if (isQuotaExceededError(e)) {
      try {
        const toSave = prepareAutoCollectTaskForStorage(task, {
          discoveredCap: 50,
          processedCap: 1000
        });
        await chrome.storage.local.set({ [AUTO_COLLECT_TASK_KEY]: toSave });
        autoCollectTask = task;
        return;
      } catch (e2) {
        // fallthrough
      }
    }
    console.error('[AutoCollect] Failed to save task:', e);
  }
}

/**
 * 加载自动采集任务
 */
async function loadAutoCollectTask() {
  try {
    const result = await chrome.storage.local.get([AUTO_COLLECT_TASK_KEY]);
    autoCollectTask = result[AUTO_COLLECT_TASK_KEY] || null;
    return autoCollectTask;
  } catch (e) {
    console.error('[AutoCollect] Failed to load task:', e);
    return null;
  }
}

/**
 * 创建批次
 */
function createAutoCollectBatch(config) {
  return {
    batchId: generateAutoCollectId(),
    autoCollectTaskId: config.autoCollectTaskId,
    parentBatchId: config.parentBatchId || null,
    depth: config.depth || 0,
    roundIndex: config.roundIndex || 1,
    batchIndexInRound: config.batchIndexInRound || 0,
    sourceUrl: config.sourceUrl || '',
    sourceType: config.sourceType || 'initial',
    status: 'pending',
    currentStep: 1,
    currentPosition: {
      step: 1,
      phase: 'domain',
      index: 0,
      total: 0,
      currentItem: ''
    },
    stepOutputs: {
      step1: { domains: [], count: 0 },
      step2: { filteredDomains: [], passed: 0, failed: 0, domainDates: [] },
      step3: { backlinks: [], count: 0 },
      step4: { discoveredSites: [], count: 0 }
    },
    stats: {
      extractedDomains: 0,
      filteredDomains: 0,
      backlinks: 0,
      discoveredSites: 0,
      newSites: 0
    },
    startedAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null
  };
}

/**
 * 添加自动采集日志
 */
function addAutoCollectLog(message, type = 'info') {
  const now = new Date();
  const timeStr = now.toTimeString().slice(0, 8);
  const logEntry = { time: timeStr, message, type };
  autoCollectLogs.push(logEntry);
  if (autoCollectLogs.length > AUTO_COLLECT_LOG_MAX) {
    autoCollectLogs.shift();
  }
  if (type === 'error') {
    setAutoCollectErrorText(message);
  }
  renderAutoCollectLogs();
  updateAutoCollectStatusDetails();
}

/**
 * 渲染自动采集日志
 */
function renderAutoCollectLogs() {
  const container = elements.autoCollectLogContainer;
  if (!container) return;

  if (autoCollectLogs.length === 0) {
    container.innerHTML = '<li class="empty-log-hint">暂无日志</li>';
    return;
  }

  container.innerHTML = autoCollectLogs.map(log => {
    const icon = log.type === 'success' ? '✅' : log.type === 'error' ? '❌' : log.type === 'warning' ? '⚠️' : '🔄';
    return `<li class="log-item log-${log.type}"><span class="log-time">[${log.time}]</span>${icon} ${escHtml(log.message)}</li>`;
  }).join('');
  requestAnimationFrame(() => {
    const scrollEl = elements.autoCollectLogViewport || container;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });
}

/**
 * 更新进度显示
 */
function updateAutoCollectProgress(progress, statusText) {
  if (elements.autoCollectProgressBar) {
    elements.autoCollectProgressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  }
  if (elements.autoCollectStatusText) {
    elements.autoCollectStatusText.textContent = statusText || '准备中...';
  }
  updateAutoCollectStatusDetails();
}

function getAutoCollectCurrentBatch() {
  if (!autoCollectTask || !Array.isArray(autoCollectTask.batches)) return null;
  const id = autoCollectTask.currentBatchId;
  if (!id) return null;
  return autoCollectTask.batches.find(b => b && b.batchId === id) || null;
}

function autoCollectStepToLabel(step) {
  const s = Number(step) || 0;
  if (s === 1) return '1/4：提取域名';
  if (s === 2) return '2/4：WHOIS 筛选';
  if (s === 3) return '3/4：拉取反链';
  if (s === 4) return '4/4：遍历检测';
  return '—';
}

function setAutoCollectErrorText(message) {
  autoCollectLastErrorText = message || '';
  if (!elements.autoCollectErrorText) return;
  elements.autoCollectErrorText.textContent = autoCollectLastErrorText ? autoCollectLastErrorText : '无';
  elements.autoCollectErrorText.classList.toggle('is-error', !!autoCollectLastErrorText);
}

function updateAutoCollectStatusDetails() {
  if (!elements.autoCollectStepText || !elements.autoCollectRunStateText || !elements.autoCollectErrorText) return;

  // 状态栏始终显示（在 explore 面板内）
  if (elements.autoCollectProgress) elements.autoCollectProgress.classList.remove('hidden');

  const currentBatch = getAutoCollectCurrentBatch();
  const step = currentBatch?.currentStep || autoCollectLastKnownStep;
  elements.autoCollectStepText.textContent = autoCollectStepToLabel(step);

  let runState = '未运行';
  if (autoCollectStopped) runState = '已停止';
  else if (autoCollectPaused) runState = '暂停中';
  else if (autoCollectRunning) runState = autoCollectRunStuck ? '卡住中' : '运行中';
  else if (autoCollectLoopRunning) runState = '准备中';

  elements.autoCollectRunStateText.textContent = runState;
  // error 文本由 setAutoCollectErrorText 维护；这里不强制覆盖
  if (!autoCollectLastErrorText) {
    elements.autoCollectErrorText.textContent = '无';
    elements.autoCollectErrorText.classList.remove('is-error');
  }
}

/**
 * 更新自动采集控制按钮状态
 */
function updateAutoCollectControls(running, paused) {
  const startBtn = elements.autoCollectStartBtn;
  const pauseBtn = elements.autoCollectPauseBtn;
  const resumeBtn = elements.autoCollectResumeBtn;
  const stopBtn = elements.autoCollectStopBtn;
  const progressEl = elements.autoCollectProgress;
  const queueSection = elements.autoCollectQueueSection;
  const logSection = elements.autoCollectLogSection;
  const isStopped = !!autoCollectStopped;

  if (startBtn) {
    startBtn.disabled = running;
    if (isStopped && running) {
      startBtn.innerHTML = '<span class="btn-icon">⏹</span> 停止中...';
    } else if (isStopped && !running) {
      startBtn.innerHTML = '<span class="btn-icon">↻</span> 重新开始';
    } else {
      startBtn.innerHTML = running ? '<span class="btn-icon">⏳</span> 运行中' : '<span class="btn-icon">▶</span> 开始';
    }
  }
  if (pauseBtn) {
    pauseBtn.disabled = !running || paused || isStopped;
    pauseBtn.classList.toggle('hidden', paused || isStopped);
  }
  if (resumeBtn) {
    resumeBtn.disabled = !paused || isStopped;
    resumeBtn.classList.toggle('hidden', !paused || isStopped);
  }
  if (stopBtn) {
    stopBtn.disabled = !running || isStopped;
  }
  if (progressEl) {
    progressEl.classList.remove('hidden');
  }
  if (queueSection) {
    const shouldShow = running || paused || isStopped;
    queueSection.classList.toggle('hidden', !shouldShow && (!autoCollectTask || autoCollectTask.batches.length === 0));
  }
  if (logSection) {
    const shouldShow = running || paused || isStopped;
    logSection.classList.toggle('hidden', !shouldShow && autoCollectLogs.length === 0);
  }
}

/**
 * 渲染批次队列（按轮次分组，显示每个批次状态与发现数）
 */
function renderAutoCollectQueue() {
  const container = elements.autoCollectQueueList;
  const statsEl = elements.autoCollectQueueStats;
  if (!container) return;

  const task = autoCollectTask;
  if (!task || !Array.isArray(task.batches) || task.batches.length === 0) {
    container.innerHTML = '<div class="empty-list-hint">暂无任务</div>';
    if (statsEl) statsEl.textContent = '—';
    return;
  }

  const completed = task.completedBatches?.length || 0;
  const total = task.batches.length;
  if (statsEl) statsEl.textContent = `${completed}/${total} 完成`;

  // 按 roundIndex 分组（roundIndex 1 = 第1轮, 2 = 第2轮...）
  const byRound = {};
  for (const batch of task.batches) {
    const r = batch.roundIndex ?? 1;
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(batch);
  }
  const roundNumbers = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  const completedSet = new Set(task.completedBatches || []);
  const statusIcon = (b) => {
    if (b.status === 'completed') return '✅';
    if (b.status === 'in_progress') return '🔄';
    if (b.status === 'failed') return '❌';
    if (b.status === 'paused') return '⏸️';
    return '⏳';
  };
  const statusLabel = (b) => {
    if (b.status === 'completed') return '完成';
    if (b.status === 'in_progress') return `步骤 ${b.currentStep || 1}/4`;
    if (b.status === 'failed') return '失败';
    if (b.status === 'paused') return '已暂停';
    return '等待中';
  };
  const shortUrl = (url) => {
    if (!url || typeof url !== 'string') return '—';
    try {
      const u = new URL(url.startsWith('http') ? url : 'https://' + url);
      return u.hostname || url.slice(0, 30);
    } catch { return url.slice(0, 30); }
  };

  let html = '';
  for (const round of roundNumbers) {
    const batches = byRound[round];
    const doneInRound = batches.filter(b => completedSet.has(b.batchId)).length;
    const roundStatus = round === Math.max(...roundNumbers) && (task.status === 'running' || task.status === 'paused')
      ? `🔄 ${doneInRound}/${batches.length}`
      : `✅ ${doneInRound}/${batches.length}`;
    html += `<div class="queue-round-header">第${round}轮 ${roundStatus}</div>`;
    for (const b of batches) {
      const count = b.stats?.discoveredSites ?? b.stepOutputs?.step4?.count ?? 0;
      const urlLabel = shortUrl(b.sourceUrl);
      html += `<div class="queue-batch-item queue-batch-${b.status}">
        <span class="queue-batch-status">${statusIcon(b)} ${statusLabel(b)}</span>
        <span class="queue-batch-url" title="${escHtml(b.sourceUrl || '')}">${escHtml(urlLabel)}</span>
        <span class="queue-batch-count">${count} 个站点</span>
      </div>`;
    }
  }

  container.innerHTML = html || '<div class="empty-list-hint">暂无批次</div>';
}

/**
 * 等待指定 tab 加载完成（sidepanel 内使用）
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForTabCompleteInSidepanel(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // 若已 complete 可能不会再触发，先查一次
    chrome.tabs.get(tabId).then(tab => {
      if (tab?.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

/**
 * 步骤一：从当前活动页面或 batch.sourceUrl（循环模式）提取域名
 */
async function autoCollectStep1_ExtractDomains(batch) {
  addAutoCollectLog(`步骤1: 开始从页面提取域名`, 'info');
  batch.currentStep = 1;
  autoCollectLastKnownStep = 1;
  autoCollectRunStuck = false;
  setAutoCollectErrorText('');
  updateAutoCollectStatusDetails();
  batch.status = 'in_progress';
  batch.startedAt = new Date().toISOString();

  let tab = null;
  let tabCreatedByUs = false;

  try {
    // 循环模式第2轮起：从发现的站点 URL 打开页面再提取
    if (batch.sourceType === 'discovered' && batch.sourceUrl) {
      const urlToOpen = batch.sourceUrl.startsWith('http') ? batch.sourceUrl : 'https://' + batch.sourceUrl;
      updateAutoCollectProgress(5, `正在打开 ${urlToOpen.slice(0, 40)}...`);
      tab = await chrome.tabs.create({ url: urlToOpen, active: false });
      tabCreatedByUs = true;
      await waitForTabCompleteInSidepanel(tab.id, 25000);
      if (autoCollectStopped) {
        if (tabCreatedByUs) chrome.tabs.remove(tab.id).catch(() => {});
        return { success: false, stopped: true };
      }
      updateAutoCollectProgress(10, `正在从页面提取域名...`);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id || !activeTab.url) {
        throw new Error('无法获取当前活动页');
      }
      tab = activeTab;
      batch.sourceUrl = tab.url;
      updateAutoCollectProgress(10, `正在从页面提取域名...`);
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractCommentUrls' })
      .catch(e => ({ success: false, error: e?.message }));

    if (tabCreatedByUs) {
      chrome.tabs.remove(tab.id).catch(() => {});
    }

    if (!response?.success) {
      throw new Error(response?.error || '提取失败');
    }

    const rawUrls = response.urls || [];
    const exclude = await getExploreExcludeDomainsForFilter();
    const filtered = filterUrlsExcludingDomains ? filterUrlsExcludingDomains(rawUrls, exclude) : rawUrls;

    // 提取域名
    const domains = rawUrls.map(u => {
      try {
        return new URL(u.startsWith('http') ? u : 'https://' + u).hostname;
      } catch { return null; }
    }).filter(Boolean);
    const uniqueDomains = [...new Set(domains)];

    batch.stepOutputs.step1 = { domains: uniqueDomains, count: uniqueDomains.length };
    batch.stats.extractedDomains = uniqueDomains.length;
    batch.updatedAt = new Date().toISOString();

    addAutoCollectLog(`步骤1: 提取到 ${uniqueDomains.length} 个域名`, 'success');
    return { success: true, domains: uniqueDomains };
  } catch (e) {
    if (tabCreatedByUs && tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
    addAutoCollectLog(`步骤1 失败: ${e.message}`, 'error');
    return { success: false, error: e.message };
  }
}

/**
 * 步骤二：WHOIS 筛选
 */
async function autoCollectStep2_FilterByWhois(batch, domains) {
  addAutoCollectLog(`步骤2: 开始 WHOIS 筛选 (${domains.length} 个域名)`, 'info');
  batch.currentStep = 2;
  autoCollectLastKnownStep = 2;
  autoCollectRunStuck = false;
  setAutoCollectErrorText('');
  updateAutoCollectStatusDetails();
  updateAutoCollectProgress(25, `正在进行 WHOIS 筛选...`);

  try {
    const result = await filterDomainsByAge(domains, 5);
    const filtered = result.filtered || [];
    const domainDates = result.domainDates || [];

    batch.stepOutputs.step2 = {
      filteredDomains: filtered,
      passed: filtered.length,
      failed: domains.length - filtered.length,
      domainDates
    };
    batch.stats.filteredDomains = filtered.length;
    batch.updatedAt = new Date().toISOString();

    addAutoCollectLog(`步骤2: 通过 WHOIS 筛选 ${filtered.length}/${domains.length} 个域名`, 'success');
    return { success: true, filteredDomains: filtered };
  } catch (e) {
    addAutoCollectLog(`步骤2 失败: ${e.message}`, 'error');
    return { success: false, error: e.message };
  }
}

/**
 * 步骤三：拉取反链
 * 必须先把 exploreCurrentBatch 设为当前 batch，否则 runAhrefsFetchingLoop 会把反链写到错误批次
 */
async function autoCollectStep3_FetchBacklinks(batch, domains) {
  addAutoCollectLog(`步骤3: 开始拉取反链 (${domains.length} 个域名)`, 'info');
  batch.currentStep = 3;
  autoCollectLastKnownStep = 3;
  autoCollectRunStuck = false;
  setAutoCollectErrorText('');
  updateAutoCollectStatusDetails();
  updateAutoCollectProgress(40, `正在拉取反链...`);

  const prevExploreBatch = exploreCurrentBatch;
  exploreCurrentBatch = batch;

  try {
    // 设置 Ahrefs 域名队列
    exploreAhrefsDomains = domains.map(d => ({ domain: d, creationDate: '' }));
    exploreAhrefsDomainsQueue = domains;
    exploreAhrefsRunning = true;
    exploreAhrefsPaused = false;
    exploreAhrefsAborted = false;
    exploreAhrefsCurrentIndex = 0;

    // 执行拉取（反链会写入当前 exploreCurrentBatch 即本 batch）
    const result = await runAhrefsFetchingLoop(domains, 0);

    if (result.stopped) {
      addAutoCollectLog(`步骤3: 已停止`, 'warning');
      exploreCurrentBatch = prevExploreBatch;
      return { success: false, stopped: true };
    }
    if (result.paused) {
      addAutoCollectLog(`步骤3: 已暂停`, 'warning');
      exploreCurrentBatch = prevExploreBatch;
      return { success: false, paused: true };
    }

    const backlinks = batch.urlList || [];
    batch.stepOutputs.step3 = { backlinks, count: backlinks.length };
    batch.stats.backlinks = backlinks.length;
    batch.updatedAt = new Date().toISOString();

    exploreCurrentBatch = prevExploreBatch;

    addAutoCollectLog(`步骤3: 拉取到 ${backlinks.length} 条反链`, 'success');
    return { success: true, backlinks };
  } catch (e) {
    exploreCurrentBatch = prevExploreBatch;
    addAutoCollectLog(`步骤3 失败: ${e.message}`, 'error');
    return { success: false, error: e.message };
  }
}

/**
 * 步骤四：遍历检测可评论站点（与「遍历检测可评论站点」按钮共用 runTraverseLoopOnly）
 */
async function autoCollectStep4_TraverseDetect(batch, urls) {
  addAutoCollectLog(`步骤4: 开始遍历检测（待检测 URL 约 ${urls.length} 条）`, 'info');
  batch.currentStep = 4;
  autoCollectLastKnownStep = 4;
  autoCollectRunStuck = false;
  setAutoCollectErrorText('');
  updateAutoCollectStatusDetails();
  updateAutoCollectProgress(60, `正在遍历检测可评论站点...`);

  const prevExploreBatch = exploreCurrentBatch;
  exploreCurrentBatch = batch;

  try {
    if (!Array.isArray(urls) || urls.length === 0) {
      batch.discoveredSites = [];
      batch.stepOutputs.step4 = { discoveredSites: [], count: 0 };
      batch.stats.discoveredSites = 0;
      addAutoCollectLog('步骤4: 待检测 URL 为空，跳过', 'info');
      exploreCurrentBatch = prevExploreBatch;
      return { success: true, discoveredSites: [] };
    }

    const exclude = await getExploreExcludeDomainsForFilter();
    const filtered = typeof filterUrlsExcludingDomains === 'function'
      ? filterUrlsExcludingDomains(urls, exclude)
      : urls;
    const traverseList = typeof dedupeUrls === 'function' ? dedupeUrls(filtered) : [...new Set(filtered)];

    if (traverseList.length === 0) {
      addAutoCollectLog('步骤4: 排除域名过滤后无可检测 URL，跳过', 'warning');
      batch.stepOutputs.step4 = { discoveredSites: [], count: 0 };
      batch.stats.discoveredSites = 0;
      exploreCurrentBatch = prevExploreBatch;
      return { success: true, discoveredSites: [] };
    }

    addAutoCollectLog(`步骤4: 待检测 URL 列表 ${traverseList.length} 条（已去重/过滤）`, 'info');

    if (Array.isArray(batch.backlinkDetails)) {
      batch.backlinkDetails = batch.backlinkDetails
        .map((d) => {
          if (!d) return null;
          const urlFrom = d.urlFrom || d.url || null;
          const domainRating = typeof d.domainRating === 'number'
            ? d.domainRating
            : (d.domainRating != null ? Number(d.domainRating) : 0);
          if (!urlFrom) return null;
          return { urlFrom, domainRating: Number.isFinite(domainRating) ? domainRating : 0 };
        })
        .filter(Boolean);
    }
    if (Array.isArray(batch.urlList)) batch.urlList = [];

    batch.traverseBacklinkList = traverseList;
    batch.lastProcessedIndex = 0;
    batch.urlProgress = batch.urlProgress || {};
    batch.discoveredSites = batch.discoveredSites || [];
    batch.status = 'running';
    batch.phase = 'traverse_check';

    // 释放内存并避免后续 save 仍带大数组：stepOutputs 仅保留统计（持久化由 prepareExploreBatchForStorage 再裁剪一层）
    if (batch.stepOutputs && typeof batch.stepOutputs === 'object') {
      if (batch.stepOutputs.step1 && typeof batch.stepOutputs.step1 === 'object') {
        batch.stepOutputs.step1 = {
          count: batch.stepOutputs.step1.count
            ?? (Array.isArray(batch.stepOutputs.step1.domains) ? batch.stepOutputs.step1.domains.length : 0)
        };
      }
      if (batch.stepOutputs.step2 && typeof batch.stepOutputs.step2 === 'object') {
        batch.stepOutputs.step2 = {
          passed: batch.stepOutputs.step2.passed,
          failed: batch.stepOutputs.step2.failed || 0
        };
      }
      if (batch.stepOutputs.step3 && typeof batch.stepOutputs.step3 === 'object') {
        batch.stepOutputs.step3 = {
          count: batch.stepOutputs.step3.count
            ?? batch.stats?.backlinks
            ?? (Array.isArray(batch.stepOutputs.step3.backlinks) ? batch.stepOutputs.step3.backlinks.length : 0)
        };
      }
    }

    await saveExploreBatchWithExcludeFilter(batch);
    if (exploreCurrentBatch?.batchId === batch.batchId) exploreCurrentBatch = batch;

    updateAutoCollectProgress(75, `遍历检测中…（${traverseList.length} 条 URL）`);

    await runTraverseLoopOnly(batch.batchId);

    if (autoCollectStopped) {
      const syncedStop = await loadBatch(batch.batchId);
      if (syncedStop) {
        batch.discoveredSites = syncedStop.discoveredSites || [];
        batch.urlProgress = syncedStop.urlProgress;
        batch.lastProcessedIndex = syncedStop.lastProcessedIndex;
        batch.phase = syncedStop.phase;
        batch.status = syncedStop.status;
        batch.updatedAt = syncedStop.updatedAt;
      }
      exploreCurrentBatch = prevExploreBatch;
      return { success: false, stopped: true };
    }

    const synced = await loadBatch(batch.batchId);
    if (synced) {
      batch.discoveredSites = synced.discoveredSites || [];
      batch.urlProgress = synced.urlProgress;
      batch.lastProcessedIndex = synced.lastProcessedIndex;
      batch.phase = synced.phase;
      batch.status = synced.status;
      batch.updatedAt = synced.updatedAt;
    }

    batch.stepOutputs.step4 = {
      discoveredSites: batch.discoveredSites || [],
      count: (batch.discoveredSites || []).length
    };
    batch.stats.discoveredSites = (batch.discoveredSites || []).length;
    batch.updatedAt = new Date().toISOString();

    exploreCurrentBatch = prevExploreBatch;
    addAutoCollectLog(`步骤4: 发现 ${batch.stats.discoveredSites} 个可评论站点`, 'success');
    return { success: true, discoveredSites: batch.discoveredSites };
  } catch (e) {
    exploreCurrentBatch = prevExploreBatch;
    addAutoCollectLog(`步骤4 失败: ${e.message}`, 'error');
    return { success: false, error: e.message };
  }
}

/**
 * 执行单个批次
 */
async function executeAutoCollectBatch(batch) {
  addAutoCollectLog(`开始执行批次: ${batch.batchId.slice(-8)}`, 'info');
  batch.status = 'in_progress';
  batch.startedAt = new Date().toISOString();

  try {
    // 步骤1: 提取域名
    if (autoCollectStopped) return { stopped: true };
    const step1Result = await autoCollectStep1_ExtractDomains(batch);
    if (step1Result.stopped) return { stopped: true };
    if (!step1Result.success) throw new Error(step1Result.error || '步骤1失败');
    await saveAutoCollectTask(autoCollectTask);

    // 步骤2: WHOIS 筛选
    if (autoCollectStopped) return { stopped: true };
    while (autoCollectPaused) {
      await new Promise(r => setTimeout(r, 500));
      if (autoCollectStopped) return { stopped: true };
    }
    const step2Result = await autoCollectStep2_FilterByWhois(batch, step1Result.domains);
    if (!step2Result.success) throw new Error(step2Result.error || '步骤2失败');
    await saveAutoCollectTask(autoCollectTask);

    // 步骤3: 拉取反链
    if (autoCollectStopped) return { stopped: true };
    while (autoCollectPaused) {
      await new Promise(r => setTimeout(r, 500));
      if (autoCollectStopped) return { stopped: true };
    }
    const step3Result = await autoCollectStep3_FetchBacklinks(batch, step2Result.filteredDomains);
    if (!step3Result.success) {
      if (step3Result.stopped || step3Result.paused) return { stopped: true };
      throw new Error(step3Result.error || '步骤3失败');
    }
    await saveAutoCollectTask(autoCollectTask);

    // 步骤4: 遍历检测
    if (autoCollectStopped) return { stopped: true };
    while (autoCollectPaused) {
      await new Promise(r => setTimeout(r, 500));
      if (autoCollectStopped) return { stopped: true };
    }
    const step4Result = await autoCollectStep4_TraverseDetect(batch, step3Result.backlinks);
    if (!step4Result.success) {
      if (step4Result.stopped) return { stopped: true };
      throw new Error(step4Result.error || '步骤4失败');
    }
    await saveAutoCollectTask(autoCollectTask);

    // 批次完成
    batch.status = 'completed';
    batch.completedAt = new Date().toISOString();
    updateAutoCollectProgress(100, '批次完成');
    addAutoCollectLog(`批次 ${batch.batchId.slice(-8)} 完成: 发现 ${batch.stats.discoveredSites} 个可评论站点`, 'success');

    return { success: true, batch };
  } catch (e) {
    batch.status = 'failed';
    batch.completedAt = new Date().toISOString();
    addAutoCollectLog(`批次 ${batch.batchId.slice(-8)} 失败: ${e.message}`, 'error');
    return { success: false, error: e.message, batch };
  }
}

/**
 * 创建下一轮批次（循环模式）
 */
async function createNextRoundBatches(task) {
  const { currentDepth, maxDepth } = task.loopConfig;

  // 检查深度限制
  if (currentDepth >= maxDepth) {
    addAutoCollectLog(`已达到最大深度 ${maxDepth}，停止循环`, 'info');
    return null;
  }

  // 收集所有已发现站点并记录来源批次（用于 parentBatchId）
  const discoveredWithParent = [];
  for (const batchId of task.completedBatches || []) {
    const batch = task.batches?.find(b => b.batchId === batchId);
    if (batch?.stepOutputs?.step4?.discoveredSites) {
      for (const site of batch.stepOutputs.step4.discoveredSites) {
        discoveredWithParent.push({ site, parentBatchId: batchId });
      }
    }
  }

  // 去重：使用 normalizeUrl 标准化，用 Set 判断是否已处理
  const norm = (url) => (typeof normalizeUrl === 'function' ? normalizeUrl(url) : (url || '').trim().toLowerCase());
  const processedSet = new Set((task.processedSites || []).map(norm));
  const newSitesWithParent = discoveredWithParent.filter(({ site }) => {
    const url = (site && site.url) || site;
    const normalized = norm(url);
    return normalized && !processedSet.has(normalized);
  });

  // 无新站点，停止循环
  if (newSitesWithParent.length === 0) {
    addAutoCollectLog('没有发现新的可评论站点，停止循环', 'info');
    return null;
  }

  // 限制每轮处理的站点数（优先读取 UI 配置 loopMaxSites）
  const maxSitesPerRound = Math.min(
    parseInt(elements.loopMaxSites?.value, 10) || LOOP_CONFIG.maxSitesPerRound,
    newSitesWithParent.length
  );
  const sitesToProcess = newSitesWithParent.slice(0, maxSitesPerRound);

  addAutoCollectLog(`创建第 ${currentDepth + 2} 轮批次: ${sitesToProcess.length} 个站点`, 'info');

  // 为每个新站点创建批次，并传入 parentBatchId
  const roundIndex = currentDepth + 1;
  for (let i = 0; i < sitesToProcess.length; i++) {
    const { site, parentBatchId } = sitesToProcess[i];
    const siteUrl = (site && site.url) || site;
    const normalizedUrl = norm(siteUrl);

    const batch = createAutoCollectBatch({
      autoCollectTaskId: task.taskId,
      parentBatchId: parentBatchId || null,
      depth: currentDepth + 1,
      roundIndex,
      batchIndexInRound: i,
      sourceUrl: siteUrl,
      sourceType: 'discovered'
    });

    task.batches.push(batch);
    task.pendingBatches.push(batch.batchId);
    if (!Array.isArray(task.processedSites)) task.processedSites = [];
    task.processedSites.push(normalizedUrl);
  }

  // 更新深度
  task.loopConfig.currentDepth = roundIndex;
  await saveAutoCollectTask(task);

  return sitesToProcess.length;
}

/**
 * 启动自动采集任务
 */
async function startAutoCollect() {
  if (autoCollectRunning) {
    showExploreMessage('自动采集已在运行中', 'warning');
    return;
  }

  // 新任务开始前允许写入（含 createAutoCollectTask 内的首次 save）
  autoCollectStorageSuppressed = false;

  const loopMode = elements.loopModeEnabled?.checked || false;
  const maxDepth = parseInt(elements.loopMaxDepth?.value || '3', 10);

  try {
    // 创建任务
    const task = await createAutoCollectTask({
      loopMode,
      maxDepth
    });

    // 创建初始批次
    const batch = createAutoCollectBatch({
      autoCollectTaskId: task.taskId,
      depth: 0,
      roundIndex: 1,
      batchIndexInRound: 0,
      sourceType: 'initial'
    });

    task.batches.push(batch);
    task.pendingBatches.push(batch.batchId);
    await saveAutoCollectTask(task);

    autoCollectRunning = true;
    autoCollectPaused = false;
    autoCollectStopped = false;
    autoCollectRunStuck = false;
    setAutoCollectErrorText('');
    autoCollectLastKnownStep = 0;
    autoCollectLogs = [];
    autoCollectHistoryTask = null;

    updateAutoCollectControls(true, false);
    // 防止出现第二组停止按钮（Explore 控件）
    updateExploreControls(null);
    addAutoCollectLog(`自动采集任务已启动 (${loopMode ? '循环模式' : '单次模式'})`, 'success');

    // 开始执行
    await runAutoCollectLoop();

  } catch (e) {
    showExploreMessage('启动失败: ' + e.message, 'error');
    addAutoCollectLog('启动失败: ' + e.message, 'error');
    autoCollectRunning = false;
    autoCollectRunStuck = false;
    updateAutoCollectControls(false, false);
    updateAutoCollectStatusDetails();
  }
}

/**
 * 运行自动采集循环
 * 必须在 finally 中重置 autoCollectRunning：否则 runAutoCollectLoopInner 内任一 await 抛错（如 storage 配额）
 * 会导致永远到不了「任务完成」段，开始按钮一直 disabled +「停止中...」。
 */
async function runAutoCollectLoop() {
  const task = autoCollectTask;
  if (!task) return;

  autoCollectLoopRunning = true;
  try {
    await runAutoCollectLoopInner(task);
  } catch (e) {
    console.error('[AutoCollect] 循环异常:', e);
    addAutoCollectLog(`自动采集异常: ${e?.message || e}`, 'error');
    if (task) {
      try {
        task.status = 'failed';
        task.updatedAt = new Date().toISOString();
        await saveAutoCollectTask(task);
      } catch (_) { /* ignore */ }
    }
  } finally {
    autoCollectLoopRunning = false;
    autoCollectRunning = false;
    exploreAhrefsAborted = false;
    autoCollectHistoryTask = null;
    updateExploreControls(null);
    updateAutoCollectControls(false, false);
    updateAutoCollectStatusDetails();
  }
}

async function runAutoCollectLoopInner(task) {
  task.status = 'running';
  task.updatedAt = new Date().toISOString();
  await saveAutoCollectTask(task);

  while (!autoCollectStopped) {
    // 检查暂停
    while (autoCollectPaused) {
      task.status = 'paused';
      task.updatedAt = new Date().toISOString();
      await saveAutoCollectTask(task);
      await new Promise(r => setTimeout(r, 500));
      if (autoCollectStopped) break;
    }
    if (autoCollectStopped) break;

    task.status = 'running';
    await saveAutoCollectTask(task);

    // 获取下一个待执行的批次
    const nextBatchId = task.pendingBatches.shift();
    if (!nextBatchId) {
      // 没有待执行的批次，检查是否需要创建下一轮（循环模式）
      if (task.taskType === 'loop' && task.loopConfig?.enabled) {
        const newBatchesCount = await createNextRoundBatches(task);
        if (!newBatchesCount) {
          // 无新批次，任务完成
          break;
        }
        continue;
      } else {
        // 单次模式，任务完成
        break;
      }
    }

    // 执行批次
    const batch = task.batches.find(b => b.batchId === nextBatchId);
    if (!batch) continue;

    task.currentBatchIndex = task.batches.indexOf(batch);
    task.currentBatchId = batch.batchId; // 用于断点续传：关闭后恢复时知道当前执行到哪一批
    await saveAutoCollectTask(task);
    renderAutoCollectQueue();

    const result = await executeAutoCollectBatch(batch);

    task.currentBatchId = null;
    await saveAutoCollectTask(task);

    if (result.stopped) break;

    // 更新任务状态：成功则计入完成列表与统计；失败仅记录日志，不阻塞后续批次
    if (result.success) {
      task.completedBatches.push(batch.batchId);
      task.totalStats.discoveredSites += batch.stats.discoveredSites;
      task.totalStats.newSites += batch.stats.newSites || batch.stats.discoveredSites;
    } else {
      addAutoCollectLog(`批次 ${batch.batchId.slice(-8)} 失败，继续下一批`, 'warning');
    }
    task.totalStats.batches = task.batches.length;
    await saveAutoCollectTask(task);
    renderAutoCollectQueue();
  }

  // 任务完成（running / 按钮状态在 runAutoCollectLoop.finally 统一重置）
  task.status = autoCollectStopped ? 'stopped' : 'completed';
  task.updatedAt = new Date().toISOString();
  await saveAutoCollectTask(task);

  updateAutoCollectProgress(100, task.status === 'completed' ? '任务完成' : '任务已停止');
  addAutoCollectLog(`自动采集任务${task.status === 'completed' ? '完成' : '已停止'}: 共发现 ${task.totalStats.discoveredSites} 个可评论站点`, 'success');
}

/**
 * 暂停自动采集
 */
function pauseAutoCollect() {
  if (!autoCollectRunning || autoCollectPaused) return;
  autoCollectPaused = true;
  exploreAhrefsPaused = true;
  if (autoCollectTask) {
    autoCollectTask.status = 'paused';
    autoCollectTask.updatedAt = new Date().toISOString();
    saveAutoCollectTask(autoCollectTask).catch(() => {});
  }
  updateAutoCollectControls(true, true);
  addAutoCollectLog('自动采集已暂停', 'warning');
  updateAutoCollectStatusDetails();
  updateExploreControls(null);
}

/**
 * 继续自动采集
 * 若循环未在跑（例如页面恢复后），则重新启动循环以真正继续执行
 */
function resumeAutoCollect() {
  if (!autoCollectPaused) return;
  autoCollectPaused = false;
  exploreAhrefsPaused = false;
  autoCollectHistoryTask = null;
  updateAutoCollectControls(true, false);
  addAutoCollectLog('自动采集已继续', 'info');
  updateAutoCollectStatusDetails();
  updateExploreControls(null);
  if (!autoCollectLoopRunning && autoCollectTask) {
    runAutoCollectLoop();
  }
}

/**
 * 停止自动采集
 */
function stopAutoCollect() {
  if (!autoCollectRunning) return;
  autoCollectStopped = true;
  autoCollectPaused = false;
  exploreAhrefsAborted = true;
  addAutoCollectLog('正在停止自动采集...', 'warning');
  autoCollectRunStuck = false;
  updateAutoCollectStatusDetails();
  // 立即刷新按钮文案：避免用户看到“仍在运行中”
  updateAutoCollectControls(autoCollectRunning, autoCollectPaused);
  updateExploreControls(null);
}

function getAutoCollectHistoryCandidateBatches(task) {
  const batches = Array.isArray(task?.batches) ? task.batches : [];
  return batches.filter(b => b && (b.status === 'in_progress' || b.status === 'paused'));
}

function updateAutoCollectHistoryRestoreButton() {
  const selectEl = elements.autoCollectHistoryBatchSelect;
  const btnEl = elements.autoCollectRestoreSelectedBtn;
  if (!selectEl || !btnEl) return;

  const hasValue = !!selectEl.value;
  btnEl.disabled = !hasValue;
  // 一旦加载出候选批次后就保持按钮显示，仅靠 disabled 控制可点性
  if (hasValue) btnEl.classList.remove('hidden');
}

async function loadAutoCollectHistoryBatches() {
  const task = autoCollectHistoryTask || await loadAutoCollectTask();
  if (!task) {
    autoCollectHistoryTask = null;
    if (elements.autoCollectHistoryBatchSelect) elements.autoCollectHistoryBatchSelect.classList.add('hidden');
    if (elements.autoCollectRestoreSelectedBtn) elements.autoCollectRestoreSelectedBtn.classList.add('hidden');
    return;
  }

  const candidates = getAutoCollectHistoryCandidateBatches(task);
  const selectEl = elements.autoCollectHistoryBatchSelect;
  const btnEl = elements.autoCollectRestoreSelectedBtn;
  if (!selectEl || !btnEl) return;

  selectEl.innerHTML = '<option value="">-- 选择批次 --</option>';
  for (const b of candidates) {
    const step = b.currentStep ? `step${b.currentStep}` : 'step?';
    const label = `${b.batchId} · ${b.status} · ${step}`;
    const opt = document.createElement('option');
    opt.value = b.batchId;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }

  const hasCandidates = candidates.length > 0;
  selectEl.disabled = !hasCandidates;
  btnEl.disabled = true;
  selectEl.classList.toggle('hidden', !hasCandidates);
  btnEl.classList.toggle('hidden', !hasCandidates);
  if (!hasCandidates) {
    showExploreMessage('暂无历史批次可恢复', 'warning');
    return;
  }

  updateAutoCollectHistoryRestoreButton();
}

async function restoreAutoCollectSelectedBatch(batchId) {
  if (!batchId) throw new Error('未选择批次');
  if (autoCollectRunning || autoCollectPaused) throw new Error('已有自动采集任务在运行中，请稍后');

  const task = await loadAutoCollectTask();
  if (!task) throw new Error('未找到历史任务');

  // 恢复时隐藏“历史批次”选择区，避免用户误操作
  if (elements.autoCollectHistoryBatchSelect) elements.autoCollectHistoryBatchSelect.classList.add('hidden');
  if (elements.autoCollectRestoreSelectedBtn) elements.autoCollectRestoreSelectedBtn.classList.add('hidden');

  const batch = task.batches?.find(b => b && b.batchId === batchId);
  if (!batch) throw new Error('所选批次不存在');
  if (!(batch.status === 'in_progress' || batch.status === 'paused')) {
    throw new Error('所选批次状态不可恢复：' + batch.status);
  }

  // 强制把选中的 batch 放到 pending 队列头部，确保立刻执行
  const pending = Array.isArray(task.pendingBatches) ? task.pendingBatches.slice() : [];
  const newPending = pending.filter(id => id !== batchId);
  newPending.unshift(batchId);
  task.pendingBatches = newPending;
  task.currentBatchId = null;

  task.status = 'running';
  autoCollectStorageSuppressed = false;
  await saveAutoCollectTask(task);

  autoCollectHistoryTask = null;
  autoCollectTask = task;
  autoCollectStopped = false;
  autoCollectPaused = false;
  autoCollectRunning = true;
  autoCollectLoopRunning = false;
  autoCollectRunStuck = false;
  autoCollectLastKnownStep = batch.currentStep || 0;
  setAutoCollectErrorText('');
  autoCollectLogs = [];

  updateAutoCollectControls(true, false);
  // 防止出现第二组停止按钮（Explore 控件）
  updateExploreControls(null);
  updateAutoCollectStatusDetails();
  renderAutoCollectQueue();

  addAutoCollectLog(`已重新恢复历史批次：${batchId}`, 'success');
  await runAutoCollectLoop();
}

/**
 * 恢复自动采集状态（页面刷新/关闭后恢复）
 * 若有未执行完的当前批次（currentBatchId），将其重新放回队列头部以便「继续」时执行
 */
async function restoreAutoCollectState() {
  try {
    autoCollectStorageSuppressed = false;
    const task = await loadAutoCollectTask();
    if (!task) return;

    // 仅当 task.status 为 running 时才自动恢复；paused/stopped 需要手动加载历史批次
    if (task.status === 'running') {
      autoCollectHistoryTask = null;
      autoCollectTask = task;
      autoCollectStopped = false;
      autoCollectPaused = false;
      autoCollectRunning = true;
      autoCollectRunStuck = false;
      setAutoCollectErrorText('');

      // 断点续传：若存在执行到一半的批次，放回待执行队列头部
      const currentId = task.currentBatchId;
      if (currentId && Array.isArray(task.pendingBatches) && !task.pendingBatches.includes(currentId)) {
        const batch = task.batches?.find(b => b.batchId === currentId);
        if (batch && (batch.status === 'in_progress' || batch.status === 'paused')) {
          task.pendingBatches.unshift(currentId);
          task.currentBatchId = null;
          await saveAutoCollectTask(task);
        }
      }

      // 显示进度区域
      if (elements.autoCollectProgress) {
        elements.autoCollectProgress.classList.remove('hidden');
      }
      if (elements.autoCollectQueueSection) {
        elements.autoCollectQueueSection.classList.remove('hidden');
      }
      if (elements.autoCollectLogSection) {
        elements.autoCollectLogSection.classList.remove('hidden');
      }

      // 更新进度显示
      const totalBatches = task.batches?.length || 0;
      const completedBatches = task.completedBatches?.length || 0;
      const currentRestoredBatch = task.currentBatchId
        ? task.batches?.find(b => b && b.batchId === task.currentBatchId) || null
        : null;
      autoCollectLastKnownStep = currentRestoredBatch?.currentStep || 0;
      const progress = totalBatches > 0 ? (completedBatches / totalBatches * 100) : 0;
      updateAutoCollectProgress(progress, `任务 ${task.status === 'paused' ? '已暂停' : '运行中'}: ${completedBatches}/${totalBatches} 批次`);

      // 更新控制按钮状态
      autoCollectPaused = false;
      autoCollectRunning = true;
      updateAutoCollectControls(autoCollectRunning, autoCollectPaused);
      updateExploreControls(null);

      // 渲染队列
      renderAutoCollectQueue();

      addAutoCollectLog('已恢复自动采集任务（running）', 'info');
    }
    // task.status 为 paused/stopped：不自动恢复，等待用户点击“加载历史批次任务”
    else {
      autoCollectHistoryTask = task;
      autoCollectTask = null;
      autoCollectStopped = false;
      autoCollectPaused = false;
      autoCollectRunning = false;
      autoCollectLoopRunning = false;
      autoCollectRunStuck = false;
      autoCollectLastKnownStep = 0;
      setAutoCollectErrorText('');
      updateAutoCollectControls(false, false);
      updateAutoCollectStatusDetails();
      updateExploreControls(null);
    }
  } catch (e) {
    console.error('[AutoCollect] Failed to restore state:', e);
  }
}

/**
 * 渲染批次队列
 */
function renderAutoCollectQueue() {
  const container = elements.autoCollectQueueList;
  const statsEl = elements.autoCollectQueueStats;
  if (!container) return;

  const task = autoCollectTask;
  if (!task || !task.batches || task.batches.length === 0) {
    container.innerHTML = '<div class="empty-list-hint">暂无任务</div>';
    if (statsEl) statsEl.textContent = '—';
    return;
  }

  // 按轮次分组
  const roundMap = new Map();
  for (const batch of task.batches) {
    const round = batch.roundIndex || 1;
    if (!roundMap.has(round)) {
      roundMap.set(round, []);
    }
    roundMap.get(round).push(batch);
  }

  // 渲染统计
  const completedCount = task.completedBatches?.length || 0;
  const totalCount = task.batches.length;
  if (statsEl) {
    statsEl.textContent = `${completedCount}/${totalCount} 批次`;
  }

  // 渲染队列列表
  let html = '';
  for (const [round, batches] of roundMap) {
    const roundCompleted = batches.filter(b => b.status === 'completed').length;
    const roundRunning = batches.some(b => b.status === 'in_progress');
    const roundStatus = roundCompleted === batches.length ? 'completed' : (roundRunning ? 'running' : 'pending');

    html += `<div class="queue-round">
      <div class="queue-round-header ${roundStatus}">
        <span>第 ${round} 轮</span>
        <span>${roundCompleted}/${batches.length}</span>
      </div>`;

    for (const batch of batches) {
      const statusIcon = batch.status === 'completed' ? '✅' :
                         batch.status === 'in_progress' ? '🔄' :
                         batch.status === 'failed' ? '❌' : '⏳';
      const siteCount = batch.stats?.discoveredSites || 0;
      const sourceUrl = batch.sourceUrl ? truncateUrl(batch.sourceUrl, 35) : '—';

      html += `<div class="queue-batch-item ${batch.status}">
        <span class="queue-batch-status status-${batch.status}">${statusIcon}</span>
        <span class="queue-batch-url" title="${batch.sourceUrl || ''}">${sourceUrl}</span>
        <span class="queue-batch-count">${siteCount} 站点</span>
      </div>`;
    }

    html += '</div>';
  }

  container.innerHTML = html;
}
