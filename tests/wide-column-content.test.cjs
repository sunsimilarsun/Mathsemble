'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');
const {createMathJaxFixture, assertLocalMathJaxResources} = require('./helpers/mathjax-fixture.cjs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const helper = source.slice(source.indexOf('async function mwbRenderColumnMath('), source.indexOf('async function mwbRenderMarkdown('));
const abort = source.slice(source.indexOf('function mwbRenderAbortError('), source.indexOf('// Export cancellation is independent'));
const expand = source.slice(source.indexOf('function expandPrintCallouts('), source.indexOf('function mathDiagnosticContext('));
const renderScopes = source.slice(source.indexOf('const mwbRenderSignals ='), source.indexOf('// A measurement batch belongs'));
const renderOwners = source.slice(source.indexOf('function mwbCreateRenderOwner('), source.indexOf('// Obsidian starts ordered postprocessors'));
const markdown = source.slice(source.indexOf('async function mwbRenderMarkdown('), source.indexOf('function mwbSpaceTargets('));
const paginationStart = source.indexOf('function paginatePrintDocument(');
const paginator = source.slice(paginationStart, source.indexOf('// Serialize a pure browser function.', paginationStart));
assert.ok(helper && paginator, 'production column renderer and paginator are available');
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(candidate => candidate && fs.existsSync(candidate));

test('real MathJax 4: long column and trial formulas wrap before measurement and retain pagination', async t => {
  if (!chrome) { if (process.env.CI) throw Error('Chrome/Chromium required'); t.skip('Set CHROME_PATH'); return; }
  const fixture = await createMathJaxFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mwb-column-real-math-'));
  try {
    // The host Markdown parser is stubbed only in deadline tests; those inputs
    // contain no page-break markers and use the real staging/ownership code.
    const script = `${abort}\n${renderScopes}\n${renderOwners}\n${expand}\n${helper}\n${markdown}\n${paginator}\nlet MarkdownRenderer={render:async()=>{throw Error('Unexpected host Markdown render');}};\nconst mwbProjectPageBreaks=source=>source;\nlet loadMathJax=()=>MathJax.startup.promise;\nlet activeMathStyle;\nlet finishRenderMath=async()=>{const style=MathJax.chtmlStylesheet();if(style!==activeMathStyle){activeMathStyle?.remove();activeMathStyle=style;document.head.append(style);}document.body.getBoundingClientRect();await document.fonts.ready;};\n${assertLocalMathJaxResources.toString()}\n(${browserCases.toString()})();`;
    new (require('node:vm').Script)(script);
    const input = path.join(directory, 'case.html');
    const fixtureHtml = '<!doctype html><meta charset="utf-8"><style>'+css+'</style>'+fixture.bootstrap+
      '<body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>';
    fixture.setHtml(fixtureHtml);
    fs.writeFileSync(input, fixtureHtml);
    let results;
    try { results = await runChromeDocument(chrome, input, path.join(directory, 'profile'), {url:fixture.url}); }
    catch (error) { throw new Error(error.message + '\nAsset requests: '+fixture.requests.join(', ')); }
    fixture.assertAssets();
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally {
    await fixture.close();
    fs.rmSync(directory, {recursive:true, force:true, maxRetries:10, retryDelay:100});
  }
});

async function browserCases() {
  const results = [];
  let phase = 'MathJax startup';
  const watchdog = setTimeout(() => {
    results.push({name:phase,ok:false,error:'Real MathJax fixture did not settle within 20 seconds'}); publish();
  },20000);
  const ok = (condition, message) => { if (!condition) throw Error(message); };
  const check = async (name, fn) => {
    phase = name;
    try { await fn(); results.push({name,ok:true}); }
    catch (error) { results.push({name,ok:false,error:String(error.stack || error)}); }
  };
  const publish = () => {
    clearTimeout(watchdog);
    const output=document.createElement('pre'); output.id='mwb-test-results';
    output.textContent=JSON.stringify(results); document.body.append(output);
  };
  try {
    await MathJax.startup.promise;
    ok(Number.parseInt(MathJax.version,10)>=4, 'test bundle must provide MathJax 4 line breaking');
    const jax = MathJax.startup.document.outputJax;
    const initialFilters = jax.preFilters.items.length, initialOptions = JSON.stringify(jax.options);
    const sameGlobals = () => {
      ok(jax.preFilters.items.length===initialFilters, 'temporary output filter leaked');
      ok(JSON.stringify(jax.options)===initialOptions, 'global MathJax output options changed');
    };
    const tex = String.raw`a^2+b^2+c^2+d^2+e^2+f^2+g^2+h^2+i^2+j^2+k^2+l^2+m^2+n^2=10`;
    const ellipse = String.raw`(x+3)^2+y^2=\left(5+\frac{3x}{5}\right)^2,\quad (x-3)^2+y^2=\left(5-\frac{3x}{5}\right)^2.`;
    const inlineCases = [
      String.raw`\iff \begin{cases} g(x)\text{ 在 }(-\infty,x_0)\text{ 上单调递增} \\ h(x)\text{ 在 }[x_0,+\infty)\text{ 上单调递增} \\ g(x_0)\le h(x_0)\ (\text{左段分界点高度}\le\text{右段分界点高度}) \end{cases}`,
      String.raw`\iff \begin{cases} g(x)\text{ 在 }(-\infty,x_0)\text{ 上单调递减} \\ h(x)\text{ 在 }[x_0,+\infty)\text{ 上单调递减} \\ g(x_0)\ge h(x_0)\ (\text{左段分界点高度}\ge\text{右段分界点高度}) \end{cases}`,
    ];
    const create = (layout='two-column') => {
      const host=document.createElement('section'); host.className='mwb-modal';
      const page=document.createElement('div'); page.className='mwb-page'; page.dataset.mwbLayout=layout;
      const body=document.createElement('div'); body.className='mwb-typography mwb-print-document'; body.dataset.mwbLayout=layout;
      page.append(body); host.append(page); document.body.append(host); return {host,page,body};
    };
    const addMath = (parent, value=tex, display=true) => {
      const node=document.createElement(display?'div':'span'); node.className='math'+(display?' math-block':'');
      node.textContent=value; parent.append(node); return node;
    };
    const addCallout = (parent, title) => {
      const callout=document.createElement('div'); callout.className='callout'; callout.dataset.callout='solution';
      const heading=document.createElement('div'); heading.className='callout-title'; heading.textContent=title;
      const content=document.createElement('div'); content.className='callout-content';
      callout.append(heading,content); parent.append(callout); return content;
    };
    const addFoldedList = (parent, value=tex, levels=2) => {
      const content=addCallout(parent,'折叠解答'), callout=content.parentElement;
      callout.classList.add('is-collapsible','is-collapsed'); callout.setAttribute('aria-expanded','false');
      content.style.display='none'; content.setAttribute('aria-hidden','true');
      let item=content;
      for(let depth=0;depth<levels;depth++) {
        const list=document.createElement('ul'); list.style.paddingLeft='40px';
        const next=document.createElement('li'); list.append(next); item.append(list); item=next;
      }
      // Native Obsidian display formulas can be SPANs inside LI elements.
      const raw=addMath(item,value,false); raw.classList.add('math-block');
      return {content,callout,item,raw};
    };
    const contentWidth = node => {
      const style=getComputedStyle(node);
      return node.getBoundingClientRect().width-['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth']
        .reduce((sum,key)=>sum+(parseFloat(style[key])||0),0);
    };
    const elapsedMathClock = () => {
      const descriptor=Object.getOwnPropertyDescriptor(performance,'now'), now=performance.now.bind(performance);
      let elapsed=0;
      Object.defineProperty(performance,'now',{configurable:true,value:()=>now()+elapsed});
      return {advance:ms=>{elapsed+=ms;},restore:()=>{
        if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;
      }};
    };
    // Obsidian replaces its previous adaptive CHTML stylesheet, rather than
    // retaining conflicting rules from earlier formulas in the document.
    const ready = finishRenderMath;
    const nativeMath = async (value, metrics) => {
      for (;;) { try { return MathJax.tex2chtml(value,metrics); }
        catch(error) { if(error?.retry)await error.retry;else throw error; } }
    };
    const glyphs = node => [...node.querySelectorAll('mjx-c')].map(glyph=>glyph.className).join('|');
    const paginate = (fixture, preview=true) => {
      const root=fixture.body.cloneNode(true); root.classList.add('mwb-export-doc');
      if(preview) root.classList.add('mwb-preview-pages'); fixture.host.append(root);
      const styles=new Set(document.head.querySelectorAll('style'));
      try { return {root,report:paginatePrintDocument(root,false,preview)}; }
      finally { for(const style of document.head.querySelectorAll('style')) if(!styles.has(style))style.remove(); }
    };

    await check('long polynomial and source ellipse formulas preserve glyphs and font size while wrapping when needed', async () => {
      for(const value of [tex,ellipse]) {
        const normal=create('default'), column=create();
        try {
          const raw=addMath(column.body,value);
          const baseline=await nativeMath(value,{...MathJax.getMetricsFor(normal.body,true),display:true});
          normal.body.append(baseline);
          await mwbRenderColumnMath(column.body); await ready();
          const math=raw.querySelector('mjx-math'), container=raw.querySelector('mjx-container');
          const width=column.body.getBoundingClientRect().width;
          ok(!raw.querySelector('mjx-merror,[data-mjx-error]')&&!baseline.querySelector('mjx-merror,[data-mjx-error]'), 'real formula produced a MathJax error');
          if(value===tex) {
            ok(baseline.querySelector('mjx-math').getBoundingClientRect().width>width+20,'formula no longer reproduces column overflow');
            ok(raw.querySelectorAll('mjx-linebox').length>=2,'wide formula did not create multiple math lines');
          }
          ok(math.getBoundingClientRect().width<=width+2.5,'line-broken formula still exceeds the column');
          ok(getComputedStyle(container).fontSize===getComputedStyle(baseline).fontSize,'math font was scaled down');
          ok(getComputedStyle(container).transform==='none','formula was visually scaled with a transform');
          ok(glyphs(container)===glyphs(baseline),'glyph sequence was dropped, duplicated or reordered');
          const result=paginate(column); ok(result.report.pages===1,'wrapped formula should fit on one physical page');
          sameGlobals();
        } finally { normal.host.remove(); column.host.remove(); }
      }
    });

    await check('raw math is claimed synchronously before native postprocessors or reentrant calls can render it', async () => {
      const fixture=create(); let release;
      const gate=new Promise(resolve=>{release=resolve;}); loadMathJax=()=>gate;
      try {
        const raw=addMath(fixture.body);
        const pending=mwbRenderColumnMath(fixture.body);
        ok(raw.classList.contains('is-loaded'),'claim happened only after awaiting the loader');
        ok(await mwbRenderColumnMath(fixture.body)===0,'a later postprocessor claimed the same raw node');
        release(); ok(await pending===1,'claimed formula did not finish'); await ready();
        ok(raw.querySelectorAll('mjx-container').length===1,'formula rendered twice'); sameGlobals();
      } finally { release(); loadMathJax=()=>MathJax.startup.promise; fixture.host.remove(); }
    });

    await check('ordinary notes and default pages remain eligible for native rendering', async () => {
      for(const layout of ['default']) {
        const fixture=create(layout);
        try { const raw=addMath(fixture.body); ok(await mwbRenderColumnMath(fixture.body)===0,'other layout was intercepted');
          ok(!raw.classList.contains('is-loaded')&&raw.textContent===tex,'other layout raw math changed'); }
        finally {fixture.host.remove();}
      }
      const ordinary=document.createElement('div'); document.body.append(ordinary); const raw=addMath(ordinary);
      try {ok(await mwbRenderColumnMath(ordinary)===0&&!raw.classList.contains('is-loaded'),'ordinary reading view was intercepted');}
      finally {ordinary.remove();} sameGlobals();
    });

    await check('folded export callouts expose the real indented list width before formula measurement', async () => {
      const cases=String.raw`\begin{cases} 2t-1\le 3-t \\ 3-t\le -2 \end{cases} \quad\text{或}\quad \begin{cases} 2t-1\le 3-t \\ 2t-1\ge 6 \end{cases}`;
      for(const layout of ['two-column','trial']) for(const levels of [1,2]) {
        const fixture=create(layout), normal=create('default'), original=MathJax.tex2chtml;
        try {
          const value=layout==='two-column'?cases:tex+'+'+tex;
          const baseline=await nativeMath(value,{...MathJax.getMetricsFor(normal.body,true),display:true});
          normal.body.append(baseline); await ready();
          const {content,callout,item,raw}=addFoldedList(fixture.body,value,levels), measurements=[];
          ok(item.getBoundingClientRect().width===0,'folded list must begin with no measurable width');
          MathJax.tex2chtml=function(input,metrics) {
            measurements.push({width:metrics.containerWidth,item:contentWidth(item)});
            return original.call(this,input,metrics);
          };
          // Postprocessing may receive only the math subtree, not its folded ancestor.
          ok(await mwbRenderColumnMath(raw)===1,'folded list formula was not rendered');
          await ready();
          const width=contentWidth(item), container=raw.querySelector('mjx-container');
          ok(width>0&&width<contentWidth(fixture.body)-levels*39,'list indentation was not deducted');
          ok(measurements.length>0&&measurements.every(entry=>entry.item>0&&Math.abs(entry.width-width)<0.5),
            layout+' formula measured a hidden list or an outer container: '+JSON.stringify(measurements)+'; LI width '+width);
          ok(!callout.classList.contains('is-collapsed')&&callout.getAttribute('aria-expanded')==='true','temporary export callout remained folded');
          ok(getComputedStyle(content).display!=='none'&&content.getAttribute('aria-hidden')!=='true','temporary callout content remained hidden');
          ok(!raw.querySelector('mjx-merror,[data-mjx-error]'),'folded-list formula produced a MathJax error');
          ok(glyphs(container)===glyphs(baseline)&&container.textContent===baseline.textContent,'folded-list formula content changed');
          ok(getComputedStyle(container).fontSize===getComputedStyle(baseline).fontSize&&getComputedStyle(container).transform==='none','folded-list formula was scaled');
          if(baseline.querySelector('mjx-math').getBoundingClientRect().width>width+2.5)
            ok(raw.querySelectorAll('mjx-linebox').length>=2,'overflowing source formula did not wrap at the list width');
          ok(raw.querySelector('mjx-math').getBoundingClientRect().width<=width+2.5,'rendered formula still exceeds the unfolded LI');
          ok(paginate(fixture).report.pages===1,'unfolded list formula did not paginate'); sameGlobals();
        } finally {MathJax.tex2chtml=original;fixture.host.remove();normal.host.remove();}
      }
    });

    await check('ordinary and default folded callouts retain their original visibility and raw math', async () => {
      for(const layout of [null,'default']) {
        const fixture=create(layout||'two-column');
        if(layout===null) fixture.page.removeAttribute('data-mwb-layout');
        try {
          const {callout,raw}=addFoldedList(fixture.body), before=callout.outerHTML;
          ok(await mwbRenderColumnMath(raw)===0,'non-export folded formula was intercepted');
          ok(callout.outerHTML===before,'ordinary/default callout visibility or raw formula changed'); sameGlobals();
        } finally {fixture.host.remove();}
      }
    });

    await check('cancelling folded-callout rendering prevents late formula or visibility writes', async () => {
      for(const layout of ['two-column','trial']) {
        const fixture=create(layout), controller=new AbortController(); let release;
        const gate=new Promise(resolve=>{release=resolve;}); loadMathJax=()=>gate;
        try {
          const {callout,raw}=addFoldedList(fixture.body), pending=mwbRenderColumnMath(raw,{signal:controller.signal});
          ok(raw.classList.contains('is-loaded'),'folded raw math was not claimed synchronously');
          controller.abort(); let error;
          try {await pending;} catch(caught) {error=caught;}
          ok(error?.code==='MWB_RENDER_ABORTED','folded-callout render ignored cancellation');
          ok(!raw.classList.contains('is-loaded')&&raw.textContent===tex&&!raw.querySelector('mjx-container'),'cancelled folded raw formula was changed');
          const stopped=callout.outerHTML;
          release(); await new Promise(resolve=>setTimeout(resolve,0));
          ok(callout.outerHTML===stopped,'resolved loader wrote to a cancelled callout'); sameGlobals();
        } finally {release();loadMathJax=()=>MathJax.startup.promise;fixture.host.remove();}
      }
    });

    await check('only overflowing inline tables use display line breaking while preserving source semantics and inline fraction sizes', async () => {
      const fractionCase=String.raw`\frac{x^2+1}{x-1}+\begin{cases} a+b+c+d+e+f+g+h+i+j+k+l+m+n & x>0 \\ -x & x\le0 \end{cases}`;
      for(const value of [...inlineCases,fractionCase]) {
        const fixture=create(), normal=create('default'), original=MathJax.tex2chtml, calls=[], completed=[];
        try {
          const baseline=await nativeMath(value,{...MathJax.getMetricsFor(normal.body,false),display:false});
          normal.body.append(baseline); await ready();
          const {item,raw}=addFoldedList(fixture.body,value,1);
          // This case exercises the overflowing path. Native CJK font widths
          // vary by OS, so reserve less than the measured unwrapped formula.
          const naturalWidth=baseline.querySelector('mjx-math').getBoundingClientRect().width;
          item.style.maxWidth=Math.min(180,naturalWidth*0.7)+'px';
          raw.classList.remove('math-block'); raw.classList.add('math-inline'); item.prepend('条件说明：');
          MathJax.tex2chtml=function(input,metrics){
            calls.push({...metrics});
            const result=original.call(this,input,metrics);completed.push({...metrics});return result;
          };
          ok(await mwbRenderColumnMath(raw)===1,'inline table was not rendered exactly once'); await ready();
          const container=raw.querySelector('mjx-container'), math=raw.querySelector('mjx-math'), bounds=item.getBoundingClientRect();
          ok(naturalWidth>contentWidth(item)+2.5,'long inline fixture must naturally exceed its list width');
          ok(completed.length>=2&&completed.length<=4&&calls.every(metrics=>metrics.display===false),
            'inline fallback was unbounded or reparsed inline math in display style');
          ok(completed.every((metrics,index)=>['em','ex','scale'].every(key=>metrics[key]===completed[0][key])&&
            (index<2?Math.abs(metrics.containerWidth-contentWidth(item))<0.5:
              metrics.containerWidth<completed[index-1].containerWidth)),
            'inline correction changed font metrics or did not narrow only its correction attempts');
          ok(container?.getAttribute('display')==='true','overflowing inline table did not receive display line breaking');
          ok(raw.querySelectorAll('mjx-linebox').length>=2,'table cell contents were not line broken');
          ok(!raw.querySelector('mjx-merror,[data-mjx-error]'),'inline table fallback produced a MathJax error');
          ok(math.getAttribute('data-latex')===value,'inline table source TeX changed');
          // A taller cases brace legitimately switches to stretchy pieces;
          // compare its presence separately from ordinary mathematical symbols.
          const symbols=node=>[...node.querySelectorAll('mjx-c')].filter(child=>!/mjx-c7[BD](?:\s|$)/.test(child.className))
            .map(child=>child.textContent).join('');
          ok(symbols(container)===symbols(baseline),'inline table mathematical symbols were dropped or reordered');
          const braces=node=>node.querySelectorAll('mjx-mo > mjx-stretchy-v.mjx-c7B, mjx-mo > mjx-c.mjx-c7B').length;
          ok(braces(container)>0&&braces(container)===braces(baseline),'cases brace was lost or duplicated');
          ok(container.querySelectorAll('mjx-mtable').length===baseline.querySelectorAll('mjx-mtable').length&&
            container.querySelectorAll('mjx-mtr').length===baseline.querySelectorAll('mjx-mtr').length,'inline table branches changed');
          const words=node=>[...node.querySelectorAll('mjx-utext')].map(child=>child.textContent).join('|');
          ok(words(container)===words(baseline),'inline table Chinese annotations changed');
          ok(getComputedStyle(container).fontSize===getComputedStyle(baseline).fontSize&&getComputedStyle(container).transform==='none','inline table fallback changed the math font size');
          for(const descendant of raw.querySelectorAll('mjx-mtable,mjx-mtd,mjx-mrow,mjx-mi,mjx-mo,mjx-mtext')) {
            const box=descendant.getBoundingClientRect();
            ok(!box.width||(box.right<=bounds.right+2.5&&box.left>=bounds.left-2.5),'table descendant still overflows the list: '+descendant.tagName+'; formula '+[...inlineCases,fractionCase].indexOf(value)+'; right '+(box.right-bounds.left)+'; width '+bounds.width+'; metrics '+JSON.stringify(calls));
          }
          if(value===fractionCase) {
            const before=baseline.querySelector('mjx-mfrac').getBoundingClientRect(), after=raw.querySelector('mjx-mfrac').getBoundingClientRect();
            ok(before.width>10&&Math.abs(before.width-after.width)<0.5&&Math.abs(before.height-after.height)<0.5,'fallback enlarged the original inline fraction');
          }
          ok(paginate(fixture,true).report.pages===1&&paginate(fixture,false).report.pages===1,'adapted inline table cannot paginate in preview and print');
          sameGlobals();
        } finally {MathJax.tex2chtml=original;fixture.host.remove();normal.host.remove();}
      }
    });

    await check('short inline tables and ordinary fractions stay inline, and default pages remain untouched', async () => {
      const short=String.raw`\begin{cases}x&x>0\\-x&x\le0\end{cases}`, fraction=String.raw`\frac{x^2+1}{x-1}`;
      for(const layout of ['two-column','trial']) {
        const fixture=create(layout);
        try {
          const paragraph=document.createElement('p'); paragraph.textContent='短式：'; fixture.body.append(paragraph);
          const table=addMath(paragraph,short,false), ordinary=addMath(paragraph,fraction,false);
          ok(await mwbRenderColumnMath(paragraph)===2,'short inline formulas were not rendered'); await ready();
          for(const raw of [table,ordinary])ok(raw.querySelector('mjx-container')?.getAttribute('display')!=='true','fitting inline formula was promoted to display');
          ok(!paragraph.querySelector('mjx-merror,[data-mjx-error]'),'short inline formula has an error'); sameGlobals();
        } finally {fixture.host.remove();}
      }
      const fixture=create('default');
      try {
        const raw=addMath(fixture.body,inlineCases[0],false), before=fixture.body.outerHTML;
        ok(await mwbRenderColumnMath(raw)===0&&fixture.body.outerHTML===before,'default inline cases were changed');
      } finally {fixture.host.remove();}
    });

    await check('cancelling while inline table CSS settles prevents a late display rerender and filter leak', async () => {
      const fixture=create(), controller=new AbortController(), finish=finishRenderMath; let release, entered=false;
      const gate=new Promise(resolve=>{release=resolve;}); finishRenderMath=()=>{entered=true;return gate;};
      try {
        const {raw}=addFoldedList(fixture.body,inlineCases[0],1); raw.classList.remove('math-block');
        const pending=mwbRenderColumnMath(raw,{signal:controller.signal});
        for(let turn=0;turn<100&&!entered;turn++) await new Promise(resolve=>setTimeout(resolve,0));
        ok(entered,'inline table renderer did not wait for host MathJax CSS'); sameGlobals();
        controller.abort(); let error;
        try {await pending;} catch(caught) {error=caught;}
        ok(error?.code==='MWB_RENDER_ABORTED','CSS-stage cancellation was ignored');
        const stopped=fixture.body.outerHTML;
        release(); await new Promise(resolve=>setTimeout(resolve,0));
        ok(fixture.body.outerHTML===stopped,'CSS completion triggered a cancelled table rerender'); sameGlobals();
      } finally {release();finishRenderMath=finish;fixture.host.remove();}
    });

    await check('more than fifteen seconds of synchronous formula work does not expire a healthy stylesheet wait', async () => {
      const fixture=create(), original=MathJax.tex2chtml, finish=finishRenderMath, clock=elapsedMathClock();
      let styles=0, computed=0;
      try {
        addMath(fixture.body,String.raw`\begin{cases}x&x>0\\-x&x\le0\end{cases}`,false);
        addMath(fixture.body,'x+1',false);
        MathJax.tex2chtml=function(...args){const result=original.apply(this,args);computed++;clock.advance(8000);return result;};
        finishRenderMath=()=>{styles++;return finish();};
        ok(await mwbRenderColumnMath(fixture.body)===2,'completed formulas were rejected after slow synchronous work');
        ok(computed===2&&styles===1,'fixture did not cross the cumulative computation budget before normal CSS completion');
        ok(fixture.body.querySelectorAll('mjx-container').length===2&&!fixture.body.querySelector('mjx-merror,[data-mjx-error]'),'slow computation changed rendered formula content');
        sameGlobals();
      } finally {clock.restore();MathJax.tex2chtml=original;finishRenderMath=finish;fixture.host.remove();}
    });

    await check('font retries remain available after earlier synchronous formulas consume fifteen seconds', async () => {
      const fixture=create(), original=MathJax.tex2chtml, clock=elapsedMathClock(); let attempts=0;
      try {
        addMath(fixture.body,'x+1'); addMath(fixture.body,'x+2');
        MathJax.tex2chtml=function(value,metrics) {
          if(value==='x+2'&&++attempts===1)throw {retry:Promise.resolve()};
          const result=original.call(this,value,metrics);
          if(value==='x+1')clock.advance(16000);
          return result;
        };
        ok(await mwbRenderColumnMath(fixture.body)===2&&attempts===2,'healthy font retry inherited an exhausted computation deadline');
        await ready(); ok(fixture.body.querySelectorAll('mjx-container').length===2,'font retry lost a formula'); sameGlobals();
      } finally {clock.restore();MathJax.tex2chtml=original;fixture.host.remove();}
    });

    await check('a display fallback font retry retains a fresh bounded wait after lengthy first-pass work', async () => {
      const fixture=create(), normal=create('default'), original=MathJax.tex2chtml, clock=elapsedMathClock(), calls=[], completed=[]; let attempts=0;
      try {
        const baseline=await nativeMath(inlineCases[0],{...MathJax.getMetricsFor(normal.body,false),display:false});
        normal.body.append(baseline);await ready();
        const {item,raw}=addFoldedList(fixture.body,inlineCases[0],1);raw.classList.remove('math-block');
        item.style.maxWidth=Math.min(180,baseline.querySelector('mjx-math').getBoundingClientRect().width*0.7)+'px';
        MathJax.tex2chtml=function(value,metrics){
          calls.push({...metrics});
          if(++attempts===2){clock.advance(16000);throw {retry:Promise.resolve()};}
          const result=original.call(this,value,metrics);completed.push({...metrics});return result;
        };
        ok(await mwbRenderColumnMath(raw)===1&&attempts>=3&&completed.length>=2&&completed.length<=4,
          'second-pass font retry expired, lost the formula or retried correction without a bound');
        ok(calls.every(metrics=>metrics.display===false&&['em','ex','scale'].every(key=>metrics[key]===calls[0][key]))&&
          calls[1].containerWidth===calls[2].containerWidth,
          'font retry changed the inline parse style or its requested metrics');
        ok(completed.every((metrics,index)=>index<2||metrics.containerWidth<completed[index-1].containerWidth),
          'additional successful renders were not narrower correction attempts');
        await ready();ok(raw.querySelector('mjx-container')?.getAttribute('display')==='true','font retry lost the adapted table');sameGlobals();
      } finally {clock.restore();MathJax.tex2chtml=original;fixture.host.remove();normal.host.remove();}
    });

    await check('a long Markdown render shares its bounded work deadline with nested formula processing', async () => {
      const fixture=create(), original=MathJax.tex2chtml, renderer=MarkdownRenderer.render, clock=elapsedMathClock();let elapsed=false;
      try {
        MarkdownRenderer.render=async(app,text,staging)=>{
          addMath(staging,'x+1');addMath(staging,String.raw`\begin{cases}x&x>0\\-x&x\le0\end{cases}`,false);
          return mwbRenderColumnMath(staging,{signal:mwbRenderSignalFor(staging),deadline:mwbRenderDeadlineFor(staging)});
        };
        MathJax.tex2chtml=function(...args){const result=original.apply(this,args);if(!elapsed){elapsed=true;clock.advance(45000);}return result;};
        const count=await mwbRenderMarkdown({},'讲义'.repeat(38000),fixture.body,'deadline.md',{});
        ok(count===2&&elapsed&&fixture.body.querySelectorAll('mjx-container').length===2,'outer Markdown deadline did not cover the long nested math workload');
        ok(fixture.body.children.length===2,'temporary staging was left in the successful output');sameGlobals();
      } finally {clock.restore();MathJax.tex2chtml=original;MarkdownRenderer.render=renderer;fixture.host.remove();}
    });

    await check('an explicit parent budget still stops synchronous math before publishing a partial result', async () => {
      const fixture=create(), original=MathJax.tex2chtml, renderer=MarkdownRenderer.render, clock=elapsedMathClock();let stage;
      try {
        fixture.body.textContent='existing preview';
        MarkdownRenderer.render=async(app,text,staging)=>{
          stage=staging;addMath(staging,'x+1');
          return mwbRenderColumnMath(staging,{deadline:mwbRenderDeadlineFor(staging)});
        };
        MathJax.tex2chtml=function(...args){const result=original.apply(this,args);clock.advance(1500);return result;};
        let failure;try{await mwbRenderMarkdown({},'讲义'.repeat(38000),fixture.body,'limited.md',{},1000);}catch(error){failure=error;}
        ok(/超时.*总预算/.test(failure?.message||''),'explicit parent deadline was enlarged or ignored');
        ok(stage&&!stage.isConnected&&fixture.body.textContent==='existing preview'&&!fixture.body.querySelector('mjx-container'),'over-budget partial math was published');sameGlobals();
      } finally {clock.restore();MathJax.tex2chtml=original;MarkdownRenderer.render=renderer;fixture.host.remove();}
    });

    await check('an expired Markdown parent detaches staging so a late renderer cannot overwrite the preview', async () => {
      const fixture=create(), renderer=MarkdownRenderer.render;let stage,release;
      const gate=new Promise(resolve=>{release=resolve;});
      try {
        fixture.body.textContent='existing preview';
        MarkdownRenderer.render=async(app,text,staging)=>{stage=staging;await gate;staging.textContent='late result';};
        let failure;try{await mwbRenderMarkdown({},'source',fixture.body,'late.md',{},20);}catch(error){failure=error;}
        ok(/超时.*Markdown/.test(failure?.message||'')&&stage&&!stage.isConnected,'stalled parent was not bounded or detached');
        release();await new Promise(resolve=>setTimeout(resolve,0));
        ok(fixture.body.textContent==='existing preview','late Markdown completion overwrote the visible preview');
        ok(mwbRenderDeadlineFor(stage)===undefined&&mwbRenderSignalFor(stage)===undefined,'expired staging retained render context');sameGlobals();
      } finally {release();MarkdownRenderer.render=renderer;fixture.host.remove();}
    });

    await check('a queued cancellation interrupts a long formula batch before all output is written', async () => {
      const fixture=create(), original=MathJax.tex2chtml, controller=new AbortController();let scheduled=false;
      try {
        for(let index=0;index<96;index++)addMath(fixture.body,'x+1');
        MathJax.tex2chtml=function(...args){
          const result=original.apply(this,args);
          if(!scheduled){scheduled=true;setTimeout(()=>controller.abort(),0);}
          return result;
        };
        let failure;try{await mwbRenderColumnMath(fixture.body,{signal:controller.signal});}catch(error){failure=error;}
        const count=fixture.body.querySelectorAll('mjx-container').length;
        ok(failure?.code==='MWB_RENDER_ABORTED'&&count>0&&count<96,'queued user cancellation waited until the entire batch finished');
        const stopped=fixture.body.outerHTML;await new Promise(resolve=>setTimeout(resolve,0));
        ok(fixture.body.outerHTML===stopped,'cancelled batch continued to publish formulas');
        ok([...fixture.body.querySelectorAll('.math')].every(node=>node.querySelector('mjx-container')||!node.classList.contains('is-loaded')),'cancelled batch left raw formulas claimed');sameGlobals();
      } finally {MathJax.tex2chtml=original;fixture.host.remove();}
    });

    await check('a genuinely stalled stylesheet still has a bounded timeout and cannot write after it expires', async () => {
      const fixture=create(), finish=finishRenderMath, nativeSet=setTimeout, nativeClear=clearTimeout;
      const timers=new Map(); let nextId=1000000, release, entered=false;
      const gate=new Promise(resolve=>{release=resolve;});
      globalThis.setTimeout=(callback,delay,...args)=>{
        if(delay>=1000){const id=++nextId;timers.set(id,{callback,delay,args});return id;}
        return nativeSet(callback,delay,...args);
      };
      globalThis.clearTimeout=id=>{if(!timers.delete(id))nativeClear(id);};
      finishRenderMath=()=>{entered=true;return gate;};
      try {
        const {raw}=addFoldedList(fixture.body,inlineCases[0],1); raw.classList.remove('math-block');
        const pending=mwbRenderColumnMath(raw);
        for(let turn=0;turn<100&&!entered;turn++)await new Promise(resolve=>nativeSet(resolve,0));
        ok(entered,'stalled CSS operation was not entered');
        const guard=[...timers.values()];
        ok(guard.length===1&&guard[0].delay>0&&guard[0].delay<=30000,'stalled CSS has no finite, promptly bounded timeout');
        sameGlobals(); guard[0].callback(...guard[0].args);
        let error;try{await pending;}catch(caught){error=caught;}
        ok(/超时.*打印公式样式/.test(error?.message||''),'genuinely stalled CSS was accepted');
        ok(timers.size===0,'stylesheet timeout left its timer registered');
        const stopped=fixture.body.outerHTML; release(); await new Promise(resolve=>nativeSet(resolve,0));
        ok(fixture.body.outerHTML===stopped,'late CSS settlement rewrote the timed-out formula'); sameGlobals();
      } finally {release();globalThis.setTimeout=nativeSet;globalThis.clearTimeout=nativeClear;finishRenderMath=finish;fixture.host.remove();}
    });

    await check('trial math wraps at the framed body and nested callout widths without scaling or losing glyphs', async () => {
      const fixture=create('trial'), normal=create('default'), wide=tex+'+'+tex;
      try {
        const direct=addMath(fixture.body,wide);
        const outer=addCallout(fixture.body,'解答'), inner=addCallout(outer,'补充说明');
        const calloutMath=addMath(outer,wide), nestedMath=addMath(inner,wide);
        const baseline=await nativeMath(wide,{...MathJax.getMetricsFor(normal.body,true),display:true});
        normal.body.append(baseline); await ready();
        const width=contentWidth(fixture.body), nestedWidth=contentWidth(inner);
        ok(width<contentWidth(normal.body)-25,'trial source must reserve its frame padding and borders');
        ok(nestedWidth<width-35,'nested callout did not reduce usable formula width');
        ok(baseline.querySelector('mjx-math').getBoundingClientRect().width>width+50,'formula must naturally overflow trial body');
        ok(await mwbRenderColumnMath(fixture.body)===3,'trial formulas were left to the native unwrapped renderer');
        await ready();
        for(const [raw,parent] of [[direct,fixture.body],[calloutMath,outer],[nestedMath,inner]]) {
          const container=raw.querySelector('mjx-container'), math=raw.querySelector('mjx-math');
          const box=math.getBoundingClientRect(), parentBox=parent.getBoundingClientRect(), style=getComputedStyle(parent);
          const left=parentBox.left+(parseFloat(style.paddingLeft)||0)+(parseFloat(style.borderLeftWidth)||0);
          const right=parentBox.right-(parseFloat(style.paddingRight)||0)-(parseFloat(style.borderRightWidth)||0);
          ok(!raw.querySelector('mjx-merror,[data-mjx-error]'),'trial formula produced a MathJax error');
          ok(raw.querySelectorAll('mjx-linebox').length>=2,'wide trial formula did not wrap');
          ok(box.width<=contentWidth(parent)+2.5,'formula exceeds its actual callout/body content width: '+box.width+' > '+contentWidth(parent));
          ok(box.left>=left-2.5&&box.right<=right+2.5,
            'formula exceeds its actual callout/body edges: '+JSON.stringify({math:[box.left,box.right],content:[left,right]}));
          ok(getComputedStyle(container).fontSize===getComputedStyle(baseline).fontSize&&getComputedStyle(container).transform==='none','trial math was scaled down');
          ok(glyphs(container)===glyphs(baseline),'trial line breaking changed the formula glyphs');
        }
        const preview=paginate(fixture), printed=paginate(fixture,false);
        ok(preview.report.pages===1&&printed.report.pages===1,'wrapped trial examples should fit one page');
        const region=preview.root.querySelector('.mwb-paper-body'), frame=region.closest('.mwb-trial-frame');
        ok(Math.abs(contentWidth(region)-width)<1,'measurement width differs from the paginated trial body');
        ok(Math.abs(contentWidth(frame)-contentWidth(region))<1,'body width does not account for trial frame padding');
        sameGlobals();
      } finally {fixture.host.remove();normal.host.remove();}
    });

    await check('long trial callouts continue vertically with nested context and matching preview/print content', async () => {
      const fixture=create('trial'), wide=tex+'+'+tex;
      try {
        const header=document.createElement('div'); header.className='mwb-trial-header';
        header.style.cssText='box-sizing:border-box;height:50mm;margin:0'; header.textContent='教师：孙老师　课题：长公式试听';
        fixture.body.append(header);
        const content=addCallout(fixture.body,'完整解答');
        for(let i=1;i<=24;i++) {
          const step=document.createElement('p'); step.dataset.trialStep=String(i);
          step.style.cssText='min-height:32px'; step.textContent='步骤 '+i+'：保留推导及公式。'; content.append(step);
          addMath(content,i%2?wide:ellipse);
          if(i===10) {
            const nested=addCallout(content,'方法说明'), note=document.createElement('p');
            note.dataset.trialStep='nested'; note.textContent='嵌套上下文应保留在第十步之后。'; nested.append(note); addMath(nested,wide);
          }
        }
        ok(await mwbRenderColumnMath(fixture.body)===25,'long trial fixture did not render every formula');
        await ready();
        ok(!fixture.body.querySelector('mjx-merror,[data-mjx-error]'),'long trial fixture contains math errors');
        const expectedSteps=[...fixture.body.querySelectorAll('[data-trial-step]')].map(node=>node.dataset.trialStep);
        const expectedMath=[...fixture.body.querySelectorAll('mjx-container')].map(node=>node.outerHTML);
        const preview=paginate(fixture,true), printed=paginate(fixture,false);
        for(const result of [preview,printed]) {
          ok(result.report.pages>=3&&result.report.splitCallouts>0,'long trial callout did not continue over several pages');
          ok(result.root.querySelectorAll('.mwb-trial-header').length===1,'trial course header was lost or duplicated');
          ok(JSON.stringify([...result.root.querySelectorAll('[data-trial-step]')].map(node=>node.dataset.trialStep))===JSON.stringify(expectedSteps),'trial callout steps were lost or reordered');
          ok(JSON.stringify([...result.root.querySelectorAll('mjx-container')].map(node=>node.outerHTML))===JSON.stringify(expectedMath),'trial pagination altered formula markup or ordering');
          ok([...result.root.querySelectorAll('.mwb-paper-body')].every(node=>node.querySelector('[data-trial-step],mjx-container')),'trial pagination emitted an empty body');
          ok([...result.root.querySelectorAll('.callout-title')].some(node=>node.textContent==='完整解答（续）'),'continued callout lost its context title');
        }
        const assignments=result=>[...result.root.querySelectorAll('.mwb-paper')].map(page=>[...page.querySelectorAll('[data-trial-step]')].map(node=>node.dataset.trialStep));
        ok(JSON.stringify(assignments(preview))===JSON.stringify(assignments(printed)),'preview and print place trial callout steps on different pages');
        sameGlobals();
      } finally {fixture.host.remove();}
    });

    await check('display padding triggers correction when width alone fits but the painted edge does not', async () => {
      const fixture=create('trial'), normal=create('default'), original=MathJax.tex2chtml, targets=[];
      const wide=tex+'+'+tex;let raw, firstGeometry;
      try {
        const baseline=await nativeMath(wide,{...MathJax.getMetricsFor(normal.body,true),display:true});
        normal.body.append(baseline);await ready();
        raw=addMath(fixture.body,wide);
        MathJax.tex2chtml=function(value,metrics) {
          if(targets.length===1) {
            const box=raw.querySelector('mjx-math').getBoundingClientRect(), parentBox=fixture.body.getBoundingClientRect();
            firstGeometry={width:box.width,available:contentWidth(fixture.body),right:box.right,parentRight:parentBox.right};
          }
          const result=original.call(this,value,metrics);targets.push(metrics.containerWidth);
          if(targets.length===1) {
            // Actual MathJax display padding remains in effect. Its inset can
            // put the right edge outside although a width-only audit accepts it.
            result.querySelector('mjx-math').style.width=(metrics.containerWidth+1)+'px';
            result.querySelector('mjx-math').style.minWidth=(metrics.containerWidth+1)+'px';
          }
          return result;
        };
        ok(await mwbRenderColumnMath(fixture.body)===1,'edge correction lost the formula');await ready();
        ok(firstGeometry&&firstGeometry.width<=firstGeometry.available+2.5&&firstGeometry.right>firstGeometry.parentRight+2.5,
          'fixture did not isolate a width-fitting, edge-overflowing display: '+JSON.stringify(firstGeometry));
        ok(targets.length>=2&&targets.length<=3&&targets.every((width,index)=>index===0||width<targets[index-1]),
          'edge overflow was not corrected with bounded narrower targets');
        const container=raw.querySelector('mjx-container'), box=raw.querySelector('mjx-math').getBoundingClientRect();
        const bounds=fixture.body.getBoundingClientRect();
        ok(box.left>=bounds.left-2.5&&box.right<=bounds.right+2.5,'corrected display still exceeds its content edges');
        ok(glyphs(container)===glyphs(baseline),'edge correction changed the formula glyphs');
        ok(getComputedStyle(container).fontSize===getComputedStyle(baseline).fontSize&&getComputedStyle(container).transform==='none',
          'edge correction scaled the formula');
        ok(paginate(fixture).report.pages===1&&paginate(fixture,false).report.pages===1,'edge correction did not survive preview and print');sameGlobals();
      } finally {MathJax.tex2chtml=original;fixture.host.remove();normal.host.remove();}
    });

    await check('cancellation and the parent deadline stop a pending overflow correction without late writes', async () => {
      for (const stop of ['cancel','deadline']) {
        const fixture=create('trial'), controller=new AbortController(), clock=elapsedMathClock();
        const original=MathJax.tex2chtml, wide=tex+'+'+tex;
        let firstWidth, correcting=false, release;
        const gate=new Promise(resolve=>{release=resolve;});
        MathJax.tex2chtml=function(value,metrics) {
          if (firstWidth===undefined) firstWidth=metrics.containerWidth;
          if (metrics.containerWidth<firstWidth) {correcting=true;throw {retry:gate};}
          const result=original.call(this,value,metrics);
          // Force an actual oversized first result on every platform. Whether
          // this polynomial naturally needs correction depends on CJK fonts.
          result.querySelector('mjx-math').style.minWidth=(firstWidth+20)+'px';
          return result;
        };
        try {
          const raw=addMath(addCallout(fixture.body,'等待纠正'),wide);
          const pending=mwbRenderColumnMath(fixture.body,{signal:controller.signal,deadline:performance.now()+60000});
          // Attach the rejection handler before stopping the active operation.
          const outcome=pending.then(value=>({value}),error=>({error}));
          for(let turn=0;turn<100&&!correcting;turn++)await new Promise(resolve=>setTimeout(resolve,0));
          ok(correcting&&raw.querySelector('mjx-linebox')&&
            raw.querySelector('mjx-math').getBoundingClientRect().width>firstWidth+2.5,
            'fixture did not enter correction of an actually oversized rendered formula');
          const before=raw.outerHTML; sameGlobals();
          if(stop==='cancel')controller.abort();
          else {clock.advance(60001);release();}
          const {error}=await outcome;
          ok(stop==='cancel'?error?.code==='MWB_RENDER_ABORTED':/超时.*打印公式处理总预算/.test(error?.message||''),
            stop+' did not stop the pending correction');
          ok(raw.outerHTML===before,'stopped correction replaced the existing formula');
          release();await new Promise(resolve=>setTimeout(resolve,0));
          ok(raw.outerHTML===before,'late correction settlement overwrote the stopped render');sameGlobals();
        } finally {release();MathJax.tex2chtml=original;clock.restore();fixture.host.remove();}
      }
    });

    await check('an asynchronous MathJax font retry removes the temporary filter before another render can run', async () => {
      const fixture=create(), original=MathJax.tex2chtml; let release, attempts=0;
      const retry=new Promise(resolve=>{release=resolve;});
      MathJax.tex2chtml=function(...args) {
        if(++attempts===1) throw {retry};
        return original.apply(this,args);
      };
      try {
        addMath(fixture.body);
        const pending=mwbRenderColumnMath(fixture.body);
        for(let turn=0;turn<20&&attempts===0;turn++) await Promise.resolve();
        ok(attempts===1,'font retry fixture was not reached'); sameGlobals();
        release(); ok(await pending===1&&attempts>=2,'font retry did not finish the claimed formula');
        await ready(); sameGlobals();
      } finally {release(); MathJax.tex2chtml=original; fixture.host.remove();}
    });

    await check('cancelling during a pending font loader restores raw nodes and leaves no global filter', async () => {
      const fixture=create(), controller=new AbortController(); let release;
      const gate=new Promise(resolve=>{release=resolve;}); loadMathJax=()=>gate;
      try {
        const raw=addMath(fixture.body), pending=mwbRenderColumnMath(fixture.body,{signal:controller.signal});
        controller.abort(); let error;
        try {await pending;}catch(caught){error=caught;}
        ok(error?.code==='MWB_RENDER_ABORTED','cancel did not stop rendering');
        ok(!raw.classList.contains('is-loaded')&&raw.textContent===tex&&!raw.querySelector('mjx-container'),'cancelled math was mutated or left claimed');
        release(); await Promise.resolve(); sameGlobals();
      } finally {release(); loadMathJax=()=>MathJax.startup.promise; fixture.host.remove();}
    });

    await check('forty strict blocks, writing space and forced page breaks survive preview and print with the same assignments', async () => {
      const fixture=create(); fixture.body.dataset.mwbQuestionPolicy='strict-h5';
      try {
        for(let i=1;i<=40;i++) {
          const q=document.createElement('section'); q.className='mwb-handout-question'; q.dataset.mwbQuestionId='q'+i;
          const content=document.createElement('div'); content.className='mwb-exam-question-content';
          const title=document.createElement('h5'); title.textContent='例 '+i; content.append(title);
          addMath(content,i%2?ellipse:tex);
          const space=document.createElement('div'); space.className='mwb-answer-space'; space.dataset.mwbSpacePx='60';
          space.innerHTML='<div class="mwb-answer-space-chunk" style="height:60px"></div>';
          content.append(space); q.append(content); fixture.body.append(q);
          if(i===20){const br=document.createElement('div');br.className='mwb-page-break';br.dataset.mwbPageBreak='true';fixture.body.append(br);}
        }
        await mwbRenderColumnMath(fixture.body); await ready();
        ok(!fixture.body.querySelector('mjx-merror,[data-mjx-error]'),'forty-block fixture contains a MathJax error');
        const preview=paginate(fixture,true), printed=paginate(fixture,false);
        const ids = result => [...result.root.querySelectorAll('[data-mwb-question-id]')].map(node=>node.dataset.mwbQuestionId);
        ok(ids(preview).join(',')===Array.from({length:40},(_,i)=>'q'+(i+1)).join(','),'question order/count changed');
        ok(ids(printed).join(',')===ids(preview).join(','),'print lost or reordered a question');
        ok(JSON.stringify(preview.report.strictQuestionPages)===JSON.stringify(printed.report.strictQuestionPages),'preview and print disagree on page/column assignment');
        ok(preview.report.answerSpaceChunks===40&&Math.abs(preview.report.answerSpaceDeltaPx)<0.01,'student response height changed');
        ok(preview.root.querySelectorAll('mjx-container').length===40,'math formulas lost or duplicated');
        const before=preview.report.strictQuestionPages[19], after=preview.report.strictQuestionPages[20];
        ok(after.startPage>before.endPage&&after.regions[0].column===1,'manual break did not start a physical page left column');
        sameGlobals();
      } finally {fixture.host.remove();}
    });

    await check('persistent wrapped overflow has bounded correction attempts and remains a blocking error', async () => {
      const fixture=create(), original=MathJax.tex2chtml, targets=[];
      MathJax.tex2chtml=function(value,metrics) {
        const result=original.call(this,value,metrics);
        targets.push(metrics.containerWidth);
        // Model a renderer that cannot realize the requested width, keeping
        // real MathJax glyphs and line boxes for the correction and final audit.
        result.querySelector('mjx-math').style.minWidth=(contentWidth(fixture.body)+20)+'px';
        return result;
      };
      try {
        addMath(fixture.body,tex+'+'+tex);
        await mwbRenderColumnMath(fixture.body); await ready(); let failure;
        ok(targets.length>1&&targets.length<=3,'persistent overflow was ignored or retried without a bound');
        ok(targets.every((width,index)=>index===0||width<targets[index-1]),'correction did not reduce its requested width');
        const oversized=fixture.body.querySelector('mjx-math');
        ok(oversized.getBoundingClientRect().width>contentWidth(fixture.body)+2.5,
          'oversized renderer fixture must really exceed the column');
        try {paginate(fixture);} catch(error) {failure=error;}
        ok(failure&&/超过 A4|不可拆分|仍然溢出/.test(failure.message),'indivisible math was silently accepted'); sameGlobals();
      } finally {MathJax.tex2chtml=original;fixture.host.remove();}
    });
  } catch(error) {results.push({name:'MathJax initialization',ok:false,error:String(error.stack||error)});}
  await check('renderer and font assets stay local', assertLocalMathJaxResources);
  publish();
}
