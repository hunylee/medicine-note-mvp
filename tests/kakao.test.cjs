'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const handler = require('../api/kakao.js');

const origin = 'https://note.example';
process.env.APP_ORIGIN = origin;
process.env.KAKAO_REST_API_KEY = 'test-app-key';
process.env.KAKAO_SESSION_SECRET = randomBytes(32).toString('hex');

async function request(action, {method='GET',cookie='',headers={},body}={}) {
  const result = {status:200,headers:{},body:''};
  const req = {url:'/api/kakao?action='+action,method,headers:{cookie,...headers},body};
  const res = {setHeader(name,value){ result.headers[name.toLowerCase()] = value; },getHeader(name){ return result.headers[name.toLowerCase()]; },end(value=''){ result.status = this.statusCode || 200; result.body = value; }};
  await handler(req,res); return result;
}
function cookie(response) { return response.headers['set-cookie'].map(value=>value.split(';')[0]).filter(value=>!value.endsWith('=')).join('; '); }
async function loggedIn() {
  const start = await request('start');
  const state = new URL(start.headers.location).searchParams.get('state');
  const previous = global.fetch;
  global.fetch = async()=> ({ok:true,json:async()=>({access_token:'test-token-must-stay-private',expires_in:3600})});
  try {
    const callback = await request('callback&code=test-code&state='+state,{cookie:cookie(start)});
    const sessionCookie = cookie(callback);
    const status = await request('status',{cookie:sessionCookie});
    return {cookie:sessionCookie,csrf:JSON.parse(status.body).csrf,callback};
  } finally { global.fetch = previous; }
}

test('unconfigured service cannot report ready or send',async()=> {
  const saved = process.env.KAKAO_REST_API_KEY; delete process.env.KAKAO_REST_API_KEY;
  try { const response = await request('status'); assert.equal(response.status,503); assert.equal(JSON.parse(response.body).configured,false); }
  finally { process.env.KAKAO_REST_API_KEY = saved; }
});
test('OAuth redirects only to Kakao and uses a protected short-lived state cookie',async()=> {
  const response = await request('start'); const url = new URL(response.headers.location);
  assert.equal(url.origin,'https://kauth.kakao.com'); assert.equal(url.searchParams.get('scope'),'talk_message');
  assert.equal(url.searchParams.get('redirect_uri'),origin+'/api/kakao?action=callback');
  assert.match(response.headers['set-cookie'][0],/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
});
test('invalid OAuth state never exchanges an authorization code',async()=> {
  let calls = 0; const previous = global.fetch; global.fetch = async()=> { calls++; throw new Error('Must not call'); };
  try { await request('callback&code=test-code&state=악의적인문자'); assert.equal(calls,0); }
  finally { global.fetch = previous; }
});
test('connected status and browser callback never disclose the Kakao token',async()=> {
  const session = await loggedIn(); const status = await request('status',{cookie:session.cookie});
  assert.equal(JSON.parse(status.body).connected,true);
  assert.equal(status.body.includes('test-token-must-stay-private'),false);
  assert.equal(session.cookie.includes('test-token-must-stay-private'),false);
  assert.equal(session.callback.body.includes('test-token-must-stay-private'),false);
});
test('cross-origin and invalid CSRF sends cannot contact Kakao',async()=> {
  const session = await loggedIn();
  const response = await request('send',{method:'POST',cookie:session.cookie,headers:{origin:'https://other.example','x-csrf-token':session.csrf},body:{text:'test'}});
  assert.equal(response.status,403);
  const invalid = await request('send',{method:'POST',cookie:session.cookie,headers:{origin,'x-csrf-token':'가'.repeat(64)},body:{text:'test'}});
  assert.equal(invalid.status,403);
});
test('confirmed text is sent only to the self-message endpoint with a private-data-free link',async()=> {
  const session = await loggedIn(); const previous = global.fetch; const calls = [];
  global.fetch = async(url,options)=> { calls.push({url,options}); return {ok:true,json:async()=>({result_code:0})}; };
  try {
    const response = await request('send',{method:'POST',cookie:session.cookie,headers:{origin,'x-csrf-token':session.csrf,'content-type':'application/json'},body:{text:'테스트 복용 기록'}});
    assert.equal(JSON.parse(response.body).sent,true); assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://kapi.kakao.com/v2/api/talk/memo/default/send');
    const template = JSON.parse(calls[0].options.body.get('template_object'));
    assert.equal(template.text,'테스트 복용 기록'); assert.equal(template.link.web_url,origin); assert.equal('receiver_uuids' in template,false);
  } finally { global.fetch = previous; }
});
test('oversized messages are rejected before transmission',async()=> {
  const session = await loggedIn();
  const response = await request('send',{method:'POST',cookie:session.cookie,headers:{origin,'x-csrf-token':session.csrf,'content-type':'application/json'},body:{text:'가'.repeat(201)}});
  assert.equal(response.status,400);
});
test('Kakao rejection and uncertain network outcome never report successful delivery',async()=> {
  const session = await loggedIn(); const previous = global.fetch;
  const options = {method:'POST',cookie:session.cookie,headers:{origin,'x-csrf-token':session.csrf,'content-type':'application/json'},body:{text:'test'}};
  try {
    global.fetch = async()=> ({ok:false,status:403,json:async()=>({code:-402})});
    assert.equal(JSON.parse((await request('send',options)).body).code,'SEND_FAILED');
    global.fetch = async()=> { throw new Error('network'); };
    assert.equal(JSON.parse((await request('send',options)).body).code,'SEND_UNCERTAIN');
  } finally { global.fetch = previous; }
});
