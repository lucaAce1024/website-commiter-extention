/**
 * Content Script - Form Handler
 * Runs on every page to detect and fill navigation site submission forms
 */

// Console tag for debugging
const TAG = '[NavSubmitter]';

/** 字段填充时间隔离：每填完一个字段后等待的毫秒数，保证同一时间只填充一个字段 */
const FILL_FIELD_DELAY_MS = 280;

/** 模拟打字：每字符/块随机延迟范围（毫秒） */
const TYPING_DELAY_MIN_MS = 50;
const TYPING_DELAY_MAX_MS = 200;
/** 超过此长度时按块“打字”（每块 4 字）以控制总时长 */
const TYPING_CHUNK_THRESHOLD = 200;

/** 每个字段填充后的随机等待（毫秒），模拟人工间隔 */
const POST_FILL_DELAY_MIN_MS = 500;
const POST_FILL_DELAY_MAX_MS = 1000;

// State for current page
let pageState = {
  hasForm: false,
  formMetadata: null,
  fieldMappings: null,
  domain: null,
  recognitionStatus: 'idle', // idle, recognizing, done, failed
  recognitionMethod: null
};

// Blog 评论表单状态（与导航站独立）
let commentFormState = {
  hasForm: false,
  fieldMappings: null,
  submitButton: null,
  /** 需在提交前勾选的复选框定位列表，来自识别结果或缓存 { locator }[] */
  consentCheckboxes: null,
  recognitionStatus: 'idle',
  recognitionMethod: null,
  hasSpamVerification: false,
  domain: null
};

/** 右键菜单打开时记录的目标元素：在哪个输入框右键就填哪个（用当前站点的该字段值） */
let lastContextMenuTarget = null;
document.addEventListener('contextmenu', (e) => {
  lastContextMenuTarget = getEditableElementFromTarget(e.target);
}, true);

/** 评论区常见容器选择器（按优先级尝试） */
const COMMENT_AREA_SELECTORS = [
  '#comments', '#comment', '.comments', '.comment-list', '.comment-list-wrapper',
  '[id*="comment"]', '[class*="comment"]', '.comment-area', 'section.comments',
  '.post-comments', '.article-comments', '[data-comments]', '.respond'
];

/** 论坛/主内容区选择器（无评论区时尝试，避免整页链接过多时直接放弃） */
const MAIN_CONTENT_SELECTORS = [
  'main', '[role="main"]', '#content', '.content', '.page-content', '.main-content',
  '.forum-content', '.topic-posts', '.post-list', '.posts', 'article', '.post-body'
];

/** 全页扫描时最多处理的链接数，避免大页卡顿 */
const EXTRACT_LINKS_CAP = 2500;

/** 常见社交/站内/无效链接 host 片段，出现则排除 */
const COMMENT_LINK_SKIP_HOSTS = [
  'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com',
  't.co', 'bit.ly', 'goo.gl', 'gravatar.com', 'wordpress.com', 'google.com',
  'wikipedia.org', 'amazon.', 'apple.com', 'play.google', 'apps.apple'
];

/** 多语言评论表单标题模式（用于 Blog 评论站判断） */
const BLOG_COMMENT_FORM_TITLES = [
  'leave a reply', 'leave a reply cancel reply', 'leave a comment', 'post a comment', 'add comment',
  'reply to comment', 'submit comment', 'your comment',
  '发表评论', '添加留言', '提交评论', '写下你的评论',
  '评论回复', '发表留言', '回复评论', '留言回复',
  'laisser un commentaire', "laissez une réponse", 'publier un commentaire', "répondre à l'article",
  'ajouter un commentaire', 'écrire un commentaire', 'poster un message',
  'kommentar schreiben', 'kommentar hinzufügen', 'einen kommentar abgeben',
  'dejar un comentario', 'publicar un comentario', 'enviar comentario', 'escribir comentario',
  'comentar', 'aportar un comentario', 'su comentario',
  'invia commento', 'scrivi commento', 'napisz komentarz',
  'laat een reactie', 'plaats een reactie', 'verstuur een reactie',
  'schrijf een reactie', 'geef reactie plaatsen'
];

/** 评论按钮/链接文本（多语言，用于 Blog 评论站判断） */
const BLOG_COMMENT_BUTTON_TEXTS = [
  'comment', 'reply', '回复', 'respond', 'submit', 'send', 'post', 'publish',
  'publier', 'répondre', 'envoyer', 'kirim', 'skicka',
  '送出', '提交', '发表', '发布', '确定', '确认'
];

/** Blog 评论站判断默认阈值（≥ 此分数视为可评论站），可通过 storage 的 blogCommentSiteThreshold 覆盖 */
const BLOG_COMMENT_SITE_THRESHOLD_DEFAULT = 3;

/** URL 路径中含以下片段视为后台/设置/账户页，不做可评论站判定（避免误判） */
const BLOG_COMMENT_EXCLUDED_PATH_SEGMENTS = /\/?(?:dashboard|settings|account|spending|billing|admin|login|signup|signin|billing|profile|preferences)(\/|$)/i;

/**
 * 从 HTML 中移除 <script>、<style>、application/ld+json，仅用 body/可见内容做评论规则匹配，避免 JS/CSS/结构化数据里的词误触发
 * @param {string} html
 * @returns {string}
 */
function stripNonBodyForCommentDetection(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
}

/**
 * 多语言「需登录后才能评论」匹配关键词（评论区常见文案）
 * 命中任一则视为需要登录才能评论
 */
const REQUIRES_LOGIN_TO_COMMENT_PATTERNS = [
  'log in to publish', 'log in to comment', 'log in to reply', 'log in as a member',
  'sign in to comment', 'sign in to reply', 'sign in to post', 'sign in to publish',
  'must be logged in', 'you must be logged in', 'please log in', 'please sign in',
  'login to comment', 'login to reply', 'login required',
  '登录后', '登录才能', '登录以', '请登录', '需要登录', '登录才能评论', '登录后可评论',
  '登入后', '登入才能', '請登入', '需要登入',
  'connectez-vous pour', 'connectez-vous pour commenter', 'se connecter pour commenter',
  'anmelden um zu kommentieren', 'einloggen um', 'melden sie sich an',
  'iniciar sesión para comentar', 'inicia sesión para', 'accede para comentar',
  'accedi per commentare', 'effettua l\'accesso per', 'accedi per commentar',
  'zaloguj się aby', 'zaloguj się by skomentować',
  'ログインして', 'ログインしてください', 'コメントするにはログイン',
  '로그인 후', '로그인하여', '댓글을 달려면 로그인',
  'đăng nhập để', 'đăng nhập để bình luận',
  'เข้าสู่ระบบเพื่อ', 'เข้าสู่ระบบเพื่อแสดงความคิดเห็น',
  'giriş yapın', 'yorum yapmak için giriş',
  'تسجيل الدخول للتعليق', 'قم بتسجيل الدخول'
];

/**
 * 检测评论区/页面是否提示需登录后才能评论（多语言）
 * @param {string} html - 页面 HTML
 * @returns {boolean}
 */
function detectRequiresLoginToComment(html) {
  if (!html || typeof html !== 'string') return false;
  const lower = html.toLowerCase();
  const matched = REQUIRES_LOGIN_TO_COMMENT_PATTERNS.find(function (phrase) {
    return lower.includes(phrase.toLowerCase());
  });
  if (matched) {
    console.log(TAG + ' [需登录检测] 命中: "' + matched + '" → 需登录后才能评论');
  }
  return !!matched;
}

/**
 * 判断当前页面是否为 Blog 评论站（基于 URL + HTML 多规则打分），并返回得分
 * @param {string} url - 页面 URL
 * @param {string} html - 页面 HTML 内容
 * @param {number} [threshold] - 判定阈值，未传则使用 BLOG_COMMENT_SITE_THRESHOLD_DEFAULT
 * @returns {{ isBlogCommentSite: boolean, score: number }} 是否可评论站及得分
 */
