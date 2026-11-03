'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
function loadApi(overrides = {}) {
  const obsidian = {
    Plugin: class {}, Modal: class { constructor(app) { this.app = app; } close() {} }, Notice: class {},
    MarkdownRenderer: {render: async () => {}}, MarkdownView: class {},
    finishRenderMath: async () => {},
    renderMath() { throw Error('No emulated MathJax geometry'); },
    ...overrides.obsidian,
  };
  const context = {
    module: {exports: {}}, require: name => name === 'obsidian' ? obsidian : require(name),
    console, Buffer, performance, setTimeout, clearTimeout, ...overrides.globals,
  };
  // Read the existing metadata module's export for agreement checks only.
  const instrumented = source.replace('const { META_FIELDS, MODE_DEFAULTS, addMetaBlock }',
    'const { META_FIELDS, MODE_DEFAULTS, addMetaBlock, formatMeta }');
  vm.runInNewContext(instrumented + `\n;globalThis.auditApi = {
    mwbMarkdownLines, mwbTypedSlots, mwbValidateTypedAnswers, mwbCalloutDocument,
    mwbHandoutQuestionPlan, handoutPlan, transformQuestion, studentSpacePlan,
    mwbHasRenderableMath, mwbBeforeDeadline, mwbRenderMarkdown,
    mwbCreateRenderOwner, mwbReleaseRenderOwner,
    issuesInRenderedNode, divideRenderIssues, waitForStableRender,
    RolePickerModal, PreviewModal, teachingRoleMetadata, teachingRoleSummary,
    metadataOf, metadataAudit, collectExamItems, formatMeta, TEACHING_ROLES,
    paginatePreviewDocument, injectSpaceNodes, auditSpaceGeometry,
    typographyCss
  };`, context, {filename: 'src/plugin.js'});
  return context.auditApi;
}
module.exports = {loadApi, root, source};
