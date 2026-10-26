'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const obsidian = {
  Plugin: class {}, Modal: class {}, Notice: class {},
  MarkdownRenderer: {}, MarkdownView: class {},
  finishRenderMath: () => Promise.resolve(),
};
const context = {
  module: { exports: {} },
  require: name => name === 'obsidian' ? obsidian : require(name),
  console, Buffer,
};
vm.runInNewContext(source + '\n;globalThis.metadataReview = { metadataOf, metadataAudit, teachingRoleMetadata };', context);
const { metadataOf, metadataAudit, teachingRoleMetadata } = context.metadataReview;
const fromFields = fields => metadataOf({ markdown: `---\n${fields}\n---\nQuestion text` });

test('fallback distinguishes absent keys, empty values and explicit YAML nulls', () => {
  const absent = fromFields('object_type: question');
  assert.equal(Object.hasOwn(absent, 'parent_id'), false);
  for (const value of ['', 'null', 'Null', 'NULL', '~', 'null # unknown relationship']) {
    const meta = fromFields(`parent_id: ${value}`);
    assert.equal(Object.hasOwn(meta, 'parent_id'), true, value);
    assert.equal(meta.parent_id, null, value);
  }
});

test('quoted null-like tokens remain literal strings', () => {
  for (const token of ['null', 'Null', 'NULL', '~']) {
    for (const quote of ['"', "'"]) {
      const meta = fromFields(`source: ${quote}${token}${quote}`);
      assert.equal(meta.source, token);
    }
  }
  assert.equal(fromFields('source: nUlL').source, 'nUlL');
  assert.equal(fromFields('source: null-result').source, 'null-result');
});

test('null required values are audited as missing without inventing metadata', () => {
  const required = ['id', 'chapter_id', 'section_id', 'question_type', 'role', 'teaching_tier', 'difficulty', 'knowledge_nodes'];
  const nullable = ['family_id', 'parent_id', 'question_group_id', 'methods', 'source', 'assets'];
  const fields = [...required, ...nullable].map(key => `${key}: null`).join('\n');
  const meta = fromFields(fields);
  const audit = metadataAudit(meta);
  assert.deepEqual(Array.from(audit.missing), required);
  assert.deepEqual(Object.keys(meta).sort(), [...required, ...nullable].sort());
  assert.ok(Object.values(meta).every(value => value === null));

  const absent = metadataAudit(fromFields('object_type: question'));
  for (const key of [...required, ...nullable]) assert.ok(absent.missing.includes(key), key);
});

test('a variant with a null parent remains an unresolved relationship', () => {
  const meta = fromFields('role: variant\nparent_id: null');
  assert.equal(meta.parent_id, null);
  assert.ok(metadataAudit(meta).warnings.includes('变式缺少 parent_id，需人工确认母题关系'));
  assert.equal(fromFields('parent_id: "null"').parent_id, 'null');
});

test('teaching roles treat unquoted YAML nulls as unknown and quoted tokens as invalid', () => {
  for (const field of ['role', 'teaching_role']) {
    for (const value of ['', 'null', 'Null', 'NULL', '~', 'null # unknown role']) {
      const role = teachingRoleMetadata(`---\n${field}: ${value}\n---\nQuestion text`);
      assert.equal(role.state, 'missing', field + ': ' + value);
      assert.equal(role.raw, '');
      assert.equal(role.role, null);
    }
    for (const value of ['"null"', "'null'", '"~"', "'~'"]) {
      const role = teachingRoleMetadata(`---\n${field}: ${value}\n---\nQuestion text`);
      assert.equal(role.state, 'invalid', field + ': ' + value);
      assert.notEqual(role.raw, '');
      assert.equal(role.role, null);
    }
  }
  const fallback = teachingRoleMetadata('---\nteaching_role: null\nrole: practice\n---');
  assert.equal(fallback.role, 'practice');
  assert.equal(fallback.state, 'valid');
});

test('host metadata remains authoritative over the narrow offline fallback', () => {
  const metadata = { id: 'host-id', parent_id: 'null', knowledge_nodes: ['K1'], difficulty: 2 };
  const record = { metadata, markdown: '---\nid: null\nparent_id: null\nknowledge_nodes: null\n---' };
  assert.equal(metadataOf(record), metadata);
  assert.equal(metadata.parent_id, 'null');
  assert.deepEqual(metadata.knowledge_nodes, ['K1']);
});
