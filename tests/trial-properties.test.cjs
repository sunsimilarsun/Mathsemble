'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const obsidian = {Plugin:class {}, Modal:class {constructor(app){this.app=app;}}, Notice:class {},
  MarkdownRenderer:{}, MarkdownView:class {}, finishRenderMath:async()=>{}};
const context = {module:{exports:{}}, require:name=>name==='obsidian'?obsidian:require(name),
  Buffer, console, setTimeout, clearTimeout, performance, AbortController};
vm.runInNewContext(source + '\nglobalThis.api={PreviewModal,mwbTrialDetailsFromMetadata,mwbSourceMetadata};', context);
const {PreviewModal, mwbTrialDetailsFromMetadata:defaults, mwbSourceMetadata:metadata} = context.api;
const plain = value => JSON.parse(JSON.stringify(value));
const file = {path:'讲义.md',basename:'不能当课题的文件名',extension:'md'};
const note = fields => `---\n${fields}\n---\n讲义正文`;

test('trial teacher reads trimmed author values and defaults to 孙老师 when author is empty', () => {
  const modal = new PreviewModal({}, {}, file, '普通正文');
  assert.deepEqual(plain(modal.trialDetails), {teacher:'孙老师',student:'',time:'',subject:'',grade:'',title:'',objectives:''});
  assert.equal(defaults({teacher:'其他教师',教师:'其他教师'}).teacher, '孙老师');
  assert.equal(defaults({author:'  李老师 \n',teacher:'旧教师'}).teacher, '李老师');
  assert.equal(defaults({author:['  李老师 ', '', null, '  赵老师  ']}).teacher, '李老师、赵老师');
  for (const author of [undefined, null, '', ' \t\n', [], ['', '  ', null]]) {
    assert.equal(defaults({author,teacher:'旧教师',教师:'旧教师'}).teacher, '孙老师');
  }
});

test('trial header reads author, exact titile and multiline objectives from the source snapshot', () => {
  const markdown = note('subject: 高中数学\n年级: 高二\ntitile: 椭圆\nauthor:\n  - " 李老师 "\n  - 赵老师\n课题名称: 旧课题属性\n学生:\n  - 小甲\n  - 小乙\n上课时间: 周六 09:00\n教学目标:\n  - 判断焦点位置\n  - 求解标准方程\ntitle: 旧题目\ngrade: 高一');
  const modal = new PreviewModal({metadataCache:{getFileCache(){throw Error('Do not read stale cache');}}}, {}, file, markdown);
  assert.deepEqual(plain(modal.trialDetails), {teacher:'李老师、赵老师',student:'小甲、小乙',time:'周六 09:00',subject:'高中数学',grade:'高二',title:'椭圆',objectives:'判断焦点位置\n求解标准方程'});
  assert.equal(modal.sourceMetadata.subject, '高中数学', 'Chinese list must not be appended to the preceding English field');
  assert.equal(modal.markdown, markdown, 'property defaulting must not rewrite the source');
  assert.ok(Object.isFrozen(modal.sourceMetadata));
});

test('empty primary fields and 待补 stay blank instead of reviving stale aliases', () => {
  const details = defaults({年级:'待补',grade:'高一',titile:null,课题名称:'旧课题',title:'旧标题',subject:'',学科:'数学',
    教学目标:[],objectives:['旧目标'],学生:{name:'不可自动转换'},上课时间:false});
  for (const key of ['student','time','subject','grade','title','objectives']) assert.equal(details[key], '', key);
  assert.equal(defaults({教学目标:['',null,'待补','解释图象']}).objectives, '解释图象');
  for (const titile of [undefined, null, '', '  ', '待补']) {
    assert.equal(defaults({titile,课题名称:'旧课题',title:'旧标题'}).title, '', 'only exact titile supplies the course title');
  }
  assert.equal(defaults({课题名称:'旧课题',title:'旧标题',Titile:'错误大小写'}).title, '');
});

test('compatible property names are supported without inventing missing values', () => {
  assert.deepEqual(plain(defaults({student_name:'小明',class_time:'14:00',学科:'数学',grade:'高一',titile:'函数',learning_objectives:['识别图象','说明性质']})),
    {teacher:'孙老师',student:'小明',time:'14:00',subject:'数学',grade:'高一',title:'函数',objectives:'识别图象\n说明性质'});
  assert.equal(metadata(note('subject: 高中数学\n教学目标: []')).subject, '高中数学');
});

test('reading the latest source refreshes automatic fields and controls, preserving manual edits and explicit clearing', async () => {
  let latest = note('年级: 高一\ntitile: 旧课题\nauthor: 旧教师\nsubject: 高中数学\n学生: 小甲');
  const app = {vault:{read:async()=>latest,getAbstractFileByPath:p=>p===file.path?file:null}};
  const modal = new PreviewModal(app, {}, file, latest);
  modal.renderMode = async () => {};
  modal.trialInputs = new Map(Object.keys(modal.trialDetails).map(key=>[key,{value:modal.trialDetails[key]}]));
  modal.trialEditedFields.add('student'); modal.trialDetails.student=''; modal.trialInputs.get('student').value='';
  modal.trialEditedFields.add('subject'); modal.trialDetails.subject='手动学科'; modal.trialInputs.get('subject').value='手动学科';
  latest = note('年级: 高二\ntitile: 新课题\nauthor: 新教师\n课题名称: 不应读取的旧属性\nsubject: 数学\n学生: 小乙\n教学目标:\n  - 分析变化');
  assert.equal(await modal.reloadSource(), true);
  assert.equal(modal.trialDetails.title, '新课题');
  assert.equal(modal.trialDetails.teacher, '新教师');
  assert.equal(modal.trialDetails.grade, '高二');
  assert.equal(modal.trialDetails.objectives, '分析变化');
  assert.equal(modal.trialDetails.student, '');
  assert.equal(modal.trialDetails.subject, '手动学科');
  assert.equal(modal.trialInputs.get('title').value, '新课题');
  assert.equal(modal.trialInputs.get('teacher').value, '新教师');
  modal.trialEditedFields.add('teacher'); modal.trialDetails.teacher='手动教师'; modal.trialInputs.get('teacher').value='手动教师';
  modal.trialEditedFields.add('title'); modal.trialDetails.title=''; modal.trialInputs.get('title').value='';
  latest = note('年级: 高三\ntitile: 再次更新的课题\nauthor: 另一教师\nsubject: 数学');
  assert.equal(await modal.reloadSource(), true);
  assert.equal(modal.trialDetails.teacher, '手动教师');
  assert.equal(modal.trialDetails.title, '');
  assert.equal(modal.trialInputs.get('teacher').value, '手动教师');
  assert.equal(modal.trialInputs.get('title').value, '');
  assert.equal(modal.trialDetails.grade, '高三');
  const before = plain(modal.trialDetails);
  latest = '---\ntitile: 损坏的属性';
  assert.equal(await modal.reloadSource(), false);
  assert.deepEqual(plain(modal.trialDetails), before, 'a failed read must keep the previous header snapshot');
});

test('a folder exam has no document properties and does not borrow the first question card metadata', () => {
  const markdown = note('subject: 高中数学\ntitile: 某题\nauthor: 某教师\n课题名称: 旧字段\n学生: 某学生');
  const modal = new PreviewModal({}, {}, file, markdown, {title:'组卷',items:[{file,markdown}]});
  assert.equal(modal.trialDetails.teacher, '孙老师');
  for (const key of ['student','time','subject','grade','title','objectives']) assert.equal(modal.trialDetails[key], '');
});
