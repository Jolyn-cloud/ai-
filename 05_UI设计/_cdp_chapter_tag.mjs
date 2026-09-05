/** 章节刷题 · 右侧考题标签优化 验证（PM 2026-09-05）：
    T1 一级章头：已做 X/Y + 正确率 Z%（含文字前缀）+ 错 N，数字主题蓝
    T2 二级节行：行首圆点→浅灰上下箭头（唯一展开入口、标题前）；行尾只留「正确率 Z%」
    T3 三级考点：X/Y + 正确率 Z%（含文字前缀），数字主题蓝；点击箭头展开四级联动正常
    T4 未做分支显示「未做」不显示正确率
    T5 标题点击进练习（onclick 保留）；四级行保持 ✔/✖ 不变
  用法：node _cdp_chapter_tag.mjs [目标目录，默认脚本所在目录] */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ? join(process.cwd(), process.argv[2]) : SELF;
const PORT = 8776;
const DEVTOOLS_PORT = 9346;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = '/tmp/zsb_chapter_cdp_profile';
if (!existsSync(join(ROOT, '章节刷题.html'))) { console.log('FAIL | 找不到 章节刷题.html in ' + ROOT); process.exit(1); }
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/章节刷题.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', PROFILE]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=390,844', `--user-data-dir=${PROFILE}`]);
await new Promise(r => setTimeout(r, 1500));
let ws; const pending = new Map(); let msgId = 0;
function send(method, params = {}) { return new Promise((res, rej) => { const id = ++msgId; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); }); }
async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
      const page = (await res.json()).find(p => p.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = evt => { const m = JSON.parse(evt.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
      return;
    } catch (e) { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('connect fail');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(1200); };
const PRIMARY = 'rgb(91, 114, 245)';
await connect();
const url0 = `http://localhost:${PORT}/章节刷题.html`;
await gotoT(url0);

/* ===== T1 一级章头：指标文案 + 顺序 + 数字主题蓝 ===== */
let r = await evalJs(`(function(){
  var head = document.querySelector('.ch-head');
  var t = head.textContent.replace(/\\s+/g, ' ');
  var css = function(sel){ var el = document.querySelector('.ch-head ' + sel); return el ? getComputedStyle(el).color : ''; };
  return {
    hasDone: /已做/.test(t), has96of120: /96\\/120/.test(t),
    hasRateWord: /正确率/.test(t), has72: /72%/.test(t),
    hasWrong: t.indexOf('错') >= 0, has27: /27/.test(t),
    rateBeforeWrong: t.indexOf('正确率') >= 0 && t.indexOf('正确率') < t.indexOf('错'),
    doneColor: css('.m-done strong'), rateColor: css('.m-rate b'), wrongColor: css('.m-wrong strong'),
    noRateClass: !document.querySelector('.ch-head .m-rate.low, .ch-head .m-rate.mid, .ch-head .m-rate.high'),
    progress: !!document.querySelector('.ch-progress')
  };
})()`);
check('T1 一级含「已做 96/120」', r.hasDone === true && r.has96of120 === true, JSON.stringify(r));
check('T1 一级含「正确率 72%」文字前缀', r.hasRateWord === true && r.has72 === true, JSON.stringify(r));
check('T1 一级含「错 27」且在正确率之后', r.hasWrong === true && r.has27 === true && r.rateBeforeWrong === true, JSON.stringify(r));
check('T1 一级数字主题蓝', r.doneColor === PRIMARY && r.rateColor === PRIMARY && r.wrongColor === PRIMARY, JSON.stringify(r));
check('T1 一级不再有分档色 class', r.noRateClass === true, JSON.stringify(r));
check('T1 进度条保留', r.progress === true, JSON.stringify(r));

/* ===== T2 二级节行：圆点→行首箭头（唯一展开入口），行尾只留正确率 ===== */
r = await evalJs(`(function(){
  var row = document.querySelector('.sub-row');
  var pseudo = getComputedStyle(row, '::before').content;
  var kids = [].map.call(row.children, function(c){ return c.className; });
  var arrows = row.querySelectorAll('.sub-arrow');
  var rate = row.querySelector('.sub-rate');
  return {
    pseudoContent: pseudo,
    kids: kids,
    arrowCount: arrows.length,
    firstIsArrow: kids.length > 0 && /sub-arrow/.test(kids[0]),
    titleAfterArrow: kids.length > 1 && /sub-title/.test(kids[1]),
    titleOnclick: (row.querySelector('.sub-title').getAttribute('onclick') || '').indexOf('goQuiz') >= 0,
    rateText: rate ? rate.textContent : '',
    rateColor: rate && rate.querySelector('b') ? getComputedStyle(rate.querySelector('b')).color : ''
  };
})()`);
check('T2 圆点已删除（::before 无内容）', r.pseudoContent === 'none' || r.pseudoContent === '', JSON.stringify(r));
check('T2 行内箭头仅 1 个且位于标题前（行尾旧钮已移除）', r.arrowCount === 1 && r.firstIsArrow === true && r.titleAfterArrow === true, JSON.stringify(r));
check('T2 标题点击进练习保留', r.titleOnclick === true, JSON.stringify(r));
check('T2 二级显示「正确率 80%」', /正确率/.test(r.rateText) && /80%/.test(r.rateText), JSON.stringify(r));
check('T2 正确率数值主题蓝', r.rateColor === PRIMARY, JSON.stringify(r));
/* 行尾布局：row 无平铺末尾箭头节点（children 无其它 arrow） */
check('T2 行尾无第二个展开按钮', r.kids.length <= 3, JSON.stringify(r));

/* 展开交互：点击行首箭头 → 三级/四级出现，再点收起 */
r = await evalJs(`(function(){
  document.querySelector('.sub-row .sub-arrow').click();
  var root = document.querySelector('.lv3-root');
  var cs = root ? getComputedStyle(root) : null;
  var l3rows = document.querySelectorAll('.lv3-row').length;
  var l4vis = getComputedStyle(document.querySelector('.lv4-list')).display;
  return { opened: openSub === 0, rootDisplay: cs ? cs.display : '', l3rows: l3rows, l4vis: l4vis };
})()`);
check('T2 行首箭头点击展开三级+四级', r.opened === true && r.rootDisplay === 'block' && r.l3rows > 0, JSON.stringify(r));
check('T2 展开默认联动第一个三级四级可见', r.l4vis !== 'none', JSON.stringify(r));
r = await evalJs(`(function(){
  document.querySelector('.sub-row .sub-arrow').click();
  var root = document.querySelector('.lv3-root');
  return { closed: openSub === null, rootDisplay: root ? getComputedStyle(root).display : '' };
})()`);
check('T2 再点箭头收起', r.closed === true && r.rootDisplay === 'none', JSON.stringify(r));
/* ===== T3 三级考点：X/Y + 正确率 Z% 文字前缀，数字主题蓝 ===== */
r = await evalJs(`(function(){
  document.querySelector('.sub-row .sub-arrow').click();   /* 展开第一个二级（含三级四级） */
  var m = document.querySelector('.lv3-row .lv3-meta');
  var t = m.textContent.replace(/\\s+/g, ' ');
  var pick = document.querySelector('.lv3-row .pick');
  var title = document.querySelector('.lv3-row .lv3-title');
  return {
    has79: /7\\/9/.test(t), hasRateWord: /正确率/.test(t), has86: /86%/.test(t),
    doneColor: m.querySelector('.m-done') ? getComputedStyle(m.querySelector('.m-done')).color : '',
    rateColor: m.querySelector('.m-rate b') ? getComputedStyle(m.querySelector('.m-rate b')).color : '',
    pickText: pick ? pick.textContent : '', pickOnclick: pick ? (pick.getAttribute('onclick') || '').indexOf('toggleL3') >= 0 : false,
    titleOnclick: (title.getAttribute('onclick') || '').indexOf('goQuiz') >= 0,
    noRateClass: !document.querySelector('.lv3-row .m-rate.low, .lv3-row .m-rate.mid, .lv3-row .m-rate.high')
  };
})()`);
check('T3 三级含「7/9 · 正确率 86%」', r.has79 === true && r.hasRateWord === true && r.has86 === true, JSON.stringify(r));
check('T3 三级数字主题蓝', r.doneColor === PRIMARY && r.rateColor === PRIMARY, JSON.stringify(r));
check('T3 三级不再有分档色 class', r.noRateClass === true, JSON.stringify(r));
check('T3 三级展开箭头与标题点击保留', (r.pickText === '⌃' || r.pickText === '▸') && r.pickOnclick === true && r.titleOnclick === true, JSON.stringify(r));

/* 三级切换四级联动仍正常（点第二个三级展开其四级） */
r = await evalJs(`(function(){
  var rows = document.querySelectorAll('.lv3-row');
  rows[1].querySelector('.pick').click();
  var l4lists = document.querySelectorAll('.lv4-list');
  var vis = [];
  for (var i = 0; i < l4lists.length; i++) vis.push(getComputedStyle(l4lists[i]).display);
  return { openL3: openL3, vis: vis };
})()`);
check('T3 三级单开切换四级正常', r.openL3 === 1 && r.vis[1] === 'flex', JSON.stringify(r));

/* ===== T4 未做分支：显示「未做」，不出现正确率 ===== */
r = await evalJs(`(function(){
  CHAPTERS[0].subs[1].done = 0;
  CHAPTERS[0].subs[1].right = 0;
  CHAPTERS[0].subs[1].wrong = 0;
  renderContent();
  var rows = document.querySelectorAll('.sub-row');
  var rate = rows[1].querySelector('.sub-rate');
  return { len: rows.length, text: rate ? rate.textContent.replace(/\\s+/g, ' ') : '' };
})()`);
check('T4 未做二级显示「未做」且无正确率数字', r.len >= 2 && /未做/.test(r.text) && !/正确率|%/.test(r.text), JSON.stringify(r));

/* ===== T5 四级考点保持原样（✔/✖），不含「正确率」= ===== */
r = await evalJs(`(function(){
  CHAPTERS[0].subs[1].done = 24;   /* 还原数据，保持演示完整 */
  CHAPTERS[0].subs[1].right = 17;
  CHAPTERS[0].subs[1].wrong = 7;
  openSub = 0; openL3 = 0; renderContent();
  var l4 = document.querySelector('.lv4-row .lv4-meta');
  var t = l4 ? l4.textContent.replace(/\\s+/g, ' ') : '';
  return { hasOk: /✔/.test(t), notRate: t.indexOf('正确率') < 0, sample: t };
})()`);
check('T5 四级仍为 ✔/✖ 样式且无「正确率」前缀', r.hasOk === true && r.notRate === true, JSON.stringify(r));


console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);
