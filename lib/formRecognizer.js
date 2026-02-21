/**
 * Form Recognizer - Keyword-based form field detection
 * Fallback when LLM is not available or fails
 */

import { STANDARD_FIELDS } from './storage.js';

// Regular expression patterns for each standard field type
// These patterns are designed to match various naming conventions and languages
const FIELD_PATTERNS = {
  [STANDARD_FIELDS.SITE_NAME]: {
    // High priority patterns (exact or very close matches)
    patterns: [
      // English patterns
      /\b(sitename|site_name|site-name)\b/i,
      /\b(product\s*name|productname|product_name)\b/i,
      /\b(project\s*name|projectname|project_name)\b/i,
      /\b(app\s*name|appname|app_name)\b/i,
      /\b(tool\s*name|toolname|tool_name)\b/i,
      /\b(website\s*name|websitename|website_name)\b/i,
      /\b(title|name)\b/i,  // Generic but common

      // Chinese patterns
      /网站名[称字]/,
      /站点名[称字]?/,
      /产品名[称字]/,
      /项目名[称字]/,
      /工具名[称字]/,
      /标题/,
    ],
    // Context patterns (need to be combined with other signals)
    contextPatterns: [
      /\bsite\b.*\bname\b/i,
      /\bname\b.*\bsite\b/i,
      /\bproduct\b.*\btitle\b/i,
      /\btitle\b.*\bproduct\b/i,
    ],
    weights: { pattern: 3, context: 2, label: 2 }
  },

  [STANDARD_FIELDS.EMAIL]: {
    patterns: [
      // English patterns
      /\b(email|e-mail)\b/i,
      /\b(mail\s*address|mailaddress)\b/i,
      /\b(contact\s*email|contactemail)\b/i,
      /\b(user\s*email|useremail)\b/i,
      /\b(email\s*address|emailaddress)\b/i,
      /\b(author\s*email|authoremail)\b/i,
      /\b(contact)\b/i,

      // Chinese patterns
      /邮箱/,
      /联系邮箱/,
      /联系邮件/,
      /电子邮箱/,
      /邮件地址/,
    ],
    type: 'email',
    weights: { pattern: 3, type: 3, label: 2 }
  },

  [STANDARD_FIELDS.SITE_URL]: {
    patterns: [
      // English patterns - High priority
      /\b(site\s*url|siteurl|site_url)\b/i,
      /\b(website\s*url|websiteurl|website_url)\b/i,
      /\b(product\s*url|producturl|product_url)\b/i,
      /\b(project\s*url|projecturl|project_url)\b/i,
      /\b(app\s*url|appurl|app_url)\b/i,
      /\b(tool\s*url|toolurl|tool_url)\b/i,
      /\b(page\s*url|pageurl|page_url)\b/i,
      /\b(web\s*url|weburl|web_url)\b/i,
      /\b(homepage\s*url|homepageurl|homepage_url)\b/i,
      /\b(landing\s*url|landingurl|landing_url)\b/i,

      // English patterns - Medium priority
      /\b(url|link|href)\b/i,
      /\b(website|webpage)\b/i,
      /\b(homepage|landingpage)\b/i,
      /\b(source\s*url|sourceurl|source_url)\b/i,

      // Chinese patterns
      /网址/,
      /网站地址/,
      /链接/,
      /网址链接/,
      /网站链接/,
      /产品链接/,
      /项目链接/,
      /官网链接/,
      /主页链接/,
    ],
    // Exclude patterns - these should NOT match
    excludePatterns: [
      /\b(logo\s*url|logourl|logo_url)\b/i,
      /\b(image\s*url|imageurl|image_url)\b/i,
      /\b(icon\s*url|iconurl|icon_url)\b/i,
      /\b(avatar\s*url|avatarurl|avatar_url)\b/i,
      /\b(screenshot\s*url|screenshoturl|screenshot_url)\b/i,
      /\b(thumbnail\s*url|thumbnailurl|thumbnail_url)\b/i,
      /\b(preview\s*url|previewurl|preview_url)\b/i,
      /\b(video\s*url|videourl|video_url)\b/i,
      /\b(github\s*url|githuburl|github_url)\b/i,
      /\b(git\s*url|giturl|git_url)\b/i,
      /\b(repo\s*url|repourl|repo_url)\b/i,
      /\b(source\s*code\s*url)\b/i,
    ],
    type: 'url',
    weights: { pattern: 3, type: 2, label: 2, exclude: -10 }
  },

  [STANDARD_FIELDS.CATEGORY]: {
    patterns: [
      // English patterns
      /\b(category|categories)\b/i,
      /\b(cat)\b/i,
      /\b(type)\b/i,
      /\b(classification|classify)\b/i,
      /\b(section)\b/i,
      /\b(topic)\b/i,
      /\b(niche)\b/i,
      /\b(industry)\b/i,

      // Chinese patterns
      /分类/,
      /类别/,
      /类型/,
      /栏目/,
      /频道/,
    ],
    isSelect: true,
    weights: { pattern: 3, label: 2 }
  },

  [STANDARD_FIELDS.TAGLINE]: {
    patterns: [
      // English patterns
      /\b(tagline)\b/i,
      /\b(slogan)\b/i,
      /\b(motto)\b/i,
      /\b(one\s*liner|oneliner|one_liner)\b/i,
      /\b(catchphrase)\b/i,
      /\b(headline)\b/i,
      /\b(subtitle)\b/i,
      /\b(tag\s*line|tagline)\b/i,

      // Chinese patterns
      /标语/,
      /口号/,
      /副标题/,
      /一句话/,
      /简短描述/,
    ],
    weights: { pattern: 3, label: 2 }
  },

  [STANDARD_FIELDS.SHORT_DESCRIPTION]: {
    patterns: [
      // English patterns - High priority
      /\b(short\s*desc|shortdesc|short_desc)\b/i,
      /\b(short\s*description|shortdescription|short_description)\b/i,
      /\b(brief\s*desc|briefdesc|brief_desc)\b/i,
      /\b(brief\s*description|briefdescription|brief_description)\b/i,
      /\b(summary)\b/i,
      /\b(summaries)\b/i,
      /\b(intro|introductory)\b/i,
      /\b(introduction)\b/i,
      /\b(abstract)\b/i,
      /\b(excerpt)\b/i,
      /\b(teaser)\b/i,
      /\b(bio)\b/i,
      /\b(overview)\b/i,
      /\b(snapshot)\b/i,
      /\b(product\s*summary|productsummary|product_summary)\b/i,
      /\b(product\s*intro|productintro|product_intro)\b/i,
      /\b(site\s*summary|sitesummary|site_summary)\b/i,
      /\b(quick\s*desc|quickdesc|quick_desc)\b/i,

      // Chinese patterns
      /简介/,
      /简述/,
      /简短描述/,
      /简要介绍/,
      /概述/,
      /摘要/,
      /简介描述/,
      /简单介绍/,
    ],
    // Context patterns
    contextPatterns: [
      /\bshort\b.*\bdesc/i,
      /\bbrief\b.*\bdesc/i,
      /\bquick\b.*\bdesc/i,
      /\bsummary\b/i,
    ],
    weights: { pattern: 3, context: 2, label: 2 }
  },

  [STANDARD_FIELDS.LONG_DESCRIPTION]: {
    patterns: [
      // English patterns - High priority
      /\b(long\s*desc|longdesc|long_desc)\b/i,
      /\b(long\s*description|longdescription|long_description)\b/i,
      /\b(full\s*desc|fulldesc|full_desc)\b/i,
      /\b(full\s*description|fulldescription|full_description)\b/i,
      /\b(detail\s*desc|detaildesc|detail_desc)\b/i,
      /\b(detailed\s*description|detaileddescription|detailed_description)\b/i,
      /\b(description|desc)\b/i,
      /\b(content)\b/i,
      /\b(about)\b/i,
      /\b(info|information)\b/i,
      /\b(body)\b/i,
      /\b(text)\b/i,
      /\b(details)\b/i,
      /\b(features)\b/i,
      /\b(product\s*desc|productdesc|product_desc)\b/i,
      /\b(product\s*description|productdescription|product_description)\b/i,
      /\b(site\s*desc|sitedesc|site_desc)\b/i,
      /\b(site\s*description|sitedescription|site_description)\b/i,
      /\b(project\s*description|projectdescription|project_description)\b/i,
      /\b(tool\s*description|tooldescription|tool_description)\b/i,
      /\b(full\s*details|fulldetails|full_details)\b/i,
      /\b(more\s*info|moreinfo|more_info)\b/i,
      /\b(additional\s*info|additionalinfo|additional_info)\b/i,

      // Chinese patterns
      /详细[介绍描述]/,
      /详细介绍/,
      /详细描述/,
      /完整描述/,
      /详细说明/,
      /详细内容/,
      /详细简介/,
      /产品描述/,
      /产品介绍/,
      /项目介绍/,
      /工具介绍/,
      /更多介绍/,
      /补充介绍/,
      /详细介绍内容/,
    ],
    contextPatterns: [
      /\bdetail\b.*\bdesc/i,
      /\bfull\b.*\bdesc/i,
      /\bcomplete\b.*\bdesc/i,
      /\bdescription\b/i,
    ],
    isTextarea: true,
    weights: { pattern: 3, context: 2, label: 2, textarea: 2 }
  },

  [STANDARD_FIELDS.LOGO]: {
    patterns: [
      // English patterns
      /\b(logo)\b/i,
      /\b(icon)\b/i,
      /\b(brand)\b/i,
      /\b(emblem)\b/i,
      /\b(badge)\b/i,
      /\b(mark)\b/i,
      /\b(symbol)\b/i,
      /\b(favicon|fav-icon)\b/i,
      /\b(profile\s*pic|profilepic|profile_pic)\b/i,
      /\b(avatar)\b/i,
      /\b(thumb|thumbnail)\b/i,
      /\b(site\s*logo|sitelogo|site_logo)\b/i,
      /\b(product\s*logo|productlogo|product_logo)\b/i,
      /\b(company\s*logo|companylogo|company_logo)\b/i,
      /\b(app\s*icon|appicon|app_icon)\b/i,

      // Chinese patterns
      /图标/,
      /标志/,
      /徽标/,
      /网站图标/,
      /产品图标/,
      /公司图标/,
      /头像/,
      /Favicon/,
      /网站图标/,
    ],
    weights: { pattern: 3, label: 2 }
  },

  [STANDARD_FIELDS.SCREENSHOT]: {
    patterns: [
      // English patterns
      /\b(screenshot|screen\s*shot|screen_shot)\b/i,
      /\b(screenshots)\b/i,
      /\b(capture|screen\s*capture)\b/i,
      /\b(preview)\b/i,
      /\b(thumbnail)\b/i,
      /\b(snap|snapshot)\b/i,
      /\b(screen)\b/i,
      /\b(demo\s*image|demoimage|demo_image)\b/i,
      /\b(preview\s*image|previewimage|preview_image)\b/i,
      /\b(gallery)\b/i,
      /\b( showcase)\b/i,
      /\b(site\s*screenshot|sitescreenshot|site_screenshot)\b/i,
      /\b(product\s*screenshot|productscreenshot|product_screenshot)\b/i,
      /\b(website\s*screenshot|websitescreenshot|website_screenshot)\b/i,
      /\b(app\s*screenshot|appscreenshot|app_screenshot)\b/i,
      /\b(page\s*screenshot|pagescreenshot|page_screenshot)\b/i,
      /\b(ui\s*screenshot|uiscreenshot|ui_screenshot)\b/i,

      // Chinese patterns
      /截图/,
      /预览图/,
      /屏幕截图/,
      /网站截图/,
      /产品截图/,
      /页面截图/,
      /界面截图/,
      /演示图/,
      /展示图/,
      /效果预览/,
    ],
    weights: { pattern: 3, label: 2 }
  }
};

