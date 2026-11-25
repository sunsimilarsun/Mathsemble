'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const posix = require('node:path').posix;
const {expandHandoutEmbeds} = require('../src/handout-embeds.cjs');

const entry = 'lectures/M02.md';
function host(files) {
  const reads = [];
  const sources = new Map(Object.entries(files));
  function resolveLink(link, from) {
    const relative = posix.join(posix.dirname(from), link);
    for (const path of [relative, relative+'.md', link, link+'.md', ...sources.keys()]) {
      if (sources.has(path) && ([relative, relative+'.md', link, link+'.md'].includes(path) ||
        [link,link+'.md'].includes(posix.basename(path)))) return {path, extension:posix.extname(path).slice(1)};
    }
    return null;
  }
  return {reads, resolveLink, readFile(file) { reads.push(file.path); return sources.get(file.path); }};
}

test('includes the original answer markup in the source seen by both editions and reuses exact source snapshots', async () => {
  const card = '---\ntype: 题卡\n---\n题干\n\n> [!answer]- 解答\n> $x=2$';
  const options = host({'bank/card.md':card});
  const text = '---\ntitle: M02\n---\n\n##### 例题\n![[card|例题]]\n\n##### 复习\n![[card.md]]\n';
  const result = await expandHandoutEmbeds(text, entry, options);
  assert.match(result.markdown, /^---\ntitle: M02\n---/);
  assert.doesNotMatch(result.markdown, /题卡|!\[\[/);
  assert.equal(result.markdown.match(/\[!answer\]-/g).length, 2);
  assert.deepEqual(options.reads, ['bank/card.md']);
  assert.equal(result.dependencies[0].markdown, card);
  assert.deepEqual(result.embeddedLinks, [{sourcePath:entry,target:'card'},{sourcePath:entry,target:'card.md'}]);
  const lines = result.markdown.split('\n');
  assert.equal(result.rootLines.length, lines.length);
  assert.deepEqual(lines.flatMap((line,i) => line.includes('answer') ? [result.rootLines[i]] : []), [6,9]);
  assert.equal(result.rootLines[lines.indexOf('##### 复习')], 8);
});

test('uses each nested source path for images/links, preserves the display size and isolates reference labels', async () => {
  const first = '![[nested/card]]\n\n![A][图]\n\n[图]: <img/same name.png>\n\n[^x]: 一\n\n见[^x]。';
  const second = '![[img/same name.png|320]]\n\n![B](img/b.png)\n\n[原文](other.md)\n\n[^x]: 二\n\n见[^x]。';
  const options = host({'bank/top.md':first,'bank/nested/card.md':second,'bank/img/same name.png':'',
    'bank/nested/img/same name.png':'','bank/nested/img/b.png':'','bank/nested/other.md':''});
  const result = await expandHandoutEmbeds('![[top]]', entry, options);
  assert.match(result.markdown, /!\[\[bank\/nested\/img\/same name.png\|320\]\]/);
  assert.match(result.markdown, /\]\(\.\.\/bank\/nested\/img\/b.png\)/);
  assert.match(result.markdown, /\]\(\.\.\/bank\/nested\/other.md\)/);
  assert.match(result.markdown, /\]: \.\.\/bank\/img\/same%20name.png/);
  const defs = Array.from(result.markdown.matchAll(/\[\^([^\]]+)\]:/g), m => m[1]);
  assert.equal(new Set(defs).size, 2);
  assert.deepEqual(result.dependencies.map(d => d.path), ['bank/top.md','bank/nested/card.md']);
  assert.deepEqual(result.embeddedLinks.map(row => row.sourcePath), [entry,'bank/top.md']);
});

test('can expand in a callout and keeps native quote depth on every line of a nested block', async () => {
  const options = host({'card.md':'甲\n\n> [!answer]-\n> 答案'});
  const result = await expandHandoutEmbeds('> [!note]\n> ![[card]]\n> 乙', entry, options);
  assert.match(result.markdown, /> \[!note\]\n>\n> 甲\n>\n> > \[!answer\]-\n> > 答案\n>\n> 乙/);
});

test('Obsidian Markdown-format note embeds resolve URL paths, heading fragments and inline titles in source context', async () => {
  const sources = {'bank/a (b).md':'# Section A\n> [!answer]-\n> secret','img.png':''};
  const options = host(sources);
  options.selectSubpath = (_, text, fragment) => {
    assert.equal(fragment, '#Section A'); return text;
  };
  const input = '![](<../bank/a%20(b).md#Section%20A> "excerpt")\n![](img.png)\n![remote](https://example.invalid/ref.md)';
  const result = await expandHandoutEmbeds(input, entry, options);
  assert.match(result.markdown, /\[!answer\]-/);
  assert.ok(result.markdown.includes('![](img.png)\n![remote](https://example.invalid/ref.md)'));
  assert.deepEqual(result.embeddedLinks, [{sourcePath:entry,target:'../bank/a (b).md#Section%20A',syntax:'markdown-image'}]);
});

