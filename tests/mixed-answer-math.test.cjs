'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Test the actual source projections. Obsidian performs the Markdown/MathJax
// rendering; this suite checks the bytes delivered to those renderers without
// introducing a second Markdown or TeX parser into the test harness.
const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const obsidian = {Plugin:class {}, Modal:class {}, Notice:class {}, MarkdownRenderer:{}, MarkdownView:class {},
  finishRenderMath:async()=>{}, renderMath:()=>{throw Error('No host DOM in projection tests');}};
const context = {module:{exports:{}}, require:name=>name==='obsidian'?obsidian:require(name), console, Buffer};
vm.runInNewContext(source + '\nglobalThis.api={handoutPlan,transformQuestion,studentSpacePlan,mwbTeacherMeasurementPlan,mwbValidateTypedAnswers,answerSlots};',context);
const a=context.api;
const teacherOutputs = markdown => [
  ['handout', a.handoutPlan(markdown,'teacher').markdown],
  ['question', a.transformQuestion(markdown,'teacher')],
  ['measurement', a.mwbTeacherMeasurementPlan(markdown).markdown],
];
const studentOutputs = markdown => [a.handoutPlan(markdown,'student').markdown,
  a.transformQuestion(markdown,'student'),a.studentSpacePlan(markdown).markdown];

test('mixed inequality answers reach all teacher projections as valid TeX instead of HTML entities', () => {
  const answer=String.raw`$0<t<10$ 且 $t\ne5$`;
  for(const marker of ['?','!']) {
    const markdown=`取值范围 ${marker}{${answer}}。`;
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)),[]);
    assert.equal(a.answerSlots(markdown).length,1);
    for(const [name,output] of teacherOutputs(markdown)) {
      assert.ok(output.includes('$0<t<10$'),name+': inequality was HTML-escaped inside math');
      assert.ok(output.includes(String.raw`$t\ne5$`),name+': second formula changed');
      assert.match(output,/且/);
      assert.doesNotMatch(output,/&(?:lt|gt|amp);/);
      assert.doesNotMatch(output,/[?!]\{/);
    }
  }
});

test('escaped TeX ampersands and array alignment survive mixed-answer serialization', () => {
  const formulas=[String.raw`$A\&B$`,String.raw`$\begin{array}{cc}a&b\\c&d\end{array}$`];
  for(const formula of formulas) {
    for(const [name,output] of teacherOutputs(`答案 ?{说明 ${formula}，另一式 $x<3$}。`)) {
      assert.ok(output.includes(formula),name+': TeX ampersand or row separator changed');
      assert.ok(output.includes('$x<3$'),name+': following formula changed');
      assert.doesNotMatch(output,/&amp;|&lt;/);
    }
  }
});

test('plain answer text remains HTML-escaped around intact inline mathematics', () => {
  const payload='<img src=x onerror="evil()"> & <b>说明</b>';
  for(const marker of ['?','!']) {
    for(const answer of [payload,`${payload} $x<5$`]) {
      for(const [name,output] of teacherOutputs(`结果 ${marker}{${answer}}。`)) {
        assert.ok(output.includes('&lt;img src=x onerror=&quot;evil()&quot;&gt;'),name);
        assert.ok(output.includes('&amp; &lt;b&gt;说明&lt;/b&gt;'),name);
        assert.doesNotMatch(output,/<img|<b>|<\/b>/);
        if(answer.endsWith('$x<5$'))assert.ok(output.includes('$x<5$'),name);
      }
    }
  }
});

test('escaped and unmatched dollars do not create mathematical escape exemptions', () => {
  const examples=[
    [String.raw`价格 \$5 & 税 <6`,String.raw`价格 \$5 &amp; 税 &lt;6`],
    [String.raw`尚未闭合 $x<5 & text`,String.raw`尚未闭合 $x&lt;5 &amp; text`],
    [String.raw`文本 \$x<5\$ & 尾`,String.raw`文本 \$x&lt;5\$ &amp; 尾`],
    [String.raw`首式 $x<5$，尾部 $y>2 & text`,String.raw`首式 $x<5$，尾部 $y&gt;2 &amp; text`],
  ];
  for(const [answer,expected] of examples)for(const [name,output] of teacherOutputs(`填写 ?{${answer}}。`))
    assert.ok(output.includes(expected),name+': unmatched/escaped dollar altered context: '+output);
});