// Legacy keywords for backward compatibility
const FIELD_KEYWORDS = FIELD_PATTERNS;

/**
 * Extract form metadata from the page
 * Returns structured information about all form fields without user data
 */
export function extractFormMetadata() {
  const forms = document.querySelectorAll('form');
  if (forms.length === 0) {
    return { hasForm: false, fields: [] };
  }

  const fields = [];

  forms.forEach((form, formIndex) => {
    // Get all input-like elements
    const inputs = form.querySelectorAll('input, textarea, select');
    const formAction = form.action || window.location.href;

    inputs.forEach((input, index) => {
      const fieldInfo = extractFieldInfo(input, formIndex, index);
      if (fieldInfo) {
        fields.push(fieldInfo);
      }
    });
  });

  // Also consider forms that might be in div containers (some sites don't use <form> tag)
  if (fields.length === 0) {
    const allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select');
    allInputs.forEach((input, index) => {
      const fieldInfo = extractFieldInfo(input, 0, index);
      if (fieldInfo) {
        fields.push(fieldInfo);
      }
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
 * Extract information from a single form field
 */
function extractFieldInfo(input, formIndex, fieldIndex) {
  // Skip certain field types
  if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(input.type)) {
    return null;
  }

  // Get label text
  const label = getFieldLabel(input);

  // Get stable identifier for DOM location
  const locator = getFieldLocator(input);

  const baseInfo = {
    locator,
    type: input.type || (input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName.toLowerCase()),
    name: input.name || '',
    id: input.id || '',
    placeholder: input.placeholder || '',
    label: label || '',
    ariaLabel: input.getAttribute('aria-label') || '',
    required: input.required || false,
    formIndex,
    fieldIndex
  };

  // For select elements, get options
  if (input.tagName === 'SELECT') {
    baseInfo.options = Array.from(input.options).map(opt => ({
      value: opt.value,
      text: opt.text.trim()
    })).filter(opt => opt.text);
  }

  // For textarea, add info
  if (input.tagName === 'TEXTAREA') {
    baseInfo.isTextarea = true;
  }

  return baseInfo;
}

/**
 * Get the label text associated with a form field
 */
function getFieldLabel(input) {
  // Try explicit label association
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label) {
      return label.textContent.trim();
    }
  }

  // Try parent label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    return parentLabel.textContent.replace(input.value, '').trim();
  }

  // Try preceding sibling text
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

  // Try parent's previous sibling
  const parent = input.parentElement;
  if (parent) {
    const parentPrev = parent.previousElementSibling;
    if (parentPrev && parentPrev.textContent && parentPrev.textContent.trim().length < 100) {
      return parentPrev.textContent.trim();
    }
  }

  // Try aria-label
  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // Try placeholder as fallback
  if (input.placeholder) return input.placeholder;

  return '';
}

