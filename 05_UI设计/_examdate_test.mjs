/**
 * 考试时间 YYYY-MM-DD + 映射修正 自测（登录与画像原型.html 嵌入 AI伴学总壳）
 * 运行：node _examdate_test.mjs
 * 覆盖：
 *   E1 OB_MONTHS = 纯日期数组（2027-03-28 / 2028-03-26 / 2029-03-25）
 *   E2 OB_MONTH_AUTO 修正映射：大三→2027-03-28、大二→2028-03-26、大一→2029-03-25
 *   E3 Form 下拉 options 显示纯日期
 *   E4 onboarding 选「大三」→ 自动判断 month=2027-03-28
 *   E5 onboarding 选「大一」→ 自动判断 month=2029-03-25
 *   E6 form 选「其他」→ examRow 显示 + 手动选日期
 *   E7 Form examTimeSelect value 写回纯日期
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8774;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DTP = 9340;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/AI伴学_小程序.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[file.match(/\.\w+$/)?.[0] || ''] || 'octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-examdate-chrome`]);
await new Promise(r => rm.on('exit', r));
spawn(CHROME, [`--remote-debugging-port=${DTP}`, `--user-data-dir=${ROOT}/.tmp-examdate-chrome`, '--headless=new', '--disable-gpu', '--window-size=1500,900', 'about:blank']);
await new Promise(r => setTimeout(r, 1400));
let pages;
for (let i = 0; i < 40; i++) {
  try { pages = await (await fetch(`http://127.0.0.1:${DTP}/json`)).json(); if (pages.length) break; } catch (e) {}
  await sleep(250);
}
const page = pages && pages.find(p => p.type === 'page');
if (!page) { console.error('无法连接 Chrome'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, rej) => { ws.onopen = r; ws.onerror = rej; });
let idc = 0; const pending = new Map();
ws.onmessage = evt => { const m = JSON.parse(evt.data.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const cdp = (method, params={}) => new Promise(res => { const id = ++idc; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const js = async e => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
let passed = 0, failed = 0;
function assert(cond, name) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name); } }

await cdp('Page.enable');
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/AI伴学_小程序.html` });
await sleep(1800);

/* 冷启动默认落题库 tab；学习页懒加载，切 study 触发加载后再操作 iframe */
await js(`switchTab('study')`);
await sleep(1200);

/* 进学习页 iframe 上下文操作 */
const study = async expr => await js(`(function(){
  var f = document.getElementById('frame-study');
  if (!f || !f.contentWindow) return undefined;
  return f.contentWindow.eval(${JSON.stringify(expr)});
})()`);

/* E1 OB_MONTHS 纯日期 */
assert(await study(`JSON.stringify(OB_MONTHS)`).then(x => x === '["2027-03-28","2028-03-26","2029-03-25"]'), 'E1 OB_MONTHS=纯日期数组');

/* E2 映射修正 */
const auto = await study(`JSON.stringify(OB_MONTH_AUTO)`);
assert(auto === '{"大一":"2029-03-25","大二":"2028-03-26","大三":"2027-03-28"}', `E2 映射修正(大三→2027)= ${auto}`);

/* E3 Form 下拉 options 显示纯日期 */
await study(`openProfile()`);
await sleep(400);
const opts = await study(`Array.from(document.querySelectorAll('#examTimeSelect option')).filter(o=>o.value).map(o=>o.textContent).join('|')`);
assert(opts === '2027-03-28|2028-03-26|2029-03-25', `E3 Form options 纯日期 = ${opts}`);
await study(`closeProfile()`);

/* E4-E5 onboarding 自动判断（直接调用 OB_MONTH_AUTO 而非 UI 全流程，避免依赖视图状态） */
assert(await study(`OB_MONTH_AUTO['大三']`).then(x => x === '2027-03-28'), 'E4 大三自动判断=2027-03-28');
assert(await study(`OB_MONTH_AUTO['大一']`).then(x => x === '2029-03-25'), 'E5 大一自动判断=2029-03-25');

