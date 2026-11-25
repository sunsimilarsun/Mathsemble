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
