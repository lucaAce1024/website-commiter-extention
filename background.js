// Background service worker for Navigation Site Auto Submitter
// Handles extension lifecycle and cross-tab communication

const FILL_FIELD_MENU_ID = 'nav-submitter-fill-single';
const FILL_FIELD_ITEMS = [
  { id: 'siteUrl', title: '网站 URL' },
  { id: 'siteName', title: '网站名称' },
  { id: 'email', title: '联系邮箱' },
  { id: 'category', title: '分类 (Categories)' },
  { id: 'tags', title: '标签 (Tags)' },
  { id: 'tagline', title: '标语/口号' },
  { id: 'shortDescription', title: '简短描述' },
  { id: 'longDescription', title: '详细描述 / Introduction' },
  { id: 'logo', title: 'Logo' },
  { id: 'screenshot', title: '界面截图' }
];

function buildContextMenu() {
  const contexts = ['page', 'editable'];
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: FILL_FIELD_MENU_ID,
      title: '填充单个字段 (外链提交助手)',
      contexts
    });
    FILL_FIELD_ITEMS.forEach((item) => {
      chrome.contextMenus.create({
        id: `fill_${item.id}`,
        parentId: FILL_FIELD_MENU_ID,
        title: item.title,
        contexts
      });
    });
  });
}

// Initialize default storage on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize default storage structure
    await chrome.storage.local.set({
      sites: [],              // Site profiles
      navSites: [],           // Navigation sites list
      fieldMappings: {},      // Cached field mappings by domain
      submissionRecords: {},  // Submission records: { siteId_navSiteId: { ... } }
      settings: {
        currentSiteId: null,  // Currently selected site
        llmConfig: {
          enabled: false,
          endpoint: '',
          apiKey: '',
          model: 'gpt-3.5-turbo'
        },
        autoSubmit: false     // Global auto-submit toggle
      }
    });
    console.log('[Background] Extension installed, default storage initialized');
  }
  buildContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  buildContextMenu();
});

// 脚本加载时也创建一次（重载扩展后右键菜单会立即出现）
buildContextMenu();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.menuItemId || String(info.menuItemId).indexOf('fill_') !== 0) return;
  const standardField = String(info.menuItemId).replace(/^fill_/, '');
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'fillSingleField', standardField }).catch(() => {});
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillForm') {
    // Forward to content script if needed
    sendResponse({ success: true });
  } else if (request.action === 'getStorageData') {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ success: true, data });
    });
    return true; // Keep message channel open for async response
  } else if (request.action === 'aiRecognizeForm') {
    // AI 识别表单字段 - 由 background 调用 LLM API，sender.tab.id 用于把日志打到页面 Console
    const tabId = sender.tab?.id;
    let responded = false;
    const safeSend = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (e) {
        console.warn('[Background] sendResponse 已关闭:', e.message);
      }
    };
    handleAIRecognizeForm(request.formMetadata, tabId)
      .then(result => safeSend({ success: true, result }))
      .catch(error => safeSend({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});

/**
 * 将 AI 过程日志同时打到页面 Console（用户在看的是页面 DevTools）
 * @param {number|undefined} tabId - 发起 AI 识别的标签页 id
 * @param {'log'|'warn'|'error'} level
 * @param {...*} args - 同 console.log
 */
function aiLogToPage(tabId, level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn('[Background]', ...args);
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { action: 'aiLog', level, args }).catch(() => {});
  }
}

/**
 * 调用 GLM API 进行表单字段识别
 * @param {Object} formMetadata - 表单元数据
 * @param {number} [tabId] - 发起请求的标签页 id，用于把日志打到页面 Console
 * @returns {Promise<Array>} 字段映射数组
 */
