'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const base=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(base,'src/plugin.js'),'utf8'),css=fs.readFileSync(path.join(base,'styles.css'),'utf8');
const context={module:{exports:{}},require:n=>n==='obsidian'?{Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{}}:require(n),Buffer,console};
vm.runInNewContext(source+'\nglobalThis.paginate=paginatePreviewDocument;',context);
function cases(){
 let out=[];function check(name,fn){try{fn();out.push({name,ok:true});}catch(e){out.push({name,ok:false,error:String(e.stack||e)});}}
 function root(html){const r=document.createElement('main');r.className='mwb-export-doc mwb-typography mwb-print-document';r.innerHTML=html;document.body.appendChild(r);return r;}
 function ok(v,m){if(!v)throw Error(m)}
 const def='<svg width="20" height="20"><defs><path id="glyph" d="M 0 0 L 10000 10000"/></defs><use href="#glyph" transform="scale(.001)"/></svg>';
 check('trial preserves nonpainting definition and use',()=>{let r=root('<p>'+def+'</p>');let p=paginate(r,false,false,false);ok(p.pages===1,'pagination failed');ok(r.querySelector('use'),'use lost');r.remove()});
 check('omission ignores harmless defs',()=>{let r=root('<p>'+def+'</p>');let p=paginate(r,false,false,true);ok(p.omittedBlocks.length===0,'harmless definition omitted');r.remove()});
 check('omission marks real oversized SVG',()=>{let r=root('<p><svg width="1500" height="30"><rect width="1500" height="30"/></svg></p>');let p=paginate(r,false,false,true);ok(p.omittedBlocks.length===1,'real oversized image not omitted');r.remove()});
 check('painted SVG overflows without omission and diagnostic hides text',()=>{let r=root('<p><svg width="1500" height="30"><text x="0" y="20">PRIVATE_98231</text><rect width="1500" height="30"/></svg></p>');let e;try{paginate(r,false,false,false)}catch(x){e=x}ok(e,'overflow accepted');ok(!String(e).includes('PRIVATE_98231'),'answer leaked in error');r.remove()});
 check('final audit catches text ink outside body',()=>{let r=root('<p style="text-indent:-2000px">SECRET_AUDIT_98231</p>');let e;try{paginate(r,false,false,false)}catch(x){e=x}ok(e,'outside text accepted');ok(!String(e).includes('SECRET_AUDIT_98231'),'text leaked');r.remove()});
 document.body.innerHTML='<pre id="mwb-test-results"></pre>';document.getElementById('mwb-test-results').textContent=JSON.stringify(out);
}
const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe')].find(x=>x&&fs.existsSync(x));
test('candidate paginator real browser trial omission final audit',async t=>{if(!chrome){if(process.env.CI)throw Error('CI requires Chrome/Chromium; set CHROME_PATH');t.skip('Set CHROME_PATH to Chrome/Chromium');return;}const d=fs.mkdtempSync(path.join(os.tmpdir(),'mwb-overflow-'));try{const input=path.join(d,'test.html');fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><script>const paginate='+context.paginate.toString()+';('+cases.toString()+')();</script>');const result=await runChromeDocument(chrome,input,path.join(d,'profile'));for(const r of result)assert.ok(r.ok,r.name+': '+r.error)}finally{fs.rmSync(d,{recursive:true,force:true})}});
