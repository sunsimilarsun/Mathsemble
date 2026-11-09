'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
// CI uses versioned public regression data. An explicit external directory is
// an opt-in production audit, never a dependency of a portable checkout.
const fixtureDir = path.join(__dirname, 'fixtures', 'templates', 'v1');
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));
const externalDir = process.env.MATHSEMBLE_TEMPLATE_DIR ? path.resolve(process.env.MATHSEMBLE_TEMPLATE_DIR) : null;
const handouts = manifest.handouts;
const cards = manifest.cards;
const materialTemplates = [...handouts, ...cards];
const recordsByName = new Map(materialTemplates.map(fixture => [fixture.name, fixture]));
const templatePath = name => {
  const fixture = recordsByName.get(name);
  return externalDir && fixture?.sourcePath ? path.join(externalDir, fixture.sourcePath) : path.join(fixtureDir, name);
};
const readTemplate = name => fs.readFileSync(templatePath(name), 'utf8');
const isSnapshot = fixture => !externalDir || !fixture.sourcePath;
// Exercise the editable source, so template validation never depends on a
// previously generated main.js or writes build output.
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
const obsidian = {
  Plugin: class {}, Modal: class {}, Notice: class {},
  MarkdownRenderer: {}, MarkdownView: class {},
  finishRenderMath: () => Promise.resolve(),
  renderMath: () => { throw new Error('Template tests do not emulate MathJax layout'); },
};
const ctx = {
  module: {exports: {}}, require: name => name === 'obsidian' ? obsidian : require(name),
  console, Buffer,
};
vm.runInNewContext(source + '\n;globalThis.templateApi = {mwbHandoutQuestionPlan,handoutPlan,mwbTypedSlots,mwbCalloutDocument,mwbValidateTypedAnswers,collectExamItems};', ctx);
const api = ctx.templateApi;

// An intentional, ordinary highlight may be added here after review. Answer
// examples must use typed slots; accepting every highlight would miss migration.
const ordinaryHighlights = new Map();
const studentForbiddenAnswers = new Map([
  ['讲义【通用模板】.md', ['答案1', '答案2', '答案3']],
  ['考前复习讲义【示例】.md', ['3+4\\sqrt{2}']],
  ['题库/多选题【模板】.md', ['ACD']],
  ['试卷【模板】.md', ['ABC', 'x=3', '最小值 $-4$']],
  ['题库/解答题【模板】.md', ['y=-2x+1', 'y=-5']],
]);

