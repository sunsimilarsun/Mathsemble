'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const blueprint=require('../src/assembly-blueprint.cjs').createBlueprintEngine({core});
const family=require('../src/assembly-family.cjs').createFamilyEngine({core});
function setup(){
  const md='<!-- mathsemble:stem -->\n共同条件\n<!-- mathsemble:end -->\n\n<!-- mathsemble:part one -->\n第一问\n<!-- mathsemble:end -->';
  const index=core.buildIndex(['A','B'].map(id=>({path:'题库/'+id+'.md',kind:'question',metadata:{id,family_id:'F',question_type:'choice'},markdown:md})));
  const base=core.addItem(core.createPlan(),index.items[0]),entry=base.entries[0];
  const plan=core.updateEntry(base,entry.entryId,{fragmentRef:{kind:'question-part',ids:['one'],scores:{one:5}}});
  const bp={schemaVersion:1,blueprintId:'parts',revision:1,title:'整题配额',rows:[{rowId:'choice',label:'选择',count:1,filters:{questionType:['choice']}}],constraints:{uniqueQuestion:true,maxPerFamily:1}};
  const lock={rowId:'choice',slotId:'choice:1',origin:'plan',existingEntryId:entry.entryId,sourceId:entry.sourceId,sourcePath:entry.sourcePath,sourceFingerprint:entry.sourceFingerprint};
  return {index,plan,bp,lock,entry};
}
test('selected parts cannot count as a whole-question quota or be replaced with another family member',()=>{
  const {index,plan,bp,lock,entry}=setup();
  const allocation=blueprint.prepareAllocation({index,plan,blueprint:bp,locks:[lock]});
  assert.notEqual(allocation.status,'ready');assert(allocation.issues.some(issue=>issue.code==='LOCK_PARTIAL_QUESTION'));
  const replacement=family.prepareReplacement({index,plan,entryId:entry.entryId});
  assert.equal(replacement.status,'conflict');assert.equal(replacement.issues[0].code,'FAMILY_FRAGMENT_SELECTED');
});
test('a partial source still consumes source identity and the global family limit',()=>{
  const {index,plan,bp}=setup();const prepared=blueprint.prepareAllocation({index,plan,blueprint:bp});
  assert.equal(prepared.status,'ready');assert(!prepared.problem.candidates.some(row=>row.id==='A'));
  assert.equal(blueprint.allocateQuestions(prepared.problem).status,'infeasible');
});
test('whole-question v4 scores survive family replacement and existing quota locking',()=>{
  const {index,plan:partial,bp,lock,entry}=setup();
  const plan=core.updateEntry(partial,entry.entryId,{fragmentRef:null,score:9.5});
  const prepared=blueprint.prepareAllocation({index,plan,blueprint:bp,locks:[lock]});assert.equal(prepared.status,'ready');
  assert.equal(blueprint.allocateQuestions(prepared.problem).status,'complete');
  const alternatives=family.prepareReplacement({index,plan,entryId:entry.entryId});assert.equal(alternatives.status,'ready');
  const replaced=family.applyReplacement({freshIndex:index,plan,entryId:entry.entryId,candidateKey:'id:B',expectedContext:alternatives.context});
  assert.equal(replaced.plan.schemaVersion,4);assert.equal(replaced.plan.entries[0].score,9.5);assert.equal(replaced.plan.entries[0].sourceId,'B');
});
