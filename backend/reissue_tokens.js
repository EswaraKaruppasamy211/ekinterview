const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataFile = path.join(__dirname, 'data.json');
const queueFile = path.join(__dirname, '..', 'data', 'emailQueue.json');

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile,'utf8')||'{}'); } catch(e) { return {}; }
}
function save(state) {
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}
function saveQueue(queue) {
  try { fs.writeFileSync(queueFile, JSON.stringify(queue || [], null, 2)); } catch(e) { console.error('Failed write queue:', e.message); }
}

const state = load();
state.companyInvites = state.companyInvites || [];
state.passwordResets = state.passwordResets || [];
state.emailVerifications = state.emailVerifications || [];
state.emailQueue = state.emailQueue || [];

if (!state.tokenSecret) {
  state.tokenSecret = crypto.randomBytes(32).toString('hex');
  console.log('Generated new tokenSecret');
}
function hashToken(t) { return crypto.createHmac('sha256', state.tokenSecret).update(String(t)).digest('hex'); }

let counters = { invites: 0, resets: 0, verifs: 0 };

// helper to push job
function pushJob(job) {
  state.emailQueue.push(job);
}

// Re-issue invites
for (let i = 0; i < state.companyInvites.length; i++) {
  const inv = state.companyInvites[i];
  if (!inv.tokenHash) {
    const token = crypto.randomBytes(12).toString('hex');
    inv.tokenHash = hashToken(token);
    delete inv.token;
    inv.emailSent = false; inv.emailError = null;
    const mailOpts = { from: process.env.SMTP_FROM || (state.smtp && state.smtp.from) || 'no-reply@skillbridge.ai', to: inv.inviteeEmail, subject: `You're invited to join ${inv.companyName} on SkillBridge`, text: `You have been invited by ${inv.inviterEmail} to join ${inv.companyName}. Use token: ${token} to accept.` };
    const job = { id: Date.now() + i, type: 'invite', inviteId: inv.id, inviteeEmail: inv.inviteeEmail, mailOpts, attempts: 0, maxAttempts: Number(process.env.SMTP_RETRY || (state.smtp && state.smtp.retries) || 3), baseDelay: Number(process.env.SMTP_RETRY_DELAY_MS || (state.smtp && state.smtp.retryDelayMs) || 1000), nextRun: Date.now() };
    pushJob(job);
    counters.invites += 1;
  }
}

// Re-issue resets
for (let i = 0; i < state.passwordResets.length; i++) {
  const r = state.passwordResets[i];
  if (!r.tokenHash) {
    const token = crypto.randomBytes(12).toString('hex');
    r.tokenHash = hashToken(token);
    delete r.token;
    r.emailSent = false; r.emailError = null;
    const mailOpts = { from: process.env.SMTP_FROM || (state.smtp && state.smtp.from) || 'no-reply@skillbridge.ai', to: r.email, subject: 'Password reset for SkillBridge', text: `Use this token to reset your password: ${token} or visit /reset?token=${token}` };
    const job = { id: Date.now() + 10000 + i, type: 'reset', resetId: r.id, email: r.email, mailOpts, attempts: 0, maxAttempts: Number(process.env.SMTP_RETRY || (state.smtp && state.smtp.retries) || 3), baseDelay: Number(process.env.SMTP_RETRY_DELAY_MS || (state.smtp && state.smtp.retryDelayMs) || 1000), nextRun: Date.now() };
    pushJob(job);
    counters.resets += 1;
  }
}

// Re-issue verifications
for (let i = 0; i < state.emailVerifications.length; i++) {
  const v = state.emailVerifications[i];
  if (!v.tokenHash) {
    const token = crypto.randomBytes(12).toString('hex');
    v.tokenHash = hashToken(token);
    delete v.token;
    v.emailSent = false; v.emailError = null;
    const mailOpts = { from: process.env.SMTP_FROM || (state.smtp && state.smtp.from) || 'no-reply@skillbridge.ai', to: v.email, subject: `Verify your SkillBridge account`, text: `Welcome, please verify your email using token: ${token} or visit /verify?token=${token}` };
    const job = { id: Date.now() + 20000 + i, type: 'verify', verifyId: v.id, email: v.email, mailOpts, attempts: 0, maxAttempts: Number(process.env.SMTP_RETRY || (state.smtp && state.smtp.retries) || 3), baseDelay: Number(process.env.SMTP_RETRY_DELAY_MS || (state.smtp && state.smtp.retryDelayMs) || 1000), nextRun: Date.now() };
    pushJob(job);
    counters.verifs += 1;
  }
}

save(state);
saveQueue(state.emailQueue);

console.log('Re-issue summary:', counters);
console.log('Total queued jobs:', (state.emailQueue || []).length);
console.log('Wrote', dataFile, 'and', queueFile);
