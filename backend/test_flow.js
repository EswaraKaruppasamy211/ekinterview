const fs = require('fs');
const path = require('path');
const http = require('http');

function req(method, pathname, body, headers = {}){
  return new Promise((resolve,reject)=>{
    const opts = { hostname: 'localhost', port: 3000, path: pathname, method, headers: Object.assign({'Content-Type':'application/json'}, headers) };
    const r = http.request(opts, (res)=>{
      let d=''; res.on('data',c=>d+=c); res.on('end', ()=>{
        try { const parsed = JSON.parse(d || '{}'); resolve({status: res.statusCode, body: parsed}); } catch(e){ resolve({status: res.statusCode, body: d}); }
      });
    });
    r.on('error', err=> reject(err));
    if (body) r.write(JSON.stringify(body)); r.end();
  });
}

(async ()=>{
  try{
    console.log('Registering company owner...');
    const regCo = await req('POST','/api/register',{ email: 'testco+owner@example.local', name: 'Owner', password: 'Pass123!', accountType: 'company', companyName: 'TestCo' });
    console.log('register company:', regCo.status, regCo.body);
    const tokenCo = regCo.body && regCo.body.token ? regCo.body.token : null;

    console.log('Registering a student...');
    const regStu = await req('POST','/api/register',{ email: 'student1@example.local', name: 'Student', password: 'Pass123!', accountType: 'student' });
    console.log('register student:', regStu.status, regStu.body);

    // Request password reset for student
    console.log('Requesting password reset for student...');
    const forgot = await req('POST','/api/auth/forgot',{ email: 'student1@example.local' });
    console.log('forgot response:', forgot.status, forgot.body);

    // Create an invite using company owner
    if (!tokenCo) { console.log('No company token, cannot create invite'); }
    else {
      // fetch company id via admin endpoint or rely on returned companyId at registration
      const companyId = regCo.body.companyId || (regCo.body && regCo.body.email ? null : null);
      // Try to post invite at /api/company/:id/invite or at /api/company/invite
      // The server provided POST /api/company/:id/invite earlier; try to find an endpoint. We'll attempt /api/company/1/invite then fallback to /api/company/invite
      let inviteRes = await req('POST', `/api/company/${companyId || '1'}/invite`, { email: 'invitee1@example.local', role: 'industry' }, { Authorization: 'Bearer ' + tokenCo });
      if (inviteRes.status >= 400) {
        inviteRes = await req('POST','/api/company/invite', { email: 'invitee1@example.local', role: 'industry' }, { Authorization: 'Bearer ' + tokenCo });
      }
      console.log('invite response:', inviteRes.status, inviteRes.body);
    }

    // Wait briefly for server to persist queue
    await new Promise(r=>setTimeout(r,1200));

    const qPath = path.join(__dirname, '..', 'data', 'emailQueue.json');
    let queue = [];
    try { queue = JSON.parse(fs.readFileSync(qPath,'utf8')||'[]'); } catch(e){ console.error('Failed read queue', e.message); }
    console.log('Found', queue.length, 'queued email jobs');

    function extractToken(text){ if (!text) return null; const m = text.match(/([0-9a-f]{20,})/i); return m ? m[1] : null; }

    // Attempt to process a verify job
    const verifyJob = queue.find(j => j.type === 'verify');
    if (verifyJob) {
      const token = extractToken(verifyJob.mailOpts && verifyJob.mailOpts.text);
      console.log('Attempting verify with token from job', verifyJob.id, 'token?', !!token);
      if (token) {
        const v = await req('POST','/api/auth/verify',{ token });
        console.log('verify result:', v.status, v.body);
      }
    } else console.log('No verify jobs');

    // Attempt to process a reset job
    const resetJob = queue.find(j => j.type === 'reset');
    if (resetJob) {
      const token = extractToken(resetJob.mailOpts && resetJob.mailOpts.text);
      console.log('Attempting reset with token from job', resetJob.id, 'token?', !!token);
      if (token) {
        const r = await req('POST','/api/auth/reset',{ token, password: 'NewPass!234' });
        console.log('reset result:', r.status, r.body);
        if (r.status === 200) {
          // try login
          const login = await req('POST','/api/login',{ email: resetJob.email, password: 'NewPass!234' });
          console.log('login after reset:', login.status, login.body);
        }
      }
    } else console.log('No reset jobs');

    // Attempt to accept invite
    const inviteJob = queue.find(j => j.type === 'invite');
    if (inviteJob) {
      const token = extractToken(inviteJob.mailOpts && inviteJob.mailOpts.text);
      const email = inviteJob.inviteeEmail || (inviteJob.mailOpts && inviteJob.mailOpts.to);
      console.log('Attempting accept-invite with token from job', inviteJob.id, 'email', email, 'token?', !!token);
      if (token && email) {
        const a = await req('POST','/api/company/invite/accept',{ token, email });
        console.log('invite accept result:', a.status, a.body);
      }
    } else console.log('No invite jobs');

    console.log('Test flow complete');
  } catch (e) { console.error('Test flow error', e); process.exit(1); }
})();
