'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
const context={console,Buffer,module:{exports:{}},require:name=>name==='obsidian'?{
 Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},
}: {}};
vm.runInNewContext(source+'\nglobalThis.headingRuleLayout=paginatePreviewDocument;',context);
const printCss=JSON.parse(source.match(/module\.exports = \{typographyCss:("(?:\\.|[^"\\])*")\};/)[1]);

test('real Chromium: printable horizontal rules keep host preview and isolated export pagination identical',async t=>{
 const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(file=>file&&fs.existsSync(file));
 if(!chrome){if(process.env.CI)throw Error('CI requires Chromium');t.skip('Set CHROME_PATH');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-heading-rule-'));
 const script='const paginate='+context.headingRuleLayout.toString()+';\n('+browserCases.toString()+')('+JSON.stringify(css)+','+JSON.stringify(printCss)+');';
 const input=path.join(dir,'fixture.html');
 fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
 try{for(const result of await runChromeDocument(chrome,input,path.join(dir,'profile')))await t.test(result.name,()=>assert.equal(result.ok,true,result.error||''));}
 finally{
  const resolved=path.resolve(dir);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep),'temporary test directory must remain inside the OS temp directory');
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});

async function browserCases(css,printCss){
 const out=[],check=async(name,fn)=>{try{await fn();out.push({name,ok:true});}catch(error){out.push({name,ok:false,error:error.stack});}};
 const ok=(value,message)=>{if(!value)throw Error(message);};
 // Measured Obsidian host defaults: a 15px rem and 30px HR margins. The
 // isolated export has browser defaults, so importing the same plugin CSS
 // alone must be sufficient to eliminate that difference in printable DOM.
 const hostCss='html{font-size:15px}*{box-sizing:border-box}hr{border:0;border-top:2px solid #999;margin:2rem 0}';
 const normalization=/\.mwb-typography\.mwb-print-document hr\s*\{[^}]*\}/g;
 const render=async({preview,normalized=true,student=true})=>{
  const frame=document.createElement('iframe');
  frame.style.cssText='position:fixed;left:-100000px;top:0;width:940px;height:1240px;border:0';
  document.body.appendChild(frame);
  try{
   const doc=frame.contentDocument,selected=preview?css:printCss;
   const rules=normalized?selected:selected.replace(normalization,'');
   doc.open();doc.write('<!doctype html><meta charset="utf-8"><style>'+(preview?hostCss:'')+'</style><style>'+rules+'</style><body>');doc.close();
   const host=doc.createElement('div');if(preview)host.className='mwb-modal';doc.body.appendChild(host);
   const root=doc.createElement('main');root.className='mwb-typography mwb-print-document mwb-export-doc'+(preview?' mwb-preview-pages':'');
   root.setAttribute('data-mwb-question-policy','strict-h5');host.appendChild(root);
   const blocks=Array.from({length:6},(_,index)=>{
    const title=`<h3 data-key="h${index}">Review ${index+1}</h3>`;
    const paragraphs=Array.from({length:3},(_,part)=>`<p data-key="p${index}-${part}" style="height:65px">Paragraph ${index+1}.${part+1}: preserve this complete teaching content.</p><hr data-key="hr${index}-${part}">`).join('');
    const blank=student?`<div class="mwb-answer-space" data-mwb-space-px="300">`+Array.from({length:4},(_,part)=>`<div class="mwb-answer-space-chunk" data-key="s${index}-${part}" style="height:75px"></div>`).join('')+'</div>':'';
    return title+paragraphs+blank;
   }).join('');
   root.innerHTML=blocks;
   const original=[...root.querySelectorAll('[data-key]')],keys=original.map(node=>node.dataset.key),text=original.map(node=>node.textContent).join('');
   await doc.fonts.ready;
   const report=paginate(root,false,preview),papers=[...root.querySelectorAll('.mwb-paper')];
   const placed=[...root.querySelectorAll('[data-key]')];
   ok(JSON.stringify(placed.map(node=>node.dataset.key))===JSON.stringify(keys),'content lost or reordered');
   ok(placed.map(node=>node.textContent).join('')===text,'content text changed');
   ok(original.every(node=>root.contains(node)),'existing content was replaced');
   ok(report.answerSpaceChunks===(student?24:0),'student writing chunks were lost');
   ok(Math.abs(report.answerSpaceExpectedPx-(student?1800:0))<0.01,'writing target changed');
   ok(Math.abs(report.answerSpaceDeltaPx)<0.1,'writing height changed during pagination');
   const hr=root.querySelector('hr'),style=doc.defaultView.getComputedStyle(hr),rect=hr.getBoundingClientRect();
   const geometry={height:rect.height,marginTop:style.marginTop,marginBottom:style.marginBottom,borderTopWidth:style.borderTopWidth,borderBottomWidth:style.borderBottomWidth,boxSizing:style.boxSizing};
   const assignment=papers.flatMap((paper,page)=>[...paper.querySelectorAll('[data-key]')].map(node=>[node.dataset.key,page]));
   let readingMargin=null;
   if(preview){const reading=doc.createElement('div');reading.className='mwb-typography';reading.innerHTML='<hr>';doc.body.appendChild(reading);readingMargin=doc.defaultView.getComputedStyle(reading.firstChild).marginTop;}
   return {report,geometry,assignment,readingMargin};
  }finally{frame.remove();}
 };
 await check('the former unnormalized HR margins reproduce preview and print divergence',async()=>{
  const preview=await render({preview:true,normalized:false}),print=await render({preview:false,normalized:false});
  ok(preview.geometry.marginTop==='30px','host HR fixture no longer reflects its measured default');
  ok(preview.geometry.marginTop!==print.geometry.marginTop,'baseline no longer exposes the host/print margin mismatch');
  ok(preview.report.pages!==print.report.pages,'fixture does not reproduce the page-count discrepancy');
 });
 for(const student of [false,true])await check('normalized rules preserve '+(student?'student writing space':'document content')+' and identical page assignments',async()=>{
  ok(css.replace(normalization,'')!==css&&printCss.replace(normalization,'')!==printCss,'printable HR normalization missing from shared styles');
  const preview=await render({preview:true,student}),print=await render({preview:false,student});
  ok(JSON.stringify(preview.geometry)===JSON.stringify(print.geometry),'HR computed geometry differs');
  ok(preview.geometry.borderTopWidth==='1px'&&preview.geometry.borderBottomWidth==='0px','printable rule border is inconsistent');
  ok(preview.report.pages===print.report.pages,'preview and export page counts differ');
  ok(JSON.stringify(preview.assignment)===JSON.stringify(print.assignment),'preview and export page assignments differ');
  ok(preview.report.answerSpaceChunks===print.report.answerSpaceChunks&&preview.report.answerSpacePlacedPx===print.report.answerSpacePlacedPx,'preview and export writing allocations differ');
  ok(preview.readingMargin==='30px','print normalization changed ordinary reading rules');
 });
 const result=document.createElement('pre');result.id='mwb-test-results';result.textContent=JSON.stringify(out);document.body.appendChild(result);
}
