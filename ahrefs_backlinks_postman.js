/**
 * Ahrefs 免费反链 API（stGetFreeBacklinksOverview / stGetFreeBacklinksList）
 *
 * 对齐扩展仓库 `background.js` 的 Step 2/Step 3：
 *  - Step 2: 由外部提供的 `captcha` token 获取 signedInput（signature + validUntil）
 *  - Step 3: 使用 signedInput 获取 backlinks 列表
 *
 * 注意：
 *  - 本文件不包含 CapSolver/Turnstile token 获取实现。
 *  - 你需要在调用前准备一个有效的 Turnstile `captcha` token（通过你已有的 Step 1 流程）。
 *
 * 用法（Postman）：
 *  1) 在 Postman 环境变量/全局变量里设置：
 *      - `ahrefs_domain` (例如: example.com)
 *      - `ahrefs_captcha_token` (你已经拿到的 token)
 *  2) 把本文件内容粘到 Postman 的「Pre-request Script」或「Tests」里（或手动调用 runPostman()）。
 *
 * 用法（Node.js 调试）：
 *  node -e "..." 里传入 domain 与 captchaToken，见文件底部示例。
 */

const AHREFS_OVERVIEW_URL = 'https://ahrefs.com/v4/stGetFreeBacklinksOverview';
const AHREFS_BACKLINKS_URL = 'https://ahrefs.com/v4/stGetFreeBacklinksList';

function normalizeDomain(domain) {
  if (!domain || typeof domain !== 'string') return '';
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0];
}

function urlWithSlash(domain) {
  if (!domain || typeof domain !== 'string') return '/';
  return domain.endsWith('/') ? domain : domain + '/';
}

function getPostmanLikeHeaders() {
  // Postman 通常需要显式 Content-Type
  return { 'Content-Type': 'application/json' };
}

/**
 * 兼容两种运行环境：
 *  - Postman：使用 pm.sendRequest
 *  - Node.js：使用 fetch
 */
