'use strict';

const textFeatures=typeof MWB_ASSEMBLY_SIMILARITY_TEXT!=='undefined'?MWB_ASSEMBLY_SIMILARITY_TEXT:require('./assembly-similarity-text.cjs');
const ALGORITHM='similarity-local-v1';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const text=value=>typeof value==='string'?value.trim():'';
const fold=value=>text(value).normalize('NFKC').toLowerCase();
const list=value=>Array.isArray(value)?value.filter(x=>typeof x==='string'&&x.trim()):typeof value==='string'&&value.trim()?[value]:[];
const broadMethods=new Set(['分类讨论','分类讨论法','数形结合','数形结合法','转化与化归','转化法','化归法','代数法','几何法','综合法','分析法','直接法','计算法','方程思想','函数思想','数学建模']);
const compatible=(a,b)=>!text(a)||!text(b)||fold(a)===fold(b);
function normalizePath(path) {
  const parts=[];for(const part of path.replace(/\\/g,'/').split('/')) {
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)return '';parts.pop();}else parts.push(part);
  }
  return parts.join('/').replace(/\.md$/i,'');
}
function parseRef(raw) {
  const value=text(raw),wiki=/^\[\[[\s\S]*\]\]$/.test(value),body=wiki?value.slice(2,-2):value;
  const target=body.split('|')[0].trim(),pos=target.indexOf('#');
  return {raw:value,wiki,target:pos<0?target:target.slice(0,pos).trim(),anchor:pos<0?'':target.slice(pos+1).trim()};
}
function allowedScope(tag,subject) {
  const explicit=list(tag.subjects||tag.subject);if(explicit.length)return explicit.some(x=>fold(x)===fold(subject));
  const scope=text(tag.scope),stages=['初中','高中','小学','大学'].filter(stage=>scope.includes(stage));
  return !stages.length||stages.some(stage=>text(subject).includes(stage));
}
function vocabulary(raw,dimension,subject) {
  const tags=Array.isArray(raw)?raw:Array.isArray(raw?.tags)?raw.tags:[];
  const terms=new Map(),definitions=new Map();
  for(const tag of tags) {
    if(!tag||!text(tag.id)||!text(tag.name)||tag.status&&tag.status!=='approved'||!allowedScope(tag,subject))continue;
    const signature=JSON.stringify([tag.id,tag.name,list(tag.aliases).sort(compare),tag.broad===true,tag.specificity||'']);
    if(!definitions.has(tag.id))definitions.set(tag.id,new Set());definitions.get(tag.id).add(signature);
    for(const label of [tag.id,tag.name,...list(tag.aliases)]) {
      const key=fold(label);if(!terms.has(key))terms.set(key,new Map());
      terms.get(key).set(signature,tag);
    }
  }
  return raw=>{
    const matches=terms.get(fold(raw));
    if(!matches)return {status:'unknown'};
    if(matches.size!==1||[...matches.values()].some(tag=>definitions.get(tag.id).size>1))return {status:'ambiguous'};
    const tag=[...matches.values()][0];
    return {status:'resolved',key:dimension+':tag:'+tag.id,label:tag.name,
      broad:dimension==='method'&&(tag.broad===true||tag.specificity==='broad'||broadMethods.has(tag.name))};
  };
}
function createNormalizer(index,taxonomy) {
  const nodes=index.items.filter(item=>item.kind==='knowledge'),vocabCache=new Map();
  const nodeIds=new Map(),nodePaths=new Map(),nodeNames=new Map();
  const register=(map,key,node)=>{if(!key)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(node);};
  for(const node of nodes) {
    register(nodeIds,node.id,node);register(nodePaths,normalizePath(node.path),node);
    for(const name of [node.title,node.path.split('/').pop().replace(/\.md$/i,''),...list(node.aliases)])register(nodeNames,fold(name),node);
  }
  function vocab(dimension,subject) {
    const key=dimension+'\0'+subject;if(!vocabCache.has(key))vocabCache.set(key,vocabulary(taxonomy[dimension==='knowledge'?'knowledge':'methods'],dimension,subject));
    return vocabCache.get(key);
  }
  function nodeMatches(ref,item) {
    const eligible=values=>[...(values||[])].filter(node=>compatible(node.subject,item.subject));
    const byId=eligible(nodeIds.get(ref.target));if(byId.length)return byId;
    if(ref.target.includes('/')||/\.md$/i.test(ref.target)) {
      const paths=new Set([normalizePath(ref.target),normalizePath(item.path.split('/').slice(0,-1).join('/')+'/'+ref.target)].filter(Boolean));
      return eligible(new Set([...paths].flatMap(path=>[...(nodePaths.get(path)||[])])));
    }
    return eligible(nodeNames.get(fold(ref.target)));
  }
  function hasAnchor(node,anchor) {
    if(anchor.startsWith('^'))return new RegExp('(?:^|\\s)\\^'+anchor.slice(1).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$','m').test(node.markdown);
    return node.markdown.split(/\r?\n/).some(line=>{const match=line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);return match&&fold(match[1])===fold(anchor);});
  }
  function one(raw,item,dimension) {
    const ref=parseRef(raw),lookup=vocab(dimension,item.subject),warnings=[];
    if(!ref.target||['null','~','[]'].includes(fold(ref.target))||/[\x00-\x1f\x7f]/.test(ref.target))return {status:'invalid',raw,warnings:['标签格式无效']};
    const matches=nodeMatches(ref,item),ambiguous=matches.length>1||matches[0]?.identityConflict;
    const direct=lookup(ref.target);
    if(direct.status==='ambiguous')return {status:'ambiguous',raw,warnings:['标签同义词有歧义：'+ref.target]};
    if(ref.wiki&&ambiguous)return {status:'ambiguous',raw,warnings:['链接目标有歧义：'+ref.target]};
    if(ref.anchor) {
      if(matches.length!==1||ambiguous||!hasAnchor(matches[0],ref.anchor))return {status:'missing',raw,warnings:['小节或块引用未唯一解析：'+ref.target+'#'+ref.anchor]};
      return {status:'resolved',raw,key:dimension+':node:'+matches[0].key+'#'+ref.anchor,label:ref.target+'#'+ref.anchor,broad:false,warnings};
    }
    if(direct.status==='resolved') {
      if(ref.wiki&&!matches.length)warnings.push('标签已按词表识别，但原链接未解析：'+ref.target);
      return {...direct,raw,warnings};
    }
    if(matches.length===1&&!ambiguous) {
      const node=matches[0],names=[node.title,...list(node.aliases),node.path.split('/').pop().replace(/\.md$/i,'')];
      const mapped=names.map(lookup),canonical=new Map(mapped.filter(x=>x.status==='resolved').map(x=>[x.key,x]));
      if(mapped.some(x=>x.status==='ambiguous')||canonical.size>1)return {status:'ambiguous',raw,warnings:['目标页对应多个规范标签：'+ref.target]};
      if(canonical.size===1)return {...[...canonical.values()][0],raw,warnings};
      return {status:'resolved',raw,key:dimension+':node:'+node.key,label:node.title||ref.target,
        broad:dimension==='method'&&broadMethods.has(node.title||ref.target),warnings};
    }
    if(ambiguous)return {status:'ambiguous',raw,warnings:['标签目标有歧义：'+ref.target]};
    if(ref.target.includes('/')||/\.md$/i.test(ref.target))return {status:'missing',raw,warnings:['链接或路径未解析：'+ref.target]};
    // Old cards often wrap a plain leaf label in [[...]] without creating a page.
    // Preserve that exact declaration, but never call it a resolved link or
    // derive aliases from it. Ambiguous pages and paths were rejected above.
    if(ref.wiki)warnings.push('仅按同名标签比较，原链接未解析：'+ref.target);
    return {status:ref.wiki?'declared-unresolved':'declared',raw,key:dimension+':label:'+fold(ref.target),label:ref.target,
      broad:dimension==='method'&&broadMethods.has(ref.target),warnings};
  }
  return (item,dimension)=>{
    const raw=dimension==='knowledge'?item.knowledgeNodes:item.methods,entries=list(raw).map(value=>one(value,item,dimension));
    const keys=new Map();for(const entry of entries)if(entry.key&&!keys.has(entry.key))keys.set(entry.key,entry);
    return {entries,keys,warnings:entries.flatMap(entry=>entry.warnings)};
  };
}
function weightedOverlap(a,b,df,count) {
  const union=new Set([...a.keys(),...b.keys()]);let common=0,total=0;
  for(const key of union){const weight=1+Math.log((count+1)/((df.get(key)||0)+1));total+=weight;if(a.has(key)&&b.has(key))common+=weight;}
  return total?common/total:0;
}
function createSimilarityEngine({core}={}) {
  if(!core||typeof core.filterItems!=='function'||typeof core.normalizeFamilyMetadata!=='function')throw new TypeError('相似题引擎需要现行 assembly core');
  function search({index,sourceKey,mode='knowledge',filters={},excludedKeys=[],taxonomy={}}={}) {
    if(!Array.isArray(index?.items)||typeof sourceKey!=='string'||!['family','knowledge','method'].includes(mode)||!Array.isArray(excludedKeys))throw new TypeError('相似题查询参数无效');
    if(!taxonomy||typeof taxonomy!=='object'||Array.isArray(taxonomy))throw new TypeError('词表必须为对象');
    const result={status:'ready',sourceKey,mode,candidates:[],issues:[],algorithmVersion:ALGORITHM};
    const conflict=(code,message)=>({...result,status:'conflict',issues:[{code,message}]});
    const keys=new Map(),ids=new Map(),paths=new Map();
    for(const item of index.items){keys.set(item.key,(keys.get(item.key)||0)+1);paths.set(item.path,(paths.get(item.path)||0)+1);if(item.id)ids.set(item.id,(ids.get(item.id)||0)+1);}
    const safe=item=>item.kind==='question'&&!item.identityConflict&&keys.get(item.key)===1&&paths.get(item.path)===1&&(!item.id||ids.get(item.id)===1);
    const source=index.items.find(item=>item.key===sourceKey);
    if(!source||!safe(source))return conflict('SIMILARITY_SOURCE_CONFLICT','原题缺失或身份冲突，请先核对来源');
    const family=core.normalizeFamilyMetadata(source.metadata);
    if(mode==='family'&&(!family.familyValid||!family.familyId))return conflict('SIMILARITY_FAMILY_UNKNOWN','原题尚未归族或题族字段无效');
    if(!family.familyValid)result.issues.push({code:'SIMILARITY_FAMILY_INVALID',message:'原题题族字段异常；本次仅按知识点或方法比较'});
    const normalize=createNormalizer(index,taxonomy),features=new Map(),knowledgeDF=new Map(),methodDF=new Map(),postings={knowledge:new Map(),method:new Map(),family:new Map()};
    const add=(map,key,itemKey)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(itemKey);};
    // One snapshot scan and one source-to-candidates comparison, never all pairs.
    for(const item of index.items) {
      if(!safe(item)||item!==source&&!core.normalizeFamilyMetadata(item.metadata).familyValid)continue;
      const knowledge=normalize(item,'knowledge'),method=normalize(item,'method'),stem=textFeatures.extractStem(item.markdown),tokens=textFeatures.tokenize(stem.text);
      const value={item,knowledge,method,stem,tokens,family:core.normalizeFamilyMetadata(item.metadata)};features.set(item.key,value);
      for(const key of knowledge.keys.keys()){knowledgeDF.set(key,(knowledgeDF.get(key)||0)+1);add(postings.knowledge,key,item.key);}
      for(const key of method.keys.keys()){methodDF.set(key,(methodDF.get(key)||0)+1);add(postings.method,key,item.key);}
      if(value.family.familyValid&&value.family.familyId)add(postings.family,value.family.familyId,item.key);
    }
    const current=features.get(sourceKey),wanted=mode==='family'?[family.familyId]:[...(mode==='knowledge'?current.knowledge:current.method).keys.keys()];
    result.issues.push(...[...new Set([...current.knowledge.warnings,...current.method.warnings])].map(message=>({code:'SIMILARITY_TAG_DIAGNOSTIC',message})));
    if(!wanted.length){result.issues.unshift({code:'SIMILARITY_EVIDENCE_MISSING',message:mode==='knowledge'?'原题缺少可比较的知识点标签':'原题缺少可比较的方法标签'});return result;}
    const pool=new Set();for(const key of wanted)for(const candidate of postings[mode].get(key)||[])pool.add(candidate);
    const visible=new Set(core.filterItems(index,filters)),excluded=new Set(excludedKeys),termStats=textFeatures.termFrequencies([...features.values()].map(x=>x.tokens));
    for(const key of pool) {
      const other=features.get(key),item=other.item;
      if(key===sourceKey||excluded.has(key)||excluded.has('path:'+item.path)||item.id&&excluded.has('id:'+item.id)||!visible.has(item)||!compatible(source.subject,item.subject))continue;
      const sharedK=[...current.knowledge.keys.keys()].filter(k=>other.knowledge.keys.has(k));
      const sharedM=[...current.method.keys.keys()].filter(k=>other.method.keys.has(k));
      if(mode==='method'&&!sharedM.some(k=>!current.method.keys.get(k).broad&&!other.method.keys.get(k).broad)&&!sharedK.length)continue;
      const K=weightedOverlap(current.knowledge.keys,other.knowledge.keys,knowledgeDF,features.size),M=weightedOverlap(current.method.keys,other.method.keys,methodDF,features.size);
      const T=textFeatures.sparseCosine(current.tokens,other.tokens,termStats),score=(mode==='method'?.25:.6)*K+(mode==='method'?.6:.25)*M+.15*T;
      const reasons=[],missing=[];
      if(mode==='family')reasons.push('同一登记题族：'+family.familyId);
      if(sharedK.length)reasons.push('共同知识点：'+sharedK.map(k=>current.knowledge.keys.get(k).label).join('、'));
      if(sharedM.length)reasons.push('共同方法：'+sharedM.map(k=>current.method.keys.get(k).label).join('、'));
      if(T>0)reasons.push('题干文字相近（辅助排序）');
      if(source.difficulty!=null&&item.difficulty!=null&&Math.abs(source.difficulty-item.difficulty)<=1)reasons.push(source.difficulty===item.difficulty?'难度同档':'难度相邻');
      for(const [name,left,right]of [['知识点',current.knowledge.keys.size,other.knowledge.keys.size],['方法',current.method.keys.size,other.method.keys.size],['题干文字',current.tokens.size,other.tokens.size]]) {
        if(!left)missing.push('原题缺少'+name+'证据');if(!right)missing.push('候选缺少'+name+'证据');
      }
      if(!source.subject||!item.subject)missing.push('学科信息不完整');
      if(source.difficulty==null||item.difficulty==null)missing.push('难度信息不完整');
      missing.push(...current.knowledge.warnings,...current.method.warnings,...other.knowledge.warnings,...other.method.warnings,...current.stem.issues,...other.stem.issues);
      result.candidates.push({key:item.key,id:item.id||'',path:item.path,fingerprint:item.fingerprint,title:item.title,
        familyId:other.family.familyId,subject:item.subject,questionType:item.questionType,difficulty:item.difficulty,tiers:[...(item.tiers||[])],role:item.role,
        rankScore:Number(score.toFixed(8)),scores:{knowledge:K,method:M,text:T},
        evidenceCoverage:{knowledge:!!(current.knowledge.keys.size&&other.knowledge.keys.size),method:!!(current.method.keys.size&&other.method.keys.size),text:!!(current.tokens.size&&other.tokens.size)},
        reasons,missing:[...new Set(missing)],normalized:{knowledge:other.knowledge.entries.map(x=>({...x,warnings:[...x.warnings]})),methods:other.method.entries.map(x=>({...x,warnings:[...x.warnings]}))}});
    }
    result.candidates.sort((a,b)=>b.rankScore-a.rankScore||compare(a.key,b.key)||compare(a.path,b.path));
    if(!result.candidates.length)result.issues.push({code:'SIMILARITY_NO_CANDIDATES',message:'没有同时满足标签证据、学科和当前筛选的候选题'});
    return result;
  }
  return {search,algorithmVersion:ALGORITHM};
}

module.exports={createSimilarityEngine};
