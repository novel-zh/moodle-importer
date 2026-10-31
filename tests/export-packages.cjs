const fs=require('fs'),vm=require('vm'),assert=require('assert');
const saved=[];
function file(name,size){return {getName:()=>name,getSize:()=>size,getBlob:()=>({name,setName(n){this.name=n;return this;}})};}
const files=[file('a.xml',22*1024*1024),file('b.xml',22*1024*1024),file('c.xml',1000)];
function it(list){let i=0;return {hasNext:()=>i<list.length,next:()=>list[i++]};}
const folder={getFiles:()=>it(files),getFilesByName:()=>it([{}]),createFolder:()=>({
  createFile:b=>{saved.push(b);return {getUrl:()=>b.name};},getUrl:()=>'/packages'
})};
const ctx=vm.createContext({console,LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'folder'})},DriveApp:{getFolderById:()=>folder},
 Utilities:{zip:(blobs,name)=>({name,entries:blobs.map(b=>b.name)})}});
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'../exporter/GoogleFormsToMoodle.gs'),'utf8'),ctx);
vm.runInContext('buildMoodlePackages()',ctx);
assert.equal(saved.length,2); assert.deepEqual(saved[0].entries,['a.xml']);assert.deepEqual(saved[1].entries,['b.xml','c.xml']);
saved.length=0;files.splice(0,files.length,...Array.from({length:101},(_,i)=>file(String(i).padStart(2,'0')+'.xml',10)));
vm.runInContext('buildMoodlePackages()',ctx);
assert.equal(saved.length,2);assert.equal(saved[0].entries.length,100);assert.equal(saved[1].entries.length,1);
files.splice(0,files.length,file('too-big.xml',26*1024*1024));
assert.throws(()=>vm.runInContext('buildMoodlePackages()',ctx),/25 МБ/);
console.log('PASS: ZIP splitting by size/count and rejection of oversized XML (Apps Script services mocked).');
