/** 章节刷题 · 四类行右侧标签统一 + 两行布局 + 顽固示例验证（PM 2026-09-07）：
 *   1级 考点n·✔a·✖b+进度条；2级 考点n·✔a·✖b；3级 考点n·✔a·✖b(顽固布尔标)；
 *   4级 ✔a·✖b；未做灰态；无旧文案(正确率/已做/N题·未做)；对错用✔✖不用文字
 *   2/3/4级行两行布局：标题一行(不截断)+meta 下一行小字；4 个 3级顽固示例默认可见
 *   求和一致性：章=节=三级=四级 递归核对 total/done/right/wrong
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

/* T1 1级章头：考点29 · ✔63 · ✖37 + 进度条83%，无旧文案（PM 2026-09-07：数据调整后新值） */
let r = await evalJs(`(function(){
  var m = document.querySelector('.ch-metrics');
  var t = window.__N(m.textContent);
  var bar = document.querySelector('.ch-progress .ch-progress-inner');
  return { t: t, hasPt: t === '考点29✔63✖37',
    noOld: !/正确率|已做/.test(document.getElementById('lvContent').textContent), barW: bar ? bar.style.width : '',
    okCol: m.querySelector('.m-ok') ? getComputedStyle(m.querySelector('.m-ok')).color : '',
    noCol: m.querySelector('.m-no') ? getComputedStyle(m.querySelector('.m-no')).color : '',
    ptCol: m.querySelector('.pt b') ? getComputedStyle(m.querySelector('.pt b')).color : '' };
})()`);
check('T1 章头含 考点29/✔63/✖37', r.hasPt, r.t);
check('T1 无 正确率/已做 旧文案', r.noOld, '');
check('T1 章进度条=答题进度83%', r.barW === '83%', r.barW);
check('T1 ✔绿/✖红/考点数主题蓝', r.okCol === 'rgb(32, 168, 102)' && r.noCol === 'rgb(239, 68, 68)' && r.ptCol === 'rgb(91, 114, 245)', r.okCol + ' / ' + r.noCol + ' / ' + r.ptCol);

/* T2 2级节行 meta */
r = await evalJs(`(function(){
  var rows = [].slice.call(document.querySelectorAll('.sub-row'));
  return rows.slice(0, 2).map(function(sr){ var x = sr.querySelector('.sub-rate'); return x ? window.__N(x.textContent) : ''; });
})()`);
check('T2 二级行 meta=考点7✔11✖9', r[0] === '考点7✔11✖9', r.join(' | '));
check('T2 二级行 meta=考点6✔17✖7', r[1] === '考点6✔17✖7', r.join(' | '));

/* T3 3级行 meta + 顽固示例：第1个3级无顽固，第2个3级有顽固（数据内置） */
r = await evalJs(`(function(){
  document.querySelector('.sub-row .sub-arrow').click();
  var root = document.querySelector('.sub-row.open + .lv3-root');
  var rows = root ? [].slice.call(root.querySelectorAll('.lv3-row')) : [];
  return rows.slice(0, 2).map(function(row){
    var meta = row.querySelector('.lv3-meta');
    return { m: meta ? window.__N(meta.textContent) : '', stub: !!meta.querySelector('.m-stubborn') };
  });
})()`);
check('T3 三级1(信息与数据) meta=考点3✔6✖1 无顽固', r[0].m === '考点3✔6✖1' && r[0].stub === false, r[0].m);
check('T3 三级2(信息技术与计算机文化) meta=考点4✔5✖8 有顽固', r[1].m === '考点4✔5✖8顽固' && r[1].stub === true, r[1].m);

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

