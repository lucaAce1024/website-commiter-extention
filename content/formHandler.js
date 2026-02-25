/**
 * Content Script - Form Handler
 * Runs on every page to detect and fill navigation site submission forms
 */

// Console tag for debugging
const TAG = '[NavSubmitter]';

/** 字段填充时间隔离：每填完一个字段后等待的毫秒数，保证同一时间只填充一个字段 */
const FILL_FIELD_DELAY_MS = 280;

// State for current page
let pageState = {
  hasForm: false,
  formMetadata: null,
  fieldMappings: null,
  domain: null,
  recognitionStatus: 'idle', // idle, recognizing, done, failed
  recognitionMethod: null
};

/** 右键菜单打开时记录的目标元素，用于「剪切板填充」：在哪个输入框右键就填哪个 */
let lastContextMenuTarget = null;
document.addEventListener('contextmenu', (e) => {
  lastContextMenuTarget = getEditableElementFromTarget(e.target);
}, true);

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'detectForm') {
    const result = detectForm();
    sendResponse({ success: true, result });
  } else if (request.action === 'fillForm') {
    fillForm(request.siteId)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  } else if (request.action === 'getPageState') {
    sendResponse({ success: true, state: pageState });
  } else if (request.action === 'recognizeForm') {
    recognizeForm(request.useLlm)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'clearMapping') {
    clearMapping().then(() => sendResponse({ success: true }));
    return true; // 异步响应
  } else if (request.action === 'fillSingleField') {
    fillSingleField(request.standardField)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'aiLog') {
    // 把 Background 的 AI 过程日志打到当前页 Console，方便在页面 DevTools 查看
    const level = request.level || 'log';
    const args = request.args || [];
    if (level === 'error') {
      console.error(`${TAG} [AI]`, ...args);
    } else if (level === 'warn') {
      console.warn(`${TAG} [AI]`, ...args);
    } else {
      console.log(`${TAG} [AI]`, ...args);
    }
    return false;
  }
});

/**
 * Detect if page has a submission form
 */
function detectForm() {
  const forms = document.querySelectorAll('form');
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');

  pageState.domain = window.location.hostname;
  pageState.hasForm = inputs.length > 0;

  return {
    hasForm: pageState.hasForm,
    inputCount: inputs.length,
    formCount: forms.length,
    url: window.location.href,
    domain: pageState.domain
  };
}

/**
 * 生成元素的 XPath（用于日志与调试）
 */
function getXPath(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  const parts = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    const tag = current.tagName.toLowerCase();
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName && sibling.tagName.toLowerCase() === tag) index++;
      sibling = sibling.previousElementSibling;
    }
    const id = current.id && /^[a-zA-Z][\w-]*$/.test(current.id) ? current.id : null;
    const part = id ? `*[@id="${id}"]` : `${tag}[${index}]`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.length ? '//' + parts.join('/') : '';
}

/**
 * 将 locator 对象格式化为可读的定位描述（用于日志）
 */
function formatLocator(locator) {
  if (!locator) return '';
  switch (locator.type) {
    case 'id': return `id="${locator.value}"`;
    case 'name': return `name="${locator.value}" (formIndex=${locator.formIndex ?? 0})`;
    case 'data': return `data-name/data-field="${locator.value}"`;
    case 'index': return `index: ${locator.parentTag}[${locator.parentIndex}] > input/textarea/select[${locator.fieldIndex}]`;
    case 'xpath': return `XPath ${locator.value}`;
    default: return JSON.stringify(locator);
  }
}

/**
 * Get form metadata for recognition
 */
function getFormMetadata() {
  // Import form recognizer functions
  // Since we can't use ES6 imports in content script directly, we'll inline the key functions
  const forms = document.querySelectorAll('form');
  const fields = [];

  forms.forEach((form, formIndex) => {
    const inputs = form.querySelectorAll('input, textarea, select');

    inputs.forEach((input, index) => {
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(input.type)) {
        return;
      }
      // 跳过 SimpleMDE 的隐藏 textarea（style="display: none;" 且 id 包含 "simplemde" 或 "easymde"）
      if (input.tagName === 'TEXTAREA' && input.style.display === 'none' &&
          /simplemde|easymde/i.test(input.id)) {
        return;
      }
      // 包含 type="file"（Logo/截图上传框），便于识别并自动填入

      const label = getFieldLabel(input);
      const locator = getFieldLocator(input);

      const fieldInfo = {
        locator,
        xpath: getXPath(input),
        locatorDesc: formatLocator(locator),
        type: input.type || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName.toLowerCase()),
        name: input.name || input.dataset?.name || input.dataset?.field || '',
        id: input.id || '',
        placeholder: input.placeholder || '',
        label: label || '',
        ariaLabel: input.getAttribute('aria-label') || '',
        required: input.required || false
      };

      if (input.tagName === 'SELECT') {
        fieldInfo.options = Array.from(input.options).map(opt => ({
          value: opt.value,
          text: opt.text.trim()
        })).filter(opt => opt.text);
      }

      if (input.tagName === 'TEXTAREA') {
        fieldInfo.isTextarea = true;
      }

      fields.push(fieldInfo);
    });

    // 收集「Short Description」等由 label 关联的 contenteditable/ProseMirror（如 auraplusplus）
    const shortDescLabelPatterns = [/short\s*description/i, /brief\s*description/i, /short\s*desc/i, /简介/i, /简述/i];
    form.querySelectorAll('label').forEach((labelEl) => {
      const labelText = labelEl.textContent.trim();
      if (!shortDescLabelPatterns.some(re => re.test(labelText))) return;
      if (fields.some(f => f.standardFieldHint === 'shortDescription')) return;
      let control = labelEl.htmlFor ? document.getElementById(labelEl.htmlFor) : null;
      if (!control) control = labelEl.parentElement?.querySelector(`[id="${labelEl.htmlFor}"]`);
      if (!control) control = labelEl.nextElementSibling;
      if (!control) return;
      const editable = control.getAttribute?.('contenteditable') === 'true' ? control : control.querySelector?.('[contenteditable="true"], .ProseMirror');
      if (!editable) return;
      const xpath = getXPath(editable);
      if (!xpath) return;
      fields.push({
        locator: { type: 'xpath', value: xpath },
        xpath,
        locatorDesc: `contenteditable(Short Description): ${xpath}`,
        type: 'contenteditable',
        name: labelEl.htmlFor || '',
        id: editable.id || '',
        placeholder: '',
        label: labelText,
        ariaLabel: '',
        required: /required|\*/.test(labelText) || !!labelEl.querySelector('.text-red-500'),
        standardFieldHint: 'shortDescription'
      });
    });

    // 收集「Categories」「Tags」等由 label 关联的自定义下拉（非原生 select），如 navfolders 等
    const labelsInForm = form.querySelectorAll('label');
    const customSelectLabels = [
      { re: /categories?/i, label: 'Categories' },
      { re: /tags?/i, label: 'Tags' }
    ];
    const hasNativeSelectFor = (labelText) => {
      const lower = (labelText || '').toLowerCase();
      if (lower.includes('categor')) return fields.some(f => f.type === 'select-one' && (f.label || '').toLowerCase().includes('categor'));
      if (lower.includes('tag') && !lower.includes('tagline')) return fields.some(f => f.type === 'select-one' && (f.label || '').toLowerCase().includes('tag'));
      return false;
    };
    const addedCustomLabels = new Set();
    labelsInForm.forEach((labelEl) => {
      const labelText = labelEl.textContent.trim();
      const pair = customSelectLabels.find(p => p.re.test(labelText));
      if (!pair || hasNativeSelectFor(labelText)) return;
      if (pair.label === 'Tags' && /tagline/i.test(labelText)) return;
      const labelKey = (pair.label || labelText).toLowerCase();
      if (addedCustomLabels.has(labelKey)) return;
      let control = null;
      if (labelEl.htmlFor) control = form.querySelector(`#${CSS.escape(labelEl.htmlFor)}`) || document.getElementById(labelEl.htmlFor);
      if (!control) control = labelEl.nextElementSibling;
      if (!control && labelEl.parentElement) {
        const sibling = labelEl.parentElement.querySelector(':scope > [role="combobox"], :scope > [role="listbox"], :scope > button, :scope > [data-headlessui-state], :scope > div');
        if (sibling && sibling !== labelEl) control = sibling;
      }
      if (!control && labelEl.parentElement) {
        const children = Array.from(labelEl.parentElement.children);
        const idx = children.indexOf(labelEl);
        if (idx >= 0 && idx < children.length - 1) control = children[idx + 1];
      }
      if (!control && labelEl.parentElement && (labelEl.parentElement.getAttribute('role') === 'combobox' || labelEl.parentElement.getAttribute('role') === 'listbox'))
        control = labelEl.parentElement;
      if (control && control.tagName !== 'SELECT' && control.tagName !== 'TEXTAREA' &&
          (control.tagName !== 'INPUT' || control.type === 'hidden')) {
        const xpath = getXPath(control);
        if (!xpath) return;
        addedCustomLabels.add(labelKey);
        fields.push({
          locator: { type: 'xpath', value: xpath },
          xpath,
          locatorDesc: formatLocator({ type: 'xpath', value: xpath }),
          type: 'custom-select',
          name: '',
          id: control.id || '',
          placeholder: '',
          label: pair.label,
          ariaLabel: control.getAttribute('aria-label') || '',
          required: false,
          isCustomSelect: true
        });
      }
    });
  });

  // Also check for forms not in <form> tags
  if (fields.length === 0) {
    const allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select');
    allInputs.forEach((input, index) => {
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(input.type)) {
        return;
      }

      const label = getFieldLabel(input);
      const locator = getFieldLocator(input);

      fields.push({
        locator,
        xpath: getXPath(input),
        locatorDesc: formatLocator(locator),
        type: input.type || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName.toLowerCase()),
        name: input.name || input.dataset?.name || input.dataset?.field || '',
        id: input.id || '',
        placeholder: input.placeholder || '',
        label: label || '',
        ariaLabel: input.getAttribute('aria-label') || '',
        required: input.required || false
      });
    });
  }

  // 可选：供 AI 识别的表单 HTML 片段（截断以控制 token），便于模型直接理解结构
  const firstForm = document.querySelector('form');
  const formHtml = firstForm ? firstForm.outerHTML.slice(0, 12000) : '';

  return {
    hasForm: fields.length > 0,
    fields,
    url: window.location.href,
    domain: window.location.hostname,
    formHtml: formHtml || undefined
  };
}

