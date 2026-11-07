'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../src/plugin.js'),'utf8');
const obsidian={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:()=>Promise.resolve()};
const ctx={module:{exports:{}},require:n=>n==='obsidian'?obsidian:require(n),console,Buffer,setTimeout,clearTimeout,performance};
vm.runInNewContext(source+'\nglobalThis.pdf=pdfBufferFromHtml;',ctx);
const html='<!doctype html><html><main class="mwb-export-doc"></main></html>';
const pdf=ctx.pdf;
function host(options={}) {
 const state={path:'',destroyed:false,printed:0,prefs:null,scripts:[],responses:[]};
 class Window {
  constructor(opts){state.prefs=opts.webPreferences;this.webContents={
   executeJavaScript:async script=>{
    state.scripts.push(script);
    if(options.transport)throw new Error('Script failed to execute. SECRET_TEACHER');
    if(options.pending)return new Promise(()=>{});
    if(options.response)return options.response(script);
    const isPagination=script.includes('function paginatePrintDocument(');
    const doc={fonts:{ready:Promise.resolve(),status:'loaded'},images:[],querySelectorAll:()=>[],querySelector:()=>null};
    if(!isPagination&&options.readyFailure)doc.fonts.ready=Promise.reject(options.readyFailure);
    if(!isPagination&&options.readyTimeout)doc.fonts.ready=new Promise(()=>{});
    if(!isPagination&&options.badImage)doc.images=[{complete:false,naturalWidth:0}];
    if(isPagination&&options.paginateFailure)doc.querySelector=()=>{throw options.paginateFailure;};
    const scope={document:doc,setTimeout:options.readyTimeout?(fn=>setTimeout(fn,0)):setTimeout,clearTimeout};
    let response;
    try { response=await vm.runInNewContext(script,scope); }
    catch(error){throw new Error('Script failed to execute, this normally means an error was thrown.');}
    state.responses.push(response);return response;
   },
   printToPDF:async()=>{state.printed++;return Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj');}
  };}
  async loadFile(name){state.path=name;assert.ok(fs.existsSync(name));}
  isDestroyed(){return state.destroyed;}
  destroy(){state.destroyed=true;}
 }
 return {Window,state};
}
const cleaned=state=>{assert.equal(state.printed,0);assert.equal(state.destroyed,true);assert.equal(fs.existsSync(state.path),false);};
test('real serialized pagination exceptions survive an Electron-style rejection boundary',async()=>{
 const {Window,state}=host();
 await assert.rejects(pdf(html,Window),error=>{
  assert.equal(error.message,'A4 分页失败：找不到 PDF 正文容器');
  assert.equal(error.stage,'A4 分页');assert.equal(error.code,'MWB_PRINT_SCRIPT_FAILED');
  assert.match(error.rendererStack,/at renderer:\d+:\d+/);return true;
 });
 assert.deepEqual(JSON.parse(JSON.stringify(state.prefs)),{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:true});
 assert.equal(state.responses[0].ok,true);assert.equal(state.responses[1].ok,false);cleaned(state);
});
test('readiness rejection has stage, safe code and stack, with no content on either side',async()=>{
 const failure=new TypeError('SECRET_TEACHER answer=3/4 selector="PRIVATE_PATH"');
 failure.stack='TypeError: SECRET_TEACHER\n    at SECRET_FUNCTION (/private/SECRET_PATH:19:23)';
 const {Window,state}=host({readyFailure:failure});
 await assert.rejects(pdf(html,Window),error=>{
  assert.match(error.message,/^打印字体与图片就绪失败：打印脚本运行异常（TypeError）$/);
  assert.equal(error.stage,'打印字体与图片就绪');assert.equal(error.code,'MWB_PRINT_SCRIPT_FAILED');
  assert.doesNotMatch(error.stack,/SECRET|PRIVATE|3\/4/);assert.match(error.rendererStack,/renderer:19:23/);return true;
 });
 assert.doesNotMatch(JSON.stringify(state.responses),/SECRET|PRIVATE|3\/4/);cleaned(state);
});
test('readiness deadline retains useful specific error rather than Electron generic error',async()=>{
 const {Window,state}=host({readyTimeout:true});
 await assert.rejects(pdf(html,Window),error=>{
  assert.equal(error.message,'打印字体与图片就绪失败：打印字体与图片加载超时');
  assert.equal(error.code,'MWB_PRINT_READY_TIMEOUT');return true;
 });cleaned(state);
});
test('legacy content-bearing overflow exception is redacted without permitting printing',async()=>{
 const failure=new Error('存在超过 A4 可打印区域的不可拆分内容：SECRET_TEACHER 34–––；请拆成多个独立步骤');
 const {Window,state}=host({paginateFailure:failure});
 await assert.rejects(pdf(html,Window,{allowPartialMath:true,allowOverflowOmission:true}),error=>{
  assert.equal(error.code,'MWB_PRINT_OVERFLOW');assert.match(error.message,/A4 分页失败：存在超过 A4/);
  assert.doesNotMatch(error.stack,/SECRET|34–––/);return true;
 });
 assert.match(state.scripts[1],/document\.querySelector\('\.mwb-export-doc'\), true, false, true/);
 assert.doesNotMatch(JSON.stringify(state.responses),/SECRET|34–––/);cleaned(state);
});
test('source-path and section-label exceptions retain category without copying source data',async()=>{
 for(const message of ['试题为空：PRIVATE_PATH','存在没有题目的试卷分区：SECRET_TEACHER']) {
  const {Window,state}=host({paginateFailure:new Error(message)});
  await assert.rejects(pdf(html,Window),error=>{assert.doesNotMatch(error.stack,/PRIVATE|SECRET/);return true;});
  assert.doesNotMatch(JSON.stringify(state.responses),/PRIVATE|SECRET/);cleaned(state);
 }
});
test('native bridge failures also report their stage without forwarding an unsafe message',async()=>{
 const {Window,state}=host({transport:true});
 await assert.rejects(pdf(html,Window),error=>{
  assert.equal(error.message,'打印字体与图片就绪失败：无法执行打印脚本');
  assert.equal(error.code,'MWB_PRINT_SCRIPT_EXECUTION');assert.doesNotMatch(error.stack,/SECRET/);return true;
 });cleaned(state);
});
test('outer timeout still cancels the export and is not rewritten as a renderer error',async()=>{
 const {Window,state}=host({pending:true});
 await assert.rejects(pdf(html,Window,{pdfTimeoutMs:15}),error=>{
  assert.equal(error.code,'MWB_EXPORT_TIMEOUT');assert.match(error.message,/打印字体与图片就绪/);return true;
 });cleaned(state);
});
test('aborting an active renderer stage still cancels and cleans its window and HTML',async()=>{
 const {Window,state}=host({pending:true}),controller=new AbortController();
 const pending=pdf(html,Window,{signal:controller.signal});
 const timer=setTimeout(()=>controller.abort(),15);
 try{await assert.rejects(pending,error=>error.name==='AbortError');}finally{clearTimeout(timer);}
 cleaned(state);
});
test('invalid transport envelope fails closed',async()=>{
 for(const value of [{pages:1},{ok:false},{ok:false,error:{message:'x'}}]) {
  const {Window,state}=host({response:async()=>value});
  await assert.rejects(pdf(html,Window),error=>error.code==='MWB_PRINT_SCRIPT_PROTOCOL');cleaned(state);
 }
});
test('successful envelope retains resource and pagination blockers and existing PDF report',async()=>{
 const {Window,state}=host({response:async script=>({ok:true,result:script.includes('function paginatePrintDocument(')?{pages:1,blocks:1,answerSpaceChunks:0}:{badImage:false,badMath:false}})});
 const result=await pdf(html,Window);
 assert.equal(result.mwbPrintReport.pages,1);assert.equal(state.printed,1);assert.equal(state.destroyed,true);assert.equal(fs.existsSync(state.path),false);
 const blocked=host({badImage:true});
 await assert.rejects(pdf(html,blocked.Window),/图片未完整加载/);cleaned(blocked.state);
});
test('overflow geometry survives while arbitrary appended DOM detail remains private',async()=>{
 const failure=new Error('存在超过 A4 可打印区域的不可拆分内容（mjx-container）；请拆成多个独立步骤；bounds ns=SECRET_SOURCE tag=mjx-container defs=false direction=left; rect=[-19.1,20.2,30.3,40.4]; page=[1.0,2.0,3.0,4.0]; SECRET_TEACHER');
 const {Window,state}=host({paginateFailure:failure});
 await assert.rejects(pdf(html,Window),error=>{
  assert.equal(error.code,'MWB_PRINT_OVERFLOW');assert.match(error.message,/mjx-container/);
  assert.match(error.message,/元素范围=\[-19.1,20.2,30.3,40.4\]/);assert.match(error.message,/越界方向=left/);
  assert.doesNotMatch(error.stack,/SECRET/);return true;
 });assert.doesNotMatch(JSON.stringify(state.responses),/SECRET/);cleaned(state);
});
