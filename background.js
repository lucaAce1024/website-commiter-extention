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
    // AI 识别表单字段 - 由 background 调用 LLM API
    handleAIRecognizeForm(request.formMetadata)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});

/**
 * 调用 GLM API 进行表单字段识别
 * @param {Object} formMetadata - 表单元数据
 * @returns {Promise<Array>} 字段映射数组
 */
async function handleAIRecognizeForm(formMetadata) {
  // 获取 LLM 配置
  const storage = await chrome.storage.local.get(['settings']);
  const llmConfig = storage.settings?.llmConfig;

  if (!llmConfig?.enabled || !llmConfig?.apiKey) {
    throw new Error('LLM 未启用或 API Key 未配置');
  }

  // 构建精简的表单描述
  const formDescription = buildCompactFormDescription(formMetadata);

  // 构建 Prompt
  const prompt = buildAIPrompt(formDescription);

  // 调用 GLM API
  const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
  const model = llmConfig.model || 'glm-4.7';

  console.log('[Background] AI 识别请求开始:', { endpoint, model, fieldCount: formMetadata.fields?.length });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmConfig.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是一个表单字段识别专家。你的任务是分析网页表单字段，并将它们映射到标准字段类型。请只返回 JSON 格式的结果，不要包含任何其他文字。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 错误 ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('API 返回格式无效');
    }

    const content = data.choices[0].message.content;
    console.log('[Background] AI 返回内容:', content);

    // 解析 AI 返回的 JSON
    const mappings = parseAIResponse(content, formMetadata);

    console.log('[Background] AI 识别完成:', { mappingCount: mappings.length });

    return mappings;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('AI 请求超时（10秒）');
    }

    console.error('[Background] AI 识别失败:', error);
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
 * 构建 AI Prompt
 */
function buildAIPrompt(formDescription) {
  return `请分析以下表单字段，并将每个字段映射到最合适的标准字段类型。

标准字段类型列表:
- siteName: 网站名称/产品名称/项目名称
- email: 联系邮箱/电子邮件
- siteUrl: 网站 URL/网址/链接
- category: 分类/类别
- tags: 标签
- tagline: 标语/口号/一句话介绍
- shortDescription: 简短描述/简介/摘要
- longDescription: 详细描述/完整介绍
- logo: Logo 图标上传
- screenshot: 界面截图/预览图上传
- unknown: 无法识别的字段

表单字段列表:
${formDescription}

请返回一个 JSON 数组，格式如下:
[
  {"fieldIndex": 0, "standardField": "siteName", "confidence": 0.9},
  {"fieldIndex": 1, "standardField": "email", "confidence": 0.95},
  ...
]

注意:
1. fieldIndex 是字段在上述列表中的索引（从 0 开始）
2. confidence 是你对这个映射的置信度（0-1 之间）
3. 只返回 JSON 数组，不要包含任何其他文字
4. 如果某个字段不符合任何标准类型，使用 "unknown"`;
}

/**
 * 解析 AI 返回的 JSON
 */
function parseAIResponse(content, formMetadata) {
  try {
    // 尝试提取 JSON 数组
    let jsonStr = content.trim();

    // 移除可能的 markdown 代码块标记
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    jsonStr = jsonStr.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    // 尝试找到 JSON 数组
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const aiMappings = JSON.parse(jsonStr);
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
    console.error('[Background] 解析 AI 响应失败:', e, '原始内容:', content);
    throw new Error('解析 AI 响应失败: ' + e.message);
  }
}

// Handle extension icon click (already handled by popup)
// chrome.action.onClicked.addListener((tab) => { ... });