/**
 * Get label text for a field
 */
function getFieldLabel(input) {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) return label.textContent.trim();
  }

  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel.textContent.replace(input.value, '').trim();
  }

  let prev = input.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'LABEL') {
      return prev.textContent.trim();
    }
    if (prev.textContent && prev.textContent.trim().length > 0 && prev.textContent.trim().length < 100) {
      return prev.textContent.trim();
    }
    prev = prev.previousElementSibling;
  }

  const parent = input.parentElement;
  if (parent) {
    const parentPrev = parent.previousElementSibling;
    if (parentPrev && parentPrev.textContent && parentPrev.textContent.trim().length < 100) {
      return parentPrev.textContent.trim();
    }
  }

  // Some forms put label text in the next sibling (e.g. <input /><span>Website URL</span>)
  let next = input.nextElementSibling;
  while (next) {
    const t = next.textContent && next.textContent.trim();
    if (t && t.length > 0 && t.length < 100) return t;
    next = next.nextElementSibling;
  }

  // 同一父节点内的 label（如 findly：<div><label>Logo</label><div>拖拽区</div><input type="file"></div>）
  const parentEl = input.parentElement;
  if (parentEl) {
    const labelInParent = parentEl.querySelector('label');
    if (labelInParent) {
      const t = labelInParent.textContent.trim();
      if (t.length > 0 && t.length < 100) return t;
    }
  }

  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  if (input.placeholder) return input.placeholder;

  return '';
}

/**
 * Get stable locator for DOM element
 */
function getFieldLocator(input) {
  if (input.id) {
    return { type: 'id', value: input.id };
  }

  if (input.name) {
    const form = input.closest('form');
    const formId = form?.id || form?.name;
    return {
      type: 'name',
      value: input.name,
      formIndex: Array.from(document.querySelectorAll('form')).indexOf(form)
    };
  }

  if (input.dataset.name || input.dataset.field) {
    return {
      type: 'data',
      value: input.dataset.name || input.dataset.field
    };
  }

  const parent = input.parentElement;
  const index = Array.from(parent.querySelectorAll('input, textarea, select')).indexOf(input);
  return {
    type: 'index',
    parentTag: parent.tagName,
    parentIndex: Array.from(document.querySelectorAll(parent.tagName)).indexOf(parent),
    fieldIndex: index
  };
}

/**
 * Find element by locator
 */
