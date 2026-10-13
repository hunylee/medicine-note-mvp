'use strict';

const { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } = require('node:crypto');

function configuration() {
  const origin = process.env.APP_ORIGIN;
  const appKey = process.env.KAKAO_REST_API_KEY;
  const secret = process.env.KAKAO_SESSION_SECRET;
  if (!origin || !appKey || !/^[a-f\d]{64}$/i.test(secret || '')) return null;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname))) return null;
    return { origin, appKey, key:Buffer.from(secret,'hex'), secure:url.protocol === 'https:', redirect:origin + '/api/kakao?action=callback' };
  } catch { return null; }
}

function seal(value, config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm',config.key,iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}

function unseal(value, config) {
  if (!value || value.length > 4096) return null;
  try {
    const data = Buffer.from(value,'base64url');
    const decipher = createDecipheriv('aes-256-gcm',config.key,data.subarray(0,12));
    decipher.setAuthTag(data.subarray(12,28));
    const result = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
    return typeof result.exp === 'number' && result.exp > Date.now() ? result : null;
  } catch { return null; }
}

function cookieName(type, config) { return (config.secure ? '__Host-' : '') + 'medicine-kakao-' + type; }
function readCookie(req, type, config) {
  const name = cookieName(type,config) + '=';
  const value = (req.headers.cookie || '').split(';').map(part=>part.trim()).find(part=>part.startsWith(name));
  return unseal(value?.slice(name.length),config);
}
function setCookie(res, type, value, seconds, config) {
  const cookie = `${cookieName(type,config)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.secure ? '; Secure' : ''}`;
  const previous = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie',[...(Array.isArray(previous) ? previous : [previous]),cookie]);
}
function json(res,status,value) { res.statusCode = status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
function equal(left,right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a,b);
}

function finishLogin(res,config,ok) {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Referrer-Policy','no-referrer');
  const nonce = randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
  const origin = JSON.stringify(config.origin).replace(/</g,'\\u003c');
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>카카오 연결</title><body><h1>${ok ? '카카오톡이 연결됐어요' : '카카오톡을 연결하지 못했어요'}</h1><p>이 창을 닫고 약노트에서 연결을 확인해 주세요. 기록은 아직 보내지 않았어요.</p><script nonce="${nonce}">history.replaceState(null,'','/api/kakao?action=callback');if(window.opener){window.opener.postMessage({type:'medicine-kakao-connected',ok:${ok}},${origin});window.close();}</script></body></html>`);
}

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const config = configuration();
  const action = new URL(req.url,'http://localhost').searchParams.get('action') || 'status';
  if (!config) { json(res,503,{code:'NOT_CONFIGURED',configured:false,connected:false}); return; }
  const session = readCookie(req,'session',config);
  if (action === 'status' && req.method === 'GET') {
    const connected = typeof session?.token === 'string' && typeof session?.csrf === 'string';
    json(res,200,{configured:true,connected,csrf:connected ? session.csrf : null}); return;
  }
  if (action === 'start' && req.method === 'GET') {
    const state = randomBytes(32).toString('hex');
    setCookie(res,'oauth',seal({state,exp:Date.now()+600000},config),600,config);
    const authorization = new URL('https://kauth.kakao.com/oauth/authorize');
    authorization.search = new URLSearchParams({client_id:config.appKey,redirect_uri:config.redirect,response_type:'code',scope:'talk_message',state}).toString();
    res.statusCode = 302; res.setHeader('Location',authorization.href); res.end(); return;
  }
  if (action === 'callback' && req.method === 'GET') {
    const params = new URL(req.url,config.origin).searchParams;
    const oauth = readCookie(req,'oauth',config);
    setCookie(res,'oauth','',0,config);
    if (!equal(params.get('state'),oauth?.state) || !params.get('code') || params.has('error')) { finishLogin(res,config,false); return; }
    try {
      const body = new URLSearchParams({grant_type:'authorization_code',client_id:config.appKey,redirect_uri:config.redirect,code:params.get('code')});
      if (process.env.KAKAO_CLIENT_SECRET) body.set('client_secret',process.env.KAKAO_CLIENT_SECRET);
      const response = await fetch('https://kauth.kakao.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(10000)});
      const tokens = await response.json();
      if (!response.ok || typeof tokens.access_token !== 'string' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) { finishLogin(res,config,false); return; }
      const seconds = Math.min(tokens.expires_in,1800);
      setCookie(res,'session',seal({token:tokens.access_token,csrf:randomBytes(32).toString('hex'),exp:Date.now()+seconds*1000},config),seconds,config);
      finishLogin(res,config,true);
    } catch { finishLogin(res,config,false); }
    return;
  }
  if ((action === 'send' || action === 'disconnect') && req.method === 'POST') {
    if (req.headers.origin !== config.origin || !equal(req.headers['x-csrf-token'],session?.csrf)) { json(res,403,{code:'FORBIDDEN'}); return; }
    if (action === 'disconnect') { setCookie(res,'session','',0,config); json(res,200,{disconnected:true}); return; }
    if (typeof session?.token !== 'string') { json(res,401,{code:'LOGIN_REQUIRED'}); return; }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) { json(res,415,{code:'INVALID_BODY'}); return; }
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { json(res,400,{code:'INVALID_BODY'}); return; }
    if (!body || typeof body.text !== 'string' || !body.text.trim() || Array.from(body.text).length > 200) { json(res,400,{code:'INVALID_TEXT'}); return; }
    try {
      const template = {object_type:'text',text:body.text,link:{web_url:config.origin,mobile_web_url:config.origin},button_title:'약노트 열기'};
      const response = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send',{method:'POST',headers:{Authorization:'Bearer ' + session.token,'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},body:new URLSearchParams({template_object:JSON.stringify(template)}),signal:AbortSignal.timeout(10000)});
      const result = await response.json();
      if (response.ok && result.result_code === 0) { json(res,200,{sent:true}); return; }
      if (response.status === 401) { setCookie(res,'session','',0,config); json(res,401,{code:'LOGIN_REQUIRED'}); return; }
      json(res,502,{code:'SEND_FAILED'});
    } catch { json(res,502,{code:'SEND_UNCERTAIN'}); }
    return;
  }
  json(res,405,{code:'METHOD_NOT_ALLOWED'});
};
