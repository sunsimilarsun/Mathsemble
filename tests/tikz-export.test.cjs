'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

// Exercise the production resource module without booting an Obsidian host.
const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const start = source.indexOf('const { exportHtml } = (() => { const module = {exports:{}};');
const end = source.indexOf('const { typographyCss } =', start);
assert.ok(start >= 0 && end > start, 'production export resource module exists');
const load = source.slice(start, end).replace('const { exportHtml } =', 'globalThis.resources =');
const context = {Buffer, URL};
vm.runInNewContext(load, context);

test('SVG font resources retain data URIs and inline relative font URLs once', async () => {
  const requests = [];
  const css = await context.resources.inlineFontCss([
    {css: '@font-face{font-family:cmmi10;src:url("fonts/cmmi10.woff2")}', base:'https://fonts.example/tikz/'},
    {css: '@font-face{font-family:cmmi10;src:url("fonts/cmmi10.woff2");font-style:italic}', base:'https://fonts.example/tikz/'},
    {css: '@font-face{font-family:cmr10;src:url(data:font/woff2;base64,AAAA)}', base:'https://fonts.example/tikz/'},
  ], async url => {requests.push(url); return 'data:font/woff2;base64,BBBB';});
  assert.deepEqual(requests, ['https://fonts.example/tikz/fonts/cmmi10.woff2']);
  assert.equal((css.match(/data:font\/woff2;base64,BBBB/g) || []).length, 2);
  assert.match(css, /data:font\/woff2;base64,AAAA/);
});