function findElementByLocator(locator) {
  switch (locator.type) {
    case 'id':
      return document.getElementById(locator.value);

    case 'name': {
      const forms = document.querySelectorAll('form');
      const form = forms[locator.formIndex];
      if (form) {
        return form.querySelector(`[name="${locator.value}"]`);
      }
      return document.querySelector(`[name="${locator.value}"]`);
    }

    case 'data':
      if (locator.value.startsWith('name=')) {
        return document.querySelector(`[data-name="${locator.value.substring(5)}"]`);
      }
      return document.querySelector(`[data-field="${locator.value}"]`);

    case 'index': {
      const parents = document.querySelectorAll(locator.parentTag);
      const parent = parents[locator.parentIndex];
      if (parent) {
        const inputs = parent.querySelectorAll('input, textarea, select');
        return inputs[locator.fieldIndex];
      }
      return null;
    }

    case 'xpath': {
      try {
        const result = document.evaluate(locator.value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue;
      } catch (_) {
        return null;
      }
    }

    default:
      return null;
  }
}

/**
 * Recognize form using keyword matching (no LLM needed)
 */
function recognizeByKeywords(formMetadata) {
  const FIELD_KEYWORDS = {
    siteName: {
      keywords: ['site', 'name', 'title', 'website', 'webname', 'sitename', '网站名', '站点名', '网站名称'],
      weights: { name: 3, title: 2, placeholder: 1, label: 2 }
    },
    email: {
      keywords: ['email', 'mail', 'contact', '邮箱', '联系邮箱', '联系邮件'],
      type: 'email',
      weights: { type: 3, name: 2, placeholder: 1 }
    },
    siteUrl: {
      // Include "website url" / "web url" phrases so "Website URL" label matches clearly over siteName
      keywords: ['website url', 'web url', 'site url', 'url', 'website', 'link', 'href', 'site', '网址', '网站地址', '链接', 'siteurl', 'websiteurl', 'homepage', 'home page'],
      type: 'url',
      weights: { type: 2, name: 2, placeholder: 1, label: 2 }
    },
    category: {
      keywords: ['category', 'categories', 'cat', 'type', 'class', '分类', '类别', '类型'],
      isSelect: true,
      weights: { name: 2, label: 2 }
    },
    tags: {
      keywords: ['tag', 'tags', '标签'],
      isSelect: true,
      weights: { name: 2, label: 2 }
    },
    tagline: {
      keywords: ['tagline', 'slogan', 'motto', 'tag', '标语', '口号'],
      weights: { name: 2, placeholder: 1 }
    },
    shortDescription: {
      keywords: ['short', 'desc', 'description', 'summary', 'intro', 'brief', 'introduction', '简介', '简述', '描述', 'shortdesc'],
      weights: { name: 2, placeholder: 1, label: 2 }
    },
    longDescription: {
      keywords: ['long', 'detail', 'description', 'content', 'about', 'info', 'introduction', '详细', '介绍', '描述', '详情'],
      isTextarea: true,
      weights: { name: 2, placeholder: 1, label: 2 }
    },
    logo: {
      keywords: ['logo', 'icon', 'image', 'favicon', '图标', '标志'],
      type: 'url',
      isFileInput: true, // type="file" 的上传框也参与匹配
      weights: { name: 2, placeholder: 1, label: 2 }
    },
    screenshot: {
      keywords: ['screenshot', 'shot', 'capture', 'screen', 'preview', 'image', '截图', '预览图', 'app image', 'appimage', 'app-image', '界面截图', '应用截图', 'product image', 'productimage', 'product-image'],
      type: 'url',
      isFileInput: true,
      weights: { name: 2, placeholder: 1, label: 2 }
    }
  };

  const matches = [];

  for (const field of formMetadata.fields) {
    const scores = {};
    const nameLower = (field.name || '').toLowerCase();
    const labelLower = (field.label || '').toLowerCase();
    const placeholderLower = (field.placeholder || '').toLowerCase();
    const ariaLabelLower = (field.ariaLabel || '').toLowerCase();
    const idLower = (field.id || '').toLowerCase();

    for (const [standardField, config] of Object.entries(FIELD_KEYWORDS)) {
      let score = 0;

      if (config.type && field.type === config.type) {
        score += config.weights.type * 2;
      }
      if (config.isTextarea && field.isTextarea) {
        score += 3;
      }
      if (config.isSelect && (field.type === 'select-one' || field.type === 'custom-select')) {
        score += 3;
      }
      if (config.isFileInput && field.type === 'file') {
        score += 4; // 文件上传框可匹配 logo / screenshot
      }
      if (field.type === 'contenteditable' && standardField === 'shortDescription') {
        score += 5; // contenteditable 常为 Short Description（如 auraplusplus）
      }

      for (const kw of config.keywords) {
        const k = kw.toLowerCase();
        if (nameLower.includes(k)) score += config.weights.name || 1;
        if (labelLower.includes(k)) score += config.weights.label || 1;
        if (placeholderLower.includes(k)) score += config.weights.placeholder || 1;
        // shadcn/Radix 等常用 aria-label 作为可访问标签，findly 等站点可能只有此处有 "Website URL"
        if (ariaLabelLower.includes(k)) score += (config.weights.label || 1) * 1.2;
        if (idLower.includes(k)) score += config.weights.name || 1;
      }
      // 若 placeholder/label 已带 https:// 前缀，说明是 URL 输入框，优先识别为 siteUrl
      if (standardField === 'siteUrl') {
        const hint = (placeholderLower + ' ' + labelLower + ' ' + ariaLabelLower).trim();
        if (/^https?:\/\//.test(hint) || hint.includes('://')) score += 4;
      }
      // navfolders 等：Introduction 作为 markdown/长文案框时映射到 longDescription，否则才用 shortDescription
      if (labelLower.includes('introduction')) {
        if (field.isTextarea) {
          if (standardField === 'longDescription') score += 6;
        } else {
          if (standardField === 'shortDescription') score += 5;
        }
      }

      if (score > 0) {
        scores[standardField] = score;
      }
    }

    // 「App Image」「Product Image」只匹配界面截图，不匹配 Logo
    const hintForExclude = (labelLower + ' ' + nameLower + ' ' + ariaLabelLower).trim();
    if (hintForExclude.includes('app image') || hintForExclude.includes('appimage') ||
        hintForExclude.includes('product image') || hintForExclude.includes('productimage')) {
      delete scores.logo;
    }
    // 仅「Image」无 logo/icon 时归为界面截图（如 navfolders Image 字段）
    if ((/^image\s*[\(\s]?/.test(labelLower) || labelLower.trim() === 'image') && !hintForExclude.includes('logo') && !hintForExclude.includes('icon')) {
      delete scores.logo;
    }
    // id/name 含 image 且不含 logo 时归为界面截图（如 navfolders dropzone-file-image）
    if ((idLower.includes('image') || nameLower.includes('image')) && !idLower.includes('logo') && !nameLower.includes('logo')) {
      delete scores.logo;
    }

    let bestField = null;
    let bestScore = 0;

    for (const [fieldName, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestField = fieldName;
      }
    }

    if (bestScore >= 2) {
      matches.push({
        locator: field.locator,
        standardField: bestField,
        confidence: Math.min(bestScore / 8, 1),
        method: 'keyword',
        xpath: field.xpath,
        locatorDesc: field.locatorDesc
      });
    }
  }

  return matches;
}

/**
 * 将识别结果按「定位 + 标准化字段」打印到控制台，便于调试
 */
function logRecognitionResult(mappings, method) {
  if (!mappings || mappings.length === 0) return;
  console.group(`${TAG} 字段识别结果 (${method})`);
  mappings.forEach((m, i) => {
    const loc = m.xpath ? 'XPath ' + m.xpath : (m.locatorDesc || formatLocator(m.locator));
    console.log(`  ${i + 1}. 定位: ${loc} | 标准化字段: ${m.standardField}`);
  });
  console.groupEnd();
}

/**
 * Recognize form structure
 * 支持 AI 识别和关键词匹配两种方式
 * @param {boolean} useLlm - 是否使用 LLM AI 识别（默认 false，使用关键词匹配）
 */
async function recognizeForm(useLlm = false) {
  if (pageState.recognitionStatus === 'recognizing') {
    return { status: 'already_recognizing' };
  }

  pageState.recognitionStatus = 'recognizing';

  try {
    const formMetadata = getFormMetadata();
    pageState.formMetadata = formMetadata;

    if (!formMetadata.hasForm) {
      pageState.recognitionStatus = 'failed';
      console.info(`${TAG} No form: fields=${formMetadata.fields?.length ?? 0}, url=${formMetadata.url}`);
      return {
        status: 'no_form',
        message: '当前页面未检测到可填表单（若确有表单，可能是动态加载或非标准结构）'
      };
    }

    // 使用 domain + pathname 作为缓存 key（设计文档要求）
    const cacheKey = getCacheKey();

    // Check for cached mapping
    const cached = await getCachedMapping(cacheKey);
    if (cached && cached.length > 0) {
      pageState.fieldMappings = cached;
      pageState.recognitionStatus = 'done';
      pageState.recognitionMethod = 'cache';
      logRecognitionResult(cached, 'cache');
      return {
        status: 'success',
        method: 'cache',
        mappings: cached,
        fieldCount: cached.length
      };
    }

    // 如果启用 LLM，优先尝试 AI 识别
    if (useLlm) {
      try {
        console.log(`${TAG} 尝试 AI 识别...`);
        const aiResult = await callAIRecognize(formMetadata);

        if (aiResult && aiResult.length > 0) {
          pageState.fieldMappings = aiResult;
          pageState.recognitionStatus = 'done';
          pageState.recognitionMethod = 'ai';

          logRecognitionResult(aiResult, 'ai');

          // Cache the result
          await cacheMapping(cacheKey, aiResult);

          return {
            status: 'success',
            method: 'ai',
            mappings: aiResult,
            fieldCount: aiResult.length
          };
        }
      } catch (aiError) {
        console.warn(`${TAG} AI 识别失败，回退到关键词匹配:`, aiError.message);
        // AI 失败，继续使用关键词匹配作为降级方案
      }
    }

    // Do keyword matching (always available as fallback)
    const mappings = recognizeByKeywords(formMetadata);
    if (mappings.length === 0 && formMetadata.fields?.length > 0) {
      const names = formMetadata.fields.map(f => f.name || f.label || f.placeholder || f.id || '(empty)').join(', ');
      console.info(`${TAG} Keyword match 0 fields. Page fields (name/label/placeholder): ${names}`);
    }
    pageState.fieldMappings = mappings;
    pageState.recognitionStatus = 'done';
    pageState.recognitionMethod = 'keyword';

    logRecognitionResult(mappings, 'keyword');

    // Cache the result
    await cacheMapping(cacheKey, mappings);

    return {
      status: 'success',
      method: 'keyword',
      mappings,
      fieldCount: mappings.length
    };

  } catch (error) {
    console.error(`${TAG} Recognition failed:`, error);
    pageState.recognitionStatus = 'failed';
    return {
      status: 'error',
      error: error.message
    };
  }
}

/**
 * 生成缓存 key（domain + pathname）
 */
function getCacheKey() {
  const url = new URL(window.location.href);
  return url.hostname + url.pathname;
}

/**
 * 调用 background script 进行 AI 识别
 */
async function callAIRecognize(formMetadata) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'aiRecognizeForm', formMetadata },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('Background 无响应'));
          return;
        }
        if (!response.success) {
          reject(new Error(response.error || 'AI 识别失败'));
          return;
        }
        resolve(response.result);
      }
    );
  });
}

/**
 * Get cached field mapping for domain
 * Returns the mappings array (stored value may be { mappings, cachedAt } or legacy array)
 */
async function getCachedMapping(domain) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fieldMappings'], (result) => {
      const data = result.fieldMappings?.[domain];
      if (!data) {
        resolve(null);
        return;
      }
      const array = Array.isArray(data) ? data : (data.mappings || null);
      resolve(array);
    });
  });
}

/**
 * Cache field mapping for domain
 */
async function cacheMapping(domain, mappings) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['fieldMappings'], (result) => {
      const mappingsObj = result.fieldMappings || {};
      mappingsObj[domain] = {
        mappings,
        cachedAt: new Date().toISOString()
      };
      chrome.storage.local.set({ fieldMappings: mappingsObj }, () => {
        resolve();
      });
    });
  });
}

/**
 * Clear mapping for current domain + pathname
 */
async function clearMapping() {
  const cacheKey = getCacheKey();
  return new Promise((resolve) => {
    chrome.storage.local.get(['fieldMappings'], (result) => {
      const mappings = result.fieldMappings || {};
      delete mappings[cacheKey];
      chrome.storage.local.set({ fieldMappings: mappings }, () => {
        pageState.fieldMappings = null;
        console.log(`${TAG} 已清除缓存: ${cacheKey}`);
        resolve();
      });
    });
  });
}

/**
 * Fill form with site data
 */
