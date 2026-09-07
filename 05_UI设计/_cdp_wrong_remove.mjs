/** 错题本做题页「移出」按钮 L2 冒烟（PM 2026-09-07）：
 *  1 底部按钮顺序 收藏|标记|移出|分享，且仅 entry=wrong 可见（today/chapter 隐藏）
 *  2 点击移出 → 队列少 1、localStorage 记录 qid、题目跳下一题
 *  3 刷新重进 entry=wrong → 被移出题不再出现
 *  4 错题本页预置 removed（W01+U01）→ 章节题/上传题消失且统计卡/筛选计数正确
 *  5 移出后今日/章节入口题量仍正常（不读该 key）
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const DEVTOOLS_PORT = 9377;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, p === '/' ? 'AI伴学_小程序.html' : p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[(file.match(/\.\w+$/)?.[0] || '')] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

const rm = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeWR`]);
await new Promise(r => rm.on('exit', r));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${DEVTOOLS_PORT}`, '--headless=new', '--disable-gpu',
  '--no-first-run', '--no-default-browser-check', `--user-data-dir=${ROOT}/.tmp-chromeWR`,
  `http://localhost:${PORT}/做题页.html?entry=wrong`
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(2000);

let ws; const pending = new Map(); let msgId = 0;
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++msgId; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
}
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(`http://localhost:${DEVTOOLS_PORT}/json`);
    const page = (await r.json()).find(p => p.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = evt => {
      const m = JSON.parse(evt.data);
      if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
    };
    break;
  } catch (e) { await sleep(300); }
}
await send('Page.enable');

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const nav = async (path) => { await send('Page.navigate', { url: `http://localhost:${PORT}/${path}` }); await sleep(1300); };

let failed = 0;
function check(name, cond, detail = '') { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + detail)); if (!cond) failed++; }

try {
  /* 干净起点 */
  await nav('做题页.html?entry=wrong');
  await evalJs(`localStorage.clear(); 'ok'`);

  /* ===== 1. 底部按钮顺序 & 仅 wrong 入口可见 ===== */
  await nav('做题页.html?entry=wrong');
  const btnInfo = await evalJs(`(function(){
    var ids = Array.prototype.map.call(document.querySelectorAll('#bottomBar .tool-btn'), function(b){ return b.id; });
    var rm = document.getElementById('btnRemove');
    var rmLabel = rm ? rm.querySelector('.lbl') : null;
    return JSON.stringify({ ids: ids, rmDisplay: rm ? getComputedStyle(rm).display : 'missing', rmText: rmLabel ? rmLabel.textContent.trim() : '' });
  })()`);
  const bi = JSON.parse(btnInfo);
  check('1a 底部按钮顺序=收藏|标记|移出|分享', JSON.stringify(bi.ids) === JSON.stringify(['btnFav','btnMark','btnRemove','btnShare']), btnInfo);
  check('1b 移出按钮 wrong 入口可见', bi.rmDisplay !== 'none', btnInfo);
  check('1c 移出按钮文案=移出', bi.rmText === '移出', bi.rmText);

  await nav('做题页.html?entry=today');
  const todayHide = await evalJs(`getComputedStyle(document.getElementById('btnRemove')).display`);
  check('1d 今日入口移出按钮隐藏', todayHide === 'none', todayHide);

  await nav('做题页.html?entry=chapter');
  const chapterHide = await evalJs(`getComputedStyle(document.getElementById('btnRemove')).display`);
  check('1e 章节入口移出按钮隐藏', chapterHide === 'none', chapterHide);

  /* ===== 2. 点击移出 ===== */
  await nav('做题页.html?entry=wrong');
  const before = await evalJs(`(function(){ return JSON.stringify({ total: total, qid0: QUESTIONS[0].qid, removed: JSON.parse(localStorage.getItem('zsb_wrong_removed_v1')||'[]') }); })()`);
  const b = JSON.parse(before);
  check('2a 初始错题队列=6且首题W01', b.total === 6 && b.qid0 === 'W01', before);
  await evalJs(`moveOutFromWrong(); 'ok'`);
  await sleep(150);
  const after = await evalJs(`(function(){ return JSON.stringify({ total: total, qid0: QUESTIONS[0].qid, idx: idx, removed: JSON.parse(localStorage.getItem('zsb_wrong_removed_v1')||'[]') }); })()`);
  const a = JSON.parse(after);
  check('2b 移出后队列少1', a.total === 5, after);
  check('2c localStorage 记录 W01', a.removed.indexOf('W01') >= 0, after);
  check('2d 题目跳下一题(W02)', a.qid0 === 'W02' && a.idx === 0, after);

  /* ===== 3. 刷新重进该入口该题不再出现 ===== */
  await nav('做题页.html?entry=wrong');
  const reload = await evalJs(`(function(){ return JSON.stringify({ total: total, qids: QUESTIONS.map(function(q){ return q.qid; }) }); })()`);
  const rl = JSON.parse(reload);
  check('3 刷新后 W01 不再出现', rl.total === 5 && rl.qids.indexOf('W01') < 0, reload);

  /* ===== 4. 错题本页预置 removed → 章节题/上传题消失且计数正确 ===== */
  await evalJs(`localStorage.setItem('zsb_wrong_removed_v1', JSON.stringify(['W01','U01'])); 'ok'`);
  await nav('错题本.html');
  const wb = await evalJs(`(function(){
    var html = document.getElementById('list').innerHTML;
    return JSON.stringify({
      total: WRONG_DATA.stats.total, pending: WRONG_DATA.stats.pending, solved: WRONG_DATA.stats.solved, stubborn: WRONG_DATA.stats.stubborn,
      allLen: allQuestions().length,
      hasW01: html.indexOf('操作系统的作用不包括') >= 0,
      hasU01: html.indexOf('【草稿】下列中断类型') >= 0,
      cntUpload: document.getElementById('cntUpload').textContent,
      cntPending: document.getElementById('cntPending').textContent,
      cntSolved: document.getElementById('cntSolved').textContent,
      cntStubborn: document.getElementById('cntStubborn').textContent
    });
  })()`);
  const w = JSON.parse(wb);
  check('4a 章节题 W01 剔除', w.hasW01 === false, wb);
  check('4b 上传题 U01 剔除', w.hasU01 === false, wb);
  check('4c 统计卡 total=6/pending=4/solved=2/stubborn=1', w.total === 6 && w.pending === 4 && w.solved === 2 && w.stubborn === 1, wb);
  check('4d allQuestions=6', w.allLen === 6, wb);
  check('4e 上传计数=(1)', w.cntUpload === '(1)', w.cntUpload);
  check('4f 待攻克计数=(4)', w.cntPending === '(4)', w.cntPending);

  /* ===== 5. 移出后今日/章节入口题量仍正常 ===== */
  await nav('做题页.html?entry=today');
  const t5 = await evalJs(`total`);
  check('5a 今日入口仍 5 题', t5 === 5, String(t5));
  await nav('做题页.html?entry=chapter');
  const c5 = await evalJs(`total`);
  check('5b 章节入口仍 3 题', c5 === 3, String(c5));

  console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
} catch (e) {
  console.error('测试中断:', e.message);
  failed++;
} finally {
  try { ws.close(); } catch {}
  chrome.kill();
  server.close();
  const rm2 = spawn('rm', ['-rf', `${ROOT}/.tmp-chromeWR`]);
  rm2.on('exit', () => process.exit(failed === 0 ? 0 : 1));
}
