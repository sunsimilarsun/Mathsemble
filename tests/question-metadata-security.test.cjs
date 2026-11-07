'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.MATHSEMBLE_TEST_SOURCE || path.join(root, 'src/plugin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const stub = `const module={exports:{}};const stub={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},renderMath:tex=>MathJax.tex2chtml(tex)};function require(n){return n==='obsidian'?stub:{}};`;
const expose = '\nglobalThis.qa={handoutPlan,mwbHandoutQuestionPlan,mwbApplyHandoutQuestions,exportHtml,paginatePreviewDocument,PreviewModal};';

async function browserCases(realMath, fonts) {
  const results = [];
  const ok = (v, reason) => {if (!v) throw Error(reason);};
  const check = async (name, f) => {try {await f(); results.push({name, ok:true});} catch(e) {results.push({name, ok:false, error:String(e.stack || e)});}};
  // A deliberately small H5/plain-paragraph adapter. Projection, grouping,
  // range tooltips, pagination and HTML serialization are production code.
  // With the optional host bundle, every formula is real MathJax CHTML.
  async function render(markdown) {
    const root = document.createElement('main');
    root.className = 'mwb-export-doc mwb-typography mwb-print-document';
    document.body.appendChild(root);
    for (const line of markdown.split('\n').filter(Boolean)) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      const node = document.createElement(heading ? 'h'+heading[1].length : 'p');
      const html = heading ? heading[2] : line;
      const parts = html.split(/(\$[^$\n]+\$)/g);
      for (const part of parts) {
        if (part.startsWith('$') && part.endsWith('$')) {
          if (realMath) node.appendChild(await MathJax.tex2chtmlPromise(part.slice(1,-1)));
          else {const math=document.createElement('span');math.className='test-tex';math.textContent=part.slice(1,-1);node.appendChild(math);}
        } else node.insertAdjacentHTML('beforeend', part);
      }
      root.appendChild(node);
    }
    if (realMath) {
      for (const style of document.querySelectorAll('style[id^="MJX-"]'))
        style.textContent = style.textContent.replace(/url\(["']?[^)"']*\/([^/()"']+\.woff2?)["']?\)/g,
          (all, name) => fonts[name] ? 'url("'+fonts[name]+'")' : all);
      await document.fonts.ready;
      ok(!root.querySelector('mjx-merror,[data-mjx-error]'), 'MathJax error in fixture');
    }
    return root;
  }
  if (realMath) await MathJax.startup.promise;
  const fixtures = [
    {name:'whole fraction', title:'例1 ?{$\\frac{731921}{862843}$}', secrets:['731921','862843']},
    {name:'denominator slot', title:'例2 $\\frac{7}{?{956237}}$', secrets:['956237'], retained:'7'},
    {name:'plain heading', title:'例3 普通标题', secrets:[]},
    {name:'text and choice slots', title:'例4 ?{H5_PRIVATE_52917}（!{ACD_SECRET_8317}）', secrets:['H5_PRIVATE_52917','ACD_SECRET_8317']},
  ];
  for (const fixture of fixtures) for (const mode of ['student','teacher']) {
    await check(fixture.name+' '+mode+(realMath?' real MathJax':''), async () => {
      const original='##### '+fixture.title+'\n题干保持\n\n##### 例5 后续题\n后续正文';
      const plan=qa.mwbHandoutQuestionPlan(original);
      const projected=qa.handoutPlan(plan.markdown,mode).markdown;
      const root=await render(projected);
      qa.mwbApplyHandoutQuestions(root,plan,'private-folder/fixture.md');
      const groups=[...root.querySelectorAll('.mwb-handout-question')];
      const diagnostic=document.createElement('div');diagnostic.setText=function(s){this.textContent=s;};
      qa.PreviewModal.prototype.updateQuestionBoundaryReport.call({questionPlan:plan,rendered:root,questionBoundaryPanel:diagnostic,mode});
      ok(groups.length===2,'question count changed');
      ok(groups.every((q,i)=>q.dataset.mwbQuestionId===plan.groups[i].id),'source IDs changed');
      ok(groups[0].textContent.includes('题干保持')&&!groups[0].textContent.includes('后续正文'),'question boundary changed');
      ok(groups[0].dataset.mwbSourceStart==='1','source range changed');
      if (fixture.name==='plain heading') ok(groups[0].dataset.mwbQuestionLabel===fixture.title,'plain label changed');
      if (fixture.retained) ok(groups[0].textContent.includes(fixture.retained),'public numerator lost');
      const preview=root.cloneNode(true);document.body.appendChild(preview);
      const report=qa.paginatePreviewDocument(preview,false,true,false);
      qa.PreviewModal.prototype.updateQuestionBounds.call({previewPages:preview,showQuestionBounds:true});
      ok(report.strictQuestionPages.length===2,'pagination lost question associations');
      const before=root.innerHTML;
      const html=await qa.exportHtml(root,'metadata regression','',document);
      ok(root.innerHTML===before,'export mutated the preview');
      const final=new DOMParser().parseFromString(html,'text/html');
      ok(final.querySelectorAll('[data-mwb-question-id]').length===2,'export lost source IDs');
      for (const secret of fixture.secrets) {
        if (mode==='student') {
          ok(!root.outerHTML.includes(secret),'student DOM metadata leaked '+secret);
          ok(!diagnostic.outerHTML.includes(secret),'student boundary diagnostic leaked '+secret);
          ok(!preview.outerHTML.includes(secret),'student paginated tooltip leaked '+secret);
          ok(!html.includes(secret),'student export HTML leaked '+secret);
          ok(!JSON.stringify(report).includes(secret),'student pagination report leaked '+secret);
        } else {
          ok(root.textContent.includes(secret),'teacher visible answer missing '+secret);
          ok(final.body.textContent.includes(secret),'teacher export answer missing '+secret);
        }
      }
      root.remove();preview.remove();
      ok(plan.groups[0].title===fixture.title,'original source plan was changed');
    });
  }
  await check('export strips stale diagnostics but preserves structural identity',async()=>{
    const root=document.createElement('main');root.dataset.mwbQuestionPolicy='strict-h5';
    root.innerHTML='<section class="mwb-handout-question" data-mwb-question-id="q-1" data-mwb-question-label="STALE_ANSWER_67321" data-mwb-source-path="private/STALE_PATH_8821.md" data-mwb-source-start="7" data-mwb-source-end="9" title="STALE_TOOLTIP_9137"><h5>例1</h5><p>学生题干</p></section>';
    const before=root.outerHTML,html=await qa.exportHtml(root,'security','',document);
    ok(!/STALE_ANSWER_67321|STALE_PATH_8821|STALE_TOOLTIP_9137/.test(html),'stale private diagnostic metadata survived export');
    ok(html.includes('data-mwb-question-id="q-1"')&&html.includes('data-mwb-source-start="7"'),'structural metadata removed');
    ok(root.outerHTML===before,'sanitization changed original DOM');
  });
  await check('student boundary warnings do not quote source answers',()=>{
    const plan=qa.mwbHandoutQuestionPlan('#####例1 ?{WARNING_SECRET_9971}\n正文');
    ok(plan.warnings.some(w=>w.message.includes('WARNING_SECRET_9971')),'fixture needs a raw-source warning');
    const panel={setText(s){this.text=s;}};
    qa.PreviewModal.prototype.updateQuestionBoundaryReport.call({questionPlan:plan,rendered:document.createElement('main'),questionBoundaryPanel:panel,mode:'student'});
    ok(!panel.text.includes('WARNING_SECRET_9971')&&panel.text.includes('heading-space'),'student warning leaked source or lost reason');
    qa.PreviewModal.prototype.updateQuestionBoundaryReport.call({questionPlan:plan,rendered:document.createElement('main'),questionBoundaryPanel:panel,mode:'teacher'});
    ok(panel.text.includes('WARNING_SECRET_9971'),'teacher source diagnostic lost detail');
  });
  const result=document.createElement('pre');result.id='mwb-test-results';result.textContent=JSON.stringify(results);document.body.appendChild(result);
}