async function fillForm(siteId) {
  // Get site data
  const siteData = await getSiteData(siteId);
  if (!siteData) {
    throw new Error('Site not found or no site selected');
  }

  // Recognize form if not already done
  if (!pageState.fieldMappings) {
    const result = await recognizeForm(false);
    if (result.status !== 'success') {
      throw new Error('Failed to recognize form: ' + (result.message || result.error));
    }
  }

  // Fill each mapped field
  let filledCount = 0;
  const errors = [];

  for (const mapping of pageState.fieldMappings) {
    try {
      // Tags 前多等一会，确保上一个下拉（Categories）已完全关闭、页面稳定
      if (mapping.standardField === 'tags') {
        await new Promise(r => setTimeout(r, 500));
      }

      let element = findElementByLocator(mapping.locator);
      if (!element && mapping.standardField === 'tags') {
        element = findTagsTriggerByLabel();
      }
      if (!element) {
        errors.push(`Could not find element for ${mapping.standardField}`);
        continue;
      }

      let value = siteData[mapping.standardField];
      // Logo 文件上传框：使用站点管理里上传的 logoDataUrl
      if (mapping.standardField === 'logo' && element.type === 'file') {
        const logoDataUrl = siteData.logoDataUrl || value;
        if (logoDataUrl && typeof logoDataUrl === 'string' && logoDataUrl.startsWith('data:')) {
          try {
            fillFileInputWithDataUrl(element, logoDataUrl);
            filledCount++;
            console.log(`${TAG} Filled ${mapping.standardField}: (file from stored image)`);
          } catch (err) {
            errors.push(`Failed to fill logo file: ${err.message}`);
          }
        }
        continue;
      }

      // 界面截图 / App Image 文件上传框：使用站点管理里上传的 screenshotDataUrl
      if (mapping.standardField === 'screenshot' && element.type === 'file') {
        const screenshotDataUrl = siteData.screenshotDataUrl || value;
        if (screenshotDataUrl && typeof screenshotDataUrl === 'string' && screenshotDataUrl.startsWith('data:')) {
          try {
            fillFileInputWithDataUrl(element, screenshotDataUrl);
            filledCount++;
            console.log(`${TAG} Filled ${mapping.standardField}: (file from stored image)`);
          } catch (err) {
            errors.push(`Failed to fill screenshot file: ${err.message}`);
          }
        }
        continue;
      }

      if (!value) {
        // Field not in site data, skip
        continue;
      }

      // Website URL：根据输入框是否已有 https:// 前缀动态决定填完整 URL 还是仅填域名+路径
      if (mapping.standardField === 'siteUrl') {
        value = getUrlValueForInput(element, value);
      }

      // longDescription/Introduction：只填真正的 textarea；若当前是 wrapper 或未找到，用 label 备用查找
      if (mapping.standardField === 'longDescription') {
        if (element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT') {
          const fallbackTa = findIntroductionTextarea();
          if (fallbackTa) element = fallbackTa;
          else { continue; }
        }
      }

      // CodeMirror 编辑器（SimpleMDE 等）
      if (element.classList && element.classList.contains('CodeMirror')) {
        fillCodeMirror(element, value);
        filledCount++;
        console.log(`${TAG} Filled ${mapping.standardField}:`, value);
        await new Promise(r => setTimeout(r, FILL_FIELD_DELAY_MS));
        continue;
      }
      // contenteditable / ProseMirror（如 auraplusplus Short Description）
      if (element.getAttribute?.('contenteditable') === 'true' || element.classList?.contains?.('ProseMirror')) {
        fillContentEditable(element, value);
        filledCount++;
        console.log(`${TAG} Filled ${mapping.standardField}:`, value);
        await new Promise(r => setTimeout(r, FILL_FIELD_DELAY_MS));
        continue;
      }

      // Set value based on element type（含自定义下拉 Categories/Tags）
      if (element.tagName === 'SELECT') {
        fillSelectElement(element, value, siteData);
        filledCount++;
      } else if ((mapping.standardField === 'category' || mapping.standardField === 'tags') && element.tagName !== 'SELECT') {
        const filled = await fillCustomSelect(element, value, siteData, mapping.standardField);
        if (filled) filledCount++;
      } else if (element.tagName === 'TEXTAREA' || element.type === 'text' || element.type === 'url' || element.type === 'email') {
        fillInputElement(element, value);
        filledCount++;
      } else {
        // Try to set value for other types
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
      }

      console.log(`${TAG} Filled ${mapping.standardField}:`, value);
    } catch (error) {
      errors.push(`Failed to fill ${mapping.standardField}: ${error.message}`);
    }
    // 时间隔离：同一时间只填充一个字段，避免下拉/编辑器等未就绪导致错乱
    await new Promise(r => setTimeout(r, FILL_FIELD_DELAY_MS));
  }

  // Check for CAPTCHA
  const hasCaptcha = checkForCaptcha();

  // Record submission
  await recordSubmission(siteId, window.location.hostname, filledCount, errors);

  return {
    filledCount,
    totalFields: pageState.fieldMappings.length,
    errors,
    hasCaptcha
  };
}

/**
 * 从右键事件目标解析出「可填充」的输入元素（input/textarea/contenteditable 或其内部）
 */
function getEditableElementFromTarget(target) {
  if (!target || !target.nodeType || target.nodeType !== Node.ELEMENT_NODE) return null;
  const el = target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    console.log(`${TAG} getEditableElementFromTarget: INPUT/TEXTAREA/SELECT`, el);
    return el;
  }
  if (el.getAttribute?.('contenteditable') === 'true' || el.classList?.contains?.('ProseMirror')) {
    console.log(`${TAG} getEditableElementFromTarget: contenteditable/ProseMirror`, el);
    return el;
  }
  const editable = el.closest?.('[contenteditable="true"], .ProseMirror');
  if (editable) {
    console.log(`${TAG} getEditableElementFromTarget: closest contenteditable/ProseMirror`, editable);
    return editable;
  }
  // 检测 CodeMirror 编辑器（SimpleMDE 等使用）
  const codeMirror = el.closest?.('.CodeMirror');
  if (codeMirror) {
    console.log(`${TAG} getEditableElementFromTarget: closest CodeMirror`, codeMirror);
    return codeMirror;
  }
  console.log(`${TAG} getEditableElementFromTarget: no editable element found, target:`, target);
  return null;
}

/**
 * 右键菜单「填充单个字段」：
 * 1) 若在某个输入框上右键：用剪切板内容填充该输入框（像复制粘贴），并可选写回当前站点配置；
 * 2) 否则：按原逻辑用「已识别表单映射 + 当前站点数据」填充对应字段。
 */
async function fillSingleField(standardField) {
  const el = lastContextMenuTarget;
  lastContextMenuTarget = null;

  // 优先：在可编辑元素上右键 → 用剪切板填充该元素（文字：复制粘贴式）
  if (el && document.contains(el)) {
    const clipboardFilled = await tryFillFromClipboard(el, standardField);
    if (clipboardFilled) return clipboardFilled;
  }

  // 回退：按「识别映射 + 站点数据」填充
  const siteData = await getSiteData(null);
  if (!siteData) {
    throw new Error('请先在选项中配置并选择当前站点');
  }
  if (!pageState.fieldMappings) {
    const result = await recognizeForm(false);
    if (result.status !== 'success') {
      throw new Error('无法识别当前页面表单，请先打开提交页面再试');
    }
  }
  const mappings = pageState.fieldMappings.filter(m => m.standardField === standardField);
  if (mappings.length === 0) {
    throw new Error(`当前页面未识别到「${standardField}」字段`);
  }
  let filledCount = 0;
  const errors = [];
  for (const mapping of mappings) {
    try {
      let element = findElementByLocator(mapping.locator);
      if (!element && standardField === 'tags') element = findTagsTriggerByLabel();
      if (!element) {
        errors.push(`找不到元素: ${standardField}`);
        continue;
      }
      let value = siteData[mapping.standardField];
      if (mapping.standardField === 'logo' && element.type === 'file') {
        const dataUrl = siteData.logoDataUrl || value;
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          fillFileInputWithDataUrl(element, dataUrl);
          filledCount++;
          console.log(`${TAG} [右键] 已填充 ${standardField}`);
        }
        continue;
      }
      if (mapping.standardField === 'screenshot' && element.type === 'file') {
        const dataUrl = siteData.screenshotDataUrl || value;
        if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          fillFileInputWithDataUrl(element, dataUrl);
          filledCount++;
          console.log(`${TAG} [右键] 已填充 ${standardField}`);
        }
        continue;
      }
      if (!value) continue;
      if (mapping.standardField === 'siteUrl') value = getUrlValueForInput(element, value);
      if (mapping.standardField === 'longDescription' && element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT') {
        const fallbackTa = findIntroductionTextarea();
        if (fallbackTa) element = fallbackTa; else continue;
      }
      // CodeMirror 编辑器（SimpleMDE 等）
      if (element.classList && element.classList.contains('CodeMirror')) {
        fillCodeMirror(element, value);
        filledCount++;
        console.log(`${TAG} [右键] 已填充 ${standardField}:`, value);
        continue;
      }
      if (element.getAttribute?.('contenteditable') === 'true' || element.classList?.contains?.('ProseMirror')) {
        fillContentEditable(element, value);
        filledCount++;
        console.log(`${TAG} [右键] 已填充 ${standardField}:`, value);
        continue;
      }
      if (element.tagName === 'SELECT') {
        fillSelectElement(element, value, siteData);
        filledCount++;
      } else if ((mapping.standardField === 'category' || mapping.standardField === 'tags') && element.tagName !== 'SELECT') {
        const filled = await fillCustomSelect(element, value, siteData, mapping.standardField);
        if (filled) filledCount++;
      } else if (element.tagName === 'TEXTAREA' || element.type === 'text' || element.type === 'url' || element.type === 'email') {
        fillInputElement(element, value);
        filledCount++;
      } else {
        element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
      }
      console.log(`${TAG} [右键] 已填充 ${standardField}:`, value);
    } catch (err) {
      errors.push(`${standardField}: ${err.message}`);
    }
  }
  return { filledCount, errors };
}

