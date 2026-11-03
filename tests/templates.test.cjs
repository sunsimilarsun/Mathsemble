'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {loadApi,root}=require('./helpers/audit-api.cjs');
const api=loadApi();
// Fixed core fixtures deliberately do not mirror the user's editable library.
const directory=path.join(__dirname,'fixtures/templates');
const handout=fs.readFileSync(path.join(directory,'handout-core.md'),'utf8');
const card=fs.readFileSync(path.join(directory,'card-core.md'),'utf8');
const secrets=['CORE_ANSWER_SECRET','CORE_SOLUTION_SECRET','CORE_VARIANT_SECRET','CORE_PRACTICE_SECRET'];
test('A1 committed core fixture has three strict H5 groups with ordinary subquestions',()=>{
  const plan=api.mwbHandoutQuestionPlan(handout);
  assert.equal(plan.groups.length,3);
  assert.equal(plan.errors.length,0);
  assert.equal(plan.warnings.length,0);
  assert.equal(api.mwbTypedSlots(handout).length,3);
});
for(const solutionSpaces of [false,true])test('A1 core student template hides all teacher answers; solutionSpaces='+solutionSpaces,()=>{
  const output=api.handoutPlan(handout,'student',{solutionSpaces});
  for(const secret of secrets)assert.ok(!output.markdown.includes(secret),secret+' leaked');
  assert.ok(output.markdown.includes('CORE_SHARED_CONTENT'));
  assert.ok(output.markdown.includes('?{CODE_LITERAL}'));
  assert.ok(output.markdown.includes('==重点=='));
  assert.ok(output.markdown.includes('（学生版）'));
  assert.equal(output.solutionCount,solutionSpaces?4:2);
});
test('A1 core teacher template retains answers and original mode remains unprojected',()=>{
  const teacher=api.handoutPlan(handout,'teacher').markdown;
  for(const secret of secrets)assert.ok(teacher.includes(secret));
  const original=api.handoutPlan(handout,'document').markdown;
  assert.ok(original.includes('?{4}') && original.includes('!{B}'));
});
test('A1 core card assembly excludes the handout and never fabricates unknown metadata',()=>{
  const result=api.collectExamItems([
    {file:{path:'handout.md'},markdown:handout},
    {file:{path:'card.md'},markdown:card},
  ],{groupBy:'knowledge_nodes'});
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].file.path,'card.md');
  assert.equal(result.sections[0].id,'__unknown__');
  assert.equal(result.items[0].teachingRole.label,'检测');
  assert.equal(result.items[0].metadataAudit.warnings.length,0);
  assert.ok(result.items[0].metadataAudit.missing.includes('difficulty'));
  assert.ok(!api.handoutPlan(card,'student').markdown.includes('CORE_CARD_SECRET'));
});
test('A1 core fixtures do not depend on an external path',()=>{
  assert.ok(fs.existsSync(directory));
  const old=process.env.MATHSEMBLE_TEMPLATE_DIR;
  try {
    process.env.MATHSEMBLE_TEMPLATE_DIR=path.join(root,'nonexistent-external-library');
    assert.equal(api.mwbHandoutQuestionPlan(fs.readFileSync(path.join(directory,'handout-core.md'),'utf8')).groups.length,3);
  } finally {
    if(old===undefined)delete process.env.MATHSEMBLE_TEMPLATE_DIR;else process.env.MATHSEMBLE_TEMPLATE_DIR=old;
  }
});
test('A1 external acceptance fails explicitly when not configured, never silently skips',()=>{
  const env={...process.env};delete env.MATHSEMBLE_TEMPLATE_DIR;
  const result=spawnSync(process.execPath,['scripts/test-templates.mjs'],{cwd:root,env,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/Set MATHSEMBLE_TEMPLATE_DIR/);
});
test('A1 external acceptance reports an invalid path before tests start',()=>{
  const result=spawnSync(process.execPath,['scripts/test-templates.mjs'],{cwd:root,
    env:{...process.env,MATHSEMBLE_TEMPLATE_DIR:path.join(root,'this-template-directory-does-not-exist')},encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/unavailable/);
});
