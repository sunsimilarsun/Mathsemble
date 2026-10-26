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
vm.runInNewContext(js+'\n;globalThis.mathsembleAudit={handoutPlan,transformQuestion,answerSlots,collectExamItems,typographyCss,pdfBufferFromHtml,mwbScanTypedLine,mwbTypedSlots,mwbRewriteTypedAnswers,mwbValidateTypedAnswers,mwbMapUnchangedAnswerSlots,mwbVisibleAnswerSlots,buildMathAnswerDecorations,studentSpacePlan,teacherOnlyCalloutIndices};',ctx,{timeout:15000});
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

test('Reading View invokes the typed DOM decorator, not legacy highlight masking',()=>{
  assert.match(js,/mwbDecorateReadingTypedSlots\(element, sectionSource\)/);
  assert.doesNotMatch(js,/decorateAnswerMarks\(element,\s*true/);
  assert.doesNotMatch(js,/function decorateAnswerMarks\(/);
});
test('Live Preview indexes typed answers and reuses cache on non-document updates',()=>{
  assert.match(js,/this\.slots = answerSlots\(view\.state\.doc\.toString\(\)\)/);
  assert.match(js,/mwbMapUnchangedAnswerSlots\(this\.slots, update\)/);
  assert.match(js,/mwbVisibleAnswerSlots\(slots, view\.visibleRanges\)/);
  assert.doesNotMatch(js,/if \(!source\.includes\('=='\)\)/);
});
test('diagnostic version comes from actual plugin manifest rather than fixed v0.1.9',()=>{
  assert.match(js,/this\.manifest\?\.version \|\| 'unknown'/);
  assert.doesNotMatch(js,/版本:'v0\.1\.9'/);
});

test('repository host sample projects typed answers without leaking teacher-only callouts',()=>{
  const hostSource=fs.readFileSync(path.resolve(__dirname,'fixtures/typed-answer-host.md'),'utf8');
  const student=handoutPlan(hostSource,'student');
  const teacher=handoutPlan(hostSource,'teacher');
  assert.match(student.markdown,/==这是 Obsidian 普通高亮内容/);
  assert.match(teacher.markdown,/==这是 Obsidian 普通高亮内容/);
  assert.doesNotMatch(student.markdown,/掌握数学概念、基本方法及运算步骤|独立证明段落甲|独立提示段落乙/);
  assert.doesNotMatch(student.markdown,/\!\{ACD\}|\?\{\-1\}/);
  assert.match(student.markdown,/MWB_SOLUTION_SPACE_ANCHOR_/);
  assert.match(teacher.markdown,/独立证明段落甲|独立提示段落乙/);
  assert.match(teacher.markdown,/掌握数学概念/);
  assert.match(student.markdown,/代码块内部的 \?\{代码填空\}/);
  assert.match(student.markdown,/\\\?\{普通文本\}/);
});


test('live-preview slot index reuses ordinary edits and preserves exact offsets in long notes',()=>{
  const {mwbMapUnchangedAnswerSlots}=ctx.mathsembleAudit;
  const original=['# 讲义',...Array(12000).fill('普通题干：请计算对应数值。'),
    '填写 ?{42} 和 !{BC}。'].join('\n');
  const slots=answerSlots(original);
  assert.equal(slots.length,2);
  const pos=original.indexOf('普通题干')+2;
  const inserted='新字';
  const changed=original.slice(0,pos)+inserted+original.slice(pos);
  const doc=(s)=>({
    sliceString:(a,b)=>s.slice(a,b),
    lineAt:(at)=>{
      const from=s.lastIndexOf('\n',Math.max(0,at-1))+1;
      const end=s.indexOf('\n',at);
      return {from,text:s.slice(from,end<0?s.length:end)};
    },
  });
  const update={
    startState:{doc:doc(original)},state:{doc:doc(changed)},
    changes:{
      iterChanges:cb=>cb(pos,pos,pos,pos+inserted.length,{toString:()=>inserted}),
      mapPos:p=>p>=pos?p+inserted.length:p,
    },
  };
  const cached=mwbMapUnchangedAnswerSlots(slots,update);
  assert.ok(cached,'ordinary body edit should reuse token index');
  assert.deepEqual(Array.from(cached,s=>[s.from,s.to,s.raw]),Array.from(answerSlots(changed),s=>[s.from,s.to,s.raw]));
  const structuralUpdate={...update,changes:{
    ...update.changes,
    iterChanges:cb=>cb(pos,pos,pos,pos+1,{toString:()=>'?'}),
  }};
  assert.equal(mwbMapUnchangedAnswerSlots(slots,structuralUpdate),null);
  const inside=slots[0].from+3;
  const insideUpdate={...update,changes:{
    iterChanges:cb=>cb(inside,inside,inside,inside+1,{toString:()=> '7'}),
    mapPos:p=>p>=inside?p+1:p,
  }};
  assert.equal(mwbMapUnchangedAnswerSlots(slots,insideUpdate),null);
});

test('live preview only decorates visible answers without rereading cached Markdown',()=>{
  const {mwbVisibleAnswerSlots,buildMathAnswerDecorations}=ctx.mathsembleAudit;
  const slots=answerSlots('填空 ?{1}\n'+Array(50).fill('正文').join('\n')+'\n选择 !{B}');
  const visible=mwbVisibleAnswerSlots(slots,[{from:0,to:9}]);
  assert.equal(visible.length,1);
  const engine={
    Decoration:{
      none:[],
      replace:({widget})=>({range:(from,to)=>({from,to,widget})}),
      set:r=>r,
    },
    MathAnswerWidget:class {constructor(slot){this.slot=slot;}},
    TextAnswerWidget:class {constructor(slot){this.slot=slot;}},
  };
  const view={
    dom:{closest:()=>({})},visibleRanges:[{from:0,to:9}],
    state:{
      selection:{ranges:[]},
      doc:{toString:()=>{throw new Error('should not read entire document');}},
    },
  };
  const decorations=buildMathAnswerDecorations(view,engine,slots);
  assert.equal(decorations.length,1);
  assert.equal(decorations[0].widget.slot.raw,'1');
});

test('metadata change handling avoids full Markdown scans and CodeMirror no-op dispatch',()=>{
  const section=js.slice(js.indexOf('function syncQuestionViewClasses'),js.indexOf('// Return cloze boundaries'));
  assert.doesNotMatch(section,/getValue\(\)|answerSlots\(raw\)/);
  const sync=js.slice(js.indexOf('const syncAnswerViews ='),js.indexOf("listen(this.app.metadataCache, 'changed')"));
  assert.doesNotMatch(sync,/refreshQuestionEditors\(leaves\)/);
});


test('answer retains writing space while teacher-only solution defaults to none',()=>{
  const source=[
    '# 同一题分离答案和思路',
    '求 $x$。',
    '> [!answer]- 完整步骤',
    '> 先写已知，再计算最终结果',
    '> [!solution]- 解题思路',
    '> 使用换元法观察结构',
    '> [!note]+ 教师备注',
    '> 提醒审题',
    '> [!definition] 双版本共用',
    '> 定义内容',
  ].join('\n');
  const student=handoutPlan(source,'student');
  assert.equal(student.solutionCount,2,'answer and ordinary marked note reserve space');
  assert.equal(count(student.markdown,/MWB_SOLUTION_SPACE_ANCHOR_\d+_END/g),2);
  assert.doesNotMatch(student.markdown,/先写已知|换元法|提醒审题/);
  assert.match(student.markdown,/定义内容/);
  assert.deepEqual(Array.from(ctx.mathsembleAudit.teacherOnlyCalloutIndices(source)),[0,2]);
  const studentWithSolution=handoutPlan(source,'student',{solutionSpaces:true});
  assert.equal(studentWithSolution.solutionCount,3);
  assert.deepEqual(Array.from(ctx.mathsembleAudit.teacherOnlyCalloutIndices(source,{solutionSpaces:true})),[0,1,2]);
  assert.equal(count(studentWithSolution.markdown,/MWB_SOLUTION_SPACE_ANCHOR_\d+_END/g),3);
  assert.doesNotMatch(studentWithSolution.markdown,/换元法/);
  const teacher=handoutPlan(source,'teacher');
  assert.match(teacher.markdown,/先写已知|换元法|提醒审题|定义内容/);
  const teacherWithoutSolution=handoutPlan(source,'teacher',{showSolution:false});
  assert.doesNotMatch(teacherWithoutSolution.markdown,/换元法|解题思路/);
  assert.match(teacherWithoutSolution.markdown,/先写已知|提醒审题|定义内容/);
  assert.equal(handoutPlan(source,'document',{showSolution:false}).markdown.includes('[!solution]-'),true);
});

test('teacher-only solution filters independently of answer type and all other callouts',()=>{
  const source=[
    '> [!answer]+ 最终答案',
    '> 结果为 $2$',
    '> [!solution]+ 方法详解',
    '> 先配方再讨论',
    '> [!scaffold]- 教师提示',
    '> 先画出函数图像',
  ].join('\n');
  const ordinary=ctx.mathsembleAudit.studentSpacePlan(source);
  const opt=ctx.mathsembleAudit.studentSpacePlan(source,{solutionSpaces:true});
  assert.equal(ordinary.count,2);
  assert.equal(opt.count,3);
  assert.deepEqual(Array.from(ctx.mathsembleAudit.teacherOnlyCalloutIndices(source)),[0,2]);
  assert.deepEqual(Array.from(ctx.mathsembleAudit.teacherOnlyCalloutIndices(source,{solutionSpaces:true})),[0,1,2]);
  const teacher=transformQuestion(source,'teacher',{showSolution:false});
  assert.match(teacher,/最终答案|结果为|教师提示|函数图像/);
  assert.doesNotMatch(teacher,/方法详解|先配方/);
  const unchanged=transformQuestion(source,'teacher');
  assert.match(unchanged,/方法详解|先配方/);
});

test('shared solution stays shared for students but can be omitted in teacher compact mode',()=>{
  const source=[
    '> [!solution] 公共提示',
    '> 先检查定义域',
    '> [!answer]- 标准步骤',
    '> 解得 $x=1$',
  ].join('\n');
  const student=handoutPlan(source,'student');
  assert.equal(student.solutionCount,1);
  assert.match(student.markdown,/公共提示|先检查定义域/);
  const teacher=handoutPlan(source,'teacher',{showSolution:false});
  assert.doesNotMatch(teacher.markdown,/公共提示|先检查定义域/);
  assert.match(teacher.markdown,/标准步骤|x=1/);
});

test('answer-slot syntax and fenced literal solution callouts stay intact',()=>{
  const tick=String.fromCharCode(96).repeat(3);
  const source=[
    '填空 ?{42}，选择 !{A}。',
    '> [!answer]- 答案',
    '> 推导文字',
    '> [!solution]- 思路',
    '> 不应进入学生正文',
    tick+'md',
    '> [!solution]- 仅为代码示例',
    '> 不得过滤',
    tick,
  ].join('\n');
  const student=handoutPlan(source,'student');
  assert.equal(student.solutionCount,1);
  assert.match(student.markdown,/mwb-answer-slot/);
  assert.doesNotMatch(student.markdown,/!{A}|不应进入学生正文/);
  assert.match(student.markdown,/\[!solution\]- 仅为代码示例/);
  assert.match(student.markdown,/不得过滤/);
  const compact=handoutPlan(source,'teacher',{showSolution:false});
  assert.match(compact.markdown,/\[!solution\]- 仅为代码示例/);
  assert.doesNotMatch(compact.markdown,/不应进入学生正文/);
  assert.match(compact.markdown,/42/);
});

test('preview UI passes solution preferences to student and teacher rendering and export rechecks',()=>{
  assert.match(js,/this\.solutionOptions = \{ solutionSpaces: false, showSolution: true \}/);
  assert.match(js,/handoutPlan\(this\.markdown, mode, this\.solutionOptions\)/);
  assert.match(js,/studentSpacePlan\(item\.markdown, this\.solutionOptions\)/);
  assert.match(js,/transformQuestion\(item\.markdown, 'teacher', this\.solutionOptions\)/);
  assert.match(js,/teacherOnlyCalloutIndices\(this\.markdown, this\.solutionOptions\)/);
  assert.match(js,/this\.solutionModeLabels\.student\.style\.display = mode === 'student'/);
  assert.match(js,/this\.solutionModeLabels\.teacher\.style\.display = mode === 'teacher'/);
});

test('print Callout full border uses matching accent and solution is blue gray',()=>{
  const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
  const palette=css.slice(css.indexOf('/* Mathsemble mathematics teaching palette'),css.indexOf('/* v0.2.1: optional metadata'));
  assert.match(css,/\.mwb-typography\.mwb-print-document \.callout \{ background: #fff; border-color: #c4c4c4; border-left: 2px solid #999; \}/);
  assert.match(palette,/border-color: var\(--mwb-callout-accent, #999\);/);
  assert.doesNotMatch(palette,/border-left-color: var\(--mwb-callout-accent, #999\);/);
  const answer=palette.slice(palette.indexOf('.callout[data-callout="answer"] {'),palette.indexOf('.callout[data-callout="scaffold"] {'));
  const solution=palette.slice(palette.indexOf('.callout[data-callout="solution"] {'));
  assert.match(answer,/--mwb-callout-accent: #e67e22;/);
  assert.match(solution,/--mwb-callout-accent: #8794ad;/);
  assert.match(solution,/--mwb-callout-title-ink: #53637e;/);
  assert.equal(css.slice(0,typographyCss.length),typographyCss,'PDF embedded print CSS matches styles.css');
  assert.ok(typographyCss.includes('border-color: var(--mwb-callout-accent, #999);'));
  assert.ok(typographyCss.includes('--mwb-callout-accent: #8794ad;'));
  assert.ok(typographyCss.includes('--mwb-callout-accent: #e67e22;'));
});

test('opening a saved PDF checks vault file identity and uses system default viewer',async()=>{
  vm.runInNewContext('globalThis.mwbOpenExportedPdf = openExportedPdf;',ctx);
  const opened=[];
  const app={vault:{
    getAbstractFileByPath:filename=>filename==='ExamExports/valid.pdf'?{extension:'pdf'}:null,
    adapter:{getFullPath:filename=>'/vault/'+filename}
  }};
  const shell={openPath:async full=>{opened.push(full);return '';}};
  await ctx.mwbOpenExportedPdf(app,'ExamExports/valid.pdf',shell);
  assert.deepEqual(opened,['/vault/ExamExports/valid.pdf']);
  await assert.rejects(ctx.mwbOpenExportedPdf(app,'../secrets.pdf',shell),/仅支持打开/);
  await assert.rejects(ctx.mwbOpenExportedPdf(app,'ExamExports/missing.pdf',shell),/不存在/);
  await assert.rejects(ctx.mwbOpenExportedPdf(app,'ExamExports/valid.pdf',{openPath:async()=> 'No PDF reader'}),/No PDF reader/);
  assert.equal(opened.length,1,'invalid files must never invoke the OS opener');
});
test('A4 preview maintains source geometry and PDF export path independently',()=>{
  assert.match(js,/const \{ pdfBufferFromHtml, paginatePreviewDocument \} =/);
  assert.match(js,/function paginatePrintDocument\(root, allowPartialMath = false, preview = false\)/);
  assert.match(js,/if \(!preview\) doc\.head\.appendChild\(paper\);/);
  assert.match(js,/const view = this\.rendered\.cloneNode\(true\);/);
  assert.match(js,/paginatePreviewDocument\(view, false, true\)/);
  assert.match(js,/this\.page\.classList\.add\('mwb-preview-source'\)/);
  assert.match(js,/this\.page\.classList\.remove\('mwb-preview-source'\)/);
  assert.match(js,/return await exportHtml\(this\.rendered, title, typographyCss, document/);
  assert.match(js,/this\.lastSavedPdfPath = savedPath;/);
  assert.match(js,/openPdfButton\.onclick = async/);
  const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
  assert.match(css,/\.mwb-modal \.mwb-preview-pages \.mwb-paper \{/);
  assert.match(css,/\.mwb-modal \.mwb-preview-pages \.mwb-paper-footer \{/);
  assert.match(css,/\.mwb-modal \.mwb-page\.mwb-preview-source \{/);
});
