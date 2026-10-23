'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const js=fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
const obsidian={
  Plugin:class{}, Modal:class{}, Notice:class{},
  MarkdownRenderer:{}, MarkdownView:class{},
  finishRenderMath:()=>Promise.resolve(),
  renderMath:()=>{throw new Error('DOM not available in Node');}
};
const ctx={module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name),console,Buffer};
vm.runInNewContext(js+'\n;globalThis.mathsembleAudit={handoutPlan,transformQuestion,answerSlots,collectExamItems,typographyCss,pdfBufferFromHtml,mwbScanTypedLine,mwbTypedSlots,mwbRewriteTypedAnswers,mwbValidateTypedAnswers};',ctx,{timeout:15000});
const {handoutPlan,transformQuestion,answerSlots,collectExamItems,typographyCss,pdfBufferFromHtml,mwbScanTypedLine,mwbTypedSlots,mwbRewriteTypedAnswers,mwbValidateTypedAnswers}=ctx.mathsembleAudit;
const str=(s)=>String(s);
const count=(s,r)=>[...str(s).matchAll(r)].length;
const synthetic=[
  '---','note_type: handout','---','# 测试讲义',
  '题一 （!{B}）；中文 ?{较长的中文答案}；公式 ?{$\\frac{11}{3}$}。',
  '==这段是普通 Markdown 高亮==',
  '> [!answer]- 教师解答','> 长推导 $a^2+b^2=c^2$',
  '> [!scaffold]+ 脚手架','> 第一步先算根',
  '> [!note] 两版共用','> 这行应同时显示',''
].join('\n');

// Output behavior is tested without DOM; height measurement still requires
// Obsidian/Chromium and cannot be certified by this suite.
test('three modes retain title/source and split visibility deterministically',()=>{
  const raw=handoutPlan(synthetic,'document');
  const student=handoutPlan(synthetic,'student');
  const teacher=handoutPlan(synthetic,'teacher');
  assert.match(raw.markdown,/\[!answer\]-/);
  assert.equal(student.solutionCount,2);
  assert.equal(count(student.markdown,/MWB_SOLUTION_SPACE_ANCHOR_[^\s]+_END/g),2);
  assert.doesNotMatch(student.markdown,/长推导|第一步先算根/);
  assert.match(student.markdown,/这行应同时显示/);
  assert.match(teacher.markdown,/长推导/);
  assert.match(teacher.markdown,/第一步先算根/);
  assert.match(teacher.markdown,/这行应同时显示/);
});
test('choice outside parentheses is blank with NO underline',()=>{
  const student=handoutPlan('选择：(!{BC})','student').markdown;
  assert.doesNotMatch(student,/>?BC/);
  assert.doesNotMatch(student,/mwb-answer-slot/);
});
test('math and Chinese answer slots become non-recoverable student placeholders',()=>{
  const student=handoutPlan('填写 ?{理性推理与运算能力}；数学 ?{$\\frac{11}{3}$}。','student').markdown;
  assert.doesNotMatch(student,/理性推理与运算能力|11\}\{3/);
  assert.equal(count(student,/<span class=\"mwb-answer-slot/g),2);
  assert.match(student,/width:\d+(?:\.\d+)?em/);
});
test('teacher displays answers',()=>{
  const teacher=handoutPlan('填写 ?{42}；公式 ?{$x^2$}。','teacher').markdown;
  assert.match(teacher,/42/);
  assert.match(teacher,/x\^2/);
});
test('plain shared callout still appears in student output',()=>{
  const student=handoutPlan('> [!definition] 一元二次方程\n> 定义公式','student');
  assert.equal(student.solutionCount,0);
  assert.match(student.markdown,/定义公式/);
});
test('recognizes Chinese parentheses as choice, not YAML-based',()=>{
  const student=handoutPlan('（!{CD}）','student').markdown;
  assert.doesNotMatch(student,/CD/);
  assert.doesNotMatch(student,/mwb-answer-slot/);
});
test('code fences remain literal',()=>{
  const student=handoutPlan('```md\n(!{B}) ?{42}\n```','student').markdown;
  assert.match(student,/\(!\{B\}\) \?\{42\}/);
});
test('rendering rejects broken YAML boundary',()=>{
  assert.throws(()=>handoutPlan('---\na: 1\n# missing end','student'),/YAML/);
});
test('folder assembly filters non-question records',()=>{
  const records=[
    {file:{path:'a.md'},markdown:'题目',metadata:{object_type:'question',question_type:'choice'}},
    {file:{path:'b.md'},markdown:'随笔',metadata:{}},
  ];
  const result=collectExamItems(records);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].file.path,'a.md');
});
test('math palette styles known callouts and not examples',()=>{
  for(const type of ['definition','theorem','method','conclusion','attention','thinking','answer','scaffold'])
    assert.ok(typographyCss.includes(`data-callout="${type}"`),type);
  assert.ok(!typographyCss.includes('data-callout="example"'));
});
test('release has one unambiguous plugin identity',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../manifest.json'),'utf8'));
  assert.equal(manifest.id,'math-teaching-workbench');
  const pkg=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../package.json'),'utf8'));
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version,pkg.version);
  assert.equal(manifest.isDesktopOnly,true);
});