function isBlogCommentSite(url, html, threshold) {
  const out = { isBlogCommentSite: false, score: 0 };
  if (!url || !html) return out;
  const th = typeof threshold === 'number' && threshold >= 0 ? threshold : BLOG_COMMENT_SITE_THRESHOLD_DEFAULT;

  try {
    const urlPath = new URL(url).pathname || '';
    if (BLOG_COMMENT_EXCLUDED_PATH_SEGMENTS.test(urlPath)) {
      console.log(TAG + ' [Blog评论站] URL 为后台/设置类路径，排除判定: ' + urlPath);
      return out;
    }
  } catch (_) {}

  // 排除关键词检测：如果页面包含反垃圾评论服务关键词，直接判定为不可评论
  const SPAM_SERVICE_KEYWORDS = ['Akismet', 'CleanTalk', 'OOPSpam'];
  const bodyOnly = stripNonBodyForCommentDetection(html);
  for (const keyword of SPAM_SERVICE_KEYWORDS) {
    if (bodyOnly.includes(keyword)) {
      console.log(TAG + ' [Blog评论站] 检测到反垃圾服务关键词 "' + keyword + '"，直接判定为不可评论');
      out.score = 0;
      out.isBlogCommentSite = false;
      return out;
    }
  }

  const urlHasCommentKeyword = /\/(comment|comments|评论|留言|讨论|反馈|评论区)/.test(url) ||
    /unapproved=/.test(url) ||
    /moderation-hash=/.test(url);

  const htmlHasCommentForm = BLOG_COMMENT_FORM_TITLES.some(function (title) {
    const re = new RegExp('(' + title.replace(/\s+/g, '\\s*') + ')', 'i');
    return re.test(bodyOnly);
  });

  const htmlHasCommentInput = /<textarea|<[^>]*content[^>]*>/i.test(bodyOnly) ||
    /<div[^>]*contenteditable[^>]*>/i.test(bodyOnly) ||
    /id=["']?comment|textarea/i.test(bodyOnly);

  function detectCommentButtonByDomOrHtml(htmlFragment) {
    try {
      if (typeof document !== 'undefined' && document.querySelectorAll) {
        // 1）优先在评论区域容器内查找按钮
        const commentRoots = [];
        for (let i = 0; i < COMMENT_AREA_SELECTORS.length; i++) {
          try {
            const root = document.querySelector(COMMENT_AREA_SELECTORS[i]);
            if (root) commentRoots.push(root);
          } catch (_) {}
        }
        // 2）再在页面上所有 form 中查找，且要求 form 内存在“评论内容”字段
        const forms = Array.prototype.slice.call(document.querySelectorAll('form') || []);
        const commentLike = /comment|kommentar|留言|message|nachricht|reply|回复|评论/i;

        function formLooksLikeCommentForm(formEl) {
          try {
            const textareas = formEl.querySelectorAll('textarea');
            for (let i = 0; i < textareas.length; i++) {
              const ta = textareas[i];
              const name = (ta.name || ta.id || '').toLowerCase();
              const placeholder = (ta.placeholder || '').toLowerCase();
              const aria = (ta.getAttribute('aria-label') || '').toLowerCase();
              const labelText = (getFieldLabel ? getFieldLabel(ta) : '') || '';
              const text = [name, placeholder, aria, labelText].join(' ');
              if (commentLike.test(text)) return true;
            }
          } catch (_) {}
          return false;
        }

        const buttonSelector =
          'button, input[type="submit"], input[type="button"], ' +
          'a[role="button"], a[class*="button"], a[class*="btn"]';

        const scopedRoots = commentRoots.length ? commentRoots : forms.filter(formLooksLikeCommentForm);
        const candidates = [];

        scopedRoots.forEach(function (root) {
          try {
            const list = root.querySelectorAll(buttonSelector);
            for (let i = 0; i < list.length; i++) {
              candidates.push(list[i]);
            }
          } catch (_) {}
        });

        // 如果连评论区域也没有、也找不到像评论表单的 form，则认为“没有评论按钮”
        if (!candidates.length) {
          return false;
        }

        const getLabel = function (el) {
          const text = (el.textContent || '').trim();
          const value = (el.value || '').trim();
          const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
          return (text || value || aria || '');
        };
        for (let i = 0; i < candidates.length; i++) {
          const label = getLabel(candidates[i]);
          if (!label) continue;
          const hit = BLOG_COMMENT_BUTTON_TEXTS.some(function (btnText) {
            return new RegExp('\\b' + btnText + '\\b', 'i').test(label);
          });
          if (hit) return true;
        }
      }
    } catch (_) {}
    if (htmlFragment && typeof htmlFragment === 'string') {
      return BLOG_COMMENT_BUTTON_TEXTS.some(function (btnText) {
        return new RegExp('\\b' + btnText + '\\b', 'i').test(htmlFragment);
      });
    }
    return false;
  }

  const htmlHasCommentButton = detectCommentButtonByDomOrHtml(bodyOnly);

  const urlHasCommentPath = /comment|comments|评论|留言/.test(url) &&
    (/comment-page-\d+|\/page\/\d+|next.*page|pagination/i.test(url));

  const htmlShowsCommentList = (/(?:<ol[^>]*<li[^>]*|<ul[^>]*<li)[^>]/i.test(bodyOnly)) &&
    (/<li[^>]*comment[^>]*>/i.test(bodyOnly));

  const htmlHasReplyFeature = /reply\s+(to\s+)?\s*comment/i.test(bodyOnly) ||
    /回复.*评论/i.test(bodyOnly);

  const htmlShowsCommentCount = /\d+\s*(?:thoughts?|comments?|responses?)\s+on\s+/i.test(bodyOnly) ||
    /留言?\s*\d+|\d+\s*留言/i.test(bodyOnly) ||
    /评论?\s*\d+|\d+\s*评论/i.test(bodyOnly) ||
    /commentaire?s?\s*\d+/i.test(bodyOnly);

  const htmlHasAvatar = /gravatar\.com|secure\.gravatar|avatar|头?like|用户头像/i.test(bodyOnly);

  const htmlHasSocialShare = (
    /(?:share|teilen|partager|分享)\s*(?:on|to|via|with|到|至)?\s*(?:facebook|twitter|linkedin|pinterest|x\.com|微博|微信)/i.test(bodyOnly) ||
    /(?:class|id)=["'][^"']*(?:share[-_]?(?:button|buttons|widget|this)|social[-_]?share|addtoany|sharethis)[^"']*["']/i.test(bodyOnly)
  );

  const htmlHasCommentPagination = /(?:newer|older|next|previous|comment.*page|pagination|分页)/i.test(bodyOnly);

  const htmlHasRSSFeed = /rss\.xml|feed\/|订阅/i.test(html) || /rss\.php\?/i.test(url);

  const hasStrongCommentSignal = urlHasCommentKeyword || htmlHasCommentForm;
  const hasCommentCorePair = htmlHasCommentInput && htmlHasCommentButton;

  let score = 0;
  if (urlHasCommentKeyword) score += 4;
  if (htmlHasCommentForm) score += 3;
  if (htmlHasCommentButton) score += 3;
  if (htmlShowsCommentList && htmlHasReplyFeature) score += 3;
  if (htmlShowsCommentCount) score += 2;
  if (htmlHasCommentPagination && hasStrongCommentSignal) score += 1;
  if (htmlHasAvatar && hasStrongCommentSignal) score += 1;
  if (htmlHasSocialShare) score += 1;
  if (htmlHasRSSFeed && hasStrongCommentSignal) score += 1;

  const wpLike = /generator=["']?\s*wordpress|wp-content|wp-includes|\/wp-json\/|wp-comments-post\.js|class=["']?\s*comment/i.test(bodyOnly);
  if (wpLike) score += 2;
  const mediumLike = /medium\.com/i.test(url) && /medium\.com\/[^/]+?source=comments|responses/i.test(bodyOnly);
  if (mediumLike) score += 2;
  const substackLike = /substack\.com/i.test(url) && /\/p\/[^/]+\/comments/i.test(bodyOnly);
  if (substackLike) score += 2;
  const bloggerLike = /blog(ger)?\.com|blogspot\.com/i.test(url) && /<iframe.*blogger-|blog-post-|post-comment-form/i.test(bodyOnly);
  if (bloggerLike) score += 2;
  const wixLike = /wixstatic\.com/i.test(url) && /_wix_static|wix-comments/i.test(bodyOnly);
  if (wixLike) score += 2;

  out.score = score;
  // Blog 评论站必须具备「评论输入区 + 评论按钮」这一核心组合，否则即使得分达到阈值也不判定为可评论站
  out.isBlogCommentSite = score >= th && hasCommentCorePair;

  const items = [
    { rule: 'URL含评论关键词/参数', points: 4, hit: urlHasCommentKeyword },
    { rule: 'HTML含评论表单标题', points: 3, hit: htmlHasCommentForm },
    { rule: 'HTML含评论按钮', points: 3, hit: htmlHasCommentButton && htmlHasCommentInput },
    { rule: '评论列表+回复功能', points: 3, hit: htmlShowsCommentList && htmlHasReplyFeature },
    { rule: '评论数展示', points: 2, hit: htmlShowsCommentCount },
    { rule: '评论分页导航', points: 1, hit: htmlHasCommentPagination && hasStrongCommentSignal },
    { rule: '头像服务', points: 1, hit: htmlHasAvatar && hasStrongCommentSignal },
    { rule: '社交分享', points: 1, hit: htmlHasSocialShare },
    { rule: 'RSS订阅', points: 1, hit: htmlHasRSSFeed && hasStrongCommentSignal },
    { rule: 'WordPress等特征', points: 2, hit: wpLike },
    { rule: 'Medium特征', points: 2, hit: mediumLike },
    { rule: 'Substack特征', points: 2, hit: substackLike },
    { rule: 'Blogger特征', points: 2, hit: bloggerLike },
    { rule: 'Wix特征', points: 2, hit: wixLike }
  ];
  const hitItems = items.filter(function (x) { return x.hit; });
  const detailStr = hitItems.map(function (x) { return x.rule + '+' + x.points; }).join(', ');
  console.log(
    TAG + ' [Blog评论站] 当前判断阈值: ' + th +
    ' | 总分: ' + score + (score >= th ? ' (≥阈值, 判定为可评论站)' : ' (<阈值, 非可评论站)') +
    ' | 命中项: ' + (detailStr || '无')
  );
  console.log(TAG + ' [Blog评论站] 记分明细', { 命中: hitItems, 总分: score, 阈值: th, 结果: out.isBlogCommentSite ? '可评论站' : '否' });

  return out;
}

/**
 * 检测当前页面是否为导航站（目录站/书签站/资源站）
 * @param {string} url - 页面 URL
 * @param {string} html - 页面 HTML 内容
 * @returns {boolean} 是否为导航站
 */
function isNavigationSite(url, html) {
  if (!url || !html) return false;

  // ==================== 强判定规则（命中即返回 true） ====================

  // 强判定 1：URL 路径包含 /tool/ /tools/ /directory/ /directories/（完整路径片段）
  try {
    const urlPath = new URL(url).pathname || '';
    // 正则：匹配完整路径片段（以 / 开头和结尾，或处于 URL 末尾）
    const navPathPattern = /(?:^|\/)(?:tool|tools|directory|directories)(?:\/|$)/i;
    if (navPathPattern.test(urlPath)) {
      console.log(TAG + ' [导航站检测] 强判定命中：URL路径包含 /tool|tools|directory|directories/ → ' + urlPath);
      return true;
    }
  } catch (e) {}

  // 强判定 2：Navbar 包含 Submit 按钮（多语言）
  const navbarSelectors = ['nav', 'header', '.navbar', '#navbar', '[role="navigation"]'];
  const submitKeywords = [
    // 英语
    'submit', 'add url', 'add site', 'suggest', 'submit site', 'submit url', 'add your site',
    // 中文
    '提交', '收录', '提交网站', '添加网址', '网站提交', '网址收录',
    // 德语
    'einreichen', 'hinzufügen', 'vorschlagen',
    // 法语
    'soumettre', 'ajouter', 'proposer',
    // 西班牙语
    'enviar', 'añadir', 'sugerir',
    // 意大利语
    'invia', 'aggiungi', 'suggerisci',
    // 日语
    '送信', '追加', '提案',
    // 韩语
    '제출', '추가', '제안'
  ];

  for (const selector of navbarSelectors) {
    try {
      const navElements = document.querySelectorAll(selector);
      for (const navEl of navElements) {
        const navText = (navEl.innerText || '').toLowerCase();
        for (const keyword of submitKeywords) {
          if (navText.includes(keyword.toLowerCase())) {
            console.log(TAG + ' [导航站检测] 强判定命中：Navbar包含Submit按钮"' + keyword + '" → 是导航站');
            return true;
          }
        }
      }
    } catch (e) {}
  }

  // ==================== 计分规则（未命中强判定时使用） ====================

  // 导航站常见关键词（域名、标题、描述）
  const NAV_KEYWORDS = [
    'directory', 'directories', 'link directory', 'web directory',
    'bookmark', 'bookmarks', 'site list', 'website list', 'useful links',
    '导航', '网址', '网站目录', '网址导航', '网址大全', '链接导航', '资源站',
    'best sites', 'top sites', 'recommended sites', 'cool sites',
    'submit site', 'add site', 'add url', 'submit url', 'suggest site',
    'web directory', 'internet directory', 'url directory',
    '资源导航', '网站收录', '提交网站'
  ];

  // URL 路径特征（计分）
  const urlPathLc = url.toLowerCase();
  const urlHasNavPath = /\/(?:directory|directories|links|resources|bookmarks|submit|add-url|add-site|导航|网址)/.test(urlPathLc);

  // 提取 title 和 description
  let title = '';
  let description = '';
  if (html && typeof html === 'string') {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    title = titleMatch ? titleMatch[1] : '';
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    description = descMatch ? descMatch[1] : '';
  }

  // 计分
  let score = 0;

  // URL 路径命中
  if (urlHasNavPath) score += 2;

  // 标题命中导航站关键词
  const titleLc = title.toLowerCase();
  for (const kw of NAV_KEYWORDS) {
    if (titleLc.includes(kw.toLowerCase())) {
      score += 3;
      break;
    }
  }

  // 描述命中导航站关键词
  const descLc = description.toLowerCase();
  for (const kw of NAV_KEYWORDS) {
    if (descLc.includes(kw.toLowerCase())) {
      score += 2;
      break;
    }
  }

  // 页面 body 包含导航站关键词
  const bodyOnly = stripNonBodyForCommentDetection(html);
  const bodyLc = bodyOnly.toLowerCase();
  let keywordHits = 0;
  for (const kw of NAV_KEYWORDS) {
    if (bodyLc.includes(kw.toLowerCase())) {
      keywordHits++;
    }
  }
  if (keywordHits >= 3) score += 2;
  else if (keywordHits >= 1) score += 1;

  // 有"提交网站"表单
  if (/<form[^>]*>[\s\S]*?(?:submit|add|suggest|提交|收录)[\s\S]*?(?:site|url|link|网站|网址)[\s\S]*?<\/form>/i.test(html)) {
    score += 3;
  }

  // 链接密集：链接数 > 100（导航站特征）
  const linkCount = (html.match(/<a\s+/gi) || []).length;
  if (linkCount > 150) score += 2;
  else if (linkCount > 80) score += 1;

  // 阈值：≥ 5 分判定为导航站
  const isNav = score >= 5;
  console.log(TAG + ' [导航站检测] URL=' + url.slice(0, 60) + ' | 得分=' + score + ' | 结果=' + (isNav ? '是' : '否'));

  return isNav;
}

/**
 * 滚动页面到最底部，自动检测懒加载是否完成
 * @param {number} stabilityCheckMs 检测页面高度稳定的间隔（毫秒）
 * @param {number} maxWaitMs 最大等待时间（毫秒），防止无限等待
 * @returns {Promise<void>}
 */
async function scrollToBottomAndWait(stabilityCheckMs = 200, maxWaitMs = 5000) {
  const startTime = Date.now();

  const doScroll = () => window.scrollTo(0, document.body.scrollHeight);

  // 第一次滚动到底部
  doScroll();
  // 等待一小段时间
  await new Promise(resolve => setTimeout(resolve, 100));
  // 第二次滚动（确保触发懒加载）
  doScroll();

  let lastHeight = document.body.scrollHeight;

  while (Date.now() - startTime < maxWaitMs) {
    // 等待一个检测周期
    await new Promise(resolve => setTimeout(resolve, stabilityCheckMs));

    const currentHeight = document.body.scrollHeight;

    // 如果页面高度稳定（没有新内容加载）
    if (currentHeight === lastHeight) {
      break;
    }

    // 高度有变化，说明有新内容加载，继续滚动
    lastHeight = currentHeight;
    doScroll();
  }

  // 最终再滚动一次确保到底
  doScroll();
}

/**
 * 从当前页评论区提取评论者留下的网站 URL（外链采集 FR-2）
 * 先滚动页面到底部触发懒加载，再匹配评论区，再匹配论坛/主内容区，最后回退到 body（大页限制处理数量）。
 * @returns {Promise<string[]>} 原始 href 列表，由 sidepanel 做标准化与去重
 */
async function extractCommentUrlsFromPage() {
  // 先滚动到页面底部，自动检测懒加载完成
  await scrollToBottomAndWait();

  const pageHost = window.location.hostname.toLowerCase();
  const seen = new Set();
  const out = [];

  let root = null;
  for (const sel of COMMENT_AREA_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && el.querySelectorAll('a[href]').length > 0) {
        root = el;
        break;
      }
    } catch (_) {}
  }
  if (!root) {
    for (const sel of MAIN_CONTENT_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.querySelectorAll('a[href]').length > 0) {
          root = el;
          break;
        }
      } catch (_) {}
    }
  }
  if (!root) root = document.body;

  const allInRoot = root.querySelectorAll('a[href]');
  const links = allInRoot.length > EXTRACT_LINKS_CAP
    ? Array.from(allInRoot).slice(0, EXTRACT_LINKS_CAP)
    : allInRoot;

  for (const a of links) {
    const href = (a.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    if (!href.startsWith('http://') && !href.startsWith('https://')) continue;
    try {
      const u = new URL(href);
      const host = u.hostname.toLowerCase();
      if (host === pageHost) continue;
      if (COMMENT_LINK_SKIP_HOSTS.some((h) => host.includes(h))) continue;
      const key = host + (u.pathname || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(href);
    } catch (_) {}
  }
  const rootLabel = root.id ? `#${root.id}` : (root.className && typeof root.className === 'string' ? root.className.split(/\s+/)[0] : root.tagName || 'body');
  console.log(TAG, 'extractCommentUrls:', { root: rootLabel, scanned: links.length, extracted: out.length });
  return out;
}

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
  } else if (request.action === 'getCommentPageState') {
    sendResponse({ success: true, state: commentFormState });
  } else if (request.action === 'recognizeCommentForm') {
    try {
      (function runRecognizeWithScroll() {
        scrollToBottomForTraverseDetection()
          .then(triggerCommentInputForLoginCheck)
          .then(function () {
            const url = window.location.href;
            const html = document.documentElement.outerHTML;
            const requiresLogin = detectRequiresLoginToComment(html);
            const isNav = isNavigationSite(url, html);
            return new Promise(function (resolve) {
              chrome.storage.local.get(['blogCommentSiteThreshold'], function (storageResult) {
                const threshold = storageResult.blogCommentSiteThreshold;
                const effectiveThreshold = typeof threshold === 'number' && threshold >= 0 ? threshold : BLOG_COMMENT_SITE_THRESHOLD_DEFAULT;
                const blogResult = isBlogCommentSite(url, html, effectiveThreshold);
                resolve({ blogResult, requiresLogin, isNavigationSite: isNav });
              });
            }).then(function (payload) {
              return recognizeCommentForm(request.useLlm).then(function (result) {
                return { blogResult: payload.blogResult, requiresLogin: payload.requiresLogin, isNavigationSite: payload.isNavigationSite, result };
              });
            });
          })
          .then(function (data) {
            try {
              sendResponse({
                success: true,
                result: Object.assign({}, data.result, {
                  isBlogCommentSite: data.blogResult.isBlogCommentSite,
                  blogCommentScore: data.blogResult.score,
                  requiresLogin: data.requiresLogin,
                  isNavigationSite: data.isNavigationSite
                })
              });
            } catch (e) {
              // 通道已关闭时静默忽略，避免抛出未捕获异常
            }
          })
          .catch(function (error) {
            try {
              sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
            } catch (e) {
              // 同上：若通道已关闭则忽略
            }
          });
      })();
      return true;
    } catch (e) {
      sendResponse({ success: false, error: e && e.message ? e.message : String(e) });
      return false;
    }
  } else if (request.action === 'fillCommentForm') {
    const verifyOpts = { tabId: request.tabId, siteUrl: request.siteUrl };
    fillCommentForm(request.siteId, request.commentText, request.autoSubmit, verifyOpts)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'blogCommentGenerateAndFill') {
    const startMs = Date.now();
    blogCommentGenerateAndFill({
      title: request.title,
      description: request.description,
      h1: request.h1,
      siteId: request.siteId,
      autoSubmit: request.autoSubmit,
      llmEnabled: request.llmEnabled,
      tabId: request.tabId,
      siteUrl: request.siteUrl
    })
      .then((result) => {
        sendResponse(result);
        chrome.runtime.sendMessage({ action: 'blogCommentFlowComplete', response: result }).catch(() => {});
      })
      .catch((error) => {
        const response = { success: false, error: error?.message || '操作失败', elapsedMs: Date.now() - startMs };
        sendResponse(response);
        chrome.runtime.sendMessage({ action: 'blogCommentFlowComplete', response }).catch(() => {});
      });
    return true;
  } else if (request.action === 'verifyCommentSubmission') {
    verifyCommentSubmission(request.siteUrl)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'clearCommentMapping') {
    clearCommentMapping().then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'highlightCommentFieldsFromCache') {
    highlightOrClearCommentFieldsFromCache()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err?.message || '高亮失败' }));
    return true;
  } else if (request.action === 'highlightCommentFieldPrev') {
    sendResponse(jumpToHighlightedCommentField(-1));
  } else if (request.action === 'highlightCommentFieldNext') {
    sendResponse(jumpToHighlightedCommentField(1));
  } else if (request.action === 'getPageMetadata') {
    const title = document.title || '';
    const descEl = document.querySelector('meta[name="description"]');
    const description = (descEl && descEl.getAttribute('content')) || '';
    const h1El = document.querySelector('h1');
    const h1 = (h1El && h1El.textContent && h1El.textContent.trim()) || '';
    sendResponse({ success: true, title, description, h1 });
  } else if (request.action === 'fullAiPrepareForComment') {
    handleFullAiPrepareForComment().then(sendResponse);
    return true;
  } else if (request.action === 'extractCommentUrls') {
    extractCommentUrlsFromPage()
      .then((urls) => sendResponse({ success: true, urls }))
      .catch((err) => sendResponse({ success: false, error: err?.message || '提取失败', urls: [] }));
    return true;
  } else if (request.action === 'ahrefsPrepareAndCheck') {
    const domain = (request.domain || '').trim();
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const humanDelay = () => new Promise(r => setTimeout(r, randInt(800, 2000)));
    const shortDelay = () => new Promise(r => setTimeout(r, randInt(300, 700)));

    const simulateHumanClick = (el) => {
      if (!el || !el.getBoundingClientRect) return;
      const rect = el.getBoundingClientRect();
      const maxOffsetX = Math.max(8, rect.width * 0.25);
      const maxOffsetY = Math.max(5, rect.height * 0.3);
      const ox = (Math.random() * 2 - 1) * maxOffsetX;
      const oy = (Math.random() * 2 - 1) * maxOffsetY;
      const cx = rect.left + rect.width / 2 + ox;
      const cy = rect.top + rect.height / 2 + oy;
      const approachX = cx + randInt(-30, -10);
      const approachY = cy + randInt(-15, 15);
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: approachX, clientY: approachY, view: window }));
      setTimeout(() => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy, view: window }));
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy, view: window }));
        setTimeout(() => {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
          setTimeout(() => {
            const releaseX = cx + (Math.random() * 4 - 2);
            const releaseY = cy + (Math.random() * 4 - 2);
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: releaseX, clientY: releaseY, view: window }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: releaseX, clientY: releaseY, view: window }));
          }, randInt(60, 180));
        }, randInt(100, 300));
      }, randInt(50, 150));
    };

    const simulateHumanType = async (el, text) => {
      el.focus();
      await shortDelay();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      for (let i = 0; i < text.length; i++) {
        const partial = text.slice(0, i + 1);
        if (nativeSetter) nativeSetter.call(el, partial);
        else el.value = partial;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: text[i], bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: text[i], bubbles: true }));
        await new Promise(r => setTimeout(r, randInt(60, 180)));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const findInput = () => {
      const sels = [
        'input[name="input"]',
        'input[placeholder*="domain" i]',
        'input[placeholder*="URL" i]',
        'input[type="text"]:not([readonly]):not([hidden])'
      ];
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el;
        } catch (_) {}
      }
      return null;
    };

    const findBtn = () => {
      const hasText = (el) => /check\s*backlink/i.test((el.textContent || el.value || '').trim());
      for (const sel of ['button[type="submit"]', 'button', 'input[type="submit"]', '[role="button"]', 'a']) {
        const btn = Array.from(document.querySelectorAll(sel)).find(hasText);
        if (btn && btn.offsetParent !== null) return btn;
      }
      return null;
    };

    (async () => {
      try {
        await humanDelay();

        let inputEl = null;
        let btn = null;
        for (let retry = 0; retry < 8; retry++) {
          inputEl = findInput();
          btn = findBtn();
          if (inputEl && btn) break;
          await new Promise(r => setTimeout(r, randInt(800, 1500)));
        }

        if (!inputEl) {
          sendResponse({ success: false, error: '未找到输入框', filledInput: false });
          return;
        }

        if (domain) {
          inputEl.click();
          await shortDelay();
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(inputEl, '');
          else inputEl.value = '';
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          await simulateHumanType(inputEl, domain);
          console.log(TAG, 'Ahrefs: 已模拟人工输入域名:', domain);
        }

        await humanDelay();

        btn = findBtn();
        if (!btn) {
          sendResponse({ success: false, error: '未找到 Check backlinks 按钮', filledInput: !!domain });
          return;
        }

        simulateHumanClick(btn);
        console.log(TAG, 'Ahrefs: 已模拟人工点击 Check backlinks');
        await shortDelay();
        sendResponse({ success: true, filledInput: !!domain });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || '操作异常', filledInput: false });
      }
    })();
    return true;

  } else if (request.action === 'ahrefsClickCheckBtn') {
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    const humanClickEl = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const maxOx = Math.max(8, rect.width * 0.25);
      const maxOy = Math.max(5, rect.height * 0.3);
      const cx = rect.left + rect.width / 2 + (Math.random() * 2 - 1) * maxOx;
      const cy = rect.top + rect.height / 2 + (Math.random() * 2 - 1) * maxOy;
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx - randInt(20, 50), clientY: cy + randInt(-10, 10), view: window }));
      setTimeout(() => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy, view: window }));
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy, view: window }));
        setTimeout(() => {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
          setTimeout(() => {
            const rx = cx + (Math.random() * 3 - 1.5);
            const ry = cy + (Math.random() * 3 - 1.5);
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rx, clientY: ry, view: window }));
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rx, clientY: ry, view: window }));
          }, randInt(60, 180));
        }, randInt(120, 350));
      }, randInt(80, 200));
      return true;
    };

    const findCheckBtn = () => {
      const hasText = (el) => /check\s*backlink/i.test((el.textContent || el.value || '').trim());
      for (const sel of ['button[type="submit"]', 'button', 'input[type="submit"]', '[role="button"]', 'a']) {
        const btn = Array.from(document.querySelectorAll(sel)).find(hasText);
        if (btn && btn.offsetParent !== null) return btn;
      }
      return null;
    };

    (async () => {
      try {
        for (let retry = 0; retry < 10; retry++) {
          const btn = findCheckBtn();
          if (btn) {
            console.log(TAG, 'Ahrefs: 找到 Check backlinks 按钮，准备点击');
            await new Promise(r => setTimeout(r, randInt(500, 1200)));
            humanClickEl(btn);
            await new Promise(r => setTimeout(r, randInt(300, 600)));
            sendResponse({ success: true });
            return;
          }
          await new Promise(r => setTimeout(r, randInt(800, 1500)));
        }
        sendResponse({ success: false, error: '多次重试后仍未找到 Check backlinks 按钮' });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || '点击异常' });
      }
    })();
    return true;

  } else if (request.action === 'ahrefsDetectCF') {
    const cfIndicators = [
      '.cf-turnstile',
      'iframe[src*="challenges.cloudflare"]',
      '#challenge-running',
      '#challenge-form',
      '[data-sitekey]'
    ];
    let hasCF = false;
    for (const sel of cfIndicators) {
      try {
        const el = document.querySelector(sel);
        if (el) { hasCF = true; break; }
      } catch (_) {}
    }
    if (!hasCF) {
      hasCF = /verify you are human|just a moment|checking your browser/i.test(document.body?.innerText?.slice(0, 500) || '');
    }
    sendResponse({ success: true, hasCF });
    return true;

  } else if (request.action === 'ahrefsClickCloudflare') {
    const clickAtCenter = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const maxOx = Math.max(6, rect.width * 0.2);
      const maxOy = Math.max(4, rect.height * 0.25);
      const x = rect.left + rect.width / 2 + (Math.random() * 2 - 1) * maxOx;
      const y = rect.top + rect.height / 2 + (Math.random() * 2 - 1) * maxOy;
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x - 15, clientY: y - 8, view: window }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y, view: window }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y, view: window }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
      const rx = x + (Math.random() * 3 - 1.5);
      const ry = y + (Math.random() * 3 - 1.5);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: rx, clientY: ry, view: window }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rx, clientY: ry, view: window }));
      return true;
    };

    const turnstileContainer = document.querySelector('.cf-turnstile');
    if (turnstileContainer) {
      const iframe = turnstileContainer.querySelector('iframe');
      if (iframe) {
        clickAtCenter(iframe);
        sendResponse({ success: true, found: 'turnstile-iframe', note: 'clicked iframe container; user may need to complete manually' });
        return true;
      }
    }

    const candidates = [
      () => document.querySelector('[data-sitekey] iframe'),
      () => document.querySelector('[data-sitekey]'),
      () => Array.from(document.querySelectorAll('input[type="checkbox"]')).find((c) => c.offsetParent !== null),
      () => Array.from(document.querySelectorAll('button, [role="button"], a')).find((el) => /verify|human|not a robot/i.test((el.textContent || '').trim())),
      () => document.querySelector('#challenge-form input[type="submit"]'),
      () => document.querySelector('.challenge-form input[type="submit"], .cf-form input[type="submit"]')
    ];
    for (const getEl of candidates) {
      try {
        const el = getEl();
        if (el && el.offsetParent !== null) {
          clickAtCenter(el);
          el.click();
          sendResponse({ success: true, found: el.className || el.id || el.tagName });
          return true;
        }
      } catch (_) {}
    }
    sendResponse({ success: false, error: '未找到人机验证控件' });
    return true;

  } else if (request.action === 'ahrefsInjectTurnstileToken') {
    const token = request.token;
    if (!token) {
      sendResponse({ success: false, error: '未提供 token' });
      return true;
    }
    window.postMessage({ __navSubmitterInjectTurnstileToken: true, token }, '*');
    const onResult = (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.__navSubmitterTurnstileInjected !== undefined) {
        window.removeEventListener('message', onResult);
        clearTimeout(timer);
        sendResponse({ success: event.data.__navSubmitterTurnstileInjected, method: event.data.method || 'unknown' });
      }
    };
    window.addEventListener('message', onResult);
    const timer = setTimeout(() => {
      window.removeEventListener('message', onResult);
      sendResponse({ success: false, error: 'token 注入超时' });
    }, 5000);
    return true;
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

  /** 将单个 input/textarea/select 转为 fieldInfo 并 push 到 fields（供 form 内与兄弟节点共用） */
  function pushFieldInfo(input) {
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(input.type)) return false;
    if (input.tagName === 'TEXTAREA' && input.style.display === 'none' && /simplemde|easymde/i.test(input.id)) return false;
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
      required: input.required || false,
      ariaHidden: input.getAttribute('aria-hidden') || null
    };
    if (input.tagName === 'SELECT') {
      fieldInfo.options = Array.from(input.options).map(opt => ({ value: opt.value, text: opt.text.trim() })).filter(opt => opt.text);
    }
    if (input.tagName === 'TEXTAREA') fieldInfo.isTextarea = true;
    fields.push(fieldInfo);
    return true;
  }

  forms.forEach((form, formIndex) => {
    const inputs = form.querySelectorAll('input, textarea, select');
    const countBeforeForm = fields.length;

    inputs.forEach((input) => {
      pushFieldInfo(input);
    });

    // 部分站点（如日语）form 标签在 table 内且提前闭合，真实输入在 tbody（form 的 nextElementSibling）中
    if (fields.length === countBeforeForm) {
      let sibling = form.nextElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {
        const siblingInputs = sibling.querySelectorAll ? sibling.querySelectorAll('input, textarea, select') : [];
        let added = 0;
        for (const input of siblingInputs) {
          if (pushFieldInfo(input)) added++;
        }
        if (added) break;
        sibling = sibling.nextElementSibling;
      }
    }

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
 * 判断是否为蜜罐/防垃圾隐藏控件（不应参与填充，且会导致 AI 的 fieldIndex 与 fields 顺序错位）
 */
function isHoneypotField(field) {
  if (field.ariaHidden === 'true') return true;
  if (field.ariaLabel && /hp-|honeypot|^hp$/i.test(field.ariaLabel)) return true;
  return false;
}

/**
 * 获取评论提交区表单元数据（包含 input/textarea/select 以及 submit/button）。
 * 会过滤掉蜜罐控件（aria-hidden、hp- 等），使 fields 顺序与 AI 按“可见可填字段”编号一致；
 * 且不附带 formHtml，改用 formDescription 发给 AI，避免 HTML 中蜜罐导致 fieldIndex 错位。
 */
function getCommentFormMetadata() {
  const base = getFormMetadata();
  if (!base.hasForm || !base.fields) {
    return { ...base, fields: [] };
  }
  const filtered = base.fields.filter((f) => !isHoneypotField(f));
  const fields = [];
  filtered.forEach((f) => {
    const { ariaHidden, ...rest } = f;
    fields.push(rest);
  });

  // 部分站点（如日语）form 提前闭合，评论框 textarea 在 form 外的兄弟节点中；先补充这些 textarea，
  // 再补充 submit，保证发给 AI 的 [0]=name [1]=url [2]=comment [3]=submit，避免 index 2 错位成提交按钮
  const locatorKey = (loc) => JSON.stringify(loc);
  const existingKeys = new Set(fields.map((f) => locatorKey(f.locator)));
  const forms = document.querySelectorAll('form');
  forms.forEach((form) => {
    let sibling = form.nextElementSibling;
    for (let i = 0; i < 3 && sibling; i++) {
      const textareas = sibling.querySelectorAll ? sibling.querySelectorAll('textarea') : [];
      for (const ta of textareas) {
        if (!isElementVisible(ta)) continue;
        const loc = getFieldLocator(ta);
        if (existingKeys.has(locatorKey(loc))) continue;
        existingKeys.add(locatorKey(loc));
        const label = getFieldLabel(ta);
        fields.push({
          locator: loc,
          xpath: getXPath(ta),
          locatorDesc: formatLocator(loc),
          type: 'textarea',
          name: ta.name || '',
          id: ta.id || '',
          placeholder: ta.placeholder || '',
          label: label ? label.slice(0, 80) : '',
          ariaLabel: ta.getAttribute('aria-label') || '',
          required: ta.required || false,
          isTextarea: true
        });
        break;
      }
      sibling = sibling.nextElementSibling;
    }
  });

  forms.forEach((form) => {
    const countBefore = fields.length;
    form.querySelectorAll('input[type="submit"], input[type="button"], button').forEach((btn) => {
      const label = getFieldLabel(btn) || btn.value || btn.textContent?.trim() || '';
      fields.push({
        locator: getFieldLocator(btn),
        xpath: getXPath(btn),
        locatorDesc: formatLocator(getFieldLocator(btn)),
        type: btn.type || 'submit',
        name: btn.name || '',
        id: btn.id || '',
        placeholder: '',
        label: label.slice(0, 80),
        ariaLabel: btn.getAttribute('aria-label') || '',
        required: false,
        isSubmitButton: true
      });
    });
    // 部分站点（如日语）form 标签提前闭合，提交按钮在紧随的 table 内，从该 form 的相邻兄弟节点补充
    if (fields.length === countBefore) {
      let sibling = form.nextElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {
        const btn = sibling.querySelector && sibling.querySelector('input[type="submit"], input[type="button"], button');
        if (btn && isElementVisible(btn)) {
          const label = getFieldLabel(btn) || btn.value || btn.textContent?.trim() || '';
          fields.push({
            locator: getFieldLocator(btn),
            xpath: getXPath(btn),
            locatorDesc: formatLocator(getFieldLocator(btn)),
            type: btn.type || 'submit',
            name: btn.name || '',
            id: btn.id || '',
            placeholder: '',
            label: label.slice(0, 80),
            ariaLabel: btn.getAttribute('aria-label') || '',
            required: false,
            isSubmitButton: true
          });
          break;
        }
        sibling = sibling.nextElementSibling;
      }
    }
  });
  return {
    hasForm: fields.length > 0,
    fields,
    url: window.location.href,
    domain: window.location.hostname,
    formHtml: undefined
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
      // 只匹配表单控件，避免 name 与 form 的 name 重复时选到 form（如 <form name="comment"> 与 <textarea name="comment">）
      const nameSelector = `input[name="${locator.value}"], textarea[name="${locator.value}"], select[name="${locator.value}"]`;
      const forms = document.querySelectorAll('form');
      const form = forms[locator.formIndex];
      if (form) {
        let el = form.querySelector(nameSelector);
        // 部分站点 form 提前闭合，输入在 table/tbody（form 的兄弟节点）中
        if (!el) {
          let sibling = form.nextElementSibling;
          for (let i = 0; i < 3 && sibling; i++) {
            el = sibling.querySelector && sibling.querySelector(nameSelector);
            if (el) break;
            sibling = sibling.nextElementSibling;
          }
        }
        if (el) return el;
      }
      return document.querySelector(nameSelector);
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
    pricing: {
      keywords: ['pricing', 'price', 'plan', '定价', '价格', '付费', 'free', 'paid', 'freemium', 'trial'],
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

// ---------- Blog 评论表单：关键词匹配与缓存（每类约 30+ 种多语言关键词） ----------
const COMMENT_FIELD_KEYWORDS = {
  comment: {
    keywords: [
      'comment', 'comments', 'message', 'reply', 'feedback', 'note', '内容', '评论', '留言', '评论内容', '回复',
      'komentář', 'komentar', 'commentaire', 'comentario', 'kommentar', 'commento', 'comentário', 'reactie', 'kommentar',
      'kommentera', 'yorum', 'σχόλιο', 'komentaras', 'komentārs', 'uwagi', 'комментарий', 'komentar', 'ความคิดเห็น',
      'bình luận', '댓글', 'コメント', '评论', '意見', 'observación', 'mensaje'
    ],
    isTextarea: true,
    weights: { name: 3, label: 2, placeholder: 1 }
  },
  commentName: {
    keywords: [
      'name', 'author', 'your name', 'username', 'display name', '姓名', '名字', '昵称', '作者', '称呼',
      'jméno', 'jmeno', 'ime', 'nombre', 'nom', 'nome', 'naam', 'namn', 'név', 'imię', 'имя', 'tên', '이름',
      '名前', 'nome', 'naam', 'autor', 'pengarang', 'όνομα', 'vārds', 'vardas', 'nume', 'isim', 'ad'
    ],
    weights: { name: 3, label: 2, placeholder: 1 }
  },
  commentEmail: {
    keywords: [
      'email', 'e-mail', 'mail', 'email address', '邮箱', '邮件', '电子邮箱', '電郵', 'メール', '이메일',
      'e-pošta', 'eposta', 'correo', 'courriel', 'e-mail', 'e-mailadres', 'mejl', 'e-posta', 'el. paštas',
      'e-pasts', 'elektroninis paštas', 'email', 'e-mail', 'อีเมล', 'địa chỉ email', '이메일', 'メールアドレス'
    ],
    type: 'email',
    weights: { type: 3, name: 2, label: 2 }
  },
  commentWebsite: {
    keywords: [
      'website', 'url', 'web', 'site', 'homepage', 'link', '网址', '网站', '个人网站', '主页', '連結', '網址',
      'spletišče', 'spletisce', 'spletna', 'weblink', 'webová stránka', 'sitio', 'webseite', 'site web', 'site internet',
      'pagina web', 'website', 'weblink', 'hemsida', 'honlap', 'strona', 'site', 'сайт', 'trang web', '웹사이트',
      'ウェブサイト', 'website url', 'home page', 'personal website', 'your website', 'blog url'
    ],
    type: 'url',
    weights: { type: 2, name: 2, label: 2 }
  }
};

function recognizeCommentByKeywords(formMetadata) {
  const matches = [];
  for (const field of formMetadata.fields) {
    if (field.isSubmitButton) continue;
    const nameLower = (field.name || '').toLowerCase();
    const labelLower = (field.label || '').toLowerCase();
    const placeholderLower = (field.placeholder || '').toLowerCase();
    const ariaLabelLower = (field.ariaLabel || '').toLowerCase();
    const idLower = (field.id || '').toLowerCase();
    const scores = {};

    for (const [standardField, config] of Object.entries(COMMENT_FIELD_KEYWORDS)) {
      let score = 0;
      if (config.type && field.type === config.type) score += (config.weights.type || 2) * 2;
      if (config.isTextarea && field.isTextarea) score += 3;
      for (const kw of config.keywords) {
        const k = kw.toLowerCase();
        if (nameLower.includes(k)) score += config.weights.name || 1;
        if (labelLower.includes(k)) score += config.weights.label || 1;
        if (placeholderLower.includes(k)) score += config.weights.placeholder || 1;
        if (ariaLabelLower.includes(k)) score += (config.weights.label || 1) * 1.2;
        if (idLower.includes(k)) score += config.weights.name || 1;
      }
      if (score > 0) scores[standardField] = score;
    }

    let bestField = null;
    let bestScore = 0;
    for (const [fn, sc] of Object.entries(scores)) {
      if (sc > bestScore) { bestScore = sc; bestField = fn; }
    }
    if (bestScore >= 2 && bestField) {
      matches.push({
        locator: field.locator,
        standardField: bestField,
        confidence: Math.min(bestScore / 6, 1),
        method: 'keyword',
        xpath: field.xpath,
        locatorDesc: field.locatorDesc
      });
    }
  }

  // 提交按钮：常见文案
  const submitPatterns = [/submit|post\s*comment|send|发表|提交|komentovat|odeslat|submitter|envoyer/i];
  for (const field of formMetadata.fields) {
    if (!field.isSubmitButton) continue;
    const text = ((field.label || '') + (field.name || '') + (field.ariaLabel || '')).toLowerCase();
    if (submitPatterns.some(p => p.test(text))) {
      return { mappings: matches, submitButton: { locator: field.locator, xpath: field.xpath, locatorDesc: field.locatorDesc } };
    }
  }
  const lastSubmit = formMetadata.fields.filter(f => f.isSubmitButton).pop();
  return {
    mappings: matches,
    submitButton: lastSubmit ? { locator: lastSubmit.locator, xpath: lastSubmit.xpath, locatorDesc: lastSubmit.locatorDesc } : null
  };
}

function getCommentCacheKey() {
  const url = new URL(window.location.href);
  return 'blog_' + url.hostname + url.pathname;
}

async function getCachedCommentMapping(cacheKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['blogCommentFieldMappings'], (result) => {
      const data = result.blogCommentFieldMappings?.[cacheKey];
      if (!data) { resolve(null); return; }
      const mappings = data.mappings || data;
      const submitButton = data.submitButton || null;
      const consentCheckboxes = data.consentCheckboxes || null;
      const out = Array.isArray(mappings)
        ? { mappings, submitButton, consentCheckboxes }
        : { mappings: mappings.mappings || [], submitButton: mappings.submitButton, consentCheckboxes };
      resolve(out);
    });
  });
}

async function cacheCommentMapping(cacheKey, payload) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['blogCommentFieldMappings'], (result) => {
      const mappings = result.blogCommentFieldMappings || {};
      mappings[cacheKey] = {
        mappings: payload.mappings || payload,
        submitButton: payload.submitButton || null,
        consentCheckboxes: payload.consentCheckboxes || null,
        cachedAt: new Date().toISOString()
      };
      chrome.storage.local.set({ blogCommentFieldMappings: mappings }, () => resolve());
    });
  });
}