for (const realMath of [false,true]) test('H5 metadata security in Chromium'+(realMath?' with real MathJax':''),async t=>{
  if (!chrome) {if(process.env.CI)throw Error('Chrome required');t.skip('Set CHROME_PATH');return;}
  const mathPath=process.env.MATHSEMBLE_MATHJAX_BUNDLE;
  if (realMath&&!mathPath) {t.skip('Set MATHSEMBLE_MATHJAX_BUNDLE and MATHSEMBLE_MATHJAX_FONTS for host-math coverage');return;}
  const fonts=realMath?JSON.parse(fs.readFileSync(process.env.MATHSEMBLE_MATHJAX_FONTS,'utf8')):{};
  const bundle=realMath?fs.readFileSync(mathPath,'utf8'):'';
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mwb-metadata-'));
  const input=path.join(directory,'case.html');
  const config=process.env.MATHSEMBLE_MATHJAX_CONFIG ? JSON.parse(fs.readFileSync(process.env.MATHSEMBLE_MATHJAX_CONFIG,'utf8')) : {startup:{typeset:false},options:{enableMenu:false}};
  const scripts=[realMath?'globalThis.MathJax='+JSON.stringify(config)+';':'',bundle,stub+'\n'+source+expose+'\n('+browserCases.toString()+')('+realMath+','+JSON.stringify(fonts)+');'];
  fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><body>'+scripts.map(s=>'<script>'+s.replace(/<\/script/gi,'<\\/script')+'</script>').join(''));
  // Preserve test input/profile on failure as local evidence, not user data.
  const results=await runChromeDocument(chrome,input,path.join(directory,'profile'));
  for (const r of results) await t.test(r.name,()=>assert.equal(r.ok,true,r.error));
});
