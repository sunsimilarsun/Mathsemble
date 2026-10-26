'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const js=fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
const stub="const module={exports:{}};const obsidian={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:()=>Promise.resolve(),renderMath:()=>{throw Error('not the Obsidian host')}};function require(n){return n==='obsidian'?obsidian:{}};";
const load=stub+'\n'+js+'\nglobalThis.audit={metadataOf,stripFrontmatter,normalizePrintBlanks,mwbDecorateReadingTypedSlots,mwbTypedSlots,handoutPlan};';
const ctx={console,Buffer};vm.runInNewContext(load,ctx);const a=ctx.audit;
test('YAML three-dot boundary protects fallback metadata from body key/value lines',()=>{
 for(const newline of ['\n','\r\n'])for(const end of ['---','...']){
  const source=['\uFEFF---','question_type: short_answer','source: original','knowledge_nodes: [K1]',end,'题干','source: body','question_type: choice','knowledge_nodes: [wrong]'].join(newline);
  const result=a.metadataOf({markdown:source});
  assert.equal(result.source,'original');assert.equal(result.question_type,'short_answer');assert.deepEqual(Array.from(result.knowledge_nodes),['K1']);
  assert.match(a.stripFrontmatter(source),/source: body/);
  assert.equal(a.metadataOf({markdown:source,metadata:{source:'cache'}}).source,'cache');
 }
});
test('both objective-type readers stop at three dots; two dots do not terminate YAML',()=>{
 const readers=[...js.matchAll(/function objectiveTypeFromFrontmatter\(markdown\) \{[\s\S]*?\n\}/g)];
 assert.equal(readers.length,2);
 for(const entry of readers){
  const f=vm.runInNewContext('('+entry[0]+')');
  assert.equal(f('---\nquestion_type: short_answer\n...\nquestion_type: choice'),false);
  assert.equal(f('---\nquestion_type: choice\n...\nquestion_type: short_answer'),true);
  assert.equal(f('---\n..\nquestion_type: choice\n---\n题干'),true);
 }
 assert.throws(()=>a.stripFrontmatter('---\nquestion_type: choice\n..\n题干'),/未闭合/);
});
test('link/image/comment on the same line no longer suppresses a real writing blank',()=>{
 const literals=['[参考](https://example.com/a_b)','![题图](assets/a_b.png)','<!-- note ___ -->','https://example.com/a___b','[[my___file]]','[x][ref]','<span title="a > b___">文字</span>'];
 for(const literal of literals){
  const output=a.normalizePrintBlanks(literal+' 求值：______。');
  assert.ok(output.startsWith(literal),literal);
  assert.equal((output.match(/mwb-fixed-blank/g)||[]).length,1,literal);
 }
});
test('balanced links, escaped targets, nested labels and multiline comments stay literal',()=>{
 const cases=[
  '[outer [inner]](a_(b___).png "a ) title")',
  '[image](assets/a\\)b___(c).png)',
  '![alt___](assets/x___y.png)',
  '[label___][reference___]',
  '<a href="a___" title=">">x</a>',
 ];
 for(const literal of cases){
  const output=a.normalizePrintBlanks(literal+'：___。');
  assert.ok(output.startsWith(literal),literal);assert.equal((output.match(/mwb-fixed-blank/g)||[]).length,1);
 }
 const comment='<!-- first ___\nsecond ___ -->';
 const output=a.normalizePrintBlanks(comment+' 后面：______。');
 assert.ok(output.startsWith(comment));assert.equal((output.match(/mwb-fixed-blank/g)||[]).length,1);
 assert.match(a.normalizePrintBlanks('<!-- start\n    end -->\n求值：______。'),/mwb-fixed-blank/);
 const unfinished='[text](unfinished___';assert.equal(a.normalizePrintBlanks(unfinished),unfinished);
 assert.equal(a.normalizePrintBlanks('[ref]: assets/___.png'), '[ref]: assets/___.png');
});
test('blank scanner preserves code, math, escaped tokens and horizontal rules',()=>{
 for(const source of ['`___`','    ___','```md\n___\n```','> ```md\n> ___\n> ```','$$\n x_{___}\n$$','$x_{___}$','\\(x_{___}\\)','\\[x_{___}\\]','\\___','___','identifier___tail'])
  assert.equal(a.normalizePrintBlanks(source),source,source);
 assert.match(a.handoutPlan('[x](a_b) 求值 ?{42}。','student').markdown,/mwb-answer-slot/);
});
test('legacy == answer implementation is removed without changing native highlighting',()=>{
 assert.doesNotMatch(js,/function (?:formatAnswer|isChoiceAnswerSlot)\(/);
 assert.equal((js.match(/function mwbNormalizePrintBlanks\(/g)||[]).length,1);
 for(const mode of ['student','teacher']) assert.match(a.handoutPlan('普通 ==高亮==，?{42}',mode).markdown,/==高亮==/);
});
test('formula-internal export syntax is retained; no source rewrite to whole-equation blanks',()=>{
 const source='$x=?{2}$，$y=!{B}$';
 const student=a.handoutPlan(source,'student').markdown;
 assert.match(student,/x=\\underline/);assert.doesNotMatch(student,/>2<|\?\{2\}|!\{B\}/);
 assert.match(a.handoutPlan(source,'teacher').markdown,/x=\\underline/);
 assert.equal(source,'$x=?{2}$，$y=!{B}$');
 assert.match(js,/公式内部答案槽说明/);
});
test('real Chromium: Reading View root, underline, keyboard and no ancestor-class dependency',async t=>{
 const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(p=>p&&fs.existsSync(p));
 if(!chrome){if(process.env.CI)throw Error('Chrome required in CI');t.skip('Set CHROME_PATH');return;}
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-reading-'));
 const html='<!doctype html><meta charset="utf-8"><style>:root{--text-normal:#141414;}'+css+'</style><main id="mount"></main><script>'+(load+'\n('+browserCases.toString()+')();').replace(/<\/script/gi,'<\\/script')+'</script>';
 const input=path.join(temp,'reading.html');fs.writeFileSync(input,html);
 try{for(const result of await runChromeDocument(chrome,input,path.join(temp,'profile')))await t.test(result.name,()=>assert.equal(result.ok,true,result.error||''));}
 finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
function browserCases(){
 const results=[],mount=document.getElementById('mount'),a=audit;
 const ok=(value,message)=>{if(!value)throw Error(message);};
 const check=(name,fn)=>{try{mount.replaceChildren();fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.stack||e.message});}};
 const formula='<span class="math-inline"><mjx-container jax="SVG"><svg width="55" height="20"><g fill="currentColor"><text x="0" y="16">x=1</text></g></svg></mjx-container></span>';
 for(const mode of ['ancestor-note','self-note','no-note','embed-without-reading-container'])for(const math of [false,true]){
  check(mode+': '+(math?'formula':'text')+' fill stays underlined and reveals on focus',()=>{
   const host=document.createElement('div'),view=document.createElement('div');mount.append(host);host.append(view);
   if(mode==='ancestor-note')host.className='mwb-answer-note';
   view.className=mode==='embed-without-reading-container'?'':'markdown-preview-view';if(mode==='self-note')view.classList.add('mwb-answer-note');
   view.innerHTML='<p>答案：?{'+(math?formula:'42')+'}。</p>';
   ok(a.mwbDecorateReadingTypedSlots(view,math?'答案：?{$x=1$}。':'答案：?{42}。')===1,'answer not decorated');
   const mark=view.querySelector('mark');const original=mark.getBoundingClientRect();
   ok(getComputedStyle(mark).borderBottomWidth==='1px','missing writing line');
   if(math){ok(mark.classList.contains('mwb-reading-answer-math'),'math class absent');ok(getComputedStyle(mark.querySelector('mjx-container')).visibility==='hidden','formula not hidden');}
   else ok(getComputedStyle(mark).webkitTextFillColor==='rgba(0, 0, 0, 0)','text not hidden');
   mark.focus();
   ok(getComputedStyle(mark).borderBottomColor==='rgb(20, 20, 20)','line disappears after reveal');
   ok(getComputedStyle(mark).color==='rgb(189, 37, 37)','revealed text not red');
   if(math)ok(getComputedStyle(mark.querySelector('mjx-container')).visibility==='visible','math not revealed');
   ok(Math.abs(mark.getBoundingClientRect().width-original.width)<0.1,'slot width changes on focus');
   mark.blur();if(math)ok(getComputedStyle(mark.querySelector('mjx-container')).visibility==='hidden','blur did not hide math');
  });
 }
 for(const math of [false,true])check('choice '+(math?'math':'text')+' root paragraph stays line-free',()=>{
  const p=document.createElement('p');mount.append(p);p.innerHTML='选择 !{'+(math?formula:'A')+'}。';
  ok(a.mwbDecorateReadingTypedSlots(p,math?'选择 !{$x=1$}。':'选择 !{A}。')===1,'root paragraph missed');
  const mark=p.querySelector('mark');ok(getComputedStyle(mark).borderBottomStyle==='none','choice has underline');
  mark.focus();ok(getComputedStyle(mark).borderBottomStyle==='none','focused choice has underline');
 });
 check('nested blocks decorate once and do not consume adjacent paragraphs',()=>{
  mount.innerHTML='<ul><li><p>?{42}</p><p>?{2}</p></li></ul>';
  ok(a.mwbDecorateReadingTypedSlots(mount,'- ?{42}\n\n  ?{2}')===2,'wrong decoration count');
  ok(a.mwbDecorateReadingTypedSlots(mount,'- ?{42}\n\n  ?{2}')===0,'not idempotent');
  ok(mount.querySelectorAll('p').length===2,'paragraph structure changed');
 });
 check('code and native highlights are untouched even when real answers exist',()=>{
  mount.innerHTML='<p><code>?{42}</code> <mark>重点</mark> ?{7}</p>';
  ok(a.mwbDecorateReadingTypedSlots(mount,'`?{42}` ==重点== ?{7}')===1,'code decorated');
  ok(mount.querySelector('code').textContent==='?{42}','code changed');
  ok(!mount.querySelector('mark').className,'native highlight got answer class');
 });
 check('print DOM is not decorated as interactive reading answers',()=>{
  mount.className='mwb-print-document';mount.innerHTML='<p>?{42}</p>';
  ok(a.mwbDecorateReadingTypedSlots(mount,'?{42}')===0,'print projection was changed');
  mount.className='';
 });
 const el=document.createElement('pre');el.id='mwb-test-results';el.textContent=JSON.stringify(results);document.body.append(el);
}