async function clearCommentMapping() {
  const cacheKey = getCommentCacheKey();
  return new Promise((resolve) => {
    chrome.storage.local.get(['blogCommentFieldMappings'], (result) => {
      const mappings = result.blogCommentFieldMappings || {};
      delete mappings[cacheKey];
      chrome.storage.local.set({ blogCommentFieldMappings: mappings }, () => {
        commentFormState.fieldMappings = null;
        commentFormState.submitButton = null;
        commentFormState.consentCheckboxes = null;
        commentFormState.recognitionStatus = 'idle';
        resolve();
      });
    });
  });
}

/** 验证本次提交：找到的本站链接高亮用的 CSS 类名（黄色虚线框） */
const VERIFY_LINK_HIGHLIGHT_CLASS = 'blog-verify-link-highlight';

/** 可填字段高亮用的 CSS 类名（蓝色虚线框） */
const COMMENT_FIELD_HIGHLIGHT_CLASS = 'blog-comment-field-highlight';

/** 当前是否正处于「可填字段高亮」状态，用于点击切换清除 */
let commentFieldHighlightActive = false;

/** 当前箭头跳转指向的高亮字段索引（0-based），用于上/下箭头切换 */
let commentFieldHighlightCurrentIndex = 0;

/**
 * 注入「验证本次提交」找到链接的高亮样式（黄色虚线框），仅注入一次
 */
