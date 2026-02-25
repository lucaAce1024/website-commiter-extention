/**
 * AI 识别功能自测脚本
 * 运行方式: node test-ai-recognition.js
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('AI 识别功能自测');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   错误: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

// 1. 检查文件存在性
console.log('\n📋 文件检查');
console.log('-'.repeat(40));

const files = [
  'background.js',
  'content/formHandler.js',
  'lib/llmService.js',
  'lib/formRecognizer.js',
  'popup/popup.js',
  'popup/popup.html',
  'popup/popup.css'
];

files.forEach(file => {
  test(`文件存在: ${file}`, () => {
    const fullPath = path.join(__dirname, file);
    assert(fs.existsSync(fullPath), `文件不存在: ${file}`);
  });
});

// 2. 检查 background.js 中的 AI 识别功能
console.log('\n📋 Background AI 功能检查');
console.log('-'.repeat(40));

const backgroundJs = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf-8');

test('handleAIRecognizeForm 函数存在', () => {
  assert(backgroundJs.includes('async function handleAIRecognizeForm'), '缺少 handleAIRecognizeForm 函数');
});

test('buildCompactFormDescription 函数存在', () => {
  assert(backgroundJs.includes('function buildCompactFormDescription'), '缺少 buildCompactFormDescription 函数');
});

test('buildAIPrompt 函数存在', () => {
  assert(backgroundJs.includes('function buildAIPrompt'), '缺少 buildAIPrompt 函数');
});

test('parseAIResponse 函数存在', () => {
  assert(backgroundJs.includes('function parseAIResponse'), '缺少 parseAIResponse 函数');
});

test('aiRecognizeForm 消息处理存在', () => {
  assert(backgroundJs.includes("action === 'aiRecognizeForm'"), '缺少 aiRecognizeForm 消息处理');
});

test('GLM-4.7 模型配置', () => {
  assert(backgroundJs.includes("llmConfig.model || 'glm-4.7'"), '缺少 GLM-4.7 模型配置');
});

test('10秒超时设置', () => {
  assert(backgroundJs.includes('10000'), '缺少 10 秒超时设置');
});

// 3. 检查 formHandler.js 中的 AI 识别功能
console.log('\n📋 FormHandler AI 功能检查');
console.log('-'.repeat(40));

const formHandlerJs = fs.readFileSync(path.join(__dirname, 'content/formHandler.js'), 'utf-8');

test('recognizeForm 函数支持 useLlm 参数', () => {
  assert(formHandlerJs.includes('async function recognizeForm(useLlm = false)'), 'recognizeForm 函数缺少 useLlm 参数');
});

test('getCacheKey 函数存在（domain + pathname）', () => {
  assert(formHandlerJs.includes('function getCacheKey()'), '缺少 getCacheKey 函数');
  assert(formHandlerJs.includes('url.hostname + url.pathname'), 'getCacheKey 未使用 domain + pathname');
});

test('callAIRecognize 函数存在', () => {
  assert(formHandlerJs.includes('async function callAIRecognize'), '缺少 callAIRecognize 函数');
});

test('AI 识别失败时回退到关键词匹配', () => {
  assert(formHandlerJs.includes('AI 识别失败，回退到关键词匹配'), '缺少 AI 失败回退逻辑');
});

test('缓存使用 cacheKey', () => {
  assert(formHandlerJs.includes('const cacheKey = getCacheKey()'), '缓存未使用 cacheKey');
  assert(formHandlerJs.includes('await getCachedMapping(cacheKey)'), 'getCachedMapping 未使用 cacheKey');
  assert(formHandlerJs.includes('await cacheMapping(cacheKey,'), 'cacheMapping 未使用 cacheKey');
});

// 4. 检查 llmService.js 中的 GLM 配置
console.log('\n📋 LLM Service 配置检查');
console.log('-'.repeat(40));

const llmServiceJs = fs.readFileSync(path.join(__dirname, 'lib/llmService.js'), 'utf-8');

test('GLM-4.7 模型配置', () => {
  assert(llmServiceJs.includes("model: 'glm-4.7'"), 'llmService 未配置 GLM-4.7 模型');
});

test('智谱 API endpoint 配置', () => {
  assert(llmServiceJs.includes('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'), '缺少智谱 API endpoint');
});

// 5. 检查 popup.js 中的 AI 按钮
console.log('\n📋 Popup AI 功能检查');
console.log('-'.repeat(40));

const popupJs = fs.readFileSync(path.join(__dirname, 'popup/popup.js'), 'utf-8');

test('AI 按钮元素引用', () => {
  assert(popupJs.includes("aiFillFormBtn: document.getElementById('aiFillFormBtn')"), '缺少 AI 按钮元素引用');
});

test('llmEnabled 状态变量', () => {
  assert(popupJs.includes('let llmEnabled = false'), '缺少 llmEnabled 状态变量');
});

test('AI 按钮事件监听器', () => {
  assert(popupJs.includes("elements.aiFillFormBtn.addEventListener('click'"), '缺少 AI 按钮事件监听器');
});

test('AI 识别调用 useLlm: true', () => {
  assert(popupJs.includes('useLlm: true'), '缺少 useLlm: true 参数');
});

// 6. 检查 popup.html 中的 AI 按钮
console.log('\n📋 Popup HTML 检查');
console.log('-'.repeat(40));

const popupHtml = fs.readFileSync(path.join(__dirname, 'popup/popup.html'), 'utf-8');

test('AI 智能识别按钮存在', () => {
  assert(popupHtml.includes('id="aiFillFormBtn"'), '缺少 AI 智能识别按钮');
  assert(popupHtml.includes('AI 智能识别'), '按钮文案不正确');
});

test('btn-secondary 样式类', () => {
  assert(popupHtml.includes('btn btn-secondary'), '缺少 btn-secondary 样式类');
});

// 7. 检查 CSS 样式
console.log('\n📋 Popup CSS 检查');
console.log('-'.repeat(40));

const popupCss = fs.readFileSync(path.join(__dirname, 'popup/popup.css'), 'utf-8');

test('btn-secondary 样式存在', () => {
  assert(popupCss.includes('.btn-secondary'), '缺少 btn-secondary 样式');
});

// 8. 检查标准字段定义一致性
console.log('\n📋 标准字段一致性检查');
console.log('-'.repeat(40));

const standardFields = ['siteName', 'email', 'siteUrl', 'category', 'tags', 'tagline', 'shortDescription', 'longDescription', 'logo', 'screenshot'];

standardFields.forEach(field => {
  test(`background.js 包含标准字段: ${field}`, () => {
    assert(backgroundJs.includes(`'${field}'`), `background.js 缺少标准字段: ${field}`);
  });
});

// 汇总
console.log('\n' + '='.repeat(60));
console.log('测试汇总');
console.log('='.repeat(60));
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);

if (failed > 0) {
  console.log('\n❌ 存在失败的测试，请检查上述错误信息');
  process.exit(1);
} else {
  console.log('\n✅ 所有测试通过！');
  process.exit(0);
}
