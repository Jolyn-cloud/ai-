/** 章节刷题 · 四类行右侧标签统一验证（PM 2026-09-07）：
 *   1级 考点n·✔a·✖b+进度条；2级 考点n·✔a·✖b；3级 考点n·✔a·✖b(顽固布尔标)；
 *   4级 ✔a·✖b；未做灰态；无旧文案(正确率/已做/N题·未做)；对错用✔✖不用文字
 * 用法：node _cdp_chapter_stat.mjs .（在目标目录内执行） */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8777, DEVTOOLS_PORT = 9347;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = '/tmp/zsb_chapter_stat_profile';
if (!existsSync(join(ROOT, '章节刷题.html'))) { console.log('FAIL | 无章节刷题.html in ' + ROOT); process.exit(1); }
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
const gotoT = async (url) => { await send('Page.navigate', { url }); await sleep(1000); };
await connect();
await gotoT(`http://localhost:${PORT}/章节刷题.html`);
/* 页面内做去空格工具：行标签文案内不含换行/tab，仅可能含空格 */
await evalJs(`(function(){ window.__N = function(s){ return s.replace(/ /g, ''); }; return true; })()`);

/* T1 1级章头：考点29 · ✔69 · ✖27 + 进度条80%，无旧文案 */
let r = await evalJs(`(function(){
  var m = document.querySelector('.ch-metrics');
  var t = window.__N(m.textContent);
  var bar = document.querySelector('.ch-progress .ch-progress-inner');
  return { t: t, hasPt: t === '考点29✔69✖27',
    noOld: !/正确率|已做/.test(document.getElementById('lvContent').textContent), barW: bar ? bar.style.width : '',
    okCol: m.querySelector('.m-ok') ? getComputedStyle(m.querySelector('.m-ok')).color : '',
    noCol: m.querySelector('.m-no') ? getComputedStyle(m.querySelector('.m-no')).color : '',
    ptCol: m.querySelector('.pt b') ? getComputedStyle(m.querySelector('.pt b')).color : '' };
})()`);
check('T1 章头含 考点29/✔69/✖27', r.hasPt, r.t);
check('T1 无 正确率/已做 旧文案', r.noOld, '');
check('T1 章进度条=答题进度80%', r.barW === '80%', r.barW);
check('T1 ✔绿/✖红/考点数主题蓝', r.okCol === 'rgb(32, 168, 102)' && r.noCol === 'rgb(239, 68, 68)' && r.ptCol === 'rgb(91, 114, 245)', r.okCol + ' / ' + r.noCol + ' / ' + r.ptCol);

/* T2 2级节行 meta */
r = await evalJs(`(function(){
  var rows = [].slice.call(document.querySelectorAll('.sub-row'));
  return rows.slice(0, 2).map(function(sr){ var x = sr.querySelector('.sub-rate'); return x ? window.__N(x.textContent) : ''; });
})()`);
check('T2 二级行 meta=考点7✔16✖4', r[0] === '考点7✔16✖4', r.join(' | '));
check('T2 二级行 meta=考点6✔17✖7', r[1] === '考点6✔17✖7', r.join(' | '));

/* T3 3级行 meta + 顽固旧逻辑布尔 */
r = await evalJs(`(function(){
  document.querySelector('.sub-row .sub-arrow').click();
  var root = document.querySelector('.sub-row.open + .lv3-root');
  var meta = root ? root.querySelector('.lv3-meta') : null;
  return { m0: meta ? window.__N(meta.textContent) : '', stub: meta ? !!meta.querySelector('.m-stubborn') : false };
})()`);
check('T3 三级行 meta=考点3✔6✖1 且无顽固', r.m0 === '考点3✔6✖1' && r.stub === false, r.m0);
r = await evalJs(`(function(){
  CHAPTERS[0].subs[1].level3[0].wrong = 5;   /* total10 → wrong≥50% 触发 */
  openSub = 1; openL3 = 0; renderContent();
  var root = document.querySelector('.sub-row.open + .lv3-root');
  var meta = root ? root.querySelector('.lv3-meta') : null;
  return { m: meta ? window.__N(meta.textContent) : '', stub: meta ? !!meta.querySelector('.m-stubborn') : false };
})()`);
check('T3 wrong÷total≥50% → 3级行布尔「顽固」', r.stub === true && r.m.indexOf('顽固') >= 0, r.m);
await evalJs(`(function(){ CHAPTERS[0].subs[1].level3[0].wrong = 2; renderContent(); return true; })()`);

/* T4 四级 ✔/✖（无 N题·未做）+ fresh 章灰态 */
r = await evalJs(`(function(){
  openSub = 0; openL3 = 0; renderContent();
  var root = document.querySelector('.sub-row.open + .lv3-root');
  var l4s = [].slice.call(root.querySelectorAll('.lv4-row .lv4-meta')).map(function(x){ return window.__N(x.textContent); });
  return { s: l4s.slice(0, 2), noTotal: document.getElementById('lvContent').textContent.indexOf('题·未做') < 0 };
})()`);
check('T4 四级 meta=✔3 ✔2 无「N题·未做」', r.s[0] === '✔3' && r.s[1] === '✔2' && r.noTotal, r.s.join(' | '));
r = await evalJs(`(function(){
  var items = [].slice.call(document.querySelectorAll('.lv-item'));
  items[2].click();
  var m = document.querySelector('.ch-metrics');
  return { t: m ? window.__N(m.textContent) : '', fresh: !!document.querySelector('.fresh-tag'), bar: !!document.querySelector('.ch-progress') };
})()`);
check('T4 fresh 章 Win10：考点15未练习，无进度条', r.t === '考点15未练习' && r.fresh === true && r.bar === false, r.t);

/* T5 章节区容器内旧文案/旧类名无残留 */
r = await evalJs(`(function(){
  var h = document.getElementById('lvContent').innerHTML;
  return { bad: /正确率|已做|m-rate|m-done|m-total|m-wrong/.test(h) };
})()`);
check('T5 章节区无旧文案/旧类名残留', r.bad === false, JSON.stringify(r));

console.log('');
console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILED');
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);

