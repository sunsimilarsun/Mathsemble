'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
// Templates live in the user's Markdown content library. An explicit path also
// permits a separate checkout without copying a second editable template set.
if (!process.env.MATHSEMBLE_TEMPLATE_DIR) {
  throw new Error('External template acceptance requires MATHSEMBLE_TEMPLATE_DIR; use npm run test:templates. Core fixtures are tested by npm test.');
}
const templateDir = path.resolve(process.env.MATHSEMBLE_TEMPLATE_DIR);
const readTemplate = name => fs.readFileSync(path.join(templateDir, name), 'utf8');
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

const handouts = [
  {name: '讲义【最小示例】.md', questions: 6, slots: 3},
  {name: '讲义【通用模板】.md', questions: 10, slots: 11},
  {name: '考前复习讲义【示例】.md', questions: 8, slots: 27},
  {name: '试卷【模板】.md', questions: 5, slots: 6},
];
const cards = [
  {name: '单选题【模板】.md', id: 'TEMPLATE-CHOICE-001', type: 'choice', group: 'single', slots: 1, unclassified: true},
  {name: '多选题【模板】.md', id: 'MATH-20261019-003', type: 'multiple_choice', group: 'multiple', node: '[[函数的极值与最值]]', slots: 1},
  {name: '填空题【模板】.md', id: 'MATH-20261019-002', type: 'fill_blank', group: 'fill', node: '[[切线问题]]', slots: 2},
  {name: '判断题【模板】.md', id: 'TEMPLATE-JUDGMENT-001', type: 'true_false', group: 'judgment', slots: 2, unclassified: true},
  {name: '解答题【模板】.md', id: 'MATH-20261019-001', type: 'short_answer', group: 'solution', node: '[[切线问题]]', slots: 0},
];
const materialTemplates = [...handouts, ...cards];
// An intentional, ordinary highlight may be added here after review. Answer
// examples must use typed slots; accepting every highlight would miss migration.
const ordinaryHighlights = new Map();
const studentForbiddenAnswers = new Map([
  ['讲义【通用模板】.md', ['答案1', '答案2', '答案3']],
  ['考前复习讲义【示例】.md', ['3+4\\sqrt{2}']],
  ['多选题【模板】.md', ['ACD']],
  ['试卷【模板】.md', ['ABC', 'x=3', '最小值 $-4$']],
  ['解答题【模板】.md', ['y=-2x+1', 'y=-5']],
]);

for (const fixture of handouts) {
  test('template question boundaries: ' + fixture.name, () => {
    const plan = api.mwbHandoutQuestionPlan(readTemplate(fixture.name));
    assert.equal(plan.groups.length, fixture.questions);
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

    const slots = Array.from(api.mwbTypedSlots(markdown));
    assert.equal(slots.length, fixture.slots, 'unexpected typed answer count');
    const secrets = slots.map((_, i) => 'TEMPLATE_SLOT_SECRET_' + i);
    let marked = markdown;
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
    for (const field of ['id', 'object_type', 'question_type', 'difficulty', 'teaching_tier',
      'chapter_id', 'section_id', 'role', 'knowledge_nodes', 'family_id', 'parent_id',
      'question_group_id', 'methods', 'source', 'assets', 'needs_review']) {
      assert.ok(fields.has(field), 'missing metadata key: ' + field);
    }
    assert.match(frontmatter, new RegExp('^id: "' + fixture.id + '"$', 'm'));
    assert.match(frontmatter, new RegExp('^question_type: ' + fixture.type + '$', 'm'));
    assert.doesNotMatch(frontmatter, /^(?:type|level|知识点|来源):/m);
    assert.match(frontmatter, /替换示例 ID/);
    assert.match(frontmatter, /尚未独立核实/);

    // Pass no metadata object: this exercises the actual offline YAML fallback.
    // Unknown IDs/role must remain missing, not become fabricated string values.
    const result = api.collectExamItems([{file: {path: fixture.name}, markdown}], {groupBy: 'knowledge_nodes'});
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].group, fixture.group);
    assert.deepEqual(Array.from(result.items[0].knowledgeNodes), fixture.node ? [fixture.node] : []);
    const missing = ['chapter_id', 'section_id', 'role'];
    if (fixture.unclassified) missing.push('teaching_tier', 'difficulty', 'knowledge_nodes');
    assert.deepEqual(Array.from(result.items[0].metadataAudit.missing), missing);
    assert.deepEqual(Array.from(result.items[0].metadataAudit.warnings), []);
    assert.equal(result.sections[0].id, fixture.node || '__unknown__');

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
  const choice = readTemplate('多选题【模板】.md');
  assert.deepEqual(Array.from(api.mwbTypedSlots(choice), slot => slot.raw), ['ACD']);
  const constructed = readTemplate('解答题【模板】.md');
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

test('template list has no duplicate pointers and links to existing local files', () => {
  const readme = readTemplate('README.md');
  for (const fixture of materialTemplates) {
    assert.ok(readme.includes('](' + fixture.name + ')'), 'unlisted template: ' + fixture.name);
  }
  assert.deepEqual(fs.readdirSync(templateDir).sort(), ['README.md', ...materialTemplates.map(fixture => fixture.name)].sort());
  const instructions = ['README.md'];
  for (const name of instructions) {
    const text = readTemplate(name);
    const links = Array.from(text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g), match => match[1]);
    assert.ok(links.some(target => path.resolve(templateDir, target.split('#')[0]) === path.join(root, 'docs', 'MARKDOWN_SPEC.md')), 'must link to the authoritative writing spec');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      assert.ok(fs.existsSync(path.resolve(templateDir, target)), name + ': broken link ' + target);
    }
  }
});