/**
 * 用剪切板内容填充指定元素（文字）。若为 file 输入则暂不处理图片（后续可扩展）。
 * @returns {Promise<{ filledCount: number, errors: string[] }|null>} 成功填充时返回结果，未填充时返回 null
 */
async function tryFillFromClipboard(element, standardField) {
  // 文件输入：图片剪切板暂不实现，交给后续「按映射+站点数据」逻辑
  if (element.tagName === 'INPUT' && element.type === 'file') {
    return null;
  }

  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    return null;
  }
  if (text == null || (typeof text === 'string' && !text.trim())) return null;

  try {
    // CodeMirror 编辑器（SimpleMDE 等）
    if (element.classList && element.classList.contains('CodeMirror')) {
      fillCodeMirror(element, text);
    } else if (element.getAttribute?.('contenteditable') === 'true' || element.classList?.contains?.('ProseMirror')) {
      fillContentEditable(element, text);
    } else if (element.tagName === 'SELECT') {
      const siteData = await getSiteData(null);
      fillSelectElement(element, text, siteData || {});
    } else if (element.tagName === 'TEXTAREA' || element.type === 'text' || element.type === 'url' || element.type === 'email') {
      const value = standardField === 'siteUrl' ? getUrlValueForInput(element, text) : text;
      fillInputElement(element, value);
    } else {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    console.log(`${TAG} [右键-剪切板] 已填充 ${standardField}`);
    await updateCurrentSiteField(standardField, text);
    return { filledCount: 1, errors: [] };
  } catch (err) {
    console.warn(`${TAG} [右键-剪切板] 填充失败:`, err);
    return null;
  }
}

/**
 * 将当前选中站点的某个字段更新为 value（仅文本类字段），用于与「剪切板填充」同步
 */
async function updateCurrentSiteField(standardField, value) {
  const skipFields = ['logo', 'screenshot'];
  if (skipFields.includes(standardField)) return;
  return new Promise((resolve) => {
    chrome.storage.local.get(['sites', 'settings'], (result) => {
      const currentId = result.settings?.currentSiteId;
      if (!currentId) {
        resolve();
        return;
      }
      const sites = result.sites || [];
      const idx = sites.findIndex(s => s.id === currentId);
      if (idx === -1) {
        resolve();
        return;
      }
      sites[idx] = { ...sites[idx], [standardField]: value };
      chrome.storage.local.set({ sites }, () => resolve());
    });
  });
}

/**
 * Category synonym mappings for intelligent matching
 * Maps user categories to common navigation site category names
 */
const CATEGORY_SYNONYMS = {
  // Video/Media related
  '视频': ['video', 'media', 'multimedia', 'entertainment', 'film', 'movies', 'streaming', 'audio visual', 'av', '影视', '影音', '短视频', '长视频', '娱乐'],
  '影视': ['视频', 'video', 'media', 'film', 'movies', 'entertainment'],
  '影音': ['视频', 'video', 'audio', 'media', 'multimedia'],
  '娱乐': ['视频', 'entertainment', 'video', 'media', 'fun', 'leisure'],
  'video': ['视频', '影视', '影音', 'media', 'multimedia', 'entertainment', 'film', 'streaming'],
  'media': ['视频', '影视', 'video', 'multimedia', 'entertainment', 'streaming'],

  // AI related
  'ai': ['artificial intelligence', 'machine learning', 'ml', '人工智能', '智能', 'ai tools'],
  '人工智能': ['ai', 'artificial intelligence', 'machine learning', 'smart', '智能'],
  '智能': ['ai', 'artificial intelligence', 'smart', 'intelligence'],

  // Development related
  '开发': ['development', 'developer', 'dev', 'programming', 'coding', 'code', '开发工具'],
  'developer': ['开发', 'development', 'dev', 'programming', 'coding', 'engineer'],
  'programming': ['开发', 'programming', 'coding', 'developer', 'code'],
  'code': ['开发', 'programming', 'coding', 'developer'],

  // Design related
  '设计': ['design', 'designer', 'ui', 'ux', 'graphic', 'creative', 'visual'],
  'design': ['设计', 'designer', 'ui', 'ux', 'graphic', 'creative', 'visual'],
  'ui': ['设计', 'design', 'user interface', 'interface', 'ux'],
  'ux': ['设计', 'design', 'user experience', 'experience', 'ui'],

  // Productivity related
  '效率': ['productivity', 'efficiency', 'tools', 'utility', '效率工具'],
  'productivity': ['效率', 'efficiency', 'tools', 'utility', 'work'],
  'tools': ['工具', 'productivity', 'utility', 'resources'],

  // Business/Marketing related
  '商业': ['business', 'marketing', 'sales', 'enterprise', 'b2b', '商务'],
  'business': ['商业', 'marketing', 'sales', 'enterprise', 'b2b'],
  'marketing': ['商业', 'marketing', 'promotion', 'advertising', 'growth', '营销'],
  '营销': ['marketing', 'promotion', 'advertising', 'growth', '商业'],

  // Writing/Content related
  '写作': ['writing', 'content', 'copywriting', 'text', 'editor', '写作工具'],
  'writing': ['写作', 'content', 'copywriting', 'text', 'editor', 'authoring'],
  'content': ['写作', 'writing', 'content creation', 'copywriting', '文章'],

  // Image/Graphics related
  '图片': ['image', 'photo', 'picture', 'graphics', 'visual', 'imaging', '图像'],
  'image': ['图片', 'photo', 'picture', 'graphics', 'visual', 'imaging'],
  'graphics': ['图片', 'image', 'design', 'visual', 'graphic design'],

  // Audio/Music related
  '音频': ['audio', 'music', 'sound', 'voice', 'podcast', '语音'],
  'audio': ['音频', 'music', 'sound', 'voice', 'podcast'],
  'music': ['音频', 'audio', 'sound', '歌曲', '音乐'],

  // Education related
  '教育': ['education', 'learning', 'training', 'course', 'tutorial', 'teaching', '学习'],
  'education': ['教育', 'learning', 'training', 'course', 'tutorial'],
  'learning': ['教育', 'education', 'training', 'course', '学习'],

  // E-commerce related
  '电商': ['ecommerce', 'e-commerce', 'shopping', 'store', 'retail', 'online store'],
  'ecommerce': ['电商', 'e-commerce', 'shopping', 'store', 'retail'],

  // Social related
  '社交': ['social', 'social media', 'community', 'networking', 'communication'],
  'social': ['社交', 'social media', 'community', 'networking'],

  // Finance related
  '金融': ['finance', 'financial', 'money', 'banking', 'investment', 'payment', '财务'],
  'finance': ['金融', 'financial', 'money', 'banking', 'investment'],

  // Health related
  '健康': ['health', 'healthcare', 'medical', 'wellness', 'fitness', '健康医疗'],
  'health': ['健康', 'healthcare', 'medical', 'wellness', 'fitness'],

  // Other common categories
  '工具': ['tools', 'utility', 'resources', 'helpers'],
  '其他': ['other', 'misc', 'miscellaneous', 'general'],
  '免费': ['free', 'freemium', 'open source', 'gratis'],
  '开源': ['open source', 'opensource', 'free', 'github'],
  'startup': ['startup', 'startups', 'new', 'launch', '新创', '创业'],
  '创业': ['startup', 'entrepreneurship', 'business', '新创'],
  'saas': ['saas', 'software as a service', 'cloud', 'web app'],
  'api': ['api', 'apis', 'developer tools', 'integration'],
};

/**
 * Find the best matching option in a select element
 * Uses synonym mapping for intelligent category matching
 */