test('keeps literal examples, root metadata, ordinary links, image embeds and link destinations in their original form', async () => {
  const original = ['---','title: "![[missing]]"','---','````md','![[missing]]','````',
    '$$','![[missing]]','$$','`![[missing]]`','<!--','![[missing]]','-->',
    '%% ![[missing]] %%','\\![[missing]]','[[card]]','![[a.png|200]]','[x](<foo![[bad]]>)',
    '<span title="![[missing]]">ok</span>'].join('\n');
  const options = host({'a.png':'','card.md':'real'});
  const plain = await expandHandoutEmbeds(original, entry, options);
  assert.equal(plain.markdown, original);
  assert.deepEqual(options.reads, []);
  const active = await expandHandoutEmbeds(original+'\n![[card]]\n结尾', entry, options);
  assert.ok(active.markdown.startsWith(original+'\n'));
  assert.equal(active.rootLines.at(-1), original.split('\n').length+2);
  assert.equal(active.rootLines.length, active.markdown.split('\n').length);
});

test('selects only the requested excerpt and reports the declaring file on missing or inline note embeds', async () => {
  const card = '# A\nwrong\n# B\nright';
  const options = host({'card.md':card,'parent.md':'![[absent]]'});
  options.selectSubpath = (file, source, subpath) => {
    assert.equal(file.path, 'card.md'); assert.equal(source, card);
    if (subpath === '#B') return source.slice(source.indexOf('# B'));
  };
  const result = await expandHandoutEmbeds('![[card#B|摘录]]', entry, options);
  assert.match(result.markdown, /right/);
  assert.doesNotMatch(result.markdown, /wrong/);
  assert.deepEqual(result.embeddedLinks, [{sourcePath:entry,target:'card#B'}]);
  await assert.rejects(expandHandoutEmbeds('![[card#^missing]]',entry,options), /标题或块.*card#\^missing/);
  await assert.rejects(expandHandoutEmbeds('![[parent]]',entry,options), /找不到.*absent.*parent.md/);
  await assert.rejects(expandHandoutEmbeds('嵌入 ![[card]]',entry,options), /单独.*card/);
});

test('detects cycles by resolved file and fragment and allows repetition outside the active chain', async () => {
  const options = host({'bank/a.md':'![[b]]','bank/b.md':'![[a|循环]]'});
  await assert.rejects(expandHandoutEmbeds('![[a]]',entry,options), /循环嵌入.*bank\/a.md → bank\/b.md → bank\/a.md/);
});

test('whole question embeds use one ordinal per occurrence, remove both title layers and retain subheadings', async () => {
  const plain = '---\nobject_type: item\n---\n题干 $x$。\n\n## 题内提示\n内容';
  const named = '---\nobject_type: item\n---\n# 原题卡\n\n##### 【自设题标】\n已给题干\n\n##### 小问\n第二问';
  const options = host({'bank/A.md':plain,'bank/B.md':named,'bank/知识.md':'知识正文'});
  options.isQuestionNote = text => text.includes('object_type: item');
  const source = ['![[bank/A.md]]','![[bank/知识.md]]','![[bank/B.md]]','##### 教师自设标题','',
    '![[bank/B.md]]','讲解仍在外层显式 H5 内。','![[bank/A.md]]','独立点评。'].join('\n');
  const result = await expandHandoutEmbeds(source,entry,options);
  assert.deepEqual(result.markdown.match(/^##### .+$/gm),[1,2,3,4].map(n=>
    `##### <span class="mwb-auto-question-number">${n}.</span>`));
  assert.doesNotMatch(result.markdown,/【自设题标】|教师自设标题/);
  assert.equal((result.markdown.match(/^###### 小问$/gm)||[]).length,2);
  assert.equal((result.markdown.match(/^###### 题内提示$/gm)||[]).length,2);
  assert.doesNotMatch(result.markdown,/^# 原题卡$/m);
  assert.equal((result.markdown.match(/data-mwb-embed-end=/g)||[]).length,3);
  assert.match(result.markdown,/<span data-mwb-embed-end=""><\/span>\n\n知识正文|<span data-mwb-embed-end=""><\/span>\n\n\n知识正文/);
  assert.equal(result.dependencies.find(row=>row.path==='bank/B.md').markdown,named);
  const expanded = result.markdown.split('\n');
  assert.equal(result.rootLines.length,expanded.length);
  assert.equal(result.rootLines[expanded.indexOf('独立点评。')],source.split('\n').length);
  assert.equal(result.rootLines[expanded.findIndex(line=>line.includes('4.</span>'))],8);
});

test('fragment, nested, quote, list and media embeds do not count as root question occurrences',async () => {
  const card = '---\nobject_type: item\n---\n题干', options = host({'Q.md':card,'knowledge.md':'![[Q]]','fig.png':''});
  options.isQuestionNote = text => text.includes('object_type: item');
  options.selectSubpath = () => '题卡摘录';
  const result = await expandHandoutEmbeds(['![[knowledge]]','![[Q#标题]]','> ![[Q]]','- 材料','  ![[Q]]',
    '![[fig.png]]','##### 方法总结','回顾知识。','![[Q]]'].join('\n'),entry,options);
  assert.deepEqual(result.markdown.match(/class="mwb-auto-question-number">\d+\./g),['class="mwb-auto-question-number">1.']);
  assert.equal((result.markdown.match(/data-mwb-embed-end=/g)||[]).length,1);
  assert.match(result.markdown,/题卡摘录/);
  assert.match(result.markdown,/> 题干/);
});

test('expanded fragments and hand-written question labels share ordinals with following references',async () => {
  const options = host({'q.md':'题干'});
  options.isQuestionNote = () => true;
  options.isQuestionTitle = label => label.startsWith('【例1】 ');
  const result = await expandHandoutEmbeds(['##### 方法总结','总结说明','##### 【例1】手写题','第一题手写题干',
    '<!-- mathsemble:compiled-question -->','##### 我为片段起的题标','片段题干',
    '##### <span class="mwb-auto-question-number">9.</span>','固定片段','![[q.md]]',
    '##### 5.手工题标','','![[q.md]]','![[q.md]]'].join('\n'),entry,options);
  assert.deepEqual(Array.from(result.markdown.matchAll(/class="mwb-auto-question-number">(\d+)\./g),m=>m[1]),['1','2','3','4','5','6']);
  assert.match(result.markdown,/##### 方法总结/);
  assert.doesNotMatch(result.markdown,/我为片段起的题标|5\.手工题标/);
});

test('reordering whole and expanded questions keeps ordinals while removing old score labels',async () => {
  const options = host({'A.md':'第一题题干','B.md':'第二题题干'});
  options.isQuestionNote = () => true;
  const auto = (n, score) => `##### <span class="mwb-auto-question-number">${n}.</span>（${score} 分）`;
  const source = ['![[B]]',auto(7,4.5),'![[A]]',auto(1,0),'展开片段','##### 自定义题标（2 分）','![[B]]','![[A]]'].join('\n');
  const result = await expandHandoutEmbeds(source,entry,options);
  assert.deepEqual(result.markdown.match(/^##### .+$/gm),[1,2,3,4,5].map(n=>
    `##### <span class="mwb-auto-question-number">${n}.</span>`));
  assert.doesNotMatch(result.markdown,/分）|自定义题标/);
  const fixed = await expandHandoutEmbeds([auto(12,0),'已展开的题干'].join('\n'),entry,options);
  assert.equal(fixed.markdown,'##### <span class="mwb-auto-question-number">1.</span>\n已展开的题干');
});

test('ordinal-only output preserves answer-bearing handwritten stems and independent knowledge blocks',async () => {
  const options=host({'Q.md':'# 题库内标题\n\n##### 二次函数 $y=x^2$ 的图像〔核心〕\n\n取 $x=2$，求 $y$。'});
  options.isQuestionNote=()=>true;
  const source=['##### 【辨析 1】分清推出方向与反例〔基础〕','判断下列各项。',
    '##### 【转化 1】把文字条件转成集合关系〔基础〕','将下列条件用集合写出。',
    '##### 【变式 1-1】二次函数 $y=x^2$ 的图像〔核心〕','![[Q]]',
    '##### 例4 填入 ?{12}，选择（!{B}）。','补充说明。','##### 方法总结','![[Q]]'].join('\n');
  const result=await expandHandoutEmbeds(source,entry,options);
  assert.deepEqual(Array.from(result.markdown.matchAll(/class="mwb-auto-question-number">(\d+)\./g),m=>m[1]),['1','2','3','4','5']);
  assert.doesNotMatch(result.markdown,/辨析 1|转化 1|变式 1-1|图像|例4|题库内标题/);
  assert.match(result.markdown,/^#### 方法总结$/m);
  assert.match(result.markdown,/填入 \?\{12\}，选择（!\{B\}）。/);
  assert.equal(result.rootLines[result.markdown.split('\n').indexOf('填入 ?{12}，选择（!{B}）。')],7);
  assert.equal(result.rootLines.at(-1),source.split('\n').length);
});

test('a discarded card title cannot introduce a broken dependency into rendered output',async () => {
  const original='# 原文件 ![[不存在的笔记]]\n\n##### 图题 ![不存在](失效.png)\n\n实际题干。\n\n![有效图](a.png)';
  const options=host({'bank/Q.md':original,'bank/a.png':''});
  options.isQuestionNote=()=>true;
  const result=await expandHandoutEmbeds('![[bank/Q]]',entry,options);
  assert.doesNotMatch(result.markdown,/不存在|失效/);
  assert.match(result.markdown,/实际题干。/);
  assert.match(result.markdown,/bank\/a\.png/);
  assert.deepEqual(options.reads,['bank/Q.md']);
  assert.equal(result.dependencies[0].markdown,original);
});
