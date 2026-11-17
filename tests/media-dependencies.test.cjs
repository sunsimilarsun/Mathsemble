'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {collectMediaDependencies:collect}=require('../src/assembly-markdown.cjs');
const targets=source=>collect(source,'题库/原题.md').dependencies.map(row=>row.target);

test('declarations preserve source context and decode Markdown URLs exactly once while Wiki paths stay literal',()=>{
  const source='![图](配图/百分%2520号.png#坐标)\n![[配图/百分%20号.png|240]]\n![外部](https://example.invalid/%2520.png?a=1&b=2)';
  const result=collect(source,'题库/原题.md');
  assert.deepEqual(result.dependencies.map(row=>[row.syntax,row.rawTarget,row.target]),[
    ['markdown-image','配图/百分%2520号.png#坐标','配图/百分%20号.png#坐标'],
    ['wiki-embed','配图/百分%20号.png','配图/百分%20号.png'],
    ['markdown-image','https://example.invalid/%2520.png?a=1&b=2','https://example.invalid/%2520.png?a=1&b=2']
  ]);
  assert(result.dependencies.every(row=>row.sourcePath==='题库/原题.md'&&row.status==='declared'));
  assert.deepEqual(result.issues,[]);
});

test('inline images support nested brackets, balanced paths, escaped punctuation, angle destinations and titles',()=>{
  const source=String.raw`![坐标[附图]](图(1).png "标题 ![伪图](fake.png)")
![空格](<配图/a b.png> '说明')
![转义](配图/\(图\).png)
[![按钮](button.png)](https://example.invalid)
\![字面](literal.png)
![附图](quoted.png "标题中的 ) 符号")`;
  assert.deepEqual(targets(source),['图(1).png','配图/a b.png','配图/(图).png','button.png','quoted.png']);
});

test('whitespace and multiline image destinations are collected and empty targets remain unresolved',()=>{
  const result=collect('![a]( <space.png> )\n![b](\nimage.png\n)\n![c]()\n![d]( <a(b.png> )','题.md');
  assert.deepEqual(result.dependencies.map(row=>[row.target,row.status]),[
    ['space.png','declared'],['image.png','declared'],['','unresolved'],['a(b.png','declared']
  ]);
  assert.equal(result.issues[0].reasonCode,'empty-target');
});

test('reference images include full collapsed and shortcut uses but ignore ordinary links and unused definitions',()=>{
  const source='![图][IMG]\n![same][]\n![short]\n[普通][ordinary]\n[[普通笔记]]\n'+
    '\n[img]: a%20b.png "说明"\n[same]: <c d.png>\n[short]: <image>\n[ordinary]: note.md\n[unused]: unused.png\n';
  assert.deepEqual(targets(source),['a b.png','c d.png','image']);
  const missing=collect('![图][missing]','题.md');
  assert.equal(missing.dependencies[0].status,'unresolved');
  assert.equal(missing.issues[0].reasonCode,'missing-image-reference');
});

test('non-image Wiki embeds remain explicit unresolved or unsupported dependencies',()=>{
  const result=collect('![[笔记]]\n![[笔记.md#小节]]\n![[卷.pdf#page=2]]\n![[声音.mp3]]\n[[普通链接]]\n![[图.svg]]','题.md');
  assert.deepEqual(result.dependencies.map(row=>[row.target,row.status,row.reasonCode]),[
    ['笔记','unresolved','wiki-target-needs-resolution'],
    ['笔记.md#小节','unsupported','unsupported-wiki-embed'],
    ['卷.pdf#page=2','unsupported','unsupported-wiki-embed'],
    ['声音.mp3','unsupported','unsupported-wiki-embed'],
    ['图.svg','declared','']
  ]);
  assert.equal(result.issues.length,4);
});

