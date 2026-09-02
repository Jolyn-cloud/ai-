/**
 * 解析页视频解析（紧跟解析下方 + VIP解锁观看占位符）断言
 * 运行：node _cdp_video_analysis.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8769;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9337;

const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path === '/' ? '/做题页.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chrome`]);
await new Promise(r => rm.on('exit', r));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-chrome`,
]);
await new Promise(r => setTimeout(r, 1200));

let ws;
const pending = new Map();
let msgId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
      const pages = await res.json();
      const page = pages.find(p => p.type === 'page');
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = evt => {
        const m = JSON.parse(evt.data);
        if (m.id && pending.has(m.id)) {
          const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
          m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        }
      };
      await send('Page.enable');
      return page;
    } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('无法连接 CDP');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let FAILED = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else { FAILED++; console.log(`  ❌ ${name} ${extra}`); }
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

try {
  console.log('\n== 解析页视频解析断言（做题页） ==');
  await connect();
  await send('Page.navigate', { url: `http://localhost:${PORT}/做题页.html?entry=today` });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evalJs(`typeof renderQuestion === 'function' && document.querySelectorAll('.tag.type').length > 0`);
    if (ready) break;
    await sleep(200);
  }
  check('做题页加载完成', ready === true);

  /* 触发解析态：置 submitted 并重渲染（today 第 0 题 reveal=true） */
  await evalJs(`submitted = true; hideSubmit(); stopTimer(); idx = 0; renderQuestion();`);
  await sleep(300);
  const anaShown = await evalJs(`document.getElementById('analysisArea').classList.contains('show')`);
  check('解析区已显示', anaShown === true);

  /* ① 视频解析区块顺序：紧随「解析」区块之后 */
  const secOrder = await evalJs(`(function(){
    var secs = document.querySelectorAll('.analysis-area .ana-sec');
    return Array.prototype.map.call(secs, function(s){
      var head = s.querySelector('.sec-head .name');
      return head ? head.textContent.trim() : '';
    });
  })()`);
  check('区块顺序含「解析」与「视频解析」',
    secOrder.indexOf('解析') >= 0 && secOrder.indexOf('视频解析') === secOrder.indexOf('解析') + 1,
    '顺序: ' + secOrder.join(' → '));

  /* ② 每条视频 = 名称行 + 占位符，占位符居中 VIP解锁观看 */
  const vCount = await evalJs(`document.querySelectorAll('.vitem').length`);
  check('视频项 ≥ 2', vCount >= 2, `共 ${vCount} 项`);
  const vItemsOk = await evalJs(`(function(){
    var items = document.querySelectorAll('.vitem');
    return Array.prototype.every.call(items, function(it){
      var name = it.querySelector('.vitem-name');
      var ph = it.querySelector('.vitem-ph');
      var txt = ph ? ph.innerText : '';
      return name && ph && name.textContent.trim().length > 0 && txt.indexOf('VIP解锁观看') >= 0;
    });
  })()`);
  check('每项含名称 + 占位符「VIP解锁观看」', vItemsOk === true);

  /* ③ 无旧缩略图结构 / 无播放提示 */
  const noOld = await evalJs(`!document.querySelector('.video-card') && !document.querySelector('.video-thumb')`);
  check('旧缩略图结构已清除', noOld === true);

  /* ④ 占位符 16:9 与深色渐变底 */
  const phStyle = await evalJs(`(function(){
    var el = document.querySelector('.vitem-ph');
    if (!el) return null;
    var cs = getComputedStyle(el);
    var pbPx = parseFloat(cs.paddingBottom);
    return { ratio: pbPx / el.clientWidth, bgImg: cs.backgroundImage, h0: cs.height };
  })()`);
  check('占位符 16:9（padding-bottom 约 56.25%）',
    phStyle && Math.abs(phStyle.ratio - 0.5625) < 0.02,
    '比例: ' + (phStyle && phStyle.ratio.toFixed(3)));
  check('占位符深色渐变底', phStyle && phStyle.bgImg.indexOf('linear-gradient') >= 0,
    'bg: ' + (phStyle && phStyle.bgImg.slice(0, 60)));

  /* ⑤ 视频标题文案正确（名称行） */
  const firstName = await evalJs(`document.querySelector('.vitem-name').textContent.trim()`);
  check('视频名称行有内容', firstName.length > 5, `得到: ${firstName}`);

  const shot = await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const img = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync('/tmp/zsb_video_ana.png', Buffer.from(img.data, 'base64'));
  console.log('  📸 截图已存 /tmp/zsb_video_ana.png');
} finally {
  server.close();
  chrome.kill();
}
console.log(FAILED ? `\n❌ ${FAILED} 项断言失败` : '\n✅ 全部断言通过');
process.exit(FAILED ? 1 : 0);
