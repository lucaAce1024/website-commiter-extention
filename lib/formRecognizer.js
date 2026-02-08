/**
 * Form Recognizer - Keyword-based form field detection
 * Fallback when LLM is not available or fails
 */

import { STANDARD_FIELDS } from './storage.js';

// Keywords for each standard field type
const FIELD_KEYWORDS = {
  [STANDARD_FIELDS.SITE_NAME]: {
    keywords: ['site', 'name', 'title', 'website', 'webname', 'sitename', '网站名', '站点名', '网站名称'],
    weights: { name: 3, title: 2, placeholder: 1, label: 2 }
  },
  [STANDARD_FIELDS.EMAIL]: {
    keywords: ['email', 'mail', 'contact', '邮箱', '联系邮箱', '联系邮件'],
    type: 'email',
    weights: { type: 3, name: 2, placeholder: 1 }
  },
  [STANDARD_FIELDS.SITE_URL]: {
    keywords: ['url', 'website', 'link', 'href', 'site', '网址', '网站地址', '链接', 'siteurl', 'websiteurl'],
    type: 'url',
    weights: { type: 2, name: 2, placeholder: 1 }
  },
  [STANDARD_FIELDS.CATEGORY]: {
    keywords: ['category', 'cat', 'type', 'class', '分类', '类别', '类型'],
    isSelect: true,
    weights: { name: 2, label: 2 }
  },
  [STANDARD_FIELDS.TAGLINE]: {
    keywords: ['tagline', 'slogan', 'motto', 'tag', '标语', '口号', 'slogan'],
    weights: { name: 2, placeholder: 1 }
  },
  [STANDARD_FIELDS.SHORT_DESCRIPTION]: {
    keywords: ['short', 'desc', 'description', 'summary', 'intro', 'brief', '简介', '简述', '描述', 'shortdesc'],
    weights: { name: 2, placeholder: 1 }
  },
  [STANDARD_FIELDS.LONG_DESCRIPTION]: {
    keywords: ['long', 'detail', 'description', 'content', 'about', 'info', '详细', '介绍', '描述', '详情', 'detail', 'longdesc'],
    isTextarea: true,
    weights: { name: 2, placeholder: 1 }
  },
  [STANDARD_FIELDS.LOGO]: {
    keywords: ['logo', 'icon', 'image', 'logo', '图标', '标志'],
    type: 'url',
    weights: { name: 2, placeholder: 1 }
  },
  [STANDARD_FIELDS.SCREENSHOT]: {
    keywords: ['screenshot', 'shot', 'capture', 'screen', 'preview', '截图', '预览图', '截图'],
    type: 'url',
    weights: { name: 2, placeholder: 1 }
  }
};

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
 * Match a single field to standard field
 */
function matchSingleField(field) {
  const scores = {};

  // Calculate score for each standard field
  for (const [standardField, config] of Object.entries(FIELD_KEYWORDS)) {
    let score = 0;

    // Check type match
    if (config.type && field.type === config.type) {
      score += config.weights.type * 2;
    }
    if (config.isTextarea && field.isTextarea) {
      score += 3;
    }
    if (config.isSelect && field.type === 'select-one') {
      score += 3;
    }

    // Check keywords in name
    const nameLower = field.name.toLowerCase();
    for (const kw of config.keywords) {
      if (nameLower.includes(kw.toLowerCase())) {
        score += config.weights.name || 1;
      }
    }

    // Check keywords in id
    const idLower = field.id.toLowerCase();
    for (const kw of config.keywords) {
      if (idLower.includes(kw.toLowerCase())) {
        score += config.weights.name || 1;
      }
    }

    // Check keywords in label
    const labelLower = field.label.toLowerCase();
    for (const kw of config.keywords) {
      if (labelLower.includes(kw.toLowerCase())) {
        score += config.weights.label || 1;
      }
    }

    // Check keywords in placeholder
    const placeholderLower = field.placeholder.toLowerCase();
    for (const kw of config.keywords) {
      if (placeholderLower.includes(kw.toLowerCase())) {
        score += config.weights.placeholder || 1;
      }
    }

    // Check aria-label
    const ariaLabelLower = field.ariaLabel.toLowerCase();
    for (const kw of config.keywords) {
      if (ariaLabelLower.includes(kw.toLowerCase())) {
        score += (config.weights.label || 1);
      }
    }

    if (score > 0) {
      scores[standardField] = score;
    }
  }

  // Find best match
  let bestField = null;
  let bestScore = 0;

  for (const [field, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  // Minimum confidence threshold
  if (bestScore < 2) {
    return null;
  }

  // Normalize confidence (0-1)
  const confidence = Math.min(bestScore / 8, 1);

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
