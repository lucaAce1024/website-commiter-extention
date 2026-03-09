/**
 * 完全 AI 识别 - 控制层 + 协议层（程序主控）
 * 流程：1) 多轮弹窗处理 → 2) 表单 Snapshot → 3) 程序启发式元素映射 → 4) 固定顺序执行
 * AI 仅用于生成评论；定位与执行由程序控制，见 doc/5.完全AI识别提交方案/6.收敛方案-程序主控.md
 */
(function (global) {
  'use strict';

  const ROUND_TIMEOUT_MS = 120000;
  const TASK_TIMEOUT_MS = 150000;

  const SLOT_KEYWORDS = {
    name: ['name', 'author', '姓名', '昵称', 'your name', 'display name'],
    email: ['email', 'mail', '邮箱', 'e-mail', 'your email'],
    website: ['website', 'url', 'site', '网址', '链接', 'homepage', 'web'],
    comment: ['comment', 'message', '内容', '评论', '留言', 'reply', 'comment body', 'write']
  };
  const SUBMIT_KEYWORDS = ['submit', 'post', 'comment', '发布', '提交', 'send', '发表', 'post comment', 'submit comment'];
  const CHECKBOX_KEYWORDS = ['notify', 'agree', 'terms', 'robot', '机器人', '同意', '条款', 'not a robot', 'privacy', 'notify me'];

  function norm(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function scoreSlot(text, keywords) {
    if (!text) return 0;
    const t = norm(text);
    for (const kw of keywords) {
      if (t.includes(norm(kw))) return 1;
    }
    return 0;
  }

  function parseSimpleMath(nameOrPlaceholder) {
    const s = String(nameOrPlaceholder || '');
    const add = s.match(/(\d+)\s*\+\s*(\d+)/);
    if (add) return Number(add[1]) + Number(add[2]);
    const sub = s.match(/(\d+)\s*-\s*(\d+)/);
    if (sub) return Number(sub[1]) - Number(sub[2]);
    return null;
  }

  function isHumanVerificationField(node) {
    const t = norm((node.name || '') + ' ' + (node.placeholder || ''));
    return /\d+\s*[\+\-]\s*\d+/.test(t) || t.includes('验证') || t.includes('captcha') || t.includes('算术');
  }

  /**
   * 从 Snapshot 的 idToNode 启发式映射出 fills/checks/clicks，程序主控、无缓存也可用
   * @param {{ idToNode: Record<string, { id: string, role: string, name?: string, placeholder?: string, value?: string }> }} snapshotResult
   * @param {{ comment: string, commentName: string, commentEmail: string, commentWebsite: string }} fillData
   * @returns {{ steps: Array<{ op: string, uid: string, value?: string, checked?: boolean }>, error?: string }}
   */
  function buildStepsFromSnapshot(snapshotResult, fillData) {
    const idToNode = snapshotResult?.idToNode || {};
    const nodes = Object.values(idToNode);
    const steps = [];
    const used = new Set();

    const inputRoles = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);
    const inputs = nodes.filter((n) => n && n.id && inputRoles.has(n.role));
    const buttons = nodes.filter((n) => n && n.id && (n.role === 'button' || n.role === 'link'));
    const checkboxes = nodes.filter((n) => n && n.id && n.role === 'checkbox');

    const slotCandidates = { name: [], email: [], website: [], comment: [] };
    let humanVerificationNode = null;

    for (const n of inputs) {
      const name = (n.name || '') + ' ' + (n.placeholder || '');
      if (isHumanVerificationField(n)) {
        humanVerificationNode = n;
        continue;
      }
      for (const [slot, keywords] of Object.entries(SLOT_KEYWORDS)) {
        const score = scoreSlot(name, keywords);
        if (score) slotCandidates[slot].push({ node: n, score });
      }
    }

    const pick = (slot, fillValue) => {
      const list = slotCandidates[slot];
      if (!list.length) return;
      list.sort((a, b) => b.score - a.score);
      const best = list[0].node;
      if (used.has(best.id)) return;
      if (fillValue == null || fillValue === '') return;
      used.add(best.id);
      steps.push({ op: 'fill', uid: best.id, value: String(fillValue) });
    };

    pick('name', fillData.commentName);
    pick('email', fillData.commentEmail);
    pick('website', fillData.commentWebsite);
    pick('comment', fillData.comment);

    if (humanVerificationNode && !used.has(humanVerificationNode.id)) {
      const answer = parseSimpleMath(humanVerificationNode.name || humanVerificationNode.placeholder);
      if (answer != null) {
        steps.push({ op: 'fill', uid: humanVerificationNode.id, value: String(answer) });
        used.add(humanVerificationNode.id);
      }
    }

    for (const n of checkboxes) {
      const name = (n.name || '') + ' ';
      if (!scoreSlot(name, CHECKBOX_KEYWORDS)) continue;
      if (used.has(n.id)) continue;
      used.add(n.id);
      steps.push({ op: 'check', uid: n.id, checked: true });
    }

    let submitNode = null;
    for (const n of buttons) {
      const name = (n.name || '') + ' ';
      if (!scoreSlot(name, SUBMIT_KEYWORDS)) continue;
      if (used.has(n.id)) continue;
      submitNode = n;
      break;
    }
    if (submitNode) {
      steps.push({ op: 'click', uid: submitNode.id });
    }

    const hasComment = steps.some((s) => s.op === 'fill' && s.value === fillData.comment);
    const hasSubmit = steps.some((s) => s.op === 'click');
    if (!hasComment) {
      return { steps: [], error: '未匹配到评论输入框' };
    }
    if (!hasSubmit) {
      return { steps: [], error: '未匹配到提交按钮' };
    }
    return { steps };
  }

  const SYSTEM_PROMPT_LEGACY = `你是评论表单自动化助手。根据表单 Snapshot 一次性输出完整执行计划。
仅输出一个 JSON 对象，不要 markdown 代码块、不要其他解释。

输出格式：
{
  "fills": [ { "uid": "xxx", "value": "填写内容" } ],
  "checks": [ { "uid": "xxx", "checked": true } ],
  "clicks": [ { "uid": "xxx" } ],
  "done": true
}

规则：
- fills：必须包含 Name*、Email*、Website、Comment* 的填写（当待填数据有值时）。value 必须与下方「待填数据」完全一致。若存在人机验证（如简单算术 2+3=?），在 fills 中填入正确答案。fills 数量至少等于有值的待填数据项数
- checks：勾选必要的 checkbox，如 Notify me、同意条款、「我不是机器人」/I'm not a robot 等，checked 为 true 表示勾选
- clicks：必须包含提交/发布按钮（Post Comment/Submit/发布/提交 等），clicks 数组最后一项必须是提交按钮
- 执行顺序：先 fills（含人机验证），再 checks，最后 clicks。未填全必填项时点击提交会失败，故 fills 不可遗漏`;

  function buildOneShotPrompt(snapshotText, formHint, fillData) {
    const dataBlock = `【待填数据】
- comment（评论内容，必须包含链接）：${fillData.comment}
- 链接：${fillData.siteUrl}
- commentName（姓名）：${fillData.commentName || '（无）'}
- commentEmail（邮箱）：${fillData.commentEmail || '（无）'}
- commentWebsite（网址）：${fillData.commentWebsite || '（无）'}`;

    const hintBlock = formHint ? `\n【表单检测】${formHint}\n` : '';
    return `${dataBlock}${hintBlock}

【表单 Snapshot】
${snapshotText}

【重要】fills 必须包含以下所有有值字段的填写（缺一不可）：
- commentName → 对应 Name* 输入框
- commentEmail → 对应 Email* 输入框
- commentWebsite → 对应 Website 输入框
- comment → 对应 Comment* 文本框
若存在人机验证（如「2+3=?」），在 fills 中填入正确答案。checks 需勾选 Notify me、「我不是机器人」等必要项。clicks 最后一项必须是 Post Comment/Submit 等提交按钮的 uid。输出完整 JSON 计划。`;
  }

  function extractJsonFromText(text) {
    if (!text || typeof text !== 'string') return null;
    let s = text.trim();
    s = s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const match = s.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  function parseOneShotResponse(content) {
    const obj = extractJsonFromText(content);
    if (!obj) return null;
    const fills = Array.isArray(obj.fills) ? obj.fills : [];
    const checks = Array.isArray(obj.checks) ? obj.checks : [];
    const clicks = Array.isArray(obj.clicks) ? obj.clicks : [];
    const steps = [];
    for (const f of fills) {
      if (f && f.uid) steps.push({ op: 'fill', uid: String(f.uid), value: f.value != null ? String(f.value) : '' });
    }
    for (const c of checks) {
      if (c && c.uid) steps.push({ op: 'check', uid: String(c.uid), checked: c.checked !== false });
    }
    for (const c of clicks) {
      if (c && c.uid) steps.push({ op: 'click', uid: String(c.uid) });
    }
    return { done: Boolean(obj.done), steps };
  }

  function timeout(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  }

  async function runOneShotRound(tabId, snapshotText, formHint, fillData, llmConfig, fetchLlmWithRetry, log) {
    log('一次性规划 · 调用 LLM 输出完整计划...');
    const prompt = buildOneShotPrompt(snapshotText, formHint, fillData);
    const requestBody = {
      model: llmConfig.model || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_LEGACY },
        { role: 'user', content: prompt }
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: 2048
    };
    if (llmConfig.disableThinking !== false) {
      requestBody.thinking = { type: 'disabled' };
    }

    const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
    const response = await fetchLlmWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${llmConfig.apiKey}`
        },
        body: JSON.stringify(requestBody)
      },
      { timeoutMs: ROUND_TIMEOUT_MS - 5000, maxRetries: 1 }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `LLM 请求失败 ${response.status}: ${errText.slice(0, 100)}` };
    }

    const data = await response.json();
    const content = (data?.choices?.[0]?.message?.content || '').trim();
    const parsed = parseOneShotResponse(content);
    if (!parsed) return { success: false, error: 'LLM 返回格式无法解析' };
    if (parsed.steps.length === 0) return { success: false, error: 'LLM 未输出任何操作步骤' };

    const stepsDesc = parsed.steps.map(s => `${s.op}(${s.uid}${s.value != null ? `,"${String(s.value).slice(0, 25)}…"` : ''}${s.checked !== undefined ? `,${s.checked}` : ''})`).join(', ');
    log(`一次性规划 · 执行 ${parsed.steps.length} 个步骤: [${stepsDesc}]`);
    const execRes = await chrome.tabs.sendMessage(tabId, { action: 'fullAiExecute', steps: parsed.steps });
    const execSuccess = execRes?.success === true;
    const failedSteps = (execRes?.results || []).filter((r) => !r.ok);
    if (failedSteps.length > 0) {
      const failedDesc = failedSteps.map((r) => `${r.op}(${r.uid}): ${r.error || 'failed'}`).join('; ');
      log(`执行失败步骤: ${failedDesc}`);
    }
    const hasNotFound = execRes?.results?.some((r) => r.error === 'element_not_found');
    if (hasNotFound && !execSuccess) {
      return { success: false, error: '元素未找到: ' + (failedSteps.map((r) => r.uid).join(', ') || '未知') };
    }
    return { success: execSuccess, reason: execSuccess ? '已执行完整计划' : '执行部分失败' };
  }

  const MAX_OVERLAY_ROUNDS = 3;
  const OVERLAY_WAIT_MS = 1200;

  async function runOverlayDismissRound(tabId, round, llmConfig, fetchLlmWithRetry, log) {
    log(`弹窗处理 · 第 ${round}/${MAX_OVERLAY_ROUNDS} 轮 检测 Cookie/隐私弹窗...`);
    const snapshotRes = await chrome.tabs.sendMessage(tabId, { action: 'fullAiTakeSnapshot', scopeRootSelector: null });
    if (!snapshotRes?.success || !snapshotRes.snapshotText) return { clicked: false, error: snapshotRes?.error };
    const text = snapshotRes.snapshotText;
    const prompt = `页面 Snapshot 中可能存在 Cookie/隐私同意弹窗（遮挡主内容）。请判断：
1）是否存在需要点击关闭的弹窗按钮？如 Accept/Agree/同意/接受/Allow/允许/OK/确定/I understand 等
2）若存在，输出该按钮的 uid；若不存在或已无弹窗，输出 { "uid": null, "hasOverlay": false }

Snapshot（前 4000 字符）：
${text.slice(0, 4000)}

仅输出一个 JSON：{ "uid": "xxx" } 或 { "uid": null, "hasOverlay": false }`;
    const requestBody = {
      model: llmConfig.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: 0.1,
      max_tokens: 150
    };
    if (llmConfig.disableThinking !== false) requestBody.thinking = { type: 'disabled' };
    const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
    const response = await fetchLlmWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmConfig.apiKey}` },
      body: JSON.stringify(requestBody)
    }, { timeoutMs: 20000, maxRetries: 1 });
    if (!response.ok) return { clicked: false };
    const data = await response.json();
    const content = (data?.choices?.[0]?.message?.content || '').trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { clicked: false };
    let obj;
    try { obj = JSON.parse(match[0]); } catch { return { clicked: false }; }
    const uid = obj?.uid;
    if (!uid || typeof uid !== 'string') {
      log(`弹窗处理 · 第 ${round} 轮 未检测到弹窗，继续表单流程`);
      return { clicked: false };
    }
    const execRes = await chrome.tabs.sendMessage(tabId, { action: 'fullAiExecute', steps: [{ op: 'click', uid }] });
    const ok = execRes?.success && execRes?.results?.[0]?.ok;
    if (ok) log(`弹窗处理 · 第 ${round} 轮 已点击关闭按钮`);
    return { clicked: ok };
  }

  async function runOverlayDismissLoop(tabId, llmConfig, fetchLlmWithRetry, log) {
    for (let r = 1; r <= MAX_OVERLAY_ROUNDS; r++) {
      const res = await Promise.race([
        runOverlayDismissRound(tabId, r, llmConfig, fetchLlmWithRetry, log),
        timeout(25000)
      ]).catch(() => ({ clicked: false }));
      if (!res?.clicked) break;
      await new Promise((x) => setTimeout(x, OVERLAY_WAIT_MS));
    }
  }

  function logTaskEnd(log, startTime, success, errorMsg) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`========== 任务结束: success=${success}, 耗时 ${elapsed}s${errorMsg ? ', error=' + errorMsg : ''} ==========`);
  }

  async function runFullAiTask(tabId, siteUrl, generatedComment, fetchLlmWithRetry, logFn, profileData) {
    const log = logFn || ((msg) => console.log('[完全AI识别模式]', msg));
    const startTime = Date.now();

    log('========== 完全 AI 识别（程序主控）开始 ==========');
    log(`输入: siteUrl=${siteUrl}, 评论长度=${generatedComment?.length ?? 0} 字符`);

    const storage = await chrome.storage.local.get(['settings']);
    const llmConfig = storage.settings?.llmConfig;
    if (!llmConfig?.enabled || !llmConfig?.apiKey) {
      log('失败: LLM 未启用或 API Key 未配置');
      logTaskEnd(log, startTime, false, 'LLM 未启用或 API Key 未配置');
      return { success: false, error: 'LLM 未启用或 API Key 未配置' };
    }
    log(`LLM 配置: model=${llmConfig.model}`);

    const prepareRes = await chrome.tabs.sendMessage(tabId, { action: 'fullAiPrepareForComment' }).catch(() => ({}));
    const formHint = prepareRes?.hintText || '';
    const formRootSelector = prepareRes?.formRootSelector || null;
    if (!prepareRes?.hasForm) {
      log('失败: 未检测到评论表单');
      logTaskEnd(log, startTime, false, '未检测到评论表单');
      return { success: false, error: '未检测到评论表单' };
    }
    const scopeToUse = formRootSelector || null;
    log(`表单检测: 已找到表单${scopeToUse ? '（限定范围）' : '（整页）'}，将一次性规划 fills/checks/clicks`);

    const fillData = {
      comment: generatedComment,
      siteUrl,
      commentName: (profileData?.commentName || '').trim(),
      commentEmail: (profileData?.commentEmail || '').trim(),
      commentWebsite: (profileData?.commentWebsite || '').trim()
    };

    if (!fillData.commentName || !fillData.commentEmail) {
      log('失败: 站点未配置姓名或邮箱');
      logTaskEnd(log, startTime, false, '未配置姓名或邮箱');
      return {
        success: false,
        error: '请先在站点设置中配置「网站名称」和「联系邮箱」，评论表单的 Name* 和 Email* 为必填项'
      };
    }

    try {
      log('第 1 步 · 多轮弹窗处理（Cookie/隐私同意）...');
      await runOverlayDismissLoop(tabId, llmConfig, fetchLlmWithRetry, log);

      log(`第 2 步 · 采集表单 Snapshot${scopeToUse ? '（限定范围）' : '（整页）'}...`);
      let snapshotRes;
      try {
        snapshotRes = await chrome.tabs.sendMessage(tabId, { action: 'fullAiTakeSnapshot', scopeRootSelector: scopeToUse });
      } catch (e) {
        const msg = e?.message || '';
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
          logTaskEnd(log, startTime, false, '页面未注入扩展');
          return { success: false, error: '页面未注入扩展，请刷新页面后重试' };
        }
        throw e;
      }
      if (!snapshotRes?.success || !snapshotRes.snapshotText) {
        const err = snapshotRes?.error || 'Snapshot 采集失败';
        logTaskEnd(log, startTime, false, err);
        return { success: false, error: err };
      }
      const nodeCount = snapshotRes.snapshotResult?.totalNodes ?? 0;
      log(`第 2 步 · Snapshot 完成，节点数 ${nodeCount}`);

      log('第 3 步 · 程序映射元素（启发式定位 Name/Email/Website/Comment/提交/勾选）...');
      const mapped = buildStepsFromSnapshot(snapshotRes.snapshotResult, fillData);
      if (mapped.error || !mapped.steps?.length) {
        const err = mapped.error || '未映射到可执行步骤';
        logTaskEnd(log, startTime, false, err);
        return { success: false, error: err };
      }
      const stepsDesc = mapped.steps.map((s) => `${s.op}(${s.uid}${s.value != null ? `,"${String(s.value).slice(0, 20)}…"` : ''})`).join(', ');
      log(`第 3 步 · 已生成 ${mapped.steps.length} 步: [${stepsDesc}]`);

      const execRes = await Promise.race([
        chrome.tabs.sendMessage(tabId, { action: 'fullAiExecute', steps: mapped.steps }),
        timeout(ROUND_TIMEOUT_MS)
      ]).catch((e) => ({ success: false, results: [], message: e?.message }));

      const execSuccess = execRes?.success === true;
      const failedSteps = (execRes?.results || []).filter((r) => !r.ok);
      if (failedSteps.length > 0) {
        log(`执行失败步骤: ${failedSteps.map((r) => `${r.op}(${r.uid}): ${r.error || 'failed'}`).join('; ')}`);
      }
      const hasNotFound = execRes?.results?.some((r) => r.error === 'element_not_found');
      const isTimeout = execRes?.message === 'timeout';
      const result = {
        success: execSuccess,
        reason: execSuccess ? '程序主控执行完成' : (isTimeout ? '单轮超时' : hasNotFound ? '元素未找到' : '执行部分失败'),
        error: execSuccess ? undefined : (isTimeout ? '单轮超时' : hasNotFound ? failedSteps.map((r) => r.uid).join(', ') : execRes?.message || '执行失败')
      };

      logTaskEnd(log, startTime, result.success, result.success ? undefined : result.error);
      return {
        success: result.success,
        reason: result.reason || (result.success ? '程序主控执行完成' : result.error),
        error: result.success ? undefined : result.error
      };
    } catch (e) {
      const errMsg = e?.message === 'timeout' ? '单轮超时' : (e?.message || '执行异常');
      logTaskEnd(log, startTime, false, errMsg);
      if (e?.message === 'timeout') {
        return { success: false, error: '单轮超时' };
      }
      return { success: false, error: e?.message || '执行异常' };
    }
  }

  global.fullAiAgent = {
    runFullAiTask,
    ROUND_TIMEOUT_MS,
    TASK_TIMEOUT_MS
  };
})(typeof self !== 'undefined' ? self : this);