function findBestCategoryMatch(select, userCategory) {
  const userCategoryLower = userCategory.toLowerCase().trim();
  const options = Array.from(select.options);

  // Collect all available option texts
  const availableOptions = options.map(opt => ({
    value: opt.value,
    text: opt.text.trim(),
    textLower: opt.text.toLowerCase().trim()
  })).filter(opt => opt.text); // Filter out empty options

  // 1. Try exact match
  const exactMatch = availableOptions.find(opt =>
    opt.value === userCategory ||
    opt.text === userCategory ||
    opt.textLower === userCategoryLower
  );
  if (exactMatch) return exactMatch;

  // 2. Try direct partial match
  const partialMatch = availableOptions.find(opt =>
    opt.textLower.includes(userCategoryLower) ||
    userCategoryLower.includes(opt.textLower)
  );
  if (partialMatch) return partialMatch;

  // 3. Use synonym mapping
  const synonyms = CATEGORY_SYNONYMS[userCategoryLower] || [];

  // Check if any synonym matches an option
  for (const synonym of synonyms) {
    const synonymLower = synonym.toLowerCase();

    // Exact match with synonym
    const synonymExactMatch = availableOptions.find(opt => opt.textLower === synonymLower);
    if (synonymExactMatch) return synonymExactMatch;

    // Partial match with synonym
    const synonymPartialMatch = availableOptions.find(opt =>
      opt.textLower.includes(synonymLower) ||
      synonymLower.includes(opt.textLower)
    );
    if (synonymPartialMatch) return synonymPartialMatch;
  }

  // 4. Try reverse mapping - check if any option has synonyms that include user category
  for (const option of availableOptions) {
    const optionSynonyms = CATEGORY_SYNONYMS[option.textLower];
    if (optionSynonyms) {
      // Check if user category matches any synonym of this option
      if (optionSynonyms.some(s => s.toLowerCase() === userCategoryLower)) {
        return option;
      }
      // Check partial match
      if (optionSynonyms.some(s =>
        s.toLowerCase().includes(userCategoryLower) ||
        userCategoryLower.includes(s.toLowerCase())
      )) {
        return option;
      }
    }
  }

  // 5. Try fuzzy matching with word boundaries
  const userWords = userCategoryLower.split(/[\s_-]+/);
  for (const option of availableOptions) {
    const optionWords = option.textLower.split(/[\s_-]+/);
    // Check if any word matches
    if (userWords.some(uw => optionWords.some(ow => uw === ow || ow.includes(uw) || uw.includes(ow)))) {
      return option;
    }
  }

  return null;
}

/**
 * Fill select element (category / tags 等下拉，支持逗号分隔多值取首个匹配)
 */
function fillSelectElement(select, value, siteData) {
  const toTry = [value];
  if (typeof value === 'string' && value.includes(',')) {
    toTry.length = 0;
    toTry.push(value.trim(), ...value.split(',').map(s => s.trim()).filter(Boolean));
  }
  for (const v of toTry) {
    if (!v) continue;
    const bestMatch = findBestCategoryMatch(select, v);
    if (bestMatch) {
      select.value = bestMatch.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`${TAG} Matched "${v}" to option "${bestMatch.text}"`);
      return true;
    }
  }
  if (siteData.category && value !== siteData.category) {
    const categoryMatch = findBestCategoryMatch(select, siteData.category);
    if (categoryMatch) {
      select.value = categoryMatch.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`${TAG} Matched site category "${siteData.category}" to option "${categoryMatch.text}"`);
      return true;
    }
  }
  const availableOptions = Array.from(select.options).map(opt => opt.text).join(', ');
  console.warn(`${TAG} Could not find matching option for: "${value}"`);
  console.warn(`${TAG} Available options: ${availableOptions}`);
  return false;
}

/**
 * 从选项数组 [{ value, text }] 中找与用户输入最匹配的项（复用分类同义词逻辑）
 */
function findBestCategoryMatchFromOptions(options, userCategory) {
  if (!options || options.length === 0) return null;
  const userCategoryLower = (userCategory || '').toLowerCase().trim();
  const availableOptions = options.map(opt => ({
    value: opt.value,
    text: (opt.text || '').trim(),
    textLower: (opt.text || '').toLowerCase().trim()
  })).filter(opt => opt.text);

  const exactMatch = availableOptions.find(opt =>
    opt.value === userCategory || opt.text === userCategory || opt.textLower === userCategoryLower
  );
  if (exactMatch) return exactMatch;

  const partialMatch = availableOptions.find(opt =>
    opt.textLower.includes(userCategoryLower) || userCategoryLower.includes(opt.textLower)
  );
  if (partialMatch) return partialMatch;

  const synonyms = CATEGORY_SYNONYMS[userCategoryLower] || [];
  for (const synonym of synonyms) {
    const synonymLower = synonym.toLowerCase();
    const synonymExact = availableOptions.find(opt => opt.textLower === synonymLower);
    if (synonymExact) return synonymExact;
    const synonymPartial = availableOptions.find(opt =>
      opt.textLower.includes(synonymLower) || synonymLower.includes(opt.textLower)
    );
    if (synonymPartial) return synonymPartial;
  }

  for (const option of availableOptions) {
    const optionSynonyms = CATEGORY_SYNONYMS[option.textLower];
    if (optionSynonyms && optionSynonyms.some(s => s.toLowerCase() === userCategoryLower)) return option;
    if (optionSynonyms && optionSynonyms.some(s =>
      s.toLowerCase().includes(userCategoryLower) || userCategoryLower.includes(s.toLowerCase())
    )) return option;
  }

  const userWords = userCategoryLower.split(/[\s_-]+/);
  for (const option of availableOptions) {
    const optionWords = option.textLower.split(/[\s_-]+/);
    if (userWords.some(uw => optionWords.some(ow => uw === ow || ow.includes(uw) || uw.includes(ow)))) return option;
  }
  return null;
}

/**
 * 通过 label「Introduction」或「详细」等查找关联的 markdown 文本框（textarea），用于 longDescription 备用定位
 */
function findIntroductionTextarea() {
  const form = document.querySelector('form');
  if (!form) return null;
  const labels = form.querySelectorAll('label');
  for (const label of labels) {
    const text = (label.textContent || '').trim().toLowerCase();
    if (!text.includes('introduction') && !text.includes('详细') && !text.includes('介绍') && !text.includes('markdown')) continue;
    if (label.htmlFor) {
      const byFor = form.querySelector(`#${CSS.escape(label.htmlFor)}`) || document.getElementById(label.htmlFor);
      if (byFor && byFor.tagName === 'TEXTAREA') return byFor;
    }
    let container = label.parentElement;
    if (container) {
      let ta = container.querySelector('textarea');
      if (ta) return ta;
      if (container.nextElementSibling) {
        ta = container.nextElementSibling.querySelector('textarea');
        if (ta) return ta;
      }
      container = container.parentElement;
      if (container) ta = container.querySelector('textarea');
      if (ta) return ta;
    }
  }
  const simplemdeWrapper = form.querySelector('[id*="simplemde-editor"], [id*="simplemde"], [id*="easymde"]');
  if (simplemdeWrapper) {
    const ta = simplemdeWrapper.querySelector('textarea');
    if (ta) return ta;
  }
  return null;
}

/**
 * 通过表单内 label 文本 "Tags" 查找关联的触发器（按钮/div），用作 Tags 下拉的备用定位
 */
function findTagsTriggerByLabel() {
  const form = document.querySelector('form');
  if (!form) return null;
  const labels = form.querySelectorAll('label');
  for (const label of labels) {
    const text = (label.textContent || '').trim().toLowerCase();
    if (!text.includes('tag') || text.includes('tagline')) continue;
    let control = null;
    if (label.htmlFor) control = form.querySelector(`#${CSS.escape(label.htmlFor)}`) || document.getElementById(label.htmlFor);
    if (!control) control = label.nextElementSibling;
    if (!control && label.parentElement) {
      const siblings = Array.from(label.parentElement.children);
      const idx = siblings.indexOf(label);
      if (idx >= 0 && idx < siblings.length - 1) control = siblings[idx + 1];
    }
    if (control && control.tagName !== 'SELECT' && control.tagName !== 'TEXTAREA') return control;
  }
  return null;
}

/**
 * 查找 Tags 多选下拉的面板（含 "Tags"/"Search" 和 checkbox 列表）
 */
function findTagsCheckboxPanel() {
  const candidates = document.querySelectorAll('[role="listbox"], [role="menu"], [role="dialog"], [class*="dropdown"], [class*="menu"], [class*="popover"], [class*="content"]');
  for (const el of candidates) {
    const text = (el.textContent || '').toLowerCase();
    if (!text.includes('tag') || text.includes('tagline')) continue;
    const checkboxes = el.querySelectorAll('input[type="checkbox"]');
    if (checkboxes.length > 0 && isElementVisible(el)) return el;
  }
  const withSearch = document.evaluate(
    "//*[contains(translate(.,'SEARCH','search'),'search') and .//input[@type='checkbox']]",
    document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
  );
  for (let i = 0; i < withSearch.snapshotLength; i++) {
    const el = withSearch.snapshotItem(i);
    if (el && (el.textContent || '').toLowerCase().includes('tag') && isElementVisible(el)) return el;
  }
  return null;
}

/**
 * 从带 checkbox 的面板中收集选项行与选项文案（排除 Select All）
 */
function collectCheckboxOptions(panel) {
  const optionEls = [];
  const options = [];
  const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    const row = cb.closest('label') || cb.closest('li') || cb.closest('[role="option"]') || cb.parentElement;
    if (!row || row === panel) continue;
    const text = (row.textContent || '').trim();
    if (!text || /^\s*$/.test(text)) continue;
    if (/select\s*all/i.test(text)) continue;
    optionEls.push(row);
    options.push({ value: text, text });
  }
  return { optionEls, options };
}

