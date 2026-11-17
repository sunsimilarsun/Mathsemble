'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../src/assembly-core.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../src/plugin.js'),'utf8');
const obsidian={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:async()=>{}};
const context={module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name),console,Buffer};
vm.runInNewContext(source+'\nglobalThis.api={handoutPlan,transformQuestion,studentSpacePlan,mwbTeacherMeasurementPlan,mwbCalloutDocument};',context);
const api=context.api;
const options=(student=[],teacher=[])=>({studentBlankCallouts:student,teacherVisibleCallouts:teacher});

test('v1 plans receive detached v3 defaults without writing or borrowing old solution visibility',()=>{
  const original={schemaVersion:1,title:'旧方案',entries:[]},before=JSON.stringify(original);
  const first=core.validatePlan(original),second=core.validatePlan(original);
  assert.equal(first.schemaVersion,3);
  assert.deepEqual(first.output.solutionOptions,options());
  first.output.solutionOptions.studentBlankCallouts.push('hint');
  assert.deepEqual(second.output.solutionOptions,options());
  assert.equal(JSON.stringify(original),before);
});

test('every explicit legacy boolean combination migrates from v2 and survives v3 JSON round trips',()=>{
  for(const solutionSpaces of [false,true])for(const showSolution of [false,true]){
    const original={...core.createPlan('兼容方案'),schemaVersion:2};
    original.course={...original.course,title:'',teacher:'李老师'};
    original.output={...original.output,layout:'trial',mode:'teacher',solutionOptions:{solutionSpaces,showSolution}};
    const before=JSON.stringify(original),migrated=core.validatePlan(original);
    assert.equal(migrated.schemaVersion,3);
    assert.deepEqual(migrated.output.solutionOptions,options(solutionSpaces?['solution']:[],showSolution?['solution']:[]));
    assert.equal(migrated.course.title,'');assert.equal(migrated.course.teacher,'李老师');
    assert.equal(migrated.output.layout,'trial');assert.equal(migrated.output.mode,'teacher');
    assert.deepEqual(core.validatePlan(JSON.parse(JSON.stringify(migrated))),migrated);
    assert.equal(JSON.stringify(original),before);
  }
});