test('code math frontmatter comments and HTML attributes cannot inject media declarations',()=>{
  const source='---\nimage: "![yaml](yaml.png)"\n---\n'+
    '`![inline](code.png)`\n\n```md\n![[fence.png]]\n```\n\n'+
    '    ![indent](indent.png)\n\n'+
    '> ```md\n> ![quote](quote-code.png)\n> ```\n\n'+
    '$![math](math.png)$\n$$\n![[display.png]]\n$$\n'+
    String.raw`\[![tex](tex.png)\]`+'\n'+
    '<!-- ![comment](comment.png) -->\n<pre>![pre](pre.png)</pre>\n'+
    '<span title="![attribute](attribute.png) $math$ ![[wiki.png]]">正文</span>\n'+
    '<a href="![href](href.png)">链接</a>\n![真实](real.png)';
  assert.deepEqual(targets(source),['real.png']);
});

test('HTML images use quote-aware attributes and decode entities without interpreting fake Markdown',()=>{
  const source='<img title="1 > 0 ![伪图](fake.png) $literal$" src="图%20像.png?a=1&amp;b=2">\n'+
    "<IMG alt='![[fake.png]]' SRC='&#x56FE;.png'>\n<img src=bare.png>\n"+
    '<img data-src="ignored.png" src="first.png" src="second.png">';
  const result=collect(source,'题.md');
  assert.deepEqual(result.dependencies.map(row=>row.target),['图 像.png?a=1&b=2','图.png','bare.png','first.png']);
  assert(result.dependencies.every(row=>row.syntax==='html-image'&&row.status==='declared'));
});

test('HTML-looking tags and Markdown image strings inside link destinations or titles stay literal',()=>{
  const source='[普通](url "<img src=title.png>")\n[普通](<url/![fake](destination.png)>)\n'+
    '![真实](image.png "<img src=alt-title.png>")\n'+
    '![<img src=alt.png>](outer.png)\n'+
    '[普通][x]\n[x]: url "<img src=reference-title.png>"\n'+
    '[<img src=linked.png>](url)';
  assert.deepEqual(targets(source),['image.png','outer.png','linked.png']);
});

test('dollar and backtick characters inside resource URLs and titles cannot consume later images as math or code',()=>{
  const source='![金额](price$1.png)\n后文 $x$\n![反引号](tick`one.png)\n`正文代码`\n'+
    '![引用][price]\n[price]: cost$2.png "标题 $three ![伪](fake.png)"\n'+
    '正文 $y$\n[普通](url$literal "title `![伪](fake.png)")\n![末图](last.png)\n'+
    '![[cash$1.png|240]]\n后文 $z$\n![[tick`two.png]]\n`代码`';
  assert.deepEqual(targets(source),['price$1.png','tick`one.png','cost$2.png','last.png','cash$1.png','tick`two.png']);
});

test('list and answer-callout images remain collectable despite indentation',()=>{
  const source='- 第一项\n    ![列表图](list.png)\n\n> [!answer]-\n> ![[answer.png]]\n> ![引用图][quoted]\n> [quoted]: quoted.png';
  assert.deepEqual(targets(source),['list.png','answer.png','quoted.png']);
});

test('unsupported HTML media and responsive srcset cannot silently become a complete archive',()=>{
  const result=collect('<img src="fallback.png" srcset="large.png 2x">\n<video src="movie.mp4"></video>','题.md');
  assert.deepEqual(result.dependencies.map(row=>[row.target,row.status]),[
    ['fallback.png','declared'],['large.png 2x','unsupported'],['movie.mp4','unsupported']
  ]);
  assert.deepEqual(result.issues.map(row=>row.reasonCode),['unsupported-html-srcset','unsupported-html-embed']);
});

test('unclosed literal regions fail closed as an explicit unparsed dependency without requiring compilation',()=>{
  for (const source of ['```md\n![fake](x.png)','<!-- ![fake](x.png)','---\nx: 1\n![fake](x.png)']) {
    const result=collect(source,'笔记.md');
    assert.equal(result.dependencies.length,1);assert.equal(result.dependencies[0].status,'unsupported');
    assert.equal(result.issues[0].reasonCode,'unparsed-markdown');
  }
  assert.deepEqual(collect('# 普通非题卡\n\n没有图片。','笔记.md'),{dependencies:[],issues:[]});
});
