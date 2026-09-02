/** 游客体验卷全链路验证（CDP）
    冷启动 → 题库tab → VIP弹窗关闭 → 停留题库页 → 游客体验卷卡 → 开始体验(15题) → 交卷
    → 总壳记 trialDone → 报告层 → 查看解析(未登录) → 弹登录(review) → 登录成功 → 回跳解析(ENTER_REVIEW)
    运行：node _cdp_trial_app.mjs */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const DEVTOOLS_PORT = 9381;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, p === '/' ? '/AI伴学_小程序.html' : p);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));
const DIR = `${ROOT}/.tmp-chromeT`;
await new Promise(r => { const rm = spawn('rm', ['-rf', DIR]); rm.on('exit', r); });
const chrome = spawn(CHROME, ['--remote-debugging-port=' + DEVTOOLS_PORT, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${DIR}`]);
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
      await send('Page.enable');
      return;
    } catch (e) { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error('connect fail');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('顶层异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
let failed = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (detail || ''))); if (!cond) failed++; }

/* 在总壳上下文钻入 iframe[name] 执行 */
function evalIn(name, expr) {
  return send('Runtime.evaluate', {
    expression: `(function(){ return document.getElementById('frame-${name}').contentWindow.eval(${JSON.stringify(expr)}); })()`,
    returnByValue: true, awaitPromise: true
  }).then(r => { if (r.exceptionDetails) throw new Error('iframe ' + name + ' 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; });
}

await connect();
await send('Page.navigate', { url: `http://localhost:${PORT}/AI伴学_小程序.html` });

/* 等待总壳 + 题库 iframe 就绪 */
let ready = false;
for (let i = 0; i < 40; i++) {
  ready = await evalJs(`(function(){ var f = document.getElementById('frame-quiz'); return !!(f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.getElementById('aiCard')); })()`);
  if (ready) break;
  await sleep(300);
}
check('总壳 + 题库 iframe 就绪', ready === true);

console.log('\n== A. 冷启动落题库tab + VIP弹窗 ==');
let r = await evalJs(`(function(){
  var active = document.querySelector('.tab-item.active');
  return { activeTab: active ? active.getAttribute('data-frame') : '',
    benefit: !!document.getElementById('benefitMask').classList.contains('show'),
    logged: STATE.logged, trialDone: STATE.trialDone };
})()`);
check('冷启动落题库tab', r.activeTab === 'quiz', r.activeTab);
check('VIP弹窗展示', r.benefit === true, r.benefit);
check('冷启动未登录', r.logged === false);
check('冷启动未体验', r.trialDone === false);

/* 题库页此刻应显示哪些卡？（VIP 弹窗盖着，但 aiCard 已渲染） */
r = await evalIn('quiz', `(function(){
  return { html: document.getElementById('aiCard').innerHTML.slice(0, 40), hasTrial: document.getElementById('aiCard').querySelector('.trial-card') !== null };
})()`);
check('游客未体验 → 题库渲染体验卷卡', r.hasTrial === true, r.html);

console.log('\n== B. 关闭VIP弹窗 → 停留题库页 ==');
await evalJs(`document.getElementById('benefitClose').click(); true`);
await sleep(200);
r = await evalJs(`(function(){
  return { activeTab: document.querySelector('.tab-item.active').getAttribute('data-frame'),
    benefit: document.getElementById('benefitMask').classList.contains('show'),
    trialDone: STATE.trialDone };
})()`);
check('关闭后停留题库页', r.activeTab === 'quiz', r.activeTab);
check('VIP弹窗已关闭', r.benefit === false);
check('未体验未标记', r.trialDone === false);

console.log('\n== C. 体验卷卡 CTA「开始体验」打开做题页(trial) ==');
r = await evalIn('quiz', `(function(){
  var btn = document.getElementById('aiCard').querySelector('.trial-cta');
  if (!btn) return { ok:false };
  var txt = btn.textContent;
  btn.onclick();
  return { ok:true, txt: txt };
})()`);
check('CTA 按钮存在', r.ok === true, JSON.stringify(r));
await sleep(1200);
r = await evalJs(`(function(){
  var p = document.getElementById('practiceLayer');
  var inner = document.getElementById('frame-practice');
  return { show: p.classList.contains('show'),
    url: inner.getAttribute('src') || (inner.contentWindow && inner.contentWindow.location.href) || '',
    title: document.getElementById('appbarTitle').textContent };
})()`);
check('做题层打开', r.show === true, r.title);
/* 做题页内部：entry=trial / 15题 / 考试模式 */
r = await evalIn('practice', `(function(){
  return { entry: ENTRY, isPaper: IS_PAPER,
    total: total, metaName: (PAPER_META || {}).name, metaMin: (PAPER_META || {}).minutes,
    metaScore: (PAPER_META || {}).fullScore, scoreSum: QUESTIONS.reduce(function(s,q){ return s + (q.score||0); }, 0) };
})()`);
check('做题页 entry=trial', r.entry === 'trial', r.entry);
check('体验卷考试模式', r.isPaper === true);
check('15 题', r.total === 15, r.total);
check('秒表=15分钟', r.metaMin === 15, r.metaMin);
check('满分=100', r.metaScore === 100, r.metaScore);
check('题目分值和=100', r.scoreSum === 100, r.scoreSum);

r = await evalIn('practice', `(function(){
  var cnt = { single:0, multi:0, judge:0, fill:0 };
  QUESTIONS.forEach(function(q){ cnt[q.type]++; });
  return cnt;
})()`);
check('题型配比 单选7/多选3/判断3/填空2', r.single === 7 && r.multi === 3 && r.judge === 3 && r.fill === 2, JSON.stringify(r));

console.log('\n== D. 作答后交卷 → 报告层 + 总壳记 trialDone ==');
/* 答完全部 15 题（按正确答案），交卷 */
await evalIn('practice', `(function(){
  for (var i = 0; i < QUESTIONS.length; i++) {
    var q = QUESTIONS[i];
    if (q.type === 'multi') answers[i] = q.answer.slice();
    else if (q.type === 'fill') answers[i] = String(q.fill);
    else answers[i] = q.answer;
  }
  doSubmit();   /* IS_PAPER → buildReport() → REQ_REPORT 上报总壳 */
  return true;
})()`);
await sleep(900);
r = await evalJs(`(function(){
  var rl = document.getElementById('reportLayer');
  return { show: rl.classList.contains('show'), trialDone: STATE.trialDone };
})()`);
check('报告层打开', r.show === true);
check('总壳已记体验完成(trialDone=true)', r.trialDone === true);
/* 持久化 key 应写入 */
r = await evalJs(`localStorage.getItem('zsb_trial_done_v1')`);
check('zsb_trial_done_v1=1 持久化', r === '1', r);

/* 报告页数据校验 */
r = await evalIn('report', `(function(){
  return { name: REPORT.name, type: REPORT.type, score: REPORT.score, full: REPORT.fullScore, label: REPORT.label, sheet: (REPORT.sheet||[]).length };
})()`);
check('报告=免费体验卷', r.name === '免费体验卷', r.name + '|' + r.type);
check('报告 type=trial', r.type === 'trial');
check('报告 15 答题卡', r.sheet === 15, r.sheet);
check('报告文字=本次体验卷得分', r.label === '本次体验卷', r.label);
check('交卷得分=100', r.score === 100, r.score);
check('报告满分=100', r.full === 100, r.full);

console.log('\n== E. 查看解析（未登录）→ 弹登录(review) ==');
let r2 = await evalIn('report', `(function(){
  window.parent.postMessage({ type:'REQ_LOGIN', data:{ from:'review', q:3 } }, '*');
  return true;
})()`);
await sleep(500);
r = await evalJs(`(function(){
  return { loginShow: document.getElementById('loginSheet').classList.contains('show'),
    pending: pendingReviewQ };
})()`);
check('报告页查解析 → 登录Sheet弹出', r.loginShow === true);
check('pendingReviewQ 记录待回跳q', r.pending && r.pending.waiting === true && r.pending.q === 3, JSON.stringify(r.pending));

console.log('\n== F. 登录成功(review来源) → 回跳解析(ENTER_REVIEW) ==');
await evalJs(`(function(){
  doWechatLogin('138****1234');
  return true;
})()`);
await sleep(1500);
r = await evalJs(`(function(){
  return { logged: STATE.logged, loginShow: document.getElementById('loginSheet').classList.contains('show'),
    pendingWait: pendingReviewQ.waiting,
    practiceShow: document.getElementById('practiceLayer').classList.contains('show'),
    reportShow: document.getElementById('reportLayer').classList.contains('show') };
})()`);
check('登录成功(logged)', r.logged === true);
check('登录Sheet闭合', r.loginShow === false);
check('pendingReviewQ 已消费', r.pendingWait === false);
check('做题页(解析)已打开', r.practiceShow === true);
check('报告层已关闭（兑现回跳）', r.reportShow === false);
r = await evalIn('practice', `(function(){
  return { submitted: submitted, idx: idx, total: total };
})()`);
check('做题页进入解析态', r.submitted === true);
check('定位待回跳原题(第4题)', r.idx === 3, r.idx);

console.log('\n== G. 游客体验卷卡已撤（登录后无体验卷入口） ==');
r = await evalIn('quiz', `(function(){
  var card = document.getElementById('aiCard');
  var cta = card.querySelector('.start-btn');
  return { hasTrial: card.querySelector('.trial-card') !== null,
    hasAi: card.querySelector('.ai-task-title') !== null,
    ctaText: cta ? cta.textContent.replace(/\\s+/g,' ').trim() : '',
    noProfileCard: card.querySelector('.ai-empty-title') === null,   /* 2026-09-02：登录后不再有「完善资料」卡 */
    trialCardClass: card.className };
})()`);
check('已登录不再显示体验卷卡', r.hasTrial === false, r.hasTrial);
check('恢复 AI 今日任务卡', r.hasAi === true);
check('登录后直接显示「开始今日学习」(无完善资料卡)', r.noProfileCard === true && r.ctaText === '开始今日学习', r.ctaText);

/* ===== 单开：游客已体验 → 正式入口弹登录 ===== */
console.log('\n== H. 刷新后游客已体验 → 正式入口弹登录 ==');
await send('Page.navigate', { url: `http://localhost:${PORT}/AI伴学_小程序.html` });
for (let i = 0; i < 40; i++) {
  ready = await evalJs(`(function(){ var f = document.getElementById('frame-quiz'); return !!(f && f.contentWindow && f.contentWindow.document.getElementById('aiCard')); })()`);
  if (ready) break;
  await sleep(300);
}
/* 冷启动重置登录（refresh 全重置）→ 游客 + 已体验（zsb_trial_done_v1 持久保留） */
r = await evalJs(`(function(){
  var f = document.getElementById('frame-quiz');
  var q = f.contentWindow;
  return { logged: q.isGuest(), trialDone: q.trialExperienced(),
    trialCard: !!q.document.getElementById('aiCard').querySelector('.trial-card') };
})()`);
check('刷新后仍是游客（未登录）', r.logged === true);
check('刷新后已体验标记保留(trialDone)', r.trialDone === true);
check('游客已体验 → 无体验卷卡', r.trialCard === false);
/* 点正式入口章节 → 弹登录 */
await evalIn('quiz', `(function(){ var b = document.querySelector('.entry-card'); b.onclick(); return true; })()`);
await sleep(400);
r = await evalJs(`(function(){
  return { loginShow: document.getElementById('loginSheet').classList.contains('show'),
    stillQuiz: document.querySelector('.tab-item.active').getAttribute('data-frame') };
})()`);
check('章节刷题入口（游客已体验）→ 弹登录', r.loginShow === true, r.loginShow);
check('停留题库页', r.stillQuiz === 'quiz', r.stillQuiz);

console.log('\n== I. 分支②：未登录领取VIP → 登录成功停留题库页 ==');
await send('Page.navigate', { url: `http://localhost:${PORT}/AI伴学_小程序.html` });
for (let i = 0; i < 40; i++) {
  ready = await evalJs(`(function(){ var f = document.getElementById('frame-quiz'); return !!(f && f.contentWindow && f.contentWindow.document.getElementById('aiCard')); })()`);
  if (ready) break;
  await sleep(300);
}
await evalJs(`(function(){
  document.getElementById('benefitCta').click();   /* 领取专属权益 → 未登录弹登录Sheet */
  return true;
})()`);
await sleep(500);
r = await evalJs(`(function(){
  return { loginShow: document.getElementById('loginSheet').classList.contains('show'),
    benefitCard: document.getElementById('benefitMask').classList.contains('show') };
})()`);
check('领取 → 登录Sheet弹出', r.loginShow === true);
check('VIP卡已隐藏', r.benefitCard === false);
/* 登录成功 → VIP 到账 + 停留题库页 */
await evalJs(`(function(){ doWechatLogin('139****5678'); return true; })()`);
await sleep(500);
r = await evalJs(`(function(){
  return { logged: STATE.logged, vip: STATE.vipClaimed,
    stillQuiz: document.querySelector('.tab-item.active').getAttribute('data-frame'),
    benefit: document.getElementById('benefitMask').classList.contains('show') };
})()`);
check('登录成功', r.logged === true);
check('VIP权益到账', r.vip === true);
check('停留题库页（不再跳学习页）', r.stillQuiz === 'quiz', r.stillQuiz);
check('VIP弹窗已关闭', r.benefit === false);
check('持久化 zsb_vip_claimed_v1=1', (await evalJs(`localStorage.getItem('zsb_vip_claimed_v1')`)) === '1');

console.log('\n== J. 已登录 + 已体验 → 正式入口完整（体验卷入口不出现） ==');
/* I 已登录成功（STATE.logged=true）；当前游客体验卷已隐藏（已体验）→ 确认作业页完整、无体验卷卡 */
r = await evalIn('quiz', `(function(){
  return { trialCard: !!document.getElementById('aiCard').querySelector('.trial-card'),
    entry: !!document.querySelector('.entry-grid'),
    ai: !!document.getElementById('aiCard').querySelector('.ai-task-title') };
})()`);
check('已登录+已体验 → 体验卷卡隐藏', r.trialCard === false);
check('正式入口完整', r.entry === true);
check('恢复AI今日任务卡', r.ai === true);

server.close();
chrome.kill();
console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ ALL PASS');
process.exit(failed ? 1 : 0);