'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

function app() {
  const values = new Map(), elements = new Map();
  const element = () => ({value:'',textContent:'',hidden:false,disabled:false,files:[],handlers:{},classList:{add(){},remove(){}},addEventListener(name,handler){this.handlers[name]=handler;},reset(){},removeAttribute(name){delete this[name];},querySelectorAll(){return [];},replaceChildren(){},append(){},focus(){},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();}});
  const storage = {getItem(name){return values.get(name) ?? null;},setItem(name,value){values.set(name,value);}};
  const context = vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,Blob,URL,btoa,atob,setTimeout:()=>0,clearTimeout(){},localStorage:storage,window:{addEventListener(){},scrollTo(){}},document:{createElement:element,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll(){return [];},addEventListener(){}}});
  const script = fs.readFileSync(require.resolve('../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script,context);
  return {run:code=>vm.runInContext(code,context),storage,context,elements};
}
const record = {id:'5fe09385-c207-49e9-bc08-f09bfd949b86',medicine:'시험 처방',date:'2026-10-13',effect:'잘 들었어요',ingredients:'시험 성분',allergy:'없었어요',allergyReaction:'',hospital:'시험 병원',memo:'시험 메모'};
async function savedApp() {
  const instance = app(); instance.context.fixture = record;
  await instance.run("(async()=>{salt = crypto.getRandomValues(new Uint8Array(16)); key = await derive('TestOnly-Password',salt); entries = await parseRecords([fixture]); await persist(entries);})()");
  return instance;
}
test('encrypted saved records restore all fields using the original password',async()=> {
  const instance = await savedApp();
  const encrypted = instance.storage.getItem('my-medicine-note.v1');
  assert.equal(encrypted.includes(record.medicine),false);
  const restored = await instance.run("readVault(JSON.parse(localStorage.getItem(storageKey)),'TestOnly-Password')");
  assert.deepEqual(JSON.parse(JSON.stringify(restored.records[0])),record);
});
test('wrong password fails without changing the saved vault',async()=> {
  const instance = await savedApp(); const original = instance.storage.getItem('my-medicine-note.v1');
  await assert.rejects(instance.run("readVault(JSON.parse(localStorage.getItem(storageKey)),'Wrong-Password')"));
  assert.equal(instance.storage.getItem('my-medicine-note.v1'),original);
});
test('tampered ciphertext fails authentication',async()=> {
  const instance = await savedApp();
  await assert.rejects(instance.run("(async()=>{const blob=JSON.parse(localStorage.getItem(storageKey));const data=bytes(blob.data);data[0]^=1;blob.data=base64(data);return readVault(blob,'TestOnly-Password');})()"));
});
test('legacy identical records remain separate and get stable identities',async()=> {
  const instance = app(); const legacy = {...record}; delete legacy.id; delete legacy.allergy; delete legacy.ingredients;
  instance.context.fixture = legacy;
  const first = await instance.run('parseRecords([fixture,fixture])'); const second = await instance.run('parseRecords([fixture,fixture])');
  assert.equal(first.length,2); assert.notEqual(first[0].id,first[1].id); assert.equal(first[0].id,second[0].id); assert.equal(first[0].allergy,'');
});
test('restoring a backup adds missing records and preserves current edits',async()=> {
  const instance = app(); instance.context.current = [{...record,medicine:'수정한 시험 처방'}]; instance.context.backup = [record,{...record,id:'b576ac09-55e1-4e47-a328-0301bca53ab8'}];
  const merged = instance.run('mergeRecords(current,backup)');
  assert.equal(merged.length,2); assert.equal(merged[1].medicine,instance.context.current[0].medicine);
  instance.context.merged = merged; assert.equal(instance.run('mergeRecords(merged,backup)').length,2);
});
test('invalid backup schema and duplicate identities are rejected',async()=> {
  const instance = app(); instance.context.fixture = record;
  await assert.rejects(instance.run('parseRecords([fixture,fixture])'));
  await assert.rejects(instance.run("parseRecords([{...fixture,date:'2026-02-30'}])"));
  await assert.rejects(instance.run("parseRecords([{...fixture,medicine:42}])"));
});
test('storage failure preserves the previous encrypted records',async()=> {
  const instance = await savedApp(); const original = instance.storage.getItem('my-medicine-note.v1');
  instance.storage.setItem = ()=> { throw new Error('Quota exceeded'); };
  await assert.rejects(instance.run('persist([])')); assert.equal(instance.storage.getItem('my-medicine-note.v1'),original);
});
test('stale tab cannot overwrite a newer vault',async()=> {
  const instance = await savedApp(); instance.storage.setItem('my-medicine-note.v1','newer-vault');
  await assert.rejects(instance.run('persist([])')); assert.equal(instance.storage.getItem('my-medicine-note.v1'),'newer-vault');
});
test('large encrypted data encodes without argument stack overflow',()=> {
  const instance = app(); assert.equal(instance.run('bytes(base64(new Uint8Array(200000))).length'),200000);
});
test('actual export and restore handlers round trip an encrypted file and reject a wrong password',async()=> {
  const source = await savedApp();
  await source.elements.get('backup-export').handlers.click();
  const link = source.elements.get('backup-download');
  assert.equal(link.hidden,false);
  const file = await (await fetch(link.href)).blob();
  assert.equal((await file.text()).includes(record.medicine),false);
  const target = app();
  target.run("openRestore(); $('backup-file'); $('backup-password');");
  target.elements.get('backup-file').files=[file];
  target.elements.get('backup-password').value='Wrong-Password';
  await target.elements.get('restore-form').handlers.submit({preventDefault(){}});
  assert.equal(target.storage.getItem('my-medicine-note.v1'),null);
  target.elements.get('backup-password').value='TestOnly-Password';
  await target.elements.get('restore-form').handlers.submit({preventDefault(){}});
  assert.equal(target.run('entries.length'),1);
  assert.equal(target.run('entries[0].medicine'),record.medicine);
  await target.elements.get('restore-form').handlers.submit({preventDefault(){}});
  assert.equal(target.run('entries.length'),1);
  source.run('clearBackupLink()');
});
test('actual delete handler retains records on failed storage and removes only the selected record on success',async()=> {
  const instance = await savedApp(), write = instance.storage.setItem;
  instance.context.selected=record.id;
  instance.run('pendingDeleteId=selected');
  instance.storage.setItem=()=>{throw new Error('Quota exceeded');};
  await instance.elements.get('delete-confirm').handlers.click();
  assert.equal(instance.run('entries.length'),1);
  assert.match(instance.elements.get('delete-status').textContent,/원래 기록/);
  instance.storage.setItem=write;
  await instance.elements.get('delete-confirm').handlers.click();
  assert.equal(instance.run('entries.length'),0);
  const restored=await instance.run("readVault(JSON.parse(localStorage.getItem(storageKey)),'TestOnly-Password')");
  assert.equal(restored.records.length,0);
});