async function handleAIRecognizeForm(formMetadata, tabId) {
  const log = (...a) => aiLogToPage(tabId, 'log', ...a);
  const logErr = (...a) => aiLogToPage(tabId, 'error', ...a);

  // 获取 LLM 配置
  const storage = await chrome.storage.local.get(['settings']);
  const llmConfig = storage.settings?.llmConfig;

  if (!llmConfig?.enabled || !llmConfig?.apiKey) {
    throw new Error('LLM 未启用或 API Key 未配置');
  }

  // 构建精简的表单描述
  const formDescription = buildCompactFormDescription(formMetadata);

  // 构建 Prompt
  const prompt = buildAIPrompt(formDescription, formMetadata);

  // 调用 GLM API
  const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
  const model = llmConfig.model || 'glm-4.7';

  log('AI 识别请求开始:', { endpoint, model, fieldCount: formMetadata.fields?.length });
  log('AI 请求 user message 长度:', prompt.length, '字符');

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: '你是一个有用的AI助手。' },
      { role: 'user', content: prompt }
    ],
    stream: false,
    temperature: 1.0,
    max_tokens: 4096
  };
  log('AI 请求 body (发送给接口的完整 JSON):', JSON.stringify(requestBody, null, 2));
  log('AI 请求 user message 全文:', prompt);

  const controller = new AbortController();
  const timeoutMs = 60000; // 60 秒，避免 GLM 识别表单时超时
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    log('AI 收到响应:', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      logErr('AI API 错误响应 body:', errorText);
      throw new Error(`API 错误 ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message || {};
    log('AI 原始返回:', {
      hasChoices: !!data.choices,
      choicesLength: data.choices?.length,
      usage: data.usage || null,
      hasReasoningContent: !!msg.reasoning_content
    });

    if (!data.choices || data.choices.length === 0) {
      logErr('AI 返回格式无效, 完整 data:', data);
      throw new Error('API 返回格式无效');
    }

    // GLM 思考模型：最终答案在 content，推理过程在 reasoning_content；若 content 为空则从 reasoning_content 提取
    let content = (msg.content && String(msg.content).trim()) || '';
    const reasoningContent = (msg.reasoning_content && String(msg.reasoning_content)) || '';
    if (!content && reasoningContent) {
      log('AI content 为空，从 reasoning_content 提取映射');
      content = extractMappingsFromReasoning(reasoningContent);
      log('AI 从 reasoning 提取的文本:', content);
    }
    log('AI 返回内容 (content):', content);

    // 解析 AI 返回的 JSON 或「Index N -> standardField」文本（空或无效时返回 []，不抛错）
    const mappings = parseAIResponse(content, formMetadata);
    if (mappings.length === 0 && content.trim()) {
      logErr('解析 AI 响应失败或未得到有效映射, 原始 content:', content);
    }
    log('AI 解析后的映射:', mappings);
    log('AI 识别完成:', { mappingCount: mappings.length });

    return mappings;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`AI 请求超时（${timeoutMs / 1000}秒）`);
    }

    logErr('AI 识别失败:', error);
    throw error;
  }
}

/**
 * 构建精简的表单描述（减少 token 消耗）
 */
function buildCompactFormDescription(formMetadata) {
  if (!formMetadata?.fields) return '';

  const fieldDescs = formMetadata.fields.map((field, index) => {
    const parts = [`[${index}] type=${field.type || 'text'}`];

    if (field.name) parts.push(`name="${field.name}"`);
    if (field.id) parts.push(`id="${field.id}"`);
    if (field.label) parts.push(`label="${field.label.slice(0, 50)}"`); // 限制标签长度
    if (field.placeholder) parts.push(`placeholder="${field.placeholder.slice(0, 50)}"`);
    if (field.ariaLabel) parts.push(`aria-label="${field.ariaLabel.slice(0, 50)}"`);

    // 对于 select，只列出前 10 个选项
    if (field.options && field.options.length > 0) {
      const opts = field.options.slice(0, 10).map(o => o.text).join(', ');
      parts.push(`options=[${opts}${field.options.length > 10 ? '...' : ''}]`);
    }

    return parts.join(' ');
  });

  return fieldDescs.join('\n');
}

/**
 * 构建 AI Prompt。若 formMetadata.formHtml 存在则优先用 HTML 片段，便于模型直接理解结构。
 * 输出要求：仅一个 JSON 数组，便于解析、减少空响应。
 */
function buildAIPrompt(formDescription, formMetadata) {
  const standardList = `siteName,email,siteUrl,category,tags,tagline,shortDescription,longDescription,logo,screenshot,unknown`;
  const formHtml = formMetadata?.formHtml;
  const body = formHtml
    ? `以下是一段表单的 HTML 片段，请识别其中的可填写字段（input/textarea/select，按在 HTML 中出现的顺序），并映射到标准类型。\n\n标准类型（任选其一）: ${standardList}\n\nHTML:\n${formHtml}`
    : `以下为表单字段列表（每行 [索引] 类型与属性），请将每项映射到标准类型。\n\n标准类型: ${standardList}\n\n字段列表:\n${formDescription}`;

  const indexHint = formHtml
    ? 'fieldIndex 按 HTML 中 input/textarea/select 出现顺序从 0 开始编号。'
    : 'fieldIndex 与上面字段列表的索引一致（从 0 开始）。';

  return `${body}

请只输出一个 JSON 数组，不要任何 markdown、解释或多余文字。每项格式: {"fieldIndex": 0, "standardField": "siteName", "confidence": 0.9}
${indexHint} 无法识别的用 "standardField": "unknown"。`;
}

/**
 * 从 GLM reasoning_content 中提取映射：先尝试找 JSON 数组，否则解析 "Index N -> standardField" 行
 * @returns {string} 可被 parseAIResponse 解析的 JSON 数组字符串
 */
function extractMappingsFromReasoning(reasoningContent) {
  if (!reasoningContent || typeof reasoningContent !== 'string') return '';

  const text = reasoningContent.trim();
  const validFields = ['siteName', 'email', 'siteUrl', 'category', 'tags', 'tagline', 'shortDescription', 'longDescription', 'logo', 'screenshot', 'unknown'];

  // 1. 尝试直接找到 JSON 数组
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr) && arr.length > 0 && arr.some(x => x.fieldIndex != null && x.standardField)) {
        return jsonMatch[0];
      }
    } catch (_) {}
  }

  // 2. 解析 "Index N : ... -> standardField" 或 "*Index N*: ... -> `siteName`"（中间可能含 HTML 与 >）
  const indexFieldRe = /\*?\s*Index\s*(\d+)\s*\*?[\s\S]*?->\s*[`']?(\w+)[`']?/gi;
  const pairs = [];
  let m;
  while ((m = indexFieldRe.exec(text)) !== null) {
    const fieldIndex = parseInt(m[1], 10);
    const standardField = m[2];
    if (!validFields.includes(standardField)) continue;
    pairs.push({ fieldIndex, standardField, confidence: 0.9 });
  }
  if (pairs.length > 0) {
    return JSON.stringify(pairs);
  }

  return '';
}

