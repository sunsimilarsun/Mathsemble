'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {extractStem,tokenize,termFrequencies,sparseCosine}=require('../src/assembly-similarity-text.cjs');

test('stem retrieval excludes metadata, all answer blocks, teacher callouts and nested answer slots',()=>{
  const source='---\nid: SECRET_ID\nmethods: [SECRET_TAG]\n---\n求 $x+2=5$ 的解 ?{$\\frac{3}{2}$}。\n\n'+
    '> [!answer]+ SECRET_ANSWER\n> 这是完整答案\n\n> [!solution] SECRET_SOLUTION\n> 求解过程\n\n'+
    '> [!thinking]- SECRET_TEACHER\n> > [!note]+ 仍为教师内容\n> 备注\n\n第二问：判断 $x>0$（!{对}）。';
  const result=extractStem(source);assert.match(result.text,/x\+2=5/);assert.match(result.text,/第二问/);
  for(const forbidden of ['SECRET','完整答案','求解过程','教师内容','备注','frac','对'])assert(!result.text.includes(forbidden),forbidden);
  assert.equal(source.includes('SECRET_ANSWER'),true,'source remains unchanged');
});
test('nested teacher block is removed while the enclosing shared problem survives',()=>{
  const result=extractStem('> [!note]+ 题干\n> 已知 $x=2$\n> > [!answer]- 不能用于检索\n> > 秘密\n> 第二个条件 $y=3$\n\n求 $x+y$');
  assert.match(result.text,/x=2/);assert.match(result.text,/y=3/);assert.match(result.text,/x\+y/);assert(!result.text.includes('秘密'));
});
test('answer section headings are excluded without swallowing the next question section',()=>{
  const result=extractStem('# 题目\n第一题\n## 答案\n秘密\n### 解析\n更多秘密\n## 第二题\n第二问');
  assert(!result.text.includes('秘密'));assert.match(result.text,/第二问/);
});
test('unclosed metadata and answer slots fail conservatively instead of indexing answers',()=>{
  assert.equal(extractStem('---\nid: x\n题干').text,'');
  const result=extractStem('求值 ?{秘密未闭合');assert(!result.text.includes('秘密'));assert.equal(result.issues.length,1);
});
test('images, SVG and TikZ are flagged without turning code or image names into semantic evidence',()=>{
  const result=extractStem('如图证明。 ![答案暗示](secret.png) ![[other.png]] ![图][ref]\n<img src="more.png">\n'+
    '<svg><text>隐藏图中文字</text></svg>\n```tikz\n\\draw secret;\n```\n\\begin{tikzpicture} secret2 \\end{tikzpicture}');
  assert.equal(result.hasVisual,true);assert.equal(result.text,'如图证明。');assert(result.issues.some(x=>x.includes('图形')));
});
test('math inequalities, signs, numeric values, variables, quantifiers and negation are retained',()=>{
  const source='若所有 $x<y>z$，并非存在 $a=-2$ 或 $A=2$，证明 $x\\notin S$。';
  const stem=extractStem(source).text,tokens=tokenize(stem);
  for(const token of ['t:<','t:>','t:-','t:2','t:a','t:A','t:\\notin','c:非','b:所有','b:存在'])assert(tokens.has(token),token);
  const variants=['所有 x>0','存在 x>0','所有 x<0','所有 x>1'].map(tokenize),stats=termFrequencies(variants);
  assert.equal(sparseCosine(variants[0],variants[0],stats),1);
  for(const variant of variants.slice(1))assert(sparseCosine(variants[0],variant,stats)<1);
});
test('sparse scoring remains finite for empty text and repeated terms',()=>{
  const documents=[tokenize(''),tokenize('求值 求值 123')],stats=termFrequencies(documents);
  assert.equal(sparseCosine(documents[0],documents[1],stats),0);assert.equal(sparseCosine(documents[1],documents[1],stats),1);
});
test('interval endpoint brackets and mathematical negation remain different retrieval evidence',()=>{
  const texts=['$x\\in[0,1]$','$x\\in(0,1)$','$x\\notin[0,1]$','$\\forall x\\in[0,1]$','$\\exists x\\in[0,1]$'];
  const tokens=texts.map(value=>tokenize(extractStem(value).text)),stats=termFrequencies(tokens);
  assert(tokens[0].has('t:['));assert(tokens[1].has('t:('));assert(tokens[0].has('t:,'));
  assert(sparseCosine(tokens[0],tokens[1],stats)<1);assert(sparseCosine(tokens[0],tokens[2],stats)<1);
  assert(sparseCosine(tokens[3],tokens[4],stats)<1);
});
test('ordinary image URLs with numbered paths are not tokenized as question text',()=>{
  const result=extractStem('已知圆。![参考图](assets/ch02/image-20261117-42.png) 求面积。');
  assert.equal(result.text,'已知圆。 求面积。');assert.equal(result.hasVisual,true);
  assert(!tokenize(result.text).has('t:20261117'));
  const nested=extractStem('求面积 ![图](assets/第2章/image(42).png) ![参照][img]\n[img]: assets/secret-20261117.png\n完成。');
  assert.equal(nested.text,'求面积 完成。');assert.equal(nested.hasVisual,true);
});
test('adjacent mathematical tokens distinguish reversed inequalities and half-open interval endpoints',()=>{
  const input=['$x<y$','$y<x$','$x\\in[0,1)$','$x\\in(0,1]$'].map(tokenize),stats=termFrequencies(input);
  assert(sparseCosine(input[0],input[1],stats)<1);assert(sparseCosine(input[2],input[3],stats)<1);
});
