/**
 * Test script for form field regex patterns
 * Run with: node doc/test-regex-patterns.js
 */

// Standard fields definition (same as in storage.js)
const STANDARD_FIELDS = {
  SITE_NAME: 'siteName',
  EMAIL: 'email',
  SITE_URL: 'siteUrl',
  CATEGORY: 'category',
  TAGLINE: 'tagline',
  SHORT_DESCRIPTION: 'shortDescription',
  LONG_DESCRIPTION: 'longDescription',
  LOGO: 'logo',
  SCREENSHOT: 'screenshot'
};

// Regular expression patterns for each standard field type
const FIELD_PATTERNS = {
  [STANDARD_FIELDS.SITE_NAME]: {
    patterns: [
      // English patterns
      /\b(sitename|site_name|site-name)\b/i,
      /\b(product\s*name|productname|product_name)\b/i,
      /\b(project\s*name|projectname|project_name)\b/i,
      /\b(app\s*name|appname|app_name)\b/i,
      /\b(tool\s*name|toolname|tool_name)\b/i,
      /\b(website\s*name|websitename|website_name)\b/i,
      /\b(title|name)\b/i,

      // Chinese patterns
      /网站名[称字]/,
      /站点名[称字]?/,
      /产品名[称字]/,
      /项目名[称字]/,
      /工具名[称字]/,
      /标题/,
    ],
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
      /\b(email|e-mail)\b/i,
      /\b(mail\s*address|mailaddress)\b/i,
      /\b(contact\s*email|contactemail)\b/i,
      /\b(user\s*email|useremail)\b/i,
      /\b(email\s*address|emailaddress)\b/i,
      /\b(author\s*email|authoremail)\b/i,
      /\b(contact)\b/i,
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
      /\b(url|link|href)\b/i,
      /\b(website|webpage)\b/i,
      /\b(homepage|landingpage)\b/i,
      /\b(source\s*url|sourceurl|source_url)\b/i,
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
      /\b(category|categories)\b/i,
      /\b(cat)\b/i,
      /\b(type)\b/i,
      /\b(classification|classify)\b/i,
      /\b(section)\b/i,
      /\b(topic)\b/i,
      /\b(niche)\b/i,
      /\b(industry)\b/i,
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
      /\b(tagline)\b/i,
      /\b(slogan)\b/i,
      /\b(motto)\b/i,
      /\b(one\s*liner|oneliner|one_liner)\b/i,
      /\b(catchphrase)\b/i,
      /\b(headline)\b/i,
      /\b(subtitle)\b/i,
      /\b(tag\s*line|tagline)\b/i,
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
      /简介/,
      /简述/,
      /简短描述/,
      /简要介绍/,
      /概述/,
      /摘要/,
      /简介描述/,
      /简单介绍/,
    ],
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
      /图标/,
      /标志/,
      /徽标/,
      /网站图标/,
      /产品图标/,
      /公司图标/,
      /头像/,
      /Favicon/,
    ],
    weights: { pattern: 3, label: 2 }
  },

  [STANDARD_FIELDS.SCREENSHOT]: {
    patterns: [
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
      /\b(showcase)\b/i,
      /\b(site\s*screenshot|sitescreenshot|site_screenshot)\b/i,
      /\b(product\s*screenshot|productscreenshot|product_screenshot)\b/i,
      /\b(website\s*screenshot|websitescreenshot|website_screenshot)\b/i,
      /\b(app\s*screenshot|appscreenshot|app_screenshot)\b/i,
      /\b(page\s*screenshot|pagescreenshot|page_screenshot)\b/i,
      /\b(ui\s*screenshot|uiscreenshot|ui_screenshot)\b/i,
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

// Test cases based on real navigation sites
const TEST_CASES = [
  // aoyii.com (中文站)
  { name: '网址链接', label: '网址链接', expected: 'siteUrl' },
  { name: '标题', label: '标题', expected: 'siteName' },
  { name: '简介', label: '简介', expected: 'shortDescription' },
  { name: '详细介绍', label: '详细介绍', expected: 'longDescription' },
  { name: 'email', label: '邮箱验证', expected: 'email' },
  { name: 'screenshot', label: '上传网站截图', expected: 'screenshot' },
  { name: 'favicon', label: '上传Favicon图标', expected: 'logo' },

  // curateclick.com (英文站)
  { name: 'productUrl', label: 'Product URL', expected: 'siteUrl' },
  { name: 'sourceUrl', label: 'Source URL', expected: 'siteUrl' },
  { name: 'title', label: 'Product Title', expected: 'siteName' },
  { name: 'summary', label: 'Product Summary', expected: 'shortDescription' },
  { name: 'author', label: 'Author Name', expected: 'siteName' },
  { name: 'contactEmail', label: 'Contact Email', expected: 'email' },
  { name: 'description', label: 'Product Description', expected: 'longDescription' },

  // Generic test cases
  { name: 'site_name', label: 'Site Name', expected: 'siteName' },
  { name: 'website_url', label: 'Website URL', expected: 'siteUrl' },
  { name: 'short_desc', label: 'Short Description', expected: 'shortDescription' },
  { name: 'long_desc', label: 'Long Description', expected: 'longDescription' },
  { name: 'category', label: 'Category', expected: 'category' },
  { name: 'tagline', label: 'Tagline', expected: 'tagline' },
  { name: 'logo', label: 'Logo', expected: 'logo' },
  { name: 'screenshot', label: 'Screenshot', expected: 'screenshot' },

  // Edge cases - should NOT match siteUrl
  { name: 'logo_url', label: 'Logo URL', expected: 'logo', excludeFromSiteUrl: true },
  { name: 'icon_url', label: 'Icon URL', expected: 'logo', excludeFromSiteUrl: true },
  { name: 'image_url', label: 'Image URL', expected: null, excludeFromSiteUrl: true },

  // ProductHunt style
  { name: 'name', label: 'Product name', expected: 'siteName' },
  { name: 'tagline', label: 'Tagline', expected: 'tagline' },
  { name: 'url', label: 'Product URL', expected: 'siteUrl' },
  { name: 'comment', label: 'Description', expected: 'longDescription' },
];

// Helper functions
function matchesPatterns(text, patterns) {
  if (!text || !patterns) return false;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

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

function matchField(testCase) {
  const scores = {};
  const fieldTexts = {
    name: testCase.name || '',
    id: testCase.id || '',
    label: testCase.label || '',
    placeholder: testCase.placeholder || '',
    ariaLabel: testCase.ariaLabel || ''
  };

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

    if (excludeMatch) continue;

    const patternWeight = config.weights.pattern || 3;
    for (const attr of ['name', 'id', 'label', 'placeholder', 'ariaLabel']) {
      const text = fieldTexts[attr];
      if (text) {
        const matchCount = getPatternMatchScore(text, config.patterns);
        if (matchCount > 0) {
          const attrMultiplier = (attr === 'name' || attr === 'id') ? 1.5 : 1;
          score += matchCount * patternWeight * attrMultiplier;
        }
      }
    }

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

  let bestField = null;
  let bestScore = 0;

  for (const [fieldName, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestField = fieldName;
    }
  }

  if (bestScore < 3) {
    return { field: null, score: 0, allScores: scores };
  }

  return { field: bestField, score: bestScore, allScores: scores };
}

// Run tests
console.log('='.repeat(80));
console.log('Form Field Regex Pattern Test Results');
console.log('='.repeat(80));
console.log('');

let passed = 0;
let failed = 0;

for (const testCase of TEST_CASES) {
  const result = matchField(testCase);
  const expected = testCase.expected;
  const actual = result.field;

  const isPass = actual === expected;

  if (isPass) {
    passed++;
    console.log(`✅ PASS: "${testCase.label}" (name: ${testCase.name})`);
    console.log(`   Expected: ${expected}, Got: ${actual} (score: ${result.score})`);
  } else {
    failed++;
    console.log(`❌ FAIL: "${testCase.label}" (name: ${testCase.name})`);
    console.log(`   Expected: ${expected}, Got: ${actual} (score: ${result.score})`);
    if (Object.keys(result.allScores).length > 0) {
      console.log(`   All scores: ${JSON.stringify(result.allScores)}`);
    }
  }
  console.log('');
}

console.log('='.repeat(80));
console.log(`Summary: ${passed} passed, ${failed} failed out of ${TEST_CASES.length} tests`);
console.log(`Success rate: ${((passed / TEST_CASES.length) * 100).toFixed(1)}%`);
console.log('='.repeat(80));

// ========== Category Matching Tests ==========
console.log('\n');
console.log('='.repeat(80));
console.log('Category Matching Tests');
console.log('='.repeat(80));
console.log('');

const CATEGORY_SYNONYMS = {
  '视频': ['video', 'media', 'multimedia', 'entertainment', 'film', 'movies', 'streaming'],
  'video': ['视频', 'media', 'multimedia', 'entertainment', 'film', 'streaming'],
  'ai': ['artificial intelligence', 'machine learning', 'ml', '人工智能', '智能'],
  '人工智能': ['ai', 'artificial intelligence', 'machine learning', 'smart'],
  '设计': ['design', 'designer', 'ui', 'ux', 'graphic', 'creative'],
  'design': ['设计', 'designer', 'ui', 'ux', 'graphic', 'creative'],
  '效率': ['productivity', 'efficiency', 'tools', 'utility'],
  'productivity': ['效率', 'efficiency', 'tools', 'utility', 'work'],
  '商业': ['business', 'marketing', 'sales', 'enterprise', 'b2b'],
  '写作': ['writing', 'content', 'copywriting', 'text', 'editor'],
  'writing': ['写作', 'content', 'copywriting', 'text', 'editor'],
  '图片': ['image', 'photo', 'picture', 'graphics', 'visual'],
  'image': ['图片', 'photo', 'picture', 'graphics', 'visual'],
  '音频': ['audio', 'music', 'sound', 'voice', 'podcast'],
  'audio': ['音频', 'music', 'sound', 'voice', 'podcast'],
  '教育': ['education', 'learning', 'training', 'course', 'tutorial'],
  'education': ['教育', 'learning', 'training', 'course', 'tutorial'],
  '社交': ['social', 'social media', 'community', 'networking'],
  'social': ['社交', 'social media', 'community', 'networking'],
  '金融': ['finance', 'financial', 'money', 'banking', 'investment'],
  'finance': ['金融', 'financial', 'money', 'banking', 'investment'],
};

function findBestCategoryMatch(userCategory, availableOptions) {
  const userCategoryLower = userCategory.toLowerCase().trim();
  const options = availableOptions.map(opt => ({
    value: opt.toLowerCase(),
    text: opt.trim(),
    textLower: opt.toLowerCase().trim()
  })).filter(opt => opt.text);

  // 1. Try exact match
  const exactMatch = options.find(opt =>
    opt.value === userCategory ||
    opt.text === userCategory ||
    opt.textLower === userCategoryLower
  );
  if (exactMatch) return exactMatch;

  // 2. Try direct partial match
  const partialMatch = options.find(opt =>
    opt.textLower.includes(userCategoryLower) ||
    userCategoryLower.includes(opt.textLower)
  );
  if (partialMatch) return partialMatch;

  // 3. Use synonym mapping
  const synonyms = CATEGORY_SYNONYMS[userCategoryLower] || [];

  for (const synonym of synonyms) {
    const synonymLower = synonym.toLowerCase();

    const synonymExactMatch = options.find(opt => opt.textLower === synonymLower);
    if (synonymExactMatch) return synonymExactMatch;

    const synonymPartialMatch = options.find(opt =>
      opt.textLower.includes(synonymLower) ||
      synonymLower.includes(opt.textLower)
    );
    if (synonymPartialMatch) return synonymPartialMatch;
  }

  // 4. Try reverse mapping
  for (const option of options) {
    const optionSynonyms = CATEGORY_SYNONYMS[option.textLower];
    if (optionSynonyms) {
      if (optionSynonyms.some(s => s.toLowerCase() === userCategoryLower)) {
        return option;
      }
      if (optionSynonyms.some(s =>
        s.toLowerCase().includes(userCategoryLower) ||
        userCategoryLower.includes(s.toLowerCase())
      )) {
        return option;
      }
    }
  }

  // 5. Try fuzzy matching
  const userWords = userCategoryLower.split(/[\s_-]+/);
  for (const option of options) {
    const optionWords = option.textLower.split(/[\s_-]+/);
    if (userWords.some(uw => optionWords.some(ow => uw === ow || ow.includes(uw) || uw.includes(ow)))) {
      return option;
    }
  }

  return null;
}

const CATEGORY_TESTS = [
  // Test: user category -> available options -> expected match
  { userCategory: '视频', options: ['Video', 'Image', 'Audio', 'Text'], expected: 'Video' },
  { userCategory: '视频', options: ['Media', 'Design', 'Development'], expected: 'Media' },
  { userCategory: '视频', options: ['Entertainment', 'Business', 'Education'], expected: 'Entertainment' },
  { userCategory: '视频', options: ['Film & TV', 'Music', 'Games'], expected: 'Film & TV' },
  { userCategory: 'ai', options: ['Artificial Intelligence', 'Development', 'Design'], expected: 'Artificial Intelligence' },
  { userCategory: '人工智能', options: ['AI Tools', 'Development', 'Business'], expected: 'AI Tools' },
  { userCategory: '设计', options: ['Design Agencies', 'Developer', 'Business'], expected: 'Design Agencies' },
  { userCategory: '效率', options: ['Productivity', 'Entertainment', 'Finance'], expected: 'Productivity' },
  { userCategory: '写作', options: ['Writing', 'Development', 'Marketing'], expected: 'Writing' },
  { userCategory: '图片', options: ['Image', 'Video', 'Audio'], expected: 'Image' },
  { userCategory: '音频', options: ['Music & Sound', 'Video', 'Image'], expected: 'Music & Sound' },
  { userCategory: '教育', options: ['Education', 'Finance', 'Health'], expected: 'Education' },
  { userCategory: '社交', options: ['Social', 'Business', 'Technology'], expected: 'Social' },
  { userCategory: '金融', options: ['Finance', 'Health', 'Education'], expected: 'Finance' },
  { userCategory: '商业', options: ['Business', 'Education', 'Entertainment'], expected: 'Business' },
];

let catPassed = 0;
let catFailed = 0;

for (const test of CATEGORY_TESTS) {
  const result = findBestCategoryMatch(test.userCategory, test.options);
  const actual = result ? result.text : null;
  const isPass = actual === test.expected;

  if (isPass) {
    catPassed++;
    console.log(`✅ PASS: "${test.userCategory}" -> [${test.options.join(', ')}] => "${actual}"`);
  } else {
    catFailed++;
    console.log(`❌ FAIL: "${test.userCategory}" -> [${test.options.join(', ')}]`);
    console.log(`   Expected: "${test.expected}", Got: "${actual}"`);
  }
}

console.log('');
console.log('='.repeat(80));
console.log(`Category Matching Summary: ${catPassed} passed, ${catFailed} failed out of ${CATEGORY_TESTS.length} tests`);
console.log(`Success rate: ${((catPassed / CATEGORY_TESTS.length) * 100).toFixed(1)}%`);
console.log('='.repeat(80));