test('isolated PDF engine preserves sandbox and always removes temporary HTML',async()=>{
  let tempHtml='',prefs=null,destroyed=false;
  class FakeWindow {
    constructor(opts){prefs=opts.webPreferences;this.webContents={
      executeJavaScript: async s => s.includes('document.querySelector')
        ? {pages:1,blocks:1,answerSpaceChunks:0} : {badImage:false,badMath:false},
      printToPDF: async()=>Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj'),
    };}
    async loadFile(name){tempHtml=name;assert.ok(fs.existsSync(name));}
    isDestroyed(){return destroyed;}
    destroy(){destroyed=true;}
  }
  const result=await pdfBufferFromHtml('<!doctype html><html><main class="mwb-export-doc"></main></html>',FakeWindow);
  assert.equal(result.subarray(0,5).toString('ascii'),'%PDF-');
  assert.equal(result.mwbPrintReport.pages,1);
  assert.deepEqual(JSON.parse(JSON.stringify(prefs)),{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:true});
  assert.equal(fs.existsSync(tempHtml),false);
});

test('formula geometry failures remain blockers without explicit partial permission',async()=>{
  let tempHtml='';
  class FakeWindow {
    constructor(){this.webContents={
      executeJavaScript:async()=>({badImage:false,badMath:true}),
      printToPDF:async()=>{throw new Error('MUST NOT PRINT');}
    };}
    async loadFile(name){tempHtml=name;}
    isDestroyed(){return false;}
    destroy(){}
  }
  await assert.rejects(()=>pdfBufferFromHtml('<!doctype html><html><main class="mwb-export-doc"></main></html>',FakeWindow),/公式几何尺寸异常/);
  assert.equal(fs.existsSync(tempHtml),false);
});

test('partial math permission does not suppress pagination failures',async()=>{
  let tempHtml='';
  class FakeWindow {
    constructor(){this.webContents={
      executeJavaScript:async s=>s.includes('document.querySelector')? {pages:0}: {badImage:false,badMath:true},
      printToPDF:async()=>{throw new Error('MUST NOT PRINT');}
    };}
    async loadFile(name){tempHtml=name;}
    isDestroyed(){return false;}
    destroy(){}
  }
  await assert.rejects(()=>pdfBufferFromHtml('<!doctype html><html><main class="mwb-export-doc"></main></html>',FakeWindow,{allowPartialMath:true}),/打印前分页失败/);
  assert.equal(fs.existsSync(tempHtml),false);
});

test('ordinary ==highlight== remains visible in both editions',()=>{
  const source='重点 ==凸函数==；选择（!{AC}）；填空 ?{42}。';
  const s=handoutPlan(source,'student').markdown,t=handoutPlan(source,'teacher').markdown;
  assert.match(s,/==凸函数==/); assert.match(t,/==凸函数==/);
  assert.doesNotMatch(s,/AC|42/);
  assert.match(t,/AC|42/);
  assert.equal(answerSlots(source).length,2);
});
test('legacy answer highlighting no longer hides an answer',()=>{
  const source='旧填空 ==42==，旧选择（==AC==）。';
  assert.equal(answerSlots(source).length,0);
  assert.match(handoutPlan(source,'student').markdown,/==42==/);
  assert.match(handoutPlan(source,'student').markdown,/（==AC==）/);
});
test('math answer tokens preserve nested LaTeX braces',()=>{
  const source='?{$\\frac{1}{2}$} ?{$\\sqrt{x^{2}+1}$}';
  const slots=answerSlots(source);
  assert.equal(slots.length,2);
  assert.equal(slots[0].latex,'\\frac{1}{2}');
  assert.equal(slots[1].latex,'\\sqrt{x^{2}+1}');
  const s=handoutPlan(source,'student').markdown;
  assert.doesNotMatch(s,/frac|sqrt/);
  assert.match(s,/mwb-answer-slot/);
  assert.match(handoutPlan(source,'teacher').markdown,/frac|sqrt/);
});
test('single and multiple choice have no underline regardless of parentheses',()=>{
  const source='(!{B})、（!{ACD}）、!{C}';
  const s=transformQuestion(source,'student');
  assert.equal(count(s,/mwb-choice-slot/g),3);
  assert.doesNotMatch(s,/mwb-answer-slot|ACD/);
  assert.match(transformQuestion(source,'teacher'),/ACD/);
});
test('math-context fills use TeX rather than HTML markup',()=>{
  const s=transformQuestion('$x=?{\\frac{1}{2}}$','student');
  assert.match(s,/\\underline\{\\hspace/);
  assert.doesNotMatch(s,/<span/);
  assert.match(transformQuestion('$x=?{\\frac{1}{2}}$','teacher'),/\\underline\{\\color\{red\}/);
});
test('fenced, inline-code and escaped markers stay literal',()=>{
  const tick=String.fromCharCode(96);
  const source='普通 ?{7} \\?{8} '+tick+'?{9}'+tick+'\n'+tick.repeat(3)+'md\n?{10} !{X}\n'+tick.repeat(3);
  const s=handoutPlan(source,'student').markdown;
  assert.equal(count(s,/class="mwb-answer-slot/g),1);
  assert.match(s,/\?\{8\}/);assert.match(s,/\?\{9\}/);assert.match(s,/\?\{10\}/);assert.match(s,/!\{X\}/);
});
test('unclosed and empty typed tokens fail before PDF',()=>{
  assert.throws(()=>handoutPlan('题 ?{\\frac{1}{2}','student'),/答案|花括号/);
  assert.throws(()=>handoutPlan('题 ?{}','student'),/答案/);
});
test('YAML three-dot terminator does not hide typed answers',()=>{
  const source='---\nnote_type: handout\n...\n计算 ?{42}';
  assert.equal(answerSlots(source).length,1);
  assert.doesNotMatch(handoutPlan(source,'student').markdown,/42/);
});
test('multiple slots on one line keep exact CodeMirror source ranges',()=>{
  const source='两空 ?{甲}，?{乙}，选择 !{C}。';
  const slots=answerSlots(source);
  assert.equal(slots.length,3);
  assert.deepEqual(Array.from(slots,s=>source.slice(s.from,s.to)),['?{甲}','?{乙}','!{C}']);
});
