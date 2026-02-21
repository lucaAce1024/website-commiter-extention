/**
 * Content Script - Form Handler
 * Runs on every page to detect and fill navigation site submission forms
 */

// Console tag for debugging
const TAG = '[NavSubmitter]';

// State for current page
let pageState = {
  hasForm: false,
  formMetadata: null,
  fieldMappings: null,
  domain: null,
  recognitionStatus: 'idle', // idle, recognizing, done, failed
  recognitionMethod: null
};

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
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(input.type)) {
        return;
      }

      const label = getFieldLabel(input);
      const locator = getFieldLocator(input);

      const fieldInfo = {
        locator,
        type: input.type || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName.toLowerCase()),
        name: input.name || '',
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
  });

  // Also check for forms not in <form> tags
  if (fields.length === 0) {
    const allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select');
    allInputs.forEach((input, index) => {
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(input.type)) {
        return;
      }

      const label = getFieldLabel(input);
      const locator = getFieldLocator(input);

      fields.push({
        locator,
        type: input.type || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName.toLowerCase()),
        name: input.name || '',
        id: input.id || '',
        placeholder: input.placeholder || '',
        label: label || '',
        ariaLabel: input.getAttribute('aria-label') || '',
        required: input.required || false
      });
    });
  }

  return {
    hasForm: fields.length > 0,
    fields,
    url: window.location.href,
    domain: window.location.hostname
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
      keywords: ['category', 'cat', 'type', 'class', '分类', '类别', '类型'],
      isSelect: true,
      weights: { name: 2, label: 2 }
    },
    tagline: {
      keywords: ['tagline', 'slogan', 'motto', 'tag', '标语', '口号'],
      weights: { name: 2, placeholder: 1 }
    },
    shortDescription: {
      keywords: ['short', 'desc', 'description', 'summary', 'intro', 'brief', '简介', '简述', '描述', 'shortdesc'],
      weights: { name: 2, placeholder: 1 }
    },
    longDescription: {
      keywords: ['long', 'detail', 'description', 'content', 'about', 'info', '详细', '介绍', '描述', '详情'],
      isTextarea: true,
      weights: { name: 2, placeholder: 1 }
    },
    logo: {
      keywords: ['logo', 'icon', 'image', 'logo', '图标', '标志'],
      type: 'url',
      weights: { name: 2, placeholder: 1 }
    },
    screenshot: {
      keywords: ['screenshot', 'shot', 'capture', 'screen', 'preview', '截图', '预览图'],
      type: 'url',
      weights: { name: 2, placeholder: 1 }
    }
  };

  const matches = [];

  for (const field of formMetadata.fields) {
    const scores = {};

    for (const [standardField, config] of Object.entries(FIELD_KEYWORDS)) {
      let score = 0;

      if (config.type && field.type === config.type) {
        score += config.weights.type * 2;
      }
      if (config.isTextarea && field.isTextarea) {
        score += 3;
      }
      if (config.isSelect && field.type === 'select-one') {
        score += 3;
      }

      const nameLower = field.name.toLowerCase();
      for (const kw of config.keywords) {
        if (nameLower.includes(kw.toLowerCase())) {
          score += config.weights.name || 1;
        }
      }

      const labelLower = field.label.toLowerCase();
      for (const kw of config.keywords) {
        if (labelLower.includes(kw.toLowerCase())) {
          score += config.weights.label || 1;
        }
      }

      const placeholderLower = field.placeholder.toLowerCase();
      for (const kw of config.keywords) {
        if (placeholderLower.includes(kw.toLowerCase())) {
          score += config.weights.placeholder || 1;
        }
      }

      if (score > 0) {
        scores[standardField] = score;
      }
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
        method: 'keyword'
      });
    }
  }

  return matches;
}

/**
 * Recognize form structure
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

    const domain = formMetadata.domain;

    // Check for cached mapping
    const cached = await getCachedMapping(domain);
    if (cached && cached.length > 0) {
      pageState.fieldMappings = cached;
      pageState.recognitionStatus = 'done';
      pageState.recognitionMethod = 'cache';
      return {
        status: 'success',
        method: 'cache',
        mappings: cached,
        fieldCount: cached.length
      };
    }

    // Do keyword matching (always available)
    const mappings = recognizeByKeywords(formMetadata);
    if (mappings.length === 0 && formMetadata.fields?.length > 0) {
      const names = formMetadata.fields.map(f => f.name || f.label || f.placeholder || f.id || '(empty)').join(', ');
      console.info(`${TAG} Keyword match 0 fields. Page fields (name/label/placeholder): ${names}`);
    }
    pageState.fieldMappings = mappings;
    pageState.recognitionStatus = 'done';
    pageState.recognitionMethod = 'keyword';

    // Cache the result
    await cacheMapping(domain, mappings);

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
 * Clear mapping for current domain
 */
async function clearMapping() {
  const domain = window.location.hostname;
  return new Promise((resolve) => {
    chrome.storage.local.get(['fieldMappings'], (result) => {
      const mappings = result.fieldMappings || {};
      delete mappings[domain];
      chrome.storage.local.set({ fieldMappings: mappings }, () => {
        pageState.fieldMappings = null;
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
      const element = findElementByLocator(mapping.locator);
      if (!element) {
        errors.push(`Could not find element for ${mapping.standardField}`);
        continue;
      }

      const value = siteData[mapping.standardField];
      if (!value) {
        // Field not in site data, skip
        continue;
      }

      // Set value based on element type
      if (element.tagName === 'SELECT') {
        fillSelectElement(element, value, siteData);
        filledCount++;
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
 * Fill select element with category
 */
function fillSelectElement(select, value, siteData) {
  // Try to find the best matching option
  const bestMatch = findBestCategoryMatch(select, value);

  if (bestMatch) {
    select.value = bestMatch.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`${TAG} Matched category "${value}" to option "${bestMatch.text}"`);
    return true;
  }

  // Try with site category as fallback
  if (siteData.category && siteData.category !== value) {
    const categoryMatch = findBestCategoryMatch(select, siteData.category);
    if (categoryMatch) {
      select.value = categoryMatch.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`${TAG} Matched site category "${siteData.category}" to option "${categoryMatch.text}"`);
      return true;
    }
  }

  // Log available options for debugging
  const availableOptions = Array.from(select.options).map(opt => opt.text).join(', ');
  console.warn(`${TAG} Could not find matching option for: "${value}"`);
  console.warn(`${TAG} Available options: ${availableOptions}`);
  return false;
}

/**
 * Fill input element
 */
function fillInputElement(input, value) {
  input.focus();
  input.value = value;

  // Trigger various events for different frameworks
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));

  // For React/Vue apps
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));

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