test('v3 custom Callout selections round-trip independently and reject malformed or executable lists',()=>{
  const plan=core.createPlan();plan.output.solutionOptions=options(['solution','custom_hint'],['remark','note']);
  const restored=core.validatePlan(JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(restored,plan);
  restored.output.solutionOptions.studentBlankCallouts.push('scaffold');
  assert.deepEqual(plan.output.solutionOptions,options(['solution','custom_hint'],['remark','note']));
  let getterCalls=0;const getter=[];Object.defineProperty(getter,'0',{get(){getterCalls++;return 'hint';}});
  const extra=['hint'];Object.defineProperty(extra,'extra',{value:true});
  for(const invalid of ['hint',['answer'],['Hint'],['hint','hint'],['<script>'],[null],Array(1),Array(129).fill('hint'),getter,extra]){
    for(const key of ['studentBlankCallouts','teacherVisibleCallouts'])
      assert.throws(()=>core.validateOutputSettings({...plan.output,solutionOptions:{...options(),[key]:invalid}}));
  }
  assert.equal(getterCalls,0);
  assert.throws(()=>core.validateOutputSettings({...plan.output,solutionOptions:{...options(),showSolution:true}}));
});

test('all Callout types obey minus selections while plus and unmarked blocks remain shared',()=>{
  for(const type of ['answer','solution','scaffold','note','hint','custom_hint'])for(const marker of ['-','+','']){
    const markdown=`> [!${type}]${marker} 标题\n> CONTENT_${type}_${marker||'plain'}`;
    const secret=markdown.split('\n')[1].slice(2),before=markdown;
    const selected=options(type==='answer'?[]:[type],type==='answer'?[]:[type]);
    for(const config of [options(),selected,{solutionSpaces:false,showSolution:false}]){
      const student=api.studentSpacePlan(markdown,config),teacher=api.handoutPlan(markdown,'teacher',config);
      const shared=marker!=='-';
      assert.equal(student.markdown.includes(secret),shared,`${type}${marker} student`);
      const chosen=config===selected||type==='answer';
      assert.equal(teacher.markdown.includes(secret),shared||chosen,`${type}${marker} teacher`);
      assert.equal(student.count,!shared&&chosen?1:0,`${type}${marker} writing space`);
      assert.equal(api.transformQuestion(markdown,'student',config).includes(secret),shared);
      assert.equal(api.handoutPlan(markdown,'document',config).markdown,markdown);
    }
    assert.equal(markdown,before);
  }
});

test('new explicit lists override legacy booleans and answer minus stays fixed',()=>{
  const markdown='> [!answer]- 答案\n> ANSWER_SECRET\n\n> [!solution]- 解析\n> SOLUTION_SECRET';
  const config={...options(),solutionSpaces:true,showSolution:true};
  assert.equal(api.studentSpacePlan(markdown,config).count,1);
  const teacher=api.handoutPlan(markdown,'teacher',config).markdown;
  assert.match(teacher,/ANSWER_SECRET/);assert.doesNotMatch(teacher,/SOLUTION_SECRET/);
  assert.equal(api.studentSpacePlan(markdown,{solutionSpaces:true}).count,2);
  assert.match(api.handoutPlan(markdown,'teacher',{showSolution:true}).markdown,/SOLUTION_SECRET/);
});

test('hidden minus ancestors suppress descendants and selected outer blanks count the complete subtree once',()=>{
  const markdown='> [!scaffold]- 外层\n> OUTER_SECRET\n> > [!answer]- 答案\n> > ANSWER_SECRET\n> > > [!solution]- 解析\n> > > SOLUTION_SECRET';
  for(const studentTypes of [[],['solution'],['scaffold'],['scaffold','solution']]){
    const config=options(studentTypes,[]),student=api.studentSpacePlan(markdown,config),measurement=api.mwbTeacherMeasurementPlan(markdown,config);
    const outer=studentTypes.includes('scaffold');
    assert.doesNotMatch(student.markdown,/SECRET/);assert.equal(student.count,outer?1:0);
    assert.equal(measurement.targets.length,student.count);
    if(outer){for(const secret of ['OUTER_SECRET','ANSWER_SECRET','SOLUTION_SECRET'])assert.ok(measurement.markdown.includes(secret));}
    else assert.doesNotMatch(measurement.markdown,/SECRET/);
  }
  assert.doesNotMatch(api.handoutPlan(markdown,'teacher',options([],['solution'])).markdown,/SECRET/);
  const shown=api.handoutPlan(markdown,'teacher',options([],['scaffold'])).markdown;
  assert.match(shown,/OUTER_SECRET/);assert.match(shown,/ANSWER_SECRET/);assert.doesNotMatch(shown,/SOLUTION_SECRET/);
});

test('shared parents preserve their content while nested answer blanks keep source identity and full measurement',()=>{
  for(const marker of ['+','']){
    const markdown=`> [!note]${marker} 公共\n> SHARED_TEXT\n> > [!answer]- 答案\n> > ANSWER_SECRET\n> > > [!solution]- 补充\n> > > SOLUTION_SECRET`;
    const student=api.studentSpacePlan(markdown),measurement=api.mwbTeacherMeasurementPlan(markdown);
    assert.match(student.markdown,/SHARED_TEXT/);assert.doesNotMatch(student.markdown,/SECRET/);
    assert.equal(student.count,1);assert.equal(measurement.targets.length,1);
    assert.equal(student.targets[0].id,measurement.targets[0].id);
    assert.match(measurement.markdown,/ANSWER_SECRET/);assert.match(measurement.markdown,/SOLUTION_SECRET/);
    const teacher=api.handoutPlan(markdown,'teacher').markdown;
    assert.match(teacher,/ANSWER_SECRET/);assert.doesNotMatch(teacher,/SOLUTION_SECRET/);
  }
});