for (const fixture of handouts) {
  test('template question boundaries: ' + fixture.name, () => {
    const markdown = readTemplate(fixture.name);
    const plan = api.mwbHandoutQuestionPlan(markdown);
    // Snapshot counts detect lost fixture blocks. A live template may grow;
    // its actual top-level H5 headings define the current content boundaries.
    const expected = isSnapshot(fixture) ? fixture.questions : markdown.split(/\r?\n/).filter(line => /^#####\s+/.test(line)).length;
    assert.ok(expected > 0, 'handout needs explicit H5 content blocks');
    assert.equal(plan.groups.length, expected);
    assert.deepEqual(Array.from(plan.warnings), []);
    assert.deepEqual(Array.from(plan.errors), []);
    for (const group of plan.groups) assert.ok(group.end > group.start + 1);
  });
}

for (const fixture of materialTemplates) {
  test('template student/teacher answer contract: ' + fixture.name, () => {
    const markdown = readTemplate(fixture.name);
    assert.deepEqual(Array.from(api.mwbValidateTypedAnswers(markdown)), []);
    const highlights = Array.from(markdown.matchAll(/==[^=\n]+==/g), m => m[0]);
    assert.deepEqual(highlights, ordinaryHighlights.get(fixture.name) || []);
    const actualStudent = api.handoutPlan(markdown, 'student').markdown;
    for (const answer of studentForbiddenAnswers.get(fixture.name) || []) {
      assert.ok(!actualStudent.includes(answer), 'student output retained answer: ' + answer);
    }

    // Token offsets refer to the parser's normalized LF text. Keep the raw
    // input above for projection checks, but inject canaries at matching offsets.
    let marked = markdown.replace(/\r\n?/g, '\n');
    const slots = Array.from(api.mwbTypedSlots(marked));
    if (isSnapshot(fixture)) assert.equal(slots.length, fixture.slots, 'unexpected typed answer count');
    else assert.ok(slots.length > 0 || fixture.group === 'solution', 'objective examples must retain their typed answers');
    const secrets = slots.map((_, i) => 'TEMPLATE_SLOT_SECRET_' + i);
    for (let i = slots.length - 1; i >= 0; i--) {
      const slot = slots[i], marker = slot.kind === 'choice' ? '!' : '?';
      marked = marked.slice(0, slot.from) + marker + '{' + secrets[i] + '}' + marked.slice(slot.to);
    }

    const blocks = Array.from(api.mwbCalloutDocument(marked).blocks);
    const teacherBlocks = blocks.filter(block => block.teacherOnly);
    assert.ok(teacherBlocks.length > 0, 'template needs a teacher answer or method');
    for (const block of teacherBlocks) {
      assert.ok(['answer', 'solution'].includes(block.type), 'teacher examples use answer/solution');
    }
    const rows = marked.split(/\r?\n/);
    for (let i = teacherBlocks.length - 1; i >= 0; i--) {
      const block = teacherBlocks[i], secret = 'TEMPLATE_CALLOUT_SECRET_' + i;
      secrets.push(secret);
      rows.splice(block.start + 1, 0, '> '.repeat(block.depth) + secret);
    }
    marked = rows.join('\n');

    for (const solutionSpaces of [false, true]) {
      const student = api.handoutPlan(marked, 'student', {solutionSpaces}).markdown;
      for (const secret of secrets) assert.ok(!student.includes(secret), 'student output leaked ' + secret);
      assert.doesNotMatch(student, /[?!]\{TEMPLATE_/);
    }
    const teacher = api.handoutPlan(marked, 'teacher').markdown;
    for (const secret of secrets) assert.ok(teacher.includes(secret), 'teacher output lost ' + secret);
  });
}

for (const fixture of cards) {
  test('template metadata and knowledge grouping: ' + fixture.name, () => {
    const markdown = readTemplate(fixture.name);
    const frontmatter = markdown.split(/\r?\n---(?:\r?\n|$)/)[0];
    const fields = new Set(Array.from(frontmatter.matchAll(/^([A-Za-z_][\w-]*):/gm), match => match[1]));
    assert.deepEqual([...fields].sort(), ['type','id','subject','question_type','difficulty','teaching_tier','source','role','knowledge_nodes','family_id','methods'].sort());
    assert.match(frontmatter, /^type: ["']?题卡["']?$/m);
    assert.match(frontmatter, new RegExp('^id: [\"\']?' + fixture.id + '[\"\']?$', 'm'));
    assert.match(frontmatter, new RegExp('^question_type: ' + fixture.type + '$', 'm'));
    assert.doesNotMatch(frontmatter, /^(?:level|知识点|来源):/m);

    // Pass no metadata object: this exercises the actual offline YAML fallback.
    // Unknown IDs/role must remain missing, not become fabricated string values.
    const result = api.collectExamItems([{file: {path: fixture.name}, markdown}], {groupBy: 'knowledge_nodes'});
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].group, fixture.group);
    assert.deepEqual(Array.from(result.items[0].knowledgeNodes), fixture.nodes || (fixture.node ? [fixture.node] : []));
    const missing = fixture.roleKnown ? [] : ['role'];
    if (fixture.unclassified) missing.push('teaching_tier', 'difficulty', 'source');
    assert.deepEqual(Array.from(result.items[0].metadataAudit.missing), missing);
    assert.deepEqual(Array.from(result.items[0].metadataAudit.warnings), []);
    assert.equal(result.sections[0].id, fixture.nodes?.[0] || fixture.node || '__unknown__');

    const answerBlocks = Array.from(api.mwbCalloutDocument(markdown).blocks).filter(block => block.type === 'answer');
    assert.equal(answerBlocks.length > 0, fixture.group === 'solution', 'objective cards use slots and solution only');
    if (fixture.unclassified) {
      assert.match(frontmatter, /^source: null$/m);
      assert.match(frontmatter, /^difficulty: null$/m);
      assert.match(frontmatter, /^teaching_tier: null$/m);
    }
  });
}

test('template corrected mathematical examples retain their intended answers', () => {
  const fill = readTemplate('填空题【模板】.md');
  assert.deepEqual(Array.from(api.mwbTypedSlots(fill), slot => slot.raw), ['$1$', '$0$']);
  const choice = readTemplate('题库/多选题【模板】.md');
  assert.deepEqual(Array.from(api.mwbTypedSlots(choice), slot => slot.raw), ['ACD']);
  const constructed = readTemplate('题库/解答题【模板】.md');
  assert.match(constructed, /横坐标为 \$2\$ 的点处的切线平行于 \$x\$ 轴/);
  assert.match(constructed, /y=-2x\+1/);
  assert.match(constructed, /y=-5/);
  assert.doesNotMatch(constructed, /在区间 \$\[-1, 2\]\$ 上单调递减/);
  assert.doesNotMatch(constructed, /当 \$x > 1\$ 时，导数值大于零/);
});

test('template documents do not become cards during folder assembly', () => {
  const records = materialTemplates.map(fixture => ({file: {path: fixture.name}, markdown: readTemplate(fixture.name)}));
  const result = api.collectExamItems(records);
  assert.deepEqual(Array.from(result.items, item => item.file.path).sort(), cards.map(fixture => fixture.name).sort());
});

test('versioned template inventory, source contracts and local documentation links remain complete', () => {
  assert.equal(manifest.version, 1);
  const walk = (directory, prefix = '') => fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? walk(path.join(directory, entry.name), name + '/') : [name];
  });
  assert.deepEqual(walk(fixtureDir).sort(), ['README.md','manifest.json',...materialTemplates.map(fixture => fixture.name)].sort());
  assert.equal(new Set(materialTemplates.map(fixture => fs.realpathSync(templatePath(fixture.name)))).size, materialTemplates.length, 'duplicate template pointer');
  for (const fixture of materialTemplates) {
    const bytes = fs.readFileSync(path.join(fixtureDir, fixture.name));
    // Git autocrlf may change working-tree line endings on Windows; it must
    // not turn an unchanged teaching example into a different fixture.
    assert.equal(crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex'), fixture.fixtureSha256, 'unreviewed fixture change: ' + fixture.name);
    if (fixture.sourcePath) assert.match(fixture.sourceSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(bytes.toString('utf8'), /(?:\/Users\/|[A-Z]:\\Users\\)/, 'fixture contains a private local path');
  }
  const directories = externalDir ? [fixtureDir, externalDir] : [fixtureDir];
  for (const directory of directories) {
    const readme = fs.readFileSync(path.join(directory, 'README.md'), 'utf8');
    for (const fixture of materialTemplates.filter(item => directory === fixtureDir || item.sourcePath))
      assert.ok(readme.includes('](' + fixture.name + ')'), 'unlisted template: ' + fixture.name);
    const links = Array.from(readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g), match => match[1]);
    assert.ok(links.some(target => /(?:^|\/)docs\/MARKDOWN_SPEC\.md(?:#|$)/.test(target)), 'must link to the authoritative writing spec');
    for (const href of links) {
      if (/^(?:[a-z]+:|#)/i.test(href)) continue;
      const target = decodeURIComponent(href.split('#')[0]);
      assert.ok(fs.existsSync(path.resolve(directory, target)), 'README.md: broken link ' + target);
    }
  }
});