/* E6-E7 Form 选「其他」→ examRow 显示 + 手动选日期 value 写回 */
await study(`openProfile()`);
await sleep(300);
await study(`document.querySelector('#yearGroup .field-chip[data-v="其他"]').click()`);
await sleep(200);
assert(await study(`document.getElementById('profileExamRow').style.display !== 'none'`), 'E6 选其他 → examRow 显示');
await study(`document.getElementById('examTimeSelect').value = '2029-03-25'`);
assert(await study(`document.getElementById('examTimeSelect').value`).then(x => x === '2029-03-25'), 'E7 手动选日期=2029-03-25');
await study(`closeProfile()`);

/* E8 月列表候选文案 = 纯日期（onboarding 渲染） */
await study(`obStart();
  /* 清空重来，直接看月列表渲染 */
  document.getElementById('obMonthList').innerHTML = '';
  obInit();`);
await sleep(300);
const monthListText = await study(`Array.from(document.querySelectorAll('#obMonthList .ob-list-item')).map(b => b.textContent.trim()).join('|')`);
assert(monthListText === '2027-03-28|2028-03-26|2029-03-25', `E8 月列表=纯日期 = ${monthListText}`);

/* E9 完整 onboarding 流程：选大三 → 自动考试时间 → 选院校 → 选专业 → 完成 */
await study(`obValues = {}; obStep = 0; obRerender();
  /* 大一/大二/大三 选大三：自动判断考试时间 */
  obNext({ year: '大三' });`);
assert(await study(`obValues.month`).then(x => x === '2027-03-28'), 'E9a 大三自动判断考试时间=2027-03-28');
await study(`obNext({ school: '日照职业技术学院' })`);
assert(await study(`obValues.school`).then(x => x === '日照职业技术学院'), 'E9b 已选院校');
await study(`obNext({ major: '计算机应用技术' })`);
await sleep(200);
assert(await study(`obValues.month`).then(x => x === '2027-03-28'), 'E9c 完成画像后 month 保持 2027-03-28');

/* E10 完成反馈出现 + 不用考试时间步骤（选大一/二/三不出现考试时间卡） */
assert(await study(`document.getElementById('obLock').classList.contains('open')`), 'E10 完成反馈展开');

/* E11 选「其他」→ 走考试时间步骤，候选纯日期可选 */
await study(`obStart(); obValues = {}; obStep = 0;
  obNext({ year: '其他' });
  /* 展开月列表选一项 */
  var monthItem = document.querySelector('#obMonthList .ob-list-item');
  if (monthItem) monthItem.click();`);
await sleep(300);
assert(await study(`/^\\d{4}-\\d{2}-\\d{2}$/.test(obValues.month || '')`), 'E11 选其他→手动选日期=YYYY-MM-DD格式');

/* E12 进度圆点数 = 动态项数：大一/二/三=3点，其他=4点，且已填项点亮 */
await study(`obStart(); obValues = {}; obStep = 0; obRerender();
  /* 大三：3 项流程 → 3 个圆点 */
  obNext({ year: '大三' });
  obRerender();`);
assert(await study(`document.querySelectorAll('#obDots i').length`).then(x => x === 3), 'E12a 大三 → 圆点3个');
assert(await study(`document.querySelectorAll('#obDots i.on').length`).then(x => x === 1), 'E12b 第1步已填 → 点亮1个');
await study(`obNext({ school: '日照职业技术学院' }); obRerender();`);
assert(await study(`document.querySelectorAll('#obDots i.on').length`).then(x => x === 2), 'E12c 第2步已填 → 点亮2个');
await study(`obNext({ major: '计算机应用技术' }); obRerender();`);
assert(await study(`document.querySelectorAll('#obDots i.on').length`).then(x => x === 3), 'E12d 完成 → 点亮3个（3/3）');
/* 其他：4 项流程 → 4 个圆点 */
await study(`obStart(); obValues = {}; obStep = 0; obRerender();
  obNext({ year: '其他' }); obRerender();`);
assert(await study(`document.querySelectorAll('#obDots i').length`).then(x => x === 4), 'E12e 其他 → 圆点4个');
assert(await study(`document.querySelectorAll('#obDots i.on').length`).then(x => x === 1), 'E12f 第1步已填 → 点亮1个');

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
server.close();
process.exit(failed ? 1 : 0);