/* T6 两行布局：meta 位于标题下一行、标题非 nowrap（2/3/4级） */
r = await evalJs(`(function(){
  function probe(sel){
    var row = document.querySelector(sel);
    if(!row) return null;
    var title = row.querySelector('.sub-title, .lv3-title, .lv4-title');
    var meta = row.querySelector('.sub-rate, .lv3-meta, .lv4-meta');
    var text = row.querySelector('.sub-text, .lv3-text, .lv4-text');
    if(!title || !meta) return null;
    var titleStyle = getComputedStyle(title);
    var metaStyle = getComputedStyle(meta);
    /* 标题与 meta 同处一个纵向 flex 容器（meta 在标题下方） */
    var sameCol = text && text.contains(title) && text.contains(meta);
    var titleRect = title.getBoundingClientRect();
    var metaRect = meta.getBoundingClientRect();
    /* meta 顶 > 标题底 → meta 在标题下一行 */
    var metaBelow = metaRect.top >= titleRect.bottom - 1;
    /* 标题不截断：无 nowrap/overflow/ellipsis */
    var noTruncate = titleStyle.whiteSpace !== 'nowrap';
    return { sameCol: sameCol, metaBelow: metaBelow, noTruncate: noTruncate, ws: titleStyle.whiteSpace };
  }
  document.querySelector('.sub-row .sub-arrow').click();
  return { lv2: probe('.sub-row'), lv3: probe('.lv3-row'), lv4: probe('.lv4-row') };
})()`);
check('T6 二级 meta 在标题下一行+标题不截断', r.lv2 && r.lv2.metaBelow && r.lv2.noTruncate, r.lv2 ? JSON.stringify(r.lv2) : 'null');
check('T6 三级 meta 在标题下一行+标题不截断', r.lv3 && r.lv3.metaBelow && r.lv3.noTruncate, r.lv3 ? JSON.stringify(r.lv3) : 'null');
check('T6 四级 meta 在标题下一行+标题不截断', r.lv4 && r.lv4.metaBelow && r.lv4.noTruncate, r.lv4 ? JSON.stringify(r.lv4) : 'null');

/* T7 4 个 3级顽固示例：默认第1章 2 个 + Word 1 个 + 网络 1 个（演示数据内置） */
r = await evalJs(`(function(){
  function stubList(chIdx){
    var ch = CHAPTERS[chIdx];
    if(!ch) return [];
    var out = [];
    ch.subs.forEach(function(sub){
      (sub.level3||[]).forEach(function(l3){
        if(l3.done>0 && l3.total>0 && l3.wrong/l3.total>=0.5){
          out.push(sub.name + '/' + l3.name + '(' + l3.wrong + '/' + l3.total + ')');
        }
      });
    });
    return out;
  }
  return { ch1: stubList(0), ch4: stubList(3), ch8: stubList(7) };
})()`);
check('T7 第1章 2 个顽固示例(信息技术与计算机文化/软件系统)', r.ch1.length === 2, r.ch1.join(';'));
check('T7 第4章 1 个顽固示例(文档基本操作)', r.ch4.length === 1, r.ch4.join(';'));
check('T7 第8章 1 个顽固示例(网络概述)', r.ch8.length === 1, r.ch8.join(';'));

/* T8 求和一致性：章=节=三级=四级 递归核对 total/done/right/wrong */
r = await evalJs(`(function(){
  var errs = [];
  function chk(node, label){
    if(node.done !== node.right + node.wrong) errs.push(label + ' done!=right+wrong');
    var kids = node.level3 || node.subs || null;
    if(node.level4){
      var s4 = {total:0,done:0,right:0,wrong:0};
      node.level4.forEach(function(x){ ['total','done','right','wrong'].forEach(function(k){ s4[k]+=x[k]; }); });
      ['total','done','right','wrong'].forEach(function(k){ if(node[k]!==s4[k]) errs.push(label+' '+k+':'+node[k]+'vs'+s4[k]); });
    }
    if(node.level3){
      var s3 = {total:0,done:0,right:0,wrong:0};
      node.level3.forEach(function(x){ s3.total+=x.total;s3.done+=x.done;s3.right+=x.right;s3.wrong+=x.wrong; });
      ['total','done','right','wrong'].forEach(function(k){ if(node[k]!==s3[k]) errs.push(label+' '+k+':'+node[k]+'vs'+s3[k]); });
      node.level3.forEach(function(x,i){ chk(x, label+'.l3['+i+']'); });
    }
    if(node.subs){
      var s2 = {total:0,done:0,right:0,wrong:0};
      node.subs.forEach(function(x){ s2.total+=x.total;s2.done+=x.done;s2.right+=x.right;s2.wrong+=x.wrong; });
      ['total','done','right','wrong'].forEach(function(k){ if(node[k]!==s2[k]) errs.push(label+' '+k+':'+node[k]+'vs'+s2[k]); });
      node.subs.forEach(function(x,i){ chk(x, label+'.sub['+i+']'); });
    }
  }
  CHAPTERS.forEach(function(ch,i){ chk(ch, 'ch['+i+']'); });
  return errs;
})()`);
check('T8 求和一致性 章=节=三级=四级', r.length === 0, r.join('; '));

console.log('');
console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILED');
chrome.kill(); server.close(); process.exit(failed === 0 ? 0 : 1);