function ensureVerifyLinkHighlightStyle() {
  if (document.getElementById('blog-verify-link-highlight-style')) return;
  const style = document.createElement('style');
  style.id = 'blog-verify-link-highlight-style';
  style.textContent = `.${VERIFY_LINK_HIGHLIGHT_CLASS} { outline: 2px dashed #f59e0b; outline-offset: 2px; background: rgba(245, 158, 11, 0.12); }`;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * 清除页面上「验证本次提交」的链接高亮
 */
function clearVerifyLinkHighlight() {
  document.querySelectorAll(`.${VERIFY_LINK_HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(VERIFY_LINK_HIGHLIGHT_CLASS);
  });
}

/**
 * 注入可填字段高亮样式（蓝色虚线框），仅注入一次
 */
/** 当前箭头指向的字段使用的 class（实线加粗蓝框） */
const COMMENT_FIELD_HIGHLIGHT_CURRENT_CLASS = 'blog-comment-field-highlight-current';

function ensureCommentFieldHighlightStyle() {
  if (document.getElementById('blog-comment-field-highlight-style')) return;
  const style = document.createElement('style');
  style.id = 'blog-comment-field-highlight-style';
  style.textContent =
    `.${COMMENT_FIELD_HIGHLIGHT_CLASS} { outline: 2px dashed #2196F3; outline-offset: 2px; background: rgba(33, 150, 243, 0.06); }` +
    `.${COMMENT_FIELD_HIGHLIGHT_CLASS}.${COMMENT_FIELD_HIGHLIGHT_CURRENT_CLASS} { outline: 3px solid #2196F3; outline-offset: 2px; background: rgba(33, 150, 243, 0.12); }`;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * 清除页面上所有可填字段高亮
 */
function clearCommentFieldHighlight() {
  document.querySelectorAll(`.${COMMENT_FIELD_HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(COMMENT_FIELD_HIGHLIGHT_CLASS, COMMENT_FIELD_HIGHLIGHT_CURRENT_CLASS);
  });
  commentFieldHighlightActive = false;
}

/**
 * 根据当前页评论识别缓存，在页面上对可填字段与提交按钮用蓝色虚线框进行可视化高亮。
 * 若当前已在 high light 状态则先清除再返回 cleared。
 * @returns {Promise<{ success: boolean, highlightedCount?: number, cleared?: boolean, error?: string }>}
 */
async function highlightOrClearCommentFieldsFromCache() {
  if (commentFieldHighlightActive) {
    clearCommentFieldHighlight();
    return { success: true, cleared: true };
  }

  const cacheKey = getCommentCacheKey();
  const cached = await getCachedCommentMapping(cacheKey);
  if (!cached || !cached.mappings?.length) {
    return { success: false, error: '当前页无缓存或无可填字段，请先识别表单' };
  }

  ensureCommentFieldHighlightStyle();
  clearCommentFieldHighlight(); // 先清掉可能残留的旧高亮

  const toHighlight = [];
  for (const m of cached.mappings) {
    if (!m.locator) continue;
    const el = findElementByLocator(m.locator);
    if (el) toHighlight.push(el);
  }
  if (cached.submitButton?.locator) {
    const submitEl = findElementByLocator(cached.submitButton.locator);
    if (submitEl) toHighlight.push(submitEl);
  }

  toHighlight.forEach((el) => el.classList.add(COMMENT_FIELD_HIGHLIGHT_CLASS));
  if (toHighlight.length > 0) toHighlight[0].classList.add(COMMENT_FIELD_HIGHLIGHT_CURRENT_CLASS);
  commentFieldHighlightActive = true;
  commentFieldHighlightCurrentIndex = 0;

  // 将第一个可填字段滚动到可见区域
  if (toHighlight.length > 0) {
    toHighlight[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return { success: true, highlightedCount: toHighlight.length };
}

/**
 * 在已高亮的可填字段之间上/下跳转，滚动到对应蓝线框并尝试聚焦
 * @param {number} delta 1=下一个，-1=上一个
 * @returns {{ success: boolean, index?: number, total?: number, error?: string }}
 */
function jumpToHighlightedCommentField(delta) {
  if (!commentFieldHighlightActive) {
    return { success: false, error: '请先点击「可填字段」以标出高亮' };
  }
  const list = Array.from(document.querySelectorAll(`.${COMMENT_FIELD_HIGHLIGHT_CLASS}`));
  if (list.length === 0) {
    return { success: false, error: '未找到高亮字段' };
  }
  list.forEach((node) => node.classList.remove(COMMENT_FIELD_HIGHLIGHT_CURRENT_CLASS));
  commentFieldHighlightCurrentIndex = (commentFieldHighlightCurrentIndex + delta + list.length) % list.length;
  const el = list[commentFieldHighlightCurrentIndex];
  el.classList.add(COMMENT_FIELD_HIGHLIGHT_CURRENT_CLASS);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el.focus && typeof el.focus === 'function') {
    try { el.focus(); } catch (_) {}
  }
  return { success: true, index: commentFieldHighlightCurrentIndex, total: list.length };
}

/**
 * 获取评论表单的 DOM 范围（用于仅在表单内检测验证项，减少误判）
 * 返回包含「第一个字段 + 提交按钮」的最近共同祖先，或 null
 */
function getCommentFormScope() {
  const mappings = commentFormState.fieldMappings;
  const submitLoc = commentFormState.submitButton?.locator;
  let formScope = null;
  if (mappings?.length > 0) {
    const firstEl = findElementByLocator(mappings[0].locator);
    if (firstEl) formScope = firstEl.closest('form') || firstEl.parentElement?.closest('[class*="comment"], [id*="comment"], [class*="respond"], [id*="respond"]') || firstEl;
  }
  if (submitLoc && !formScope) {
    const submitEl = findElementByLocator(submitLoc);
    if (submitEl) formScope = submitEl.closest('form') || submitEl.parentElement;
  }
  return formScope;
}

/**
 * 评论表单中「需在提交前勾选」的复选框：根据标签文案判断是否为“保存信息/非垃圾/同意”等选项。
 * 多语言：英文、斯洛文尼亚语等（如 Save my name… / Shrani moje ime…；Confirm you are not spam / Potrdite, da niste pošiljatelj…）。
 */
const COMMENT_CONSENT_CHECKBOX_PATTERNS = [
  /save\s+(my|moje|meine|mijn|mes)\s+(name|ime|nome|nombre|nome|név)/i,
  /shrani\s+moje\s+(ime|e-pošta|spletišče)/i,
  /(save|shrani|speichern|opslaan).*(name|ime|browser|brskalnik|next\s+time|naslednjič|comment|komentiram)/i,
  /(confirm|potrdite|bestätigen|bevestig).*(not|niste|kein|geen).*(spam|pošiljatelj|robot|sender)/i,
  /(not|niste|kein|geen).*(spam|robot|pošiljatelj|sender).*(mail|pošte|oglasne)/i,
  /nenaročene\s+oglasne\s+pošte/i,
  /(agree|strinjati|zustimmen|akkoord).*(terms|pogoji|terms|privacy|zasebnost)/i,
  /(accept|sprejemam|akzeptieren).*(terms|pogoji|privacy|zasebnost)/i,
  /(I\s+)?agree\s+to/i,
  /(I\s+)?accept\s+(the\s+)?(terms|privacy)/i,
  /(save|remember).*(name|email|website).*(browser|next\s+time|comment)/i
];

/**
 * 在评论表单范围内查找所有「需勾选」的复选框（根据标签文案匹配 COMMENT_CONSENT_CHECKBOX_PATTERNS）。
 * 返回未勾选且可见的 checkbox 元素数组，用于在点击提交前自动勾选。
 */
function getCommentConsentCheckboxes() {
  const formScope = getCommentFormScope();
  if (!formScope) return [];
  const checkboxes = formScope.querySelectorAll('input[type="checkbox"]');
  const result = [];
  for (const el of checkboxes) {
    if (!el || !isElementVisible(el)) continue;
    if (!formScope.contains(el)) continue;
    const labelText = (getFieldLabel(el) || getElementLabelOrText(el) || '').trim().replace(/\s+/g, ' ');
    if (!labelText || labelText.length > 500) continue;
    const lower = labelText.toLowerCase();
    const matches = COMMENT_CONSENT_CHECKBOX_PATTERNS.some((p) => (typeof p === 'string' ? lower.includes(p.toLowerCase()) : p.test(labelText)));
    if (matches) result.push({ element: el, labelText: labelText.slice(0, 120) });
  }
  return result;
}

/**
 * 获取与元素相关的字段名/标签/文字（用于验证项日志）
 */
function getElementLabelOrText(el) {
  if (!el) return '';
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return (label.textContent || '').trim().slice(0, 120);
  }
  const aria = el.getAttribute?.('aria-label');
  if (aria) return aria.trim().slice(0, 120);
  const placeholder = el.getAttribute?.('placeholder');
  if (placeholder) return placeholder.trim().slice(0, 120);
  const title = el.getAttribute?.('title');
  if (title) return title.trim().slice(0, 120);
  const name = el.getAttribute?.('name');
  if (name) return `name="${name}"`;
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return text || el.tagName + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : '');
}

/**
 * 是否为「仅展示用」的 reCAPTCHA 徽章（右下角小 logo，不要求用户点选）
 * 此类不视为需要暂停自动提交的验证项
 */
function isRecaptchaBadgeOnly(el) {
  if (!el) return false;
  const cls = (el.className && typeof el.className === 'string') ? el.className : '';
  if (/\bgrecaptcha-badge\b/.test(cls) || /\bgrecaptcha-logo\b/.test(cls) || /\bgrecaptcha-error\b/.test(cls)) return true;
  if (el.closest && el.closest('.grecaptcha-badge')) return true;
  if (el.tagName === 'IFRAME') {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.width < 320 && r.height < 120) return true;
  }
  return false;
}

/**
 * 验证控件是否在评论表单内（在表单内才视为需用户操作的验证项，避免误判整页的 reCAPTCHA 徽章）
 */
function isInsideCommentForm(el, formScope) {
  if (!formScope || !el) return false;
  return formScope.contains(el);
}

/**
 * 检测评论区是否包含防 spam 验证（算术题、验证码等）
 * 返回 { hasSpam, details }。排除仅展示的 reCAPTCHA 徽章，只计表单内或主验证控件。
 */
function checkCommentSpamVerification() {
  const details = [];
  const formScope = getCommentFormScope();
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    'div[class*="captcha"]',
    'div[id*="captcha"]',
    'img[src*="captcha"]',
    '.g-recaptcha',
    '#g-recaptcha-response',
    '[class*="hcaptcha"]',
    '[class*="turnstile"]',
    '.cf-turnstile'
  ];
  const minSize = 20;
  for (const sel of captchaSelectors) {
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      if (!isElementVisible(el)) continue;
      if (isRecaptchaBadgeOnly(el)) continue;
      const rect = el.getBoundingClientRect();
      const inForm = isInsideCommentForm(el, formScope);
      const isMainWidget = el.classList?.contains('g-recaptcha') || el.id === 'g-recaptcha-response';
      if (!inForm && !isMainWidget) {
        if (el.tagName === 'IFRAME' && !formScope) continue;
      }
      if (inForm && (rect.width < minSize || rect.height < minSize)) continue;
      details.push({
        type: 'selector',
        selector: sel,
        xpath: getXPath(el),
        fieldName: el.id || el.name || el.getAttribute?.('aria-label') || '',
        text: getElementLabelOrText(el)
      });
    }
  }
  if (details.length > 0) {
    return { hasSpam: true, details };
  }

  const searchText = (formScope ? (formScope.textContent || '') : '');
  if (!searchText.trim()) return { hasSpam: false, details: [] };

  const lower = searchText.toLowerCase();
  const spamPhrases = [
    '验证码',
    'human verification',
    'not a robot',
    'are you human',
    'recaptcha',
    'complete the captcha',
    'solve the captcha',
    '算术题',
    '算术验证',
    'součet',
    'soucet',
    '1 + 10',
    '2 + 3'
  ];
  for (const phrase of spamPhrases) {
    if (lower.includes(phrase.toLowerCase())) {
      details.push({
        type: 'keyword',
        matchedPhrase: phrase,
        xpath: formScope ? getXPath(formScope) : '',
        fieldName: '表单内文案',
        text: formScope ? (formScope.textContent || '').trim().slice(0, 200) : searchText.slice(0, 200)
      });
      return { hasSpam: true, details };
    }
  }
  if (/\bcaptcha\b/i.test(searchText) && /(complete|solve|verify|验证|输入)/i.test(searchText)) {
    details.push({
      type: 'keyword',
      matchedPhrase: 'captcha + complete/solve/verify',
      xpath: formScope ? getXPath(formScope) : '',
      fieldName: '表单内文案',
      text: formScope ? (formScope.textContent || '').trim().slice(0, 200) : searchText.slice(0, 200)
    });
    return { hasSpam: true, details };
  }
  if (/\d+\s*\+\s*\d+/.test(searchText) && /(equals|等于|答|result)/i.test(searchText)) {
    details.push({
      type: 'keyword',
      matchedPhrase: '算术题',
      xpath: formScope ? getXPath(formScope) : '',
      fieldName: '表单内文案',
      text: formScope ? (formScope.textContent || '').trim().slice(0, 200) : searchText.slice(0, 200)
    });
    return { hasSpam: true, details };
  }
  return { hasSpam: false, details: [] };
}

/** 当检测到验证项时，将详情输出到控制台日志 */
function logSpamVerificationDetails(result) {
  if (!result?.hasSpam || !result.details?.length) return;
  console.log(`${TAG} 检测到验证项，将暂停自动提交。验证项详情：`);
  result.details.forEach((d, i) => {
    console.log(`${TAG}  [${i + 1}] type=${d.type} | xpath=${d.xpath || '-'} | fieldName=${d.fieldName || '-'} | text=${(d.text || d.matchedPhrase || '-').slice(0, 100)}${(d.text && d.text.length > 100) ? '...' : ''}`);
    if (d.selector) console.log(`${TAG}       selector=${d.selector}`);
  });
  console.log(`${TAG} 如何验证：在 DevTools -> Elements 中按 Ctrl+F 搜索上述 xpath，查看该节点是否在评论表单内、是否为可见的验证框。若仅为右下角 reCAPTCHA 徽章或实际提交时无验证框，可忽略本次提示。`);
}

/**
 * 将页面滚动到最底部并等待，便于动态加载的评论区域进入视口/DOM
 * 评论表单常在页面底部，部分站点需滚动后才加载
 */
function scrollPageToBottomAndWait() {
  const maxScroll = Math.max(
    document.body.scrollHeight ?? 0,
    document.documentElement.scrollHeight ?? 0,
    (document.body.offsetHeight ?? 0) + (document.body.scrollTop ?? 0),
    (document.documentElement.offsetHeight ?? 0) + (document.documentElement.scrollTop ?? 0)
  );
  window.scrollTo({ top: maxScroll, left: 0, behavior: 'auto' });
  console.log(`${TAG} 已滚动到页面底部 (scrollTop=${maxScroll})，等待动态加载…`);
}

/** 滚动到底部后的等待时间（毫秒），给懒加载评论区留出时间 */
const SCROLL_TO_BOTTOM_WAIT_MS = 1200;
/** 最多滚动次数：先识别，识别不到再滚动并重试，超过此次数仍未找到 form 则退出 */
const MAX_SCROLL_ATTEMPTS = 3;
/** 遍历检测可评论站时：先执行几次滚动到底部并等待，以触发懒加载的评论表单 */
const TRAVERSE_SCROLL_ROUNDS = 3;

/** 触发评论输入框后等待时间（ms），供「需登录」等文案动态出现 */
const TRIGGER_COMMENT_INPUT_WAIT_MS = 600;

/**
 * 在滚动完成后尝试找到评论输入区，聚焦并输入一个字符以触发「需登录」等动态文案，再便于后续 detectRequiresLoginToComment 检测
 * @returns {Promise<void>}
 */
function triggerCommentInputForLoginCheck() {
  function findCommentInputElement() {
    const meta = getCommentFormMetadata();
    if (meta.hasForm && meta.fields && meta.fields.length > 0) {
      const commentLike = /comment|留言|message|reply|回复|评论|text|content|body/i;
      const candidate = meta.fields.find(function (f) {
        if (f.isSubmitButton) return false;
        const text = [f.label, f.placeholder, f.name, f.ariaLabel, f.id].filter(Boolean).join(' ');
            return f.isTextarea || (f.type !== 'submit' && f.type !== 'button') || commentLike.test(text);
      });
      if (candidate && candidate.locator) {
        const el = findElementByLocator(candidate.locator);
        if (el && isElementVisible(el)) return el;
      }
      const firstInput = meta.fields.find(function (f) { return f.isTextarea || (!f.isSubmitButton && f.type !== 'submit' && f.type !== 'button'); });
      if (firstInput && firstInput.locator) {
        const el = findElementByLocator(firstInput.locator);
        if (el && isElementVisible(el)) return el;
      }
    }
    for (let i = 0; i < COMMENT_AREA_SELECTORS.length; i++) {
      try {
        const root = document.querySelector(COMMENT_AREA_SELECTORS[i]);
        if (!root) continue;
        const ta = root.querySelector('textarea');
        if (ta && isElementVisible(ta)) return ta;
        const ce = root.querySelector('[contenteditable="true"]');
        if (ce && isElementVisible(ce)) return ce;
        const input = root.querySelector('input[type="text"], input[type="email"]');
        if (input && isElementVisible(input)) return input;
      } catch (_) {}
    }
    const fallback = document.querySelector('textarea[name*="comment"], textarea[id*="comment"], textarea[name*="message"]');
    if (fallback && isElementVisible(fallback)) return fallback;
    return null;
  }

  const el = findCommentInputElement();
  if (!el) return Promise.resolve();

  return new Promise(function (resolve) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      el.focus();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      const isContentEditable = el.getAttribute('contenteditable') === 'true';
      const testChar = 'a';
      const originalValue = isContentEditable ? null : (el.value || '');
      if (isContentEditable) {
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertText', false, testChar);
        } else {
          el.textContent = (el.textContent || '') + testChar;
        }
      } else {
        el.value = originalValue + testChar;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: testChar }));
      }
      setTimeout(function () {
        if (isContentEditable) {
          const t = el.textContent || '';
          if (t.slice(-1) === testChar) el.textContent = t.slice(0, -1);
        } else {
          el.value = originalValue;
        }
        el.blur();
        resolve();
      }, TRIGGER_COMMENT_INPUT_WAIT_MS);
    } catch (err) {
      console.warn(TAG + ' [需登录检测] 触发评论输入失败:', err && err.message ? err.message : String(err));
      resolve();
    }
  });
}

/**
 * 遍历检测前先滚动到底部多轮并等待，确保懒加载的评论表单进入 DOM
 * @returns {Promise<void>}
 */
function scrollToBottomForTraverseDetection() {
  let round = 0;
  function next() {
    if (round >= TRAVERSE_SCROLL_ROUNDS) return Promise.resolve();
    scrollPageToBottomAndWait();
    round++;
    return new Promise(function (r) { setTimeout(r, SCROLL_TO_BOTTOM_WAIT_MS); }).then(next);
  }
  return next();
}

/**
 * 完全 AI 模式：预滚动 + 表单检测，返回 formRootSelector 与 hintText 供 Snapshot 缩小范围与 prompt 提示
 * @returns {Promise<{ hasForm: boolean, formRootSelector?: string, hintText?: string }>}
 */
async function handleFullAiPrepareForComment() {
  document.querySelectorAll('[data-wce-scope-root]').forEach((el) => el.removeAttribute('data-wce-scope-root'));

  if (typeof window.__wce_dismissOverlays === 'function') {
    await window.__wce_dismissOverlays(2);
  }

  let formMetadata = getCommentFormMetadata();
  let scrollCount = 0;
  while (!formMetadata.hasForm || !formMetadata.fields?.length) {
    if (scrollCount >= MAX_SCROLL_ATTEMPTS) {
      return { hasForm: false };
    }
    scrollPageToBottomAndWait();
    await new Promise((r) => setTimeout(r, SCROLL_TO_BOTTOM_WAIT_MS));
    scrollCount++;
    formMetadata = getCommentFormMetadata();
  }

  let formRootSelector = null;
  const commentLike = /comment|留言|message|reply|回复|评论/i;
  const commentField = formMetadata.fields.find(
    (f) =>
      (f.isTextarea || f.type === 'textarea') &&
      commentLike.test([f.label, f.placeholder, f.name, f.ariaLabel].filter(Boolean).join(' '))
  );
  const fieldToUse = commentField || formMetadata.fields[0];
  if (fieldToUse?.locator) {
    const el = findElementByLocator(fieldToUse.locator);
    const form = el?.closest?.('form');
    if (form) {
      form.setAttribute('data-wce-scope-root', '1');
      formRootSelector = '[data-wce-scope-root="1"]';
    }
  }

  const labels = formMetadata.fields
    .slice(0, 8)
    .map((f) => (f.label || f.placeholder || f.name || f.ariaLabel || '').slice(0, 30))
    .filter(Boolean);
  const hintText = labels.length
    ? `表单检测发现 ${formMetadata.fields.length} 个字段，标签示例: ${labels.join(', ')}。请优先查找含 comment/留言/message 的 textarea 和含 submit/post/comment 的 button。`
    : '';

  return { hasForm: true, formRootSelector, hintText };
}

/**
 * 评论表单识别（优先缓存 → AI → 关键词）
 * 流程：1. 先识别 form 是否存在 → 2. 若识别不到则滚动到底部 → 3. 等待后再次识别 → 4. 重复 2～3，最多滚动 3 次；仍无 form 则提示「找不到form表单」。
 */
async function recognizeCommentForm(useLlm = false) {
  commentFormState.recognitionStatus = 'recognizing';
  commentFormState.domain = window.location.hostname;

  try {
    let formMetadata = getCommentFormMetadata();
    let scrollCount = 0;

    while (!formMetadata.hasForm || !formMetadata.fields?.length) {
      if (scrollCount >= MAX_SCROLL_ATTEMPTS) {
        commentFormState.recognitionStatus = 'failed';
        return { status: 'no_form', message: '找不到form表单' };
      }
      scrollPageToBottomAndWait();
      await new Promise(r => setTimeout(r, SCROLL_TO_BOTTOM_WAIT_MS));
      scrollCount++;
      formMetadata = getCommentFormMetadata();
    }

    const cacheKey = getCommentCacheKey();
    const cached = await getCachedCommentMapping(cacheKey);
    if (cached && cached.mappings?.length > 0) {
      commentFormState.fieldMappings = cached.mappings;
      commentFormState.submitButton = cached.submitButton;
      commentFormState.consentCheckboxes = cached.consentCheckboxes || null;
      commentFormState.recognitionStatus = 'done';
      commentFormState.recognitionMethod = 'cache';
      commentFormState.hasForm = true;
      const spamResult = checkCommentSpamVerification();
      commentFormState.hasSpamVerification = spamResult.hasSpam;
      if (spamResult.hasSpam) logSpamVerificationDetails(spamResult);
      return { status: 'success', method: 'cache', mappings: cached.mappings, submitButton: cached.submitButton, fieldCount: cached.mappings.length };
    }

    if (useLlm) {
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'aiRecognizeCommentForm', formMetadata }, (resp) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(resp);
          });
        });
        if (response?.success && response.result) {
          const { mappings, submitButton } = response.result;
          if (mappings?.length > 0) {
            commentFormState.fieldMappings = mappings;
            commentFormState.submitButton = submitButton || null;
            const consentList = getCommentConsentCheckboxes();
            const consentCheckboxes = consentList.map(({ element }) => ({ locator: getFieldLocator(element) }));
            commentFormState.consentCheckboxes = consentCheckboxes.length ? consentCheckboxes : null;
            commentFormState.recognitionStatus = 'done';
            commentFormState.recognitionMethod = 'ai';
            commentFormState.hasForm = true;
            const spamResult = checkCommentSpamVerification();
            commentFormState.hasSpamVerification = spamResult.hasSpam;
            if (spamResult.hasSpam) logSpamVerificationDetails(spamResult);
            await cacheCommentMapping(cacheKey, { mappings, submitButton, consentCheckboxes: commentFormState.consentCheckboxes });
            return { status: 'success', method: 'ai', mappings, submitButton, fieldCount: mappings.length };
          }
        }
      } catch (aiErr) {
        console.warn(`${TAG} Comment form AI failed, fallback to keywords:`, aiErr.message);
      }
    }

    const keywordResult = recognizeCommentByKeywords(formMetadata);
    commentFormState.fieldMappings = keywordResult.mappings;
    commentFormState.submitButton = keywordResult.submitButton || null;
    const consentList = getCommentConsentCheckboxes();
    const consentCheckboxes = consentList.map(({ element }) => ({ locator: getFieldLocator(element) }));
    commentFormState.consentCheckboxes = consentCheckboxes.length ? consentCheckboxes : null;
    commentFormState.recognitionStatus = 'done';
    commentFormState.recognitionMethod = 'keyword';
    commentFormState.hasForm = true;
    const spamResult = checkCommentSpamVerification();
    commentFormState.hasSpamVerification = spamResult.hasSpam;
    if (spamResult.hasSpam) logSpamVerificationDetails(spamResult);
    await cacheCommentMapping(cacheKey, { ...keywordResult, consentCheckboxes: commentFormState.consentCheckboxes });
    return {
      status: 'success',
      method: 'keyword',
      mappings: keywordResult.mappings,
      submitButton: keywordResult.submitButton,
      fieldCount: (keywordResult.mappings || []).length
    };
  } catch (err) {
    commentFormState.recognitionStatus = 'failed';
    return { status: 'error', error: err.message };
  }
}

/**
 * 一发流程入口：有缓存时仅调 AI 评论生成 + 缓存定位；无缓存且 LLM 开启时一发请求（字段映射+评论），否则关键词识别+评论生成。
 * @param {{ title: string, description: string, h1: string, siteId: string, autoSubmit: boolean, llmEnabled: boolean, tabId?: number, siteUrl?: string }} opts
 * @returns {Promise<{ success: boolean, result?: object, error?: string }>}
 */
async function blogCommentGenerateAndFill(opts) {
  const { title = '', description = '', h1 = '', siteId, autoSubmit = true, llmEnabled = false, tabId, siteUrl } = opts || {};
  const verifyOpts = tabId != null && siteUrl ? { tabId, siteUrl } : {};
  const startMs = Date.now();
  const elapsed = () => Date.now() - startMs;
  commentFormState.recognitionStatus = 'recognizing';
  commentFormState.domain = window.location.hostname;

  try {
    if (typeof window.__wce_dismissOverlays === 'function') {
      await window.__wce_dismissOverlays(2);
    }

    let formMetadata = getCommentFormMetadata();
    let scrollCount = 0;
    while (!formMetadata.hasForm || !formMetadata.fields?.length) {
      if (scrollCount >= MAX_SCROLL_ATTEMPTS) {
        commentFormState.recognitionStatus = 'failed';
        return { success: false, error: '找不到form表单', elapsedMs: elapsed() };
      }
      scrollPageToBottomAndWait();
      await new Promise(r => setTimeout(r, SCROLL_TO_BOTTOM_WAIT_MS));
      scrollCount++;
      formMetadata = getCommentFormMetadata();
    }

    const cacheKey = getCommentCacheKey();
    const cached = await getCachedCommentMapping(cacheKey);

    if (cached && cached.mappings?.length > 0) {
      // 有缓存：仅 AI 评论生成，字段用缓存
      const genRes = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'generateBlogComment', title, description, h1 }, (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(resp);
        });
      });
      if (!genRes?.success) return { success: false, error: genRes?.error || '评论生成失败', elapsedMs: elapsed() };
      commentFormState.fieldMappings = cached.mappings;
      commentFormState.submitButton = cached.submitButton;
      commentFormState.consentCheckboxes = cached.consentCheckboxes || null;
      commentFormState.recognitionStatus = 'done';
      commentFormState.recognitionMethod = 'cache';
      commentFormState.hasForm = true;
      const spamResult = checkCommentSpamVerification();
      commentFormState.hasSpamVerification = spamResult.hasSpam;
      const fillResult = await fillCommentForm(siteId, genRes.comment, autoSubmit, verifyOpts);
      return { success: true, result: { ...fillResult, usedCache: true, method: 'cache', fieldCount: cached.mappings.length, elapsedMs: elapsed() } };
    }

    if (llmEnabled) {
      // 无缓存且 LLM 开启：一发请求
      const oneShotRes = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'blogCommentOneShot', formMetadata, title, description, h1 }, (resp) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(resp);
        });
      });
      if (!oneShotRes?.success) return { success: false, error: oneShotRes?.error || '一发请求失败', elapsedMs: elapsed() };
      const { mappings, submitButton, comment } = oneShotRes.result;
      if (!mappings?.length || !comment) return { success: false, error: '一发返回缺少 mappings 或 comment', elapsedMs: elapsed() };
      commentFormState.fieldMappings = mappings;
      commentFormState.submitButton = submitButton || null;
      const consentList = getCommentConsentCheckboxes();
      const consentCheckboxes = consentList.map(({ element }) => ({ locator: getFieldLocator(element) }));
      commentFormState.consentCheckboxes = consentCheckboxes.length ? consentCheckboxes : null;
      commentFormState.recognitionStatus = 'done';
      commentFormState.recognitionMethod = 'ai';
      commentFormState.hasForm = true;
      const spamResult = checkCommentSpamVerification();
      commentFormState.hasSpamVerification = spamResult.hasSpam;
      await cacheCommentMapping(cacheKey, { mappings, submitButton, consentCheckboxes: commentFormState.consentCheckboxes });
      const fillResult = await fillCommentForm(siteId, comment, autoSubmit, verifyOpts);
      return { success: true, result: { ...fillResult, usedCache: false, method: 'oneShot', fieldCount: mappings.length, elapsedMs: elapsed() } };
    }

    // 无缓存且 LLM 关闭：关键词识别 + 评论生成
    const rec = await recognizeCommentForm(false);
    if (rec.status !== 'success' || !rec.mappings?.length) {
      return { success: false, error: rec.message || '评论表单识别失败', elapsedMs: elapsed() };
    }
    const genRes = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'generateBlogComment', title, description, h1 }, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    });
    if (!genRes?.success) return { success: false, error: genRes?.error || '评论生成失败', elapsedMs: elapsed() };
    const fillResult = await fillCommentForm(siteId, genRes.comment, autoSubmit, verifyOpts);
    return { success: true, result: { ...fillResult, usedCache: false, method: 'keyword', fieldCount: rec.fieldCount ?? 0, elapsedMs: elapsed() } };
  } catch (err) {
    commentFormState.recognitionStatus = 'failed';
    return { success: false, error: err?.message || '操作失败', elapsedMs: elapsed() };
  }
}

/**
 * 填充评论表单并可选点击提交（无验证时）。
 * @param {string} siteId - 站点 ID
 * @param {string} commentText - 评论文本
 * @param {boolean} [autoSubmit=true] - 是否在无验证时自动点击提交（由 popup「允许自动提交」控制，未传时视为 true 以兼容旧调用）
 * @param {{ tabId?: number, siteUrl?: string }} [opts] - 可选；若提供且本次点击了提交，会通知 background 在页面刷新后自动验证本站链接
 */
async function fillCommentForm(siteId, commentText, autoSubmit = true, opts = {}) {
  const siteData = await getSiteData(siteId);
  if (!siteData) throw new Error('未找到站点或未选择站点');

  if (!commentFormState.fieldMappings?.length) {
    const rec = await recognizeCommentForm(!!chrome.runtime?.sendMessage);
    if (rec.status !== 'success' || !rec.mappings?.length) throw new Error('评论表单未识别或无可填字段');
  }

  const data = {
    comment: commentText || '',
    commentName: siteData.siteName || '',
    commentEmail: siteData.email || '',
    commentWebsite: siteData.siteUrl || ''
  };

  let filledCount = 0;
  const errors = [];
  for (const mapping of commentFormState.fieldMappings) {
    try {
      const el = findElementByLocator(mapping.locator);
      if (!el) { errors.push(`未找到元素: ${mapping.standardField}`); continue; }
      const value = data[mapping.standardField];
      if (value == null || (typeof value === 'string' && !value.trim())) continue;
      fillInputElement(el, String(value).trim());
      filledCount++;
    } catch (e) {
      errors.push(`${mapping.standardField}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, randomPostFillDelayMs()));
  }

  // 提交前：勾选「需用户同意」的复选框（优先用缓存的 consentCheckboxes，否则现场识别并回写缓存）
  let checkedCount = 0;
  let usedCachedConsent = !!commentFormState.consentCheckboxes?.length;
  let toCheck = commentFormState.consentCheckboxes?.length
    ? commentFormState.consentCheckboxes.map(({ locator }) => findElementByLocator(locator)).filter(Boolean)
    : getCommentConsentCheckboxes().map(({ element }) => element);
  for (const el of toCheck) {
    if (!el || el.checked) continue;
    try {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      simulateClick(el);
      checkedCount++;
      await new Promise((r) => setTimeout(r, randomPostFillDelayMs()));
    } catch (_) {}
  }
  // 若本次用的是现场识别的勾选项且存在，则回写缓存供下次使用
  if (!usedCachedConsent && toCheck.length > 0) {
    const consentCheckboxes = toCheck.map((el) => ({ locator: getFieldLocator(el) }));
    commentFormState.consentCheckboxes = consentCheckboxes;
    const cacheKey = getCommentCacheKey();
    const existing = await getCachedCommentMapping(cacheKey);
    if (existing?.mappings?.length) {
      await cacheCommentMapping(cacheKey, { mappings: existing.mappings, submitButton: existing.submitButton, consentCheckboxes });
    }
  }

  const spamResult = checkCommentSpamVerification();
  const hasSpam = spamResult.hasSpam;
  if (hasSpam) logSpamVerificationDetails(spamResult);
  let clickedSubmit = false;
  const mayAutoSubmit = autoSubmit !== false;
  if (mayAutoSubmit && !hasSpam && commentFormState.submitButton) {
    try {
      const btn = findElementByLocator(commentFormState.submitButton.locator);
      if (btn && isElementVisible(btn)) {
        simulateClick(btn);
        clickedSubmit = true;
        if (clickedSubmit && opts.tabId != null && opts.siteUrl) {
          chrome.runtime.sendMessage({ action: 'scheduleVerifyAfterLoad', tabId: opts.tabId, siteUrl: opts.siteUrl }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  return {
    filledCount,
    consentCheckboxesChecked: checkedCount,
    hasSpamVerification: hasSpam,
    clickedSubmit,
    errors
  };
}

/**
 * 等待页面刷新并加载完成（readyState === 'complete'，再预留一段时间给动态内容）
 */
function waitForPageLoad() {
  const LOAD_WAIT_MS = 25000;
  const EXTRA_MS = 2000;
  return new Promise((resolve) => {
    if (document.readyState === 'complete') {
      setTimeout(resolve, EXTRA_MS);
      return;
    }
    const onLoad = () => {
      clearTimeout(t);
      document.removeEventListener('load', onLoad);
      setTimeout(resolve, EXTRA_MS);
    };
    document.addEventListener('load', onLoad);
    const t = setTimeout(() => {
      document.removeEventListener('load', onLoad);
      resolve();
    }, LOAD_WAIT_MS);
  });
}

/**
 * 提交后验证：等待页面刷新并加载完成后，查找可点击的、指向 siteUrl 的链接。
 * 找到时：滚动到该元素并加黄色虚线框高亮。
 */
async function verifyCommentSubmission(siteUrl) {
  await waitForPageLoad();
  clearVerifyLinkHighlight();

  const normalizedSite = normalizeUrlForCompare(siteUrl);
  if (!normalizedSite) return { success: false, message: '无效的站点 URL' };

  const links = document.querySelectorAll('a[href]');
  for (const a of links) {
    const href = (a.getAttribute('href') || '').trim();
    if (!href) continue;
    const linkNorm = normalizeUrlForCompare(href);
    if (!linkNorm) continue;
    if (linkNorm !== normalizedSite && !linkNorm.startsWith(normalizedSite + '/') && !normalizedSite.startsWith(linkNorm + '/')) continue;
    if (!isElementVisible(a)) continue;
    const style = window.getComputedStyle(a);
    if (style.pointerEvents === 'none' || style.display === 'none' || style.visibility === 'hidden') continue;

    ensureVerifyLinkHighlightStyle();
    a.classList.add(VERIFY_LINK_HIGHLIGHT_CLASS);
    a.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, message: '已在页面中找到您的站点链接', found: true };
  }
  return { success: false, message: '未在页面中检测到您的站点链接，请确认评论是否已发布', found: false };
}

function normalizeUrlForCompare(url) {
  if (!url || typeof url !== 'string') return '';
  let u = url.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  try {
    const parsed = new URL(u.startsWith('http') ? u : 'https://' + u);
    return parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname).replace(/\/+$/, '');
  } catch (_) {
    return u.replace(/\/+$/, '');
  }
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
  /** 同一逻辑控件有多条映射时只填一次（如 aitoolzs 的 categories 有 66 个 checkbox 映射到同一控件） */
  const filledOnceByField = new Set();

  for (const mapping of pageState.fieldMappings) {
    try {
      if (['category', 'pricing', 'tags'].includes(mapping.standardField) && filledOnceByField.has(mapping.standardField)) {
        continue;
      }

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
      if (mapping.standardField === 'pricing') {
        const p = String(value ?? '').trim();
        if (p === '' || p.toLowerCase() === 'free') value = 'Free Trial';
      }
      // Logo 文件上传框：使用站点管理里上传的 logoDataUrl
      if (mapping.standardField === 'logo' && element.type === 'file') {
        try {
          if (siteData.logoAsset?.relPath) {
            const resp = await chrome.runtime.sendMessage({ action: 'assetCache_readFile', relPath: siteData.logoAsset.relPath });
            if (resp?.success && resp.arrayBuffer) {
              const file = new File([resp.arrayBuffer], resp.name || 'logo.jpg', { type: resp.mime || 'image/jpeg' });
              const dt = new DataTransfer();
              dt.items.add(file);
              element.files = dt.files;
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              filledCount++;
              console.log(`${TAG} Filled ${mapping.standardField}: (file from local cache)`);
            }
          } else {
            const logoDataUrl = siteData.logoDataUrl || value;
            if (logoDataUrl && typeof logoDataUrl === 'string' && logoDataUrl.startsWith('data:')) {
              fillFileInputWithDataUrl(element, logoDataUrl);
              filledCount++;
              console.log(`${TAG} Filled ${mapping.standardField}: (file from stored dataUrl)`);
            }
          }
        } catch (err) {
          errors.push(`Failed to fill logo file: ${err.message}`);
        }
        continue;
      }

      // 界面截图 / App Image 文件上传框：使用站点管理里上传的 screenshotDataUrl
      if (mapping.standardField === 'screenshot' && element.type === 'file') {
        try {
          if (siteData.screenshotAsset?.relPath) {
            const resp = await chrome.runtime.sendMessage({ action: 'assetCache_readFile', relPath: siteData.screenshotAsset.relPath });
            if (resp?.success && resp.arrayBuffer) {
              const file = new File([resp.arrayBuffer], resp.name || 'screenshot.jpg', { type: resp.mime || 'image/jpeg' });
              const dt = new DataTransfer();
              dt.items.add(file);
              element.files = dt.files;
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              filledCount++;
              console.log(`${TAG} Filled ${mapping.standardField}: (file from local cache)`);
            }
          } else {
            const screenshotDataUrl = siteData.screenshotDataUrl || value;
            if (screenshotDataUrl && typeof screenshotDataUrl === 'string' && screenshotDataUrl.startsWith('data:')) {
              fillFileInputWithDataUrl(element, screenshotDataUrl);
              filledCount++;
              console.log(`${TAG} Filled ${mapping.standardField}: (file from stored dataUrl)`);
            }
          }
        } catch (err) {
          errors.push(`Failed to fill screenshot file: ${err.message}`);
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
        await new Promise(r => setTimeout(r, randomPostFillDelayMs()));
        continue;
      }
      // contenteditable / ProseMirror（如 auraplusplus Short Description）
      if (element.getAttribute?.('contenteditable') === 'true' || element.classList?.contains?.('ProseMirror')) {
        fillContentEditable(element, value);
        filledCount++;
        console.log(`${TAG} Filled ${mapping.standardField}:`, value);
        await new Promise(r => setTimeout(r, randomPostFillDelayMs()));
        continue;
      }

      // Set value based on element type（含自定义下拉 Categories/Tags/Pricing；同一逻辑控件只填一次）
      if (element.tagName === 'SELECT') {
        fillSelectElement(element, value, siteData, mapping.standardField);
        filledCount++;
        if (['category', 'pricing', 'tags'].includes(mapping.standardField)) filledOnceByField.add(mapping.standardField);
      } else if ((mapping.standardField === 'category' || mapping.standardField === 'tags' || mapping.standardField === 'pricing') && element.tagName !== 'SELECT') {
        const filled = await fillCustomSelect(element, value, siteData, mapping.standardField);
        if (filled) {
          filledCount++;
          filledOnceByField.add(mapping.standardField);
        }
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
    // 每个字段填充后随机等待 0.5~1s，模拟人工间隔
    await new Promise(r => setTimeout(r, randomPostFillDelayMs()));
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
 * 从右键事件目标解析出「可填充」的输入元素（input/textarea/contenteditable 或常见富文本编辑器）
 * 兼容 TipTap、Quill、ProseMirror、CodeMirror 等，确保「Description」等字段能被识别
 */
function getEditableElementFromTarget(target) {
  if (!target || !target.nodeType || target.nodeType !== Node.ELEMENT_NODE) return null;
  const el = target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    return el;
  }
  if (el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '') {
    return el;
  }
  if (el.classList?.contains?.('ProseMirror') || el.classList?.contains?.('tiptap') || el.classList?.contains?.('ql-editor')) {
    return el;
  }
  const editable = el.closest?.('[contenteditable="true"], [contenteditable=""], .ProseMirror, .tiptap, .ql-editor, .CodeMirror');
  if (editable) {
    return editable;
  }
  const codeMirror = el.closest?.('.CodeMirror');
  if (codeMirror) return codeMirror;
  if (el.getAttribute?.('role') === 'textbox') return el;
  const roleTextbox = el.closest?.('[role="textbox"]');
  if (roleTextbox) return roleTextbox;
  return null;
}

/**
 * 右键菜单「填充单个字段」：只做一件事 —— 用当前站点（popup 已选）的该字段值，填到右键所在的输入框。
 * 点哪个字段就填哪个字段的 value，无其它逻辑。
 */
async function fillSingleField(standardField) {
  const el = lastContextMenuTarget;
  lastContextMenuTarget = null;

  if (!el || !document.contains(el)) {
    throw new Error('请在要填充的输入框内右键，再选择字段');
  }

  const siteData = await getSiteData(null);
  if (!siteData) {
    throw new Error('请先在 popup 中选择当前站点');
  }

  const value = getSiteFieldValueForFill(el, standardField, siteData);
  if (value === undefined) {
    throw new Error(`当前站点的「${standardField}」无内容可填`);
  }

  fillOneElement(el, standardField, value, siteData);
  const preview = typeof value === 'string' ? value.slice(0, 60) + (value.length > 60 ? '…' : '') : value;
  console.log(`${TAG} [右键] 已填充 ${standardField}，取值:`, preview);
  return { filledCount: 1, errors: [] };
}

/** 从当前站点取该字段的填充值（仅此一处决定填什么内容） */
function getSiteFieldValueForFill(element, standardField, siteData) {
  if (standardField === 'logo' && element.type === 'file') {
    if (siteData.logoAsset?.relPath) return { __assetRelPath: siteData.logoAsset.relPath, __assetKind: 'logo' };
    const v = siteData.logoDataUrl || siteData[standardField];
    return (v && typeof v === 'string' && v.startsWith('data:')) ? v : undefined;
  }
  if (standardField === 'screenshot' && element.type === 'file') {
    if (siteData.screenshotAsset?.relPath) return { __assetRelPath: siteData.screenshotAsset.relPath, __assetKind: 'screenshot' };
    const v = siteData.screenshotDataUrl || siteData[standardField];
    return (v && typeof v === 'string' && v.startsWith('data:')) ? v : undefined;
  }
  let v = siteData[standardField];
  if (v == null || (typeof v === 'string' && !v.trim())) return undefined;
  if (standardField === 'siteUrl') v = getUrlValueForInput(element, v);
  return v;
}

/** 把 value 写入一个元素（仅负责写入，不负责取值） */
function fillOneElement(element, standardField, value, siteData) {
  if (standardField === 'logo' && element.type === 'file') {
    if (value && typeof value === 'object' && value.__assetRelPath) {
      // 右键填充：异步读取本地文件并注入
      chrome.runtime.sendMessage({ action: 'assetCache_readFile', relPath: value.__assetRelPath }).then((resp) => {
        if (resp?.success && resp.arrayBuffer) {
          const file = new File([resp.arrayBuffer], resp.name || 'logo.jpg', { type: resp.mime || 'image/jpeg' });
          const dt = new DataTransfer();
          dt.items.add(file);
          element.files = dt.files;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }).catch(() => {});
      return;
    }
    fillFileInputWithDataUrl(element, value);
    return;
  }
  if (standardField === 'screenshot' && element.type === 'file') {
    if (value && typeof value === 'object' && value.__assetRelPath) {
      chrome.runtime.sendMessage({ action: 'assetCache_readFile', relPath: value.__assetRelPath }).then((resp) => {
        if (resp?.success && resp.arrayBuffer) {
          const file = new File([resp.arrayBuffer], resp.name || 'screenshot.jpg', { type: resp.mime || 'image/jpeg' });
          const dt = new DataTransfer();
          dt.items.add(file);
          element.files = dt.files;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }).catch(() => {});
      return;
    }
    fillFileInputWithDataUrl(element, value);
    return;
  }
  const str = value != null ? String(value) : '';
  if (element.classList && element.classList.contains('CodeMirror')) {
    fillCodeMirror(element, str);
    return;
  }
  if (element.classList?.contains?.('ql-editor') || element.closest?.('.ql-editor')) {
    const editorEl = element.classList?.contains?.('ql-editor') ? element : element.closest('.ql-editor');
    fillQuillEditor(editorEl, str);
    return;
  }
  if (element.getAttribute?.('contenteditable') != null || element.classList?.contains?.('ProseMirror') || element.classList?.contains?.('tiptap')) {
    fillContentEditable(element, str);
    return;
  }
  if (element.tagName === 'SELECT') {
    fillSelectElement(element, str, siteData);
    return;
  }
  if (element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' && ['text', 'url', 'email'].includes(element.type))) {
    fillInputElement(element, str);
    return;
  }
  element.value = str;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Quill 编辑器：通过 Quill 实例写入，否则 DOM 改了也可能被覆盖 */
function fillQuillEditor(qlEditorEl, text) {
  if (!qlEditorEl) return;
  const container = qlEditorEl.closest?.('.ql-container') || qlEditorEl.parentElement;
  const ql = qlEditorEl.__quill || container?.__quill || (container && container.querySelector?.('.ql-editor')?.__quill);
  if (ql && typeof ql.setText === 'function') {
    ql.setText(text);
    qlEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (ql && ql.root) {
    ql.root.innerText = text;
    qlEditorEl.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  qlEditorEl.focus();
  qlEditorEl.innerText = text;
  qlEditorEl.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertText', bubbles: true }));
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

  // 2. Try direct partial match（多个命中时取文本最长者，如 "Free Trial" 优先于 "Free"）
  const partialMatches = availableOptions.filter(opt =>
    opt.textLower.includes(userCategoryLower) ||
    userCategoryLower.includes(opt.textLower)
  );
  if (partialMatches.length > 0) {
    partialMatches.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
    return partialMatches[0];
  }

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

/** Tags 填充时最多使用的个数 */
const TAGS_FILL_MAX = 3;

/**
 * Fill select element (category / tags 等下拉).
 * Category 限定只选一项；Tags 最多选 3 项。支持逗号分隔时取首个匹配（Category 仅用第一个）。
 */
function fillSelectElement(select, value, siteData, standardField) {
  const isCategory = standardField === 'category';
  const isTags = standardField === 'tags';
  const toTry = [];
  if (typeof value === 'string' && value.includes(',')) {
    const parts = value.split(',').map(s => s.trim()).filter(Boolean);
    if (isCategory) {
      toTry.push(parts[0] || value.trim());
    } else {
      toTry.push(value.trim(), ...parts);
      if (isTags) toTry.splice(TAGS_FILL_MAX);
    }
  } else {
    toTry.push(value);
  }
  if (isTags && select.multiple) {
    const matchedValues = new Set();
    for (const v of toTry) {
      if (!v) continue;
      const bestMatch = findBestCategoryMatch(select, v);
      if (bestMatch) matchedValues.add(bestMatch.value);
    }
    if (matchedValues.size > 0) {
      Array.from(select.options).forEach(opt => { opt.selected = matchedValues.has(opt.value); });
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`${TAG} Tags 已选 ${matchedValues.size} 项（最多 ${TAGS_FILL_MAX} 项）`);
      return true;
    }
  } else {
    for (const v of toTry) {
      if (!v) continue;
      const bestMatch = findBestCategoryMatch(select, v);
      if (bestMatch) {
        if (select.multiple) {
          Array.from(select.options).forEach(opt => { opt.selected = opt.value === bestMatch.value; });
        } else {
          select.value = bestMatch.value;
        }
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`${TAG} Matched "${v}" to option "${bestMatch.text}"${isCategory ? ' (Categories 仅选一项)' : ''}`);
        return true;
      }
    }
  }
  if (siteData.category && value !== siteData.category && !isTags) {
    const categoryMatch = findBestCategoryMatch(select, siteData.category);
    if (categoryMatch) {
      if (select.multiple) {
        Array.from(select.options).forEach(opt => { opt.selected = opt.value === categoryMatch.value; });
      } else {
        select.value = categoryMatch.value;
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`${TAG} Matched site category "${siteData.category}" to option "${categoryMatch.text}" (Categories 仅选一项)`);
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

  const partialMatches = availableOptions.filter(opt =>
    opt.textLower.includes(userCategoryLower) || userCategoryLower.includes(opt.textLower)
  );
  if (partialMatches.length > 0) {
    partialMatches.sort((a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0));
    return partialMatches[0];
  }

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
 * 模拟真实用户点击（mousedown -> mouseup -> click），提高被框架识别的概率。
 * 若传入 useCoordinates=true，则使用元素中心坐标，便于输入框获得焦点并显示光标。
 */
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

/**
 * 填充自定义下拉（非原生 select）：先关闭已有下拉，再点击触发器，等待选项出现后选择匹配项。
 * Categories 限定只选一项；Tags 最多选 3 项。
 */
function fillCustomSelect(triggerElement, value, siteData, standardField) {
  const isCategory = standardField === 'category';
  const isTags = standardField === 'tags';
  const toTry = [];
  if (typeof value === 'string' && value.includes(',')) {
    const parts = value.split(',').map(s => s.trim()).filter(Boolean);
    if (isCategory) {
      toTry.push(parts[0] || value.trim());
    } else {
      toTry.push(value.trim(), ...parts);
      if (isTags) toTry.splice(TAGS_FILL_MAX);
    }
  } else {
    toTry.push(value);
  }
  const valueToUse = isCategory && siteData.category
    ? siteData.category
    : (isTags && siteData.tags ? (siteData.tags.split(',').map(s => s.trim()).filter(Boolean).slice(0, TAGS_FILL_MAX)[0] || toTry[0]) : (toTry[0] || value));
  const tagsToFill = isTags ? toTry.slice(0, TAGS_FILL_MAX).filter(Boolean) : [toTry[0] || value];
  if (!valueToUse && tagsToFill.length === 0) return Promise.resolve(false);

  const closeDelay = isTags ? 400 : 220;
  const openWaitMs = isTags ? 750 : 600;
  console.log(`${TAG} Custom select: opening ${standardField} for "${valueToUse}"${isTags && tagsToFill.length > 1 ? ` (最多 ${TAGS_FILL_MAX} 项)` : ''}`);

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
        let container = null;
        if (standardField === 'pricing') {
          const pricingScope = triggerElement.closest('[id*="pricing"], [id*="Pricing"]') || scope.querySelector('[id*="pricing-listbox"], [id*="pricing-select-container"], [id*="selectedPricing"]');
          if (pricingScope) {
            container = pricingScope.querySelector('[role="listbox"], [id*="listbox"]') || pricingScope;
            for (const sel of optionSelectors) {
              optionEls = Array.from(container.querySelectorAll(sel));
              if (optionEls.length > 0) break;
            }
          }
        } else if (standardField === 'category') {
          const categoryScope = triggerElement.closest('[id*="categor"], [id*="Categor"]') || scope.querySelector('[id*="categories-listbox"], [id*="categories-select"], [id*="selectedCategories"]');
          if (categoryScope) {
            container = categoryScope.querySelector('[role="listbox"], [id*="listbox"]') || categoryScope;
            for (const sel of optionSelectors) {
              optionEls = Array.from(container.querySelectorAll(sel));
              if (optionEls.length > 0) break;
            }
          }
        }
        if (optionEls.length === 0) {
          container = scope.querySelector('[role="listbox"], [data-headlessui-state], [class*="dropdown"], [class*="menu"]');
          if (!container) container = scope;
          for (const sel of optionSelectors) {
            optionEls = Array.from(container.querySelectorAll(sel));
            if (optionEls.length > 0) break;
          }
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
        // Tags 多选优先：下拉内是带 checkbox 的选项（如 navfolders），最多选 TAGS_FILL_MAX 项
        if (isTags) {
          const tagPanel = findTagsCheckboxPanel();
          if (tagPanel) {
            const { optionEls: checkboxRows, options: checkboxOptions } = collectCheckboxOptions(tagPanel);
            if (checkboxRows.length > 0) {
              const visible = checkboxRows.filter(isElementVisible);
              const rows = visible.length > 0 ? visible : checkboxRows;
              let clicked = 0;
              for (const tagValue of tagsToFill) {
                if (clicked >= TAGS_FILL_MAX) break;
                const best = findBestCategoryMatchFromOptions(checkboxOptions, tagValue) || findBestCategoryMatchFromOptions(checkboxOptions, siteData.category);
                if (best && !/select\s*all/i.test(best.text)) {
                  const optionEl = rows.find(el => {
                    const t = (el.textContent || '').trim();
                    return t === best.text || t === best.value;
                  });
                  if (optionEl) {
                    simulateClick(optionEl);
                    clicked++;
                  }
                }
              }
              if (clicked > 0) {
                triggerElement.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`${TAG} Custom select: Tags 已选 ${clicked} 项（最多 ${TAGS_FILL_MAX} 项）`);
                closeThenResolve();
                return;
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
        // Tags 且多选：尝试对 tagsToFill 逐项点击（最多 TAGS_FILL_MAX 项）
        if (isTags && tagsToFill.length > 1) {
          let clicked = 0;
          for (const tagValue of tagsToFill) {
            if (clicked >= TAGS_FILL_MAX) break;
            const best = findBestCategoryMatchFromOptions(options, tagValue) || findBestCategoryMatchFromOptions(options, siteData.category);
            if (best) {
              const optionEl = optionEls.find(el =>
                (el.getAttribute('data-value') || el.textContent.trim()) === best.value ||
                el.textContent.trim() === best.text
              );
              if (optionEl) {
                simulateClick(optionEl);
                clicked++;
              }
            }
          }
          if (clicked > 0) {
            triggerElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`${TAG} Custom select: Tags 已选 ${clicked} 项（最多 ${TAGS_FILL_MAX} 项）`);
            closeThenResolve();
            return;
          }
        }
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
        // Tags 多选：有 optionEls 但可能是 checkbox 行（无 role=option），再试一次按文本匹配，最多 TAGS_FILL_MAX 项
        if (isTags && optionEls.length > 0) {
          const optionsFromText = optionEls.map(el => ({
            value: el.textContent.trim(),
            text: el.textContent.trim()
          })).filter(o => o.text && !/select\s*all/i.test(o.text));
          let clicked = 0;
          for (const tagValue of tagsToFill) {
            if (clicked >= TAGS_FILL_MAX) break;
            const bestTag = findBestCategoryMatchFromOptions(optionsFromText, tagValue);
            if (bestTag) {
              const optionEl = optionEls.find(el => (el.textContent || '').trim() === bestTag.text);
              if (optionEl) {
                simulateClick(optionEl);
                clicked++;
              }
            }
          }
          if (clicked > 0) {
            triggerElement.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`${TAG} Custom select: Tags 已选 ${clicked} 项（最多 ${TAGS_FILL_MAX} 项）`);
            closeThenResolve();
            return;
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
  editableEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  simulateClick(editableEl, true);
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
 * 模拟打字：分字符（或分块）输入，每步 50–200ms 随机延迟，降低被识别为自动化的概率
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @param {string} text
 */
function randomDelayMs() {
  return TYPING_DELAY_MIN_MS + Math.floor(Math.random() * (TYPING_DELAY_MAX_MS - TYPING_DELAY_MIN_MS + 1));
}

function randomPostFillDelayMs() {
  return POST_FILL_DELAY_MIN_MS + Math.floor(Math.random() * (POST_FILL_DELAY_MAX_MS - POST_FILL_DELAY_MIN_MS + 1));
}

/** 点击并聚焦后等待一段时间再开始输入，让输入框光标可见 */
const FOCUS_BEFORE_TYPE_DELAY_MS = 120;

async function typeIntoElementWithDelay(input, text) {
  const str = text != null ? String(text) : '';
  input.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  // 先模拟点击输入框（带坐标），再 focus，使光标显示
  simulateClick(input, true);
  input.focus();
  input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  await new Promise(r => setTimeout(r, FOCUS_BEFORE_TYPE_DELAY_MS));

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
      await new Promise(r => setTimeout(r, randomDelayMs()));
    }
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  input.blur();
}

/**
 * Fill input or textarea element（避免 Illegal invocation：textarea 用 HTMLTextAreaElement，且 setter 失败时回退直接赋值）
 * 若为 Markdown 编辑器（SimpleMDE/CodeMirror）包裹的 textarea，会同步到编辑器实例使界面显示更新
 * 填充前先模拟点击并聚焦，使输入框光标显示
 */
function fillInputElement(input, value) {
  const str = value != null ? String(value) : '';
  input.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  simulateClick(input, true);
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

// ========== Ahrefs 反链 API 拦截（FR-3，仅 ahrefs.com） ==========
// 必须注入到页面的 MAIN world（content script 是 isolated world，无法拦截页面的 fetch）
// 使用 web_accessible_resources 中的外部文件注入，绕过页面 CSP 限制
if (window.location.hostname === 'ahrefs.com') {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/ahrefsInterceptor.js');
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.__navSubmitterAhrefsBacklinks && Array.isArray(event.data.urlFromList)) {
      console.log(TAG, 'Ahrefs backlinks intercepted via MAIN world bridge, count:', event.data.urlFromList.length);
      chrome.runtime.sendMessage({ type: 'ahrefsBacklinks', success: true, urlFromList: event.data.urlFromList }).catch(() => {});
    }
  });
  console.log(TAG, 'Ahrefs MAIN world fetch interceptor injected (file-based), postMessage bridge listening');
}

