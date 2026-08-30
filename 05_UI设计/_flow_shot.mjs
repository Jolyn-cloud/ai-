/**
 * 流程图渲染截图：登录流程_三条主线.html → 登录流程.jpg（高分辨率，替换 PRD 内嵌旧图）
 * 运行：node _flow_shot.mjs
 * 前置：Chrome headless 以 --remote-debugging-port 启动（脚本自动）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8777;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DTP = 9444;
const OUT = join(ROOT, '登录流程.jpg');
const SRC = join(ROOT, '登录流程_三条主线.html');
const WIDTH = 1400;

/* ---------- 静态文件服务 ---------- */
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

/* ---------- 启动 Chrome ---------- */
rmSync(`${ROOT}/.tmp-flow-chrome`, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DTP}`,
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${ROOT}/.tmp-flow-chrome`,
]);
await new Promise(r => setTimeout(r, 1200));

/* ---------- CDP 客户端 ---------- */
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
      const res = await fetch(`http://localhost:${DTP}/json`);
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
      await send('Runtime.enable');
      return page;
    } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('无法连接 CDP');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 截图流程 ---------- */
const page = await connect();
const url = `http://localhost:${PORT}/${encodeURIComponent('登录流程_三条主线.html')}`;

// 1) 先设一个宽松视口再导航（拿到真实内容高度）
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(1500);

// 2) 读取内容实际高度
const dim = await send('Runtime.evaluate', { expression: `({h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth})`, returnByValue: true });
const H = dim.result.value.h;
console.log(`内容尺寸: ${dim.result.value.w} x ${H}`);

// 3) 按内容高度设 2x 视口（输出 2800 x 2H）
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: H, deviceScaleFactor: 2, mobile: false });
await sleep(800);

// 4) 全页截图（JPEG 高质量）
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, captureBeyondViewport: true });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(`已生成: ${OUT}`);

chrome.kill();
process.exit(0);
