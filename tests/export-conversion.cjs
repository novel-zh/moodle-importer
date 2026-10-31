const fs = require('fs'), vm = require('vm'), assert = require('assert');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const context = vm.createContext({
  UrlFetchApp:{fetch:()=>({getResponseCode:()=>200,getBlob:()=>({getContentType:()=>'image/png',getBytes:()=>Array.from(png)})})},
  Utilities:{base64Encode:bytes=>Buffer.from(bytes).toString('base64')}
});
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../exporter/GoogleFormsToMoodle.gs'), 'utf8'), context);
const choice = (type, answers, keys) => ({questionItem:{question:{grading:{pointValue:2,correctAnswers:{answers:keys.map(value=>({value}))}},choiceQuestion:{type,options:answers.map(value=>({value}))}}}});
const form = {info:{title:'Тест & <XML>',description:'Инструкция'},items:[
  {...choice('RADIO',['A & B','C'],['A & B']),title:'Один'},
  {...choice('CHECKBOX',['A','B','C'],['A','B']),title:'Несколько'},
  {...choice('RADIO',['A','B'],[]),title:'Без ключа'},
  {title:'Текст',questionItem:{question:{grading:{pointValue:3,correctAnswers:{answers:[{value:'x*y'}]}},textQuestion:{}}}},
  {title:'Эссе',questionItem:{question:{grading:{pointValue:4},textQuestion:{paragraph:true}}}},
  {title:'Сетка',questionGroupItem:{questions:[{},{}]}},
  {title:'ФИО',questionItem:{question:{textQuestion:{}}}}
]};
form.items.push({title:'13. ____ du Klavier spielen?',questionItem:{question:{choiceQuestion:{type:'RADIO',options:[{value:'Kann'},{value:'Kannst'},{value:'Können'}]}}}});
form.items.push({title:'19. Darf Nora mitgehen',questionItem:{question:{textQuestion:{}}}});
context.fixture=form;
const result=vm.runInContext("convert_(fixture, 'test-id')",context);
assert.equal(result.count,8); assert.equal(result.skipped,3);
assert(result.xml.includes('Kannst')); assert(result.xml.includes('19. Darf Nora'));
assert(result.xml.includes('fraction="50.0000000"'));
assert(result.xml.includes('fraction="-100.0000000"'));
assert(result.xml.includes('A &amp;amp; B'));
assert(result.xml.includes('x\\*y'));

console.log('PASS: single/multiple choice, short answer, essay, missing keys, grids, zero points, escaping.');