/**
 * 是否可见（未被隐藏、在视口内或可渲染）
 */
function isElementVisible(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/**
 * 模拟真实用户点击（mousedown -> mouseup -> click），提高被框架识别的概率
 */
function simulateClick(el) {
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
}

/**
 * 填充自定义下拉（非原生 select）：先关闭已有下拉，再点击触发器，等待选项出现后选择匹配项
 */
function fillCustomSelect(triggerElement, value, siteData, standardField) {
  const toTry = [value];
  if (typeof value === 'string' && value.includes(',')) {
    toTry.length = 0;
    toTry.push(value.trim(), ...value.split(',').map(s => s.trim()).filter(Boolean));
  }
  const valueToUse = standardField === 'category' && siteData.category
    ? siteData.category
    : (standardField === 'tags' && siteData.tags ? (siteData.tags.split(',')[0]?.trim() || siteData.tags) : (toTry[0] || value));
  if (!valueToUse) return Promise.resolve(false);

  const isTags = standardField === 'tags';
  const closeDelay = isTags ? 400 : 220;
  const openWaitMs = isTags ? 750 : 600;
  console.log(`${TAG} Custom select: opening ${standardField} for "${valueToUse}"`);

  return new Promise((resolve) => {
    // 先关闭可能已打开的下拉（Tags 前多等一会，确保 Categories 已关）
    function closeOpenDropdown(done) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      triggerElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      document.body.focus();
      setTimeout(done, closeDelay);
    }

    closeOpenDropdown(() => {
      triggerElement.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      simulateClick(triggerElement);
      if (isTags) {
        setTimeout(() => { simulateClick(triggerElement); }, 120);
      }
      // 等待下拉渲染后再查找选项（Tags 多等一会）
      setTimeout(() => {
        const optionSelectors = [
          '[role="listbox"] [role="option"]',
          '[role="option"]',
          '[data-headlessui-state] [role="option"]',
          'ul[role="listbox"] li',
          '[role="listbox"] li',
          '.option',
          '[data-value]',
          '[id*="option"]',
          'li'
        ];
        let optionEls = [];
        const form = triggerElement.closest('form');
        const scope = form || document.body;
        let container = scope.querySelector('[role="listbox"], [data-headlessui-state], [class*="dropdown"], [class*="menu"]');
        if (!container) container = scope;
        for (const sel of optionSelectors) {
          optionEls = Array.from(container.querySelectorAll(sel));
          if (optionEls.length > 0) break;
        }
        if (optionEls.length === 0) {
          optionEls = Array.from(scope.querySelectorAll('[role="option"], [data-value], li'));
        }
        // 若表单内没找到，再在 body 找（portal 渲染的下拉）
        if (optionEls.length === 0 && scope !== document.body) {
          for (const sel of optionSelectors) {
            optionEls = Array.from(document.body.querySelectorAll(sel));
            if (optionEls.length > 0) break;
          }
        }
        // Tags 多选优先：下拉内是带 checkbox 的选项（如 navfolders），先按 checkbox 面板处理
        if (isTags) {
          const tagPanel = findTagsCheckboxPanel();
          if (tagPanel) {
            const { optionEls: checkboxRows, options: checkboxOptions } = collectCheckboxOptions(tagPanel);
            if (checkboxRows.length > 0) {
              const visible = checkboxRows.filter(isElementVisible);
              const rows = visible.length > 0 ? visible : checkboxRows;
              const best = findBestCategoryMatchFromOptions(checkboxOptions, valueToUse) || findBestCategoryMatchFromOptions(checkboxOptions, siteData.category);
              if (best && !/select\s*all/i.test(best.text)) {
                const optionEl = rows.find(el => {
                  const t = (el.textContent || '').trim();
                  return t === best.text || t === best.value;
                });
                if (optionEl) {
                  simulateClick(optionEl);
                  triggerElement.dispatchEvent(new Event('change', { bubbles: true }));
                  console.log(`${TAG} Custom select: matched tag "${valueToUse}" to "${best.text}"`);
                  closeThenResolve();
                  return;
                }
              }
            }
          }
        }
        const visible = optionEls.filter(isElementVisible);
        if (visible.length > 0) optionEls = visible;
        const options = optionEls.map(el => ({
          value: el.getAttribute('data-value') || el.getAttribute('value') || el.textContent.trim(),
          text: el.textContent.trim()
        })).filter(o => o.text);
        const best = findBestCategoryMatchFromOptions(options, valueToUse) || findBestCategoryMatchFromOptions(options, siteData.category);
        if (best) {
          const optionEl = optionEls.find(el =>
            (el.getAttribute('data-value') || el.textContent.trim()) === best.value ||
            el.textContent.trim() === best.text
          );
          if (optionEl) {
            simulateClick(optionEl);
            triggerElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`${TAG} Custom select: matched "${valueToUse}" to "${best.text}"`);
            closeThenResolve();
            return;
          }
        }
        // Tags 多选：有 optionEls 但可能是 checkbox 行（无 role=option），再试一次按文本匹配
        if (isTags && optionEls.length > 0) {
          const optionsFromText = optionEls.map(el => ({
            value: el.textContent.trim(),
            text: el.textContent.trim()
          })).filter(o => o.text && !/select\s*all/i.test(o.text));
          const bestTag = findBestCategoryMatchFromOptions(optionsFromText, valueToUse);
          if (bestTag) {
            const optionEl = optionEls.find(el => (el.textContent || '').trim() === bestTag.text);
            if (optionEl) {
              simulateClick(optionEl);
              triggerElement.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`${TAG} Custom select: matched tag "${valueToUse}" to "${bestTag.text}"`);
              closeThenResolve();
              return;
            }
          }
        }
        console.warn(`${TAG} Custom select: no matching option for "${valueToUse}"`);
        resolve(false);

        function closeThenResolve() {
          setTimeout(() => {
            try {
              const closeBtn = document.evaluate("//button[contains(translate(.,'CLOSE','close'),'close')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
              if (closeBtn && isElementVisible(closeBtn)) simulateClick(closeBtn);
            } catch (_) {}
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            triggerElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            document.body.focus();
            setTimeout(() => resolve(true), 380);
          }, 220);
        }
      }, openWaitMs);
    });
  });
}

/**
 * 根据输入框是否已有 https:// 前缀，决定填入完整 URL 还是仅域名+路径
 * 仅当页面上「明确」有协议 addon（如 findly 左侧固定 "https://"）时才去掉协议；否则一律填完整 URL（如 auraplusplus）
 */
