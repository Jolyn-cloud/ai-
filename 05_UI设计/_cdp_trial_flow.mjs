/**
 * 登录流程图（游客体验卷方案）渲染断言
 * 运行：node _cdp_trial_flow.mjs
 * 前置：自动启动 Chrome headless
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8767;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9335;

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path === '/' ? '/登录流程_体验卷方案.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
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
  console.log('\n== 登录流程图（游客体验卷方案）渲染断言 ==');
  await connect();
  await send('Page.navigate', { url: `http://localhost:${PORT}/登录流程_体验卷方案.html` });

  /* 轮询等待页面完全加载（readyState=complete + 三泳道渲染完成） */
  let pageReady = false;
  for (let i = 0; i < 40; i++) {
    pageReady = await evalJs(`document.readyState === 'complete' && document.querySelectorAll('.lane').length === 3`);
    if (pageReady) break;
    await sleep(200);
  }
  check('页面加载完成（三泳道就绪）', pageReady === true);

  const title = await evalJs(`document.title`);
  check('标题正确', title === '登录流程图（游客体验卷方案）', `得到: ${title}`);

  const lanes = await evalJs(`(function(){
    return [1,2,3].map(function(i){
      var el = document.querySelector('.lane-' + i);
      var r = el.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) };
    });
  })()`);
  check('三泳道存在', lanes.length === 3);
  check('三泳道并排同行', lanes[0] && lanes[1] && lanes[2] && lanes[0].top === lanes[1].top && lanes[1].top === lanes[2].top,
    JSON.stringify(lanes));
  check('三泳道等宽分列', lanes[0] && lanes[1] && lanes[2] && lanes[0].left < lanes[1].left && lanes[1].left < lanes[2].left && lanes[0].w === lanes[1].w && lanes[1].w === lanes[2].w,
    JSON.stringify(lanes));

  const texts = await evalJs(`document.body.innerText`);
  const mustHave = [
    '游客体验卷', '免费体验卷', '15题', '停留题库页', '查看解析', 'review', 'pendingReviewQ',
    'zsb_trial_done_v1', 'broadcast()', '登录 Sheet', 'STATE.logged', 'ENTER_REVIEW'
  ];
  mustHave.forEach(function(k) {
    check('含关键文案「' + k + '」', texts.indexOf(k) >= 0);
  });

  const divBalance = await evalJs(`(function(){
    var h = document.documentElement.outerHTML;
    var open = h.split('<div').length - 1;
    var close = h.split('</div>').length - 1;
    return open === close;
  })()`);
  check('div 标签闭合平衡', divBalance === true);

  const nodes = await evalJs(`document.querySelectorAll('.node').length`);
  check('流程节点数 >= 20', nodes >= 20, `共 ${nodes} 个节点`);

  const shot = await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1400, deviceScaleFactor: 1, mobile: false });
  const img = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(ROOT, '登录流程_体验卷方案.png'), Buffer.from(img.data, 'base64'));
  console.log('  📸 全页截图已存 05_UI设计/登录流程_体验卷方案.png');
} finally {
  server.close();
  chrome.kill();
}
console.log(FAILED ? `\n❌ ${FAILED} 项断言失败` : '\n✅ 全部断言通过');
process.exit(FAILED ? 1 : 0);
