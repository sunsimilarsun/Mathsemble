'use strict';

function removeImages(value,onImage) {
  let result='';
  for(let i=0;i<value.length;i++) {
    if(value[i]!=='!'||value[i+1]!=='['||i>0&&value[i-1]==='\\'){result+=value[i];continue;}
    if(value[i+2]==='[') {
      const end=value.indexOf(']]',i+3);if(end>=0){onImage();result+=' ';i=end+1;continue;}
    }
    let end=i+2;
    for(;end<value.length;end++){if(value[end]==='\\'){end++;continue;}if(value[end]===']')break;}
    const opener=value[end+1],closer=opener==='('?')':opener==='['?']':'';
    if(!closer){result+=value[i];continue;}
    let depth=1,j=end+2;
    for(;j<value.length&&depth;j++){if(value[j]==='\\'){j++;continue;}if(value[j]===opener)depth++;else if(value[j]===closer)depth--;}
    if(depth){result+=value[i];continue;}
    onImage();result+=' ';i=j-1;
  }
  return result;
}

// Retrieval text only: never rewrite the source or infer missing diagram content.
function extractStem(markdown) {
  let value=String(markdown ?? '').replace(/^\uFEFF/,'');
  const issues=[];let hasVisual=false;
  if (/^---\r?\n/.test(value)) {
    const front=value.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
    if(!front)return {text:'',hasVisual:false,issues:['元信息未闭合，未提取题干']};
    value=value.slice(front[0].length);
  }
  value=value.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
  const output=[];let fence=null,skipDepth=0,blankAfterSkip=false,sectionDepth=0;
  for(const line of value.split(/\r?\n/)) {
    const fenced=line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if(fence) {
      if(fenced&&fenced[1][0]===fence[0]&&fenced[1].length>=fence.length)fence=null;
      continue;
    }
    if(fenced) {fence=fenced[1];if(/tikz|mermaid|svg|diagram/i.test(fenced[2]))hasVisual=true;continue;}
    const prefix=line.match(/^\s*((?:>\s*)+)/),depth=prefix?(prefix[1].match(/>/g)||[]).length:0;
    const body=prefix?line.slice(prefix[0].length):line;
    const callout=body.match(/^\[!([\w-]+)\]([+-])?(?:\s|$)/i);
    if(skipDepth) {
      if(callout&&depth<=skipDepth || depth>0&&depth<skipDepth || !depth&&line.trim()&&blankAfterSkip) {
        skipDepth=0;blankAfterSkip=false;
      } else {if(!line.trim())blankAfterSkip=true;continue;}
    }
    if(callout&&(callout[2]==='-'||/^(?:answer|solution|teacher|teacher-only)$/i.test(callout[1]))) {
      skipDepth=depth||1;blankAfterSkip=false;continue;
    }
    const heading=body.match(/^\s*(#{1,6})\s+(.+)$/);
    if(sectionDepth) {if(heading&&heading[1].length<=sectionDepth)sectionDepth=0;else continue;}
    if(heading&&/^(?:参考|标准|详细)?(?:答案|解析|解答|解题过程|教师用|教师提示)(?:(?:与|及|和)?(?:详细)?(?:答案|解析|解答))?(?:\s|[：:（(]|$)/.test(heading[2].replace(/[*_`]/g,'').trim())) {
      sectionDepth=heading[1].length;continue;
    }
    output.push(callout?body.slice(callout[0].length):body);
  }
  value=output.join('\n');
  value=value.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g,()=>{hasVisual=true;return ' ';});
  value=value.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi,()=>{hasVisual=true;return ' ';});
  value=removeImages(value,()=>{hasVisual=true;}).replace(/<img\b[^>]*>/gi,()=>{hasVisual=true;return ' ';})
    .replace(/^\s{0,3}\[[^\]]+\]:[^\n]*$/gm,' ');
  // Slots can contain nested TeX braces. A regex stopping at the first } leaks answers.
  let clean='';
  for(let i=0;i<value.length;i++) {
    if((value[i]==='?'||value[i]==='!')&&value[i+1]==='{'&&(i===0||value[i-1]!=='\\')) {
      let depth=1,j=i+2;
      for(;j<value.length&&depth;j++) {
        if(value[j]==='\\'&&(value[j+1]==='{'||value[j+1]==='}')) {j++;continue;}
        if(value[j]==='{')depth++;else if(value[j]==='}')depth--;
      }
      if(depth){issues.push('答案槽未闭合，已省略其后文字');break;}
      clean+=' ';i=j-1;
    } else clean+=value[i];
  }
  clean=clean.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,target,label)=>label||target)
    .replace(/\[([^\]]+)\]\([^\n]*?\)/g,'$1').replace(/<\/?(?:span|div|p|br|table|thead|tbody|tr|td|th|strong|em|details|summary|section|aside|sup|sub)\b[^>]*>/gi,' ')
    .replace(/^\s*#{1,6}\s+/gm,'').replace(/\s+/g,' ').trim();
  if(hasVisual)issues.push('含图片或图形，当前只比较可提取文字');
  return {text:clean,hasVisual,issues};
}

function tokenize(text) {
  const counts=new Map(),add=token=>counts.set(token,(counts.get(token)||0)+1);let previousMath=null;
  for(const value of String(text||'').match(/\\[A-Za-z]+|\d+(?:\.\d+)?|[A-Za-z]+|[\p{Script=Han}]+|[^\s]/gu)||[]) {
    if(/^[\p{Script=Han}]+$/u.test(value)) {
      previousMath=null;
      const chars=Array.from(value);for(const char of chars)add('c:'+char);
      for(let i=0;i<chars.length-1;i++)add('b:'+chars[i]+chars[i+1]);
    } else if(!/^[$.;：，。；、`#]$/.test(value)) {
      add('t:'+value);if(previousMath!==null)add('s:'+JSON.stringify([previousMath,value]));previousMath=value;
    } else if(value!=='$')previousMath=null;
  }
  return counts;
}

function termFrequencies(documents) {
  const df=new Map();for(const tokens of documents)for(const key of tokens.keys())df.set(key,(df.get(key)||0)+1);
  return {df,count:documents.length};
}
const idf=(stats,key)=>1+Math.log((stats.count+1)/((stats.df.get(key)||0)+1));
function sparseCosine(a,b,stats) {
  if(!a.size||!b.size)return 0;
  let dot=0,aa=0,bb=0;
  for(const [key,count]of a){const v=(1+Math.log(count))*idf(stats,key);aa+=v*v;if(b.has(key))dot+=v*(1+Math.log(b.get(key)))*idf(stats,key);}
  for(const [key,count]of b){const v=(1+Math.log(count))*idf(stats,key);bb+=v*v;}
  return aa&&bb?Math.max(0,Math.min(1,dot/Math.sqrt(aa*bb))):0;
}

module.exports={extractStem,tokenize,termFrequencies,sparseCosine};