/**
 * 解析 AI 返回的 JSON。空内容或无效 JSON 时返回 []，由调用方回退到关键词匹配。
 */
function parseAIResponse(content, formMetadata) {
  if (content == null || typeof content !== 'string') return [];
  let jsonStr = content.trim();
  if (!jsonStr) return [];

  try {
    // 移除可能的 markdown 代码块标记
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    jsonStr = jsonStr.replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!jsonStr) return [];

    // 尝试找到 JSON 数组
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    } else {
      return [];
    }

    const aiMappings = JSON.parse(jsonStr);
    if (!Array.isArray(aiMappings)) return [];
    const result = [];

    for (const mapping of aiMappings) {
      const fieldIndex = mapping.fieldIndex;
      const field = formMetadata.fields[fieldIndex];

      if (!field) continue;

      // 跳过 unknown 类型
      if (mapping.standardField === 'unknown') continue;

      // 验证标准字段类型
      const validFields = ['siteName', 'email', 'siteUrl', 'category', 'tags', 'tagline', 'shortDescription', 'longDescription', 'logo', 'screenshot'];
      if (!validFields.includes(mapping.standardField)) continue;

      result.push({
        locator: field.locator,
        standardField: mapping.standardField,
        confidence: mapping.confidence || 0.8,
        method: 'ai',
        xpath: field.xpath,
        locatorDesc: field.locatorDesc
      });
    }

    return result;
  } catch (e) {
    console.warn('[Background] 解析 AI 响应失败，将回退关键词匹配:', e.message, '原始内容长度:', content.length);
    return [];
  }
}

// Handle extension icon click (already handled by popup)
// chrome.action.onClicked.addListener((tab) => { ... });
