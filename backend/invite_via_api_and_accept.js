const http = require('http');
const fs = require('fs');
const path = require('path');

function req(method,path,body,token){return new Promise((res,rej)=>{const headers={'Content-Type':'application/json'}; if(token) headers['Authorization']='Bearer '+token; const opts={hostname:'localhost',port:3000,path,method,headers}; const r=http.request(opts,(resp)=>{let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>{try{res({status:resp.statusCode,body:JSON.parse(d||'{}')});}catch(e){res({status:resp.statusCode,body:d});}});}); r.on('error',err=>rej(err)); if(body) r.write(JSON.stringify(body)); r.end();});}

(async ()=>{
 try{
   const login = await req('POST','/api/login',{email:'arjun@skillbridge.ai',password:'skillbridge'});
   const token = login.body && login.body.token; console.log('admin login', login.status);
   if(!token) return;
   const companyId = require('./data.json').companies && require('./data.json').companies[0] && require('./data.json').companies[0].id || 1787519271357;
   const invitee='accepttest@example.local';
   const create = await req('POST',`/api/company/${companyId}/invite`,{ inviteeEmail: invitee, role: 'industry' }, token);
   console.log('create invite:', create.status, create.body);
   // read emailQueue.json for the pending invite job
   await new Promise(r=>setTimeout(r,500));
   const queue = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'emailQueue.json'),'utf8')||'[]');
   const job = (queue || []).slice().reverse().find(j=>j.type==='invite' && (j.inviteeEmail===invitee || (j.mailOpts && j.mailOpts.to===invitee)));
   if(!job){ console.error('Invite job not found in queue'); return; }
   const text = job.mailOpts && job.mailOpts.text || '';
   const m = text.match(/([0-9a-f]{20,})/i);
   const tokenStr = m ? m[1] : null; console.log('extracted token:', tokenStr);
   if(!tokenStr){ console.error('No token in mail text'); return; }
   // now accept invite
   const accept = await req('POST','/api/company/invite/accept',{ token: tokenStr, email: invitee });
   console.log('accept response (no auth):', accept.status, accept.body);
   // try with auth too
   const accept2 = await req('POST','/api/company/invite/accept',{ token: tokenStr, email: invitee }, token);
   console.log('accept response (with admin auth):', accept2.status, accept2.body);
 }catch(e){console.error('err',e)}
})();
