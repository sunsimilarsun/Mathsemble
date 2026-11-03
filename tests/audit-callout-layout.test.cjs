'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const {root,source}=require('./helpers/audit-api.cjs');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
function browserTests(){
  const results=[];
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const check=(name,run)=>{try{const details=run();results.push({name,ok:true,details});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
  const long='说明函数的单调性并验证结果。abc😀𝑥 '.repeat(450);
  const callout=html=>'<div class="callout" data-callout="answer"><div class="callout-title">解答</div><div class="callout-content">'+html+'</div></div>';
  const question=html=>'<section class="mwb-handout-question" data-mwb-question-id="q1"><div class="mwb-exam-question-content"><h5>例1</h5><p>题干</p>'+html+'</div></section>';
  const create=(html,strict=false,preview=false)=>{
    const modal=document.createElement('div');modal.className='mwb-modal';
    const root=document.createElement('main');root.className='mwb-export-doc mwb-typography mwb-print-document'+(preview?' mwb-preview-pages':'');
    if(strict)root.setAttribute('data-mwb-question-policy','strict-h5');
    root.innerHTML=html;modal.appendChild(root);document.body.appendChild(modal);return {root,dispose:()=>modal.remove()};
  };
  const bodyText=root=>Array.from(root.querySelectorAll('.callout-content')).map(el=>el.textContent).join('');
  function longCase(html,extra=()=>{}){
    const fixture=create(callout(html));
    const before=fixture.root.querySelector('.callout-content').textContent;
    const report=auditApi.paginatePreviewDocument(fixture.root);
    assert(report.pages>1,'expected multiple pages');
    assert(bodyText(fixture.root)===before,'text changed/lost');
    assert(fixture.root.querySelectorAll('.mwb-paper-footer').length===report.pages,'footer count');
    assert(fixture.root.querySelectorAll('.callout-title').length>=2,'continuation titles missing');
    extra(fixture.root,report);
    const details={pages:report.pages,characters:before.length};fixture.dispose();return details;
  }
  check('B1 single long Callout paragraph retains every Unicode character',()=>longCase('<p>'+long+'</p>'));
  check('B1 single long LI retains text and original list value',()=>longCase('<ol start="7"><li>'+long+'</li><li id="next">下一条</li></ol>',root=>{
    const items=[...root.querySelectorAll('li')];
    assert(items.slice(0,-1).every(li=>li.getAttribute('value')==='7'),'continued item number changed');
    assert(items.at(-1).id==='next','next list item lost');
    assert(items.at(-1).previousElementSibling?.getAttribute('value')==='7','next source item follows continued 7');
    assert(items.slice(1,-1).every(li=>li.style.listStyleType==='none'),'continued LI repeated a printed number');
  }));
  check('B1 loose LI paragraphs and nested emphasis retain formatting',()=>longCase('<ul><li><p><strong>'+long+'</strong></p><p>第二段。</p></li></ul>',root=>{
    assert(root.querySelectorAll('strong').length>1,'bold wrapper lost on continuation');
    assert([...root.querySelectorAll('strong')].map(el=>el.textContent).join('')===long,'bold text changed');
  }));
  check('B1 inline SVG formula is moved once, not re-typeset or split',()=>{
    const fixture=create(callout('<p>'+long.slice(0,5000)+'<mjx-container style="display:inline-block;width:40px;height:20px"><svg width="40" height="20" viewBox="0 0 40 20"><path d="M1 1 L35 15" stroke="black"/></svg></mjx-container>'+long.slice(5000)+'</p>'));
    const math=fixture.root.querySelector('mjx-container'),markup=math.outerHTML;
    const before=bodyText(fixture.root),report=auditApi.paginatePreviewDocument(fixture.root);
    assert(fixture.root.querySelector('mjx-container')===math,'formula node replaced');
    assert(math.outerHTML===markup,'formula markup changed');
    assert(fixture.root.querySelectorAll('mjx-container').length===1,'formula duplicated');
    assert(bodyText(fixture.root)===before,'surrounding text changed');
    fixture.dispose();return {pages:report.pages};
  });
  check('B1 long paragraph followed by a display formula can relax an oversized step',()=>longCase('<p>'+long+'</p><div class="math" style="height:40px">DISPLAY_FORMULA</div>',root=>{
    assert(root.querySelectorAll('.math').length===1,'display formula duplicated/lost');
  }));
  check('B1 introduction and long first list item can share the first page',()=>longCase('<p>按如下步骤解答：</p><ol><li>'+long+'</li><li>结束</li></ol>',root=>{
    const first=root.querySelector('.mwb-paper-body');
    assert(first.textContent.includes('按如下步骤解答：') && first.textContent.includes('说明函数'),'introduction orphaned');
  }));
  check('B1 nested anchors survive exactly once across long bold spans',()=>longCase('<p><strong id="long-anchor">'+long+'</strong></p>',root=>{
    assert(root.querySelectorAll('#long-anchor').length===1,'anchor duplicated or lost');
  }));
  check('B1 ordinary multi-step Callout retains step order',()=>longCase(Array.from({length:25},(_,i)=>'<p>步骤'+i+'：'+long.slice(0,450)+'</p>').join('')));
  check('B1 short Callout remains intact',()=>{
    const fixture=create(callout('<p>短答案。</p>'));const node=fixture.root.firstElementChild;
    const report=auditApi.paginatePreviewDocument(fixture.root);
    assert(report.pages===1 && fixture.root.querySelectorAll('.callout').length===1,'short block split');
    assert(fixture.root.querySelector('.callout')===node,'short node replaced');fixture.dispose();
  });
  check('B1 strict long question starts fresh and text is complete',()=>{
    const fixture=create('<p style="height:200px">前文</p>'+question(callout('<p>'+long+'</p>')),true);
    const report=auditApi.paginatePreviewDocument(fixture.root);
    assert(report.strictQuestionPages[0].startPage===2,'long question failed fresh-page rule');
    assert(bodyText(fixture.root)===long,'long answer text changed');
    assert(fixture.root.querySelectorAll('h5').length===1,'question title duplicated');
    fixture.dispose();return report.strictQuestionPages[0];
  });
  check('B1 strict short question moves as a whole',()=>{
    const fixture=create('<p style="height:920px">前文</p>'+question(callout('<p>短答案。</p>')),true);
    const report=auditApi.paginatePreviewDocument(fixture.root),q=report.strictQuestionPages[0];
    assert(q.short && q.pages.length===1 && q.startPage===2,'short whole question split');fixture.dispose();
  });
  check('B1 student space remains exactly measured, including handwriting-only tail',()=>{
    const fixture=create(question('<p>MWB_SOLUTION_SPACE_ANCHOR_0_END</p>'),true);
    auditApi.injectSpaceNodes(fixture.root,[2400],{ratio:125,minimumCm:0},document);
    const report=auditApi.paginatePreviewDocument(fixture.root);
    assert(report.answerSpaceExpectedPx===3000 && Math.abs(report.answerSpaceDeltaPx)<0.05,'space height changed');
    assert(report.pages>2,'writing-only tail removed');fixture.dispose();return {pages:report.pages,spacePx:report.answerSpacePlacedPx};
  });
  check('B1 forced page break still overrides whole-question protection',()=>{
    const fixture=create(question('<p>第一部分</p><div class="mwb-page-break" data-mwb-page-break="true"></div><p>第二部分</p>'),true);
    const report=auditApi.paginatePreviewDocument(fixture.root);
    assert(report.forcedPageBreaks===1 && report.strictQuestionPages[0].forced,'explicit break lost');fixture.dispose();
  });
  for(const partial of [false,true])check('B1 oversized atomic math stays blocked; partial='+partial,()=>{
    const fixture=create(callout('<p><mjx-container style="display:inline-block;width:100px;height:1600px">巨大公式</mjx-container></p>'));
    let error;try{auditApi.paginatePreviewDocument(fixture.root,partial);}catch(e){error=e;}
    assert(error && /不可拆分|溢出|不可容纳/.test(error.message),'unbreakable formula was clipped/accepted');fixture.dispose();
  });
  check('B1 preview and isolated-print pagination agree',()=>{
    const html='<p style="height:180px">前文</p>'+question(callout('<ol start="3"><li>'+long+'</li><li>后续步骤</li></ol>'));
    const assignments=[];
    for(const preview of [false,true]){
      const fixture=create(html,true,preview);
      const report=auditApi.paginatePreviewDocument(fixture.root,false,preview);
      assignments.push({pages:report.pages,questions:report.strictQuestionPages,text:bodyText(fixture.root)});fixture.dispose();
    }
    assert(JSON.stringify(assignments[0])===JSON.stringify(assignments[1]),'preview/print assignments differ');return {pages:assignments[0].pages};
  });
  check('A2 real DOM literal code is not a missing-render blocker',()=>{
    const fixture=create('<p>语法</p><pre><code>$x^2$</code></pre>');
    assert(auditApi.issuesInRenderedNode(fixture.root,'语法\n\n```\n$x^2$\n```').length===0,'literal code false positive');
    assert(auditApi.divideRenderIssues(fixture.root,auditApi.issuesInRenderedNode(fixture.root,'$x^2$')).blockers.length===1,'real missing math not blocked');fixture.dispose();
  });
  const out=document.createElement('pre');out.id='mwb-test-results';out.textContent=JSON.stringify(results);document.body.appendChild(out);
}
test('audit fixes: actual Chromium with the full source and production stylesheet',async t=>{
  const candidates=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',
    process.env.ProgramFiles && path.join(process.env.ProgramFiles,'Google/Chrome/Application/chrome.exe')].filter(Boolean);
  const executable=candidates.find(x=>fs.existsSync(x));assert.ok(executable,'Chrome required; set CHROME_PATH');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-audit-layout-'));
  try{
    const bootstrap=`const module={exports:{}};const require=name=>name==='obsidian'?{Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:async()=>{},renderMath:()=>{throw Error('No MathJax emulation')}}:{};`;
    const expose=`window.auditApi={paginatePreviewDocument,injectSpaceNodes,issuesInRenderedNode,divideRenderIssues};`;
    const js='(()=>{'+bootstrap+source+'\n'+expose+'})();\n('+browserTests.toString()+')();';
    const html='<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>';
    const input=path.join(tmp,'test.html');fs.writeFileSync(input,html);
    const results=await runChromeDocument(executable,input,path.join(tmp,'profile'));
    assert.equal(results.length,17,'browser did not run all assertions');
    for(const result of results)await t.test(result.name,()=>assert.ok(result.ok,result.error));
    if(process.env.MATHSEMBLE_AUDIT_RESULTS)fs.writeFileSync(process.env.MATHSEMBLE_AUDIT_RESULTS,JSON.stringify(results,null,2));
  }finally{fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
});
