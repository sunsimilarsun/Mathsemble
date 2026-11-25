'use strict';

// An opt-in source contract. Positions are diagnostics, never identities.
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN = new Set(['__proto__','prototype','constructor']);
const MAX_FRAGMENTS = 128;
const fail = (code,message) => Object.assign(new Error(message),{code});
function plain(raw,label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(raw))) throw fail('FRAGMENT_INVALID',label+'必须为普通对象');
  for (const key of Reflect.ownKeys(raw)) {
    const d=Object.getOwnPropertyDescriptor(raw,key);
    if (typeof key!=='string' || FORBIDDEN.has(key) || d.get || d.set) throw fail('FRAGMENT_INVALID',label+'含不允许的属性');
  }
}
function validateScore(raw) {
  if (typeof raw!=='number' || !Number.isFinite(raw) || raw<0 || raw>1000000 ||
      Math.abs(raw*100-Math.round(raw*100))>1e-7) throw fail('SCORE_INVALID','分值须为 0 到 1000000 之间、最多两位小数的数字');
  return Math.round(raw*100)/100;
}
function validateFragmentRef(raw,sourceKind) {
  plain(raw,'片段引用');
  if (Object.keys(raw).some(key=>!['kind','ids','scores'].includes(key)) ||
      !['question-part','knowledge-section'].includes(raw.kind) ||
      sourceKind && raw.kind!==(sourceKind==='question'?'question-part':sourceKind==='knowledge'?'knowledge-section':''))
    throw fail('FRAGMENT_INVALID','片段类型与来源不符或含未知字段');
  const ids=raw.ids;
  if (!Array.isArray(ids) || Object.getPrototypeOf(ids)!==Array.prototype || !ids.length || ids.length>MAX_FRAGMENTS ||
      Reflect.ownKeys(ids).some(key=>key!=='length' && (typeof key!=='string' || !/^(0|[1-9]\d*)$/.test(key))) ||
      Object.keys(ids).length!==ids.length || Object.values(Object.getOwnPropertyDescriptors(ids)).some(d=>d.get||d.set))
    throw fail('FRAGMENT_INVALID','所选片段 ID 列表无效');
  const seen=new Set();
  for (const id of ids) {
    if (typeof id!=='string'||!ID.test(id)||FORBIDDEN.has(id)||seen.has(id)) throw fail('FRAGMENT_INVALID','片段 ID 无效或重复');
    seen.add(id);
  }
  const result={kind:raw.kind,ids:[...ids]};
  if (Object.hasOwn(raw,'scores')) {
    if (raw.kind!=='question-part') throw fail('SCORE_INVALID','知识小节不能设置小问分值');
    plain(raw.scores,'小问分值');
    if (Object.keys(raw.scores).length!==ids.length || Object.keys(raw.scores).some(id=>!seen.has(id)))
      throw fail('SCORE_INCOMPLETE','须填写全部已选小问分值，不能把部分小计当作总分');
    result.scores=Object.fromEntries(ids.map(id=>[id,validateScore(raw.scores[id])]));
    validateScore(ids.reduce((sum,id)=>sum+Math.round(result.scores[id]*100),0)/100);
  }
  return result;
}
const totalScore = ref => ref?.scores ? ref.ids.reduce((sum,id)=>sum+Math.round(ref.scores[id]*100),0)/100 : null;

