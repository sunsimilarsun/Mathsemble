'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// A small deterministic layout DOM. All dimensions below are synthetic px,
// not a substitute for Obsidian/Chromium PDF visual acceptance. It exercises
// the *real* paginator control flow, chunk counting, and content preservation.
class E {
  constructor(tag, doc) {
    this.tagName=tag.toUpperCase(); this.ownerDocument=doc;
    this.parentElement=null; this.children=[]; this.className='';
    this.style={}; this._height=null; this._text='';
    this._attrs={};
  }
  get classList() { return {
    contains:x=>this.className.split(/\s+/).includes(x),
    remove:x=>{this.className=this.className.split(/\s+/).filter(t=>t!==x).join(' ');},
    add:x=>{if(!this.className.split(/\s+/).includes(x))this.className+=' '+x;}
  }; }
  get attributes(){return Object.entries(this._attrs).map(([name,value])=>({name,value}));}
  setAttribute(name,value){this._attrs[name]=String(value);}
  getAttribute(name){return this._attrs[name]??null;}
  removeAttribute(name){delete this._attrs[name];}
  appendChild(el){if(el.parentElement)el.remove();this.children.push(el);el.parentElement=this;return el;}
  append(...els){for(const e of els)this.appendChild(e);}
  removeChild(el){const i=this.children.indexOf(el);if(i<0)throw Error('node not child');this.children.splice(i,1);el.parentElement=null;return el;}
  remove(){if(this.parentElement)this.parentElement.removeChild(this);}
  insertBefore(el,sibling){if(el.parentElement)el.remove();const i=this.children.indexOf(sibling);if(i<0)throw Error('reference not child');this.children.splice(i,0,el);el.parentElement=this;}
  replaceChildren(...els){for(const e of [...this.children])e.remove();this._text='';this.append(...els);}
  get firstChild(){return this.children[0]??null;}
  get firstElementChild(){return this.firstChild;}
  get textContent(){return this._text+this.children.map(e=>e.textContent).join('');}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get innerHTML(){return '';}
  matches(selector){
    return selector.split(',').some(raw=>{
      const s=raw.trim();if(!/^(?:[a-z0-9-]+)?(?:\.[\w-]+)*$/i.test(s))return false;
      const tag=s.match(/^[a-z0-9-]+/i)?.[0];
      if(tag&&tag.toUpperCase()!==this.tagName)return false;
      return [...s.matchAll(/\.([\w-]+)/g)].every(m=>this.classList.contains(m[1]));
    });
  }
  querySelectorAll(selector){
    const direct=selector.startsWith(':scope > ');
    const sel=direct?selector.slice(9).trim():selector;
    const collected=[];
    const walk=node=>{for(const child of node.children){if(child.matches(sel))collected.push(child);if(!direct)walk(child);}};
    walk(this);return collected;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  cloneNode(deep=false){const copy=new E(this.tagName,this.ownerDocument);copy.className=this.className;copy.style={...this.style};copy._height=this._height;copy._text=this._text;copy._attrs={...this._attrs};if(deep)for(const c of this.children)copy.appendChild(c.cloneNode(true));return copy;}
  height(){
    if(this.classList.contains('mwb-paper')||this.classList.contains('mwb-paper-body'))return 100;
    if(this._height!=null)return this._height;
    if(this.style.height)return Number.parseFloat(this.style.height)||0;
    return this.children.reduce((total,c)=>total+c.height(),0);
  }
  getBoundingClientRect(){
    let top=this.parentElement?this.parentElement.getBoundingClientRect().top:0;
    if(this.parentElement)for(const sibling of this.parentElement.children){if(sibling===this)break;top+=sibling.height();}
    const h=this.height();
    return {top,bottom:top+h,height:h,left:0,right:100,width:100};
  }
  get scrollHeight(){return this.children.reduce((n,e)=>n+e.height(),0);}
  get clientHeight(){return this.height();}
  hasChildNodes(){return !!(this.children.length||this._text);}
}
function doc(){
  const d={defaultView:{getComputedStyle:()=>({marginBottom:'0'})}};
  d.createElement=tag=>new E(tag,d);
  d.head=d.createElement('head');
  return d;
}
function block(d,tag,height,cls='') {
  const e=d.createElement(tag);e._height=height;e.className=cls;return e;
}
function question(d,values,id){
  const q=d.createElement('section');q.className='mwb-exam-question';
  q.setAttribute('data-mwb-source-path',id+'.md');
  const content=d.createElement('div');content.className='mwb-exam-question-content';q.appendChild(content);
  for(const [kind,height] of values){
    if(kind==='prompt'){
      const p=block(d,'p',height);
      const span=d.createElement('span');span.className='mwb-question-index';span.textContent=id+'.';p.appendChild(span);
      content.appendChild(p);
    } else if(kind==='options'){
      content.appendChild(block(d,'ul',height,'mwb-options'));
    } else if(kind==='space'){
      content.appendChild(space(d,Array.isArray(height)?height:[height]));
    } else {
      content.appendChild(block(d,'p',height));
    }
  }
  return q;
}
function space(d,heights){
  const s=d.createElement('div');s.className='mwb-answer-space';
  s.setAttribute('data-mwb-space-px',heights.reduce((a,b)=>a+b,0));
  for(const h of heights){const c=d.createElement('div');c.className='mwb-answer-space-chunk';c.style.height=h+'px';s.appendChild(c);}
  return s;
}
const js=fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
const start=js.indexOf('function paginatePrintDocument(');
const end=js.indexOf('// Serialize a pure browser function.',start);
assert.ok(start>0&&end>start,'page script must be discoverable');
const context={};
vm.runInNewContext(js.slice(start,end)+'\n;globalThis.paginate = paginatePrintDocument;',context);
function pages(root){return root.children.filter(e=>e.classList.contains('mwb-paper'));}
function run(children){
  const d=doc(),root=d.createElement('main');root.className='mwb-export-doc';
  for(const item of children)root.appendChild(item);
  const result=context.paginate(root);
  return {root,result,pages:pages(root)};
}
test('P0 short exam questions move intact rather than split across pages',()=>{
  const d=doc();
  const a=question(d,[['prompt',55]],'1'),b=question(d,[['prompt',55]],'2');
  const {pages,result}=run([a,b]);
  assert.equal(result.pages,2);
  assert.equal(pages[0].querySelectorAll('.mwb-question-index').length,1);
  assert.equal(pages[1].querySelectorAll('.mwb-question-index').length,1);
  assert.ok(pages[1].querySelectorAll('.mwb-exam-question').includes(b),'original entire question is on next page');
});
test('P0 long exam questions may split, but prompt and options stay on one page',()=>{
  const d=doc(),q=question(d,[['prompt',30],['options',45],['other',70]],'1');
  const {pages,result}=run([q]);
  assert.equal(result.pages,2);
  assert.equal(result.splitCallouts,0);
  assert.equal(pages[0].querySelectorAll('.mwb-options').length,1);
  assert.equal(pages[0].querySelectorAll('.mwb-question-index').length,1);
  assert.equal(pages[1].querySelectorAll('.mwb-options').length,0);
});
test('P0 student starter space stays with prompt and preserves every handwriting chunk',()=>{
  const d=doc();
  const lead=question(d,[['prompt',20]],'1');
  const q=question(d,[['prompt',75],['space',[15,15,15,15]]],'2');
  const {pages,result}=run([lead,q]);
  assert.equal(result.answerSpaceExpectedPx,60);
  assert.equal(result.answerSpacePlacedPx,60);
  assert.equal(result.answerSpaceChunks,4);
  assert.ok(pages.length>=2);
  const promptPage=pages.findIndex(p=>p.querySelectorAll('.mwb-question-index').some(e=>e.textContent==='2.'));
  assert.ok(promptPage>=1,'second prompt moved off nearly full previous page');
  assert.equal(pages[promptPage].querySelectorAll('.mwb-answer-space-chunk').length,1);
});
test('P0 long handout keeps final prompt with first writing chunk',()=>{
  const d=doc();
  const prefix=block(d,'p',20),prompt=block(d,'p',75);
  const s=space(d,[15,15,15,15]);
  const {pages,result}=run([prefix,prompt,s]);
  assert.equal(result.answerSpacePlacedPx,60);
  assert.equal(result.answerSpaceChunks,4);
  assert.ok(pages.length>=2);
  const pg=pages.findIndex(p=>p.querySelectorAll('p').includes(prompt));
  assert.ok(pg>=1);
  assert.equal(pages[pg].querySelectorAll('.mwb-answer-space-chunk').length,1);
});
test('P0 unbreakable full-page question still falls back to block-level splitting',()=>{
  const d=doc();const q=question(d,[['prompt',45],['other',55],['other',40]],'1');
  const {pages,result}=run([q]);
  assert.equal(result.pages,2);
  assert.equal(pages[0].querySelectorAll('.mwb-question-index').length,1);
  assert.equal(pages[1].querySelectorAll('.mwb-question-index').length,0);
});