test('dollar delimiters follow the host whitespace and trailing-digit rules', () => {
  for(const answer of ['前缀 $ x<5$ 后缀','前缀 $x<5 $ 后缀','前缀 $x<5$2 后缀']) {
    for(const [name,output] of teacherOutputs(`填写 ?{${answer}}。`)) {
      assert.ok(output.includes('x&lt;5'),name+': an invalid inline delimiter exempted text from HTML escaping');
      assert.ok(!output.includes('x<5'),name);
    }
  }
  for(const [name,output] of teacherOutputs('填写 ?{前缀 $$x<5$$，以及 $y>2$}。')) {
    assert.ok(output.includes('$$x<5$$'),name);
    assert.ok(output.includes('$y>2$'),name);
    assert.doesNotMatch(output,/&lt;|&gt;/);
  }
});

test('dollars inside code and HTML attributes stay escaped text next to a real formula', () => {
  const examples=[
    ['代码 `$x<5$ & test`，以及 $y>2$','代码 `$x&lt;5$ &amp; test`'],
    ['<span title="$x<5$ & info">文字</span>，以及 $y>2$','&lt;span title=&quot;$x&lt;5$ &amp; info&quot;&gt;文字&lt;/span&gt;'],
  ];
  for(const [answer,expected] of examples)for(const [name,output] of teacherOutputs(`填写 ?{${answer}}。`)) {
    assert.ok(output.includes(expected),name+': literal dollars changed the math context');
    assert.ok(output.includes('$y>2$'),name+': the real trailing formula was escaped');
    assert.doesNotMatch(output,/<span title=/);
  }
});

test('mixed answers remain entirely absent from student projections and writing placeholders', () => {
  const answers=[String.raw`$0<t<10$ 且 $t\ne5$`,String.raw`SECRET_WORD $\begin{array}{cc}a&b\\c&d\end{array}$`,
    String.raw`SECRET_WORD \$5 & <b>private</b>`];
  for(const answer of answers)for(const marker of ['?','!']) {
    const markdown=`可见题干 ${marker}{${answer}}。`;
    for(const output of studentOutputs(markdown)) {
      assert.match(output,/可见题干/);
      assert.doesNotMatch(output,/0<t|0&lt;t|t\\ne5|SECRET_WORD|begin\{array\}|private|<b>|\\\$5/);
      assert.match(output,marker==='?'?/mwb-answer-slot/:/mwb-choice-slot/);
      assert.doesNotMatch(output,/data-answer|title=/);
    }
  }
});

test('pure math answers keep existing underline and color behavior in all teacher paths', () => {
  const markdown=String.raw`单个公式 ?{$0<t<10$}；公式内 $x=?{\frac12}$；选项 !{$A\&B$}。`;
  for(const [name,output] of teacherOutputs(markdown)) {
    assert.ok(output.includes(String.raw`$\underline{\color{red}{0<t<10}}$`),name);
    assert.ok(output.includes(String.raw`$x=\underline{\color{red}{\frac12}}$`),name);
    assert.ok(output.includes(String.raw`$\color{red}{A\&B}$`),name);
    assert.doesNotMatch(output,/&lt;|&amp;/);
  }
  assert.equal(a.handoutPlan(markdown,'document').markdown,markdown);
});

test('teacher measurement retains callout identities and valid mixed formula bytes while students hide answer steps', () => {
  const markdown=String.raw`##### 例1
取值范围 ?{$0<t<10$ 且 $t\ne5$}。

> [!answer]- 标准答案
> SECRET_STEPS：得到 ?{$u<2$ 且 $u\ne1$}。

> [!solution]- 补充说明
> SECRET_SOLUTION：得到 ?{说明 $v>3$}。`;
  for(const solutionSpaces of [false,true]) {
    const student=a.handoutPlan(markdown,'student',{solutionSpaces});
    const measurement=a.mwbTeacherMeasurementPlan(markdown,{solutionSpaces});
    assert.equal(measurement.targets.length,solutionSpaces?2:1);
    assert.deepEqual(Array.from(measurement.targets,target=>target.id),Array.from(student.targets,target=>target.id));
    assert.ok(measurement.markdown.includes('$0<t<10$'));
    assert.ok(measurement.markdown.includes('$u<2$'));
    assert.doesNotMatch(measurement.markdown,/&lt;|&gt;|&amp;/);
    assert.doesNotMatch(student.markdown,/SECRET_|u<2|u&lt;2|t\\ne5/);
    if(solutionSpaces)assert.ok(measurement.markdown.includes('$v>3$'));
    else assert.doesNotMatch(measurement.markdown,/SECRET_SOLUTION|v>3/);
  }
});
