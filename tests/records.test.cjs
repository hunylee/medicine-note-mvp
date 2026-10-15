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
  const context = vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,Blob,URL,AbortController,btoa,atob,setTimeout:()=>0,clearTimeout(){},localStorage:storage,window:{addEventListener(){},scrollTo(){}},document:{createElement:element,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelectorAll(){return [];},addEventListener(){}}});
  const script = fs.readFileSync(require.resolve('../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script,context);
  return {run:code=>vm.runInContext(code,context),storage,context,elements};
}
const record = {id:'5fe09385-c207-49e9-bc08-f09bfd949b86',medicine:'시험 처방',date:'2026-10-13',effect:'잘 들었어요',ingredients:'시험 성분',allergy:'없었어요',allergyReaction:'',hospital:'시험 병원',memo:'시험 메모',supplyType:'처방받은 약'};
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
test('supply type keeps old record identities stable and never classifies an old record as OTC',async()=> {
  const instance=app(); const legacy={medicine:record.medicine,date:record.date,effect:record.effect,hospital:record.hospital,memo:record.memo,ingredients:record.ingredients,allergy:record.allergy,allergyReaction:record.allergyReaction};
  instance.context.legacy=legacy;
  const parsed=await instance.run('parseRecords([legacy])');
  const expected='legacy-'+require('node:crypto').createHash('sha256').update(JSON.stringify([legacy,0])).digest('hex');
  assert.equal(parsed[0].id,expected); assert.equal(parsed[0].supplyType,'');
  instance.context.fixtures=[parsed[0],{...record,supplyType:'처방받은 약'},{...record,supplyType:'약국에서 산 일반 감기약'}];
  assert.equal(instance.run("filteredRecords(fixtures,'','prescribed').length"),1);
  assert.equal(instance.run("filteredRecords(fixtures,'','pharmacy').length"),1);
  assert.equal(instance.run("filteredRecords(fixtures,'','supply-unknown').length"),1);
  await assert.rejects(instance.run("parseRecords([{...legacy,supplyType:'자동 추천약'}])"));
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
test('reaction classification never treats unknown records or a good effect with a reaction as reaction-free',()=> {
  const instance=app();
  instance.context.fixtures=[record,{...record,id:'reaction',allergy:'있었어요'},{...record,id:'unknown',allergy:'잘 모르겠어요'},{...record,id:'legacy',allergy:''}];
  assert.equal(instance.run("filteredRecords(fixtures,'','good').length"),1);
  assert.equal(instance.run("filteredRecords(fixtures,'','reaction')[0].id"),'reaction');
  assert.equal(instance.run("filteredRecords(fixtures,'','unknown').length"),2);
});
test('search and reaction filter intersect without modifying records',()=> {
  const instance=app();
  instance.context.fixtures=[record,{...record,id:'reaction',allergy:'있었어요',ingredients:'성분 ABC'}];
  assert.equal(instance.run("filteredRecords(fixtures,' abc ','reaction').length"),1);
  assert.equal(instance.run("filteredRecords(fixtures,'시험 병원','good').length"),1);
  assert.equal(instance.run("filteredRecords(fixtures,'없는 이름','all').length"),0);
  assert.equal(instance.run('fixtures.length'),2);
});
test('FDA label parsing preserves product identity and never invents missing ingredients',()=> {
  const instance=app();
  instance.context.labels=[{set_id:'37c55543-e05e-2f7c-e063-6394a90a4534',effective_time:'20250620',openfda:{brand_name:['DayQuil'],substance_name:['ACETAMINOPHEN','DEXTROMETHORPHAN HYDROBROMIDE']},active_ingredient:['Acetaminophen 325 mg']},{set_id:'37c55543-e05e-2f7c-e063-6394a90a4534'},{set_id:'https://malicious.test'},{set_id:'5fe09385-c207-49e9-bc08-f09bfd949b86'}];
  const products=instance.run('fdaProducts(labels)');
  assert.equal(products.length,2);
  assert.equal(products[0].ingredients,'ACETAMINOPHEN, DEXTROMETHORPHAN HYDROBROMIDE');
  assert.equal(products[0].updated,'라벨 날짜 2025-06-20');
  assert.equal(products[1].ingredients,'');
  assert.match(products[0].source,/^https:\/\/dailymed.nlm.nih.gov\//);
});
test('import ingredient matching distinguishes codeine from dihydrocodeine and recognizes salts across languages',()=> {
  const instance=app();
  assert.equal(instance.run("importMatches('DEXTROMETHORPHAN HYDROBROMIDE')[0].rule.id"),'dxm');
  assert.equal(instance.run("importMatches('디히드로코데인타르타르산염').length"),1);
  assert.equal(instance.run("importMatches('디히드로코데인타르타르산염')[0].rule.id"),'dihydrocodeine');
  assert.equal(instance.run("importMatches('ジヒドロコデインリン酸塩')[0].rule.id"),'dihydrocodeine');
  assert.equal(instance.run("importMatches('codeine phosphate')[0].rule.id"),'codeine');
  assert.equal(instance.run("importMatches('codeine phosphate, dihydrocodeine tartrate').length"),2);
});
test('scanner validates barcode check digits and extracts only GTIN from GS1 QR formats',()=> {
  const instance=app();
  for (const value of ['8806265001309','08806265001309','(01)08806265001309(17)271231',']d2010880626500130917271231','https://id.gs1.org/01/08806265001309/21/test']) {
    instance.context.input=value; assert.equal(instance.run('barcodeNumber(input)'),'08806265001309');
  }
  for (const value of ['8806265001308','0000000000000','https://example.com/record?name=private','javascript:alert(1)','880626500130','12345']) {
    instance.context.input=value; assert.equal(instance.run('barcodeNumber(input)'),null);
  }
  assert.equal(instance.run("barcodeProduct(barcodeNumber('8806265001309')).name"),'판피린큐액');
  assert.equal(instance.run("barcodeProduct(barcodeNumber('8806265000609')).name"),'판피린티정');
});
test('domestic barcode lookup stays local and external barcode lookup sends no photo or private record',async()=> {
  const instance=await savedApp(); let request=null;
  instance.context.fetch=async(url,options)=> { request={url:String(url),options}; return {status:404,ok:false}; };
  await instance.run("lookupBarcode('8806265001309')"); assert.equal(request,null);
  await instance.run("lookupBarcode('https://private.invalid/patient?id=secret')"); assert.equal(request,null);
  await instance.run("lookupBarcode('0094187378441')");
  assert.equal(new URL(request.url).origin,'https://api.fda.gov'); assert.equal(request.options.body,undefined);
  assert.match(new URL(request.url).searchParams.get('search'),/openfda.upc/);
  assert.match(instance.elements.get('scan-status').textContent,/찾지 못했어요/);
});
test('stopping the scanner releases video tracks and its scan controls',()=> {
  const instance=app(); let stopped=0;
  instance.context.track={stop(){stopped++;}}; instance.context.controls={stop(){stopped++;}};
  instance.run('scanStream={getTracks:()=>[track]}; scanControls=controls; stopScanCamera();');
  assert.equal(stopped,2); assert.equal(instance.run('scanStream'),null); assert.equal(instance.run('scanControls'),null);
  assert.equal(instance.elements.get('scan-video').srcObject,null);
});
test('import guide treats brand names as examples and never marks unrecognized products as permitted',()=> {
  const instance=app();
  assert.equal(instance.run("importMatches('DayQuil Cold and Flu')[0].matchedBy"),'example');
  assert.equal(instance.run("importMatches('DayQuil DEXTROMETHORPHAN')[0].matchedBy"),'ingredient');
  assert.equal(instance.run("importMatches('아세트아미노펜, DL-메틸에페드린염산염, 슈도에페드린').length"),0);
  assert.equal(instance.run("importMatches('noncodeine, mydayquilbrand').length"),0);
  instance.run("$('import-query').value='알 수 없는 제품'; renderImportResults();");
  assert.match(instance.elements.get('import-status').textContent,/반입 가능 판정이 아니/);
});
test('FDA search sends only the typed product query and preserves private records when the service fails',async()=> {
  const instance=await savedApp(), original=instance.storage.getItem('my-medicine-note.v1');
  instance.run("$('drug-country').value='us'; $('drug-query').value='DayQuil';");
  let requested;
  instance.context.fetch=async(url,options)=>{requested={url:String(url),options};return {ok:false,status:429};};
  await instance.elements.get('drug-search-form').handlers.submit({preventDefault(){}});
  assert.equal(new URL(requested.url).origin,'https://api.fda.gov');
  assert.equal(new URL(requested.url).searchParams.get('search'),'openfda.brand_name:"DayQuil"');
  assert.equal(requested.options.body,undefined);
  assert.equal(requested.options.credentials,'omit');
  assert.equal(instance.storage.getItem('my-medicine-note.v1'),original);
  assert.match(instance.elements.get('drug-status').textContent,/불러오지 못했어요/);
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