function sourceBody(markdown) {
  const source=String(markdown).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if (!/^---[ \t]*\n/.test(source)) return {body:source,offset:0};
  const match=/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(source);
  if (!match) throw fail('FRAGMENT_INVALID','源笔记 frontmatter 未闭合');
  return {body:source.slice(match[0].length),offset:match[0].split('\n').length-1};
}
function maskLinkLiterals(source) {
  const blank=value=>value.replace(/[^\n]/g,' '),escaped=index=>{let count=0;while(index>0&&source[--index]==='\\')count++;return count%2===1;};
  let out='',cursor=0;
  for(let i=0;i<source.length;i++) {
    if(source[i]!=='['||escaped(i))continue;
    if(source[i+1]==='['){const end=source.indexOf(']]',i+2);if(end>=0&&!source.slice(i,end).includes('\n')){out+=source.slice(cursor,i)+blank(source.slice(i,end+2));cursor=end+2;i=end+1;continue;}}
    let close=i+1,depth=1;
    for(;close<source.length;close++){if(escaped(close))continue;if(source[close]==='[')depth++;else if(source[close]===']'&&--depth===0)break;}
    if(source[close+1]!=='(')continue;
    let end=close+2,nesting=1,angle=false,quote='';
    for(;end<source.length;end++){
      if(escaped(end))continue;const c=source[end];
      if(quote){if(c===quote)quote='';continue;}
      if(c==='<'&&!source.slice(close+2,end).trim())angle=true;
      else if(c==='>'&&angle)angle=false;
      else if(!angle&&(c==='"'||c==="'")&&/\s/.test(source[end-1]||''))quote=c;
      else if(!angle&&c==='(')nesting++;
      else if(!angle&&c===')'&&--nesting===0)break;
    }
    if(end>=source.length)continue;
    out+=source.slice(cursor,i)+blank(source.slice(i,end+1));cursor=end+1;i=end;
  }
  return out+source.slice(cursor);
}