/**
 * Get a stable locator for DOM element
 * Used to find the element again after mapping
 */
function getFieldLocator(input) {
  // Prefer id as most stable
  if (input.id) {
    return { type: 'id', value: input.id };
  }

  // Next prefer name
  if (input.name) {
    // For name, need to also track form index or form id
    const form = input.closest('form');
    const formId = form?.id || form?.name;
    return { type: 'name', value: input.name, formIndex: Array.from(document.querySelectorAll('form')).indexOf(form) };
  }

  // Use CSS path with data attributes if available
  if (input.dataset.name || input.dataset.field) {
    return { type: 'data', value: input.dataset.name || input.dataset.field };
  }

  // Fallback to XPath-like index
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
 * Find DOM element by locator
 */
export function findElementByLocator(locator) {
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
 * Match form fields to standard fields using keyword matching
 * Returns array of { locator, standardField, confidence }
 */
export function matchFieldsByKeywords(formMetadata) {
  const matches = [];

  for (const field of formMetadata.fields) {
    const match = matchSingleField(field);
    if (match) {
      matches.push(match);
    }
  }

  return matches;
}

/**
 * Test if a string matches any pattern in an array
 */
function matchesPatterns(text, patterns) {
  if (!text || !patterns) return false;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Get the match score for a string against patterns
 * Returns the number of patterns that matched
 */
function getPatternMatchScore(text, patterns) {
  if (!text || !patterns) return 0;
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      count++;
    }
  }
  return count;
}

/**
 * Match a single field to standard field using regex patterns
 */
function matchSingleField(field) {
  const scores = {};

  // Combine all text attributes for matching
  const fieldTexts = {
    name: field.name || '',
    id: field.id || '',
    label: field.label || '',
    placeholder: field.placeholder || '',
    ariaLabel: field.ariaLabel || ''
  };

  // Calculate score for each standard field
  for (const [standardField, config] of Object.entries(FIELD_PATTERNS)) {
    let score = 0;
    let excludeMatch = false;

    // Check exclude patterns first
    if (config.excludePatterns) {
      for (const attr of ['name', 'id', 'label', 'placeholder', 'ariaLabel']) {
        if (matchesPatterns(fieldTexts[attr], config.excludePatterns)) {
          excludeMatch = true;
          break;
        }
      }
    }

    // Skip this standard field if excluded
    if (excludeMatch) {
      continue;
    }

    // Check type match
    if (config.type && field.type === config.type) {
      score += (config.weights.type || 2) * 2;
    }

    // Check textarea match
    if (config.isTextarea && field.isTextarea) {
      score += config.weights.textarea || 3;
    }

    // Check select match
    if (config.isSelect && field.type === 'select-one') {
      score += 3;
    }

    // Check patterns against all text attributes
    const patternWeight = config.weights.pattern || 3;
    for (const attr of ['name', 'id', 'label', 'placeholder', 'ariaLabel']) {
      const text = fieldTexts[attr];
      if (text) {
        const matchCount = getPatternMatchScore(text, config.patterns);
        if (matchCount > 0) {
          // Name and ID are more reliable indicators
          const attrMultiplier = (attr === 'name' || attr === 'id') ? 1.5 : 1;
          score += matchCount * patternWeight * attrMultiplier;
        }
      }
    }

    // Check context patterns (require multiple attributes to match)
    if (config.contextPatterns) {
      let contextMatches = 0;
      for (const attr of ['label', 'placeholder', 'ariaLabel']) {
        if (matchesPatterns(fieldTexts[attr], config.contextPatterns)) {
          contextMatches++;
        }
      }
      if (contextMatches > 0) {
        score += contextMatches * (config.weights.context || 2);
      }
    }

    if (score > 0) {
      scores[standardField] = score;
    }
  }

  // Find best match
  let bestField = null;
  let bestScore = 0;

  for (const [fieldName, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestField = fieldName;
    }
  }

  // Minimum confidence threshold
  if (bestScore < 3) {
    return null;
  }

  // Normalize confidence (0-1)
  const confidence = Math.min(bestScore / 10, 1);

  return {
    locator: field.locator,
    standardField: bestField,
    confidence,
    method: 'keyword',
    fieldInfo: {
      name: field.name,
      label: field.label,
      type: field.type
    }
  };
}

/**
 * Build LLM prompt from form metadata
 */
export function buildLLMPrompt(formMetadata) {
  const fields = formMetadata.fields.map((f, i) => {
    let info = `Field ${i + 1}:\n`;
    info += `  - Type: ${f.type}\n`;
    if (f.name) info += `  - Name: ${f.name}\n`;
    if (f.id) info += `  - ID: ${f.id}\n`;
    if (f.label) info += `  - Label: ${f.label}\n`;
    if (f.placeholder) info += `  - Placeholder: ${f.placeholder}\n`;
    if (f.ariaLabel) info += `  - Aria Label: ${f.ariaLabel}\n`;
    if (f.options) {
      info += `  - Options: ${f.options.map(o => o.text).join(', ')}\n`;
    }
    return info;
  }).join('\n');

  const standardFieldsList = Object.values(STANDARD_FIELDS).join(', ');

  return `You are analyzing a web form for a navigation site submission page.

Standard fields that this form might have: ${standardFieldsList}

Form fields found:
${fields}

Task: Map each form field to ONE of the standard fields listed above.
- If a field clearly matches a standard field, return the standard field name
- If it doesn't match any standard field, use "unknown"
- Return ONLY a JSON array of objects with this format:
  [{"fieldIndex": 0, "standardField": "siteName"}, {"fieldIndex": 1, "standardField": "email"}, ...]

Where fieldIndex is the 0-based index of the field in the form (from the list above).

Return ONLY the JSON array, nothing else.`;
}

/**
 * Parse LLM response and create field mappings
 */
export function parseLLMMapping(llmResponse, formMetadata) {
  try {
    // Try to parse JSON from response
    let jsonStr = llmResponse.trim();

    // Extract JSON if there's extra text
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const mappings = JSON.parse(jsonStr);
    const result = [];

    for (const mapping of mappings) {
      const field = formMetadata.fields[mapping.fieldIndex];
      if (!field) continue;

      // Validate standard field
      const isValidField = Object.values(STANDARD_FIELDS).includes(mapping.standardField);
      if (!isValidField && mapping.standardField !== 'unknown') continue;

      result.push({
        locator: field.locator,
        standardField: mapping.standardField === 'unknown' ? null : mapping.standardField,
        confidence: 0.8,
        method: 'llm',
        fieldInfo: {
          name: field.name,
          label: field.label,
          type: field.type
        }
      });
    }

    return result;
  } catch (e) {
    console.error('[FormRecognizer] Failed to parse LLM response:', e);
    return null;
  }
}

export default {
  extractFormMetadata,
  findElementByLocator,
  matchFieldsByKeywords,
  buildLLMPrompt,
  parseLLMMapping
};
