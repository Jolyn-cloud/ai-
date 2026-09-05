/** 收藏本首页三级树验证（PM 2026-09-05）：
 *  1 默认：一级+二级展示，三级收起
 *  2 点二级展开按钮 → 展示三级
 *  3 再次点 → 收起
 *  4 题数联动（切来源 Tab）
 *  5 点击一级/二级名/三级 → REQ_PRACTICE scope=chap/sub/point
 *  6 空状态
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8779;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVTOOLS_PORT = 9353;
const MIME = { '.html': 'text/html', '.js': 'application/javascript' };
const server = createServer((req, res) => {
  const path = req.url.split('?')[0] === '/' ? '/收藏本.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[`${file.match(/\.\w+$/)?.[0] || ''}`] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
await new Promise(r => { const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeFav`]); rm.on('exit', r); });
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeFav`,
  `http://localhost:${PORT}/收藏本.html`
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);

let ws; const pending = new Map(); let msgId = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
    const page = (await res.json()).find(p => p.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = evt => { const m = JSON.parse(evt.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
    break;
  } catch (e) { await sleep(300); }
}

const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
const check = (name, cond, got) => console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ` (got: ${got})`}`);

/* 先注入 postMessage 监听 */
await evalJS(`
  window.__testMsg = 'none';
  window.addEventListener('message', e => { if (e.data && e.data.type === 'REQ_PRACTICE') window.__testMsg = JSON.stringify(e.data.data); });
`);

console.log('\n=== 测试1：默认状态（一级+二级展示，三级收起）===');
const l1Count = await evalJS(`document.querySelectorAll('.l1-group').length`);
const l2Count = await evalJS(`document.querySelectorAll('.l2-group').length`);
const l3Visible = await evalJS(`document.querySelectorAll('.l2-group.open .l3-row').length`);
check('一级4个', l1Count === 4, l1Count);
check('二级8个', l2Count === 8, l2Count);
check('三级默认收起(0可见)', l3Visible === 0, l3Visible);

console.log('=== 测试2：点二级展开按钮 → 展示三级 ===');
await evalJS(`document.querySelectorAll('.l2-toggle')[0].click()`);
await sleep(200);
const l3AfterOpen = await evalJS(`document.querySelectorAll('.l2-group.open .l3-row').length`);
const firstL2Name = await evalJS(`document.querySelectorAll('.l2-name')[0].textContent`);
check('展开后三级行数>0', l3AfterOpen > 0, l3AfterOpen);
console.log(`  首个二级: ${firstL2Name}`);

console.log('=== 测试3：再次点 → 收起 ===');
await evalJS(`document.querySelectorAll('.l2-toggle')[0].click()`);
await sleep(200);
const l3AfterClose = await evalJS(`document.querySelectorAll('.l2-group.open .l3-row').length`);
check('收起后三级行数=0', l3AfterClose === 0, l3AfterClose);

console.log('=== 测试4：题数联动（切来源 Tab）===');
const l1Before = await evalJS(`document.querySelector('.l1-count')?.textContent`);
await evalJS(`document.querySelectorAll('.src-tab')[1].click()`); /* 章节刷题 */
await sleep(200);
const l1After = await evalJS(`document.querySelector('.l1-count')?.textContent`);
check('切来源后题数变化', l1Before !== l1After, `${l1Before}→${l1After}`);

console.log('=== 测试5：点击一级 → scope=chap ===');
await evalJS(`document.querySelectorAll('.src-tab')[0].click()`); /* 回全部 */
await sleep(150);
await evalJS(`window.__testMsg = 'none'`);
await evalJS(`document.querySelectorAll('.l1-row')[0].click()`);
await sleep(300);
const msg2 = await evalJS(`window.__testMsg`);
check('scope=chap', msg2.includes('"scope":"chap"'), msg2);

console.log('=== 测试5b：点击二级章节名 → scope=sub ===');
await evalJS(`window.__testMsg = 'none'`);
await evalJS(`document.querySelectorAll('.l2-name')[0].click()`);
await sleep(300);
const msg3 = await evalJS(`window.__testMsg`);
check('scope=sub', msg3.includes('"scope":"sub"'), msg3);

console.log('=== 测试5c：点击三级 → scope=point ===');
await evalJS(`document.querySelectorAll('.l2-toggle')[0].click()`);
await sleep(200);
await evalJS(`window.__testMsg = 'none'`);
await evalJS(`document.querySelectorAll('.l3-row')[0].click()`);
await sleep(300);
const msg1 = await evalJS(`window.__testMsg`);
check('scope=point', msg1.includes('"scope":"point"'), msg1);

console.log('=== 测试6：空状态 ===');
await evalJS(`items.length = 0; renderList();`);
await sleep(200);
const emptyShown = await evalJS(`document.getElementById('empty').style.display`);
check('空状态显示', emptyShown === 'flex', emptyShown);

console.log('\n=== 全部测试完成 ===');
ws.close(); chrome.kill(); server.close();
const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeFav`]);
rm.on('exit', () => process.exit(0));