// Mask literal contexts before recognizing full-line, unindented markers.
// Structural comments inside fences, math, comments or HTML never become IDs.
function htmlEndLine(lines,start,tag) {
  const source=lines.slice(start).join('\n'),voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  let depth=0,cursor=0;
  while(cursor<source.length) {
    const opening=source.indexOf('<',cursor);if(opening<0)break;
    if(source.startsWith('<!--',opening)){const end=source.indexOf('-->',opening+4);if(end<0)break;cursor=end+3;continue;}
    const match=/^<(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/.exec(source.slice(opening));
    if(!match){cursor=opening+1;continue;}
    let end=opening+match[0].length,quote='';
    for(;end<source.length;end++){const c=source[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end>=source.length)break;
    const name=match[2].toLowerCase(),closing=!!match[1],selfClosing=/\/\s*>$/.test(source.slice(opening,end+1))||voidTags.has(name);
    if(name===tag){if(closing)depth--;else if(!selfClosing)depth++;if(depth===0)return start+source.slice(0,end).split('\n').length-1;}
    cursor=end+1;
    if(!closing&&!selfClosing&&['script','style','textarea','pre','code'].includes(name)) {
      const close=new RegExp('</'+name+'\\s*>','ig');close.lastIndex=cursor;const found=close.exec(source);
      if(!found)break;
      cursor=found.index+found[0].length;
      if(name===tag){depth--;if(depth===0)return start+source.slice(0,cursor).split('\n').length-1;}
    }
  }
  return lines.length-1;
}
function markerLines(lines) {
  const markers=new Map();let fence=null,math=null,code=0,comment=false;
  const contextLines=maskLinkLiterals(lines.join('\n')).split('\n');
  for (let i=0;i<lines.length;i++) {
    const line=contextLines[i];
    if (fence) {const close=/^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);if(close&&close[1][0]===fence[0]&&close[1].length>=fence.length)fence=null;continue;}
    if (!comment&&!math&&!code) {
      const opening=/^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if(opening&&!(opening[1][0]==='`'&&opening[2].includes('`'))){fence=opening[1];continue;}
      const tag=/^ {0,3}<([A-Za-z][A-Za-z0-9:-]*)\b/i.exec(line);
      if(tag){i=htmlEndLine(lines,i,tag[1].toLowerCase());continue;}
      const marker=/^<!-- mathsemble:(stem|part|section|end)(?: ([A-Za-z][A-Za-z0-9_-]{0,63}))? -->[ \t]*$/.exec(line);
      if(marker){markers.set(i,{type:marker[1],id:marker[2]||''});continue;}
      if(/^<!--\s*mathsemble:/.test(line)){markers.set(i,{type:'invalid',id:''});continue;}
    }
    if (/^(?: {4}|\t| {0,3}>)/.test(line) && !comment&&!math&&!code) continue;
    if (/^ {0,3}\[(?!\^)[^\]\n]+\]:/.test(line) && !comment&&!math&&!code) continue;
    for(let j=0;j<line.length;j++) {
      if(comment){const end=line.indexOf('-->',j);if(end<0)break;comment=false;j=end+2;continue;}
      if(code){if(line[j]==='`'){const n=/^`+/.exec(line.slice(j))[0].length;if(n===code)code=0;j+=n-1;}continue;}
      if(math){if(line.startsWith(math,j)){j+=math.length-1;math=null;}continue;}
      if(line[j]==='\\'){if(line[j+1]==='['){math='\\]';j++;}else j++;continue;}
      if(line.startsWith('<!--',j)){comment=true;j+=3;continue;}
      if(line[j]==='`'){code=/^`+/.exec(line.slice(j))[0].length;j+=code-1;continue;}
      if(line[j]==='$'){math=line[j+1]==='$'?'$$':'$';j+=math.length-1;}
    }
  }
  return markers;
}
function fragmentTitle(markdown,fallback) {
  const first=markdown.trimStart().split('\n')[0];
  return /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(first)?.[1] || fallback;
}
function referenceText(markdown) {
  // This mask is only for dependency closure, never for producing content.
  const lines=markdown.split('\n');let fence=null;
  const visible=lines.map(line=>{
    const opening=/^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){if(opening&&opening[1][0]===fence[0]&&opening[1].length>=fence.length&&!opening[2].trim())fence=null;return '';}
    if(opening){fence=opening[1];return '';}
    if(/^(?: {4}|\t)/.test(line))return '';
    return line;
  }).join('\n');
  return maskLinkLiterals(visible).replace(/^((?: {0,3}>[ \t]?)* {0,3}\[(?!\^)[^\]\n]+\]:)[^\n]*/gm,'$1')
    .replace(/<!--[\s\S]*?(?:-->|$)/g,'').replace(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/(`+)([^`]|(?!\1)`)*?\1/g,'').replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g,'').replace(/(?<!\\)\$(?:\\.|[^$])*?\$/g,'');
}
const normalizedReference=label=>label.trim().replace(/\s+/g,' ').toLowerCase();
function referenceDefinitions(markdown) {
  const result=new Map();
  for(const match of referenceText(markdown).matchAll(/^(?: {0,3}>[ \t]?)* {0,3}\[([^\]\n]+)\]:/gm)) {
    const label=normalizedReference(match[1]);result.set(label,(result.get(label)||0)+1);
  }
  return result;
}
function assertReferenceClosure(selected,complete) {
  const visible=referenceText(selected),available=referenceDefinitions(selected),all=referenceDefinitions(complete),used=new Set();
  const escaped=(text,index)=>{let count=0;while(index>0&&text[--index]==='\\')count++;return count%2===1;};
  const withoutDefinitions=visible.replace(/^(?: {0,3}>[ \t]?)* {0,3}\[[^\]\n]+\]:[^\n]*/gm,'');
  for(const match of withoutDefinitions.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    if(escaped(withoutDefinitions,match.index))continue;
    const end=match.index+match[0].length,next=withoutDefinitions[end];
    if(next==='('||next===']'||withoutDefinitions[match.index-1]==='[')continue;
    const label=normalizedReference(match[2]||match[1]);
    if(match[2]!==undefined||match[1].startsWith('^')||all.has(label))used.add(label);
  }
  for(const label of used) {
    if((all.get(label)||0)>1)throw fail('FRAGMENT_DEPENDENCY_AMBIGUOUS','来源含重复图片、链接或脚注定义：'+label+'；请明确依赖后再选片段');
    if(!available.has(label))throw fail('FRAGMENT_DEPENDENCY_MISSING',
      '所选片段缺少图片、链接或脚注定义：'+label+'；请将共用定义放入 stem，知识小节须自行包含依赖');
  }
}
function parseFragments(item) {
  if(!item||!['question','knowledge'].includes(item.kind)||typeof item.markdown!=='string') throw fail('FRAGMENT_INVALID','片段来源无效');
  const {body,offset}=sourceBody(item.markdown),lines=body.split('\n'),markers=markerLines(lines);
  const result={supported:markers.size>0,valid:true,kind:item.kind,fragments:[],sharedMarkdown:'',issues:[],wholeMarkdown:body};
  if(!markers.size)return result;
  const issue=(code,message,line)=>{result.valid=false;result.issues.push({code,message,line:line+offset+1});};
  const used=new Set(),outside=[],whole=[],stems=[];let active=null;
  for(let i=0;i<lines.length;i++) {
    const marker=markers.get(i);
    if(!marker){whole.push(lines[i]);if(active)active.lines.push(lines[i]);else outside.push({line:i,text:lines[i]});continue;}
    if(marker.type==='invalid'){issue('fragment-marker-invalid','片段注释格式无效',i);continue;}
    if(marker.type==='end') {
      if(marker.id||!active){issue('fragment-unmatched-end','片段结束标记无对应开始',i);continue;}
      const markdown=active.lines.join('\n').trim();
      if(!markdown)issue('fragment-empty','片段内容不能为空',active.line);
      const fragment={id:active.id,kind:active.type,title:fragmentTitle(markdown,active.type==='part'?'小问 '+(result.fragments.length+1):'知识小节 '+(result.fragments.length+1)),markdown,startLine:active.line+offset+2,endLine:i+offset};
      if(active.type==='stem')stems.push(fragment);else result.fragments.push(fragment);
      active=null;continue;
    }
    if(active){issue('fragment-nested','片段不能嵌套；请先结束前一片段',i);continue;}
    if(marker.type==='stem' ? marker.id||item.kind!=='question' : !marker.id||FORBIDDEN.has(marker.id)||marker.type!==(item.kind==='question'?'part':'section'))
      issue('fragment-kind-invalid','片段类型或稳定 ID 与来源不符',i);
    if(marker.type!=='stem'&&used.has(marker.id))issue('fragment-duplicate-id','同一来源存在重复片段 ID：'+marker.id,i);
    used.add(marker.id);active={...marker,line:i,lines:[]};
  }
  if(active)issue('fragment-unclosed','片段缺少结束标记',active.line);
  if(!result.fragments.length||result.fragments.length>MAX_FRAGMENTS)issue('fragment-count','来源须有 1 到 128 个可选片段',0);
  if(item.kind==='question'&&stems.length!==1)issue('fragment-stem','含小问的题卡必须有且仅有一个共用 stem 区域',0);
  // Outside the contract only one document title and blank lines are allowed.
  let titleSeen=false;
  for(const row of outside){if(!row.text.trim())continue;if(!titleSeen&&/^# [^#]/.test(row.text)){titleSeen=true;continue;}issue('fragment-unassigned','正文必须归入共用 stem 或明确片段，不能静默丢弃未归属内容',row.line);}
  result.sharedMarkdown=stems[0]?.markdown||'';result.wholeMarkdown=whole.join('\n');
  return result;
}
function listFragments(item) {
  const parsed=parseFragments(item);
  return {supported:parsed.supported,valid:parsed.valid,kind:item.kind,
    fragments:parsed.fragments.map(({id,title,kind})=>({id,title,kind})),issues:parsed.issues.map(issue=>({...issue}))};
}
function resolveFragment(item,raw) {
  const ref=validateFragmentRef(raw,item.kind),parsed=parseFragments(item);
  if(!parsed.supported)throw fail('FRAGMENT_MISSING','来源没有稳定片段锚点；请切回整题或恢复原锚点');
  if(!parsed.valid)throw fail('FRAGMENT_INVALID','来源片段契约无效：'+parsed.issues.map(issue=>issue.message).join('；'));
  const selected=ref.ids.map(id=>{
    const found=parsed.fragments.find(part=>part.id===id);
    if(!found)throw fail('FRAGMENT_MISSING','引用的稳定片段已缺失：'+id+'；不会按标题或序号回退');
    return {...found};
  });
  const blocks=selected.map(part=>{
    if(!ref.scores)return part.markdown;
    const body=part.markdown.replace(/^#{1,6}[ \t]+[^\n]+(?:\n|$)/,'').trim();
    return '## '+part.title+'（'+ref.scores[part.id]+' 分）\n\n'+body;
  });
  const markdown=[parsed.sharedMarkdown,...blocks].filter(Boolean).join('\n\n');
  assertReferenceClosure(markdown,item.markdown);
  return {reference:ref,markdown,
    sharedMarkdown:parsed.sharedMarkdown,fragments:selected,score:totalScore(ref)};
}
module.exports={validateScore,validateFragmentRef,totalScore,parseFragments,listFragments,resolveFragment};
