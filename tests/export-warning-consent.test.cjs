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
  console, Buffer, document: {},
};
vm.runInNewContext(source + '\n;globalThis.ReviewModal = PreviewModal;', context);

const imageWarning = '存在未加载或加载失败的图片';

function renderedQuestion(brokenImage = false) {
  return {
    brokenImage,
    textContent: 'Question text',
    getBoundingClientRect: () => ({ width: 100, left: 0, right: 100 }),
    querySelector: selector => selector.startsWith('p, li,') ? {} : null,
    querySelectorAll(selector) {
      return selector === 'img' && this.brokenImage
        ? [{ complete: true, naturalWidth: 0 }] : [];
    },
  };
}

function examModal() {
  const modal = Object.create(context.ReviewModal.prototype);
  const questions = [renderedQuestion(true), renderedQuestion(false)];
  const reachedExport = new Error('Reached HTML export resource preparation');
  let exportAttempts = 0;
  modal.ready = true;
  modal.mode = 'teacher';
  modal.solutionOptions = {};
  modal.exam = {
    items: questions.map((_, index) => ({
      markdown: 'Question text', file: { path: `question-${index + 1}.md` },
    })),
  };
  modal.rendered = {
    ...renderedQuestion(),
    querySelectorAll(selector) {
      if (selector === '.mwb-exam-question-content') return questions;
      if (selector === 'img') return questions.flatMap(question => question.querySelectorAll('img'));
      return [];
    },
    cloneNode() {
      exportAttempts++;
      // Exercise the real preflight and exportHtml call. Resource rendering
      // belongs to other tests; this sentinel marks reaching that boundary.
      throw reachedExport;
    },
  };
  modal.renderWarnings = [];
  modal.addRenderWarnings('整卷预览', [imageWarning]);
  modal.addRenderWarnings('整卷题卡/question-1.md', [imageWarning]);
  modal.partialExportApproved = true;
  modal.partialCheckbox = { checked: true };
  modal.partialWarning = { style: {} };
  modal.status = { setText() {} };
  return { modal, questions, reachedExport, exportAttempts: () => exportAttempts };
}

test('acknowledged exam warnings survive repeated preflight and reach export', async () => {
  const fixture = examModal();
  const initialWarnings = [...fixture.modal.renderWarnings];
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(fixture.modal.preparePrintHtml('Exam'), error => error === fixture.reachedExport);
    assert.equal(fixture.modal.partialExportApproved, true);
    assert.equal(fixture.modal.partialCheckbox.checked, true);
    assert.deepEqual(fixture.modal.renderWarnings, initialWarnings);
  }
  assert.equal(fixture.exportAttempts(), 2);
});

test('the same image warning in a new question requires fresh acknowledgement once', async () => {
  const fixture = examModal();
  fixture.questions[1].brokenImage = true;
  await assert.rejects(fixture.modal.preparePrintHtml('Exam'), /存在局部渲染失败/);
  assert.equal(fixture.modal.partialExportApproved, false);
  assert.equal(fixture.modal.partialCheckbox.checked, false);
  assert.equal(fixture.exportAttempts(), 0);
  assert.ok(fixture.modal.renderWarnings.includes('整卷题卡/question-2.md：' + imageWarning));
  const warningCount = fixture.modal.renderWarnings.length;

  fixture.modal.partialExportApproved = true;
  fixture.modal.partialCheckbox.checked = true;
  await assert.rejects(fixture.modal.preparePrintHtml('Exam'), error => error === fixture.reachedExport);
  assert.equal(fixture.modal.partialExportApproved, true);
  assert.equal(fixture.modal.renderWarnings.length, warningCount);
  assert.equal(fixture.exportAttempts(), 1);
});

test('warning deduplication retains different formula locations within one question', () => {
  const fixture = examModal();
  const first = '公式 #1 尺寸为零或尚未完成排版';
  const second = '公式 #2 尺寸为零或尚未完成排版';
  fixture.modal.addRenderWarnings('整卷题卡/question-1.md', [first, first, second]);
  assert.equal(fixture.modal.renderWarnings.filter(warning => warning.endsWith(first)).length, 1);
  assert.equal(fixture.modal.renderWarnings.filter(warning => warning.endsWith(second)).length, 1);
});

test('acknowledgement never bypasses a missing exam question', async () => {
  const fixture = examModal();
  fixture.questions.pop();
  await assert.rejects(fixture.modal.preparePrintHtml('Exam'), /组卷题数与预览节点数不匹配/);
  assert.equal(fixture.exportAttempts(), 0);
});

test('acknowledgement never bypasses an entirely missing mathematical render', async () => {
  const fixture = examModal();
  fixture.modal.exam.items[0].markdown = 'Question $x+1$';
  await assert.rejects(fixture.modal.preparePrintHtml('Exam'), /预览存在严重问题：包含数学公式，但尚未检测到渲染结果/);
  assert.equal(fixture.exportAttempts(), 0);
});