function getUrlValueForInput(input, fullUrl) {
  if (!fullUrl || typeof fullUrl !== 'string') return fullUrl;
  const trimmed = fullUrl.trim();
  let hasPrefix = false;
  const currentValue = (input.value || '').trim().toLowerCase();
  // 仅当输入框当前值就是 "https://" 或 "http://"（说明 UI 已固定前缀、用户只填后面）时才去掉
  if (currentValue === 'https://' || currentValue === 'http://') hasPrefix = true;
  // 仅当紧邻前一个兄弟的文案「恰好」是 "https://" 或 "http://"（findly 式 addon）时才去掉；不用 placeholder，避免 auraplusplus 等站点误判
  if (!hasPrefix && input.previousElementSibling) {
    const t = (input.previousElementSibling.textContent || '').trim().toLowerCase();
    if (t === 'https://' || t === 'http://') hasPrefix = true;
  }
  if (hasPrefix) {
    try {
      const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
      const u = new URL(withProtocol);
      return u.hostname + (u.pathname !== '/' ? u.pathname : '') + u.search;
    } catch (_) {
      return trimmed.replace(/^https?:\/\//i, '');
    }
  }
  if (!/^https?:\/\//i.test(trimmed)) return 'https://' + trimmed;
  return trimmed;
}

/**
 * 将 data URL 转为 File，用于填入 <input type="file">
 */
function dataURLtoFile(dataUrl, filename = 'logo.png') {
  const arr = dataUrl.split(',');
  const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
  return new File([u8arr], filename, { type: mime });
}

/**
 * 用存储的 Logo data URL 自动填入文件上传框
 */
function fillFileInputWithDataUrl(fileInput, dataUrl) {
  const file = dataURLtoFile(dataUrl, 'logo.png');
  const dt = new DataTransfer();
  dt.items.add(file);
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event('input', { bubbles: true }));
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * 填充 contenteditable / ProseMirror 富文本区（如 auraplusplus Short Description）
 */
function fillContentEditable(editableEl, value) {
  const str = value != null ? String(value).trim() : '';
  editableEl.focus();
  try {
    // 清空后写入纯文本，兼容 ProseMirror/TipTap
    editableEl.innerText = str;
    editableEl.dispatchEvent(new InputEvent('input', { data: str, inputType: 'insertText', bubbles: true }));
    editableEl.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (_) {
    editableEl.textContent = str;
  }
  editableEl.dispatchEvent(new Event('blur', { bubbles: true }));
  editableEl.blur();
}

/**
 * 填充 CodeMirror 编辑器（SimpleMDE 等使用）
 */
function fillCodeMirror(cmDiv, value) {
  const str = value != null ? String(value) : '';
  console.log(`${TAG} fillCodeMirror called with value:`, str, `cmDiv:`, cmDiv);
  try {
    // 尝试多种方式获取 CodeMirror 实例
    let cmInstance = cmDiv.CodeMirror;
    console.log(`${TAG} fillCodeMirror: checking cmDiv.CodeMirror:`, cmInstance);
    if (!cmInstance && cmDiv.cm) {
      cmInstance = cmDiv.cm;
      console.log(`${TAG} fillCodeMirror: using cmDiv.cm:`, cmInstance);
    }
    if (!cmInstance && cmDiv.editor) {
      cmInstance = cmDiv.editor;
      console.log(`${TAG} fillCodeMirror: using cmDiv.editor:`, cmInstance);
    }

    // 尝试从 wrapper 获取 SimpleMDE 实例
    if (!cmInstance) {
      const wrapper = cmDiv.closest('[id*="simplemde"], [id*="easymde"]') || cmDiv.parentElement;
      console.log(`${TAG} fillCodeMirror: looking in wrapper:`, wrapper);
      if (wrapper) {
        console.log(`${TAG} fillCodeMirror: wrapper.simpleMDE:`, wrapper.simpleMDE);
        if (wrapper.simpleMDE && wrapper.simpleMDE.codemirror) {
          cmInstance = wrapper.simpleMDE.codemirror;
          console.log(`${TAG} fillCodeMirror: using wrapper.simpleMDE.codemirror:`, cmInstance);
        }
        const easyMdeContainer = wrapper.querySelector('.EasyMDEContainer');
        console.log(`${TAG} fillCodeMirror: easyMdeContainer:`, easyMdeContainer);
        if (easyMdeContainer && easyMdeContainer.easyMDE) {
          cmInstance = easyMdeContainer.easyMDE.codemirror;
          console.log(`${TAG} fillCodeMirror: using easyMdeContainer.easyMDE.codemirror:`, cmInstance);
        }
      }
    }

    console.log(`${TAG} fillCodeMirror: final cmInstance:`, cmInstance);
    if (cmInstance && cmInstance.getDoc) {
      console.log(`${TAG} fillCodeMirror: calling setValue on CodeMirror`);
      cmInstance.getDoc().setValue(str);
      cmInstance.focus();
      cmInstance.refresh();
      console.log(`${TAG} fillCodeMirror: done`);
      return;
    }

    // 回退：通过隐藏的 textarea 填充
    const wrapper = cmDiv.closest('[id*="simplemde"], [id*="easymde"]') || cmDiv.parentElement;
    if (wrapper) {
      const hiddenTextarea = wrapper.querySelector('textarea');
      console.log(`${TAG} fillCodeMirror: fallback to hidden textarea:`, hiddenTextarea);
      if (hiddenTextarea) {
        fillInputElement(hiddenTextarea, str);
        return;
      }
    }
  } catch (err) {
    console.warn(`${TAG} fillCodeMirror 失败:`, err);
  }
}

/**
 * Fill input or textarea element（避免 Illegal invocation：textarea 用 HTMLTextAreaElement，且 setter 失败时回退直接赋值）
 * 若为 Markdown 编辑器（SimpleMDE/CodeMirror）包裹的 textarea，会同步到编辑器实例使界面显示更新
 */
function fillInputElement(input, value) {
  const str = value != null ? String(value) : '';
  input.focus();

  try {
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, str);
    } else {
      input.value = str;
    }
  } catch (_) {
    input.value = str;
  }

  if (input.tagName === 'TEXTAREA' && str) {
    try {
      let synced = false;
      if (typeof window.CodeMirror !== 'undefined') {
        // 方式1: 通过全局 findByTextArea 查找
        if (window.CodeMirror.findByTextArea) {
          const cm = window.CodeMirror.findByTextArea(input);
          if (cm && cm.getDoc()) {
            cm.getDoc().setValue(str);
            cm.refresh();
            synced = true;
          }
        }
        // 方式2: 通过 textarea 的 CodeMirror 属性
        if (!synced && input.CodeMirror && input.CodeMirror.getDoc) {
          input.CodeMirror.getDoc().setValue(str);
          input.CodeMirror.refresh();
          synced = true;
        }
        // 方式3: 通过 wrapper 查找 CodeMirror div
        if (!synced) {
          const wrapper = input.closest('[id*="simplemde"], [id*="easymde"]') || input.parentElement;
          if (wrapper) {
            const cmDiv = wrapper.querySelector('.CodeMirror') || input.nextElementSibling;
            if (cmDiv && cmDiv.classList && cmDiv.classList.contains('CodeMirror')) {
              // 尝试多种方式获取 CodeMirror 实例
              let cmInstance = cmDiv.CodeMirror;
              if (!cmInstance && cmDiv.cm) cmInstance = cmDiv.cm;
              if (!cmInstance && cmDiv.editor) cmInstance = cmDiv.editor;
              if (!cmInstance && wrapper.simpleMDE && wrapper.simpleMDE.codemirror) {
                cmInstance = wrapper.simpleMDE.codemirror;
              }
              // 尝试从 EasyMDEContainer 获取
              if (!cmInstance) {
                const easyMdeContainer = wrapper.querySelector('.EasyMDEContainer');
                if (easyMdeContainer && easyMdeContainer.easyMDE) {
                  cmInstance = easyMdeContainer.easyMDE.codemirror;
                }
              }
              if (cmInstance && cmInstance.getDoc) {
                cmInstance.getDoc().setValue(str);
                cmInstance.refresh();
                synced = true;
              }
            }
          }
        }
        // 方式4: 全局查找 CodeMirror 实例
        if (!synced) {
          const allCm = document.querySelectorAll('.CodeMirror');
          for (const el of allCm) {
            if (el.CodeMirror && el.CodeMirror.getDoc) {
              el.CodeMirror.getDoc().setValue(str);
              el.CodeMirror.refresh();
              synced = true;
              break;
            }
          }
        }
      }
      if (!synced && typeof window.InputEvent !== 'undefined') {
        input.dispatchEvent(new InputEvent('input', { data: str, inputType: 'insertText', bubbles: true }));
      }
    } catch (_) {}
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  input.blur();
}

/**
 * Check for CAPTCHA presence
 */
function checkForCaptcha() {
  // Check for common CAPTCHA indicators
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    'div[class*="captcha"]',
    'div[id*="captcha"]',
    'img[src*="captcha"]',
    '.g-recaptcha',
    '#g-recaptcha-response'
  ];

  for (const selector of captchaSelectors) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  // Check for CAPTCHA keywords in page text
  const bodyText = document.body.textContent.toLowerCase();
  const captchaKeywords = ['captcha', '验证码', '请输入验证', 'human verification'];

  for (const keyword of captchaKeywords) {
    if (bodyText.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Get site data from storage
 */
async function getSiteData(siteId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['sites', 'settings'], (result) => {
      let targetSiteId = siteId;

      // If no siteId provided, use current site from settings
      if (!targetSiteId) {
        targetSiteId = result.settings?.currentSiteId;
      }

      if (!targetSiteId) {
        resolve(null);
        return;
      }

      const sites = result.sites || [];
      const site = sites.find(s => s.id === targetSiteId);
      resolve(site || null);
    });
  });
}

/**
 * Record submission in storage
 */
async function recordSubmission(siteId, domain, filledCount, errors) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['submissionRecords'], (result) => {
      const records = result.submissionRecords || {};
      const key = `${siteId}_${domain}`;

      records[key] = {
        siteId,
        domain,
        submittedAt: new Date().toISOString(),
        status: errors.length === 0 ? 'success' : 'partial',
        filledCount,
        errorCount: errors.length,
        errors
      };

      chrome.storage.local.set({ submissionRecords: records }, () => {
        resolve();
      });
    });
  });
}

// Auto-detect form on page load
console.log(`${TAG} Content script loaded on ${window.location.hostname}`);

// Notify popup that page is ready
chrome.runtime.sendMessage({
  action: 'pageReady',
  url: window.location.href,
  domain: window.location.hostname
}).catch(() => {
  // Popup might not be open, that's fine
});

// Listen for page changes (SPA navigation)
let lastUrl = window.location.href;
new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    pageState = {
      hasForm: false,
      formMetadata: null,
      fieldMappings: null,
      domain: window.location.hostname,
      recognitionStatus: 'idle',
      recognitionMethod: null
    };
    console.log(`${TAG} Page navigation detected`);
  }
}).observe(document.body, { childList: true, subtree: true });
