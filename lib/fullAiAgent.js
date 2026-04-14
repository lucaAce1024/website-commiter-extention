/**
 * 完全 AI 识别 - 控制层 + 协议层（程序主控）
 * 流程：1) 多轮弹窗处理 → 2) 表单 Snapshot → 3) 程序启发式元素映射 → 4) 固定顺序执行
 * AI 仅用于生成评论；定位与执行由程序控制，见 doc/5.完全AI识别提交方案/6.收敛方案-程序主控.md
 */
(function (global) {
  'use strict';

  const ROUND_TIMEOUT_MS = 120000;
  const TASK_TIMEOUT_MS = 150000;

  function adaptLlmRequest(endpoint, apiKey, requestBody) {
    if (!endpoint.includes('/anthropic')) {
      return {
        url: endpoint,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(requestBody)
        }
      };
    }
    const messages = requestBody.messages || [];
    const systemMsg = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const anthropicBody = { model: requestBody.model, max_tokens: requestBody.max_tokens || 4096, messages: userMessages };
    if (systemMsg) anthropicBody.system = systemMsg.content;
    if (requestBody.temperature != null) anthropicBody.temperature = requestBody.temperature;
    return {
      url: endpoint + '/v1/messages',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(anthropicBody)
      }
    };
  }

  function extractLlmContent(data) {
    if (data?.choices?.[0]?.message?.content != null) return data.choices[0].message.content;
    if (Array.isArray(data?.content)) return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return '';
  }

  const SLOT_KEYWORDS = {
    name: [
      'name', 'author', 'your name', 'display name', 'full name',
      '姓名', '昵称', '名字', '称呼',
      '名前', 'なまえ', 'お名前',
      'ihr name',
      'ime', 'jméno', 'meno',
      'nom', 'nombre', 'nome',
      '이름',
      'имя',
    ],
    email: [
      'email', 'e-mail', 'mail', 'your email', 'email address',
      '邮箱', '电子邮件',
      'メール', 'メールアドレス',
      'e-pošta', 'email-adresse',
      'correo', 'courriel',
      '이메일',
      'эл. почта', 'электронная почта',
    ],
    website: [
      'website', 'url', 'site', 'web', 'homepage', 'your website', 'blog',
      '网址', '链接', '网站',
      'ウェブサイト', 'サイト',
      'spletišče', 'spletna stran', 'webseite', 'sitio web', 'site web',
      '웹사이트',
      'сайт',
    ],
    comment: [
      'comment', 'message', 'reply', 'write', 'your comment', 'leave a comment',
      'comment body', 'your message', 'feedback', 'text',
      '内容', '评论', '留言', '回复', '消息',
      'コメント', 'メッセージ',
      'komentar', 'komentář', 'kommentar', 'comentario', 'commentaire',
      '댓글',
      'комментарий',
    ]
  };

  const SUBMIT_KEYWORDS = [
    'submit', 'post', 'post comment', 'submit comment', 'send', 'publish',
    'leave a reply', 'add comment', 'reply',
    '发布', '提交', '发表', '提交评论', '发表评论', '回复',
    'コメントする', '送信', '投稿',
    'absenden', 'envoyer', 'enviar', 'objavi', 'odeslat', 'komentovat',
    '제출',
    'отправить',
  ];

  const CHECKBOX_KEYWORDS = [
    'notify', 'agree', 'terms', 'accept', 'consent',
    'robot', 'not a robot', 'i am human',
    'privacy', 'policy', 'subscribe', 'newsletter',
    '机器人', '同意', '条款', '隐私', '订阅',
    'save my name', 'save my info',
    'notify me', 'benachrichtigen',
    '通知', 'お知らせ', 'souhlasím',
  ];

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

  function scoreSlotMulti(node, keywords) {
    const texts = [node.name, node.placeholder, node.labelText].filter(Boolean);
    let best = 0;
    for (const t of texts) {
      const s = scoreSlot(t, keywords);
      if (s > best) best = s;
    }
    return best;
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
      if (isHumanVerificationField(n)) {
        humanVerificationNode = n;
        continue;
      }
      for (const [slot, keywords] of Object.entries(SLOT_KEYWORDS)) {
        const score = scoreSlotMulti(n, keywords);
        if (score) slotCandidates[slot].push({ node: n, score });
      }
    }

    // textarea 回退：无 comment 匹配时，取唯一 textarea 或最大 textarea
    if (!slotCandidates.comment.length) {
      const textareas = inputs.filter(n => n.tagName === 'textarea');
      if (textareas.length === 1) {
        slotCandidates.comment.push({ node: textareas[0], score: 0.5 });
      } else if (textareas.length > 1) {
        textareas.sort((a, b) =>
          ((b.placeholder || '').length + (b.name || '').length) -
          ((a.placeholder || '').length + (a.name || '').length)
        );
        slotCandidates.comment.push({ node: textareas[0], score: 0.3 });
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
      if (!scoreSlotMulti(n, CHECKBOX_KEYWORDS)) continue;
      if (used.has(n.id)) continue;
      used.add(n.id);
      steps.push({ op: 'check', uid: n.id, checked: true });
    }

    // 识别非标准 checkbox: role=switch, aria-checked
    const switches = nodes.filter(n => n && n.id && (n.role === 'switch'));
    for (const n of switches) {
      if (!scoreSlotMulti(n, CHECKBOX_KEYWORDS)) continue;
      if (used.has(n.id)) continue;
      used.add(n.id);
      steps.push({ op: 'click', uid: n.id });
    }

    let submitNode = null;
    for (const n of buttons) {
      if (!scoreSlotMulti(n, SUBMIT_KEYWORDS)) continue;
      if (used.has(n.id)) continue;
      submitNode = n;
      break;
    }
    // submit 按钮回退：通过 inputType=submit 直接匹配
    if (!submitNode) {
      submitNode = buttons.find(n => n.inputType === 'submit' && !used.has(n.id)) || null;
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
    const _adapted = adaptLlmRequest(endpoint, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(
      _adapted.url,
      _adapted.init,
      { timeoutMs: ROUND_TIMEOUT_MS - 5000, maxRetries: 1 }
    );

    if (!response.ok) {
      const errText = await response.text();
      return { success: false, error: `LLM 请求失败 ${response.status}: ${errText.slice(0, 100)}` };
    }

    const data = await response.json();
    const content = extractLlmContent(data).trim();
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

  // ─── Agent Loop：多轮对话自修复核心 ───

  const MAX_AGENT_ROUNDS = 5;

  const AGENT_SYSTEM_PROMPT = `你是一个网页评论表单自动提交助手。你的任务是在目标网页上找到评论表单，填入指定信息，并提交。

## 你的能力
你能通过 DOM Snapshot 理解页面结构，输出 JSON 指令让程序执行。每轮你会收到当前页面的 Snapshot 和上一轮的执行结果。

## 可用操作
你每轮输出一个 JSON 对象，包含要执行的操作：
{
  "thought": "简要分析当前状态和下一步计划（1-2句）",
  "actions": [
    { "op": "fill", "uid": "xxx", "value": "要填入的文本" },
    { "op": "click", "uid": "xxx" },
    { "op": "check", "uid": "xxx", "checked": true }
  ],
  "status": "continue" | "done" | "no_form" | "blocked"
}

## status 含义
- "continue"：本轮操作执行后，需要再看一次页面状态（如：关了弹窗后需要看表单）
- "done"：评论已提交完成（最后一个 action 应该是点击提交按钮）
- "no_form"：确认页面没有评论表单（评论已关闭、需要登录等），终止任务
- "blocked"：遇到无法绕过的障碍（reCAPTCHA、登录墙等），终止任务

## 规则
1. 每轮 actions 中的操作按顺序执行：先 fill，再 check，最后 click
2. 填充时 value 必须与「待填数据」完全一致，不要修改或缩短
3. 遇到 Cookie/隐私弹窗，优先关闭弹窗（click 对应的 accept/agree 按钮），status 设为 "continue"
4. 遇到人机验证（简单算术如 2+3=?），在 actions 中 fill 正确答案
5. 遇到需要勾选的 checkbox（如 notify、agree、save my name），在 actions 中 check
6. 如果上一轮有操作失败（element_not_found），根据新 Snapshot 找到正确的 uid 重试
7. 提交按钮必须放在最后一个 action，且当所有必填字段填完后才点击
8. 仅输出 JSON，不要 markdown 代码块、不要解释`;

  function buildRoundMessage(roundIndex, snapshot, prevResult, fillData) {
    const parts = [];

    if (roundIndex === 0) {
      parts.push('【任务】在此页面找到评论表单，填入以下信息并提交。');
      parts.push('【待填数据】');
      parts.push(`- comment（评论内容）：${fillData.comment}`);
      parts.push(`- commentName（姓名）：${fillData.commentName || '（无）'}`);
      parts.push(`- commentEmail（邮箱）：${fillData.commentEmail || '（无）'}`);
      parts.push(`- commentWebsite（网址）：${fillData.commentWebsite || '（无）'}`);
    }

    if (prevResult) {
      parts.push('【上一轮执行结果】');
      for (const r of prevResult.results || []) {
        const status = r.ok ? '✅成功' : `❌失败(${r.error})`;
        parts.push(`- ${r.op}(${r.uid}): ${status}`);
      }
    }

    const maxLen = roundIndex === 0 ? 6000 : 4000;
    const snapshotTrunc = snapshot.length > maxLen
      ? snapshot.slice(0, maxLen) + '\n...[截断]'
      : snapshot;
    parts.push(`【当前页面 Snapshot（第 ${roundIndex + 1} 轮）】`);
    parts.push(snapshotTrunc);

    return parts.join('\n');
  }

  async function callAgentLLM(messages, llmConfig, fetchLlmWithRetry) {
    const requestBody = {
      model: llmConfig.model || 'gpt-3.5-turbo',
      messages,
      stream: false,
      temperature: 0.2,
      max_tokens: 2048
    };
    if (llmConfig.disableThinking !== false) {
      requestBody.thinking = { type: 'disabled' };
    }

    const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
    const _adapted = adaptLlmRequest(endpoint, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(
      _adapted.url,
      _adapted.init,
      { timeoutMs: 25000, maxRetries: 1 }
    );

    if (!response.ok) return null;
    const data = await response.json();
    const content = extractLlmContent(data).trim();
    return extractJsonFromText(content);
  }

  function trimConversationHistory(messages, opts = {}) {
    const maxPairs = opts.maxUserAssistantPairs || 4;
    const nonSystem = messages.slice(1);
    const pairCount = Math.floor(nonSystem.length / 2);
    if (pairCount <= maxPairs) return;

    const pairsToRemove = pairCount - maxPairs;
    const removeCount = pairsToRemove * 2;
    const removed = nonSystem.slice(0, removeCount);

    const summary = removed.map((msg) => {
      if (msg.role === 'assistant') {
        try {
          const obj = JSON.parse(msg.content);
          return `[轮次] thought: ${obj.thought}, status: ${obj.status}, actions: ${obj.actions?.length || 0}`;
        } catch { return null; }
      }
      return null;
    }).filter(Boolean).join('\n');

    messages.splice(1, removeCount, {
      role: 'user',
      content: `【前 ${pairsToRemove} 轮摘要】\n${summary}`
    });
  }

  function estimateTokens(messages) {
    let total = 0;
    for (const m of messages) {
      total += Math.ceil((m.content || '').length / 4);
    }
    return total;
  }

  async function runAgentLoop(tabId, fillData, llmConfig, fetchLlmWithRetry, log) {
    const messages = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT }
    ];

    let lastExecResult = null;

    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      log(`Agent 第 ${round + 1}/${MAX_AGENT_ROUNDS} 轮`);

      // Observe: 拍快照
      const snapRes = await chrome.tabs.sendMessage(tabId, {
        action: 'fullAiTakeSnapshot',
        scopeRootSelector: null
      });
      if (!snapRes?.success || !snapRes.snapshotText) {
        log(`Snapshot 采集失败: ${snapRes?.error}`);
        return { success: false, error: snapRes?.error || 'Snapshot 失败' };
      }

      // 第 1 轮：先尝试程序弹窗关闭 + 启发式
      if (round === 0) {
        const dismissRes = await chrome.tabs.sendMessage(tabId, { action: 'dismissOverlays', maxRounds: 2 }).catch(() => ({ dismissed: false }));
        if (dismissRes?.dismissed) {
          log(`程序已关闭弹窗 (${dismissRes.clickedSelectors?.join(', ')})`);
          continue;
        }

        const quickMap = buildStepsFromSnapshot(snapRes.snapshotResult, fillData);
        if (quickMap.steps?.length > 0 && !quickMap.error) {
          log(`程序启发式成功：${quickMap.steps.length} 步，跳过 LLM`);
          const execRes = await chrome.tabs.sendMessage(tabId, {
            action: 'fullAiExecute', steps: quickMap.steps
          });
          if (execRes?.success) {
            return { success: true, reason: '程序启发式完成', round: round + 1, agentRounds: 0 };
          }
          lastExecResult = execRes;
          log('程序启发式执行失败，进入 AI Agent Loop 修正');
        }
      }

      // Decide: 构建 user message → 调用 LLM
      const userMsg = buildRoundMessage(round, snapRes.snapshotText, lastExecResult, fillData);
      messages.push({ role: 'user', content: userMsg });

      trimConversationHistory(messages, { maxUserAssistantPairs: 4 });

      const tokenEstimate = estimateTokens(messages);
      log(`Token 估算: ~${tokenEstimate}, messages: ${messages.length} 条`);

      const llmResponse = await callAgentLLM(messages, llmConfig, fetchLlmWithRetry);
      if (!llmResponse) {
        log('LLM 返回无法解析，跳过本轮');
        messages.pop();
        continue;
      }
      messages.push({ role: 'assistant', content: JSON.stringify(llmResponse) });

      log(`AI 决策: status=${llmResponse.status}, thought="${llmResponse.thought}"`);
      log(`AI 操作: ${llmResponse.actions?.length || 0} 个`);

      if (llmResponse.status === 'no_form') {
        return { success: false, error: '页面无评论表单', reason: llmResponse.thought, agentRounds: round + 1 };
      }
      if (llmResponse.status === 'blocked') {
        return { success: false, error: '遇到无法绕过的障碍', reason: llmResponse.thought, agentRounds: round + 1 };
      }

      // Act: 执行 AI 输出的 actions
      if (llmResponse.actions?.length > 0) {
        const steps = llmResponse.actions.map(a => ({
          op: a.op, uid: a.uid,
          value: a.value, checked: a.checked
        }));
        const execRes = await chrome.tabs.sendMessage(tabId, {
          action: 'fullAiExecute', steps
        });
        lastExecResult = execRes;

        const failedCount = (execRes?.results || []).filter(r => !r.ok).length;
        log(`执行结果: ${execRes?.success ? '全部成功' : `${failedCount} 个失败`}`);
      }

      // Evaluate: 判断是否结束
      if (llmResponse.status === 'done') {
        const allOk = lastExecResult?.success !== false;
        if (allOk) {
          return { success: true, reason: llmResponse.thought, round: round + 1, agentRounds: round + 1 };
        }
        log('AI 认为完成但执行有失败，继续修正');
      }

      await new Promise(r => setTimeout(r, 800));
    }

    return { success: false, error: `已达最大轮次 ${MAX_AGENT_ROUNDS}`, agentRounds: MAX_AGENT_ROUNDS };
  }

  // ─── 弹窗处理（LLM 兜底，旧版保留） ───

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
    const _adapted = adaptLlmRequest(endpoint, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(_adapted.url, _adapted.init, { timeoutMs: 20000, maxRetries: 1 });
    if (!response.ok) return { clicked: false };
    const data = await response.json();
    const content = extractLlmContent(data).trim();
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

  async function tryQuickPath(tabId, fillData, log) {
    // 程序弹窗预处理
    const dismissRes = await chrome.tabs.sendMessage(tabId, { action: 'dismissOverlays', maxRounds: 2 }).catch(() => ({ dismissed: false }));
    if (dismissRes?.dismissed) {
      log(`快速路径 · 程序已关闭弹窗 (${dismissRes.clickedSelectors?.join(', ')})`);
    }

    // 采集 Snapshot
    let snapshotRes;
    try {
      snapshotRes = await chrome.tabs.sendMessage(tabId, { action: 'fullAiTakeSnapshot', scopeRootSelector: null });
    } catch (e) {
      const msg = e?.message || '';
      if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
        return { success: false, error: '页面未注入扩展，请刷新页面后重试' };
      }
      throw e;
    }
    if (!snapshotRes?.success || !snapshotRes.snapshotText) {
      return { success: false, error: snapshotRes?.error || 'Snapshot 采集失败' };
    }

    const nodeCount = snapshotRes.snapshotResult?.totalNodes ?? 0;
    log(`快速路径 · Snapshot 完成，节点数 ${nodeCount}`);

    // 程序启发式映射
    const mapped = buildStepsFromSnapshot(snapshotRes.snapshotResult, fillData);
    if (mapped.error || !mapped.steps?.length) {
      log(`快速路径 · 启发式匹配失败: ${mapped.error || '未映射到可执行步骤'}`);
      return { success: false, error: mapped.error || '未映射到可执行步骤' };
    }

    const stepsDesc = mapped.steps.map(s => `${s.op}(${s.uid}${s.value != null ? `,"${String(s.value).slice(0, 20)}…"` : ''})`).join(', ');
    log(`快速路径 · 已生成 ${mapped.steps.length} 步: [${stepsDesc}]`);

    // 执行
    const execRes = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'fullAiExecute', steps: mapped.steps }),
      timeout(ROUND_TIMEOUT_MS)
    ]).catch(e => ({ success: false, results: [], message: e?.message }));

    if (execRes?.success) {
      return { success: true, reason: '快速路径（程序启发式）完成', agentRounds: 0 };
    }

    const failedSteps = (execRes?.results || []).filter(r => !r.ok);
    if (failedSteps.length > 0) {
      log(`快速路径 · 执行失败: ${failedSteps.map(r => `${r.op}(${r.uid}): ${r.error || 'failed'}`).join('; ')}`);
    }
    return { success: false, error: '快速路径执行失败' };
  }

  async function runFullAiTask(tabId, siteUrl, generatedComment, fetchLlmWithRetry, logFn, profileData) {
    const log = logFn || ((msg) => console.log('[完全AI识别模式]', msg));
    const startTime = Date.now();

    log('========== 完全 AI 识别（程序主控 + Agent Loop）开始 ==========');
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
      // === 快速路径：程序启发式（不消耗 LLM token） ===
      log('第 1 步 · 快速路径（弹窗预处理 + 启发式匹配）...');
      const quickResult = await tryQuickPath(tabId, fillData, log);
      if (quickResult.success) {
        logTaskEnd(log, startTime, true);
        return { success: true, reason: quickResult.reason, agentRounds: 0 };
      }

      // === 自修复路径：Agent Loop ===
      log('第 2 步 · 快速路径失败，启动 AI Agent Loop（多轮自修复）...');
      const agentResult = await runAgentLoop(tabId, fillData, llmConfig, fetchLlmWithRetry, log);

      logTaskEnd(log, startTime, agentResult.success, agentResult.success ? undefined : agentResult.error);
      return agentResult;
    } catch (e) {
      const errMsg = e?.message === 'timeout' ? '单轮超时' : (e?.message || '执行异常');
      logTaskEnd(log, startTime, false, errMsg);
      return { success: false, error: errMsg };
    }
  }

  global.fullAiAgent = {
    runFullAiTask,
    runAgentLoop,
    buildStepsFromSnapshot,
    ROUND_TIMEOUT_MS,
    TASK_TIMEOUT_MS
  };
})(typeof self !== 'undefined' ? self : this);
