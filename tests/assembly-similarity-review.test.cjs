'use strict';
// Independent review regressions: old Markdown headings and reference images
// must not supply answer text or asset filenames to retrieval features.
const test=require('node:test'),assert=require('node:assert/strict');
const {extractStem}=require('../src/assembly-similarity-text.cjs');

test('legacy combined answer headings cannot leak solutions into retrieval text',()=>{
  for(const heading of ['答案与解析','答案解析','参考答案及解析']) {
    const source='## 题目\n第一题干 $x<0$。\n## '+heading+'\nSECRET_ANSWER 由韦达定理得解。\n### 详细步骤\nSECRET_STEPS\n## 下一题\n第二题干 $y>1$。';
    const result=extractStem(source);
    assert(!result.text.includes('SECRET'),heading);
    assert(!result.text.includes('韦达'),heading);
    assert.match(result.text,/x<0/);assert.match(result.text,/y>1/);
  }
});

test('reference-style image definitions are not treated as mathematical retrieval evidence',()=>{
  const source='如图，证明 $x>0$。 ![示意图][diagram]\n\n[diagram]: assets/SECRET_ANSWER_42.png "SECRET_CAPTION"\n\n另求 $y<1$。';
  const result=extractStem(source);
  assert.equal(result.hasVisual,true);assert(!result.text.includes('SECRET'));assert(!result.text.includes('assets/'));
  assert.match(result.text,/x>0/);assert.match(result.text,/y<1/);
});
