/* Generated from src; do not edit. */
'use strict';
const { Plugin, Modal, Notice, MarkdownRenderer, MarkdownView, finishRenderMath, renderMath } = require('obsidian');

// Match Obsidian's fill-slot geometry (min 3em, intrinsic answer width),
// without copying the answer into student preview/PDF/HTML markup.
// This transient off-screen probe is removed immediately after measurement.
const mwbFillWidthCache = new Map();
function mwbFillWidthEm(answer, isMath) {
  const raw = String(answer);
  const key = (isMath ? 'm:' : 't:') + raw;
  if (mwbFillWidthCache.has(key)) return mwbFillWidthCache.get(key);
  // Conservative fallback for non-DOM tests and unsupported MathJax expressions.
  // The DOM path below is authoritative in Obsidian's desktop renderer.
  const fullWidth = [...raw].reduce((sum, c) => sum +
    (/[\\\[\]{}^_$]/.test(c) ? 0.1 : /[\u2e80-\uffff]/.test(c) ? 1 : 0.65), 0);
  let em = Math.max(3, fullWidth + 0.36);
  let probe;
  try {
    if (typeof document !== 'undefined' && document.body?.appendChild) {
      probe = document.createElement('span');
      probe.className = 'mwb-typography mwb-print-document';
      probe.style.cssText = 'position:fixed;left:-10000px;top:0;display:inline-block;visibility:hidden;white-space:nowrap;pointer-events:none;';
      const content = document.createElement('span');
      content.style.cssText = 'display:inline-block;white-space:nowrap;font-weight:400;';
      if (isMath) {
        const rendered = renderMath(raw, false);
        content.appendChild(rendered);
      } else {
        content.textContent = raw;
      }
      probe.appendChild(content);
      document.body.appendChild(probe);
      const fontSize = parseFloat(getComputedStyle(probe).fontSize) || 14.6667;
      const box = content.getBoundingClientRect();
      if (box.width > 0 && Number.isFinite(box.width)) {
        // Reading View uses 3em minimum including 0.36em horizontal padding.
        em = Math.max(3, box.width / fontSize + 0.36);
      }
    }
  } catch (_) {
    // An invalid expression must remain subject to normal MathJax diagnostics;
    // answer width estimation itself should not suppress ordinary text output.
  } finally {
    if (probe?.parentNode) probe.remove();
  }
  em = Math.round(em * 100) / 100;
  if (mwbFillWidthCache.size > 1600) mwbFillWidthCache.clear();
  mwbFillWidthCache.set(key, em);
  return em;
}
function mwbStudentFillSpan(answer, isMath) {
  const width = mwbFillWidthEm(answer, isMath);
  const cls = isMath ? 'mwb-answer-slot mwb-answer-slot-math' : 'mwb-answer-slot';
  return `<span class="${cls}" style="width:${width}em" aria-label="填写答案"></span>`;
}
const mwbMathBlankCache = new Map();
function mwbMathBlankWidthEm(tex) {
  let probe;
  try {
    if (typeof document === 'undefined' || !document.body?.appendChild) return NaN;
    probe = document.createElement('span');
    probe.className = 'mwb-typography mwb-print-document';
    probe.style.cssText = 'position:fixed;left:-10000px;top:0;display:inline-block;visibility:hidden;white-space:nowrap;pointer-events:none;';
    probe.appendChild(renderMath(tex, false));
    document.body.appendChild(probe);
    const fontSize = parseFloat(getComputedStyle(probe).fontSize) || 14.6667;
    const width = probe.getBoundingClientRect().width;
    return width > 0 ? width / fontSize : NaN;
  } catch (_) {
    return NaN;
  } finally {
    if (probe?.parentNode) probe.remove();
  }
}
function mwbStudentMathFill(answer) {
  // TeX syntax is required here: this slot is inside an existing $...$.
  // Do not embed the solution or a second math delimiter in the student TeX.
  const key = String(answer);
  if (mwbMathBlankCache.has(key)) return mwbMathBlankCache.get(key);
  const targetEm = mwbFillWidthEm(answer, true);
  let gapEm = Math.max(0.5, targetEm - 0.36);
  const texGap = x => `\\underline{\\hspace{${x.toFixed(3)}em}}`;
  // Calibrate MathJax's underline/hspace extra width to the same 3em-minimum
  // reading-view slot; its box model differs from an HTML span by several px.
  const measuredEm = mwbMathBlankWidthEm(texGap(gapEm));
  if (Number.isFinite(measuredEm)) gapEm = Math.max(0.5, gapEm - (measuredEm - targetEm));
  const result = texGap(gapEm);
  if (mwbMathBlankCache.size > 1600) mwbMathBlankCache.clear();
  mwbMathBlankCache.set(key, result);
  return result;
}

