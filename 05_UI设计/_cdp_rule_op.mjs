/** 做题页 · 题型规范页 + 操作题分屏优化 验证（PM 2026-09-05）：
    R1 考试卷（模拟考场 exam / 历年真题 real）题型规范页：顶部进度条与底部按钮隐藏；左滑进题后恢复
    R2 练习 today：进度条/底部栏正常（回归）
    O1 操作题分屏：无「第 X 题 / 共 Y 题」标签；tab 只做选中态（无 done/对错变色与 ✓/✗/— 标志）
    O2 拖拽方向：手指上滑 → 题干区变矮、下方作答区增大（随手指同向）；下拉反向
  用法：node _cdp_rule_op.mjs [目标目录，默认脚本所在目录] */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ? join(process.cwd(), process.argv[2]) : SELF;
const PORT = 8778;
const DEVTOOLS_PORT = 9347;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = '/tmp/zsb_ruleop_cdp_profile';
if (!existsSync(join(ROOT, '做题页.html'))) { console.log('FAIL | 找不到 做题页.html in ' + ROOT); process.exit(1); }
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/做题页.html' : decodeURIComponent(req.url.split('?')[0]);
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
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(1100); };
await connect();
const vis = (sel) => `(function(){ var el = document.querySelector('${sel}'); return el ? getComputedStyle(el).display : 'N/A'; })()`;

/* ===== R1 考试卷题型规范页：进度条/底部按钮隐藏 → 进题恢复 ===== */
let r;
async function ruleCheck(entry, label) {
  await gotoT(`http://localhost:${PORT}/做题页.html?entry=${entry}&paperId=${entry}1`);
  r = await evalJs(`(function(){
    return { rule: !!document.querySelector('.rule-page'),
      pw: getComputedStyle(document.getElementById('progressWrap')).display,
      bb: getComputedStyle(document.getElementById('bottomBar')).display,
      fb: getComputedStyle(document.querySelector('.feedback-entry')).display };
  })()`);
  check(label + ' 初始停在题型规范页', r.rule === true, JSON.stringify(r));
  check(label + ' 规范页隐藏进度条', r.pw === 'none', JSON.stringify(r));
  check(label + ' 规范页隐藏底部按钮', r.bb === 'none', JSON.stringify(r));
  check(label + ' 规范页反馈入口仍隐藏', r.fb === 'none', JSON.stringify(r));
  r = await evalJs(`(function(){ leaveRulePage(); return {
      rule: !!document.querySelector('.rule-page'),
      pw: getComputedStyle(document.getElementById('progressWrap')).display,
      bb: getComputedStyle(document.getElementById('bottomBar')).display,
      q: document.getElementById('qNum').textContent }; })()`);
  check(label + ' 左滑进题后规则页消失', r.rule === false, JSON.stringify(r));
  check(label + ' 进题后进度条恢复', r.pw !== 'none' && r.pw !== '', JSON.stringify(r));
  check(label + ' 进题后底部按钮恢复', r.bb !== 'none' && r.bb !== '', JSON.stringify(r));
}
await ruleCheck('exam', 'R1 模拟考场');
await ruleCheck('real', 'R1 历年真题');

/* R2 练习回归：进度条/底部栏正常显示 */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);
r = await evalJs(`(function(){
  return { rule: !!document.querySelector('.rule-page'),
    pw: getComputedStyle(document.getElementById('progressWrap')).display,
    bb: getComputedStyle(document.getElementById('bottomBar')).display };
})()`);
check('R2 today 无规则页且进度条/底部栏正常', r.rule === false && r.pw !== 'none' && r.bb !== 'none', JSON.stringify(r));
/* ===== O1 操作题分屏：无「第X题/共Y题」标签；tab 只做选中态 ===== */
await gotoT(`http://localhost:${PORT}/做题页.html?entry=today`);
r = await evalJs(`(function(){
  for (var i = 0; i < QUESTIONS.length; i++) if (QUESTIONS[i].type === 'operation') { idx = i; resetOp(true); renderQuestion(); return { i: i, n: QUESTIONS[i].sub.length }; }
  return null;
})()`);
check('O1 找到操作题', !!r && r.n >= 2, JSON.stringify(r));
r = await evalJs(`(function(){
  var tabs = [].map.call(document.querySelectorAll('.op-tab'), function(t){ return t.className; });
  var tabTexts = [].map.call(document.querySelectorAll('.op-tab'), function(t){ return t.textContent.replace(/\\s+/g, ''); });
  var subLabel = document.querySelector('.op-sub-label');
  var subStem = document.querySelector('.op-sub-stem');
  var w = document.querySelector('.op-wrap');
  return { tabClasses: tabs, tabTexts: tabTexts, subLabelGone: !subLabel,
    subNoGone: subStem ? !/^\\s*\\d+\\./.test(subStem.textContent) : false,
    subStemHead: subStem ? subStem.textContent.slice(0, 12) : '', tabsLen: tabs.length,
    divider: !!w.querySelector('.op-divider') };
})()`);
check('O1 无「第X题/共Y题」标签', r.subLabelGone === true, JSON.stringify(r));
check('O1 子题题干前序号 1. 已删除', r.subNoGone === true, JSON.stringify(r));
check('O1 子题 tab 用带圈序号（第①②题…）', r.tabTexts[0] === '第①题' && r.tabTexts[1] === '第②题' && r.tabTexts[2] === '第③题', JSON.stringify(r.tabTexts));
check('O1 tab 全无 done/对错变色（仅 op-tab/active）', r.tabClasses.length > 0 && r.tabClasses.every(function(c){ return /^op-tab( active)?$/.test(c); }), JSON.stringify(r.tabClasses));

