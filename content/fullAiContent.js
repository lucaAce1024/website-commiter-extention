/**
 * 完全 AI 识别 - Content Script
 * 感知层：Snapshot 采集（DOM 遍历、UID 分配、文本格式化）
 * 行动层：按 UID 执行 click/fill
 * 参考 AIPex dom-snapshot 与 dom-locator，使用 data-wce-nodeid 与现有扩展区分
 */
(function () {
  'use strict';

  const NODE_ID_ATTR = 'data-wce-nodeid';
  const MAX_SNAPSHOT_TEXT_LENGTH = 12000;
  const MAX_NAME_LENGTH = 160;

  const TYPING_DELAY_MIN_MS = 50;
  const TYPING_DELAY_MAX_MS = 200;
  const TYPING_CHUNK_THRESHOLD = 200;
  const FOCUS_BEFORE_TYPE_MS = 120;
  const STEP_DELAY_MIN_MS = 280;
  const STEP_DELAY_MAX_MS = 500;
  const TRAVERSE_MAX_DEPTH = 200;

  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'meta', 'link']);
  const INTERACTIVE_TAGS = new Set(['a', 'button', 'summary', 'details', 'select', 'textarea', 'input', 'label', 'video', 'audio']);
  const INPUT_TYPES_AS_ROLE = {
    button: 'button', submit: 'button', reset: 'button', image: 'button',
    checkbox: 'checkbox', radio: 'radio', range: 'slider',
    email: 'textbox', search: 'searchbox', url: 'textbox', number: 'spinbutton',
    password: 'textbox', text: 'textbox'
  };
  const INTERACTIVE_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'menuitem', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox']);
  const LAYOUT_ROLES = new Set(['generic', 'article', 'section', 'region', 'group', 'main', 'complementary', 'navigation', 'banner', 'contentinfo']);
  const SKIP_ROLES_OUTPUT = ['generic', 'none', 'group', 'main', 'navigation', 'contentinfo', 'search', 'banner', 'complementary', 'region', 'article', 'section'];

  function generateShortId() {
    const random = Math.random().toString(36).slice(2, 8);
    const time = Date.now().toString(36).slice(-4);
    return `wce-${time}${random}`;
  }

  function ensureElementUid(element) {
    const existing = element.getAttribute(NODE_ID_ATTR);
    if (existing) return existing;
    const uid = generateShortId();
    element.setAttribute(NODE_ID_ATTR, uid);
    return uid;
  }

  function truncate(str, maxLen) {
    if (!str || typeof str !== 'string') return str || '';
    return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
  }

  function normalizeTextContent(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function isElementHidden(element, rootDocument) {
    if (element.getAttribute('aria-hidden') === 'true') return true;
    if (element.hasAttribute('hidden')) return true;
    if (element.hasAttribute('inert')) return true;
    if (element instanceof HTMLElement) {
      const style = rootDocument.defaultView?.getComputedStyle(element);
      if (style?.display === 'none') return true;
    }
    return false;
  }

  function isElementVisible(element, rootDocument) {
    if (!(element instanceof HTMLElement)) return true;
    const style = rootDocument.defaultView?.getComputedStyle(element);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  function resolveRole(element) {
    const explicitRole = element.getAttribute('role');
    if (explicitRole) return explicitRole;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a') return (element.href || '').trim() ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'img') return 'image';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      const type = ((element.type || 'text') + '').toLowerCase();
      return INPUT_TYPES_AS_ROLE[type] || 'textbox';
    }
    if (element instanceof HTMLElement && element.isContentEditable) return 'textbox';
    return 'generic';
  }

  function extractVisibleTextContent(element) {
    const texts = [];
    function traverse(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent?.trim();
        if (t) texts.push(t);
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        if (SKIP_TAGS.has(el.tagName?.toLowerCase())) return;
        for (const child of Array.from(node.childNodes)) traverse(child);
      }
    }
    traverse(element);
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function resolveAccessibleName(element, rootDocument) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/).map(s => s.trim()).filter(Boolean);
      const texts = ids.map(id => {
        const t = rootDocument.getElementById(id);
        return t ? normalizeTextContent(t.textContent || '') : '';
      }).filter(Boolean);
      if (texts.length) return texts.join(' ');
    }
    if (element instanceof HTMLImageElement && element.alt) return element.alt.trim();
    if (element instanceof HTMLInputElement) {
      if (element.placeholder) return element.placeholder;
      if (element.type === 'submit' || element.type === 'button') return element.value || 'Submit';
    }
    if (element instanceof HTMLButtonElement && element.textContent) return normalizeTextContent(element.textContent);
    if (element instanceof HTMLAnchorElement) {
      const t = normalizeTextContent(element.textContent || '');
      if (t) return t;
    }
    const role = resolveRole(element);
    const tagName = element.tagName?.toLowerCase();
    if (INTERACTIVE_ROLES.has(role) || INTERACTIVE_TAGS.has(tagName)) {
      return extractVisibleTextContent(element) || null;
    }
    return null;
  }

  function resolveElementValue(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'password') return '*'.repeat(element.value.length);
      return element.value || undefined;
    }
    if (element instanceof HTMLTextAreaElement) return element.value || undefined;
    if (element instanceof HTMLSelectElement) {
      const sel = element.selectedOptions?.[0];
      return sel ? sel.value : undefined;
    }
    if (element instanceof HTMLElement && element.isContentEditable) return normalizeTextContent(element.textContent) || undefined;
    return undefined;
  }

  function hasCursorPointer(element, rootDocument) {
    if (!(element instanceof HTMLElement)) return false;
    const style = rootDocument.defaultView?.getComputedStyle(element);
    return style?.cursor === 'pointer';
  }

  function hasExplicitAccessibleLabel(element, rootDocument) {
    if (element.getAttribute('aria-label')?.trim?.()?.length > 1) return true;
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\s+/).map(s => s.trim()).filter(Boolean);
      const labelText = ids.map(id => rootDocument.getElementById(id)?.textContent?.trim() || '').filter(Boolean).join(' ');
      if (labelText.length > 1) return true;
    }
    return false;
  }

  function shouldIncludeElement(element, rootDocument) {
    if (!isElementVisible(element, rootDocument)) return false;
    const role = resolveRole(element);
    const name = resolveAccessibleName(element, rootDocument);
    const hasMeaningfulName = Boolean(name && name.trim().length > 1);
    if (INTERACTIVE_ROLES.has(role)) return true;
    if (INTERACTIVE_TAGS.has(element.tagName?.toLowerCase())) return true;
    if (element instanceof HTMLElement && element.isContentEditable) return true;
    if (hasCursorPointer(element, rootDocument)) return true;
    if (role === 'image' && element.alt?.trim?.()) return true;
    if (hasExplicitAccessibleLabel(element, rootDocument)) return true;
    if (!LAYOUT_ROLES.has(role) && hasMeaningfulName) return true;
    const normalizedText = normalizeTextContent(element.textContent || '');
    if (normalizedText.length >= 2 && !LAYOUT_ROLES.has(role)) return true;
    return false;
  }

  function createNodeFromElement(element, rootDocument, idToNode) {
    const nodeId = ensureElementUid(element);
    const role = resolveRole(element);
    const name = resolveAccessibleName(element, rootDocument);
    const value = resolveElementValue(element);

    const node = {
      id: nodeId,
      role: role || 'generic',
      name: name || undefined,
      value: value,
      children: [],
      tagName: element.tagName?.toLowerCase()
    };

    if (element instanceof HTMLElement) {
      node.disabled = element.getAttribute('aria-disabled') === 'true' || Boolean(element.disabled);
    }

    if (element instanceof HTMLInputElement) {
      node.inputType = element.type;
      if (element.placeholder) node.placeholder = element.placeholder;
      if (element.type === 'checkbox' || element.type === 'radio') node.checked = element.checked;
    }
    if (element instanceof HTMLTextAreaElement) {
      node.inputType = 'textarea';
      if (element.placeholder) node.placeholder = element.placeholder;
    }
    if (element instanceof HTMLAnchorElement) node.href = element.href;

    if (element.id && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      const label = rootDocument.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) node.labelText = normalizeTextContent(label.textContent);
    }

    idToNode[nodeId] = node;
    return node;
  }

  function traverseElement(element, rootDocument, idToNode, depth = 0) {
    if (depth >= TRAVERSE_MAX_DEPTH) return [];
    const tagName = element.tagName?.toLowerCase();
    if (SKIP_TAGS.has(tagName)) return [];
    if (isElementHidden(element, rootDocument)) return [];

    const childrenNodes = [];
    for (const child of Array.from(element.children)) {
      if (child.tagName?.toLowerCase() === 'iframe') continue;
      const childResults = traverseElement(child, rootDocument, idToNode, depth + 1);
      childrenNodes.push(...childResults);
    }

    if (!shouldIncludeElement(element, rootDocument)) {
      if (childrenNodes.length === 1) return childrenNodes;
      if (childrenNodes.length > 1) {
        const synthetic = createNodeFromElement(element, rootDocument, idToNode);
        synthetic.children = childrenNodes;
        return [synthetic];
      }
      return [];
    }

    const node = createNodeFromElement(element, rootDocument, idToNode);
    node.children = childrenNodes;
    return [node];
  }

  function collectDomSnapshot(rootDocument, scopeRootSelector) {
    const idToNode = {};
    let rootEl = rootDocument?.body || rootDocument?.documentElement;
    if (scopeRootSelector && rootDocument) {
      try {
        const scoped = rootDocument.querySelector(scopeRootSelector);
        if (scoped) rootEl = scoped;
      } catch (_) {
        // 无效 selector 时回退到整页
      }
    }
    if (!rootEl) return { root: null, idToNode, totalNodes: 0, url: rootDocument?.URL || '', title: rootDocument?.title || '' };

    const rootNode = {
      id: ensureElementUid(rootEl),
      role: 'RootWebArea',
      name: rootDocument.title || rootDocument.URL || 'document',
      children: [],
      tagName: rootEl.tagName?.toLowerCase()
    };
    idToNode[rootNode.id] = rootNode;

    const childNodes = traverseElement(rootEl, rootDocument, idToNode);
    rootNode.children = childNodes;

    return {
      root: rootNode,
      idToNode,
      totalNodes: Object.keys(idToNode).length,
      url: rootDocument.URL || '',
      title: rootDocument.title || ''
    };
  }

  function shouldIncludeInOutput(node) {
    const role = node.role || '';
    const name = node.name || '';
    if (role === 'RootWebArea') return true;
    if (['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'slider', 'spinbutton', 'searchbox', 'switch'].includes(role)) return true;
    if (role === 'image' || role === 'img') return true;
    if (role === 'StaticText' && name && name.trim().length >= 2) return true;
    if (SKIP_ROLES_OUTPUT.includes(role)) return false;
    if (name && name.trim().length > 1) return true;
    return false;
  }

  function formatNode(node, depth, snapshotTextParts) {
    if (!node) return;
    const shouldInclude = shouldIncludeInOutput(node);
    if (!shouldInclude && node.role === 'StaticText') return;
    if (!shouldInclude) {
      for (const child of node.children || []) formatNode(child, depth, snapshotTextParts);
      return;
    }

    const indent = '  '.repeat(depth);
    const attrs = [];
    if (node.role !== 'StaticText') attrs.push(`uid=${node.id}`);
    attrs.push(node.role);
    attrs.push(`"${truncate(node.name || '', MAX_NAME_LENGTH)}"`);
    if (node.tagName) attrs.push(`<${node.tagName}>`);
    if (node.value !== undefined && node.value !== null) attrs.push(`value="${truncate(String(node.value), MAX_NAME_LENGTH)}"`);
    if (node.inputType) attrs.push(`inputType="${node.inputType}"`);
    if (node.disabled) attrs.push('disabled');
    if (node.placeholder) attrs.push(`placeholder="${truncate(node.placeholder, 80)}"`);
    if (node.labelText) attrs.push(`labelText="${truncate(node.labelText, 80)}"`);

    snapshotTextParts.push(indent + attrs.join(' '));

    for (const child of node.children || []) formatNode(child, depth + 1, snapshotTextParts);
  }

  function formatSnapshotToText(snapshotResult) {
    const parts = [];
    if (snapshotResult.root) formatNode(snapshotResult.root, 0, parts);
    let text = parts.join('\n');
    if (text.length > MAX_SNAPSHOT_TEXT_LENGTH) text = text.slice(0, MAX_SNAPSHOT_TEXT_LENGTH) + '\n...[truncated]';
    return text;
  }

  function takeSnapshot(scopeRootSelector) {
    if (typeof document === 'undefined' || !document.body) {
      return { success: false, error: '页面 DOM 未就绪' };
    }
    try {
      const snapshotResult = collectDomSnapshot(document, scopeRootSelector);
      if (snapshotResult.root === null) {
        return { success: false, error: '无法定位根节点' };
      }
      const snapshotText = formatSnapshotToText(snapshotResult);
      if (!snapshotText || snapshotText.length === 0) {
        return { success: false, error: 'Snapshot 内容为空' };
      }
      return { success: true, snapshotText, snapshotResult };
    } catch (err) {
      const msg = err?.message || err?.toString?.() || '未知异常';
      return { success: false, error: `Snapshot 采集失败: ${msg}` };
    }
  }

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
  }

  function queryByUid(uid) {
    const selector = `[${NODE_ID_ATTR}="${cssEscape(uid)}"]`;
    return document.querySelector(selector);
  }

  function isHTMLElement(el) {
    return el && typeof el.style !== 'undefined' && typeof el.click === 'function';
  }

  function isInputElement(el) {
    return el && el.tagName?.toLowerCase() === 'input' && 'value' in el && typeof el.value === 'string';
  }

  function isTextAreaElement(el) {
    return el && el.tagName?.toLowerCase() === 'textarea' && 'value' in el && typeof el.value === 'string';
  }

  function isContentEditable(el) {
    return isHTMLElement(el) && el.isContentEditable === true;
  }

  function randomDelayMs() {
    return TYPING_DELAY_MIN_MS + Math.floor(Math.random() * (TYPING_DELAY_MAX_MS - TYPING_DELAY_MIN_MS + 1));
  }

  function randomPostStepDelayMs() {
    return STEP_DELAY_MIN_MS + Math.floor(Math.random() * (STEP_DELAY_MAX_MS - STEP_DELAY_MIN_MS + 1));
  }

  function simulateClick(el, useCoordinates = false) {
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    let opts = { bubbles: true, cancelable: true, view: window };
    if (useCoordinates) {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      opts = { ...opts, clientX: x, clientY: y, screenX: x, screenY: y };
    }
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  async function typeIntoElementWithDelay(input, text) {
    const str = text != null ? String(text) : '';
    input.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    simulateClick(input, true);
    input.focus();
    input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await new Promise((r) => setTimeout(r, FOCUS_BEFORE_TYPE_MS));

    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    const setValue = (val) => {
      try {
        if (descriptor && descriptor.set) descriptor.set.call(input, val);
        else input.value = val;
      } catch (_) {
        input.value = val;
      }
    };

    setValue('');
    const useChunks = str.length > TYPING_CHUNK_THRESHOLD;
    const chunkSize = useChunks ? 4 : 1;
    for (let i = 0; i < str.length; i += chunkSize) {
      const chunk = str.slice(i, i + chunkSize);
      setValue(str.slice(0, i + chunk.length));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (i + chunk.length < str.length) {
        await new Promise((r) => setTimeout(r, randomDelayMs()));
      }
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    input.blur();
  }

  function executeClick(element) {
    if (!isHTMLElement(element)) return { ok: false, error: 'element_not_found' };
    try {
      simulateClick(element, true);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'click failed' };
    }
  }

  async function executeFill(element, value) {
    if (isInputElement(element) || isTextAreaElement(element)) {
      try {
        await typeIntoElementWithDelay(element, value || '');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || 'fill failed' };
      }
    }
    if (isContentEditable(element)) {
      try {
        element.focus();
        element.textContent = value || '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || 'fill failed' };
      }
    }
    return { ok: false, error: 'Element is not an input or textarea' };
  }

  function executeCheck(element, checked) {
    if (!element || typeof element.checked === 'undefined') return { ok: false, error: 'not_checkbox' };
    try {
      if (element.checked !== !!checked) {
        element.click();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || 'check failed' };
    }
  }

  async function executeSteps(steps) {
    const results = [];
    for (let i = 0; i < (steps || []).length; i++) {
      const step = steps[i];
      const { op, uid, value, checked } = step;
      const element = queryByUid(uid);
      if (!element) {
        results.push({ op, uid, ok: false, error: 'element_not_found' });
        continue;
      }
      let out;
      if (op === 'click') {
        out = executeClick(element);
      } else if (op === 'fill') {
        out = await executeFill(element, value || '');
      } else if (op === 'check') {
        out = executeCheck(element, checked !== false);
      } else {
        out = { ok: false, error: `unknown op: ${op}` };
      }
      results.push({ op, uid, ...out });
      if (i < steps.length - 1) {
        await new Promise((r) => setTimeout(r, randomPostStepDelayMs()));
      }
    }
    const allOk = results.every(r => r.ok);
    return { success: allOk, results };
  }

  // ─── 弹窗预处理（Cookie/GDPR/隐私同意弹窗） ───

  const OVERLAY_SELECTORS = [
    '[class*="cookie"] button[class*="accept"]',
    '[class*="cookie"] button[class*="agree"]',
    '[id*="cookie"] button[class*="accept"]',
    '[id*="cookie"] button[class*="agree"]',
    '[class*="consent"] button[class*="accept"]',
    '.cc-compliance .cc-btn',
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '[data-testid*="cookie-accept"]',
    '[class*="gdpr"] button[class*="accept"]',
    '[class*="privacy"] button[class*="accept"]',
    '[role="dialog"] button[class*="accept"]',
    '[role="dialog"] button[class*="agree"]',
    '.cookie-notice .cookie-notice-accept',
    '#cookie-law-info-bar .cli-plugin-button',
    '.cmplz-btn.cmplz-accept',
  ];

  const OVERLAY_BUTTON_TEXT = [
    /accept\s*(all)?/i, /agree/i, /allow\s*(all)?/i,
    /got\s*it/i, /i\s*understand/i, /^ok(ay)?$/i,
    /同意/i, /接受/i, /允许/i, /确定/i, /我知道了/i,
    /akzeptieren/i, /zustimmen/i, /alle akzeptieren/i,
    /accepter/i, /aceptar/i, /accetta/i,
    /承諾/i, /同意する/i, /수락/i, /принять/i,
  ];

  function isElementVisibleForOverlay(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findOverlayButtonBySelector() {
    for (const sel of OVERLAY_SELECTORS) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (isElementVisibleForOverlay(el)) return el;
        }
      } catch (_) { /* invalid selector */ }
    }
    return null;
  }

  function findOverlayButtonInFixedElements() {
    const allEls = document.querySelectorAll('*');
    const fixedContainers = [];
    for (const el of allEls) {
      if (!(el instanceof HTMLElement)) continue;
      const style = window.getComputedStyle(el);
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') continue;
      const z = parseInt(style.zIndex, 10);
      if (isNaN(z) || z < 100) continue;
      if (!isElementVisibleForOverlay(el)) continue;
      fixedContainers.push(el);
    }

    for (const container of fixedContainers) {
      const btns = container.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]');
      for (const btn of btns) {
        if (!isElementVisibleForOverlay(btn)) continue;
        const text = (btn.textContent || btn.value || '').trim();
        if (!text || text.length > 50) continue;
        for (const pattern of OVERLAY_BUTTON_TEXT) {
          if (pattern.test(text)) return btn;
        }
      }
    }
    return null;
  }

  async function dismissOverlays(maxRounds = 2) {
    const result = { dismissed: false, rounds: 0, clickedSelectors: [] };
    for (let round = 0; round < maxRounds; round++) {
      let btn = findOverlayButtonBySelector();
      let source = 'selector';
      if (!btn) {
        btn = findOverlayButtonInFixedElements();
        source = 'fixed-text';
      }
      if (!btn) break;

      const desc = btn.id || btn.className?.toString().slice(0, 40) || btn.textContent?.trim().slice(0, 20) || 'unknown';
      try {
        btn.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        btn.click();
        result.dismissed = true;
        result.rounds = round + 1;
        result.clickedSelectors.push(`${source}:${desc}`);
      } catch (_) { break; }

      await new Promise(r => setTimeout(r, 800));

      if (!isElementVisibleForOverlay(btn) || !document.body.contains(btn)) {
        continue;
      }
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'dismissOverlays') {
      dismissOverlays(request.maxRounds || 2)
        .then(sendResponse)
        .catch(() => sendResponse({ dismissed: false, error: '弹窗处理异常' }));
      return true;
    }
    if (request.action === 'fullAiTakeSnapshot') {
      const result = takeSnapshot(request.scopeRootSelector);
      sendResponse(result);
      return false;
    }
    if (request.action === 'fullAiExecute') {
      executeSteps(request.steps)
        .then(sendResponse)
        .catch((err) => sendResponse({ success: false, error: err?.message || '执行异常', results: [] }));
      return true;
    }
  });

  if (typeof window !== 'undefined') {
    window.__wce_dismissOverlays = dismissOverlays;
  }
})();