test('font extraction retains ordinary MathJax rules and quoted fallback font families', () => {
  const label = {};
  const bodyNode = {
    querySelectorAll: () => [label],
    ownerDocument: {defaultView: {getComputedStyle: () => ({fontFamily: "'missing family', 'cmmi10'"})}},
  };
  const doc = {baseURI:'file:///tikz/',styleSheets:[{cssRules:[
    // Modern Chromium exposes an empty CSSRuleList even on a normal style rule.
    {type:1,cssRules:[],cssText:'mjx-container { line-height: 0; }'},
    {type:5,cssText:'@font-face { font-family: cmmi10; src: url(data:font/ttf;base64,AAAA); }',
      style:{getPropertyValue: () => 'cmmi10'}},
    {type:5,cssText:'@font-face { font-family: unused; src: url(data:font/ttf;base64,MjX); }',
      style:{getPropertyValue: () => 'unused'}},
  ]}]};
  const css = context.resources.extractMathCss(doc, bodyNode).map(group => group.css).join('\n');
  assert.match(css, /mjx-container\s*\{\s*line-height: 0;/);
  assert.match(css, /@font-face\s*\{\s*font-family: cmmi10;/);
  assert.doesNotMatch(css, /font-family: unused/);
});

// A deliberately tiny, original TrueType font: U+E041 is one solid rectangle.
// Its private-use mapping catches fallback fonts which ordinary ASCII A hides.
// No system font, third-party asset, network request or font library is needed.
function rectangleFont() {
  const tables = new Map();
  const u16 = (b, o, n) => b.writeUInt16BE(n & 65535, o);
  const i16 = (b, o, n) => b.writeInt16BE(n, o);
  const u32 = (b, o, n) => b.writeUInt32BE(n >>> 0, o);
  const table = (name, size) => {const b=Buffer.alloc(size); tables.set(name,b); return b;};
  const head=table('head',54); u32(head,0,0x10000);u32(head,4,0x10000);u32(head,12,0x5f0f3cf5);
  u16(head,16,3);u16(head,18,1000);i16(head,40,600);i16(head,42,800);u16(head,46,8);i16(head,48,2);
  const hhea=table('hhea',36);u32(hhea,0,0x10000);i16(hhea,4,800);i16(hhea,6,-200);
  u16(hhea,10,600);i16(hhea,16,600);i16(hhea,18,1);u16(hhea,34,2);
  const maxp=table('maxp',32);u32(maxp,0,0x10000);u16(maxp,4,2);u16(maxp,6,4);u16(maxp,8,1);u16(maxp,14,2);
  const os2=table('OS/2',78);i16(os2,2,600);u16(os2,4,400);u16(os2,6,5);
  i16(os2,10,650);i16(os2,12,600);i16(os2,16,75);i16(os2,18,650);i16(os2,20,600);i16(os2,24,350);
  i16(os2,26,50);i16(os2,28,250);os2.write('TEST',58);u16(os2,62,64);u16(os2,64,0xe041);u16(os2,66,0xe041);
  i16(os2,68,800);i16(os2,70,-200);u16(os2,74,800);u16(os2,76,200);
  const hmtx=table('hmtx',8);u16(hmtx,0,600);u16(hmtx,4,600);
  const cmap=table('cmap',44);u16(cmap,2,1);u16(cmap,4,3);u16(cmap,6,1);u32(cmap,8,12);
  u16(cmap,12,4);u16(cmap,14,32);u16(cmap,18,4);u16(cmap,20,4);u16(cmap,22,1);
  u16(cmap,26,0xe041);u16(cmap,28,0xffff);u16(cmap,32,0xe041);u16(cmap,34,0xffff);
  u16(cmap,36,1-0xe041);u16(cmap,38,1);
  const glyf=table('glyf',48);i16(glyf,12,1);i16(glyf,18,600);i16(glyf,20,800);u16(glyf,22,3);
  glyf.fill(1,26,30);[0,600,0,-600,0,0,800,0].forEach((n,i)=>i16(glyf,30+i*2,n));
  const loca=table('loca',6);u16(loca,2,6);u16(loca,4,24);
  const names=[[1,'Mathsemble Test'],[2,'Regular'],[3,'Mathsemble-Test-1'],[4,'Mathsemble Test'],[6,'MathsembleTest']];
  const strings=names.map(([,s])=>{const b=Buffer.from(s,'utf16le');return b.swap16();});
  const name=table('name',6+names.length*12+strings.reduce((n,b)=>n+b.length,0));
  u16(name,2,names.length);u16(name,4,6+names.length*12);let textOffset=0;
  names.forEach(([id],i)=>{const o=6+i*12;u16(name,o,3);u16(name,o+2,1);u16(name,o+4,0x409);
    u16(name,o+6,id);u16(name,o+8,strings[i].length);u16(name,o+10,textOffset);
    strings[i].copy(name,6+names.length*12+textOffset);textOffset+=strings[i].length;});
  const post=table('post',32);u32(post,0,0x30000);
  const checksum = b => {let sum=0;for(let i=0;i<b.length;i+=4)sum=(sum+b.readUInt32BE(i))>>>0;return sum;};
  const sorted=[...tables].sort(([a],[b])=>a.localeCompare(b));let offset=12+sorted.length*16;
  const total=offset+sorted.reduce((n,[,b])=>n+Math.ceil(b.length/4)*4,0),font=Buffer.alloc(total);
  u32(font,0,0x10000);u16(font,4,sorted.length);u16(font,6,128);u16(font,8,3);u16(font,10,sorted.length*16-128);
  let headOffset=0;
  sorted.forEach(([tag,b],i)=>{const record=12+i*16,padded=Buffer.alloc(Math.ceil(b.length/4)*4);b.copy(padded);
    font.write(tag,record);u32(font,record+4,checksum(padded));u32(font,record+8,offset);u32(font,record+12,b.length);
    b.copy(font,offset);if(tag==='head')headOffset=offset;offset+=padded.length;});
  u32(font,headOffset+8,0xb1b0afba-checksum(font));
  return 'data:font/ttf;base64,'+font.toString('base64');
}

test('real Chromium: TikZ SVG labels keep embedded fonts and glyphs in isolated export', async t => {
  const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(p=>p&&fs.existsSync(p));
  if(!chrome){if(process.env.CI)throw Error('Chrome required in CI');t.skip('Set CHROME_PATH');return;}
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-tikz-fonts-'));
  const font=rectangleFont();
  const css=`@font-face{font-family:cmmi10;src:url('${font}')}\n`+
    `@media all{@font-face{font-family:cmr10;src:url('${font}')}}\n`+
    `@font-face{font-family:unused_tikz_font;src:url('${font}')}\n`+
    `@font-face{font-family:MathJax_Test;src:url('${font}')}\n`+
    'mjx-container{line-height:0;vertical-align:middle}\n'+
    '.host .label{font-family:cmmi10;font-size:22px;font-style:normal;font-weight:400}'+
    '.host .roman{font-family:cmr10;font-size:28px;font-style:normal;font-weight:400}';
  const markup='<main class="host" id="host"><svg xmlns="http://www.w3.org/2000/svg" width="320" height="130" viewBox="0 0 320 130">'+
    '<defs><path id="label-baseline" d="M210 45H310"/></defs>'+
    '<text id="italic-label" class="label" x="10" y="30">&#xE041;</text>'+
    '<text id="roman-label" class="roman" x="70" y="70">&#xE041;</text>'+
    '<text x="140" y="110" font-family="cmmi10" font-size="30"><tspan id="span-label">&#xE041;</tspan></text>'+
    '<text class="roman"><textPath id="path-label" href="#label-baseline">&#xE041;</textPath></text>'+
    '</svg></main>';
  const html='<!doctype html><meta charset="utf-8"><style>'+css+'</style>'+markup+'<script>'+
    (load+'\n('+browserCases.toString()+')();').replace(/<\/script/gi,'<\\/script')+'</script>';
  const input=path.join(temp,'tikz.html');fs.writeFileSync(input,html);
  try{for(const result of await runChromeDocument(chrome,input,path.join(temp,'profile')))
    await t.test(result.name,()=>assert.equal(result.ok,true,result.error||''));}
  finally{fs.rmSync(temp,{recursive:true,force:true});}
});

async function browserCases() {
  const results=[];
  const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}};
  const ok=(condition,message)=>{if(!condition)throw Error(message);};
  const host=document.getElementById('host');
  const labels=['italic-label','roman-label','span-label','path-label'];
  const metrics=doc=>labels.map(id=>{const text=doc.getElementById(id),box=text.getBBox(),style=doc.defaultView.getComputedStyle(text);
    const canvas=doc.createElement('canvas');canvas.width=80;canvas.height=80;const c=canvas.getContext('2d');
    c.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;c.fillText(text.textContent,5,60);
    const pixels=c.getImageData(0,0,80,80).data;let ink=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])ink++;
    return {width:box.width,height:box.height,ink,family:style.fontFamily,size:style.fontSize};});
  // Force font selection before fonts.ready; the PUA rectangle has fixed metrics.
  metrics(document);await document.fonts.ready;
  const before=host.outerHTML,expected=metrics(document);
  let html,frame;
  await check('export serializes used TikZ fonts, nested faces and existing MathJax rules',async()=>{
    html=await resources.exportHtml(host,'TikZ teacher export','',document);
    const parsed=new DOMParser().parseFromString(html,'text/html');
    const css=[...parsed.querySelectorAll('style')].map(s=>s.textContent).join('\n');
    ok(/@font-face\s*\{[^}]*font-family:\s*["']?cmmi10/i.test(css),'cmmi10 font omitted');
    ok(/@font-face\s*\{[^}]*font-family:\s*["']?cmr10/i.test(css),'nested cmr10 font omitted');
    ok(css.includes('MathJax_Test'),'existing MathJax font omitted');
    ok(/mjx-container\s*\{[^}]*line-height:\s*0/i.test(css),'ordinary MathJax style rule omitted');
    ok(!css.includes('unused_tikz_font'),'unused host font was copied');
    ok(css.includes('data:font/ttf;base64,'),'font was not self-contained');
    ok(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes('font-src data:'),'font CSP broadened');
  });
  await check('export preserves source DOM and freezes host-class SVG label fonts',async()=>{
    ok(host.outerHTML===before,'export mutated original preview');
    ok(html,'export failed');const parsed=new DOMParser().parseFromString(html,'text/html');
    for(let i=0;i<labels.length;i++){
      const el=parsed.getElementById(labels[i]);
      ok(el.style.fontFamily===expected[i].family,'computed SVG font-family lost: '+labels[i]);
      ok(el.style.fontSize===expected[i].size,'computed SVG font-size lost: '+labels[i]);
    }
  });
  await check('isolated document loads PUA glyphs with identical geometry and rendered ink',async()=>{
    ok(html,'export failed');frame=document.createElement('iframe');
    const loaded=new Promise(resolve=>{frame.onload=resolve;});frame.srcdoc=html;document.body.appendChild(frame);await loaded;
    const isolated=frame.contentDocument;metrics(isolated);await isolated.fonts.ready;
    const actual=metrics(isolated),loadedFonts=[...isolated.fonts].filter(f=>f.status==='loaded').map(f=>f.family.replace(/["']/g,''));
    ok(loadedFonts.includes('cmmi10')&&loadedFonts.includes('cmr10'),'embedded TeX fonts did not load');
    for(let i=0;i<labels.length;i++){
      ok(expected[i].ink>100,'fixture font produced no visible ink');
      ok(Math.abs(actual[i].width-expected[i].width)<0.05,'SVG glyph width changed: '+labels[i]);
      ok(Math.abs(actual[i].height-expected[i].height)<0.05,'SVG glyph height changed: '+labels[i]);
      ok(actual[i].ink===expected[i].ink,'rendered glyph ink changed: '+labels[i]);
    }
  });
  frame?.remove();
  const out=document.createElement('pre');out.id='mwb-test-results';out.textContent=JSON.stringify(results);document.body.appendChild(out);
}