/* 作答后再查 tab（仍只选中态，无 ✓/✗） */
r = await evalJs(`(function(){
  var sub0 = QUESTIONS[idx].sub[0];
  var ans0 = sub0.answer;
  onSubSelect(0, ans0);
  var tab0 = document.querySelectorAll('.op-tab')[0];
  return { cls: tab0.className, text: tab0.textContent, hasMark: /[✓✗—]/.test(tab0.textContent) };
})()`);
check('O1 答后 tab 无 ✓/✗/— 且不变色', /^op-tab active$/.test(r.cls) && r.hasMark === false, JSON.stringify(r));

/* ===== O2 拖拽方向：上滑→下方作答区增大；下拉→题干区增大 ===== */
r = await evalJs(`(function(){
  var divider = document.querySelector('.op-divider');
  var stem = document.querySelector('.op-stem-pane');
  var pane = document.querySelector('.op-answer-pane');
  var areaH = document.getElementById('questionArea').clientHeight || 700;
  var y0 = divider.getBoundingClientRect().top + 8;
  var fakeClosest = { setPointerCapture: function(){} };
  function dragTo(dy) {
    opDividerPointerDown({ clientY: y0, cancelable: true, preventDefault: function(){}, target: { closest: function(){ return fakeClosest; } } });
    opDividerPointerMove({ clientY: y0 + dy });
    opDividerPointerUp();
  }
  var startRatio = opRatio, startStem = stem.offsetHeight, startPane = pane.offsetHeight;
  dragTo(-90);                       /* 上滑 90px */
  var upRatio = opRatio, upStem = stem.offsetHeight, upPane = pane.offsetHeight;
  dragTo(140);                       /* 下拉 140px */
  var downRatio = opRatio, downStem = stem.offsetHeight;
  return { areaH: areaH, startRatio: +startRatio.toFixed(3), upRatio: +upRatio.toFixed(3),
    upStemShrink: upStem < startStem, upPaneGrow: upPane > startPane,
    downRatio: +downRatio.toFixed(3), downRatioBigger: downRatio > upRatio, downStemGrow: downStem > upStem };
})()`);
check('O2 上滑后题干占比减小（分隔线随手上移）', r.upRatio < r.startRatio, JSON.stringify(r));
check('O2 上滑后题干区变矮、下方作答区增大', r.upStemShrink === true && r.upPaneGrow === true, JSON.stringify(r));
check('O2 下拉后题干区占比回增（下方区缩小）', r.downRatioBigger === true && r.downStemGrow === true, JSON.stringify(r));

/* ===== O3 交卷解析态：tab 仍只选中态，无对错标志；分界线保持隐藏 ===== */
r = await evalJs(`(function(){
  submitted = true;
  renderQuestion();
  var tabs = [].map.call(document.querySelectorAll('.op-tab'), function(t){ return t.className; });
  var div = document.querySelector('.op-divider');
  return { tabOk: tabs.every(function(c){ return /^op-tab( active)?$/.test(c); }),
    divNone: !div || getComputedStyle(div).display === 'none', tabSample: tabs.slice(0, 2) };
})()`);
check('O3 解析态 tab 仍无对错标志（只选中态）', r.tabOk === true, JSON.stringify(r.tabSample));
check('O3 解析态分界线保持隐藏', r.divNone === true, JSON.stringify(r));


console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);
