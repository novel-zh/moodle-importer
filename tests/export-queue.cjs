const fs=require('fs'),vm=require('vm'),assert=require('assert');
const files=new Map(), folders=new Map(), props=new Map(); let seq=0,triggers=[];
const iter=a=>{let i=0;return {hasNext:()=>i<a.length,next:()=>a[i++]};};
function file(name,content='') { const id='f'+(++seq); const f={getId:()=>id,getName:()=>name,getBlob:()=>({getDataAsString:()=>content}),setContent:c=>{content=c;},getUrl:()=>id};files.set(id,f);return f; }
function folder(id,name) { const contents=[];const f={getId:()=>id,getName:()=>name,getUrl:()=>id,getFilesByType:()=>iter(contents),getFilesByName:n=>iter(contents.filter(x=>x.getName()===n)),createFile:(n,c)=>{const x=file(n,c);contents.push(x);return x;},contents};folders.set(id,f);return f; }
const source=folder('source','Tests');for(let i=0;i<5;i++)source.contents.push(file('Form '+i));
const bad=source.contents[4].getId(); let fatal=false;
const ctx=vm.createContext({console:{log:()=>{},error:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock:()=>{},releaseLock:()=>{}})},DriveApp:{getFolderById:id=>folders.get(id),getFileById:id=>files.get(id),createFolder:n=>folder('out'+(++seq),n)},ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>{triggers=triggers.filter(x=>x!==t);},newTrigger:h=>({timeBased:()=>({everyMinutes:()=>({create:()=>{const t={getHandlerFunction:()=>h};triggers.push(t);return t;}})})})}});
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../exporter/GoogleFormsToMoodle.gs'),'utf8'),ctx);
ctx.mockRead=id=>{if(fatal)throw Error('HTTP 401');if(id===bad)throw Error('HTTP 404');return {info:{title:id},items:[{title:'Q',questionItem:{question:{grading:{pointValue:1,correctAnswers:{answers:[{value:'A'}]}},choiceQuestion:{type:'RADIO',options:[{value:'A'},{value:'B'}]}}}}]};};
vm.runInContext("CONFIG.SOURCE_FOLDER_ID='source';CONFIG.MAX_FORMS_PER_RUN=2;readForm_=mockRead;startFolderExport()",ctx);
const job=()=>JSON.parse(files.get(props.get('AUTO_JOB_ID')).getBlob().getDataAsString());
assert.equal(job().items.filter(x=>x.status==='done').length,2);assert.equal(triggers.length,1);
for(let i=0;i<5&&job().status==='running';i++)vm.runInContext('continueFolderExport()',ctx);
assert.equal(job().status,'complete');assert.equal(job().items.filter(x=>x.status==='done').length,4);
assert.equal(job().items[4].attempts,3);assert.equal(job().items[4].status,'error');assert.equal(triggers.length,0);
const output=folders.get(job().outputId);assert.equal(output.contents.filter(x=>x.getName().endsWith('.xml')).length,4);
vm.runInContext('resumeFolderExport()',ctx);assert.equal(output.contents.filter(x=>x.getName().endsWith('.xml')).length,4);
fatal=true;assert.throws(()=>vm.runInContext('finishAndStartNewFolderExport()',ctx),/401/);
assert.equal(job().status,'paused');assert.equal(triggers.length,0);assert.equal(job().items[0].attempts,0);
fatal=false;vm.runInContext('resumeFolderExport()',ctx);assert.equal(job().items.filter(x=>x.status==='done').length,2);
vm.runInContext('stopFolderExport()',ctx);assert.equal(job().status,'paused');assert.equal(triggers.length,0);
console.log('PASS: full folder, automatic batches, persistent progress, 3 error attempts, completion trigger cleanup, no duplicates, auth pause, resume and stop.');