// Explicit answer-slot tokenizer. Obsidian's ==highlight== is untouched.
function mwbScanTypedLine(line,displayMath=false){
  const slots=[];let code=0,inlineMath=false;
  for(let i=0;i<line.length;){
    if(line[i]==='\\'&&i+1<line.length){i+=2;continue;}
    if(line[i]==='\x60'){
      let n=1;while(line[i+n]==='\x60')n++;
      if(!code)code=n;else if(code===n)code=0;
      i+=n;continue;
    }
    if(code){i++;continue;}
    if(line.startsWith('$$',i)){displayMath=!displayMath;i+=2;continue;}
    if(line[i]==='$'&&!displayMath){inlineMath=!inlineMath;i++;continue;}
    if((line[i]==='?'||line[i]==='!')&&line[i+1]==='{'){
      const kind=line[i]==='?'?'fill':'choice';
      let depth=1,j=i+2;
      for(;j<line.length;j++){
        if(line[j]==='\\'&&j+1<line.length){j++;continue;}
        if(line[j]==='{')depth++;
        else if(line[j]==='}'&&--depth===0)break;
      }
      if(depth!==0){slots.push({from:i,to:line.length,kind,invalid:'答案槽花括号未闭合'});break;}
      const raw=line.slice(i+2,j);
      const stand=!inlineMath&&!displayMath ? /^\$([^$\n]+)\$$/.exec(raw) : null;
      slots.push({from:i,to:j+1,kind,raw,inMath:inlineMath||displayMath,
        ...(stand?{latex:stand[1]}:{}),
        ...(!raw.trim()?{invalid:'答案不能为空'}:{})});
      i=j+1;continue;
    }
    i++;
  }
  return {slots,displayMath};
}
function mwbTypedSlots(markdown){
  const lines=String(markdown).replace(/\r\n?/g,'\n').split('\n'),slots=[];
  let yaml=lines[0]?.replace(/^\uFEFF/,'').trim()==='---',fence=null,displayMath=false,pos=0,solution=false;
  for(let n=0;n<lines.length;n++){
    const line=lines[n];
    if(yaml){if(n>0&&/^(?:---|\.\.\.)\s*$/.test(line))yaml=false;pos+=line.length+1;continue;}
    const f=line.match(/^\s{0,3}(\x60{3,}|~{3,})/);
    if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length)fence=null;pos+=line.length+1;continue;}
    if(fence){pos+=line.length+1;continue;}
    if(/^\s*>\s*\[!(?:answer|solution|success|info)\]/i.test(line))solution=true;
    else if(!/^\s*>/.test(line))solution=false;
    const scan=mwbScanTypedLine(line,displayMath);displayMath=scan.displayMath;
    if(!solution&&!/^\s{4,}\S/.test(line))
      for(const slot of scan.slots)if(!slot.invalid)slots.push({...slot,from:pos+slot.from,to:pos+slot.to,choice:slot.kind==='choice'});
    pos+=line.length+1;
  }
  return slots;
}
function mwbTypedFormat(slot,mode){
  const answer=slot.raw;
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  if(slot.kind==='choice'){
    if(mode==='student')return slot.inMath?'\\hspace{1.4em}':'<span class="mwb-choice-slot" aria-label="选择题答案留空">&nbsp;&nbsp;</span>';
    if(slot.inMath)return '\\color{red}{'+answer+'}';
    if(slot.latex!==undefined)return '$\\color{red}{'+slot.latex+'}$';
    return '<span class="mwb-answer-revealed">'+esc(answer)+'</span>';
  }
  if(slot.inMath)return mode==='student'?mwbStudentMathFill(answer):'\\underline{\\color{red}{'+answer+'}}';
  if(slot.latex!==undefined)return mode==='student'?mwbStudentFillSpan(slot.latex,true):'$\\underline{\\color{red}{'+slot.latex+'}}$';
  return mode==='student'?mwbStudentFillSpan(answer,false):
    '<span class="mwb-teacher-fill-slot" aria-label="填空题参考答案">'+esc(answer)+'</span>';
}
function mwbRewriteTypedAnswers(source,mode){
  const out=[];let fence=null,displayMath=false;
  for(const line of String(source).split('\n')){
    const f=line.match(/^\s{0,3}(\x60{3,}|~{3,})/);
    if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length)fence=null;out.push(line);continue;}
    if(fence){out.push(line);continue;}
    const scan=mwbScanTypedLine(line,displayMath);displayMath=scan.displayMath;
    let output='',cursor=0;
    for(const slot of scan.slots){
      if(slot.invalid)throw new Error('答案槽解析失败：'+slot.invalid);
      output+=line.slice(cursor,slot.from)+mwbTypedFormat(slot,mode);cursor=slot.to;
    }
    out.push(output+line.slice(cursor));
  }
  return out.join('\n');
}
function mwbValidateTypedAnswers(markdown){
  const source=String(markdown),issues=[];
  for(const c of new Set([...source.matchAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g)].map(m=>m[0])))
    issues.push('正文包含不可见控制字符 U+'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
  const lines=source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  let yaml=lines[0]?.trim()==='---',fence=null,displayMath=false;
  for(let n=0;n<lines.length;n++){
    const line=lines[n];
    if(yaml){if(n>0&&/^(?:---|\.\.\.)\s*$/.test(line))yaml=false;continue;}
    const f=line.match(/^\s{0,3}(\x60{3,}|~{3,})/);
    if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length)fence=null;continue;}
    if(fence)continue;
    const scan=mwbScanTypedLine(line,displayMath);displayMath=scan.displayMath;
    for(const slot of scan.slots)if(slot.invalid)issues.push('第 '+(n+1)+' 行：'+slot.invalid);
  }
  return [...new Set(issues)];
}
// Reading View retains MathJax DOM, and replaces only visible typed markers.
// DOM replacement never mutates a source note or the student's exported HTML.
function mwbDecorateReadingTypedSlots(element,source){
  const expected=mwbTypedSlots(source);
  if(!expected.length||!element?.ownerDocument)return 0;
  // Obsidian removes Markdown escape backslashes; avoid ambiguous mixed cases.
  if(/\\[?!]\{/.test(source))return 0;
  const doc=element.ownerDocument,blocks=[...element.querySelectorAll('p,li,td,th,h1,h2,h3,h4')];let count=0;
  for(const block of blocks){
    const walker=doc.createTreeWalker(block,4),nodes=[];let node;
    while((node=walker.nextNode())){
      if(node.parentElement?.closest('code,pre,script,style,.math-inline,.math-block,mjx-container,.mwb-hover-answer'))continue;
      nodes.push(node);
    }
    const positions=[];let visual='';
    for(const n of nodes)for(let i=0;i<n.data.length;i++){visual+=n.data[i];positions.push({n,i});}
    const candidates=[];
    for(let i=0;i<visual.length-1;){
      if(!((visual[i]==='?'||visual[i]==='!')&&visual[i+1]==='{')){i++;continue;}
      const kind=visual[i]==='?'?'fill':'choice';let depth=1,j=i+2;
      for(;j<visual.length;j++){if(visual[j]==='{')depth++;else if(visual[j]==='}'&&--depth===0)break;}
      if(depth!==0||positions[i]?.n!==positions[i+1]?.n){i+=2;continue;}
      candidates.push({start:i,end:j+1,kind});i=j+1;
    }
    for(const c of candidates.reverse()){
      const a=positions[c.start],b=positions[c.end-1];if(!a||!b)continue;
      try{
        const range=doc.createRange();range.setStart(a.n,a.i);range.setEnd(b.n,b.i+1);
        const fragment=range.extractContents(),walk=doc.createTreeWalker(fragment,4),texts=[];let t;
        while((t=walk.nextNode()))texts.push(t);
        if(!texts.length)continue;
        texts[0].deleteData(0,2);
        const last=texts[texts.length-1];if(last.data.length)last.deleteData(last.data.length-1,1);
        const mark=doc.createElement('mark');
        mark.className='mwb-hover-answer '+(c.kind==='choice'?'mwb-choice-answer':'mwb-fill-answer');
        mark.setAttribute('title','悬停或聚焦显示答案');mark.setAttribute('tabindex','0');
        mark.appendChild(fragment);range.insertNode(mark);count++;
      }catch(e){console.warn('[Mathsemble] reading typed answer:',e);}
    }
  }
  return count;
}

const { DEFAULTS, transformQuestion, assertValidQuestionSource } = (() => { const module = {exports:{}};
'use strict';

const DEFAULTS = Object.freeze({ stableMs: 650, timeoutMs: 15000 });

function stripFrontmatter(source) {
  const s = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  if (lines[0].trim() !== '---') return s;
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) throw new Error('YAML frontmatter 未闭合；已停止导出以防正文被错误清洗。');
  return lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

// Edition rule: callouts with + or - are teacher-only; without a marker,
// callouts are shared by student and teacher. Teacher-only answer/success
// blocks of ANY type are measured for student writing space.
function pedagogicalCallout(line) {
  // Visibility is determined ONLY by the marker after [!type]:
  // [!type]+ / [!type]- -> teacher-only; [!type] -> shared.
  // This applies to all Obsidian callout types, not just built-in teaching types.
  const match = String(line).match(/^\s*>\s*\[!([\w-]+)\]([+-])?(?:[ \t]+(.*))?\s*$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const title = (match[3] || '').trim();
  const teacherOnly = match[2] === '+' || match[2] === '-';
  let kind = type;
  if (type === 'answer' || type === 'success') kind = 'answer';
  else if (type === 'solution' || (type === 'info' && /^(解析|解题思路)$/.test(title))) kind = 'analysis';
  return { kind, type, title, teacherOnly };
}

function removeSolutionCallouts(source, mode, options = {}) {
  const lines = source.split('\n');
  const output = [];
  let suppress = false;
  let fence = null;
  for (const line of lines) {
    if (suppress && /^\s*>/.test(line)) {
      const nextCallout = pedagogicalCallout(line);
      if (!nextCallout) continue;
      suppress = false;
    } else if (suppress) {
      suppress = false;
    }
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line);
      continue;
    }
    if (fence) { output.push(line); continue; }
    const callout = pedagogicalCallout(line);
    if (callout) {
      suppress = (mode === 'student' && callout.teacherOnly) ||
        (mode === 'teacher' && options.showSolution === false && callout.type === 'solution');
      if (!suppress) {
        // Preview/PDF callouts are always expanded, without editing source.
        output.push(line.replace(/(\[![\w-]+\])[+-]?/i, '$1+'));
      }
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strict answer-slot syntax: parentheses immediately outside ==...== mean
// choice; otherwise the slot is fill-in. Contents and YAML never override it.
// Both ASCII () and full-width （） are accepted, with optional whitespace.
function isChoiceAnswerSlot(_answer, prefix, suffix, _questionType = '') {
  return /[（(]\s*$/.test(prefix) && /^\s*[）)]/.test(suffix);
}

function formatAnswer(answer, mode, inMath, choice = false) {
  // Only surrounding parentheses classify choice slots; never infer from YAML.
  if (choice) {
    if (mode === 'student') return inMath ? '\\hspace{1.4em}' : '<span class="mwb-choice-slot" aria-label="选择题答案留空">&nbsp;&nbsp;</span>';
    if (inMath) return `\\color{red}{${answer}}`;
    const mathChoice = answer.match(/^\$([^$\n]+)\$/);
    return mathChoice ? `$\\color{red}{${mathChoice[1]}}$` : `<span class="mwb-answer-revealed">${escapeHtml(answer)}</span>`;
  }
  if (!inMath) {
    const standaloneMath = answer.match(/^\$([^$\n]+)\$/);
    if (standaloneMath) {
      if (mode === 'teacher') return `$\\underline{\\color{red}{${standaloneMath[1]}}}$`;
      return mwbStudentFillSpan(standaloneMath[1], true);
    }
  }
  if (inMath) {
    return mode === 'student' ? mwbStudentMathFill(answer) : `\\underline{\\color{red}{${answer}}}`;
  }
  return mode === 'student'
    ? mwbStudentFillSpan(answer, false)
    : `<span class="mwb-teacher-fill-slot" aria-label="填空题参考答案">${escapeHtml(answer)}</span>`;
}

// Purposefully conservative: do not transform fenced/inline code, escaped delimiters,
// or a cloze containing a newline. Each ==...== pair is confined to its line.
function rewriteClozes(source, mode, questionType = '') {
  return mwbRewriteTypedAnswers(source,mode);
}

function validateQuestionSource(markdown) {
  return mwbValidateTypedAnswers(markdown);
}

function assertValidQuestionSource(markdown) {
  const errors = validateQuestionSource(markdown);
  if (errors.length) throw new Error('题卡预检未通过：' + errors.join('；'));
}

// Projected print mode only. The raw-document mode intentionally bypasses
// all conversions. Conservative lexer: never replace underscores in code,
// math delimiters, HTML, escaped text, or nonblank identifier tokens.
function normalizePrintBlanks(source) {
  const lines = source.split('\n');
  let fence = null, displayMath = false, mathParen = false, mathBracket = false;
  const output = [];
  for (const line of lines) {
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line); continue;
    }
    if (fence || /^\s*_{3,}\s*$/.test(line) || /<!--|https?:\/\/|\]\(/.test(line)) {
      output.push(line); continue;
    }
    let codeTicks = 0, inlineMath = false, inHtml = false, result = '';
    for (let i = 0; i < line.length;) {
      const char = line[i];
      if (char === '\\' && line[i+1]) {
        const delimiter = line.slice(i, i+2);
        if (delimiter === '\\(') mathParen = true;
        if (delimiter === '\\)') mathParen = false;
        if (delimiter === '\\[') mathBracket = true;
        if (delimiter === '\\]') mathBracket = false;
        result += delimiter; i += 2; continue;
      }
      if (char === '`' && !displayMath && !mathParen && !mathBracket) {
        let n=1; while (line[i+n] === '`') n++;
        if (codeTicks === 0) codeTicks = n;
        else if (codeTicks === n) codeTicks = 0;
        result += '`'.repeat(n); i += n; continue;
      }
      if (!codeTicks && char === '$' && !mathParen && !mathBracket) {
        if (line[i+1] === '$') { displayMath = !displayMath; result += '$$'; i+=2; continue; }
        if (!displayMath) inlineMath = !inlineMath;
        result += char; i++; continue;
      }
      if (!codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket) {
        if (char === '<') inHtml = true;
        if (char === '>' && inHtml) { inHtml = false; result += char; i++; continue; }
      }
      if (char === '_' && !codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket && !inHtml) {
        let j=i+1; while (line[j] === '_') j++;
        const previous = line[i-1] || '', next = line[j] || '';
        if (j-i >= 3 && !/[\p{L}\p{N}_]/u.test(previous) && !/[\p{L}\p{N}_]/u.test(next)) {
          const em = Math.min(12, Math.max(3, Math.round((j-i)*0.8*10)/10));
          result += `<span class="mwb-fixed-blank" style="width:${em}em" aria-label="填空横线"></span>`;
          i=j; continue;
        }
      }
      result += char; i++;
    }
    output.push(result);
  }
  return output.join('\n');
}

// Rewrite only an explicit edition suffix on the first H1, never an arbitrary
// occurrence of 教师版 in body text (e.g. a lesson *about* version differences).
function projectHandoutHeading(source, mode) {
  if (!['student','teacher'].includes(mode)) return source;
  const lines=source.split('\n'); let fence=null;
  for(let i=0;i<lines.length;i++) {
    const f=lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if(f) {const v=f[1]; if(!fence) fence=v; else if(v[0]===fence[0] && v.length>=fence.length) fence=null; continue;}
    if(fence) continue;
    if(/^#\s+/.test(lines[i])) {
      lines[i]=lines[i].replace(/[（(](?:完整)?(?:教师版|学生版|答案版)[）)]\s*$/,`（${mode==='student'?'学生版':'教师版'}）`);
      break;
    }
  }
  return lines.join('\n');
}

function transformQuestion(markdown, mode, options = {}) {
  if (!['student', 'teacher'].includes(mode)) throw new Error('Invalid export mode');
  assertValidQuestionSource(markdown);
  // Optional metadata supports choice cards whose answer is not immediately
  // between parentheses; never overwrite frontmatter or infer subject data.
  const head = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(head)?.[1] || '';
  const questionType = /^(?:question_type|type):\s*["']?([^\n"'#]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() || '';
  let body = stripFrontmatter(markdown).replace(/\u00A0/g, ' ');
  body = removeSolutionCallouts(body, mode, options);
  return normalizePrintBlanks(rewriteClozes(body, mode));
}

module.exports = { DEFAULTS, stripFrontmatter, pedagogicalCallout, removeSolutionCallouts, rewriteClozes, isChoiceAnswerSlot, validateQuestionSource, assertValidQuestionSource, transformQuestion, normalizePrintBlanks, projectHandoutHeading };

return module.exports; })();
const { pdfBufferFromHtml } = (() => { const module = {exports:{}};
'use strict';

// Electron is not part of Obsidian's stable public plugin API. This adapter
// intentionally depends on the BrowserWindow class resolved by the plugin.
// It is isolated so we can test the file-loading lifecycle without Electron.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { printPaginationScript, printPaginationPartialScript } = (() => { const module = {exports:{}};
'use strict';

// Runs INSIDE the isolated print BrowserWindow after fonts and images settle.
// Moves the already-rendered MathJax/TikZ DOM; it never re-typesets mathematics.
// Every printed page is an explicit A4 sheet. Reject unbreakable over-height
// blocks instead of clipping. An additional final blank PDF page is permitted;
// do not shorten/remove legitimate student writing space to eliminate it.
function paginatePrintDocument(root, allowPartialMath = false) {
  if (!root || !root.ownerDocument) throw new Error('找不到 PDF 正文容器');
  const doc = root.ownerDocument;
  const paper = doc.createElement('style');
  paper.textContent = `
    @page { size: 210mm 297mm; margin: 0 !important; }
    html, body { margin: 0 !important; padding: 0 !important; width: 210mm !important; background: white !important; }
    .mwb-export-doc { width: 210mm !important; margin:0 !important; padding:0 !important; }
    .mwb-paper { position:relative; box-sizing:border-box; display:block; width:210mm; height:297mm; padding:14mm 16mm 18mm; margin:0; background:white; color:#141414; overflow:hidden; break-inside:avoid; page-break-inside:avoid; }
    .mwb-paper + .mwb-paper { break-before:page; page-break-before:always; }
    .mwb-paper-body { box-sizing:border-box; display:flow-root; width:100%; height:100%; min-height:0; overflow:visible; }
    .mwb-paper-footer { position:absolute; left:0; right:0; bottom:7mm; text-align:center; font-size:8pt; color:#555; line-height:1; }
    .mwb-paper .mwb-exam-section { break-after:auto !important; page-break-after:auto !important; }
    .mwb-paper .mwb-exam-question { break-inside:auto !important; page-break-inside:auto !important; }
    .mwb-paper .mwb-exam-question-content > p:first-child { break-after:auto !important; page-break-after:auto !important; }
    .mwb-paper .mwb-answer-space { break-inside:auto !important; page-break-inside:auto !important; }
    .mwb-paper .mwb-answer-space-chunk { break-inside:avoid !important; page-break-inside:avoid !important; }
    .mwb-paper .callout { break-inside:auto !important; page-break-inside:auto !important; }
    @media screen { .mwb-paper { outline:1px solid #ddd; } }
  `;
  doc.head.appendChild(paper);
  // All existing children are detached only once. MathJax baseline attributes,
  // SVG nodes and data URLs remain unchanged throughout pagination.
  const inputNodes = Array.from(root.children);
  const inputQuestionCount = inputNodes.filter(node => node.classList?.contains('mwb-exam-question')).length;
  // Measure total allocated student writing space BEFORE moving its chunks.
  // Visible body text is not required on a handwriting-only final sheet.
  const originalSpaces = inputNodes.flatMap(node => [
    ...(node.matches?.('.mwb-answer-space') ? [node] : []),
    ...node.querySelectorAll('.mwb-answer-space'),
  ]);
  const expectedSpacePx = originalSpaces.reduce((total, node) => {
    const height = Number(node.getAttribute('data-mwb-space-px'));
    if (!(height > 0) || !Number.isFinite(height)) throw new Error('等高留白缺少有效的目标高度');
    return total + height;
  }, 0);
  const expectedSpaceChunks = originalSpaces.reduce((total, node) => total + node.querySelectorAll('.mwb-answer-space-chunk').length, 0);
  root.replaceChildren();
  const pages = [];
  let page, body;
  let atomicCount = 0, spaceChunks = 0, splitCallouts = 0;
  let lastRejectedHeight = 0;
  let lastSectionName = '';
  let questionPart = null;
  let pendingHeading = null;

  const makePage = () => {
    page = doc.createElement('div'); page.className = 'mwb-paper';
    body = doc.createElement('div'); body.className = 'mwb-paper-body';
    page.appendChild(body); root.appendChild(page);
    pages.push({paper:page, body, meaningful:0});
    questionPart = null;
  };
  const active = () => pages[pages.length - 1];
  const used = () => {
    const rect = body.getBoundingClientRect();
    let max = 0;
    for (const child of body.children) {
      const r = child.getBoundingClientRect();
      const style = doc.defaultView.getComputedStyle(child);
      const bottom = r.bottom - rect.top + (parseFloat(style.marginBottom) || 0);
      if (Number.isFinite(bottom)) max = Math.max(max, bottom);
    }
    return max;
  };
  const capacity = () => body.getBoundingClientRect().height;
  const overflowed = () => used() > capacity() + 1.25;
  const newQuestionPart = (q) => {
    const section = doc.createElement('section');
    section.className = 'mwb-exam-question mwb-question-fragment';
    for (const attr of q.attributes || []) {
      if (attr.name.startsWith('data-mwb-')) section.setAttribute(attr.name, attr.value);
    }
    const content = doc.createElement('div'); content.className = 'mwb-exam-question-content';
    section.appendChild(content); body.appendChild(section);
    questionPart = { source:q, section, content };
    return questionPart;
  };
  const targetFor = (q) => {
    if (!q) { questionPart = null; return body; }
    if (!questionPart || questionPart.source !== q || questionPart.section.parentElement !== body) {
      return newQuestionPart(q).content;
    }
    return questionPart.content;
  };
  const removeEmptyPart = () => {
    if (questionPart && !questionPart.content.hasChildNodes()) {
      questionPart.section.remove(); questionPart = null;
    }
  };
  const commit = (node, q = null) => {
    const parent = targetFor(q);
    parent.appendChild(node);
    const fits = !overflowed();
    if (fits) { active().meaningful++; atomicCount++; return true; }
    lastRejectedHeight = node.getBoundingClientRect().height;
    parent.removeChild(node); removeEmptyPart();
    return false;
  };
  const overflowError = (node) => {
    const description = (node?.textContent || node?.getAttribute?.('aria-label') || node?.tagName || '未知元素').trim().slice(0,65);
    throw new Error(`存在超过 A4 可打印区域的不可拆分内容：${description || '大型公式或图形'}；请拆成多个独立步骤`);
  };
  const nextPage = () => {
    if (pages.length >= 200) throw new Error('试卷异常：超过 200 页或分页无法收敛');
    // A page with *only* an unplaced heading must not be emitted.
    if (active().meaningful === 0) throw new Error('打印页面存在不可容纳的题目标题或公式');
    makePage();
  };
  const appendItem = (node, q = null) => {
    if (commit(node, q)) return;
    if (active().meaningful > 0) {
      nextPage();
      if (commit(node, q)) return;
    }
    overflowError(node);
  };
  // Test a cohesive heading + first question paragraph as a single layout unit.
  const placeUnit = (nodes, q = null, sectionHeading = null) => {
    const testPlace = () => {
      if (sectionHeading) body.appendChild(sectionHeading);
      const content = targetFor(q);
      for (const node of nodes) content.appendChild(node);
      if (overflowed()) {
        for (const node of nodes) content.removeChild(node);
        removeEmptyPart();
        if (sectionHeading) sectionHeading.remove();
        return false;
      }
      active().meaningful += nodes.length + (sectionHeading ? 1 : 0);
      atomicCount += nodes.length;
      return true;
    };
    if (testPlace()) return;
    if (active().meaningful > 0) { nextPage(); if (testPlace()) return; }
    overflowError(nodes[0]);
  };
  const isDisplayNode = el => el && (el.matches?.('div.math, .math-block, .block-language-tikz, .block-language-tikzjax, pre, figure') ||
      !!el.querySelector?.('mjx-container[display="true"], .math.math-block'));

  // Callouts are atomic if short; only truly over-height callouts split into
  // per-paragraph blocks with a fresh "（续）" title after each page break.
  const placeCallout = (callout, q) => {
    if (commit(callout,q)) return;
    // If the callout fits on a fresh page, move it intact. An over-height
    // callout MUST begin splitting on the current page rather than wasting
    // all remaining space merely because the whole callout is too tall.
    if (lastRejectedHeight < capacity() - 2 && active().meaningful > 0) {
      nextPage(); if (commit(callout,q)) return;
    }
    // Break at semantic steps; a huge solution uses the current free space.
    const title = callout.querySelector(':scope > .callout-title');
    const content = callout.querySelector(':scope > .callout-content');
    if (!content || !content.children.length) return overflowError(callout);
    const blocks = [...content.children];
    const titleText = title?.textContent?.trim() || '解答';
    let continued = false;
    const buildFragment = () => {
      const fragment = callout.cloneNode(false);
      const head = title ? title.cloneNode(true) : doc.createElement('div');
      if (!title) { head.className='callout-title'; head.textContent=titleText; }
      if (continued) head.textContent = `${titleText}（续）`;
      const inner = content.cloneNode(false);
      fragment.append(head,inner);
      return {fragment,inner};
    };
    let current = buildFragment();
    appendItem(current.fragment,q);
    // Don't count a title-only fragment as meaningful content: it will be
    // moved to the next sheet if the first solution step does not fit.
    for (const block of blocks) {
      current.inner.appendChild(block);
      if (overflowed()) {
        current.inner.removeChild(block);
        if (!current.inner.children.length) {
          current.fragment.remove();
          active().meaningful = Math.max(0, active().meaningful-1);
        }
        if (active().meaningful > 0) nextPage();
        continued = true;
        current = buildFragment();
        appendItem(current.fragment,q);
        current.inner.appendChild(block);
        if (overflowed()) overflowError(block);
      }
      atomicCount++;
    }
    splitCallouts++;
  };
  // Long Markdown documents often contain a single long <ol>/<ul>. Keep
  // list-item geometry, and split only between <li> nodes. Ordered lists
  // resume with the correct start number on the next page.
  const placeLongList = (list, q=null) => {
    if (commit(list,q)) return;
    const children=[...list.children];
    if (!children.length) return appendItem(list,q);
    const originalStart=parseInt(list.getAttribute('start') || '1',10) || 1;
    let placed=0, part;
    const openPart=()=>{
      part=list.cloneNode(false);
      if (list.tagName === 'OL') part.setAttribute('start',String(originalStart+placed));
      appendItem(part,q);
    };
    openPart();
    for (const child of children) {
      part.appendChild(child);
      if (overflowed()) {
        part.removeChild(child);
        if (!part.children.length) {
          part.remove();
          active().meaningful=Math.max(0,active().meaningful-1);
          if (active().meaningful > 0) nextPage();
          else overflowError(child);
        } else nextPage();
        openPart();
        part.appendChild(child);
        if (overflowed()) overflowError(child);
      }
      placed++;
      atomicCount++;
    }
  };
  const placeSpace = (space, q) => {
    const chunks = [...space.querySelectorAll(':scope > .mwb-answer-space-chunk')];
    if (!chunks.length) throw new Error('答题留白没有可打印的分段');
    for (const chunk of chunks) {
      const container = space.cloneNode(false);
      container.removeAttribute('data-mwb-space-px');
      container.appendChild(chunk);
      appendItem(container,q);
      spaceChunks++;
    }
  };
  makePage();
  const pending = [];
  const documentHeadings = [];
  for (const node of inputNodes) {
    if (node.classList?.contains('mwb-exam-section')) {
      if (pendingHeading) appendItem(pendingHeading);
      pendingHeading = node; lastSectionName = node.textContent || '';
      questionPart = null;
      continue;
    }
    if (!node.classList?.contains('mwb-exam-question')) {
      // Heading+following short paragraph should remain on one printed page.
      // A long table/list is laid out separately to keep its split points.
      if (node.matches?.('h1, h2, h3, h4') && !node.classList.contains('mwb-exam-title') && !node.classList.contains('mwb-exam-section')) {
        documentHeadings.push(node);
        continue;
      }
      if (documentHeadings.length) {
        if (node.matches?.('p, blockquote') && node.getBoundingClientRect().height < capacity()*0.5) {
          placeUnit([...documentHeadings.splice(0),node]);
          continue;
        }
        for (const header of documentHeadings.splice(0)) appendItem(header);
      }
      // Place title + edition together; no blank title-only sheet.
      if (pending.length && !node.classList?.contains('mwb-exam-edition')) {
        placeUnit(pending.splice(0));
      }
      if (node.classList?.contains('mwb-exam-title') || node.classList?.contains('mwb-exam-edition')) {
        pending.push(node); if (node.classList.contains('mwb-exam-edition')) placeUnit(pending.splice(0));
      } else if (node.classList?.contains('callout')) placeCallout(node,null);
      else if (node.classList?.contains('mwb-answer-space')) placeSpace(node,null);
      else if (node.matches?.('ol, ul')) placeLongList(node,null);
      else appendItem(node);
      continue;
    }
    if (pending.length) placeUnit(pending.splice(0));
    const content = node.querySelector(':scope > .mwb-exam-question-content');
    if (!content) throw new Error('缺少组卷题目正文');
    const blocks = [...content.children];
    if (!blocks.length) throw new Error('试题为空：' + node.getAttribute('data-mwb-source-path'));
    // Keep a short first paragraph (question number + instruction) with its
    // following display formula, e.g. "解方程组" + array.
    const first = [blocks.shift()];
    if (blocks.length && isDisplayNode(blocks[0]) && first[0].textContent.trim().length < 130) {
      first.push(blocks.shift());
    }
    placeUnit(first,node,pendingHeading);
    pendingHeading = null;
    for (const block of blocks) {
      if (block.classList?.contains('mwb-answer-space')) placeSpace(block,node);
      else if (block.classList?.contains('callout')) placeCallout(block,node);
      else if (block.matches?.('ol, ul')) placeLongList(block,node);
      else appendItem(block,node);
    }
    questionPart = null;
  }
  if (pending.length) placeUnit(pending.splice(0));
  for (const header of documentHeadings) appendItem(header);
  if (pendingHeading) throw new Error(`存在没有题目的试卷分区：${lastSectionName}`);
  // Remove only unused transient containers generated by the algorithm.
  // A page with handwriting-space chunks has meaningful > 0 and stays,
  // even when that page has no visible text. Do not shrink answer spaces.
  for (const item of [...pages]) {
    if (item.meaningful === 0) { item.paper.remove(); pages.splice(pages.indexOf(item),1); }
  }
  if (!pages.length) throw new Error('打印正文为空，无法生成 PDF');
  const placedSpaceNodes = [...root.querySelectorAll('.mwb-answer-space-chunk')];
  const placedSpacePx = placedSpaceNodes.reduce((total, node) => total + (parseFloat(node.style.height || '') || 0), 0);
  const spaceDeltaPx = placedSpacePx - expectedSpacePx;
  if (placedSpaceNodes.length !== expectedSpaceChunks ||
      Math.abs(spaceDeltaPx) > Math.max(0.5, expectedSpacePx * 0.001)) {
    throw new Error(`分页后答题空间丢失或高度异常：目标 ${expectedSpacePx.toFixed(2)}px，实得 ${placedSpacePx.toFixed(2)}px，段数 ${placedSpaceNodes.length}/${expectedSpaceChunks}`);
  }
  if (inputQuestionCount > 0) {
    const indexes = root.querySelectorAll('.mwb-question-index').length;
    if (indexes !== inputQuestionCount) {
      throw new Error(`分页后题号数量异常：原有 ${inputQuestionCount} 题，现有 ${indexes} 个题号`);
    }
  }
  pages.forEach((item,i) => {
    const footer = doc.createElement('div');
    footer.className='mwb-paper-footer';
    footer.textContent = `${i+1}/${pages.length}`;
    item.paper.appendChild(footer);
    if (item.body.scrollHeight > item.body.clientHeight + 2 || usedIsOverflow(item.body)) {
      throw new Error(`第 ${i+1} 页仍然溢出，已阻止生成 PDF`);
    }
    if (!item.body.children.length && i !== pages.length - 1) throw new Error(`第 ${i+1} 页为空白页`);
    for (const formula of item.body.querySelectorAll('mjx-container, .MathJax, .katex')) {
      const r = formula.getBoundingClientRect();
      const container = item.body.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.top < container.top - 2 || r.bottom > container.bottom + 2) {
        // Explicitly accepted local MathJax failures may be included in an
        // imperfect PDF, but page/answer-space overflows remain hard failures.
        if (!allowPartialMath) throw new Error(`第 ${i+1} 页公式在打印分页后几何尺寸异常`);
      }
    }
  });
  function usedIsOverflow(content) {
    const limit = content.getBoundingClientRect().bottom;
    for (const el of content.children) {
      const css = doc.defaultView.getComputedStyle(el);
      if (el.getBoundingClientRect().bottom + (parseFloat(css.marginBottom)||0) > limit + 1.25) return true;
    }
    return false;
  }
  return {
    pages: pages.length, blocks: atomicCount, answerSpaceChunks: spaceChunks, splitCallouts,
    answerSpaceExpectedPx: Number(expectedSpacePx.toFixed(2)),
    answerSpacePlacedPx: Number(placedSpacePx.toFixed(2)),
    answerSpaceDeltaPx: Number(spaceDeltaPx.toFixed(2)),
  };
}

// Serialize a pure browser function. The separate Electron window has neither
// Node.js integration nor injected executable source inside the HTML file.
const printPaginationScript = `(${paginatePrintDocument.toString()})(document.querySelector('.mwb-export-doc'))`;
const printPaginationPartialScript = `(${paginatePrintDocument.toString()})(document.querySelector('.mwb-export-doc'), true)`;
module.exports = { paginatePrintDocument, printPaginationScript, printPaginationPartialScript };

return module.exports; })();

async function pdfBufferFromHtml(html, BrowserWindow, options = {}) {
  if (typeof BrowserWindow !== 'function') {
    throw new Error('当前 Obsidian/Electron 未暴露可用的 BrowserWindow 接口。');
  }
  if (typeof html !== 'string' || !html.startsWith('<!doctype html>')) {
    throw new Error('PDF 打印 HTML 无效，已停止导出。');
  }

  // IMPORTANT: never load a giant data:text/html URL. Embedded MathJax font
  // rules and SVG payloads can make it too large for Chromium navigation.
  // Electron's loadFile handles non-ASCII paths on Windows/macOS as well.
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'math-teaching-workbench-pdf-')
  );
  const htmlPath = path.join(temporaryDirectory, 'print.html');
  let printWindow;
  const paginationRequired = /<main\b[^>]*class=["'][^"']*\bmwb-export-doc\b/i.test(html);
  let paginationReport = null;
  try {
    await fs.promises.writeFile(htmlPath, html, { encoding: 'utf8', flag: 'wx' });
    printWindow = new BrowserWindow({
      show: false,
      width: 940,
      height: 1240,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Page scripts are blocked by the generated HTML's restrictive CSP.
        // Enabling JS here allows Electron to run privileged readiness checks.
        javascript: true,
      },
    });
    // A file path (not a URL) avoids ERR_INVALID_URL(-300) from huge data URLs.
    await printWindow.loadFile(htmlPath);
    // loadFile resolves at did-finish-load, before web fonts necessarily settle.
    // This check is run from trusted plugin code; the HTML has CSP script-src 'none'
    // and all user-authored scripts and event handlers have been removed.
    if (typeof printWindow.webContents.executeJavaScript === 'function') {
      const status = await printWindow.webContents.executeJavaScript(`
        (async () => {
          const bounded = new Promise((_, reject) => setTimeout(() => reject(new Error('打印字体与图片加载超时')), 10000));
          const ready = (async () => {
            if (document.fonts) await document.fonts.ready;
            await Promise.all(Array.from(document.images).map(async (im) => {
              if (im.decode) { try { await im.decode(); } catch (_) { /* inspect below */ } }
            }));
            const badImage = Array.from(document.images).some(im => !im.complete || !im.naturalWidth);
            const badMath = Array.from(document.querySelectorAll('mjx-container, .MathJax')).some(el => {
              const r = el.getBoundingClientRect();
              return r.height < 1 || r.width < 1;
            });
            return {badImage, badMath, pageFontStatus: document.fonts?.status || 'unsupported'};
          })();
          return await Promise.race([ready, bounded]);
        })();
      `);
      if (status?.badImage && !options.allowPartialImage) throw new Error('打印窗口中的图片未完整加载，已阻止 PDF 导出');
      if (status?.badMath && !options.allowPartialMath) throw new Error('打印窗口中的数学公式几何尺寸异常，已阻止 PDF 导出');
    } else {
      // Older Electron adapters have no readiness API. Self-contained resources
      // generally load quickly, but do not claim mathematical visual parity.
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    if (paginationRequired) {
      if (typeof printWindow.webContents.executeJavaScript !== 'function') {
        throw new Error('当前 Electron 不支持打印前智能分页，已阻止导出');
      }
      paginationReport = await printWindow.webContents.executeJavaScript(
        options.allowPartialMath ? printPaginationPartialScript : printPaginationScript
      );
      if (!paginationReport || !Number.isInteger(paginationReport.pages) || paginationReport.pages < 1) {
        throw new Error('打印前分页失败：没有有效 A4 页面');
      }
    }
    const raw = await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      landscape: false,
      displayHeaderFooter: !paginationRequired,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="box-sizing:border-box;width:100%;text-align:center;font-size:8px;color:#555;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margins: { marginType: 'none', top: 0, bottom: 0, left: 0, right: 0 },
    });
    const pdf = Buffer.from(raw);
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('打印引擎未返回有效的 PDF 文件');
    }
    // Chromium commonly emits page dictionaries as plain objects; when its
    // version uses compressed object streams no count is available, so the
    // pre-print DOM overflow guard remains authoritative.
    if (paginationReport) {
      const pageMarkers = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g);
      const count = pageMarkers ? pageMarkers.length : 0;
      // A trailing blank sheet is permitted by the exam-printing policy.
      // A +1 discrepancy is therefore tolerated, but we cannot assert from
      // page dictionaries alone that the additional PDF sheet is truly blank.
      // Never drop it: it may contain intentional student handwriting space.
      // Missing pages or 2+ unexpected pages still indicate a print failure.
      if (count && (count < paginationReport.pages || count > paginationReport.pages + 1)) {
        throw new Error(`PDF 实际生成 ${count} 页，但分页引擎预期 ${paginationReport.pages} 页；允许至多一页额外尾页，其他页数异常已阻止保存`);
      }
      const oneExtraPage = count === paginationReport.pages + 1;
      Object.defineProperty(pdf, 'mwbPrintReport', {
        configurable: false, enumerable: false,
        value: {
          ...paginationReport,
          pdfPageCount: count || null,
          extraTailPageAllowed: oneExtraPage,
          // A page dictionary count does not prove the last page is blank.
          extraTailPageVerifiedBlank: false,
          paginationWarning: oneExtraPage ? 'PDF 比显式分页多 1 页，按允许尾页策略保留；其内容尚未自动核实' : null,
        },
      });
    }
    if (typeof options.onPdfReady === 'function') await options.onPdfReady(pdf);
    if (options.printAfter === true) {
      if (typeof printWindow.webContents.print !== 'function') throw new Error('宿主 Electron 不支持打开系统打印对话框；PDF 可正常保存');
      // Printing is expressly user initiated. Use the SAME already paginated
      // BrowserWindow to avoid re-typesetting/re-pagination by the plugin.
      // A physical printer driver can still alter scaling/margins.
      if (typeof printWindow.show === 'function') printWindow.show();
      if (typeof printWindow.focus === 'function') printWindow.focus();
      const outcome = await new Promise((resolve, reject) => {
        try {
          printWindow.webContents.print({silent:false,printBackground:true,landscape:false,pageSize:'A4',margins:{marginType:'none'}},
            (success,reason) => resolve({success:!!success,reason:String(reason||'')}));
        } catch(e) {reject(e);}
      });
      Object.defineProperty(pdf,'mwbPrintOutcome',{value:outcome,enumerable:false});
    }
    return pdf;
  } finally {
    try {
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy();
    } finally {
      // Delete even when loadFile or printToPDF fails. Do not leave question
      // contents in the operating system's temporary folder.
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

module.exports = { pdfBufferFromHtml };

return module.exports; })();
const { META_FIELDS, MODE_DEFAULTS, addMetaBlock } = (() => { const module = {exports:{}};
'use strict';
// Presentation-only projection of EXISTING YAML. No inference, source rewriting,
// implicit source paths or raw audit metadata in public handouts.
const META_FIELDS = Object.freeze([
  {key:'difficulty',label:'难度'},
  {key:'source',label:'来源'},
  {key:'knowledge_nodes',label:'知识点'},
  {key:'methods',label:'方法'},
  {key:'role',label:'教学角色'},
  {key:'teaching_tier',label:'教学层次'},
  {key:'question_type',label:'题型'},
  {key:'id',label:'题目 ID'},
]);
const FIELD_KEYS = META_FIELDS.map(x=>x.key);
const MODE_DEFAULTS = Object.freeze({student:[],teacher:['difficulty','knowledge_nodes']});
const QUESTION_TYPE_LABEL = Object.freeze({choice:'单选',multiple_choice:'多选',fill_blank:'填空',true_false:'判断',short_answer:'解答',calculation:'计算',proof:'证明',comprehensive:'综合'});
const ROLE_LABEL = Object.freeze({example:'例题',variant:'变式',practice:'练习',assessment:'检测',test:'检测',homework:'作业'});
function textValue(x) {
  if (x == null || x === '') return '';
  if (Array.isArray(x)) return x.map(textValue).filter(Boolean).join('、');
  if (typeof x === 'string' || typeof x === 'number') return String(x).trim().slice(0, 180);
  return '';
}
function sourceLabel(raw) {
  let text='';
  if (typeof raw === 'string') text=raw.trim();
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) text=textValue(raw.title || raw.name || raw.label || raw.book || raw.publication);
  // Never print a private path/URL, source file identifier or raw source object.
  if (!text || /(?:\/|\\|https?:|file:|^[A-Za-z]:|\.pdf$|\.tex$|\.md$)/i.test(text)) return '';
  return text.slice(0,120);
}
function formatMeta(meta, chosen = []) {
  const selected = new Set(chosen.filter(k=>FIELD_KEYS.includes(k)));
  return META_FIELDS.filter(f=>selected.has(f.key)).map(f=>{
    const raw = f.key==='role' ? (meta?.role ?? meta?.teaching_role)
      : f.key==='question_type' ? (meta?.question_type ?? meta?.type) : meta?.[f.key];
    let value=f.key==='source'?sourceLabel(raw):textValue(raw);
    if (f.key==='role') value=ROLE_LABEL[value] || value;
    if (f.key==='question_type') value=QUESTION_TYPE_LABEL[value] || value;
    return value ? {key:f.key,label:f.label,value} : null;
  }).filter(Boolean);
}
function addMetaBlock(document, parent, meta, fields, position='below') {
  const rows=formatMeta(meta,fields);
  if (!rows.length) return null;
  const box=document.createElement('div');
  box.className='mwb-print-meta';
  box.setAttribute('data-mwb-presentation-only','true');
  for (const row of rows) {
    const node=document.createElement('span');
    node.className='mwb-print-meta-item';
    node.textContent=`${row.label}：${row.value}`;
    box.appendChild(node);
  }
  if (position==='above') parent.prepend(box);
  else if (position==='end') parent.appendChild(box);
  else {
    const paragraph=parent.querySelector(':scope > p');
    if (paragraph) paragraph.after(box);
    else parent.prepend(box);
  }
  return box;
}
module.exports={META_FIELDS,FIELD_KEYS,MODE_DEFAULTS,formatMeta,sourceLabel,addMetaBlock};

return module.exports; })();
const { documentChunks } = (() => { const module = {exports:{}};
'use strict';
const MAX_DOCUMENT_CHARS = 1000000;
// Splits at top-level headings only outside code/math blocks; no Markdown is
// rewritten, headers are preserved and original order is stable. With no safe
// heading boundary the original section stays intact instead of corrupting a
// multi-line equation or fenced block.
function documentChunks(source, maxChars=36000) {
  if (typeof source!=='string') throw new TypeError('Markdown 必须为字符串');
  if (source.length>MAX_DOCUMENT_CHARS) throw new Error('文档大于 100 万字符，建议分册导出');
  const withoutFrontmatter=source.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,'');
  const lines=withoutFrontmatter.split(/(?<=\n)/);
  const out=[]; let fragment=''; let fence=null; let math=false;
  for (const line of lines) {
    const fenced=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    const isHeading=!fence&&!math && /^#{1,3}\s+\S/.test(line);
    if (isHeading && fragment.length>=maxChars && fragment.trim()) {out.push(fragment);fragment='';}
    if (fenced) {const marker=fenced[1]; if(!fence) fence=marker; else if(marker[0]===fence[0] && marker.length>=fence.length) fence=null;}
    else if (!fence) {
      const delimiters=(line.match(/(?<!\\)\$\$/g)||[]).length;
      if (delimiters%2) math=!math;
    }
    fragment+=line;
  }
  if (fragment.trim()) out.push(fragment);
  return out.length ? out : [''];
}
module.exports={documentChunks,MAX_DOCUMENT_CHARS};

return module.exports; })();
const { handoutPlan } = (() => { const module = {exports:{}};
'use strict';
// One document, three views. This is a read-only projection: no files are
// edited, no question IDs are invented and existing question labels stay put.
const { stripFrontmatter, removeSolutionCallouts, rewriteClozes, validateQuestionSource, normalizePrintBlanks, projectHandoutHeading } = (() => { const module={exports:{}};
'use strict';

const DEFAULTS = Object.freeze({ stableMs: 650, timeoutMs: 15000 });

function stripFrontmatter(source) {
  const s = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  if (lines[0].trim() !== '---') return s;
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) throw new Error('YAML frontmatter 未闭合；已停止导出以防正文被错误清洗。');
  return lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

// Edition rule: callouts with + or - are teacher-only; without a marker,
// callouts are shared by student and teacher. Teacher-only answer/success
// blocks of ANY type are measured for student writing space.
function pedagogicalCallout(line) {
  // Visibility is determined ONLY by the marker after [!type]:
  // [!type]+ / [!type]- -> teacher-only; [!type] -> shared.
  // This applies to all Obsidian callout types, not just built-in teaching types.
  const match = String(line).match(/^\s*>\s*\[!([\w-]+)\]([+-])?(?:[ \t]+(.*))?\s*$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const title = (match[3] || '').trim();
  const teacherOnly = match[2] === '+' || match[2] === '-';
  let kind = type;
  if (type === 'answer' || type === 'success') kind = 'answer';
  else if (type === 'solution' || (type === 'info' && /^(解析|解题思路)$/.test(title))) kind = 'analysis';
  return { kind, type, title, teacherOnly };
}

function removeSolutionCallouts(source, mode, options = {}) {
  const lines = source.split('\n');
  const output = [];
  let suppress = false;
  let fence = null;
  for (const line of lines) {
    if (suppress && /^\s*>/.test(line)) {
      const nextCallout = pedagogicalCallout(line);
      if (!nextCallout) continue;
      suppress = false;
    } else if (suppress) {
      suppress = false;
    }
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line);
      continue;
    }
    if (fence) { output.push(line); continue; }
    const callout = pedagogicalCallout(line);
    if (callout) {
      suppress = (mode === 'student' && callout.teacherOnly) ||
        (mode === 'teacher' && options.showSolution === false && callout.type === 'solution');
      if (!suppress) {
        // Preview/PDF callouts are always expanded, without editing source.
        output.push(line.replace(/(\[![\w-]+\])[+-]?/i, '$1+'));
      }
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strict answer-slot syntax: parentheses immediately outside ==...== mean
// choice; otherwise the slot is fill-in. Contents and YAML never override it.
// Both ASCII () and full-width （） are accepted, with optional whitespace.
function isChoiceAnswerSlot(_answer, prefix, suffix, _questionType = '') {
  return /[（(]\s*$/.test(prefix) && /^\s*[）)]/.test(suffix);
}

function formatAnswer(answer, mode, inMath, choice = false) {
  // Only surrounding parentheses classify choice slots; never infer from YAML.
  if (choice) {
    if (mode === 'student') return inMath ? '\\hspace{1.4em}' : '<span class="mwb-choice-slot" aria-label="选择题答案留空">&nbsp;&nbsp;</span>';
    if (inMath) return `\\color{red}{${answer}}`;
    const mathChoice = answer.match(/^\$([^$\n]+)\$/);
    return mathChoice ? `$\\color{red}{${mathChoice[1]}}$` : `<span class="mwb-answer-revealed">${escapeHtml(answer)}</span>`;
  }
  if (!inMath) {
    const standaloneMath = answer.match(/^\$([^$\n]+)\$/);
    if (standaloneMath) {
      if (mode === 'teacher') return `$\\underline{\\color{red}{${standaloneMath[1]}}}$`;
      return mwbStudentFillSpan(standaloneMath[1], true);
    }
  }
  if (inMath) {
    return mode === 'student' ? mwbStudentMathFill(answer) : `\\underline{\\color{red}{${answer}}}`;
  }
  return mode === 'student'
    ? mwbStudentFillSpan(answer, false)
    : `<span class="mwb-teacher-fill-slot" aria-label="填空题参考答案">${escapeHtml(answer)}</span>`;
}

// Purposefully conservative: do not transform fenced/inline code, escaped delimiters,
// or a cloze containing a newline. Each ==...== pair is confined to its line.
function rewriteClozes(source, mode, questionType = '') {
  return mwbRewriteTypedAnswers(source,mode);
}

function validateQuestionSource(markdown) {
  return mwbValidateTypedAnswers(markdown);
}

function assertValidQuestionSource(markdown) {
  const errors = validateQuestionSource(markdown);
  if (errors.length) throw new Error('题卡预检未通过：' + errors.join('；'));
}

// Projected print mode only. The raw-document mode intentionally bypasses
// all conversions. Conservative lexer: never replace underscores in code,
// math delimiters, HTML, escaped text, or nonblank identifier tokens.
function normalizePrintBlanks(source) {
  const lines = source.split('\n');
  let fence = null, displayMath = false, mathParen = false, mathBracket = false;
  const output = [];
  for (const line of lines) {
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line); continue;
    }
    if (fence || /^\s*_{3,}\s*$/.test(line) || /<!--|https?:\/\/|\]\(/.test(line)) {
      output.push(line); continue;
    }
    let codeTicks = 0, inlineMath = false, inHtml = false, result = '';
    for (let i = 0; i < line.length;) {
      const char = line[i];
      if (char === '\\' && line[i+1]) {
        const delimiter = line.slice(i, i+2);
        if (delimiter === '\\(') mathParen = true;
        if (delimiter === '\\)') mathParen = false;
        if (delimiter === '\\[') mathBracket = true;
        if (delimiter === '\\]') mathBracket = false;
        result += delimiter; i += 2; continue;
      }
      if (char === '`' && !displayMath && !mathParen && !mathBracket) {
        let n=1; while (line[i+n] === '`') n++;
        if (codeTicks === 0) codeTicks = n;
        else if (codeTicks === n) codeTicks = 0;
        result += '`'.repeat(n); i += n; continue;
      }
      if (!codeTicks && char === '$' && !mathParen && !mathBracket) {
        if (line[i+1] === '$') { displayMath = !displayMath; result += '$$'; i+=2; continue; }
        if (!displayMath) inlineMath = !inlineMath;
        result += char; i++; continue;
      }
      if (!codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket) {
        if (char === '<') inHtml = true;
        if (char === '>' && inHtml) { inHtml = false; result += char; i++; continue; }
      }
      if (char === '_' && !codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket && !inHtml) {
        let j=i+1; while (line[j] === '_') j++;
        const previous = line[i-1] || '', next = line[j] || '';
        if (j-i >= 3 && !/[\p{L}\p{N}_]/u.test(previous) && !/[\p{L}\p{N}_]/u.test(next)) {
          const em = Math.min(12, Math.max(3, Math.round((j-i)*0.8*10)/10));
          result += `<span class="mwb-fixed-blank" style="width:${em}em" aria-label="填空横线"></span>`;
          i=j; continue;
        }
      }
      result += char; i++;
    }
    output.push(result);
  }
  return output.join('\n');
}

// Rewrite only an explicit edition suffix on the first H1, never an arbitrary
// occurrence of 教师版 in body text (e.g. a lesson *about* version differences).
function projectHandoutHeading(source, mode) {
  if (!['student','teacher'].includes(mode)) return source;
  const lines=source.split('\n'); let fence=null;
  for(let i=0;i<lines.length;i++) {
    const f=lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if(f) {const v=f[1]; if(!fence) fence=v; else if(v[0]===fence[0] && v.length>=fence.length) fence=null; continue;}
    if(fence) continue;
    if(/^#\s+/.test(lines[i])) {
      lines[i]=lines[i].replace(/[（(](?:完整)?(?:教师版|学生版|答案版)[）)]\s*$/,`（${mode==='student'?'学生版':'教师版'}）`);
      break;
    }
  }
  return lines.join('\n');
}

function transformQuestion(markdown, mode, options = {}) {
  if (!['student', 'teacher'].includes(mode)) throw new Error('Invalid export mode');
  assertValidQuestionSource(markdown);
  // Optional metadata supports choice cards whose answer is not immediately
  // between parentheses; never overwrite frontmatter or infer subject data.
  const head = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(head)?.[1] || '';
  const questionType = /^(?:question_type|type):\s*["']?([^\n"'#]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() || '';
  let body = stripFrontmatter(markdown).replace(/\u00A0/g, ' ');
  body = removeSolutionCallouts(body, mode, options);
  return normalizePrintBlanks(rewriteClozes(body, mode));
}

module.exports = { DEFAULTS, stripFrontmatter, pedagogicalCallout, removeSolutionCallouts, rewriteClozes, isChoiceAnswerSlot, validateQuestionSource, assertValidQuestionSource, transformQuestion, normalizePrintBlanks, projectHandoutHeading };

return module.exports; })();
const { stripSolutionsToMarkers } = (() => { const module={exports:{}};
'use strict';

// Student exam space is derived from the *rendered* teacher solution. Do not
// estimate space from Markdown length or modify the source question file.
const { stripFrontmatter, rewriteClozes, transformQuestion, pedagogicalCallout, normalizePrintBlanks } = (()=>{const module={exports:{}};'use strict';

const DEFAULTS = Object.freeze({ stableMs: 650, timeoutMs: 15000 });

function stripFrontmatter(source) {
  const s = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  if (lines[0].trim() !== '---') return s;
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) throw new Error('YAML frontmatter 未闭合；已停止导出以防正文被错误清洗。');
  return lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

// Edition rule: callouts with + or - are teacher-only; without a marker,
// callouts are shared by student and teacher. Teacher-only answer/success
// blocks of ANY type are measured for student writing space.
function pedagogicalCallout(line) {
  // Visibility is determined ONLY by the marker after [!type]:
  // [!type]+ / [!type]- -> teacher-only; [!type] -> shared.
  // This applies to all Obsidian callout types, not just built-in teaching types.
  const match = String(line).match(/^\s*>\s*\[!([\w-]+)\]([+-])?(?:[ \t]+(.*))?\s*$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const title = (match[3] || '').trim();
  const teacherOnly = match[2] === '+' || match[2] === '-';
  let kind = type;
  if (type === 'answer' || type === 'success') kind = 'answer';
  else if (type === 'solution' || (type === 'info' && /^(解析|解题思路)$/.test(title))) kind = 'analysis';
  return { kind, type, title, teacherOnly };
}

function removeSolutionCallouts(source, mode, options = {}) {
  const lines = source.split('\n');
  const output = [];
  let suppress = false;
  let fence = null;
  for (const line of lines) {
    if (suppress && /^\s*>/.test(line)) {
      const nextCallout = pedagogicalCallout(line);
      if (!nextCallout) continue;
      suppress = false;
    } else if (suppress) {
      suppress = false;
    }
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line);
      continue;
    }
    if (fence) { output.push(line); continue; }
    const callout = pedagogicalCallout(line);
    if (callout) {
      suppress = (mode === 'student' && callout.teacherOnly) ||
        (mode === 'teacher' && options.showSolution === false && callout.type === 'solution');
      if (!suppress) {
        // Preview/PDF callouts are always expanded, without editing source.
        output.push(line.replace(/(\[![\w-]+\])[+-]?/i, '$1+'));
      }
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strict answer-slot syntax: parentheses immediately outside ==...== mean
// choice; otherwise the slot is fill-in. Contents and YAML never override it.
// Both ASCII () and full-width （） are accepted, with optional whitespace.
function isChoiceAnswerSlot(_answer, prefix, suffix, _questionType = '') {
  return /[（(]\s*$/.test(prefix) && /^\s*[）)]/.test(suffix);
}

function formatAnswer(answer, mode, inMath, choice = false) {
  // Only surrounding parentheses classify choice slots; never infer from YAML.
  if (choice) {
    if (mode === 'student') return inMath ? '\\hspace{1.4em}' : '<span class="mwb-choice-slot" aria-label="选择题答案留空">&nbsp;&nbsp;</span>';
    if (inMath) return `\\color{red}{${answer}}`;
    const mathChoice = answer.match(/^\$([^$\n]+)\$/);
    return mathChoice ? `$\\color{red}{${mathChoice[1]}}$` : `<span class="mwb-answer-revealed">${escapeHtml(answer)}</span>`;
  }
  if (!inMath) {
    const standaloneMath = answer.match(/^\$([^$\n]+)\$/);
    if (standaloneMath) {
      if (mode === 'teacher') return `$\\underline{\\color{red}{${standaloneMath[1]}}}$`;
      return mwbStudentFillSpan(standaloneMath[1], true);
    }
  }
  if (inMath) {
    return mode === 'student' ? mwbStudentMathFill(answer) : `\\underline{\\color{red}{${answer}}}`;
  }
  return mode === 'student'
    ? mwbStudentFillSpan(answer, false)
    : `<span class="mwb-teacher-fill-slot" aria-label="填空题参考答案">${escapeHtml(answer)}</span>`;
}

// Purposefully conservative: do not transform fenced/inline code, escaped delimiters,
// or a cloze containing a newline. Each ==...== pair is confined to its line.
function rewriteClozes(source, mode, questionType = '') {
  return mwbRewriteTypedAnswers(source,mode);
}

function validateQuestionSource(markdown) {
  return mwbValidateTypedAnswers(markdown);
}

function assertValidQuestionSource(markdown) {
  const errors = validateQuestionSource(markdown);
  if (errors.length) throw new Error('题卡预检未通过：' + errors.join('；'));
}

// Projected print mode only. The raw-document mode intentionally bypasses
// all conversions. Conservative lexer: never replace underscores in code,
// math delimiters, HTML, escaped text, or nonblank identifier tokens.
function normalizePrintBlanks(source) {
  const lines = source.split('\n');
  let fence = null, displayMath = false, mathParen = false, mathBracket = false;
  const output = [];
  for (const line of lines) {
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line); continue;
    }
    if (fence || /^\s*_{3,}\s*$/.test(line) || /<!--|https?:\/\/|\]\(/.test(line)) {
      output.push(line); continue;
    }
    let codeTicks = 0, inlineMath = false, inHtml = false, result = '';
    for (let i = 0; i < line.length;) {
      const char = line[i];
      if (char === '\\' && line[i+1]) {
        const delimiter = line.slice(i, i+2);
        if (delimiter === '\\(') mathParen = true;
        if (delimiter === '\\)') mathParen = false;
        if (delimiter === '\\[') mathBracket = true;
        if (delimiter === '\\]') mathBracket = false;
        result += delimiter; i += 2; continue;
      }
      if (char === '`' && !displayMath && !mathParen && !mathBracket) {
        let n=1; while (line[i+n] === '`') n++;
        if (codeTicks === 0) codeTicks = n;
        else if (codeTicks === n) codeTicks = 0;
        result += '`'.repeat(n); i += n; continue;
      }
      if (!codeTicks && char === '$' && !mathParen && !mathBracket) {
        if (line[i+1] === '$') { displayMath = !displayMath; result += '$$'; i+=2; continue; }
        if (!displayMath) inlineMath = !inlineMath;
        result += char; i++; continue;
      }
      if (!codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket) {
        if (char === '<') inHtml = true;
        if (char === '>' && inHtml) { inHtml = false; result += char; i++; continue; }
      }
      if (char === '_' && !codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket && !inHtml) {
        let j=i+1; while (line[j] === '_') j++;
        const previous = line[i-1] || '', next = line[j] || '';
        if (j-i >= 3 && !/[\p{L}\p{N}_]/u.test(previous) && !/[\p{L}\p{N}_]/u.test(next)) {
          const em = Math.min(12, Math.max(3, Math.round((j-i)*0.8*10)/10));
          result += `<span class="mwb-fixed-blank" style="width:${em}em" aria-label="填空横线"></span>`;
          i=j; continue;
        }
      }
      result += char; i++;
    }
    output.push(result);
  }
  return output.join('\n');
}

// Rewrite only an explicit edition suffix on the first H1, never an arbitrary
// occurrence of 教师版 in body text (e.g. a lesson *about* version differences).
function projectHandoutHeading(source, mode) {
  if (!['student','teacher'].includes(mode)) return source;
  const lines=source.split('\n'); let fence=null;
  for(let i=0;i<lines.length;i++) {
    const f=lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if(f) {const v=f[1]; if(!fence) fence=v; else if(v[0]===fence[0] && v.length>=fence.length) fence=null; continue;}
    if(fence) continue;
    if(/^#\s+/.test(lines[i])) {
      lines[i]=lines[i].replace(/[（(](?:完整)?(?:教师版|学生版|答案版)[）)]\s*$/,`（${mode==='student'?'学生版':'教师版'}）`);
      break;
    }
  }
  return lines.join('\n');
}

function transformQuestion(markdown, mode, options = {}) {
  if (!['student', 'teacher'].includes(mode)) throw new Error('Invalid export mode');
  assertValidQuestionSource(markdown);
  // Optional metadata supports choice cards whose answer is not immediately
  // between parentheses; never overwrite frontmatter or infer subject data.
  const head = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(head)?.[1] || '';
  const questionType = /^(?:question_type|type):\s*["']?([^\n"'#]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() || '';
  let body = stripFrontmatter(markdown).replace(/\u00A0/g, ' ');
  body = removeSolutionCallouts(body, mode, options);
  return normalizePrintBlanks(rewriteClozes(body, mode));
}

module.exports = { DEFAULTS, stripFrontmatter, pedagogicalCallout, removeSolutionCallouts, rewriteClozes, isChoiceAnswerSlot, validateQuestionSource, assertValidQuestionSource, transformQuestion, normalizePrintBlanks, projectHandoutHeading };
;return module.exports;})();

const SLOT_PREFIX = 'MWB_SOLUTION_SPACE_ANCHOR_';
const DEFAULT_SPACE_SETTINGS = Object.freeze({ ratio: 100, minimumCm: 0, chunkCm: 2 });
const CSS_PX_PER_CM = 96 / 2.54;

function objectiveTypeFromFrontmatter(markdown) {
  const lines = String(markdown).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return false;
  let questionType = '', legacyType = '';
  for (const line of lines.slice(1)) {
    if (/^(?:---|\.\.)\s*$/.test(line)) break;
    const found = line.match(/^(question_type|type):\s*([^#]+)?/i);
    if (!found) continue;
    const value = String(found[2] || '').trim().replace(/^['"]|['"]$/g,'').toLowerCase();
    if (found[1].toLowerCase() === 'question_type') questionType = value;
    else legacyType = value;
  }
  const type = (questionType || legacyType).replace(/[\s_-]+/g, '');
  return /^(?:choice|singlechoice|single|multiplechoice|multichoice|multiselect|fillblank|fillin|blank|truefalse|judgment|objective|select|单选题?|多选题?|选择题?|填空题?|判断题?)$/.test(type);
}

function studentSpacePlan(markdown, options = {}) {
  return stripSolutionsToMarkers(markdown, options);
}


function stripSolutionsToMarkers(markdown, options = {}) {
  const lines = stripFrontmatter(String(markdown)).replace(/\u00a0/g, ' ').split('\n');
  const out = [];
  let count = 0;
  let skipping = false;
  let fence = null;
  for (const line of lines) {
    if (skipping && /^\s*>/.test(line)) {
      if (!pedagogicalCallout(line)) continue;
      skipping = false;
    } else if (skipping) {
      skipping = false;
    }
    const found = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (found) {
      const token = found[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    if (fence) { out.push(line); continue; }
    // Every +/- callout is teacher-only and gets one matching blank in the
    // student edition. This takes precedence over the old space=none hint.
    if (/^\s*<!--\s*mathsemble:space=none\s*-->\s*$/i.test(line)) continue;
    const callout = pedagogicalCallout(line);
    if (callout) {
      skipping = callout.teacherOnly;
      if (!skipping) {
        // An unmarked callout is shared, even if its type is answer/scaffold.
        out.push(line.replace(/(\[![\w-]+\])[+-]?/i, '$1+'));
      } else {
        if (out.length && out[out.length - 1] !== '') out.push('');
        if (callout.type !== 'solution' || options.solutionSpaces === true)
          out.push(`${SLOT_PREFIX}${count++}_END`, '');
      }
      continue;
    }
    out.push(line);
  }
  return { markdown: normalizePrintBlanks(rewriteClozes(out.join('\n'), 'student')), count, skipSpaces: [] };
}

// Every Obsidian callout appears in the teacher DOM, while only +/- headers
// create student spaces. Map by full callout ordinal, never by its type.
function teacherOnlyCalloutIndices(markdown, options = {}) {
  const lines = stripFrontmatter(String(markdown)).split('\n');
  const indices = [];
  let seen = 0, fence = null;
  for (const line of lines) {
    const found = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (found) {
      const token = found[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const callout = pedagogicalCallout(line);
    if (callout) {
      if (callout.teacherOnly && (callout.type !== 'solution' || options.solutionSpaces === true)) indices.push(seen);
      seen++;
    }
  }
  return indices;
}

function clampSettings({ ratio = 100, minimumCm = 2 } = {}) {
  const r = Number(ratio), m = Number(minimumCm);
  if (!Number.isFinite(r) || r < 50 || r > 150) throw new Error('留白比例必须在 50%～150% 之间');
  if (!Number.isFinite(m) || m < 0 || m > 10) throw new Error('最小留白必须在 0～10 cm 之间');
  return { ratio: r, minimumCm: m };
}

function spaceHeightPx(solutionHeightPx, settings = DEFAULT_SPACE_SETTINGS) {
  const { ratio, minimumCm } = clampSettings(settings);
  if (!Number.isFinite(solutionHeightPx) || solutionHeightPx <= 0) {
    throw new Error('教师专用块未获得有效高度；已阻止生成不准确的学生留白');
  }
  return Math.max(solutionHeightPx * ratio / 100, minimumCm * CSS_PX_PER_CM);
}

function splitIntoChunks(heightPx, chunkCm = DEFAULT_SPACE_SETTINGS.chunkCm) {
  if (!Number.isFinite(heightPx) || heightPx <= 0) throw new Error('无效留白高度');
  const max = Number(chunkCm) * CSS_PX_PER_CM;
  if (!Number.isFinite(max) || max <= 0) throw new Error('无效分段高度');
  // Do not fragment a short handwriting area into tiny blocks. Long areas
  // use 2cm page-break opportunities instead of the old 3cm jumps.
  if (heightPx <= 3 * CSS_PX_PER_CM) return [heightPx];
  const chunks = [];
  let remains = heightPx;
  while (remains > max + 0.01) { chunks.push(max); remains -= max; }
  if (remains > 0.01) chunks.push(remains);
  return chunks;
}

function outerHeightPx(element, getStyle = (el) => getComputedStyle(el)) {
  const box = element.getBoundingClientRect();
  const css = getStyle(element);
  const mt = parseFloat(css.marginTop) || 0;
  const mb = parseFloat(css.marginBottom) || 0;
  if (!Number.isFinite(box.height) || box.height < 1) {
    throw new Error('教师专用块高度为零：可能尚未展开或完成渲染');
  }
  return box.height + mt + mb;
}

function teacherSolutionHeights(root, expectedCount, calloutIndices, getStyle) {
  const blocks = Array.from(root.querySelectorAll('.callout'));
  const selected = calloutIndices == null ? blocks : calloutIndices.map(i => blocks[i]);
  if (selected.length !== expectedCount || selected.some(block => !block)) {
    throw new Error(`教师专用 Callout 匹配失败：应测量 ${expectedCount} 个，实际选中 ${selected.filter(Boolean).length} 个（教师版全部 ${blocks.length} 个）`);
  }
  return selected.map((block) => {
    if (block.classList?.contains('is-collapsed')) {
      throw new Error('教师专用 Callout 未展开，无法可靠计算学生等高留白');
    }
    return outerHeightPx(block, getStyle);
  });
}

// Replace only unambiguous marker paragraphs; reject content that unexpectedly
// merged with another paragraph or contains HTML from unsafe input.
function injectSpaceNodes(root, heights, settings, doc = document, skipSpaces = []) {
  const matches = [];
  for (const p of root.querySelectorAll('p')) {
    const match = p.textContent.trim().match(/^MWB_SOLUTION_SPACE_ANCHOR_(\d+)_END$/);
    if (match) matches.push({ node: p, index: Number(match[1]) });
  }
  if (matches.length !== heights.length || new Set(matches.map(m => m.index)).size !== heights.length ||
      matches.some(m => m.index >= heights.length || m.index < 0)) {
    throw new Error(`学生答题区域定位失败：预期 ${heights.length} 个，实际 ${matches.length} 个`);
  }
  const omitted = new Set(skipSpaces);
  if (omitted.size !== skipSpaces.length || [...omitted].some(x => !Number.isInteger(x) || x < 0 || x >= heights.length)) {
    throw new Error('无留白标记索引不合法');
  }
  const values = [];
  for (const { node, index } of matches) {
    if (omitted.has(index)) {
      if (typeof node.remove === 'function') node.remove();
      else node.replaceWith(doc.createTextNode(''));
      values[index] = 0;
      continue;
    }
    const height = spaceHeightPx(heights[index], settings);
    const space = doc.createElement('div');
    space.className = 'mwb-answer-space';
    space.setAttribute('aria-label', `第 ${index + 1} 个教师专用块对应的等高留白`);
    space.setAttribute('data-mwb-space-index', String(index));
    space.setAttribute('data-mwb-space-px', height.toFixed(3));
    space.setAttribute('data-mwb-solution-px', heights[index].toFixed(3));
    space.setAttribute('data-mwb-space-ratio', String(clampSettings(settings).ratio));
    // Short blocks stay intact; long ones have page-break opportunities.
    for (const section of splitIntoChunks(height, settings?.chunkCm ?? DEFAULT_SPACE_SETTINGS.chunkCm)) {
      const chunk = doc.createElement('div');
      chunk.className = 'mwb-answer-space-chunk';
      chunk.style.height = `${section.toFixed(3)}px`;
      space.appendChild(chunk);
    }
    node.replaceWith(space);
    values[index] = height;
  }
  return values;
}

// Checks actual PREVIEW geometry, not PDF fragmentation. It is deliberately
// not called a printed-page proof: Chromium may introduce page-break gaps.
function auditSpaceGeometry(root, tolerancePx = 1.5) {
  const entries = [];
  for (const space of root.querySelectorAll('.mwb-answer-space')) {
    const expected = Number(space.getAttribute('data-mwb-space-px'));
    const teacher = Number(space.getAttribute('data-mwb-solution-px'));
    const ratio = Number(space.getAttribute('data-mwb-space-ratio'));
    const actual = space.getBoundingClientRect().height;
    if (!(expected > 0) || !(teacher > 0) || !(actual > 0) || !Number.isFinite(ratio)) {
      throw new Error('答题留白高度审计失败：缺少有效的测量数据');
    }
    const diff = actual - expected;
    if (Math.abs(diff) > Math.max(tolerancePx, expected * 0.01)) {
      throw new Error(`答题留白高度偏差 ${diff.toFixed(1)}px（目标 ${expected.toFixed(1)}px）；已阻止导出`);
    }
    const chunks = [...space.querySelectorAll('.mwb-answer-space-chunk')];
    if (!chunks.length) throw new Error('答题留白分段丢失');
    const sum = chunks.reduce((acc, node) => acc + Number.parseFloat(node.style.height || ''), 0);
    if (!Number.isFinite(sum) || Math.abs(sum - expected) > Math.max(tolerancePx, expected * 0.01)) {
      throw new Error('答题留白分段总高度与目标不符');
    }
    const question = space.closest?.('.mwb-exam-question');
    entries.push({ question: question?.getAttribute('data-mwb-question-number') || null,
      source: question?.getAttribute('data-mwb-source-path') || null,
      teacherPx: teacher, targetPx: expected, actualPx: actual, deltaPx: diff, ratio });
  }
  return entries;
}

function assertMeasurementWidth(reference, measure, tolerancePx = 2) {
  const a = reference.getBoundingClientRect().width;
  const b = measure.getBoundingClientRect().width;
  if (!(a > 0 && b > 0) || Math.abs(a - b) > tolerancePx) {
    throw new Error(`解答测量版心宽度异常：预览 ${a.toFixed(1)}px，测量 ${b.toFixed(1)}px（应保持一致）`);
  }
  return { previewWidth: a, measureWidth: b };
}

module.exports = {
  SLOT_PREFIX, DEFAULT_SPACE_SETTINGS, CSS_PX_PER_CM, objectiveTypeFromFrontmatter, studentSpacePlan, stripSolutionsToMarkers, teacherOnlyCalloutIndices,
  clampSettings, spaceHeightPx, splitIntoChunks, outerHeightPx,
  teacherSolutionHeights, injectSpaceNodes, auditSpaceGeometry, assertMeasurementWidth,
};

return module.exports; })();
const MAX_DOCUMENT_CHARS = 1000000;
const HANDOUT_MODES = Object.freeze(['document', 'student', 'teacher']);
function handoutPlan(markdown, mode = 'document', options = {}) {
  if (!HANDOUT_MODES.includes(mode)) throw new Error('不支持的讲义导出模式');
  if (typeof markdown !== 'string') throw new TypeError('讲义 Markdown 必须是文本');
  if (markdown.length > MAX_DOCUMENT_CHARS) throw new Error('文档大于 100 万字符，建议分册导出');
  // Validate only the modes that interpret ==...== as answer slots.
  // Raw-document mode preserves unrelated Markdown highlighting as authored.
  if (mode !== 'document') {
    const issues = validateQuestionSource(markdown);
    if (issues.length) throw new Error('讲义答案槽预检失败：' + issues.join('；'));
  }
  if (mode === 'student') {
    const plan = stripSolutionsToMarkers(markdown, options);
    return { markdown: projectHandoutHeading(plan.markdown, mode), solutionCount: plan.count, skipSpaces: plan.skipSpaces, mode };
  }
  const body = stripFrontmatter(markdown).replace(/\u00a0/g, ' ');
  if (mode === 'document') return {markdown: body, solutionCount:0, mode};
  return {
    markdown: projectHandoutHeading(normalizePrintBlanks(rewriteClozes(removeSolutionCallouts(body, 'teacher', options), 'teacher')), mode),
    solutionCount: 0,
    mode,
  };
}
module.exports = { handoutPlan, HANDOUT_MODES };

return module.exports; })();
const { exportHtml } = (() => { const module = {exports:{}};
'use strict';

// Dedicated print resource preparation: the isolated file:// document cannot
// resolve app://obsidian.md assets or MathJax's relative font URLs.
const safeTitle = (s) => String(s).replace(/[<>&"']/g, '');
const MEDIA_TYPES = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf',
});

function sanitizeClone(node) {
  const clone = node.cloneNode(true);
  for (const callout of clone.querySelectorAll('.callout.is-collapsed')) {
    callout.classList.remove('is-collapsed');
    if (callout.getAttribute('aria-expanded') === 'false') callout.setAttribute('aria-expanded', 'true');
  }
  for (const content of clone.querySelectorAll('.callout > .callout-content')) {
    if (content.style.display === 'none') content.style.removeProperty('display');
    if (content.getAttribute('aria-hidden') === 'true') content.removeAttribute('aria-hidden');
  }
  clone.querySelectorAll('script, iframe, object, embed, foreignObject, link[rel="preload"]').forEach((el) => el.remove());
  for (const el of clone.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const key = attr.name.toLowerCase();
      if (/^on/.test(key) || key === 'nonce' || key === 'srcdoc') el.removeAttribute(attr.name);
      if (['href', 'src', 'xlink:href', 'formaction'].includes(key) && /^\s*(?:javascript|vbscript):/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return clone;
}

function mimeFor(src, type = '') {
  if (type && /^[-\w]+\/[-\w.+]+$/.test(type)) return type;
  const base = String(src).split(/[?#]/)[0].toLowerCase();
  const extension = base.match(/\.[a-z0-9]+$/)?.[0];
  return MEDIA_TYPES[extension] || 'application/octet-stream';
}

async function toDataUrl(originalUrl, base = (typeof document !== 'undefined' ? document.baseURI : 'file:///')) {
  if (/^data:/i.test(originalUrl)) return originalUrl;
  if (/^(?:javascript|vbscript):/i.test(originalUrl)) throw new Error('已拦截不安全的资源 URL');
  const resolved = new URL(originalUrl, base).href;
  if (!/^(?:https?|app|capacitor|file|blob):/i.test(resolved)) throw new Error('不支持的打印资源地址：' + resolved.slice(0, 100));
  let data;
  let mime;
  if (/^file:/i.test(resolved)) {
    const fs = require('fs');
    const { fileURLToPath } = require('url');
    data = await fs.promises.readFile(fileURLToPath(resolved));
    mime = mimeFor(resolved);
  } else {
    const response = await fetch(resolved);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    data = Buffer.from(await response.arrayBuffer());
    mime = mimeFor(resolved, (response.headers.get('content-type') || '').split(';')[0].trim());
  }
  if (!data.length) throw new Error('资源为空');
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function inlineImages(root, converter = toDataUrl, allowIncompleteImages = false) {
  const targets = [
    ...root.querySelectorAll('img[src]'),
    ...root.querySelectorAll('svg image[href], svg image[xlink\\:href]'),
  ];
  for (const image of targets) {
    const key = image.hasAttribute('src') ? 'src' :
      image.hasAttribute('href') ? 'href' : 'xlink:href';
    const raw = image.getAttribute(key);
    if (!raw || raw.startsWith('#') || /^data:/i.test(raw)) continue;
    try {
      const value = await converter(image.currentSrc && key === 'src' ? image.currentSrc : raw);
      image.setAttribute(key, value);
      if (key === 'src') image.removeAttribute('srcset');
    } catch (error) {
      // Obsidian's private app:// asset scheme may be viewable in <img> yet
      // unavailable through fetch. A same-origin canvas snapshot is a safe
      // fallback for ordinary raster images. Do not rasterize native TikZ SVGs.
      if (key === 'src' && image.complete && image.naturalWidth > 0 && typeof document !== 'undefined') {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('浏览器未提供 Canvas 2D');
          context.drawImage(image, 0, 0);
          image.setAttribute('src', canvas.toDataURL('image/png'));
          image.removeAttribute('srcset');
          continue;
        } catch (_) { /* origin-tainted canvas; keep the original reason */ }
      }
      if (allowIncompleteImages) {
        // Preserve a visible and searchable omission marker instead of leaving
        // a broken app:// URL in a supposedly self-contained PDF.
        if (key === 'src') {
          const marker = image.ownerDocument.createElement('span');
          marker.className = 'mwb-missing-image';
          marker.textContent = '[图片未能导出：' +
            String(image.getAttribute('alt') || raw).slice(0, 90) + ']';
          image.replaceWith(marker);
        } else image.remove();
        continue;
      }
      throw new Error(`图片内联失败（${String(raw).slice(0, 90)}）：${error.message || error}`);
    }
  }
}

function extractMathCss(doc) {
  const groups = [];
  for (const sheet of Array.from(doc.styleSheets || [])) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      for (const rule of rules) {
        const css = rule.cssText;
        // A math-specific sheet may include required @font-face declarations.
        if (/mjx|mathjax/i.test(css) || (/^@font-face/i.test(css) && /MJX|MathJax/i.test(css))) {
          groups.push({ css, base: sheet.href || doc.baseURI });
        }
      }
    } catch (_) { /* opaque external stylesheet: never bypass cross-origin restrictions */ }
  }
  return groups;
}

async function inlineFontCss(groups, converter = toDataUrl) {
  const result = [];
  const cache = new Map();
  for (const item of groups) {
    const css = item.css;
    const re = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi;
    let out = '';
    let cursor = 0;
    for (const m of css.matchAll(re)) {
      out += css.slice(cursor, m.index);
      const url = m[2];
      // Don't rewrite fragments, embedded data or non-font url() from CSS.
      if (/^data:/i.test(url) || url.startsWith('#')) out += m[0];
      else {
        const resolved = new URL(url, item.base).href;
        if (!cache.has(resolved)) cache.set(resolved, converter(resolved));
        let uri;
        try { uri = await cache.get(resolved); }
        catch (e) { throw new Error(`MathJax 字体资源无法内联（${resolved.slice(0, 90)}）：${e.message || e}`); }
        out += `url("${uri}")`;
      }
      cursor = m.index + m[0].length;
    }
    result.push(out + css.slice(cursor));
  }
  return result.join('\n');
}

function assembleHtml(markup, title, typographyCss, mathCss = '') {
  const css = String(typographyCss).replace(/<\/style/gi, '<\\/style');
  const maths = String(mathCss).replace(/<\/style/gi, '<\\/style');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${safeTitle(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">
<style>${maths}</style><style>${css}</style><style>
@page { size: A4 portrait; margin: 14mm 16mm 18mm; }
html,body { background:#fff;color:#141414; margin:0;padding:0; }
body { font-family:"Noto Serif CJK SC","Songti SC","SimSun",serif; font-size:11pt;line-height:1.65; }
.mwb-export-doc { width:100%; box-sizing:border-box; }
/* The print wrapper has the exact same typography class as Obsidian reading. */
</style></head><body><main class="mwb-export-doc mwb-typography mwb-print-document">${markup}</main></body></html>`;
}

async function exportHtml(bodyNode, title, typographyCss, doc = document, options = {}) {
  const clone = sanitizeClone(bodyNode);
  await inlineImages(clone, toDataUrl, options.allowIncompleteImages === true);
  const mathCss = await inlineFontCss(extractMathCss(doc));
  return assembleHtml(clone.innerHTML, title, typographyCss, mathCss);
}

module.exports = { sanitizeClone, mimeFor, toDataUrl, inlineImages, extractMathCss, inlineFontCss, assembleHtml, exportHtml };

return module.exports; })();
const { typographyCss } = (() => { const module = {exports:{}};
module.exports = {typographyCss:"/* Mathsemble style boundaries: modal UI uses .mwb-modal; teaching material\n * uses .mwb-typography; PDF uses .mwb-print-document in isolated HTML.\n * The named teaching callout palette intentionally also works in ordinary notes.\n */\n/* One mathematical typography contract, shared verbatim by reading, A4 preview and PDF.\n * IMPORTANT: MathJax owns <mjx-container> and its descendant SVG dimensions, baseline,\n * viewBox, overflow and font metrics. Never apply generic svg{height:auto} here.\n */\n.mwb-typography {\n  font-family: \"Noto Serif CJK SC\", \"Songti SC\", \"SimSun\", serif;\n  font-size: 11pt;\n  line-height: 1.65;\n  letter-spacing: normal;\n  font-kerning: normal;\n  overflow: visible;\n}\n.mwb-typography p,\n.mwb-typography ul,\n.mwb-typography ol {\n  margin-block: 0.55em;\n  line-height: inherit;\n}\n.mwb-typography li { margin-block: 0.24em; line-height: inherit; }\n.mwb-typography h1,\n.mwb-typography h2,\n.mwb-typography h3,\n.mwb-typography h4 {\n  line-height: 1.45;\n  margin-block: 0.85em 0.4em;\n  break-after: avoid;\n}\n.mwb-typography h1 { font-size: 1.42em; }\n.mwb-typography h2 { font-size: 1.27em; }\n.mwb-typography h3 { font-size: 1.13em; }\n.mwb-typography h4 { font-size: 1.03em; }\n.mwb-typography img {\n  max-width: 100%; height: auto; filter: none;\n  object-fit: contain;\n}\n/* Only known TikZ wrappers are scaled. Never select arbitrary SVG descendants. */\n.mwb-typography :is(.tikzjax, .tikzjax-output, .mwb-tikz, .tikz) > svg,\n.mwb-typography .block-language-tikz svg,\n.mwb-typography .block-language-tikzjax svg {\n  max-width: 100%; height: auto; filter: none;\n}\n.mwb-typography .mwb-answer-slot {\n  display: inline-block;\n  box-sizing: border-box;\n  min-width: 3em;\n  min-height: 1.35em;\n  padding-inline: 0.18em;\n  /* Answer text is intentionally transparent. A currentColor underline would\n     therefore be transparent too; the writing line needs its own ink color. */\n  --mwb-answer-underline-color: var(--text-normal, #141414);\n  border-bottom: 1px solid var(--mwb-answer-underline-color);\n  vertical-align: baseline;\n  color: transparent;\n  white-space: nowrap;\n}\n/* Teacher-mode fill answers: red text centered on a persistent black line.\n * Choice letters use mwb-answer-revealed instead and are never underlined.\n * Math answers use TeX \\underline{\\color{red}{...}} for correct MathJax baselines. */\n.mwb-typography .mwb-teacher-fill-slot {\n  display: inline-block;\n  box-sizing: border-box;\n  min-width: 3em;\n  min-height: 1.35em;\n  padding-inline: 0.18em;\n  border: 0;\n  border-bottom: 1px solid var(--mwb-answer-underline-color, #141414);\n  color: #ad2323;\n  font-weight: 600;\n  text-align: center;\n  white-space: nowrap;\n  vertical-align: baseline;\n  print-color-adjust: exact;\n  -webkit-print-color-adjust: exact;\n}\n.mwb-print-document .mwb-teacher-fill-slot {\n  border-bottom-color: #141414;\n}\n/* Choice slots reserve a little inline space in parentheses, NEVER a writing line. */\n.mwb-typography .mwb-choice-slot,\n.mwb-typography.mwb-print-document .mwb-choice-slot {\n  display: inline-block;\n  min-width: 1.4em;\n  min-height: 0;\n  padding: 0;\n  border: 0;\n  border-bottom: none;\n  box-shadow: none;\n  background: transparent;\n  vertical-align: baseline;\n  text-decoration: none;\n  white-space: nowrap;\n}\n.mwb-typography .mwb-answer-revealed { color: #ad2323; font-weight: 600; }\n.mwb-typography blockquote { margin-block: 0.8em; padding: 0.3em 0.85em; border-left: 3px solid #999; }\n.mwb-typography .callout { border: 1px solid #bbb; border-radius: 4px; padding: 0.4em 0.75em; margin-block: 0.7em; }\n.mwb-print-document .callout-icon,\n.mwb-print-document .callout-fold { display: none; }\n.mwb-typography table { border-collapse: collapse; max-width: 100%; }\n.mwb-typography td, .mwb-typography th { border: 1px solid #999; padding: 0.25em 0.45em; }\n/* A unified print-mode font/color, distinct from dark-theme reading foreground. */\n.mwb-print-document { color: #141414; background: white; }\n/* Keep ink black even when the original Obsidian theme is dark or inherited\n   text fill is transparent. This is separate from the hidden answer content. */\n.mwb-print-document .mwb-answer-slot {\n  --mwb-answer-underline-color: #141414;\n  border-bottom-color: #141414;\n  print-color-adjust: exact;\n  -webkit-print-color-adjust: exact;\n}\n/* Print-oriented teacher solutions: no gray fills; identical in preview/PDF. */\n.mwb-typography.mwb-print-document .callout { background: #fff; border-color: #c4c4c4; border-left: 2px solid #999; }\n/* Teacher solutions must occupy the same geometry in preview and isolated PDF. */\n.mwb-print-document .callout-title { display: block; font-weight: 600; line-height: 1.5; padding: 0; margin: 0 0 0.35em; }\n.mwb-print-document .callout-content { display: block; padding: 0; margin: 0; }\n/* Export-only callout expansion: Obsidian themes can make folded content\n   display:none with higher specificity. Do not change the reading view. */\n.mwb-typography.mwb-print-document .callout > .callout-content,\n.mwb-typography.mwb-print-document .callout.is-collapsed > .callout-content {\n  display: block;\n  visibility: visible;\n}\n.mwb-print-document .callout-content > :first-child { margin-top: 0; }\n.mwb-print-document .callout-content > :last-child { margin-bottom: 0; }\n/* TikZJax can invert drawings in dark themes; the paper output stays unfiltered. */\n/* stylelint-disable-next-line selector-type-no-unknown -- MathJax creates mjx-container DOM elements. */\n.mwb-print-document mjx-container svg { filter: none; }\n.mwb-print-document pre,\n.mwb-print-document figure,\n.mwb-print-document table,\n.mwb-print-document blockquote { break-inside: avoid; }\n.mwb-print-document p,\n.mwb-print-document li { orphans: 2; widows: 2; }\n/* Do not force height, overflow, vertical-align or display on MathJax containers. */\n\n/* Student response space measured from the fully rendered teacher solution.\n * Short questions with a response space are permitted to split on these chunks;\n * the first prompt paragraph remains protected by the rule below. */\n.mwb-print-document .mwb-answer-space {\n  display: block;\n  box-sizing: border-box;\n  width: 100%;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  background: transparent;\n  overflow: visible;\n  break-inside: auto;\n  page-break-inside: auto;\n}\n.mwb-print-document .mwb-answer-space-chunk {\n  box-sizing: border-box;\n  display: block;\n  width: 100%;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  break-inside: avoid;\n  page-break-inside: avoid;\n}\n\n/* v0.1.4: options use the SAME responsive grid after live measurement. */\n.mwb-typography :is(ul,ol).mwb-options {\n  display: grid;\n  gap: 0.3em 12px;\n  margin: 0.3em 0 0.7em;\n  padding: 0;\n  list-style: none;\n  break-inside: avoid;\n}\n.mwb-typography .mwb-options li { list-style: none; margin:0; min-width:0; }\n.mwb-typography .mwb-options-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }\n.mwb-typography .mwb-options-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n.mwb-typography .mwb-options-1 { grid-template-columns: minmax(0, 1fr); }\n/* Measure natural, unwrapped MathJax and text widths without retaining these rules in PDF. */\n.mwb-typography :is(ul,ol).mwb-options.mwb-options-measuring { display: block; padding: 0; margin: 0; }\n.mwb-typography :is(ul,ol).mwb-options.mwb-options-measuring > li {\n  display: block;\n  width: max-content;\n  max-width: none;\n  white-space: nowrap;\n  margin:0;\n  padding:0;\n  list-style:none;\n}\n.mwb-typography .mwb-options-1 > li { overflow-wrap: anywhere; }\n/* Q numbering and sectional headers are print content, not Obsidian file metadata. */\n.mwb-print-document .mwb-exam-title { font-size: 18pt; text-align:center; margin: 0 0 0.85em; line-height:1.4; }\n.mwb-print-document .mwb-exam-section {\n  font-weight:700; font-size: 12pt; margin: 1.15em 0 0.65em;\n  break-after:avoid; page-break-after:avoid;\n}\n.mwb-print-document .mwb-exam-question { margin: 0 0 1.05em; break-inside: auto; }\n.mwb-print-document .mwb-exam-question.mwb-question-keep { break-inside: avoid; page-break-inside: avoid; }\n.mwb-print-document .mwb-number-only { break-after: avoid; page-break-after: avoid; }\n.mwb-print-document .mwb-question-index { font-weight:700; display:inline-block; margin-right:0.42em; white-space:nowrap; vertical-align:baseline; }\n.mwb-print-document .mwb-exam-question-content > p:first-child { break-after: avoid; page-break-after:avoid; }\n/* stylelint-disable-next-line selector-type-no-unknown -- MathJax creates mjx-container DOM elements. */\n.mwb-print-document mjx-container[display=\"true\"],\n.mwb-print-document .math.math-block,\n.mwb-print-document .block-language-tikz,\n.mwb-print-document .block-language-tikzjax { break-inside: avoid; page-break-inside: avoid; }\n/* No forced no-break for a *long* question; a long answer space can split. */\n\n/* v0.1.4.1: MathJax-based answers have a stable underlined inline slot. */\n.mwb-typography .mwb-answer-slot-math { min-width: 3em; height: 1.65em; line-height: 1.65em; }\n.mwb-print-document .mwb-exam-edition {\n  text-align: right; font-size: 9pt; font-weight: 600; color:#444;\n  margin: -0.85em 0 0.85em;\n}\n\n/* Mathsemble mathematics teaching palette — reading-view reach fix (2026-10-23).\n * Read/Live Preview: match native Obsidian .callout markup DIRECTLY, even for\n * notes lacking YAML or Mathsemble class annotations. The previous version\n * required .mwb-math-material/.mwb-answer-note and could miss regular notes.\n * Keep colors independent of teacher/student +/- blank-space projection.\n * Example questions remain ordinary Markdown; [!example] gets no special look.\n * Do not globally style mark, strong, body fonts, or MathJax containers.\n */\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout:is(\n  [data-callout=\"definition\"],\n  [data-callout=\"theorem\"],\n  [data-callout=\"method\"],\n  [data-callout=\"conclusion\"],\n  [data-callout=\"attention\"],\n  [data-callout=\"thinking\"],\n  [data-callout=\"answer\"],\n  [data-callout=\"scaffold\"],\n  [data-callout=\"solution\"]\n) {\n  background-color: transparent;\n  border-left-color: var(--mwb-callout-accent, #999);\n}\n/* A visual accent that does not add border width or change printed heights.\n * The paper layout retains its existing 2px physical left border. */\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6) .callout:is(\n  [data-callout=\"definition\"],\n  [data-callout=\"theorem\"],\n  [data-callout=\"method\"],\n  [data-callout=\"conclusion\"],\n  [data-callout=\"attention\"],\n  [data-callout=\"thinking\"],\n  [data-callout=\"answer\"],\n  [data-callout=\"scaffold\"],\n  [data-callout=\"solution\"]\n) {\n  box-shadow: inset 3px 0 0 var(--mwb-callout-accent, #999);\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout:is(\n  [data-callout=\"definition\"],\n  [data-callout=\"theorem\"],\n  [data-callout=\"method\"],\n  [data-callout=\"conclusion\"],\n  [data-callout=\"attention\"],\n  [data-callout=\"thinking\"],\n  [data-callout=\"answer\"],\n  [data-callout=\"scaffold\"],\n  [data-callout=\"solution\"]\n) > .callout-title {\n  color: var(--mwb-callout-title-ink, #444);\n  font-weight: 600;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"definition\"] {\n  --callout-color: 46, 164, 79;\n  --callout-icon: book-open;\n  --mwb-callout-accent: #2ea44f;\n  --mwb-callout-title-ink: #237b39;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"theorem\"] {\n  --callout-color: 47, 129, 247;\n  --callout-icon: sigma;\n  --mwb-callout-accent: #2f81f7;\n  --mwb-callout-title-ink: #1f64c2;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"method\"] {\n  --callout-color: 155, 89, 182;\n  --callout-icon: lightbulb;\n  --mwb-callout-accent: #9b59b6;\n  --mwb-callout-title-ink: #793a97;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"conclusion\"] {\n  --callout-color: 0, 168, 150;\n  --callout-icon: check-circle;\n  --mwb-callout-accent: #00a896;\n  --mwb-callout-title-ink: #007d70;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"attention\"] {\n  --callout-color: 241, 196, 15;\n  --callout-icon: alert-triangle;\n  --mwb-callout-accent: #f1c40f;\n  --mwb-callout-title-ink: #866600;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"thinking\"] {\n  --callout-color: 99, 110, 114;\n  --callout-icon: help-circle;\n  --mwb-callout-accent: #636e72;\n  --mwb-callout-title-ink: #525c60;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"answer\"] {\n  --callout-color: 230, 126, 34;\n  --callout-icon: list-ordered;\n  --mwb-callout-accent: #e67e22;\n  --mwb-callout-title-ink: #a44f06;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"scaffold\"] {\n  --callout-color: 143, 112, 181;\n  --callout-icon: list-checks;\n  --mwb-callout-accent: #8f70b5;\n  --mwb-callout-title-ink: #684b91;\n}\n:is(.markdown-preview-view, .markdown-source-view.mod-cm6, .mwb-typography) .callout[data-callout=\"solution\"] {\n  --callout-color: 230, 126, 34;\n  --callout-icon: list-ordered;\n  --mwb-callout-accent: #e67e22;\n  --mwb-callout-title-ink: #a44f06;\n}\n\n/* v0.2.1: optional metadata is always separate from math/answer DOM. */\n.mwb-typography .mwb-print-meta { color:#666; font-size:8.5pt; line-height:1.5;\n  display:flex; flex-wrap:wrap; gap:0.12em 1.1em; margin:0.2em 0 0.45em;\n  break-inside:avoid; }\n.mwb-typography .mwb-print-meta-item { white-space:normal; overflow-wrap:anywhere; }\n.mwb-typography .mwb-long-document { line-height:inherit; }\n\n/* v0.1.7: literal Markdown writing blanks, not LaTeX or answer reveal slots. */\n.mwb-typography .mwb-fixed-blank {\n  display:inline-block; box-sizing:border-box; min-height:1em;\n  border-bottom:1px solid #333; margin:0 0.22em; vertical-align:baseline;\n}\n/* Marker + and - control student/teacher projection in JavaScript only.\n * Do not apply visibility, fixed height, text recoloring or break-inside rules\n * based on callout names; long teacher solutions must remain fully measurable. */\n/* Headings must stay with following paragraphs. Do NOT break before all H2:\n   an automatic new page on every unit wastes sheets and disrupts space. */\n@media print {\n  .mwb-print-document h2,.mwb-print-document h3,.mwb-print-document h4 { break-after:avoid; page-break-after:avoid; }\n  .mwb-print-document .mwb-fixed-blank { border-bottom-color:#333; }\n}\n\n/* Modal-only UI rules below are excluded from export CSS. */\n"};
return module.exports; })();
const { DEFAULT_SPACE_SETTINGS, studentSpacePlan, teacherOnlyCalloutIndices, teacherSolutionHeights, injectSpaceNodes, auditSpaceGeometry, assertMeasurementWidth } = (() => { const module = {exports:{}};
'use strict';

// Student exam space is derived from the *rendered* teacher solution. Do not
// estimate space from Markdown length or modify the source question file.
const { stripFrontmatter, rewriteClozes, pedagogicalCallout, normalizePrintBlanks } = (()=>{const module={exports:{}};'use strict';

const DEFAULTS = Object.freeze({ stableMs: 650, timeoutMs: 15000 });

function stripFrontmatter(source) {
  const s = String(source).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  if (lines[0].trim() !== '---') return s;
  const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) throw new Error('YAML frontmatter 未闭合；已停止导出以防正文被错误清洗。');
  return lines.slice(end + 1).join('\n').replace(/^\n+/, '');
}

// Edition rule: callouts with + or - are teacher-only; without a marker,
// callouts are shared by student and teacher. Teacher-only answer/success
// blocks of ANY type are measured for student writing space.
function pedagogicalCallout(line) {
  // Visibility is determined ONLY by the marker after [!type]:
  // [!type]+ / [!type]- -> teacher-only; [!type] -> shared.
  // This applies to all Obsidian callout types, not just built-in teaching types.
  const match = String(line).match(/^\s*>\s*\[!([\w-]+)\]([+-])?(?:[ \t]+(.*))?\s*$/i);
  if (!match) return null;
  const type = match[1].toLowerCase();
  const title = (match[3] || '').trim();
  const teacherOnly = match[2] === '+' || match[2] === '-';
  let kind = type;
  if (type === 'answer' || type === 'success') kind = 'answer';
  else if (type === 'solution' || (type === 'info' && /^(解析|解题思路)$/.test(title))) kind = 'analysis';
  return { kind, type, title, teacherOnly };
}

function removeSolutionCallouts(source, mode, options = {}) {
  const lines = source.split('\n');
  const output = [];
  let suppress = false;
  let fence = null;
  for (const line of lines) {
    if (suppress && /^\s*>/.test(line)) {
      const nextCallout = pedagogicalCallout(line);
      if (!nextCallout) continue;
      suppress = false;
    } else if (suppress) {
      suppress = false;
    }
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line);
      continue;
    }
    if (fence) { output.push(line); continue; }
    const callout = pedagogicalCallout(line);
    if (callout) {
      suppress = (mode === 'student' && callout.teacherOnly) ||
        (mode === 'teacher' && options.showSolution === false && callout.type === 'solution');
      if (!suppress) {
        // Preview/PDF callouts are always expanded, without editing source.
        output.push(line.replace(/(\[![\w-]+\])[+-]?/i, '$1+'));
      }
      continue;
    }
    output.push(line);
  }
  return output.join('\n');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strict answer-slot syntax: parentheses immediately outside ==...== mean
// choice; otherwise the slot is fill-in. Contents and YAML never override it.
// Both ASCII () and full-width （） are accepted, with optional whitespace.
function isChoiceAnswerSlot(_answer, prefix, suffix, _questionType = '') {
  return /[（(]\s*$/.test(prefix) && /^\s*[）)]/.test(suffix);
}

function formatAnswer(answer, mode, inMath, choice = false) {
  // Only surrounding parentheses classify choice slots; never infer from YAML.
  if (choice) {
    if (mode === 'student') return inMath ? '\\hspace{1.4em}' : '<span class="mwb-choice-slot" aria-label="选择题答案留空">&nbsp;&nbsp;</span>';
    if (inMath) return `\\color{red}{${answer}}`;
    const mathChoice = answer.match(/^\$([^$\n]+)\$/);
    return mathChoice ? `$\\color{red}{${mathChoice[1]}}$` : `<span class="mwb-answer-revealed">${escapeHtml(answer)}</span>`;
  }
  if (!inMath) {
    const standaloneMath = answer.match(/^\$([^$\n]+)\$/);
    if (standaloneMath) {
      if (mode === 'teacher') return `$\\underline{\\color{red}{${standaloneMath[1]}}}$`;
      return mwbStudentFillSpan(standaloneMath[1], true);
    }
  }
  if (inMath) {
    return mode === 'student' ? mwbStudentMathFill(answer) : `\\underline{\\color{red}{${answer}}}`;
  }
  return mode === 'student'
    ? mwbStudentFillSpan(answer, false)
    : `<span class="mwb-teacher-fill-slot" aria-label="填空题参考答案">${escapeHtml(answer)}</span>`;
}

// Purposefully conservative: do not transform fenced/inline code, escaped delimiters,
// or a cloze containing a newline. Each ==...== pair is confined to its line.
function rewriteClozes(source, mode, questionType = '') {
  return mwbRewriteTypedAnswers(source,mode);
}

function validateQuestionSource(markdown) {
  return mwbValidateTypedAnswers(markdown);
}

function assertValidQuestionSource(markdown) {
  const errors = validateQuestionSource(markdown);
  if (errors.length) throw new Error('题卡预检未通过：' + errors.join('；'));
}

// Projected print mode only. The raw-document mode intentionally bypasses
// all conversions. Conservative lexer: never replace underscores in code,
// math delimiters, HTML, escaped text, or nonblank identifier tokens.
function normalizePrintBlanks(source) {
  const lines = source.split('\n');
  let fence = null, displayMath = false, mathParen = false, mathBracket = false;
  const output = [];
  for (const line of lines) {
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenced) {
      const token = fenced[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      output.push(line); continue;
    }
    if (fence || /^\s*_{3,}\s*$/.test(line) || /<!--|https?:\/\/|\]\(/.test(line)) {
      output.push(line); continue;
    }
    let codeTicks = 0, inlineMath = false, inHtml = false, result = '';
    for (let i = 0; i < line.length;) {
      const char = line[i];
      if (char === '\\' && line[i+1]) {
        const delimiter = line.slice(i, i+2);
        if (delimiter === '\\(') mathParen = true;
        if (delimiter === '\\)') mathParen = false;
        if (delimiter === '\\[') mathBracket = true;
        if (delimiter === '\\]') mathBracket = false;
        result += delimiter; i += 2; continue;
      }
      if (char === '`' && !displayMath && !mathParen && !mathBracket) {
        let n=1; while (line[i+n] === '`') n++;
        if (codeTicks === 0) codeTicks = n;
        else if (codeTicks === n) codeTicks = 0;
        result += '`'.repeat(n); i += n; continue;
      }
      if (!codeTicks && char === '$' && !mathParen && !mathBracket) {
        if (line[i+1] === '$') { displayMath = !displayMath; result += '$$'; i+=2; continue; }
        if (!displayMath) inlineMath = !inlineMath;
        result += char; i++; continue;
      }
      if (!codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket) {
        if (char === '<') inHtml = true;
        if (char === '>' && inHtml) { inHtml = false; result += char; i++; continue; }
      }
      if (char === '_' && !codeTicks && !displayMath && !inlineMath && !mathParen && !mathBracket && !inHtml) {
        let j=i+1; while (line[j] === '_') j++;
        const previous = line[i-1] || '', next = line[j] || '';
        if (j-i >= 3 && !/[\p{L}\p{N}_]/u.test(previous) && !/[\p{L}\p{N}_]/u.test(next)) {
          const em = Math.min(12, Math.max(3, Math.round((j-i)*0.8*10)/10));
          result += `<span class="mwb-fixed-blank" style="width:${em}em" aria-label="填空横线"></span>`;
          i=j; continue;
        }
      }
      result += char; i++;
    }
    output.push(result);
  }
  return output.join('\n');
}

// Rewrite only an explicit edition suffix on the first H1, never an arbitrary
// occurrence of 教师版 in body text (e.g. a lesson *about* version differences).
function projectHandoutHeading(source, mode) {
  if (!['student','teacher'].includes(mode)) return source;
  const lines=source.split('\n'); let fence=null;
  for(let i=0;i<lines.length;i++) {
    const f=lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if(f) {const v=f[1]; if(!fence) fence=v; else if(v[0]===fence[0] && v.length>=fence.length) fence=null; continue;}
    if(fence) continue;
    if(/^#\s+/.test(lines[i])) {
      lines[i]=lines[i].replace(/[（(](?:完整)?(?:教师版|学生版|答案版)[）)]\s*$/,`（${mode==='student'?'学生版':'教师版'}）`);
      break;
    }
  }
  return lines.join('\n');
}

function transformQuestion(markdown, mode, options = {}) {
  if (!['student', 'teacher'].includes(mode)) throw new Error('Invalid export mode');
  assertValidQuestionSource(markdown);
  // Optional metadata supports choice cards whose answer is not immediately
  // between parentheses; never overwrite frontmatter or infer subject data.
  const head = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const frontmatter = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/.exec(head)?.[1] || '';
  const questionType = /^(?:question_type|type):\s*["']?([^\n"'#]+)["']?\s*$/m.exec(frontmatter)?.[1]?.trim() || '';
  let body = stripFrontmatter(markdown).replace(/\u00A0/g, ' ');
  body = removeSolutionCallouts(body, mode, options);
  return normalizePrintBlanks(rewriteClozes(body, mode));
}

module.exports = { DEFAULTS, stripFrontmatter, pedagogicalCallout, removeSolutionCallouts, rewriteClozes, isChoiceAnswerSlot, validateQuestionSource, assertValidQuestionSource, transformQuestion, normalizePrintBlanks, projectHandoutHeading };
;return module.exports;})();

const SLOT_PREFIX = 'MWB_SOLUTION_SPACE_ANCHOR_';
const DEFAULT_SPACE_SETTINGS = Object.freeze({ ratio: 100, minimumCm: 0, chunkCm: 2 });
const CSS_PX_PER_CM = 96 / 2.54;

function objectiveTypeFromFrontmatter(markdown) {
  const lines = String(markdown).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return false;
  let questionType = '', legacyType = '';
  for (const line of lines.slice(1)) {
    if (/^(?:---|\.\.)\s*$/.test(line)) break;
    const found = line.match(/^(question_type|type):\s*([^#]+)?/i);
    if (!found) continue;
    const value = String(found[2] || '').trim().replace(/^['"]|['"]$/g,'').toLowerCase();
    if (found[1].toLowerCase() === 'question_type') questionType = value;
    else legacyType = value;
  }
  const type = (questionType || legacyType).replace(/[\s_-]+/g, '');
  return /^(?:choice|singlechoice|single|multiplechoice|multichoice|multiselect|fillblank|fillin|blank|truefalse|judgment|objective|select|单选题?|多选题?|选择题?|填空题?|判断题?)$/.test(type);
}

function studentSpacePlan(markdown, options = {}) {
  return stripSolutionsToMarkers(markdown, options);
}


function stripSolutionsToMarkers(markdown, options = {}) {
  const lines = stripFrontmatter(String(markdown)).replace(/\u00a0/g, ' ').split('\n');
  const out = [];
  let count = 0;
  let skipping = false;
  let fence = null;
  for (const line of lines) {
    if (skipping && /^\s*>/.test(line)) {
      if (!pedagogicalCallout(line)) continue;
      skipping = false;
    } else if (skipping) {
      skipping = false;
    }
    const found = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (found) {
      const token = found[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    if (fence) { out.push(line); continue; }
    // Every +/- callout is teacher-only and gets one matching blank in the
    // student edition. This takes precedence over the old space=none hint.
    if (/^\s*<!--\s*mathsemble:space=none\s*-->\s*$/i.test(line)) continue;
    const callout = pedagogicalCallout(line);
    if (callout) {
      skipping = callout.teacherOnly;
      if (!skipping) {
        // An unmarked callout is shared, even if its type is answer/scaffold.
        out.push(line.replace(/(\[![\w-]+\])[+-]?/i, '$1+'));
      } else {
        if (out.length && out[out.length - 1] !== '') out.push('');
        if (callout.type !== 'solution' || options.solutionSpaces === true)
          out.push(`${SLOT_PREFIX}${count++}_END`, '');
      }
      continue;
    }
    out.push(line);
  }
  return { markdown: normalizePrintBlanks(rewriteClozes(out.join('\n'), 'student')), count, skipSpaces: [] };
}

// Every Obsidian callout appears in the teacher DOM, while only +/- headers
// create student spaces. Map by full callout ordinal, never by its type.
function teacherOnlyCalloutIndices(markdown, options = {}) {
  const lines = stripFrontmatter(String(markdown)).split('\n');
  const indices = [];
  let seen = 0, fence = null;
  for (const line of lines) {
    const found = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (found) {
      const token = found[1];
      if (!fence) fence = token;
      else if (token[0] === fence[0] && token.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const callout = pedagogicalCallout(line);
    if (callout) {
      if (callout.teacherOnly && (callout.type !== 'solution' || options.solutionSpaces === true)) indices.push(seen);
      seen++;
    }
  }
  return indices;
}

function clampSettings({ ratio = 100, minimumCm = 2 } = {}) {
  const r = Number(ratio), m = Number(minimumCm);
  if (!Number.isFinite(r) || r < 50 || r > 150) throw new Error('留白比例必须在 50%～150% 之间');
  if (!Number.isFinite(m) || m < 0 || m > 10) throw new Error('最小留白必须在 0～10 cm 之间');
  return { ratio: r, minimumCm: m };
}

function spaceHeightPx(solutionHeightPx, settings = DEFAULT_SPACE_SETTINGS) {
  const { ratio, minimumCm } = clampSettings(settings);
  if (!Number.isFinite(solutionHeightPx) || solutionHeightPx <= 0) {
    throw new Error('教师专用块未获得有效高度；已阻止生成不准确的学生留白');
  }
  return Math.max(solutionHeightPx * ratio / 100, minimumCm * CSS_PX_PER_CM);
}

function splitIntoChunks(heightPx, chunkCm = DEFAULT_SPACE_SETTINGS.chunkCm) {
  if (!Number.isFinite(heightPx) || heightPx <= 0) throw new Error('无效留白高度');
  const max = Number(chunkCm) * CSS_PX_PER_CM;
  if (!Number.isFinite(max) || max <= 0) throw new Error('无效分段高度');
  // Do not fragment a short handwriting area into tiny blocks. Long areas
  // use 2cm page-break opportunities instead of the old 3cm jumps.
  if (heightPx <= 3 * CSS_PX_PER_CM) return [heightPx];
  const chunks = [];
  let remains = heightPx;
  while (remains > max + 0.01) { chunks.push(max); remains -= max; }
  if (remains > 0.01) chunks.push(remains);
  return chunks;
}

function outerHeightPx(element, getStyle = (el) => getComputedStyle(el)) {
  const box = element.getBoundingClientRect();
  const css = getStyle(element);
  const mt = parseFloat(css.marginTop) || 0;
  const mb = parseFloat(css.marginBottom) || 0;
  if (!Number.isFinite(box.height) || box.height < 1) {
    throw new Error('教师专用块高度为零：可能尚未展开或完成渲染');
  }
  return box.height + mt + mb;
}

function teacherSolutionHeights(root, expectedCount, calloutIndices, getStyle) {
  const blocks = Array.from(root.querySelectorAll('.callout'));
  const selected = calloutIndices == null ? blocks : calloutIndices.map(i => blocks[i]);
  if (selected.length !== expectedCount || selected.some(block => !block)) {
    throw new Error(`教师专用 Callout 匹配失败：应测量 ${expectedCount} 个，实际选中 ${selected.filter(Boolean).length} 个（教师版全部 ${blocks.length} 个）`);
  }
  return selected.map((block) => {
    if (block.classList?.contains('is-collapsed')) {
      throw new Error('教师专用 Callout 未展开，无法可靠计算学生等高留白');
    }
    return outerHeightPx(block, getStyle);
  });
}

// Replace only unambiguous marker paragraphs; reject content that unexpectedly
// merged with another paragraph or contains HTML from unsafe input.
function injectSpaceNodes(root, heights, settings, doc = document, skipSpaces = []) {
  const matches = [];
  for (const p of root.querySelectorAll('p')) {
    const match = p.textContent.trim().match(/^MWB_SOLUTION_SPACE_ANCHOR_(\d+)_END$/);
    if (match) matches.push({ node: p, index: Number(match[1]) });
  }
  if (matches.length !== heights.length || new Set(matches.map(m => m.index)).size !== heights.length ||
      matches.some(m => m.index >= heights.length || m.index < 0)) {
    throw new Error(`学生答题区域定位失败：预期 ${heights.length} 个，实际 ${matches.length} 个`);
  }
  const omitted = new Set(skipSpaces);
  if (omitted.size !== skipSpaces.length || [...omitted].some(x => !Number.isInteger(x) || x < 0 || x >= heights.length)) {
    throw new Error('无留白标记索引不合法');
  }
  const values = [];
  for (const { node, index } of matches) {
    if (omitted.has(index)) {
      if (typeof node.remove === 'function') node.remove();
      else node.replaceWith(doc.createTextNode(''));
      values[index] = 0;
      continue;
    }
    const height = spaceHeightPx(heights[index], settings);
    const space = doc.createElement('div');
    space.className = 'mwb-answer-space';
    space.setAttribute('aria-label', `第 ${index + 1} 个教师专用块对应的等高留白`);
    space.setAttribute('data-mwb-space-index', String(index));
    space.setAttribute('data-mwb-space-px', height.toFixed(3));
    space.setAttribute('data-mwb-solution-px', heights[index].toFixed(3));
    space.setAttribute('data-mwb-space-ratio', String(clampSettings(settings).ratio));
    // Short blocks stay intact; long ones have page-break opportunities.
    for (const section of splitIntoChunks(height, settings?.chunkCm ?? DEFAULT_SPACE_SETTINGS.chunkCm)) {
      const chunk = doc.createElement('div');
      chunk.className = 'mwb-answer-space-chunk';
      chunk.style.height = `${section.toFixed(3)}px`;
      space.appendChild(chunk);
    }
    node.replaceWith(space);
    values[index] = height;
  }
  return values;
}

// Checks actual PREVIEW geometry, not PDF fragmentation. It is deliberately
// not called a printed-page proof: Chromium may introduce page-break gaps.
function auditSpaceGeometry(root, tolerancePx = 1.5) {
  const entries = [];
  for (const space of root.querySelectorAll('.mwb-answer-space')) {
    const expected = Number(space.getAttribute('data-mwb-space-px'));
    const teacher = Number(space.getAttribute('data-mwb-solution-px'));
    const ratio = Number(space.getAttribute('data-mwb-space-ratio'));
    const actual = space.getBoundingClientRect().height;
    if (!(expected > 0) || !(teacher > 0) || !(actual > 0) || !Number.isFinite(ratio)) {
      throw new Error('答题留白高度审计失败：缺少有效的测量数据');
    }
    const diff = actual - expected;
    if (Math.abs(diff) > Math.max(tolerancePx, expected * 0.01)) {
      throw new Error(`答题留白高度偏差 ${diff.toFixed(1)}px（目标 ${expected.toFixed(1)}px）；已阻止导出`);
    }
    const chunks = [...space.querySelectorAll('.mwb-answer-space-chunk')];
    if (!chunks.length) throw new Error('答题留白分段丢失');
    const sum = chunks.reduce((acc, node) => acc + Number.parseFloat(node.style.height || ''), 0);
    if (!Number.isFinite(sum) || Math.abs(sum - expected) > Math.max(tolerancePx, expected * 0.01)) {
      throw new Error('答题留白分段总高度与目标不符');
    }
    const question = space.closest?.('.mwb-exam-question');
    entries.push({ question: question?.getAttribute('data-mwb-question-number') || null,
      source: question?.getAttribute('data-mwb-source-path') || null,
      teacherPx: teacher, targetPx: expected, actualPx: actual, deltaPx: diff, ratio });
  }
  return entries;
}

function assertMeasurementWidth(reference, measure, tolerancePx = 2) {
  const a = reference.getBoundingClientRect().width;
  const b = measure.getBoundingClientRect().width;
  if (!(a > 0 && b > 0) || Math.abs(a - b) > tolerancePx) {
    throw new Error(`解答测量版心宽度异常：预览 ${a.toFixed(1)}px，测量 ${b.toFixed(1)}px（应保持一致）`);
  }
  return { previewWidth: a, measureWidth: b };
}

module.exports = {
  SLOT_PREFIX, DEFAULT_SPACE_SETTINGS, CSS_PX_PER_CM, objectiveTypeFromFrontmatter, studentSpacePlan, stripSolutionsToMarkers, teacherOnlyCalloutIndices,
  clampSettings, spaceHeightPx, splitIntoChunks, outerHeightPx,
  teacherSolutionHeights, injectSpaceNodes, auditSpaceGeometry, assertMeasurementWidth,
};

return module.exports; })();
const { collectExamItems, layoutOptionGrids, markShortQuestions, insertQuestionNumber, classifyQuestionType, GROUPING_MODES, TEACHING_ROLES, teachingRoleMetadata, teachingRoleSummary, metadataOf, metadataAudit } = (() => { const module = {exports:{}};
'use strict';

// Pure classification and pagination policy. The source Markdown remains read-only.
// Independent pedagogical role. This must not be inferred from family_id, source
// filenames, original book headings, or mathematical question type.
const TEACHING_ROLES = Object.freeze([
  { id: 'example', label: '例题' },
  { id: 'variant', label: '变式' },
  { id: 'practice', label: '练习' },
  { id: 'assessment', label: '检测' },
]);
const ROLE_ALIASES = Object.freeze({
  'example':'example', '例题':'example',
  'variant':'variant', '变式':'variant',
  'practice':'practice', '练习':'practice',
  'assessment':'assessment', '检测':'assessment', 'test':'assessment', 'homework':'homework',
});
function normalizeTeachingRole(raw) {
  const token = String(raw ?? '').trim().toLowerCase();
  return ROLE_ALIASES[token] || null;
}
function teachingRoleMetadata(markdown) {
  const raw = frontmatterValue(markdown, 'teaching_role') || frontmatterValue(markdown, 'role');
  const role = normalizeTeachingRole(raw);
  return { raw, role, label: TEACHING_ROLES.find(x=>x.id === role)?.label || '',
    state: !raw ? 'missing' : role ? 'valid' : 'invalid' };
}
function teachingRoleSummary(items) {
  const counts = Object.fromEntries(TEACHING_ROLES.map(x => [x.id, 0]));
  counts.homework = 0;
  let missing = 0, invalid = 0;
  for (const item of items) {
    const info = item.teachingRole || teachingRoleMetadata(item.markdown);
    if (info.state === 'missing') missing++;
    else if (info.state === 'invalid') invalid++;
    else counts[info.role]++;
  }
  const text = TEACHING_ROLES.filter(x=>counts[x.id]).map(x=>`${x.label}${counts[x.id]}`);
  if (counts.homework) text.push(`作业${counts.homework}`);
  if (missing) text.push(`未标注${missing}`);
  if (invalid) text.push(`无效值${invalid}`);
  return text.length ? text.join('、') : '无题卡';
}

const GROUPS = Object.freeze([
  { id: 'single', title: '一、单项选择题' },
  { id: 'multiple', title: '二、多项选择题' },
  { id: 'fill', title: '三、填空题' },
  { id: 'solution', title: '四、解答题' },
  { id: 'judgment', title: '五、判断题' },
  { id: 'other', title: '六、其他题型' },
]);

function frontmatterValue(markdown, field) {
  const s = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  if (lines[0].trim() !== '---') return '';
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) break;
    const match = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*$/);
    if (match && match[1].toLowerCase() === field.toLowerCase()) {
      return match[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return '';
}

// A narrow markdown-YAML reader only for offline fallback and tests. In real
// Obsidian, metadataCache.frontmatter is authoritative and parses YAML arrays.
// Never reinterpret a source file, folder name, or free-text chapter as a
// knowledge-node ID. Missing IDs stay missing.
function frontmatterSubset(markdown) {
  const lines = String(markdown).replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n').split('\n');
  if (lines[0]?.trim() !== '---') return {};
  const data = {};
  let active = null;
  for (const line of lines.slice(1)) {
    if (/^(---|\.\.)\s*$/.test(line)) break;
    const key = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (key) {
      active = key[1];
      const raw = key[2].replace(/\s+#.*$/, '').trim();
      if (raw.startsWith('[') && raw.endsWith(']')) {
        data[active] = raw.slice(1,-1).trim() ? raw.slice(1,-1).split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean) : [];
      } else if (raw) data[active] = raw.replace(/^['"]|['"]$/g,'');
      else data[active] = null;
      continue;
    }
    if (active && /^\s+-\s+/.test(line)) {
      if (!Array.isArray(data[active])) data[active] = [];
      data[active].push(line.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g,''));
    }
  }
  return data;
}
function metadataOf(record) {
  return record?.metadata && typeof record.metadata === 'object'
    ? record.metadata : frontmatterSubset(record?.markdown || '');
}
function normalizedKnowledgeNodes(meta) {
  const raw = meta?.knowledge_nodes;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' && raw.trim() ? [raw] : [];
  return [...new Set(values.filter(x => typeof x === 'string').map(x=>x.trim()).filter(Boolean))];
}
function classifyQuestionType(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (/^(choice|singlechoice|single|单选题?|单项选择题?|单选)$/.test(s)) return 'single';
  if (/^(multiplechoice|multichoice|multiselect|多选题?|多项选择题?)$/.test(s)) return 'multiple';
  if (/^(fillblank|fillin|blank|填空题?|填空)$/.test(s)) return 'fill';
  if (/^(truefalse|judgment|判断题?|判断)$/.test(s)) return 'judgment';
  if (/^(shortanswer|calculation|proof|comprehensive|longanswer|constructedresponse|solution|subjective|calculate|计算题?|证明题?|应用题?|解答题?|解答)$/.test(s)) return 'solution';
  return 'other';
}
const GROUPING_MODES = Object.freeze([
  {id:'question_type',label:'按题型分组'},
  {id:'knowledge_nodes',label:'按知识点分组'},
]);
function isRecognizedItem(meta) {
  return /^(item|question|题素|试题)$/.test(String(meta?.object_type||'').toLowerCase());
}
function metadataAudit(meta) {
  const required = ['id','chapter_id','section_id','question_type','role','teaching_tier','difficulty','knowledge_nodes'];
  const missing = required.filter(key => {
    const value = meta?.[key];
    return value == null || value === '' || (Array.isArray(value) && !value.length);
  });
  // Nullable structural fields are required as keys but may explicitly be null.
  // Distinguish unknown from fabricated IDs and avoid coercing absence to truth.
  for (const key of ['family_id','parent_id','question_group_id','methods','source','assets']) {
    if (!Object.prototype.hasOwnProperty.call(meta || {},key)) missing.push(key);
  }
  const warnings=[];
  const formal = classifyQuestionType(meta?.question_type);
  const legacy = classifyQuestionType(meta?.type);
  if (meta?.question_type && meta?.type && formal !== legacy) warnings.push('question_type 与 type 题型冲突');
  if (meta?.question_type && !['choice','multiple_choice','fill_blank','true_false','short_answer','calculation','proof','comprehensive'].includes(String(meta.question_type).toLowerCase())) {
    warnings.push('question_type 不在正式题型枚举中');
  }
  if (meta?.knowledge_nodes !== undefined && !Array.isArray(meta.knowledge_nodes)) {
    warnings.push('knowledge_nodes 必须为列表，不得写成单一标量');
  }
  const role = String(meta?.role || '').trim().toLowerCase();
  if (role && !['example','variant','practice','homework','test'].includes(role)) {
    warnings.push('role 不在正式教学角色枚举中');
  }
  const roleAlias = String(meta?.teaching_role || '').trim().toLowerCase();
  if (role && roleAlias && role !== roleAlias && !(role === 'test' && roleAlias === 'assessment')) {
    warnings.push('role 与 teaching_role 教学角色不一致');
  }
  if (meta?.difficulty !== undefined && meta.difficulty !== null && meta.difficulty !== '' &&
      !(Number.isInteger(Number(meta.difficulty)) && Number(meta.difficulty)>=1 && Number(meta.difficulty)<=5)) {
    warnings.push('difficulty 应为 1～5 整数');
  }
  if (meta?.teaching_tier && !['基础','核心','培优','扩展'].includes(meta.teaching_tier)) {
    warnings.push('teaching_tier 必须为基础/核心/培优/扩展');
  }
  if (role === 'variant' && !meta?.parent_id) warnings.push('变式缺少 parent_id，需人工确认母题关系');
  return {missing, warnings};
}
function collectExamItems(records, {groupBy='question_type'} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!GROUPING_MODES.some(x=>x.id === groupBy)) throw new Error('不支持的组卷分组方式');
  const collator = new Intl.Collator('zh-CN', {numeric:true, sensitivity:'base'});
  const groups = new Map();
  const items = [];
  for (const record of records) {
    if (!record?.file?.path || typeof record.markdown !== 'string') continue;
    const meta = metadataOf(record);
    const group = classifyQuestionType(meta.question_type || meta.type);
    if (!isRecognizedItem(meta) && group === 'other') continue;
    const nodes = normalizedKnowledgeNodes(meta);
    const item = {...record, group, knowledgeNodes:nodes,
      teachingRole: teachingRoleMetadata(record.markdown), metadataAudit:metadataAudit(meta)};
    items.push(item);
    // Each item has ONE primary knowledge node for grouping. All other nodes
    // stay on the record for future multi-select search; avoid duplicate items.
    const key = groupBy === 'question_type' ? group : nodes[0] || '__unknown__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = groupBy === 'question_type' ? GROUPS.map(x=>x.id).filter(x=>groups.has(x))
    : [...groups.keys()].sort((a,b)=>a==='__unknown__'?1:b==='__unknown__'?-1:collator.compare(a,b));
  const ordered=[], sections=[];
  let sectionIndex=0;
  for (const key of keys) {
    const entries = groups.get(key).sort((a,b)=>collator.compare(a.file.path,b.file.path));
    const groupName=GROUPS.find(x=>x.id===key)?.title;
    const title=groupBy==='question_type' ? groupName :
      `${++sectionIndex}、${key==='__unknown__' ? '未标注知识点' : '知识点：'+key}`;
    sections.push({id:key,title,start:ordered.length,count:entries.length});
    for (const item of entries) ordered.push({...item, sectionKey:key, number:ordered.length+1});
  }
  return {items:ordered, sections, groupBy};
}

const OPTION_RE = /^\s*(?:[（(]\s*([ABCD])\s*[)）]|([ABCD])\s*[.．、:：])\s*/i;
function optionLabel(text) {
  const match = String(text).match(OPTION_RE);
  return match ? (match[1] || match[2]).toUpperCase() : null;
}
function optionListLabels(list) {
  const children = Array.from(list?.children || []);
  if (children.length !== 4 || children.some(el => String(el.tagName || '').toUpperCase() !== 'LI')) return null;
  const labels = children.map(el => optionLabel(el.textContent));
  return labels.join('') === 'ABCD' ? labels : null;
}

function gridColumns(widths, availableWidth, gap = 12) {
  if (!Array.isArray(widths) || widths.length !== 4 || widths.some(w => !Number.isFinite(w) || w <= 0) ||
      !Number.isFinite(availableWidth) || availableWidth <= 0) throw new Error('选项测量失败：宽度无效');
  const max = Math.max(...widths);
  if (max <= Math.min(availableWidth * 0.23, (availableWidth - gap * 3) / 4)) return 4;
  if (max <= Math.min(availableWidth * 0.48, (availableWidth - gap) / 2)) return 2;
  return 1;
}

// One-paragraph A-D options written with spaces instead of Markdown lists.
// Only promote text-only paragraphs: splitting a MathJax DOM subtree or rich
// HTML by regex would destroy rendered formulas. Lists already support math.
function splitInlineOptions(source) {
  const text = String(source).trim();
  const re=/(^|[\s\u3000])([ABCD])[.．、:：]\s*/g;
  const marks=[]; let match;
  while((match=re.exec(text))!==null) {
    marks.push({start:match.index+match[1].length, end:re.lastIndex, label:match[2]});
  }
  if (marks.length!==4 || marks.map(m=>m.label).join('')!=='ABCD' || text.slice(0,marks[0].start).trim()) return null;
  const chunks = marks.map((m,i) => text.slice(m.end, i+1<4?marks[i+1].start:text.length).trim());
  if (chunks.some(x=>!x)) return null;
  return chunks.map((chunk,i)=>`${marks[i].label}．${chunk}`);
}
function promoteInlineOptions(root) {
  let count=0;
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (!p.childNodes || !p.ownerDocument || !Array.from(p.childNodes).every(node=>node.nodeType===3)) continue;
    const choices=splitInlineOptions(p.textContent);
    if (!choices) continue;
    const ul=p.ownerDocument.createElement('ul');
    ul.className='mwb-inline-options';
    for (const choice of choices) { const li=p.ownerDocument.createElement('li'); li.textContent=choice; ul.appendChild(li); }
    p.replaceWith(ul); count++;
  }
  return count;
}

// Measuring in the live A4 preview yields the rendered width of nested MathJax
// and literal option text, not a rough count of characters.
function layoutOptionGrids(root, getStyle = (el) => getComputedStyle(el)) {
  promoteInlineOptions(root);
  const results = [];
  for (const list of root.querySelectorAll('ul, ol')) {
    if (!optionListLabels(list)) continue;
    list.classList.remove('mwb-options', 'mwb-options-1', 'mwb-options-2', 'mwb-options-4');
    list.classList.add('mwb-options-measuring');
    const children = Array.from(list.children);
    const width = list.getBoundingClientRect().width;
    const widths = children.map(li => li.getBoundingClientRect().width);
    const columns = gridColumns(widths, width, 12);
    list.classList.remove('mwb-options-measuring');
    list.classList.add('mwb-options', `mwb-options-${columns}`);
    results.push({columns, widths, availableWidth:width});
  }
  return results;
}

const MM_PX = 96 / 25.4;
const PRINT_CONTENT_HEIGHT_PX = (297 - 14 - 18) * MM_PX;
const SHORT_KEEP_RATIO = 0.32; // only genuinely short questions remain indivisible
function shouldKeepQuestion(heightPx, pageHeightPx = PRINT_CONTENT_HEIGHT_PX) {
  return Number.isFinite(heightPx) && heightPx > 0 && heightPx <= pageHeightPx * SHORT_KEEP_RATIO;
}
function markShortQuestions(root, getStyle = (el) => getComputedStyle(el)) {
  let kept = 0;
  for (const section of root.querySelectorAll('.mwb-exam-question')) {
    section.classList.remove('mwb-question-keep');
    // A short prompt plus a measured response space is NOT indivisible. Keeping
    // the entire question forces needless blank tails and single-question pages.
    // The prompt's opening paragraph remains protected by the CSS rule below.
    if (section.querySelector?.('.mwb-answer-space')) continue;
    const style = getStyle(section);
    const height = section.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    if (shouldKeepQuestion(height)) {section.classList.add('mwb-question-keep'); kept++;}
  }
  return kept;
}
// Put the number in the actual first question paragraph, never in a separate
// block which creates an unwanted line break and orphaned number.
function insertQuestionNumber(content, number, doc = content.ownerDocument) {
  if (!Number.isInteger(number) || number < 1) throw new Error('无效题号');
  const span = doc.createElement('span');
  span.className = 'mwb-question-index';
  span.textContent = `${number}.`;
  const first = content.firstElementChild;
  if (first && first.tagName?.toUpperCase() === 'P') {
    first.prepend(span);
  } else {
    const paragraph = doc.createElement('p');
    paragraph.className = 'mwb-number-only';
    paragraph.appendChild(span);
    content.prepend(paragraph);
  }
  return span;
}

module.exports = { GROUPS, GROUPING_MODES, TEACHING_ROLES, normalizeTeachingRole, teachingRoleMetadata, teachingRoleSummary, frontmatterValue, frontmatterSubset, metadataOf, normalizedKnowledgeNodes, metadataAudit, classifyQuestionType, collectExamItems, insertQuestionNumber,
  optionLabel, optionListLabels, gridColumns, splitInlineOptions, promoteInlineOptions, layoutOptionGrids,
  PRINT_CONTENT_HEIGHT_PX, SHORT_KEEP_RATIO, shouldKeepQuestion, markShortQuestions };

return module.exports; })();

const { normalizedQuestionType, createMathAnswerEditorExtension, refreshQuestionEditors, syncQuestionViewClasses, answerSlots, mathAnswerSlots, mwbMapUnchangedAnswerSlots, mwbVisibleAnswerSlots, buildMathAnswerDecorations } = (() => { const module = {exports:{}};
'use strict';

// Reading View uses MarkdownPostProcessor; Live Preview uses CodeMirror DOM.
// Never change the stored Markdown. Read math positions from the source and
// modify only *matching* rendered math nodes to avoid hiding unrelated formulas.
const QUESTION_VIEW_CLASS = 'mwb-question-note';
const READING_MARK_CLASS = 'mwb-hover-answer';
const CHOICE_MARK_CLASS = 'mwb-choice-answer';
const FILL_MARK_CLASS = 'mwb-fill-answer';
const LIVE_MATH_CLASS = 'mwb-live-answer-math';

function normalizedQuestionType(fm) {
  const type = String(fm?.question_type || fm?.type || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^(singlechoice|multiplechoice|choice|multichoice|multiselect|单选|单项选择|多选|多项选择|选择题)$/.test(type)) return 'choice';
  if (/^(fillblank|fill|blank|填空|填空题)$/.test(type)) return 'fill';
  return 'other';
}

// Only the surrounding punctuation classifies a slot. The answer text
// itself (letters, numbers, math) and YAML question_type are irrelevant.
function syncQuestionViewClasses(leaves, getFrontmatter, isQuestion) {
  let updated = 0;
  for (const leaf of leaves || []) {
    const view = leaf?.view;
    if (!view?.containerEl?.classList) continue;
    const frontmatter = view.file ? getFrontmatter(view.file) : null;
    const question = !!isQuestion(frontmatter);
    const mathMaterial = question || /^(?:handout|lesson|lecture|worksheet|讲义|试卷)$/i
      .test(String(frontmatter?.note_type || '').trim());
    view.containerEl.classList.toggle('mwb-math-material', mathMaterial);
    view.containerEl.classList.toggle(QUESTION_VIEW_CLASS, question);
    // The Reading View postprocessor marks typed answers after rendering.
    // Metadata updates may fire on each keystroke: never read and rescan the
    // entire editor just to toggle a cosmetic CSS scope. Live Preview widget
    // styles do not need this class and are managed by CodeMirror directly.
    const hasAnswers = !!view.containerEl.querySelector?.(
      'mark.mwb-hover-answer, .mwb-reading-answer-math, .mwb-cm-math-answer-slot, .mwb-cm-text-answer-slot');
    view.containerEl.classList.toggle('mwb-answer-note', hasAnswers);
    view.containerEl.classList.toggle('mwb-question-choice', question && normalizedQuestionType(frontmatter) === 'choice');
    view.containerEl.classList.toggle('mwb-question-fill', question && normalizedQuestionType(frontmatter) === 'fill');
    updated++;
  }
  return updated;
}

// Return cloze boundaries in the original line; only complete, unescaped pairs.
// Exact source ranges matter when there are several formulas on one line.
function answerSlots(markdown) {
  return mwbTypedSlots(markdown);
}

function mathAnswerSlots(markdown) {
  return answerSlots(markdown).filter(slot=>slot.latex !== undefined);
}

function isLivePreviewEditor(view) {
  return !!view?.dom?.closest?.('.markdown-source-view.mod-cm6.is-live-preview');
}

function overlapsSelection(selection,from,to) {
  return (selection?.ranges || []).some(r => {
    const a=Math.min(r.from ?? r.anchor ?? 0,r.to ?? r.head ?? 0);
    const b=Math.max(r.from ?? r.anchor ?? 0,r.to ?? r.head ?? 0);
    // Cursor on either typed-slot delimiter exposes the editable source.
    return a===b ? a>=from && a<=to : a<to && b>from;
  });
}

// Reuse the answer index for non-structural edits outside existing tokens.
// Markup, math, callout, fence, indentation and token edits all trigger a
// complete rescan to preserve the existing conservative Markdown semantics.
function mwbMapUnchangedAnswerSlots(slots, update) {
  if (!Array.isArray(slots) || !update?.changes?.iterChanges ||
      !update?.changes?.mapPos || !update?.startState?.doc || !update?.state?.doc) return null;
  let reusable = true, changed = false;
  const structural = /[\x60~$\\?!{}\[\]<>+\-.\r\n]/;
  const specialLine = /^\s*(?:>|---|\.\.\.|[\x60~]{3,})/;
  update.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    if (!reusable) return;
    changed = true;
    const removed = update.startState.doc.sliceString(fromA, toA);
    const added = inserted.toString();
    if (structural.test(removed + added)) { reusable = false; return; }
    const oldLine = update.startState.doc.lineAt(fromA);
    const newLine = update.state.doc.lineAt(fromB);
    if (specialLine.test(oldLine.text) || specialLine.test(newLine.text) ||
        (/\s/.test(removed + added) &&
          (fromA - oldLine.from < 4 || fromB - newLine.from < 4))) {
      reusable = false; return;
    }
    // Editing inside (or immediately at the edge of) a token changes the
    // answer width/widget even when no delimiter was typed.
    if (slots.some(slot => fromA <= slot.to && toA >= slot.from)) reusable = false;
  });
  if (!reusable || !changed) return null;
  return slots.map(slot => ({
    ...slot,
    from: update.changes.mapPos(slot.from, -1),
    to: update.changes.mapPos(slot.to, 1),
  }));
}

function mwbVisibleAnswerSlots(slots, visibleRanges) {
  if (!visibleRanges?.length) return slots;
  const visible = [];
  let i = 0;
  for (const range of visibleRanges) {
    while (i < slots.length && slots[i].to < range.from) i++;
    for (let k = i; k < slots.length && slots[k].from <= range.to; k++) {
      const slot = slots[k];
      if (slot.to >= range.from && !visible.includes(slot)) visible.push(slot);
    }
  }
  return visible;
}

function buildMathAnswerDecorations(view, engine, cachedSlots = null) {
  if (!isLivePreviewEditor(view)) return engine.Decoration.none;
  // The CodeMirror ViewPlugin keeps the full-document index. Scrolling and
  // cursor movement reuse it without allocating or rescanning source text.
  const slots = cachedSlots === null ? answerSlots(view.state.doc.toString()) : cachedSlots;
  if (!slots.length) return engine.Decoration.none;
  const ranges = [];
  for (const slot of mwbVisibleAnswerSlots(slots, view.visibleRanges)) {
    if (overlapsSelection(view.state.selection, slot.from, slot.to)) continue;
    const widget = slot.latex !== undefined
      ? new engine.MathAnswerWidget(slot, engine)
      : new engine.TextAnswerWidget(slot);
    ranges.push(engine.Decoration.replace({widget}).range(slot.from, slot.to));
  }
  return engine.Decoration.set(ranges, true);
}

// A real CodeMirror ViewPlugin registered through Obsidian's public plugin API.
// Obsidian supplies its own @codemirror/view module; never ship an independent
// copy, as that would create incompatible Decoration/EditorView class identities.
function createMathAnswerEditorExtension(cmModule, renderMath, finishRenderMath, options={}) {
  if (!cmModule?.ViewPlugin || !cmModule?.Decoration || !cmModule?.WidgetType)
    throw new Error('CodeMirror 6 运行时不完整');
  const {ViewPlugin,Decoration,WidgetType}=cmModule;
  class MathAnswerWidget extends WidgetType {
    constructor(slot) { super(); this.slot=slot; }
    eq(other) {return this.slot.raw===other.slot.raw && this.slot.from===other.slot.from;}
    toDOM(view) {
      const root=document.createElement('span');
      root.className='mwb-cm-math-answer-slot '+(this.slot.choice?'mwb-choice-answer':'mwb-fill-answer');
      root.setAttribute('aria-label',(this.slot.choice?'选择':'填空')+'答案，鼠标悬停查看，点击编辑');
      root.setAttribute('title','悬停查看答案，点击编辑');
      root.setAttribute('contenteditable','false');
      const answer=document.createElement('span');
      answer.className='mwb-cm-math-answer-content';
      try {
        if (typeof renderMath==='function') answer.appendChild(renderMath(this.slot.latex,false));
        else answer.textContent=this.slot.latex;
        if (typeof finishRenderMath==='function') Promise.resolve(finishRenderMath()).catch(()=>{});
      } catch (_) {answer.textContent=this.slot.latex;}
      root.appendChild(answer);
      root.addEventListener('mousedown',(event)=>{
        // The replacement is only a view decoration. One click restores the
        // original typed TeX source for editing; no vault write is performed.
        event.preventDefault();
        const pos=this.slot.from+2;
        view.dispatch({selection:{anchor:pos}});
        view.focus();
      });
      return root;
    }
    ignoreEvent() { return true; }
  }
  class TextAnswerWidget extends WidgetType {
    constructor(slot) { super(); this.slot=slot; }
    eq(other) {return this.slot.raw===other.slot.raw && this.slot.choice===other.slot.choice && this.slot.from===other.slot.from;}
    toDOM(view) {
      const root=document.createElement('span');
      root.className='mwb-cm-text-answer-slot '+(this.slot.choice?'mwb-choice-answer':'mwb-fill-answer');
      root.setAttribute('aria-label',(this.slot.choice?'选择':'填空')+'答案，鼠标悬停查看，点击编辑');
      root.setAttribute('title','悬停查看答案，点击编辑');
      root.setAttribute('tabindex','0');
      root.setAttribute('contenteditable','false');
      const content=document.createElement('span');
      content.className='mwb-cm-text-answer-content';
      content.textContent=this.slot.raw; // textContent prevents HTML injection
      root.appendChild(content);
      root.addEventListener('mousedown',(event)=>{
        event.preventDefault();
        view.dispatch({selection:{anchor:this.slot.from+2}});
        view.focus();
      });
      return root;
    }
    ignoreEvent() { return true; }
  }
  const engine={Decoration,MathAnswerWidget,TextAnswerWidget};
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.slots = answerSlots(view.state.doc.toString());
      this.decorations = buildMathAnswerDecorations(view, engine, this.slots);
    }
    update(update) {
      if (update.docChanged) {
        this.slots = mwbMapUnchangedAnswerSlots(this.slots, update) ||
          answerSlots(update.state.doc.toString());
      }
      if (update.docChanged || update.viewportChanged || update.selectionSet)
        this.decorations = buildMathAnswerDecorations(update.view, engine, this.slots);
    }
  },{decorations:v=>v.decorations});
}

function refreshQuestionEditors(leaves) {
  for (const leaf of leaves || []) {
    const view=leaf?.view;
    const cm=view?.editor?.cm;
    if (!view?.containerEl || !cm?.dispatch) continue;
    // A no-op dispatch notifies editor extensions of a file/metadata change.
    try {cm.dispatch({});} catch (_) {}
  }
}

module.exports = {
  QUESTION_VIEW_CLASS, normalizedQuestionType, syncQuestionViewClasses,
  answerSlots, mathAnswerSlots, overlapsSelection, buildMathAnswerDecorations,
  mwbMapUnchangedAnswerSlots, mwbVisibleAnswerSlots,
  createMathAnswerEditorExtension, refreshQuestionEditors
};

return module.exports; })();

const OUTPUT_DIR = 'ExamExports';

function isQuestion(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') return false;
  const objectType = String(frontmatter.object_type || '').toLowerCase();
  return ['item', 'question', '题素', '试题'].includes(objectType) || classifyQuestionType(frontmatter.question_type || frontmatter.type) !== 'other';
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only the temporary print/measurement DOM is expanded. The user's Markdown
// and the regular Obsidian reading view retain their original fold state.
function expandPrintCallouts(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let expanded = 0;
  for (const callout of root.querySelectorAll('.callout')) {
    if (callout.classList?.contains('is-collapsed')) {
      callout.classList.remove('is-collapsed');
      expanded++;
    }
    const content = Array.from(callout.children || []).find(child => child.classList?.contains('callout-content'));
    if (content) {
      // Obsidian normally folds via a CSS class, but themes may leave an
      // inline display:none or accessibility flag behind on cloned content.
      if (content.style?.display === 'none') content.style.removeProperty('display');
      if (content.getAttribute?.('aria-hidden') === 'true') content.removeAttribute('aria-hidden');
    }
    if (callout.getAttribute?.('aria-expanded') === 'false') callout.setAttribute('aria-expanded', 'true');
  }
  return expanded;
}

function mathDiagnosticContext(math, number) {
  // Give the author a stable formula index and nearby human-readable context.
  // The source TeX is not always exposed by Obsidian's MathJax DOM.
  const paragraph = math.closest('p, li, td, th');
  const text = (paragraph?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 64);
  const callout = math.closest('.callout');
  const calloutTitle = (callout?.querySelector('.callout-title-inner, .callout-title')?.textContent || '')
    .replace(/\s+/g, ' ').trim().slice(0, 36);
  return `公式 #${number}` + (calloutTitle ? `（${calloutTitle}）` : '') +
    (text ? `，附近「${text}」` : '');
}

function issuesInRenderedNode(root, source, getStyle = (el) => getComputedStyle(el)) {
  const problems = [];
  for (const img of root.querySelectorAll('img')) {
    if (!img.complete || img.naturalWidth === 0) problems.push('存在未加载或加载失败的图片');
  }
  const mathSources = /\$(?!\$)[^$\n]+\$|\$\$[\s\S]+?\$\$/g;
  const mathNodes = [...root.querySelectorAll('mjx-container, .MathJax, .katex')];
  if (mathSources.test(source) && !mathNodes.length)
    problems.push('包含数学公式，但尚未检测到渲染结果');
  if (root.querySelector('.mjx-merror, .MathJax_Error, .katex-error'))
    problems.push('MathJax/KaTeX 返回了公式错误');
  const printBox = root.getBoundingClientRect();
  for (const [index, math] of mathNodes.entries()) {
    const box = math.getBoundingClientRect();
    const context = mathDiagnosticContext(math, index + 1);
    const errorNode = math.querySelector?.('[data-mjx-error], [data-mml-node="merror"], mjx-merror, .mjx-merror, .MathJax_Error, .katex-error');
    if (errorNode) {
      const details = (errorNode.getAttribute?.('data-mjx-error') || errorNode.getAttribute?.('title') || '').trim();
      problems.push(context + ' MathJax 公式语法错误' + (details ? '：' + details.slice(0, 120) : ''));
    }
    if (box.width < 1 || box.height < 1) {
      let hiddenAncestor = null;
      for (let node = math; node && node !== root.parentElement; node = node.parentElement) {
        const style = getStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
          hiddenAncestor = node;
          break;
        }
      }
      if (hiddenAncestor) {
        const callout = math.closest('.callout');
        const name = callout?.getAttribute?.('data-callout') || '';
        problems.push(context + `位于不可见布局容器${name ? '（'+name+'）' : ''}；打印展开或主题样式未生效`);
      } else problems.push(context + '尺寸为零或尚未完成排版');
      continue;
    }
    // Measure both sides of the *text column*, without shrinking or clipping
    // mathematics. Report the extent and the source's approximate location.
    if (printBox.width > 0) {
      const left = Math.max(0, printBox.left - box.left);
      const right = Math.max(0, box.right - printBox.right);
      if (left > 3 || right > 3)
        problems.push(context + `超出打印版心（左 ${left.toFixed(1)}px，右 ${right.toFixed(1)}px）；请拆分长公式`);
    }
    // Overflow is axis-specific: overflow-x:hidden does not imply that
    // harmless vertical MathJax ascenders are clipped, or vice versa.
    let parent = math.parentElement;
    while (parent && parent !== root.parentElement) {
      const style = getStyle(parent);
      const clipX = /^(hidden|clip)$/.test(style.overflowX);
      const clipY = /^(hidden|clip)$/.test(style.overflowY);
      if (clipX || clipY) {
        const clip = parent.getBoundingClientRect();
        const beyondX = box.left < clip.left - 1.5 || box.right > clip.right + 1.5;
        const beyondY = box.top < clip.top - 1.5 || box.bottom > clip.bottom + 1.5;
        if ((clipX && beyondX) || (clipY && beyondY)) {
          const axis = [clipX && beyondX ? '水平' : '', clipY && beyondY ? '垂直' : ''].filter(Boolean).join('、');
          const classNames = typeof parent.className === 'string' ? parent.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          const element = (parent.tagName || '元素').toLowerCase() + (classNames ? '.' + classNames : '');
          problems.push(context + `被父容器 ${element} ${axis}裁切（overflow-x:${style.overflowX}; overflow-y:${style.overflowY}）；请调整公式换行或容器样式`);
          break;
        }
      }
      parent = parent.parentElement;
    }
  }
  if (/^\s*```\s*(?:tikz|tikzjax)\s*$/im.test(source)) {
    if (!root.querySelector('svg')) problems.push('TikZ 代码块尚未生成 SVG（检查 TikZJax 插件）');
    if (root.querySelector('pre code.language-tikz, pre code.language-tikzjax')) problems.push('TikZ 仍显示为代码块');
  }
  // Preserve complete issue metadata for the recoverable-vs-fatal decision.
  // Truncation is only for human-readable messages, never for safety checks.
  return [...new Set(problems)];
}

function summarizeRenderIssues(issues, max = 6) {
  const distinct = [...new Set(issues)];
  return distinct.slice(0, max).join('；') +
    (distinct.length > max ? `；另外还有 ${distinct.length - max} 项` : '');
}

function divideRenderIssues(root, issues) {
  const hasBody = !!root?.textContent?.trim() &&
    !!root.querySelector?.('p, li, h1, h2, h3, h4, .callout, table, pre, blockquote');
  const warnings = [], blockers = [];
  for (const issue of issues) {
    // Only local content failures are recoverable. No content, lost answer
    // space, missing entire math render or any real clipping stays fatal.
    const localFailure = /MathJax\/KaTeX 返回了公式错误|MathJax 公式语法错误|尺寸为零或尚未完成排版|存在未加载或加载失败的图片|TikZ 代码块尚未生成 SVG|TikZ 仍显示为代码块/.test(issue);
    (hasBody && localFailure ? warnings : blockers).push(issue);
  }
  return { warnings, blockers };
}

async function waitForStableRender(root, source, stableMs = DEFAULTS.stableMs, timeoutMs = DEFAULTS.timeoutMs) {
  // MarkdownRenderer retains the is-collapsed state of [!answer]- and
  // [!student-note]-; expand BEFORE MathJax/geometry checks, including the
  // hidden-opacity teacher measurement layer.
  expandPrintCallouts(root);
  await finishRenderMath();
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(5000)]);
  let lastMutation = performance.now();
  const observer = new MutationObserver(() => { lastMutation = performance.now(); });
  observer.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
  const start = performance.now();
  try {
    while (performance.now() - start < timeoutMs) {
      await wait(100);
      const problems = issuesInRenderedNode(root, source);
      const stable = performance.now() - lastMutation >= stableMs;
      if (stable) {
        const {warnings, blockers} = divideRenderIssues(root, problems);
        if (!blockers.length) return warnings;
        // A complete but locally imperfect preview is still printable after
        // acknowledgement; real structural/geometry failures are not.
        if (blockers.some(issue => issue.startsWith('公式 #') &&
            (issue.includes('超出打印版心') || issue.includes('被父容器') || issue.includes('不可见布局容器')))) {
          throw new Error('公式校验失败：' + summarizeRenderIssues(blockers));
        }
      }
    }
    const issues = issuesInRenderedNode(root, source);
    const {warnings, blockers} = divideRenderIssues(root, issues);
    // An actively mutating document may still change, so warnings alone
    // cannot bypass the stable-layout requirement.
    throw new Error('渲染守卫超时：' + (blockers.length ? summarizeRenderIssues(blockers) :
      warnings.length ? '布局持续变化；局部警告：' + summarizeRenderIssues(warnings) : 'DOM 持续变化，未达到稳定窗口'));
  } finally { observer.disconnect(); }
}

function electronWindowConstructor() {
  for (const moduleName of ['@electron/remote', 'electron']) {
    try {
      const m = require(moduleName);
      if (m.BrowserWindow && typeof m.getCurrentWindow === 'function') return m.BrowserWindow;
      if (m.remote && m.remote.BrowserWindow) return m.remote.BrowserWindow;
    } catch (_) { /* unsupported host */ }
  }
  return null;
}

function stamp() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0'), '-',
    String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0'), '-',
    String(d.getMilliseconds()).padStart(3,'0')].join('');
}

function safeStem(s) { return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 90); }

async function ensureExportFolder(app) {
  if (!app.vault.getAbstractFileByPath(OUTPUT_DIR)) await app.vault.createFolder(OUTPUT_DIR);
}

// Explicit user action only. Never infer a pedagogical role from filenames,
// book headings, level or parent links; and never edit notes during export.
class RolePickerModal extends Modal {
  constructor(app, file) { super(app); this.file = file; }
  onOpen() {
    this.contentEl.empty();
    this.contentEl.createEl('h2', {text:'设置题卡默认教学角色'});
    this.contentEl.createEl('p', {text:'仅为当前题卡添加或更新 teaching_role；导出不会改动原文件。'});
    const choices = this.contentEl.createDiv({cls:'mwb-role-picker'});
    for (const role of [...TEACHING_ROLES, {id:null, label:'清除角色（未标注）'}]) {
      const button = choices.createEl('button', {text:role.label});
      button.onclick = async () => {
        button.disabled = true;
        try {
          await this.app.fileManager.processFrontMatter(this.file, fm => {
            if (role.id === null) delete fm.teaching_role;
            else fm.teaching_role = role.id;
          });
          new Notice(`教学角色已设置为：${role.id === null ? '未标注' : role.label}`);
          this.close();
        } catch (e) { new Notice('写入教学角色失败：'+(e?.message || e)); button.disabled = false; }
      };
    }
  }
  onClose() { this.contentEl.empty(); }
}

class PreviewModal extends Modal {
  constructor(app, plugin, file, markdown, exam = null, opts = {}) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.markdown = markdown;
    this.exam = exam;
    this.documentMode = !!opts.documentMode;
    this.metaSelections = {student:[...MODE_DEFAULTS.student], teacher:[...MODE_DEFAULTS.teacher]};
    this.metaPosition = 'below';
    this.examTitle = exam?.title || file.basename;
    this.mode = this.documentMode ? 'document' : 'student';
    this.documentRenderSource = null;
    this.ready = false;
    this.generation = 0;
    this.spaceSettings = { ...DEFAULT_SPACE_SETTINGS };
    this.solutionOptions = { solutionSpaces: false, showSolution: true };
    this.renderQueue = Promise.resolve();
    this.solutionHeights = [];
    this.spaceDiagnostics = [];
    this.measurePage = null;
    this.renderWarnings = [];
    this.partialExportApproved = false;
  }

  addRenderWarnings(stage, issues) {
    for (const issue of issues || []) this.renderWarnings.push(`${stage}：${issue}`);
  }

  assertPartialExportApproved() {
    if (this.renderWarnings.length && !this.partialExportApproved) {
      throw new Error('存在局部渲染失败：请查看警告并勾选“允许不完整的 PDF”，然后继续导出。');
    }
  }

  onOpen() {
    this.modalEl.addClass('mwb-modal');
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: this.documentMode ? 'Markdown 文档 A4 预览（实验版）' : this.exam ? '数学试卷 A4 预览' : '数学题卡 A4 预览' });
    const controls = this.contentEl.createDiv({ cls: 'mwb-controls' });
    const student = controls.createEl('button', { text: this.documentMode ? '讲义学生版' : '学生卷' });
    const teacher = controls.createEl('button', { text: this.documentMode ? '讲义教师版' : '教师卷' });
    const originalDocument = this.documentMode ? controls.createEl('button', { text: '原文预览（不转换答案）' }) : null;
    const print = controls.createEl('button', { text: '保存 PDF' });
    const printDirect = controls.createEl('button', { text: '打印…' });
    const printAndSave = controls.createEl('button', { text: '保存并打印…' });

    const ratioLabel = controls.createEl('label', { cls: 'mwb-setting-label', text: '等高留白' });
    const ratioInput = ratioLabel.createEl('select', { cls: 'mwb-setting-select', attr: { 'aria-label': '教师专用块高度比例' } });
    for (const amount of [50, 75, 90, 100, 110, 125, 150]) {
      const option = ratioInput.createEl('option', { text: `${amount}%`, value: String(amount) });
      option.value = String(amount);
      if (amount === 100) option.selected = true;
    }
    const minimumLabel = controls.createEl('label', { cls: 'mwb-setting-label', text: '最小' });
    const minimumInput = minimumLabel.createEl('select', { cls: 'mwb-setting-select', attr: { 'aria-label': '最小留白高度' } });
    for (const amount of [0, 2, 4]) {
      const option = minimumInput.createEl('option', { text: `${amount} cm`, value: String(amount) });
      option.value = String(amount);
      if (amount === this.spaceSettings.minimumCm) option.selected = true;
    }
    // Both options are presentation-only; never rewrite the source note.
    const studentSolutionLabel = controls.createEl('label', { cls: 'mwb-setting-label', text: 'solution 留白 ' });
    const studentSolutionCheckbox = studentSolutionLabel.createEl('input', { type: 'checkbox' });
    studentSolutionCheckbox.checked = this.solutionOptions.solutionSpaces;
    studentSolutionCheckbox.setAttribute('aria-label', '学生版为 solution 预留答题空白');
    studentSolutionCheckbox.onchange = () => {
      this.solutionOptions.solutionSpaces = !!studentSolutionCheckbox.checked;
      if (this.mode === 'student') void this.renderMode('student');
    };
    const teacherSolutionLabel = controls.createEl('label', { cls: 'mwb-setting-label', text: '显示 solution ' });
    const teacherSolutionCheckbox = teacherSolutionLabel.createEl('input', { type: 'checkbox' });
    teacherSolutionCheckbox.checked = this.solutionOptions.showSolution;
    teacherSolutionCheckbox.setAttribute('aria-label', '教师版显示 solution 解题思路');
    teacherSolutionCheckbox.onchange = () => {
      this.solutionOptions.showSolution = !!teacherSolutionCheckbox.checked;
      if (this.mode === 'teacher') void this.renderMode('teacher');
    };
    this.solutionModeLabels = { student: studentSolutionLabel, teacher: teacherSolutionLabel };
    if (this.documentMode) { ratioLabel.style.display = ''; minimumLabel.style.display = ''; }
    if (this.exam) {
      const groupingLabel = controls.createEl('label', {cls:'mwb-setting-label', text:'分组依据'});
      const groupingSelect = groupingLabel.createEl('select', {cls:'mwb-setting-select', attr:{'aria-label':'分组依据'}});
      for (const mode of GROUPING_MODES) {
        groupingSelect.createEl('option', {text:mode.label, value:mode.id});
      }
      groupingSelect.value = this.exam.groupBy || 'question_type';
      groupingSelect.addEventListener('change', () => {
        this.exam = collectExamItems(this.exam.items, {groupBy:groupingSelect.value});
        void this.renderMode(this.mode);
      });
      const titleInput = controls.createEl('input', {cls:'mwb-exam-title-input', type:'text', attr:{'aria-label':'试卷标题', 'placeholder':'试卷标题'}});
      titleInput.value = this.examTitle;
      titleInput.addEventListener('change', () => {
        this.examTitle = titleInput.value.trim().slice(0, 100) || '数学试卷';
        if (this.titleElement) this.titleElement.setText(this.examTitle);
      });
    }
    if (!this.documentMode) {
      const selector = this.contentEl.createDiv({cls:'mwb-meta-selector'});
      selector.createEl('strong',{text:'打印元信息（仅所选字段；学生/教师独立）'});
      const group = selector.createDiv({cls:'mwb-meta-fields'});
      this.metaCheckboxes = new Map();
      for (const field of META_FIELDS) {
        const label = group.createEl('label');
        const checkbox = label.createEl('input',{type:'checkbox'});
        checkbox.checked = this.metaSelections[this.mode].includes(field.key);
        checkbox.addEventListener('change',()=>{
          const values = new Set(this.metaSelections[this.mode]);
          if (checkbox.checked) values.add(field.key); else values.delete(field.key);
          this.metaSelections[this.mode] = [...values];
          void this.renderMode(this.mode);
        });
        label.appendText(field.label);
        this.metaCheckboxes.set(field.key,checkbox);
      }
      const placement = selector.createEl('label',{text:'显示位置 '});
      const select = placement.createEl('select');
      for (const choice of [{key:'above',label:'题干前'}, {key:'below',label:'首段题干后'}, {key:'end',label:'题末'}]) {
        select.createEl('option',{value:choice.key,text:choice.label});
      }
      select.value = this.metaPosition;
      select.addEventListener('change',()=>{this.metaPosition=select.value; void this.renderMode(this.mode);});
    }
    const html = controls.createEl('button', { text: '保存 HTML 备用' });
    this.status = this.contentEl.createDiv({ cls: 'mwb-status', text: '渲染中…' });
    const errorActions = this.contentEl.createDiv({ cls: 'mwb-error-actions' });
    const copyErrorButton = errorActions.createEl('button', { text: '复制渲染错误详情' });
    copyErrorButton.style.display = 'none';
    this.copyErrorButton = copyErrorButton;
    copyErrorButton.onclick = async () => {
      if (!this.lastRenderError) return;
      try {
        await navigator.clipboard.writeText(this.lastRenderError);
        new Notice('渲染错误详情已复制');
      } catch (_) {
        new Notice('无法自动复制；请选中预览窗口中的错误文字复制。');
      }
    };
    const partialWarning = this.contentEl.createDiv({ cls: 'mwb-partial-warning' });
    partialWarning.style.display = 'none';
    const partialLabel = partialWarning.createEl('label');
    const partialCheckbox = partialLabel.createEl('input', { type: 'checkbox' });
    partialLabel.appendText(' 已了解局部公式或图片可能缺失，允许导出不完整的 PDF / 打印');
    partialCheckbox.onchange = () => {
      this.partialExportApproved = !!partialCheckbox.checked;
    };
    this.partialWarning = partialWarning;
    this.partialCheckbox = partialCheckbox;
    const copyMetadata = controls.createEl('button', {text:'复制元信息检查'});
    if (this.documentMode) copyMetadata.style.display='none';
    copyMetadata.title = '列出题卡中缺失的正式字段和字段冲突；不会自动补造事实或修改文件';
    copyMetadata.onclick = async () => {
      const records = this.exam ? this.exam.items : [{file:this.file, markdown:this.markdown}];
      const rows = records.map(item => ({
        文件:item.file?.path || '',
        题目ID:metadataOf(item).id || '',
        缺少字段:metadataAudit(metadataOf(item)).missing,
        待复核:metadataAudit(metadataOf(item)).warnings,
      }));
      try { await navigator.clipboard.writeText(JSON.stringify(rows,null,2)); new Notice('题卡元信息检查结果已复制'); }
      catch (_) { new Notice('无法复制元信息检查报告'); }
    };
    const copySpaces = controls.createEl('button', {text:'复制留白核验'});
    copySpaces.title = '复制学生版实际渲染高度与原解答高度的逐块对照（包括长 Markdown 讲义）';
    copySpaces.onclick = async () => {
      if (!this.ready || this.mode !== 'student' || !this.spaceDiagnostics.length) {
        new Notice('请先完成含解答块的学生版渲染'); return;
      }
      const rows = this.spaceDiagnostics.map((r,i)=>({
        题号:r.question || i+1, 文件:r.source || (this.file?.path || ''),
        教师块像素:Number(r.teacherPx.toFixed(2)), 目标留白像素:Number(r.targetPx.toFixed(2)),
        预览实测像素:Number(r.actualPx.toFixed(2)), 偏差像素:Number(r.deltaPx.toFixed(2)),
        比例:r.ratio
      }));
      try { await navigator.clipboard.writeText(JSON.stringify(rows,null,2)); new Notice('留白高度核验数据已复制'); }
      catch (_) { new Notice('无法复制留白报告；请检查系统剪贴板权限'); }
    };
    const scroll = this.contentEl.createDiv({ cls: 'mwb-scroll' });
    this.page = scroll.createDiv({ cls: 'mwb-page' });
    this.rendered = this.page.createDiv({ cls: 'mwb-typography mwb-print-document' });
    ratioInput.onchange = () => { this.spaceSettings.ratio = Number(ratioInput.value); if (this.mode === 'student') void this.renderMode('student'); };
    minimumInput.onchange = () => { this.spaceSettings.minimumCm = Number(minimumInput.value); if (this.mode === 'student') void this.renderMode('student'); };
    student.onclick = () => { void this.renderMode('student'); };
    teacher.onclick = () => { void this.renderMode('teacher'); };
    if (originalDocument) originalDocument.onclick = () => { void this.renderMode('document'); };
    print.onclick = () => { void this.exportPdf({save:true, printAfter:false}); };
    printDirect.onclick = () => { void this.exportPdf({save:false, printAfter:true}); };
    printAndSave.onclick = () => { void this.exportPdf({save:true, printAfter:true}); };
    html.onclick = () => { void this.saveHtml(); };
    void this.renderMode(this.mode);
  }

  renderMode(mode) {
    // Serialize renderer writes so quick mode/setting changes cannot let an
    // outdated MarkdownRenderer invocation corrupt the current preview.
    const generation = ++this.generation;
    this.mode = mode;
    if (this.solutionModeLabels) {
      this.solutionModeLabels.student.style.display = mode === 'student' ? '' : 'none';
      this.solutionModeLabels.teacher.style.display = mode === 'teacher' ? '' : 'none';
    }
    this.ready = false;
    this.spaceDiagnostics = [];
    this.renderWarnings = [];
    this.partialExportApproved = false;
    if (this.partialCheckbox) this.partialCheckbox.checked = false;
    if (this.partialWarning) this.partialWarning.style.display = 'none';
    this.documentRenderSource = null;
    this.status.setText('渲染中：' + (this.documentMode ? (mode === 'document' ? '讲义原文' : mode === 'student' ? '讲义学生版' : '讲义教师版') : mode === 'student' ? '学生卷' : '教师卷'));
    if (this.metaCheckboxes) {
      for (const [key,box] of this.metaCheckboxes) box.checked = this.metaSelections[mode]?.includes(key) || false;
    }
    this.lastRenderError = '';
    if (this.copyErrorButton) this.copyErrorButton.style.display = 'none';
    this.renderQueue = this.renderQueue.catch(() => {}).then(async () => {
      if (generation !== this.generation) return;
      this.rendered.empty();
      try {
        if (this.documentMode) {
          const plan = handoutPlan(this.markdown, mode, this.solutionOptions);
          let heights = [];
          if (mode === 'student' && plan.solutionCount) {
            this.status.setText(`正在测量长讲义的 ${plan.solutionCount} 个教师专用块…`);
            heights = await this.measureDocumentSolutions(plan.solutionCount, generation);
            if (generation !== this.generation) return;
          }
          await this.renderDocumentSource(plan.markdown, this.rendered, generation);
          if (generation !== this.generation) return;
          if (mode === 'student' && plan.solutionCount) {
            injectSpaceNodes(this.rendered, heights, this.spaceSettings, this.rendered.ownerDocument, plan.skipSpaces);
          }
          this.solutionHeights = heights.filter((_, index) => !plan.skipSpaces?.includes(index));
          this.addRenderWarnings('讲义预览', await waitForStableRender(this.rendered, plan.markdown));
          if (generation !== this.generation) return;
          layoutOptionGrids(this.rendered);
          this.documentRenderSource = plan.markdown;
        } else if (!this.exam) assertValidQuestionSource(this.markdown);
        if (this.documentMode) {
          // The long Markdown content has already been rendered above.
        } else if (this.exam) {
          await this.renderExam(mode, generation);
        } else if (mode === 'student') {
          const plan = studentSpacePlan(this.markdown, this.solutionOptions);
          let heights = [];
          if (plan.count > 0) {
            this.status.setText('正在测量教师专用块的学生卷等高留白…');
            heights = await this.measureSolutions(plan.count);
            if (generation !== this.generation) return;
          }
          await MarkdownRenderer.render(this.app, plan.markdown, this.rendered, this.file.path, this.plugin);
          if (generation !== this.generation) return;
          injectSpaceNodes(this.rendered, heights, this.spaceSettings, this.rendered.ownerDocument, plan.skipSpaces);
          this.solutionHeights = heights.filter((_, index) => !plan.skipSpaces?.includes(index));
          this.addRenderWarnings('学生版预览', await waitForStableRender(this.rendered, plan.markdown));
          layoutOptionGrids(this.rendered);
          addMetaBlock(this.rendered.ownerDocument,this.rendered,
            metadataOf({markdown:this.markdown,metadata:this.app.metadataCache.getFileCache(this.file)?.frontmatter}),
            this.metaSelections.student,this.metaPosition);
        } else {
          const content = transformQuestion(this.markdown, mode, this.solutionOptions);
          await MarkdownRenderer.render(this.app, content, this.rendered, this.file.path, this.plugin);
          if (generation !== this.generation) return;
          this.addRenderWarnings('教师版预览', await waitForStableRender(this.rendered, content));
          layoutOptionGrids(this.rendered);
          addMetaBlock(this.rendered.ownerDocument,this.rendered,
            metadataOf({markdown:this.markdown,metadata:this.app.metadataCache.getFileCache(this.file)?.frontmatter}),
            this.metaSelections.teacher,this.metaPosition);
          this.solutionHeights = [];
        }
        if (generation !== this.generation) return;
        // Audit actual student PREVIEW geometry after all MathJax and styles
        // settle. The PDF engine may still create pagination gaps independently.
        this.spaceDiagnostics = mode === 'student' ? auditSpaceGeometry(this.rendered) : [];
        this.ready = true;
        const extra = mode === 'student' && this.solutionHeights.length
          ? `；${this.solutionHeights.length} 处答题区按解答高度 ${this.spaceSettings.ratio}%（最低 ${this.spaceSettings.minimumCm} cm）生成`
          : '';
        const roles = this.documentMode ? (mode === 'document' ? '长 Markdown 原文' : mode === 'student' ? '长 Markdown 学生版' : '长 Markdown 教师版') : this.exam ? teachingRoleSummary(this.exam.items)
          : teachingRoleSummary([{ markdown:this.markdown }]);
        const previewInfo = extra + '；教学角色：' + roles +
          '；留白几何核验 ' + this.spaceDiagnostics.length + ' 项；最终分页仍以 PDF 为准。' +
          (this.exam ? ` 共 ${this.exam.items.length} 题。` : this.documentMode ? ` 文档 ${this.markdown.length} 字符。` : '');
        const warnings = [...new Set(this.renderWarnings)];
        this.renderWarnings = warnings;
        if (warnings.length) {
          this.lastRenderError = ['Mathsemble 局部渲染警告',
            '模式：' + mode, '警告数：' + warnings.length, ...warnings].join('\n');
          if (this.copyErrorButton) this.copyErrorButton.style.display = '';
          if (this.partialWarning) this.partialWarning.style.display = '';
          this.status.setText(`预览已生成，但有 ${warnings.length} 项局部渲染警告。` +
            ' 部分内容可能错误或缺失；请复制错误详情检查。' +
            ' 如确需输出，请勾选“允许导出不完整的 PDF”。\n' +
            summarizeRenderIssues(warnings, 3) + previewInfo);
          new Notice(`预览存在 ${warnings.length} 项局部渲染警告；确认后仍可保存 PDF 或打印。`, 12000);
        } else {
          this.status.setText('预览渲染检查通过' + previewInfo);
        }
      } catch (e) {
        if (generation !== this.generation) return;
        const detail = String(e?.message || e);
        this.lastRenderError = ['Mathsemble v' + (this.plugin.manifest?.version || 'unknown'),
          '模式：' + (mode === 'student' ? '学生版' : mode === 'teacher' ? '教师版' : '原文'),
          '入口：' + (this.documentMode ? '长 Markdown 讲义' : this.exam ? '当前文件夹整卷' : '当前题卡'),
          '错误：' + detail,
          e?.stack ? '调用栈：' + e.stack : '',
        ].filter(Boolean).join('\n');
        this.status.setText('渲染失败，已停止 PDF 导出。\n' + detail);
        if (this.copyErrorButton) this.copyErrorButton.style.display = '';
        console.error('[Math Teaching Workbench] 预览渲染失败', this.lastRenderError, e);
        new Notice('渲染失败：' + detail.slice(0, 240), 12000);
      } finally {
        this.removeMeasurement();
      }
    });
    return this.renderQueue;
  }

  // Preserve complete Markdown headings, fences, and source-file context.
  // Rendering in manageable chunks keeps large handouts responsive, while the
  // geometry measurement uses exactly the same typography and renderer.
  async renderDocumentSource(source, target, generation) {
    for (const chunk of documentChunks(source)) {
      if (generation !== this.generation) return;
      const staging = target.ownerDocument.createElement('div');
      await MarkdownRenderer.render(this.app, chunk, staging, this.file.path, this.plugin);
      if (generation !== this.generation) return;
      while (staging.firstChild) target.appendChild(staging.firstChild);
    }
  }

  async measureDocumentSolutions(expectedCount, generation) {
    this.removeMeasurement();
    const measure = this.page.createDiv({cls:'mwb-measure-layer mwb-typography mwb-print-document'});
    this.measurePage = measure;
    try {
      const source = handoutPlan(this.markdown, 'teacher').markdown;
      await this.renderDocumentSource(source, measure, generation);
      if (generation !== this.generation) return [];
      try {
        this.addRenderWarnings('教师专用块高度测量', await waitForStableRender(measure, source));
      } catch (error) {
        throw new Error('教师专用块高度测算失败：' + (error?.message || error));
      }
      if (generation !== this.generation) return [];
      assertMeasurementWidth(this.rendered, measure);
      layoutOptionGrids(measure);
      return teacherSolutionHeights(measure, expectedCount, teacherOnlyCalloutIndices(this.markdown, this.solutionOptions));
    } finally {
      this.removeMeasurement();
    }
  }

  // Entire-folder exam: each note is rendered in its own source-path context
  // so ![[image.png]] and other vault-relative resources remain resolvable.
  async renderExam(mode, generation) {
    const items = this.exam.items;
    if (!items.length) throw new Error('没有有效题卡');
    // Reject bad source before any partial exam rendering/printing.
    for (const item of items) {
      try { assertValidQuestionSource(item.markdown); }
      catch(e) { throw new Error(`${item.file.path}：${e.message || e}`); }
    }
    this.titleElement = this.rendered.createEl('h1', {cls:'mwb-exam-title',text:this.examTitle});
    this.rendered.createDiv({cls:'mwb-exam-edition',text:mode === 'student' ? '学生版' : '教师版'});
    const teacherHeightMap = mode === 'student' ? await this.measureExamSolutions(items) : new Map();
    if (generation !== this.generation) return;
    let currentSection = null;
    const contexts = [];
    let spaces = 0;
    for (const item of items) {
      if (generation !== this.generation) return;
      if (item.sectionKey !== currentSection) {
        currentSection = item.sectionKey;
        const heading = this.exam.sections.find(section => section.id === currentSection);
        this.rendered.createEl('h2', {cls:'mwb-exam-section', text:heading.title});
      }
      const wrapper = this.rendered.createEl('section', {cls:'mwb-exam-question'});
      wrapper.setAttribute('data-mwb-question-number', String(item.number));
      wrapper.setAttribute('data-mwb-source-path', item.file.path);
      if (item.teachingRole?.role) wrapper.setAttribute('data-mwb-teaching-role', item.teachingRole.role);
      const content = wrapper.createDiv({cls:'mwb-exam-question-content'});
      let source;
      if (mode === 'student') {
        const plan = studentSpacePlan(item.markdown, this.solutionOptions);
        source = plan.markdown;
        await MarkdownRenderer.render(this.app, source, content, item.file.path, this.plugin);
        if (generation !== this.generation) return;
        if (plan.count > 0) {
          const heights = teacherHeightMap.get(item.file.path);
          if (!heights || heights.length !== plan.count) throw new Error('教师专用块高度数量与题卡不匹配：' + item.file.path);
          injectSpaceNodes(content, heights, this.spaceSettings, content.ownerDocument, plan.skipSpaces);
          spaces += heights.length - (plan.skipSpaces?.length || 0);
        }
      } else {
        source = transformQuestion(item.markdown, 'teacher', this.solutionOptions);
        await MarkdownRenderer.render(this.app, source, content, item.file.path, this.plugin);
      }
      insertQuestionNumber(content, item.number);
      addMetaBlock(content.ownerDocument,content,metadataOf(item),this.metaSelections[mode] || [],this.metaPosition);
      contexts.push({content, source, path:item.file.path});
    }
    if (generation !== this.generation) return;
    this.addRenderWarnings('整卷预览', await waitForStableRender(this.rendered, contexts.map(x=>x.source).join('\n\n')));
    this.validateExamContexts(contexts, '整卷题卡');
    layoutOptionGrids(this.rendered);
    markShortQuestions(this.rendered);
    this.solutionHeights = Array(spaces).fill(1);
  }

  validateExamContexts(contexts, stage = '整卷题卡') {
    for (const {content, source, path} of contexts) {
      const {warnings, blockers} = divideRenderIssues(content, issuesInRenderedNode(content, source));
      if (blockers.length) throw new Error(`${path}：${summarizeRenderIssues(blockers)}`);
      this.addRenderWarnings(`${stage}/${path}`, warnings);
    }
  }

  async measureExamSolutions(items) {
    this.removeMeasurement();
    const plans = items.map(item => ({item, plan:studentSpacePlan(item.markdown, this.solutionOptions)})).filter(x=>x.plan.count>0);
    if (!plans.length) return new Map();
    this.status.setText(`正在测量 ${plans.length} 道题的教师专用块高度…`);
    const page = this.page.createDiv({cls:'mwb-measure-layer mwb-typography mwb-print-document'});
    this.measurePage = page;
    const contexts = [];
    try {
      for (const {item,plan} of plans) {
        const holder = page.createDiv({cls:'mwb-exam-question-content'});
        const source = transformQuestion(item.markdown, 'teacher');
        await MarkdownRenderer.render(this.app, source, holder, item.file.path, this.plugin);
        contexts.push({item,plan,content:holder,source,path:item.file.path});
      }
      this.addRenderWarnings('整卷教师高度测量', await waitForStableRender(page, contexts.map(x=>x.source).join('\n\n')));
      assertMeasurementWidth(this.rendered, page);
      this.validateExamContexts(contexts, '教师高度测量');
      layoutOptionGrids(page);
      const map = new Map();
      for (const {item,plan,content} of contexts) {
        map.set(item.file.path, teacherSolutionHeights(content,plan.count,teacherOnlyCalloutIndices(item.markdown, this.solutionOptions)));
      }
      return map;
    } finally {
      this.removeMeasurement();
    }
  }

  async measureSolutions(count) {
    this.removeMeasurement();
    this.measurePage = this.page.createDiv({ cls: 'mwb-measure-layer mwb-typography mwb-print-document' });
    const teacher = this.measurePage;
    try {
      const source = transformQuestion(this.markdown, 'teacher');
      await MarkdownRenderer.render(this.app, source, teacher, this.file.path, this.plugin);
      this.addRenderWarnings('教师专用块高度测量', await waitForStableRender(teacher, source));
      assertMeasurementWidth(this.rendered, teacher);
      layoutOptionGrids(teacher);
      return teacherSolutionHeights(teacher, count, teacherOnlyCalloutIndices(this.markdown, this.solutionOptions));
    } finally {
      this.removeMeasurement();
    }
  }

  removeMeasurement() {
    if (this.measurePage) this.measurePage.remove();
    this.measurePage = null;
  }

  async preparePrintHtml(title) {
    if (!this.ready) throw new Error('渲染尚未通过，不能导出');
    // Recheck immediately before cloning: an editor change/theme layout or
    // asynchronous TikZ could invalidate the geometry seen earlier.
    const source = this.documentMode ? this.documentRenderSource : this.exam
      ? this.exam.items.map(item => this.mode === 'student' ? studentSpacePlan(item.markdown, this.solutionOptions).markdown : transformQuestion(item.markdown, 'teacher', this.solutionOptions)).join('\n\n')
      : this.mode === 'student' ? studentSpacePlan(this.markdown, this.solutionOptions).markdown : transformQuestion(this.markdown, this.mode, this.solutionOptions);
    if (this.documentMode && typeof source !== 'string') throw new Error('讲义渲染状态已过期，请重新预览');
    // Reuse the same axis-aware geometry audit as the preview. Avoid a
    // second generic check that loses the offending formula's identity.
    const {warnings, blockers} = divideRenderIssues(this.rendered, issuesInRenderedNode(this.rendered, source));
    if (blockers.length) throw new Error('预览存在严重问题：' + summarizeRenderIssues(blockers));
    let newWarning = false;
    for (const warning of warnings) {
      const issue = '导出前复检：' + warning;
      if (!this.renderWarnings.some(existing => existing.endsWith('：' + warning))) {
        this.renderWarnings.push(issue);
        newWarning = true;
      }
    }
    if (newWarning && this.partialWarning) {
      this.partialExportApproved = false;
      if (this.partialCheckbox) this.partialCheckbox.checked = false;
      this.partialWarning.style.display = '';
      this.status.setText('导出前复检又发现局部渲染警告，请阅读警告并确认后重试。\n' +
        summarizeRenderIssues(warnings, 3));
    }
    if (this.mode === 'student') auditSpaceGeometry(this.rendered);
    const warningsBeforeExamAudit = this.renderWarnings.length;
    if (this.exam) {
      const nodes = [...this.rendered.querySelectorAll('.mwb-exam-question-content')];
      if (nodes.length !== this.exam.items.length) throw new Error('组卷题数与预览节点数不匹配，已阻止导出');
      this.validateExamContexts(nodes.map((content,i) => ({content, source: this.mode === 'student' ? studentSpacePlan(this.exam.items[i].markdown, this.solutionOptions).markdown : transformQuestion(this.exam.items[i].markdown, 'teacher', this.solutionOptions), path:this.exam.items[i].file.path})));
    }
    if (this.renderWarnings.length > warningsBeforeExamAudit && this.partialWarning) {
      this.partialExportApproved = false;
      if (this.partialCheckbox) this.partialCheckbox.checked = false;
      this.partialWarning.style.display = '';
      this.status.setText('导出前发现新的局部渲染问题，请查看错误详情、重新确认后再输出。');
    }
    this.assertPartialExportApproved();
    return await exportHtml(this.rendered, title, typographyCss, document, {
      allowIncompleteImages: this.partialExportApproved && this.renderWarnings.some(issue =>
        /未加载或加载失败的图片/.test(issue))
    });
  }

  async saveHtml() {
    try {
      const name = `${safeStem(this.exam ? this.examTitle : this.file.basename)}_${this.mode}_${stamp()}.html`;
      const html = await this.preparePrintHtml(name);
      await ensureExportFolder(this.app);
      await this.app.vault.create(`${OUTPUT_DIR}/${name}`, html);
      new Notice('已保存自包含 HTML：' + OUTPUT_DIR + '/' + name);
    } catch (e) { new Notice('保存 HTML 失败：' + (e?.message || e)); }
  }

  async exportPdf({save=true,printAfter=false} = {}) {
    const generation=this.generation;
    if(!this.ready) {new Notice('渲染尚未通过，不能输出');return;}
    if (this.renderWarnings.length && !this.partialExportApproved) {
      new Notice('存在局部渲染警告：请先检查错误并勾选允许不完整 PDF，再保存或打印。', 9000);
      return;
    }
    this.status.setText('正在准备 A4 打印页面、核验 PDF…');
    let savedPath = null;
    try {
      const name=`${safeStem(this.exam ? this.examTitle : this.file.basename)}_${this.mode}_${stamp()}.pdf`;
      const html=await this.preparePrintHtml(name);
      if(generation!==this.generation) throw new Error('预览模式已变化，请重新操作');
      const pdf=await pdfBufferFromHtml(html,electronWindowConstructor(),{
        printAfter,
        // Acknowledgement is per warning category: an unrelated image or math
        // failure introduced only in the print window must still stop export.
        allowPartialMath: this.partialExportApproved && this.renderWarnings.some(issue =>
          /MathJax|KaTeX|公式 #.*尺寸为零/.test(issue)),
        allowPartialImage: this.partialExportApproved && this.renderWarnings.some(issue =>
          /未加载或加载失败的图片/.test(issue)),
        onPdfReady:save ? async buffer=>{
          if (generation!==this.generation) throw new Error('打印前预览内容已变化，取消保存');
          await ensureExportFolder(this.app);
          const bytes=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);
          savedPath=`${OUTPUT_DIR}/${name}`;
          await this.app.vault.createBinary(savedPath,bytes);
        } : undefined,
      });
      const printOutcome=pdf.mwbPrintOutcome;
      const printMessage=!printAfter?'':printOutcome?.success?'；打印任务已提交到系统':
        `；打印取消或失败：${printOutcome?.reason || '未知原因'}`;
      const pagination=pdf.mwbPrintReport;
      const partialLabel = this.renderWarnings.length ? `；带 ${this.renderWarnings.length} 项局部渲染警告（内容可能不完整）` : '';
      this.status.setText((savedPath ? `PDF 已保存：${savedPath}` : 'PDF 已生成（未保存）')+printMessage+
        (pagination ? `；${pagination.pages} 页` : '')+partialLabel);
      new Notice((savedPath?'PDF 已保存':'PDF 已生成')+partialLabel+printMessage,8500);
    } catch(e) {
      const message=e?.message||String(e);
      this.status.setText((savedPath ? `PDF 已保存：${savedPath}；但打印失败：` : 'PDF/打印失败：')+message);
      new Notice(savedPath ? 'PDF 已保存，但打印未完成：'+message : 'PDF/打印失败：'+message,10000);
    }
  }

  onClose() { ++this.generation; this.removeMeasurement(); this.contentEl.empty(); }
}

module.exports = class MathTeachingWorkbench extends Plugin {
  async onload() {
    this.addCommand({
      id:'diagnose-answer-visibility',
      name:'诊断当前题卡/讲义答案显隐（复制报告）',
      callback:async()=>{
        const view=this.app.workspace.getActiveViewOfType(MarkdownView);
        const file=view?.file;
        if(!file){new Notice('请先打开数学题卡或讲义');return;}
        const markdown=await this.app.vault.read(file);
        const fm=this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        const root=view.containerEl;
        const live=!!root?.querySelector?.('.markdown-source-view.mod-cm6.is-live-preview');
        const reading=!!root?.querySelector?.('.markdown-preview-view');
        const slots=mathAnswerSlots(markdown);
        const report={
          版本:'v'+(this.manifest?.version || 'unknown'),文件:file.path,
          是否识别为题卡:isQuestion(fm),
          讲义答案槽数量:answerSlots(markdown).length,
          题型:fm.question_type||fm.type||'未填写',
          当前模式:live?'实时预览':reading?'阅读视图':'源码模式或无法识别',
          视图已标记:!!root?.classList?.contains('mwb-question-note'),
          数学答案槽数量:slots.length,
          数学答案槽位置:slots.map(s=>({from:s.from,to:s.to})),
          CodeMirror编辑器可访问:!!view.editor?.cm,
          源码模式显示答案属于正常行为:true,
        };
        try{
          await navigator.clipboard.writeText(JSON.stringify(report,null,2));
          new Notice('答案显隐诊断已复制到剪贴板');
        }catch(e){
          console.log('[Math Teaching Workbench] 答案显隐诊断',report);
          new Notice('无法复制诊断；报告已输出到开发者控制台');
        }
      }
    });
    this.addCommand({ id: 'preview-current-markdown-document', name: '长 Markdown 文档预览、PDF 与打印（实验）',
      callback: async () => {
        const file=this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) {new Notice('请先打开 Markdown 文件');return;}
        const markdown=await this.app.vault.read(file);
        new PreviewModal(this.app,this,file,markdown,null,{documentMode:true}).open();
      },
    });
    this.addCommand({ id: 'preview-current-question', name: '预览并导出当前数学题卡（P0）',
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file) { new Notice('请先打开一份 Markdown 题卡。'); return; }
        const markdown = await this.app.vault.read(file);
        new PreviewModal(this.app, this, file, markdown).open();
      },
    });
    this.addCommand({ id: 'set-current-question-teaching-role', name: '设置当前题卡教学角色（例题/变式/练习/检测）',
      callback: () => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) { new Notice('请先打开一份题卡'); return; }
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!isQuestion(fm)) { new Notice('当前文件没有可识别的试题类型或 object_type，已停止修改'); return; }
        new RolePickerModal(this.app, file).open();
      },
    });
    this.addCommand({ id: 'preview-current-folder-exam', name: '当前文件夹组卷并预览 A4 试卷',
      callback: async () => {
        try {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          const file = view?.file;
          if (!file) { new Notice('请先打开目标文件夹内的一道题卡。'); return; }
          const folderPath = file.parent?.path || '/';
          const matches = this.app.vault.getMarkdownFiles().filter(item => (item.parent?.path || '/') === folderPath);
          if (matches.length > 200) throw new Error('文件夹内超过 200 个 Markdown 文件，请分批组卷');
          const records = [];
          for (const entry of matches) records.push({
            file:entry, markdown:await this.app.vault.read(entry),
            metadata:this.app.metadataCache.getFileCache(entry)?.frontmatter || undefined,
          });
          const exam = collectExamItems(records);
          if (!exam.items.length) { new Notice('当前文件夹未发现有效题卡（需有标准 type 或 object_type）。'); return; }
          if (exam.items.length > 100) throw new Error('一次组卷至多 100 道题，请拆分文件夹');
          const name = file.parent?.name || '根目录';
          new PreviewModal(this.app, this, file, '', {...exam, title:'数学试卷'}).open();
        } catch (e) { new Notice('文件夹组卷失败：'+(e?.message || e)); }
      },
    });
    // Markdown postprocessors run in Reading View, not CodeMirror Live Preview.
    // A processor root may not yet be connected to a reading view: annotate its
    // marks immediately rather than returning early based on element.closest().
    this.registerMarkdownPostProcessor((element, context) => {
      const fm = this.app.metadataCache.getCache(context.sourcePath)?.frontmatter;
      const question = isQuestion(fm);
      const mathMaterial = question || /^(?:handout|lesson|lecture|worksheet|讲义|试卷)$/i
        .test(String(fm?.note_type || '').trim());
      const reading = element.closest?.('.markdown-preview-view');
      // Typed answer markers come from the section's raw Markdown.
      // Native ==highlight== remains a regular Obsidian mark.
      const sectionSource = typeof context.getSectionInfo === 'function'
        ? context.getSectionInfo(element)?.text : null;
      const sectionHasAnswers = typeof sectionSource === 'string' &&
        (sectionSource.includes('?{') || sectionSource.includes('!{')) &&
        answerSlots(sectionSource).length > 0;
      if (reading) {
        reading.classList.toggle('mwb-reading-view', question);
        reading.classList.toggle('mwb-math-material', mathMaterial);
        const sizer = reading.querySelector('.markdown-preview-sizer') || element;
        sizer.classList.toggle('mwb-typography', question);
        if (sectionHasAnswers) {
          reading.parentElement?.classList.add('mwb-answer-note');
          reading.classList.add('mwb-answer-note');
        }
      }
      if (sectionHasAnswers) {
        void Promise.resolve(finishRenderMath()).then(() => {
          requestAnimationFrame(() => {
            if (!element.isConnected) return;
            mwbDecorateReadingTypedSlots(element, sectionSource);
          });
        }).catch(() => {});
      }
      if (reading && element.querySelector('ul, ol')) {
        void Promise.resolve(finishRenderMath()).then(() => {
          if (!element.isConnected) return;
          requestAnimationFrame(() => {
            if (!element.isConnected) return;
            try { layoutOptionGrids(element); }
            catch (e) { console.warn('[Math Teaching Workbench] reading option grid not ready:',e); }
          });
        }).catch(() => {});
      }
    });

    // Live Preview: replace *source ranges* ==$...$== with CodeMirror widgets.
    // This does not depend on Markdown highlight/MathJax DOM coincidence and
    // never modifies the user's Markdown or the PDF transformer.
    try {
      const cmRuntime = require('@codemirror/view'); // Obsidian's external CM6 runtime
      this.registerEditorExtension(createMathAnswerEditorExtension(
        cmRuntime, renderMath, finishRenderMath));
    } catch (e) {
      console.error('[Math Teaching Workbench] CodeMirror 6 答案隐藏扩展加载失败', e);
      new Notice('数学填空实时预览扩展未加载，请查看开发者控制台错误',10000);
    }
    const syncAnswerViews = () => {
      const leaves=this.app.workspace.getLeavesOfType?.('markdown') || [];
      syncQuestionViewClasses(leaves,
        file => this.app.metadataCache.getFileCache(file)?.frontmatter, isQuestion);
      // CodeMirror tracks edits and slot visibility itself. An empty dispatch
      // for every metadata update would repeatedly refresh all open editors.
    };
    if (typeof this.app.workspace.onLayoutReady === 'function')
      this.app.workspace.onLayoutReady(syncAnswerViews);
    else syncAnswerViews();
    const listen = (emitter, event) => {
      if (typeof emitter?.on === 'function' && typeof this.registerEvent === 'function')
        this.registerEvent(emitter.on(event, syncAnswerViews));
    };
    listen(this.app.workspace, 'file-open');
    listen(this.app.workspace, 'active-leaf-change');
    listen(this.app.workspace, 'layout-change');
    // Live Preview follows CodeMirror doc changes directly; refreshing every
    // editor-change would rescan the whole document and dispatch another update.
    listen(this.app.metadataCache, 'changed');
  }
};