function postJson(url, body) {
  const headers = getPostmanLikeHeaders();

  // Postman sandbox
  if (typeof pm !== 'undefined' && pm && typeof pm.sendRequest === 'function') {
    return new Promise((resolve, reject) => {
      pm.sendRequest(
        {
          url,
          method: 'POST',
          header: headers,
          body: {
            mode: 'raw',
            raw: JSON.stringify(body),
            options: { raw: { language: 'json' } }
          }
        },
        (err, res) => {
          if (err) return reject(err);

          const status = res && (res.code || res.status) ? (res.code || res.status) : 0;

          // 尝试解析 JSON；如果失败就回退到 text。
          let parsed = null;
          try {
            if (typeof res.json === 'function') parsed = res.json();
            else parsed = JSON.parse(res.text());
          } catch (_) {
            try {
              parsed = res.text && res.text();
            } catch (_) {
              parsed = null;
            }
          }

          if (status && status >= 400) {
            return reject(new Error(`HTTP ${status} - ${typeof parsed === 'string' ? parsed.slice(0, 500) : 'request failed'}`));
          }

          resolve({ status, data: parsed, raw: res });
        }
      );
    });
  }

  // Node.js
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }).then(async (res) => {
    const status = res.status;
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = text;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${status} - ${String(parsed).slice(0, 500)}`);
    }
    return { status, data: parsed };
  });
}

/**
 * Step 2：由 captcha token 获取 signedInput（signature + validUntil）
 *
 * 扩展 `background.js` 对齐：
 *  reqBody: { captcha: token, mode: 'subdomains', url: domain }
 *  response: data[1].signedInput.signature / data[1].signedInput.input.validUntil
 *  overview: data[1].data || {}
 */
async function getAhrefsSignature({ captchaToken, domain }) {
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error('domain 格式无效');
  if (!captchaToken) throw new Error('captchaToken 不能为空（需要你已有 Step 1 的结果）');

  const reqBody = {
    captcha: captchaToken,
    mode: 'subdomains',
    url: normalized
  };

  const { data } = await postJson(AHREFS_OVERVIEW_URL, reqBody);

  if (!Array.isArray(data) || data.length < 2 || !data[1]?.signedInput) {
    throw new Error(`Step 2 响应格式异常：${JSON.stringify(data).slice(0, 500)}`);
  }

  const signedInput = data[1].signedInput;
  const overview = data[1].data || {};

  return {
    signature: signedInput.signature,
    validUntil: signedInput.input?.validUntil,
    overview
  };
}

/**
 * Step 3：使用 signedInput 获取 backlinks
 *
 * 扩展 `background.js` 对齐：
 *  payload: {
 *    reportType: ['TopBacklinks'],
 *    signedInput: {
 *      signature,
 *      input: { validUntil, mode: 'subdomains', url: domain + '/' }
 *    }
 *  }
 *  parse: data[1].topBacklinks.backlinks || data[1].backlinks
 */
async function getAhrefsBacklinks({ signature, validUntil, domain }) {
  const normalized = normalizeDomain(domain);
  if (!normalized) throw new Error('domain 格式无效');
  if (!signature) throw new Error('signature 不能为空');
  if (!validUntil) throw new Error('validUntil 不能为空');

  const payload = {
    reportType: ['TopBacklinks'],
    signedInput: {
      signature,
      input: { validUntil, mode: 'subdomains', url: urlWithSlash(normalized) }
    }
  };

  const { data } = await postJson(AHREFS_BACKLINKS_URL, payload);

  let backlinks = [];
  if (Array.isArray(data) && data.length >= 2) {
    const obj = data[1];
    if (obj?.topBacklinks?.backlinks) backlinks = obj.topBacklinks.backlinks;
    else if (obj?.backlinks) backlinks = obj.backlinks;
  }

  return backlinks;
}

/**
 * 一次性封装：给定 captchaToken + domain => 返回 backlinks + overview + urlFromList
 */
async function fetchAhrefsBacklinksByCaptchaToken({ captchaToken, domain }) {
  const sig = await getAhrefsSignature({ captchaToken, domain });
  const backlinks = await getAhrefsBacklinks({
    signature: sig.signature,
    validUntil: sig.validUntil,
    domain
  });

  const overview = sig.overview || {};
  const urlFromList = Array.isArray(backlinks) ? backlinks.map(b => b.urlFrom).filter(Boolean) : [];

  return { urlFromList, backlinks, overview };
}

/**
 * CapSolver Step 1 占位：不提供具体实现
 */
async function getCaptchaTokenViaCapSolver_unsupported() {
  throw new Error(
    '我不能提供 CapSolver/Turnstile token 获取实现。请先用你已有的 Step 1 流程拿到有效 captchaToken，再调用 Step 2/Step 3。'
  );
}

/**
 * Postman 便捷入口：从环境变量读取并执行
 */
async function runPostman() {
  const domainRaw =
    (typeof pm !== 'undefined' && pm && pm.environment && pm.environment.get && pm.environment.get('ahrefs_domain')) ||
    (typeof pm !== 'undefined' && pm && pm.variables && pm.variables.get && pm.variables.get('ahrefs_domain')) ||
    '';

  const captchaTokenRaw =
    (typeof pm !== 'undefined' && pm && pm.environment && pm.environment.get && pm.environment.get('ahrefs_captcha_token')) ||
    (typeof pm !== 'undefined' && pm && pm.variables && pm.variables.get && pm.variables.get('ahrefs_captcha_token')) ||
    '';

  const domainList = String(domainRaw)
    .split(/[\s,]+/g)
    .map(d => d.trim())
    .filter(Boolean);

  if (domainList.length === 0 || !captchaTokenRaw) {
    throw new Error('请在 Postman 设置环境变量：ahrefs_domain（可填多个）与 ahrefs_captcha_token');
  }

  // 支持：
  // 1) 单个 token：所有域名共用同一个 captcha token
  // 2) JSON 对象：{"example.com":"token1","foo.com":"token2"}
  let captchaTokenMapping = null;
  let sharedCaptchaToken = captchaTokenRaw;
  try {
    const maybe = captchaTokenRaw.trim();
    if (maybe.startsWith('{') && maybe.endsWith('}')) {
      captchaTokenMapping = JSON.parse(maybe);
      sharedCaptchaToken = '';
    }
  } catch (_) {
    captchaTokenMapping = null;
  }

  const results = [];
  let okCount = 0;
  let failCount = 0;

  // 顺序请求：避免并发触发风控/资源紧张
  for (const domain of domainList) {
    const tokenForDomain =
      (captchaTokenMapping && captchaTokenMapping[domain]) ||
      (captchaTokenMapping && captchaTokenMapping[normalizeDomain(domain)]) ||
      (sharedCaptchaToken ? sharedCaptchaToken : '');

    try {
      if (!tokenForDomain) throw new Error('captcha token 为空（域名：' + domain + '）');
      const r = await fetchAhrefsBacklinksByCaptchaToken({ captchaToken: tokenForDomain, domain });
      okCount += 1;
      results.push({ domain, ...r });

      const domainRating = r.overview?.domainRating;
      const backlinksCount = Array.isArray(r.backlinks) ? r.backlinks.length : 0;
      console.log('[Ahrefs API] OK:', domain, {
        urlFromListCount: r.urlFromList?.length || 0,
        backlinksCount,
        domainRating: domainRating != null ? domainRating : undefined
      });

      // 只打印前 1 条示例，避免控制台刷屏
      if (backlinksCount > 0) {
        console.log('[Ahrefs API] Example backlink:', r.backlinks[0]);
      }
    } catch (e) {
      failCount += 1;
      const errMsg = e?.message || String(e);
      results.push({ domain, error: errMsg });
      console.warn('[Ahrefs API] FAIL:', domain, errMsg);
    }
  }

  const summary = { okCount, failCount, total: domainList.length };

  // 写回 Postman 变量（如果可写）
  try {
    if (pm && pm.environment && pm.environment.set) {
      pm.environment.set('ahrefs_results_json', JSON.stringify({ summary, results }, null, 0));
      pm.environment.set('ahrefs_ok_count', String(okCount));
      pm.environment.set('ahrefs_fail_count', String(failCount));
    }
  } catch (_) {
    // ignore
  }

  if (typeof console !== 'undefined') {
    console.log('[Ahrefs API] completed', summary);
    // 如需查看全量 results：自行把 ahrefs_results_json 打印或复制
  }

  return { summary, results };
}

// Node.js 导出（方便你用 Node 直接调试）
if (typeof module !== 'undefined' && module && module.exports) {
  module.exports = {
    normalizeDomain,
    getAhrefsSignature,
    getAhrefsBacklinks,
    fetchAhrefsBacklinksByCaptchaToken,
    runPostman,
    // 仅占位
    getCaptchaTokenViaCapSolver_unsupported
  };
}

// Node.js 单文件直接运行示例（不在 Postman 中自动执行）
if (
  typeof require !== 'undefined' &&
  typeof process !== 'undefined' &&
  process?.argv &&
  process.argv[1] &&
  String(process.argv[1]).includes('ahrefs_backlinks_postman.js')
) {
  (async () => {
    // 用法：
    //   node ahrefs_backlinks_postman.js example.com "<captchaToken>"
    const domain = process.argv[2];
    const captchaToken = process.argv[3];
    const r = await fetchAhrefsBacklinksByCaptchaToken({ captchaToken, domain });
    console.log(JSON.stringify(r, null, 2));
  })().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}

