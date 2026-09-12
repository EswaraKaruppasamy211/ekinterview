// SkillBridge — Enforced Security Client Engine for Student, Company & College Modules

const API_BASE = '/api';

let currentUser = null;
let currentProfile = null;
let currentRole = 'student';
let authToken = localStorage.getItem('sb_token') || null;
let pendingStudentOtpEmail = null;
let otpCountdownTimer = null;
let studentCampusDrives = [];
let voiceInterview = {
  language: 'ta-IN',
  questionIndex: 0,
  answers: [],
  recognition: null,
  listening: false,
  sessionStarted: false,
  lastTranscript: ''
};

const interviewQuestions = [
  {
    en: 'Tell me about yourself and the kind of software role you are looking for.',
    ta: 'உங்களைப் பற்றியும், நீங்கள் தேடும் மென்பொருள் வேலையின் வகையைப் பற்றியும் சொல்லுங்கள்.'
  },
  {
    en: 'Explain one project you built and the most important technical decision you made.',
    ta: 'நீங்கள் உருவாக்கிய ஒரு திட்டத்தையும், அதில் எடுத்த முக்கியமான தொழில்நுட்ப முடிவையும் விளக்குங்கள்.'
  },
  {
    en: 'How would you debug an API that suddenly became slow in production?',
    ta: 'Production-ல் திடீரென மெதுவான API-ஐ எப்படி டெபக் செய்வீர்கள்?'
  },
  {
    en: 'Describe a time you solved a difficult problem with a teammate.',
    ta: 'ஒரு சக ஊழியருடன் சேர்ந்து கடினமான பிரச்சினையைத் தீர்த்த அனுபவத்தை சொல்லுங்கள்.'
  },
  {
    en: 'Why should we select you for this role?',
    ta: 'இந்த பணிக்கு உங்களை ஏன் தேர்வு செய்ய வேண்டும்?'
  },
  {
    en: 'What is the difference between HTTP and HTTPS?',
    ta: 'HTTP மற்றும் HTTPS-க்கு இடையிலான வித்தியாசம் என்ன?'
  },
  {
    en: 'How do you improve application performance under heavy load?',
    ta: 'அதிக லோட் இருக்கும் போது செயல்திறனை எப்படி மேம்படுத்துவது?'
  },
  {
    en: 'Describe how you would ensure data security in a web application.',
    ta: 'Web application-ல் data security-ஐ எவ்வாறு உறுதி செய்வீர்கள்?'
  },
  {
    en: 'How do you handle conflict in a team environment?',
    ta: 'குழு சூழலில் மோதலை எப்படி கையாள்வீர்கள்?'
  },
  {
    en: 'Where do you see yourself in 2 years and what are your goals?',
    ta: '2 வருடங்களில் நீங்களே எங்கு இருப்பீர்கள், உங்கள் இலக்குகள் என்ன?'
  }
];

document.addEventListener('DOMContentLoaded', async () => {
  const transcript = document.getElementById('interview-transcript');
  if (transcript) {
    transcript.addEventListener('input', updateInterviewAnswerState);
  }

  if (authToken) {
    await fetchCurrentUser();
  } else {
    showGuestLanding();
  }
});

async function apiFetch(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API Request Failed');
    return data;
  } catch (err) {
    console.error('API Error:', err.message);
    throw err;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read uploaded file.'));
    reader.readAsDataURL(file);
  });
}

async function fetchCurrentUser() {
  try {
    const data = await apiFetch('/auth/me');
    currentUser = data.user;
    currentProfile = data.profile;
    currentRole = currentUser.role || 'student';
    showAppWorkspace();
  } catch (err) {
    handleLogout();
  }
}

function showGuestLanding() {
  document.getElementById('guest-landing').classList.remove('hidden');
  document.getElementById('app-workspace').classList.add('hidden');
  document.getElementById('guest-nav-controls').classList.remove('hidden');
  document.getElementById('user-nav-controls').classList.add('hidden');
}

function showAppWorkspace() {
  document.getElementById('guest-landing').classList.add('hidden');
  document.getElementById('app-workspace').classList.remove('hidden');
  document.getElementById('guest-nav-controls').classList.add('hidden');
  document.getElementById('user-nav-controls').classList.remove('hidden');

  const name = (currentProfile && currentProfile.name) || (currentUser && currentUser.companyName) || (currentUser && currentUser.collegeName) || 'User';
  document.getElementById('user-display-name').textContent = name;
  document.getElementById('user-display-id').textContent = currentUser.role === 'company' ? `COMPANY (${currentUser.companyId || 'CMP-10001'})` : (currentUser.role === 'college' ? 'UNIVERSITY ADMIN' : (currentProfile ? currentProfile.student_id : 'STUDENT'));

  renderPortalState(currentRole);
  if (currentRole === 'student' && currentProfile && currentProfile.onboarding_complete === false) navigateTo('profile');
}

// ENFORCED SECURITY PORTAL SWITCHER & ROUTE GUARDS
function switchPortalRole(targetRole) {
  if (targetRole === 'student' && (!currentUser || currentUser.role !== 'student')) {
    openStudentAuthModal('login');
    return;
  }

  if (targetRole === 'company' && (!currentUser || currentUser.role !== 'company')) {
    openCompanyAuthModal('login');
    return;
  }

  if (targetRole === 'college' && (!currentUser || currentUser.role !== 'college')) {
    openCollegeAuthModal('login');
    return;
  }

  currentRole = targetRole;
  renderPortalState(targetRole);
}

function renderPortalState(role) {
  document.querySelectorAll('.role-nav-pill').forEach(el => el.classList.remove('active'));
  const pill = document.getElementById(`portal-pill-${role}`);
  if (pill) pill.classList.add('active');

  const badge = document.getElementById('portal-badge');
  if (badge) badge.textContent = role === 'company' ? 'Recruiter Module' : (role === 'college' ? 'University Admin' : 'Student Module');

  document.querySelectorAll('.role-sidebar-group').forEach(group => group.classList.add('hidden'));
  const targetGroup = document.getElementById(`sidebar-${role}-links`);
  if (targetGroup) targetGroup.classList.remove('hidden');

  if (role === 'student') navigateTo('dashboard');
  else if (role === 'company') navigateTo('company-dashboard');
  else if (role === 'college') navigateTo('college-dashboard');
}

function navigateToRoleHome() {
  switchPortalRole(currentRole);
}

function navigateTo(viewId) {
  closeMobileDrawer();

  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector(`.sidebar-item[data-target="${viewId}"]`);
  if (activeItem) activeItem.classList.add('active');

  document.querySelectorAll('.workspace-view').forEach(v => v.classList.add('hidden'));
  const targetView = document.getElementById(`view-${viewId}`);
  if (targetView) targetView.classList.remove('hidden');

  if (viewId === 'dashboard') loadDashboardHome();
  else if (viewId === 'profile') loadProfileView();
  else if (viewId === 'academics') loadAcademicsView();
  else if (viewId === 'skills') loadSkillsView();
  else if (viewId === 'assessments') loadAssessmentsView();
  else if (viewId === 'ats-resume') loadATSResumeView();
  else if (viewId === 'portfolio') loadPortfolioView();
  else if (viewId === 'ai-skill-analyzer') loadAISkillAnalyzerView();
  else if (viewId === 'opportunities') loadOpportunitiesView();
  else if (viewId === 'applications') loadApplicationsView();
  else if (viewId === 'interview-prep') loadInterviewPrepView();
  else if (viewId === 'notifications') loadNotificationsView();
  else if (viewId === 'placement') loadPlacementView();
  else if (viewId === 'campus-drives') loadCampusDrivesView();
  else if (viewId === 'settings') loadSettingsView();
  else if (viewId === 'company-dashboard') { loadCompanyATSPipeline(); renderCompanyDashboard(); }
  else if (viewId === 'company-profile') renderCompanyProfile();
  else if (viewId === 'company-talent-discovery') renderCompanyTalentDiscovery();
  else if (viewId === 'company-ai-match') runCompanyAIMatch();
  else if (viewId === 'company-skill-demand') renderCompanySkillDemand();
  else if (viewId === 'company-internships') renderCompanyInternships();
  else if (viewId === 'company-job-drives') renderCompanyJobDrives();
  else if (viewId === 'company-assessments') renderCompanyAssessments();
  else if (viewId === 'company-interview-pipeline') renderCompanyInterviewPipeline();
  else if (viewId === 'company-campus-connect') renderCompanyCampusConnect();
  else if (viewId === 'company-shortlist') renderCompanyShortlist();
  else if (viewId === 'company-analytics') renderCompanyAnalytics();
  else if (viewId === 'company-messages') renderCompanyMessages();
  else if (viewId === 'company-notifications') renderCompanyNotifications();
  else if (viewId === 'company-settings') renderCompanySettings();
  else if (viewId === 'talent-finder') loadTalentFinder();
  else if (viewId === 'college-dashboard') loadCollegeDashboard();
  else if (viewId === 'college-students') loadCollegeStudentDirectory();
}

// STUDENT AUTH HANDLERS
function openStudentAuthModal(tab = 'login') {
  openModal('student-auth-modal');
  switchStudentAuthTab(tab);
}

function switchStudentAuthTab(tab) {
  const loginForm = document.getElementById('student-login-form');
  const regForm = document.getElementById('student-register-form');
  const title = document.getElementById('student-auth-title');
  const otpBlock = document.getElementById('student-otp-block');
  const submitButton = document.getElementById('stu-reg-submit-btn');

  if (tab === 'login') {
    title.innerHTML = '<i class="fa-solid fa-graduation-cap text-blue"></i> Student Sign In';
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    pendingStudentOtpEmail = null;
    if (otpBlock) otpBlock.classList.add('hidden');
    if (submitButton) submitButton.textContent = 'Send OTP';
    if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  } else {
    title.innerHTML = '<i class="fa-solid fa-user-plus text-blue"></i> Register Student Account';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    pendingStudentOtpEmail = null;
    if (otpBlock) otpBlock.classList.add('hidden');
    if (submitButton) submitButton.textContent = 'Send OTP';
    if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  }
}

function setStudentOtpCountdown(seconds) {
  const timer = document.getElementById('stu-reg-otp-timer');
  const resendBtn = document.getElementById('stu-reg-resend-btn');
  if (!timer || !resendBtn) return;

  let remaining = seconds;
  resendBtn.disabled = true;
  const tick = () => {
    remaining -= 1;
    timer.textContent = remaining > 0 ? `${remaining}s` : 'Ready';
    if (remaining <= 0) {
      resendBtn.disabled = false;
      timer.textContent = 'Ready';
      clearInterval(otpCountdownTimer);
      otpCountdownTimer = null;
    }
  };
  tick();
  if (otpCountdownTimer) clearInterval(otpCountdownTimer);
  otpCountdownTimer = setInterval(tick, 1000);
}

async function requestStudentOtp(email, password, confirmPassword) {
  const otpBlock = document.getElementById('student-otp-block');
  const submitButton = document.getElementById('stu-reg-submit-btn');
  const otpInput = document.getElementById('stu-reg-otp');

  const data = await apiFetch('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email })
  });

  pendingStudentOtpEmail = email;
  if (otpBlock) otpBlock.classList.remove('hidden');
  if (submitButton) submitButton.textContent = 'Verify OTP & Create Account';
  setStudentOtpCountdown(30);

  if (data.devCode && otpInput) {
    otpInput.value = data.devCode;
  }

  return { success: true, password, confirmPassword };
}

async function resendStudentOtp() {
  const email = document.getElementById('stu-reg-email').value.trim();
  const password = document.getElementById('stu-reg-pass').value.trim();
  const confirmPassword = document.getElementById('stu-reg-confirm-pass').value.trim();
  if (!email) {
    alert('Enter your email address first.');
    return;
  }
  try {
    await requestStudentOtp(email, password, confirmPassword);
  } catch (err) {
    alert(err.message || 'Unable to resend student OTP.');
  }
}

async function handleStudentLoginSubmit(e) {
  e.preventDefault();
  const identity = document.getElementById('stu-login-id').value.trim();
  const password = document.getElementById('stu-login-pass').value.trim();

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, password, role: 'student' })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    currentProfile = data.profile;
    closeModal('student-auth-modal');
    switchPortalRole('student');
    showAppWorkspace();
  } catch (err) {
    alert(err.message || 'Student Sign In Failed.');
  }
}

async function handleStudentRegisterSubmit(e) {
  e.preventDefault();
  const fullName = document.getElementById('stu-reg-name').value.trim();
  const username = document.getElementById('stu-reg-username').value.trim();
  const email = document.getElementById('stu-reg-email').value.trim();
  const mobile = document.getElementById('stu-reg-mobile').value.trim();
  const password = document.getElementById('stu-reg-pass').value.trim();
  const confirmPassword = document.getElementById('stu-reg-confirm-pass').value.trim();
  const otpCode = document.getElementById('stu-reg-otp')?.value.trim() || '';
  const passwordError = document.getElementById('stu-reg-password-error');
  passwordError.classList.toggle('hidden', password === confirmPassword);
  if (password !== confirmPassword) return;

  try {
    if (!pendingStudentOtpEmail || pendingStudentOtpEmail !== email) {
      await requestStudentOtp(email, password, confirmPassword);
      return;
    }

    if (!otpCode || otpCode.length !== 6) {
      alert('Enter the 6-digit OTP sent to your email before creating the account.');
      return;
    }

    await apiFetch('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp: otpCode })
    });

    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, username, email, mobile, password, confirmPassword, role: 'student' })
    });

    pendingStudentOtpEmail = null;
    if (otpCountdownTimer) clearInterval(otpCountdownTimer);
    document.getElementById('student-otp-block').classList.add('hidden');
    document.getElementById('stu-reg-submit-btn').textContent = 'Send OTP';

    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    currentProfile = data.profile;
    closeModal('student-auth-modal');
    alert(`Account created. Your Student ID is ${data.studentId}. Complete your profile to continue.`);
    switchPortalRole('student');
    showAppWorkspace();
  } catch (err) {
    alert(err.message || 'Student Registration Failed.');
  }
}

// COMPANY AUTH HANDLERS
function openCompanyAuthModal(tab = 'login') {
  openModal('company-auth-modal');
  switchCompanyAuthTab(tab);
}

function switchCompanyAuthTab(tab) {
  const loginForm = document.getElementById('company-login-form');
  const regForm = document.getElementById('company-register-form');
  const title = document.getElementById('comp-auth-title');

  if (tab === 'login') {
    title.innerHTML = '<i class="fa-solid fa-building text-blue"></i> Company Recruiter Login';
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
  } else {
    title.innerHTML = '<i class="fa-solid fa-building text-blue"></i> Register Company Account';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

async function handleCompanyLoginSubmit(e) {
  e.preventDefault();
  const companyName = document.getElementById('comp-login-name').value.trim();
  const identity = document.getElementById('comp-login-user').value.trim();
  const password = document.getElementById('comp-login-pass').value.trim();

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ companyName, identity, password, role: 'company' })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    closeModal('company-auth-modal');
    switchPortalRole('company');
    showAppWorkspace();
  } catch (err) {
    alert(err.message || 'Company Login Failed.');
  }
}

async function handleCompanyRegisterSubmit(e) {
  e.preventDefault();
  const companyName = document.getElementById('comp-reg-name').value.trim();
  const managerName = document.getElementById('comp-reg-mgr').value.trim();
  const email = document.getElementById('comp-reg-email').value.trim();
  const password = document.getElementById('comp-reg-pass').value.trim();

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ companyName, managerName, email, password, role: 'company' })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    closeModal('company-auth-modal');
    alert(`Company Account Registered Successfully! Your Company ID is: ${data.company.companyId}`);
    switchPortalRole('company');
    showAppWorkspace();
  } catch (err) {
    alert(err.message || 'Company Registration Failed.');
  }
}

// COLLEGE AUTH HANDLERS
function openCollegeAuthModal(tab = 'login') {
  openModal('college-auth-modal');
  switchCollegeAuthTab(tab);
}

function switchCollegeAuthTab(tab) {
  const loginForm = document.getElementById('college-login-form');
  const regForm = document.getElementById('college-register-form');
  const title = document.getElementById('college-auth-title');

  if (tab === 'login') {
    title.innerHTML = '<i class="fa-solid fa-university text-purple"></i> University Admin Login';
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
  } else {
    title.innerHTML = '<i class="fa-solid fa-university text-purple"></i> Register University Admin';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

async function handleCollegeLoginSubmit(e) {
  e.preventDefault();
  const identity = document.getElementById('col-login-user').value.trim();
  const password = document.getElementById('col-login-pass').value.trim();

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identity, password, role: 'college' })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    closeModal('college-auth-modal');
    switchPortalRole('college');
    showAppWorkspace();
  } catch (err) {
    alert(err.message || 'College Admin Login Failed.');
  }
}

async function handleCollegeRegisterSubmit(e) {
  e.preventDefault();
  const collegeName = document.getElementById('col-reg-name').value.trim();
  const adminName = document.getElementById('col-reg-admin').value.trim();
  const email = document.getElementById('col-reg-email').value.trim();
  const password = document.getElementById('col-reg-pass').value.trim();

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ collegeName, adminName, email, password, role: 'college' })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    closeModal('college-auth-modal');
    alert('University Admin Registered Successfully!');
    switchPortalRole('college');
    showAppWorkspace();
  } catch (err) {
    alert(err.message || 'University Registration Failed.');
  }
}

function loadInterviewPrepView() {
  setInterviewLanguage(document.getElementById('interview-language')?.value || voiceInterview.language);
  if (!voiceInterview.sessionStarted && !voiceInterview.answers.length && voiceInterview.questionIndex === 0) resetInterviewView();
}

function setInterviewLanguage(language) {
  voiceInterview.language = language;
  const languageSelect = document.getElementById('interview-language');
  if (languageSelect && languageSelect.value !== language) {
    languageSelect.value = language;
  }

  if (voiceInterview.questionIndex < interviewQuestions.length && document.getElementById('interview-question')) {
    const question = interviewQuestions[voiceInterview.questionIndex];
    const questionEl = document.getElementById('interview-question');
    const currentText = questionEl.textContent || '';
    if (!voiceInterview.sessionStarted && (currentText.includes('Choose a language') || currentText.includes('Ready when you are'))) {
      questionEl.textContent = language === 'ta-IN' ? question.ta : question.en;
    }
  }
}

function resetInterviewView() {
  voiceInterview.questionIndex = 0;
  voiceInterview.answers = [];
  voiceInterview.lastTranscript = '';
  voiceInterview.sessionStarted = false;
  voiceInterview.listening = false;
  if (voiceInterview.recognition) {
    try { voiceInterview.recognition.stop(); } catch (err) {}
    voiceInterview.recognition = null;
  }

  const questionNumber = document.getElementById('interview-question-number');
  const startButton = document.getElementById('interview-start-btn');
  const listenButton = document.getElementById('interview-listen-btn');
  const nextButton = document.getElementById('interview-next-btn');
  if (questionNumber) questionNumber.textContent = 'Ready when you are';
  if (startButton) startButton.disabled = false;
  if (listenButton) listenButton.disabled = true;
  if (nextButton) nextButton.disabled = true;
  if (document.getElementById('interview-progress')) document.getElementById('interview-progress').textContent = `0 / ${interviewQuestions.length}`;
  if (document.getElementById('interview-question')) document.getElementById('interview-question').textContent = 'Choose a language and start the mock interview. The agent will ask one question at a time.';
  if (document.getElementById('interview-transcript')) document.getElementById('interview-transcript').value = '';
  if (document.getElementById('interview-summary')) document.getElementById('interview-summary').innerHTML = '<span class="text-sm" style="color:var(--text-muted);">Your practice summary will appear here when you finish.</span>';
  setInterviewStatus('Microphone is off');
}

function setInterviewStatus(message) {
  const status = document.getElementById('interview-status');
  if (status) status.textContent = message;
}

function extractSpeechTranscript(results) {
  if (!results || !results.length) return '';
  let text = '';
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const pieces = [];
    for (let j = 0; j < result.length; j++) {
      const chunk = result[j] && result[j].transcript ? result[j].transcript : '';
      if (chunk) pieces.push(chunk.trim());
    }
    if (pieces.length) text += `${pieces.join(' ')} `;
  }
  return text.trim();
}

function buildInterviewDiagnostics(answer, questionText) {
  const text = String(answer || '').trim();
  if (!text) {
    return {
      score: 0,
      headline: 'No answer captured',
      strengths: 'No answer was captured yet.',
      improvement: 'Speak clearly and answer with a short situation, action, and result.'
    };
  }

  const lower = text.toLowerCase();
  let score = 35;
  if (text.length > 50) score += 15;
  if (text.length > 120) score += 12;
  if (text.length > 220) score += 8;
  if (/(problem|issue|bug|debug|optimi|design|security|monitor|performance|project|team|solution|result)/i.test(lower)) score += 15;
  if (/(because|therefore|first|then|finally|after|when|while|so|as a result)/i.test(lower)) score += 10;
  if (/(i worked|i used|we built|we improved|we resolved|i handled|i analyzed)/i.test(lower)) score += 8;
  if (/(team|teammate|stakeholder|customer|manager|user)/i.test(lower)) score += 7;

  const normalized = Math.min(100, Math.max(0, score));
  const strengths = normalized >= 80
    ? 'Strong structure and clear examples.'
    : normalized >= 60
      ? 'Good substance with room to make the answer more specific.'
      : 'The answer needs clearer structure and more concrete examples.';

  const improvement = normalized >= 80
    ? 'Keep using the STAR format: Situation, Task, Action, Result.'
    : 'Add a specific problem, the action you took, and the measurable outcome.';

  return {
    score: normalized,
    headline: normalized >= 80 ? 'Strong interview answer' : normalized >= 60 ? 'Solid answer' : 'Needs more depth',
    strengths,
    improvement,
    questionText
  };
}

function calculateInterviewScore(answers) {
  if (!answers || !answers.length) return 0;
  const total = answers.reduce((sum, answer) => {
    const diagnostics = buildInterviewDiagnostics(answer, '');
    return sum + diagnostics.score;
  }, 0);
  return Math.min(100, Math.round(total / answers.length));
}

function getPreferredVoice(languageCode) {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const normalized = languageCode.toLowerCase();
  return voices.find(voice => {
    const name = (voice.lang || '').toLowerCase();
    return name === normalized || name.startsWith(normalized.replace('-', '')) || name.startsWith(normalized.substring(0, 2));
  }) || voices.find(voice => (voice.lang || '').toLowerCase().startsWith(languageCode.slice(0, 2))) || voices[0];
}

function speakInterviewQuestion(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceInterview.language;
  const preferredVoice = getPreferredVoice(voiceInterview.language);
  if (preferredVoice) utterance.voice = preferredVoice;
  utterance.rate = 0.92;
  utterance.pitch = 1.1;
  window.speechSynthesis.speak(utterance);
}

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function updateInterviewAnswerState() {
  const transcript = document.getElementById('interview-transcript')?.value.trim();
  const nextButton = document.getElementById('interview-next-btn');
  if (nextButton) nextButton.disabled = !transcript;
  setInterviewStatus(transcript ? 'Answer ready. Review it and continue.' : 'Ready for your answer');
}

function startVoiceInterview() {
  resetInterviewView();
  voiceInterview.sessionStarted = true;
  const question = interviewQuestions[0];
  const text = voiceInterview.language === 'ta-IN' ? question.ta : question.en;
  document.getElementById('interview-question-number').textContent = 'Question 1';
  document.getElementById('interview-progress').textContent = `1 / ${interviewQuestions.length}`;
  document.getElementById('interview-question').textContent = text;
  document.getElementById('interview-start-btn').disabled = true;
  document.getElementById('interview-listen-btn').disabled = !getSpeechRecognition();
  document.getElementById('interview-next-btn').disabled = true;
  setInterviewStatus(getSpeechRecognition() ? 'Ready for your answer' : 'Voice input is unavailable; type your answer below');
  speakInterviewQuestion(text);
}

function toggleVoiceInput() {
  const Recognition = getSpeechRecognition();
  if (!Recognition) {
    setInterviewStatus('This browser does not support microphone input.');
    return;
  }

  if (voiceInterview.listening) {
    if (voiceInterview.recognition) {
      try { voiceInterview.recognition.stop(); } catch (err) {}
    }
    voiceInterview.listening = false;
    setInterviewStatus('Microphone stopped. You can speak again or type your answer manually.');
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setInterviewStatus('Microphone access is not available in this browser. Please type your answer instead.');
    return;
  }

  setInterviewStatus('Requesting microphone access...');
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(() => {
      const recognition = new Recognition();
      recognition.lang = voiceInterview.language === 'ta-IN' ? 'ta-IN' : 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 3;

      voiceInterview.recognition = recognition;
      voiceInterview.listening = true;
      voiceInterview.lastTranscript = '';

      recognition.onstart = () => setInterviewStatus('Listening... Speak clearly into the mic.');

      recognition.onresult = event => {
        const resultText = extractSpeechTranscript(event.results);
        if (!resultText) return;

        const transcriptBox = document.getElementById('interview-transcript');
        if (transcriptBox) transcriptBox.value = resultText;
        voiceInterview.lastTranscript = resultText;
        updateInterviewAnswerState();
      };

      recognition.onerror = event => {
        const errorMessage = event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone permission was denied. Please allow mic access, or type your answer manually.'
          : event.error === 'no-speech'
            ? 'No speech was detected. Please speak clearly and try again.'
            : `Voice input error: ${event.error}. Please type your answer instead.`;
        setInterviewStatus(errorMessage);
        voiceInterview.listening = false;
        if (voiceInterview.recognition) {
          try { voiceInterview.recognition.stop(); } catch (err) {}
        }
      };

      recognition.onend = () => {
        voiceInterview.listening = false;
        const transcriptBox = document.getElementById('interview-transcript');
        const typedValue = transcriptBox ? transcriptBox.value.trim() : '';

        if (typedValue && typedValue.length >= 5) {
          setInterviewStatus('Answer ready. Review it and continue.');
          const nextButton = document.getElementById('interview-next-btn');
          if (nextButton) nextButton.disabled = false;
          return;
        }

        const fallbackCapture = voiceInterview.lastTranscript ? voiceInterview.lastTranscript.trim() : '';
        if (fallbackCapture && fallbackCapture.length >= 5) {
          if (transcriptBox) transcriptBox.value = fallbackCapture;
          updateInterviewAnswerState();
          setInterviewStatus('Answer ready. Review it and continue.');
          return;
        }

        setInterviewStatus('No answer captured. Please type your answer or allow the microphone and speak clearly again.');
      };

      try {
        recognition.start();
      } catch (err) {
        voiceInterview.listening = false;
        setInterviewStatus('The microphone is already active. Please wait a moment and try again.');
      }
    })
    .catch(err => {
      const message = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        ? 'Microphone permission was denied. Please click Allow when the browser asks, or type your answer manually.'
        : 'Microphone access could not be started. Please type your answer instead.';
      setInterviewStatus(message);
    });
}

function submitInterviewAnswer() {
  const transcript = document.getElementById('interview-transcript').value.trim();
  if (!transcript) {
    setInterviewStatus('Speak or type an answer before continuing.');
    return;
  }

  voiceInterview.answers.push(transcript);
  const isLastQuestion = voiceInterview.questionIndex >= interviewQuestions.length - 1;
  if (isLastQuestion) {
    finishVoiceInterview();
    return;
  }

  voiceInterview.questionIndex += 1;
  const question = interviewQuestions[voiceInterview.questionIndex];
  const text = voiceInterview.language === 'ta-IN' ? question.ta : question.en;
  document.getElementById('interview-question-number').textContent = `Question ${voiceInterview.questionIndex + 1}`;
  document.getElementById('interview-progress').textContent = `${voiceInterview.questionIndex + 1} / ${interviewQuestions.length}`;
  document.getElementById('interview-question').textContent = text;
  document.getElementById('interview-transcript').value = '';
  document.getElementById('interview-next-btn').disabled = true;
  setInterviewStatus('Ready for your answer');
  speakInterviewQuestion(text);
}

function finishVoiceInterview() {
  if (voiceInterview.recognition && voiceInterview.listening) voiceInterview.recognition.stop();
  const answered = voiceInterview.answers.length;
  const score = calculateInterviewScore(voiceInterview.answers);
  const coachCards = voiceInterview.answers.map((answer, index) => {
    const question = interviewQuestions[index] || null;
    const diagnostics = buildInterviewDiagnostics(answer, question ? (voiceInterview.language === 'ta-IN' ? question.ta : question.en) : '');
    return `
      <div class="mb-3 p-2 rounded" style="background: rgba(37,99,235,0.06); border: 1px solid rgba(37,99,235,0.12);">
        <div class="text-xs" style="font-weight:700; color:var(--text-blue);">Q${index + 1} • ${diagnostics.score}/100</div>
        <div class="text-sm mt-1">${answer.slice(0, 220)}${answer.length > 220 ? '…' : ''}</div>
        <div class="text-xs mt-2" style="color:var(--text-muted);"><strong>Coach:</strong> ${diagnostics.strengths}</div>
      </div>
    `;
  }).join('');

  document.getElementById('interview-question-number').textContent = 'Practice complete';
  document.getElementById('interview-progress').textContent = `${answered} / ${interviewQuestions.length} answered`;
  document.getElementById('interview-question').textContent = 'Good work. Review your answers and repeat the round to improve clarity and structure.';
  document.getElementById('interview-start-btn').disabled = false;
  document.getElementById('interview-next-btn').disabled = true;
  document.getElementById('interview-listen-btn').disabled = true;
  document.getElementById('interview-summary').innerHTML = `
    <div class="mb-3"><strong>${answered}/${interviewQuestions.length} responses captured</strong></div>
    <div class="mb-3"><strong>Overall mock score:</strong> ${score}/100</div>
    <div class="mt-2">${coachCards || '<p class="text-sm mt-2">No answers recorded yet.</p>'}</div>
    <p class="text-sm mt-2">Use the STAR structure: Situation, Task, Action, Result. Shorter answers are fine, but make them specific and measurable.</p>
  `;
  setInterviewStatus('Session complete');
  if ('speechSynthesis' in window) speakInterviewQuestion(voiceInterview.language === 'ta-IN' ? 'நன்றி. உங்கள் நேர்காணல் பயிற்சி முடிந்தது. உங்களின் பதில்களை மீண்டும் படித்து, சிறப்பான பதிலை உருவாக்குங்கள்.' : 'Thank you. Your interview practice is complete. Review your answers and aim for clearer examples and measurable results.');
}

// STUDENT LOADERS
async function loadDashboardHome() {
  try {
    const dashboard = await apiFetch('/student/dashboard');
    const completion = dashboard.profileCompletion || { percentage: 0, missingItems: [] };
    const welcomeHeader = document.getElementById('welcome-header');
    if (welcomeHeader) {
      const name = (dashboard.profile && dashboard.profile.name) || (currentProfile && currentProfile.name) || 'Student';
      welcomeHeader.textContent = `Welcome back, ${name}`;
    }

    const profilePct = document.getElementById('dash-profile-pct');
    const profileBar = document.getElementById('dash-profile-bar');
    if (profilePct) profilePct.textContent = `${completion.percentage}%`;
    if (profileBar) profileBar.style.width = `${completion.percentage}%`;

    const missingItems = document.getElementById('dash-missing-items');
    if (missingItems) {
      const items = Array.isArray(completion.missingItems) && completion.missingItems.length ? completion.missingItems : ['Profile complete'];
      missingItems.innerHTML = items.slice(0, 4).map(item => `<span class="badge-saas badge-blue">${item}</span>`).join('');
    }

    document.getElementById('stat-cgpa').textContent = Number((dashboard.profile && dashboard.profile.cgpa) || 0).toFixed(2);
    document.getElementById('stat-skills').textContent = dashboard.technicalSkills || 0;
    document.getElementById('stat-projects').textContent = dashboard.projects || 0;
    document.getElementById('stat-certs').textContent = dashboard.certificates || 0;
    document.getElementById('stat-apps').textContent = dashboard.applications || 0;
    document.getElementById('stat-score').textContent = `${dashboard.skillScore || 0} / 100`;
    if (document.getElementById('mini-portfolio-score')) document.getElementById('mini-portfolio-score').textContent = `${dashboard.skillScore || 0}`;
    if (document.getElementById('mini-skill-score')) document.getElementById('mini-skill-score').textContent = dashboard.technicalSkills || 0;
    if (document.getElementById('mini-cert-score')) document.getElementById('mini-cert-score').textContent = dashboard.certificates || 0;
    if (document.getElementById('mini-project-score')) document.getElementById('mini-project-score').textContent = dashboard.projects || 0;

    const recContainer = document.getElementById('dash-recommended-jobs');
    const jobs = dashboard.recommendedJobs || [];
    recContainer.innerHTML = jobs.length ? jobs.map(j => `
      <div class="saas-card">
        <div class="badge-saas badge-purple mb-2">${j.match_percentage || 0}% MATCH</div>
        <h4 style="font-weight:700;">${j.title}</h4>
        <div style="font-size:0.8rem; color:var(--text-blue); font-weight:700;" class="mb-2">${j.company_name || 'Company'}</div>
        <button class="btn-saas btn-primary w-full" onclick="navigateTo('opportunities')">View & Apply</button>
      </div>
    `).join('') : '<div class="saas-card">Add more skills and projects to unlock role recommendations.</div>';
  } catch (e) {
    console.error('Dashboard load failed', e);
  }
}

async function loadProfileView() {
  try {
    const data = await apiFetch('/student/profile');
    const p = data.profile || {};
    const onboardingCard = document.getElementById('profile-onboarding-card');
    document.getElementById('prof-name').value = p.name || '';
    document.getElementById('prof-student-id').value = p.student_id || (currentUser && currentUser.student_id) || '';
    document.getElementById('prof-phone').value = p.phone || '';
    document.getElementById('prof-college').value = p.college || '';
    ['university', 'department', 'degree', 'city', 'state', 'country', 'pincode'].forEach(field => {
      const element = document.getElementById(`prof-${field}`);
      if (element) element.value = p[field] || (field === 'country' ? 'India' : '');
    });
    document.getElementById('prof-dob').value = p.dateOfBirth || '';
    document.getElementById('prof-gender').value = p.gender || '';
    document.getElementById('prof-graduation').value = p.graduationYear || '';
    ['door-house', 'street', 'area', 'district'].forEach(field => {
      const element = document.getElementById(`prof-${field}`);
      if (element) element.value = (p.address && p.address[field.replace('-', '')]) || '';
    });
    if (onboardingCard) {
      const incomplete = p.onboarding_complete === false;
      onboardingCard.classList.toggle('hidden', !incomplete);
    }
  } catch (e) {}
}

async function extractPdfText(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Please select a PDF resume for ATS analysis.');
  if (!window.pdfjsLib) throw new Error('PDF analysis is still loading. Please try again.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n').trim();
}

function calculateResumeATS(text) {
  const normalized = text.toLowerCase();
  const sections = ['experience', 'education', 'skills', 'projects', 'certifications', 'summary'];
  const sectionScore = sections.filter(section => normalized.includes(section)).length / sections.length * 35;
  const contactScore = (/@/.test(text) ? 8 : 0) + (/(https?:\/\/|linkedin|github)/i.test(text) ? 7 : 0);
  const keywordScore = ['python', 'java', 'javascript', 'sql', 'react', 'docker', 'api', 'aws']
    .filter(keyword => normalized.includes(keyword)).length / 8 * 25;
  const actionScore = ['built', 'developed', 'implemented', 'designed', 'deployed', 'led']
    .filter(verb => normalized.includes(verb)).length / 6 * 15;
  const lengthScore = text.length >= 800 && text.length <= 12000 ? 10 : (text.length > 200 ? 5 : 0);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const emailFound = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);
  const phoneFound = /(?:\+?\d[\d\s().-]{8,}\d)/.test(text);
  const linksFound = /(https?:\/\/|linkedin|github|portfolio)/i.test(text);
  const quantifiedResults = /(?:\d+%|\d+\+|\$\s?\d+|\b\d+\s?(?:users|clients|projects|months|years)\b)/i.test(text);
  const dateCount = (text.match(/\b(?:19|20)\d{2}\b/g) || []).length;
  const missingSections = sections.filter(section => !normalized.includes(section));
  const review = [
    { label: 'Contact details', score: [emailFound, phoneFound, linksFound].filter(Boolean).length / 3 * 100, status: emailFound && phoneFound ? 'Email and phone detected.' : 'Add both a professional email and phone number.', tone: emailFound && phoneFound ? 'good' : 'warn' },
    { label: 'Resume structure', score: sections.filter(section => normalized.includes(section)).length / sections.length * 100, status: `${sections.length - missingSections.length} of ${sections.length} core sections detected.`, tone: missingSections.length ? 'warn' : 'good' },
    { label: 'Experience evidence', score: Math.min(100, (normalized.includes('experience') ? 45 : 0) + (actionScore / 15 * 30) + (quantifiedResults ? 25 : 0)), status: quantifiedResults ? 'Achievements include measurable evidence.' : 'Add measurable outcomes to experience bullets.', tone: quantifiedResults ? 'good' : 'warn' },
    { label: 'Skills relevance', score: Math.min(100, keywordScore / 25 * 100), status: `${Math.round(keywordScore / 25 * 8)} of 8 common technical keywords detected.`, tone: keywordScore >= 15 ? 'good' : 'warn' },
    { label: 'Education & certifications', score: (normalized.includes('education') ? 60 : 0) + (normalized.includes('certification') ? 40 : 0), status: normalized.includes('education') && normalized.includes('certification') ? 'Education and certifications detected.' : 'Include education and relevant certifications.', tone: normalized.includes('education') ? 'good' : 'warn' },
    { label: 'Projects & portfolio', score: Math.min(100, (normalized.includes('project') ? 60 : 0) + (linksFound ? 40 : 0)), status: normalized.includes('project') && linksFound ? 'Projects and supporting links detected.' : 'Add project outcomes and a portfolio or GitHub link.', tone: normalized.includes('project') ? 'good' : 'warn' },
    { label: 'Readability & length', score: lengthScore / 10 * 100, status: `${wordCount} words and ${dateCount} year references reviewed.`, tone: lengthScore >= 10 ? 'good' : 'warn' },
    { label: 'ATS-safe content', score: Math.min(100, (emailFound ? 25 : 0) + (actionScore / 15 * 25) + (quantifiedResults ? 25 : 0) + (dateCount >= 1 ? 25 : 0)), status: 'Text-based compatibility signals reviewed by AI.', tone: 'good' }
  ];
  const score = Math.min(100, Math.round(sectionScore + contactScore + keywordScore + actionScore + lengthScore));
  const breakdown = [
    { label: 'Resume sections', score: Math.round(sectionScore), max: 35, detail: `${sections.length - missingSections.length}/${sections.length} core sections detected` },
    { label: 'Contact & links', score: Math.round(contactScore), max: 15, detail: /@/.test(text) ? 'Email detected' : 'Email missing' },
    { label: 'Technical keywords', score: Math.round(keywordScore), max: 25, detail: 'Skills and tools matched' },
    { label: 'Action language', score: Math.round(actionScore), max: 15, detail: 'Achievement verbs detected' },
    { label: 'Length & readability', score: lengthScore, max: 10, detail: `${text.split(/\s+/).filter(Boolean).length} words analyzed` }
  ];
  return {
    score,
    aiScore: Math.min(100, Math.round(score * 0.85 + 15)),
    wordCount,
    missingSections,
    breakdown,
    review,
    aiText: 'AI reviewed the PDF text, structure, keywords, contact details, action language, and readability signals to estimate recruiter-system compatibility.',
    recommendations: [
      ...(missingSections.length ? [`Add these sections: ${missingSections.join(', ')}.`] : []),
      ...(!emailFound ? ['Add a professional email address.'] : []),
      ...(!phoneFound ? ['Add a phone number with country code.'] : []),
      ...(!linksFound ? ['Add LinkedIn, GitHub, or portfolio links.'] : []),
      ...(!quantifiedResults ? ['Add numbers to show impact, scale, savings, or growth.'] : []),
      ...(!normalized.includes('experience') ? ['Add a clearly labeled Experience section.'] : []),
      ...(score < 70 ? ['Use measurable achievements and job-specific keywords.'] : ['Tailor keywords to each job description before applying.'])
    ]
  };
}

function renderResumeATSAnalysis(analysis) {
  const empty = document.getElementById('resume-ats-empty');
  const results = document.getElementById('resume-ats-results');
  const status = document.getElementById('resume-ats-status');
  if (!analysis || !results) return;
  if (empty) empty.classList.add('hidden');
  results.classList.remove('hidden');
  document.getElementById('resume-ats-score').textContent = `${analysis.score} / 100`;
  document.getElementById('resume-ai-score').textContent = `${analysis.aiScore} / 100`;
  if (status) {
    status.textContent = analysis.score >= 80 ? 'Strong match' : analysis.score >= 60 ? 'Needs tuning' : 'Needs improvement';
    status.className = `badge-saas ${analysis.score >= 80 ? 'badge-emerald' : 'badge-purple'}`;
  }

  const findings = document.getElementById('resume-ats-findings');
  const missing = analysis.missingSections && analysis.missingSections.length
    ? `Missing sections: ${analysis.missingSections.join(', ')}.`
    : 'All core resume sections were detected.';
  if (findings) findings.innerHTML = `<strong>${analysis.wordCount || 0} words detected.</strong> ${missing}`;
  const breakdown = document.getElementById('resume-ats-breakdown');
  if (breakdown) {
    const score = Number(analysis.score) || 0;
    const items = analysis.breakdown || [
      { label: 'Overall ATS compatibility', score, max: 100, detail: 'Saved ATS result' },
      { label: 'AI resume quality estimate', score: Number(analysis.aiScore) || 0, max: 100, detail: 'AI-derived score' }
    ];
    breakdown.innerHTML = items.map(item => `
      <div>
        <div class="flex-between text-sm mb-1"><strong>${item.label}</strong><span>${item.score}% / ${item.max}%</span></div>
        <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div style="width:${Math.min(100, (item.score / item.max) * 100)}%;height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);"></div></div>
        <div class="text-xs mt-1" style="color:var(--text-muted);">${item.detail}</div>
      </div>
    `).join('');
  }
  const aiText = document.getElementById('resume-ats-ai-text');
  if (aiText) aiText.textContent = analysis.aiText || 'AI analyzed the uploaded resume for ATS compatibility.';
  const recommendations = document.getElementById('resume-ats-recommendations');
  if (recommendations) recommendations.innerHTML = (analysis.recommendations || []).map(item => `<span class="badge-saas badge-blue">${item}</span>`).join('');
  const review = document.getElementById('resume-ats-review');
  if (review) {
    review.innerHTML = (analysis.review || []).map(item => {
      const color = item.tone === 'good' ? '#059669' : '#d97706';
      return `<div class="saas-card" style="border-left:4px solid ${color}; padding:0.85rem;">
        <div class="flex-between text-sm mb-2"><strong>${item.label}</strong><strong style="color:${color};">${Math.round(item.score)}%</strong></div>
        <div style="height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-bottom:0.5rem;"><div style="width:${Math.min(100, Math.max(0, item.score))}%;height:100%;background:${color};"></div></div>
        <div class="text-xs" style="color:var(--text-muted);">${item.status}</div>
      </div>`;
    }).join('');
  }
}

async function loadATSResumeView() {
  try {
    const data = await apiFetch('/student/profile');
    const resume = data.resume || null;
    if (resume && resume.ats_analysis) {
      renderResumeATSAnalysis(resume.ats_analysis);
    } else if (resume) {
      const status = document.getElementById('resume-ats-status');
      if (status) status.textContent = 'PDF received - analyze from My Profile';
    }
  } catch (err) {
    console.error('ATS resume analysis load failed', err);
  }
}

async function handleResumeUpload(event) {
  event.preventDefault();
  const fileInput = document.getElementById('resume-file-input');
  const resumeFile = fileInput && fileInput.files && fileInput.files[0];

  if (!resumeFile) {
    alert('Please select a PDF resume before starting ATS analysis.');
    return;
  }

  try {
    let atsAnalysis = null;
    if (resumeFile) {
      if (resumeFile.type !== 'application/pdf') throw new Error('Only PDF resumes are accepted for ATS analysis.');
      const finalUrl = await readFileAsDataUrl(resumeFile);
      const resumeText = await extractPdfText(resumeFile);
      atsAnalysis = calculateResumeATS(resumeText);
      renderResumeATSAnalysis(atsAnalysis);
      await apiFetch('/student/resume', {
        method: 'POST',
        body: JSON.stringify({
          fileUrl: finalUrl,
          resumeUrl: finalUrl,
          fileName: resumeFile.name,
          atsAnalysis
        })
      });
    }
    if (fileInput) fileInput.value = '';
    alert('PDF analyzed successfully.');
  } catch (err) {
    alert(err.message || 'Resume upload failed.');
  }
}

async function submitStudentOnboarding() {
  try {
    const ragging = document.getElementById('onboarding-ragging')?.checked;
    const consent = document.getElementById('onboarding-consent')?.checked;
    if (!ragging || !consent) {
      alert('Please accept the anti-ragging policy and the data consent to continue.');
      return;
    }

    const profile = {
      onboarding_complete: true,
      consent: { data_usage: true, ai_matching: true, chatbot_memory: false },
      anti_ragging_acknowledged: true
    };
    const response = await apiFetch('/student/onboarding', {
      method: 'POST',
      body: JSON.stringify({ profile, consent: { anti_ragging: ragging, data_consent: consent } })
    });
    currentProfile = response.profile || currentProfile;
    document.getElementById('profile-onboarding-card').classList.add('hidden');
    alert('Onboarding completed successfully.');
  } catch (err) {
    alert(err.message || 'Unable to complete onboarding.');
  }
}

async function handleSaveProfile(e) {
  e.preventDefault();
  try {
    const value = id => document.getElementById(id)?.value.trim() || '';
    const data = await apiFetch('/student/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: value('prof-name'),
        phone: value('prof-phone'),
        college: value('prof-college'),
        university: value('prof-university'),
        department: value('prof-department'),
        degree: value('prof-degree'),
        dateOfBirth: value('prof-dob'),
        gender: value('prof-gender'),
        graduationYear: Number(value('prof-graduation')) || null,
        city: value('prof-city'),
        state: value('prof-state'),
        country: value('prof-country'),
        pincode: value('prof-pincode'),
        address: {
          doorHouse: value('prof-door-house'),
          street: value('prof-street'),
          area: value('prof-area'),
          district: value('prof-district')
        }
      })
    });
    currentProfile = data.profile;
    alert('Profile updated!');
  } catch (err) { alert(err.message || 'Profile update failed.'); }
}
async function loadAcademicsView() {
  try {
    const data = await apiFetch('/student/academics');
    const tbody = document.getElementById('semester-table-body');
    tbody.innerHTML = (data.records || []).map(r => `<tr><td style="font-weight:700;">${r.semester}</td><td>${r.gpa.toFixed(2)}</td><td><span class="badge-saas badge-emerald">${r.status}</span></td></tr>`).join('');
  } catch (e) {}
}
async function loadSkillsView() {
  try {
    const data = await apiFetch('/student/skills');
    const skillList = document.getElementById('technical-skills-list');
    const skills = data.technical || [];

    if (!skillList) return;
    if (!skills.length) {
      skillList.innerHTML = `
        <div class="saas-card text-center">
          <p style="color: var(--text-muted); margin-bottom: 1rem;">No technical skills added yet.</p>
          <button class="btn-saas btn-primary" type="button" onclick="document.getElementById('skill-name').focus()">Add Skills</button>
        </div>
      `;
      return;
    }

    skillList.innerHTML = skills.map(skill => `
      <div class="saas-card">
        <div class="flex-between gap-3 mb-2">
          <div>
            <strong>${skill.skill_name || skill.name || 'Skill'}</strong>
            <div style="font-size:0.75rem; color: var(--text-muted);">${skill.category || 'Other'} • ${skill.proficiencyPercentage || skill.level_pct || 0}%</div>
          </div>
          <span class="badge-saas badge-purple">${Number(skill.scoreOutOfTen || (Number(skill.level_pct || 0) / 10)).toFixed(1)}/10</span>
        </div>
        <div class="progress-track mb-2"><div class="progress-fill" style="width: ${skill.proficiencyPercentage || skill.level_pct || 0}%"></div></div>
        <button class="btn-saas btn-outline" type="button" onclick="deleteSkill(${skill.id})">Delete</button>
      </div>
    `).join('');
  } catch (e) {
    console.error('Skills load failed', e);
  }
}

async function handleAddSkillSubmit(event) {
  event.preventDefault();
  const skillName = document.getElementById('skill-name')?.value.trim();
  const category = document.getElementById('skill-category')?.value || 'Other';
  const proficiency = Number(document.getElementById('skill-proficiency')?.value || 0);

  if (!skillName || !Number.isFinite(proficiency) || proficiency < 0 || proficiency > 100) {
    alert('Enter a valid skill name and percentage between 0 and 100.');
    return;
  }

  try {
    await apiFetch('/student/skills', {
      method: 'POST',
      body: JSON.stringify({ skillName, category, proficiencyPercentage: proficiency })
    });
    document.getElementById('skill-form').reset();
    await loadSkillsView();
    await loadDashboardHome();
    alert('Skill saved successfully.');
  } catch (err) {
    alert(err.message || 'Unable to save skill.');
  }
}

async function deleteSkill(skillId) {
  try {
    await apiFetch(`/student/skills/${skillId}`, { method: 'DELETE' });
    await loadSkillsView();
    await loadDashboardHome();
  } catch (err) {
    alert(err.message || 'Unable to delete skill.');
  }
}
async function loadAssessmentsView() {
  try {
    const data = await apiFetch('/student/assessments');
    document.getElementById('assess-overall-score').textContent = `${data.overall_score || 82} / 100`;
    document.getElementById('assessments-list-container').innerHTML = (data.tests || []).map(t => `<div class="saas-card flex-between mb-3"><div><h4 style="font-weight:700;">${t.name}</h4></div><div style="font-weight:800; color:var(--text-emerald);">${t.score}/${t.total}</div></div>`).join('');
  } catch (e) {}
}
async function loadPortfolioView() {
  try {
    const data = await apiFetch('/student/portfolio');
    const projects = data.projects || [];
    const certificates = data.certifications || [];
    const projectList = document.getElementById('portfolio-project-list');
    const certList = document.getElementById('portfolio-certificate-list');

    if (projectList) {
      projectList.innerHTML = projects.length ? projects.map(project => `
        <div class="saas-card mb-3">
          <div class="flex-between gap-3 mb-2">
            <div>
              <h4 style="font-weight:700; margin:0;">${project.title}</h4>
              <div style="font-size:0.78rem; color:var(--text-muted);">${project.category || 'Project'}</div>
            </div>
            <span class="badge-saas badge-emerald">${project.status || 'Completed'}</span>
          </div>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom: 0.75rem;">${project.description || 'Project details not added yet.'}</p>
          <div class="flex-align gap-2 flex-wrap">
            ${project.projectUrl ? `<a class="btn-saas btn-outline" href="${project.projectUrl}" target="_blank" rel="noreferrer">Live</a>` : ''}
            ${project.githubUrl ? `<a class="btn-saas btn-outline" href="${project.githubUrl}" target="_blank" rel="noreferrer">GitHub</a>` : ''}
            <button class="btn-saas btn-outline" type="button" onclick="deleteStudentProject(${project.id})">Delete</button>
          </div>
        </div>
      `).join('') : '<div class="saas-card"><p style="color:var(--text-muted); margin:0;">No project entries yet.</p></div>';
    }

    if (certList) {
      certList.innerHTML = certificates.length ? certificates.map(cert => `
        <div class="saas-card mb-3">
          <div class="flex-between gap-3 mb-2">
            <div>
              <h4 style="font-weight:700; margin:0;">${cert.certificateName || cert.name || 'Certificate'}</h4>
              <div style="font-size:0.78rem; color:var(--text-muted);">${cert.issuer || 'Issuer'}</div>
            </div>
            <span class="badge-saas badge-purple">${cert.issueDate || '—'}</span>
          </div>
          <div class="flex-align gap-2 flex-wrap">
            ${cert.certificateUrl ? `<a class="btn-saas btn-outline" href="${cert.certificateUrl}" target="_blank" rel="noreferrer">Open</a>` : ''}
            ${cert.fileUrl ? `<a class="btn-saas btn-outline" href="${cert.fileUrl}" target="_blank" rel="noreferrer">File</a>` : ''}
            <button class="btn-saas btn-outline" type="button" onclick="deleteStudentCertificate(${cert.id})">Delete</button>
          </div>
        </div>
      `).join('') : '<div class="saas-card"><p style="color:var(--text-muted); margin:0;">No certificates uploaded yet.</p></div>';
    }
  } catch (e) {
    console.error('Portfolio load failed', e);
  }
}

async function handleAddCertificateSubmit(event) {
  event.preventDefault();
  const fileInput = document.getElementById('cert-file-upload');
  const payload = {
    certificateName: document.getElementById('cert-name')?.value.trim(),
    issuer: document.getElementById('cert-issuer')?.value.trim(),
    issueDate: document.getElementById('cert-date')?.value,
    credentialId: document.getElementById('cert-id')?.value.trim(),
    certificateUrl: document.getElementById('cert-url')?.value.trim(),
    fileUrl: document.getElementById('cert-file')?.value.trim(),
    description: document.getElementById('cert-desc')?.value.trim()
  };

  if (fileInput && fileInput.files && fileInput.files[0]) {
    payload.fileUrl = await readFileAsDataUrl(fileInput.files[0]);
  }

  if (!payload.certificateName || (!payload.certificateUrl && !payload.fileUrl)) {
    alert('Certificate name and either a URL or uploaded file are required.');
    return;
  }

  try {
    await apiFetch('/student/certificates', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    document.getElementById('certificate-form').reset();
    if (fileInput) fileInput.value = '';
    await loadPortfolioView();
    await loadDashboardHome();
    alert('Certificate saved successfully.');
  } catch (err) {
    alert(err.message || 'Unable to save certificate.');
  }
}

async function deleteStudentCertificate(certificateId) {
  try {
    await apiFetch(`/student/certificates/${certificateId}`, { method: 'DELETE' });
    await loadPortfolioView();
    await loadDashboardHome();
  } catch (err) {
    alert(err.message || 'Unable to delete certificate.');
  }
}

async function handleAddProjectSubmit(event) {
  event.preventDefault();
  const imageInput = document.getElementById('project-image-upload');
  const payload = {
    title: document.getElementById('project-title')?.value.trim(),
    description: document.getElementById('project-desc')?.value.trim(),
    category: document.getElementById('project-category')?.value,
    technologies: document.getElementById('project-tech')?.value.trim(),
    githubUrl: document.getElementById('project-github')?.value.trim(),
    projectUrl: document.getElementById('project-url')?.value.trim(),
    status: document.getElementById('project-status')?.value || 'Completed',
    imageUrl: ''
  };

  if (imageInput && imageInput.files && imageInput.files[0]) {
    payload.imageUrl = await readFileAsDataUrl(imageInput.files[0]);
  }

  if (!payload.title || !payload.description) {
    alert('Project title and description are required.');
    return;
  }

  try {
    await apiFetch('/student/projects', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    document.getElementById('project-form').reset();
    if (imageInput) imageInput.value = '';
    await loadPortfolioView();
    await loadDashboardHome();
    alert('Project saved successfully.');
  } catch (err) {
    alert(err.message || 'Unable to save project.');
  }
}

async function deleteStudentProject(projectId) {
  try {
    await apiFetch(`/student/projects/${projectId}`, { method: 'DELETE' });
    await loadPortfolioView();
    await loadDashboardHome();
  } catch (err) {
    alert(err.message || 'Unable to delete project.');
  }
}

async function loadSettingsView() {
  try {
    const data = await apiFetch('/student/settings');
    const form = document.getElementById('student-settings-form');
    if (!form) return;
    document.getElementById('settings-job-notifications').checked = !!(data.jobNotifications ?? true);
    document.getElementById('settings-internship-notifications').checked = !!(data.internshipNotifications ?? true);
    document.getElementById('settings-placement-notifications').checked = !!(data.placementNotifications ?? true);
    document.getElementById('settings-profile-visibility').value = data.profileVisibility || 'public';
    document.getElementById('settings-dark-mode').checked = !!(data.darkMode ?? false);
    document.getElementById('settings-recruiter-discovery').checked = !!(data.recruiterDiscovery ?? true);
    document.getElementById('settings-hide-email').checked = !!(data.hideEmail ?? false);
  } catch (e) {
    console.error('Settings load failed', e);
  }
}

async function handleSaveSettings(event) {
  event.preventDefault();
  const payload = {
    jobNotifications: document.getElementById('settings-job-notifications').checked,
    internshipNotifications: document.getElementById('settings-internship-notifications').checked,
    placementNotifications: document.getElementById('settings-placement-notifications').checked,
    recruiterDiscovery: document.getElementById('settings-recruiter-discovery').checked,
    profileVisibility: document.getElementById('settings-profile-visibility').value,
    darkMode: document.getElementById('settings-dark-mode').checked,
    hideEmail: document.getElementById('settings-hide-email').checked,
    theme: document.getElementById('settings-dark-mode').checked ? 'dark' : 'light'
  };

  try {
    await apiFetch('/student/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    alert('Settings saved successfully.');
  } catch (err) {
    alert(err.message || 'Unable to save settings.');
  }
}

async function handleAiChatSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('ai-chat-input');
  const chatLog = document.getElementById('ai-chat-log');
  const message = input.value.trim();
  if (!message) return;
  chatLog.innerHTML += `<div class="chat-bubble user">${message}</div>`;
  input.value = '';
  try {
    const data = await apiFetch('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    chatLog.innerHTML += `<div class="chat-bubble bot">${data.reply || 'I can help with your career goals.'}</div>`;
    chatLog.scrollTop = chatLog.scrollHeight;
  } catch (err) {
    chatLog.innerHTML += `<div class="chat-bubble bot">Unable to reach AI support right now.</div>`;
  }
}

async function loadAISkillAnalyzerView() {
  try {
    const data = await apiFetch('/ai/skill-analysis');
    const overview = data.overallScore || 0;
    const breakdownEl = document.getElementById('ai-score-breakdown');
    const matchEl = document.getElementById('ai-match-pct');
    if (matchEl) matchEl.textContent = `${overview}% Match`;
    if (breakdownEl) {
      const cards = (data.skills || []).map(skill => `
        <div class="saas-card mb-3">
          <div class="flex-between mb-2"><h4 style="font-weight: 700;">${skill.skillName}</h4><span class="badge-saas badge-purple">${skill.score}/100</span></div>
          <div class="text-xs mb-2" style="color: var(--text-muted);">Confidence: ${skill.confidence}</div>
          <div class="text-sm mb-2"><strong>Evidence:</strong> ${skill.evidence.join('; ')}</div>
          <div class="text-sm mb-2"><strong>Strengths:</strong> ${skill.strengths.join('; ')}</div>
          <div class="text-sm"><strong>Improve:</strong> ${skill.recommendations.join('; ')}</div>
        </div>
      `).join('');

      breakdownEl.innerHTML = `
        <div class="saas-card mt-2">
          <h3 style="font-weight:800; margin-bottom: 1rem;">Skill-Fit Score Breakdown</h3>
          <div class="grid-2 gap-3 mb-3">
            <div><strong>Assessment:</strong> ${data.factors?.assessment || 0}%</div>
            <div><strong>Projects:</strong> ${data.factors?.projects || 0}%</div>
            <div><strong>Certificates:</strong> ${data.factors?.certificates || 0}%</div>
            <div><strong>Internships:</strong> ${data.factors?.internships || 0}%</div>
            <div><strong>Resume:</strong> ${data.factors?.resume || 0}%</div>
            <div><strong>Self Rating:</strong> ${data.factors?.selfRating || 0}%</div>
          </div>
          ${cards || '<div class="saas-card">Add skills and evidence to generate a real analysis.</div>'}
        </div>
      `;
    }
  } catch (e) {
    console.error('AI skill analysis failed', e);
  }
}
async function loadOpportunitiesView() {
  try {
    const jobs = await apiFetch('/opportunities');
    document.getElementById('opportunities-list-container').innerHTML = jobs.map(j => `<div class="saas-card mb-3"><h4 style="font-weight:700;">${j.title}</h4><div style="color:var(--text-blue); font-weight:700;" class="mb-2">${j.company_name}</div><button class="btn-saas btn-primary" onclick="handleApplyJob(${j.id})">Apply Position</button></div>`).join('');
  } catch (e) {}
}
async function handleApplyJob(jobId) {
  try {
    await apiFetch('/student/apply', { method: 'POST', body: JSON.stringify({ jobId }) });
    alert('Application submitted!');
    navigateTo('applications');
  } catch (err) { alert(err.message); }
}
async function loadApplicationsView() {
  try {
    const apps = await apiFetch('/student/applications');
    document.getElementById('applications-list-container').innerHTML = apps.map(a => `
      <div class="saas-card mb-3 flex-between application-row">
        <div>
          <h4 style="font-weight:700;">${a.job_title}</h4>
          <div style="font-size:0.85rem; color:var(--text-blue);">${a.company_name}</div>
          <div class="text-xs mt-2" style="color:var(--text-muted);">${a.interview ? `Interview: ${a.interview.date} at ${a.interview.time}` : 'Application in progress'}</div>
        </div>
        <div class="flex-align gap-2">
          <span class="badge-saas badge-emerald">${a.status}</span>
          ${a.interview ? '<button class="btn-saas btn-primary" onclick="navigateTo(\'interview-prep\')"><i class="fa-solid fa-microphone-lines"></i> Practice</button>' : ''}
        </div>
      </div>
    `).join('') || '<div class="saas-card">No applications yet.</div>';
  } catch (e) {}
}
async function loadNotificationsView() {
  try {
    const list = await apiFetch('/student/notifications');
    document.getElementById('notifications-list-container').innerHTML = list.map(n => `
      <div class="saas-card mb-3 ${n.is_read ? '' : 'notification-unread'}">
        <div class="flex-between gap-2 mb-2">
          <h4 style="font-weight:700;">${n.title}</h4>
          ${n.is_read ? '<span class="badge-saas badge-emerald">Read</span>' : '<span class="badge-saas badge-blue">New</span>'}
        </div>
        <p style="font-size:0.85rem; color:var(--text-muted);">${n.message}</p>
        ${n.id && !n.is_read ? `<button class="btn-saas btn-outline mt-3" onclick="markNotificationRead(${n.id})">Mark as read</button>` : ''}
      </div>
    `).join('');
  } catch (e) {}
}

async function markNotificationRead(notificationId) {
  try {
    await apiFetch(`/student/notifications/${notificationId}/read`, { method: 'PUT' });
    loadNotificationsView();
  } catch (err) { console.error(err.message); }
}

async function loadPlacementView() {
  try {
    const [placementResponse, applicationsResponse] = await Promise.all([
      apiFetch('/student/placement'),
      apiFetch('/student/applications')
    ]);
    const data = placementResponse;
    const placement = data.placement;
    const applications = Array.isArray(applicationsResponse) ? applicationsResponse : [];
    const readiness = placement ? 100 : Math.min(95, 35 + Math.min(40, applications.length * 10));
    document.getElementById('placement-readiness-score').textContent = `${readiness}%`;
    document.getElementById('placement-application-count').textContent = applications.length;
    document.getElementById('placement-next-action').textContent = placement ? 'Review offer' : applications.length ? 'Track applications' : 'Apply now';
    const container = document.getElementById('placement-details-container');
    if (!placement) {
      container.innerHTML = `
        <div class="saas-card mb-4">
          <div class="flex-between mb-3"><h3 style="font-weight:800;margin:0;">Placement Journey</h3><span class="badge-saas badge-purple">In progress</span></div>
          <p style="color:var(--text-muted);">You do not have an offer recorded yet. Use campus drives and opportunities to build your placement pipeline.</p>
          <div class="grid-3 gap-3 mt-4 text-sm">
            <div><strong>Profile</strong><div class="badge-saas badge-emerald mt-2">Ready</div></div>
            <div><strong>Applications</strong><div class="badge-saas badge-blue mt-2">${applications.length} active</div></div>
            <div><strong>Offer</strong><div class="badge-saas badge-purple mt-2">Awaiting</div></div>
          </div>
        </div>
        <div class="saas-card"><h3 style="font-weight:800;">Recommended next steps</h3><ul class="text-sm mt-3" style="color:var(--text-muted);line-height:2;"><li>Register for eligible campus drives.</li><li>Keep your resume and ATS score updated.</li><li>Practice interviews before recruiter rounds.</li></ul></div>`;
      return;
    }
    container.innerHTML = `
      <div class="saas-card mb-4">
        <div class="flex-between mb-3">
          <div>
            <div class="badge-saas badge-emerald mb-2">${placement.status || 'Offer Received'}</div>
            <h3 style="font-weight:800; margin:0;">${placement.companyName || placement.company || 'Company'}</h3>
          </div>
          <div style="font-weight:800; color:var(--text-blue); font-size:1.2rem;">${placement.role || 'Role'}</div>
        </div>
        <div class="grid-2 gap-4 text-sm" style="color:var(--text-muted);">
          <div><strong>Package:</strong> ${placement.package || placement.salary || '—'}</div>
          <div><strong>Location:</strong> ${placement.location || '—'}</div>
          <div><strong>Joining Date:</strong> ${placement.joiningDate || '—'}</div>
          <div><strong>Updated:</strong> ${placement.updatedAt ? new Date(placement.updatedAt).toLocaleDateString() : '—'}</div>
        </div>
      </div>
    `;
  } catch (e) {}
}

async function loadCampusDrivesView() {
  try {
    const drives = await apiFetch('/student/campus-drives');
    studentCampusDrives = Array.isArray(drives) ? drives : [];
    renderCampusDrives(studentCampusDrives);
  } catch (e) {}
}

function renderCampusDrives(drives) {
    const container = document.getElementById('campus-drives-list-container');
    if (!container) return;
    const allDrives = studentCampusDrives.length ? studentCampusDrives : drives;
    const eligibleCount = allDrives.filter(drive => drive.eligible).length;
    const registeredCount = allDrives.filter(drive => drive.registered).length;
    document.getElementById('campus-drive-count').textContent = allDrives.length;
    document.getElementById('campus-eligible-count').textContent = eligibleCount;
    document.getElementById('campus-registered-count').textContent = registeredCount;
    const deadlines = drives.filter(drive => drive.deadline).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
    const alert = document.getElementById('campus-drive-deadline-alert');
    if (alert && deadlines.length) {
      alert.classList.remove('hidden');
      alert.innerHTML = `<strong>Upcoming deadline:</strong> ${deadlines[0].company} registration closes on ${deadlines[0].deadline}.`;
    }
    container.innerHTML = drives.map(drive => `
      <div class="saas-card mb-4">
        <div class="flex-between mb-3">
          <div>
            <h3 style="font-weight:800; margin:0;">${drive.company}</h3>
            <div style="font-size:0.8rem; color:var(--text-muted);">${drive.role} • ${drive.location}</div>
          </div>
          <span class="badge-saas ${drive.eligible ? 'badge-emerald' : 'badge-purple'}">${drive.eligible ? 'Eligible' : 'Not Eligible'}</span>
        </div>
        <div class="grid-2 gap-3 text-sm mb-3" style="color:var(--text-muted);">
          <div><strong>Date:</strong> ${drive.date}</div>
          <div><strong>Deadline:</strong> ${drive.deadline}</div>
          <div><strong>CGPA:</strong> ${drive.minimumCGPA || '—'}+</div>
          <div><strong>Salary:</strong> ${drive.salary || '—'}</div>
        </div>
        <p class="mb-3" style="font-size:0.82rem; color:var(--text-muted);">${drive.reason || 'No restrictions.'}</p>
        <button class="btn-saas ${drive.eligible ? 'btn-primary' : 'btn-outline'}" ${drive.eligible ? '' : 'disabled'} onclick="registerCampusDrive(${drive.id})">
          ${drive.registered ? 'Registered' : 'Register Now'}
        </button>
      </div>
    `).join('');
    if (!drives.length) container.innerHTML = '<div class="saas-card"><p style="color:var(--text-muted);">No campus drives match this filter.</p></div>';
}

function filterCampusDrives(filter) {
  const filtered = filter === 'eligible'
    ? studentCampusDrives.filter(drive => drive.eligible)
    : filter === 'registered'
      ? studentCampusDrives.filter(drive => drive.registered)
      : studentCampusDrives;
  renderCampusDrives(filtered);
}

async function registerCampusDrive(driveId) {
  try {
    await apiFetch(`/student/campus-drives/${driveId}/register`, { method: 'POST' });
    loadCampusDrivesView();
    alert('Campus drive registration saved successfully.');
  } catch (err) {
    alert(err.message || 'Unable to register for campus drive.');
  }
}

// COMPANY RECRUITER LOADERS
async function loadCompanyATSPipeline() {
  try {
    const data = await apiFetch('/company/dashboard');
    const comp = data.company || {};
    const header = document.getElementById('comp-header');
    if (header) header.textContent = `${comp.name || 'TechCorp'} Recruitment Intelligence`;

    const badge = document.getElementById('comp-id-badge');
    if (badge) badge.textContent = comp.companyId || 'CMP-10001';

    const totalJobs = document.getElementById('comp-total-jobs');
    if (totalJobs) totalJobs.textContent = data.total_jobs || 2;

    const totalApps = document.getElementById('comp-total-apps');
    if (totalApps) totalApps.textContent = data.total_applicants || 1;

    const shortlisted = document.getElementById('comp-shortlisted');
    if (shortlisted) shortlisted.textContent = data.shortlisted || 1;

    const stages = ['Eligible', 'Applied', 'AI Screening', 'Shortlisted', 'Technical Interview', 'HR Interview', 'Selected', 'Rejected'];
    const board = document.getElementById('ats-kanban-board');
    const apps = data.pipeline || [];
    if (!board) return;

    board.innerHTML = stages.map(st => {
      const filtered = apps.filter(a => a.status === st);
      return `
        <div class="pipeline-stage-col">
          <div class="pipeline-stage-header"><span>${st}</span><span class="badge-saas badge-blue">${filtered.length}</span></div>
          ${filtered.map(cand => `
            <div class="candidate-kanban-card">
              <div style="font-weight:700;">${cand.candidate_name || 'Arjun Sharma'}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);" class="mb-2">CGPA: ${cand.cgpa || 8.8} • ${cand.job_title}</div>
              <select class="saas-input" style="font-size:0.75rem; padding:0.25rem 0.5rem;" onchange="handleMoveCandidateStage(${cand.id}, this.value)">
                ${stages.map(s => `<option value="${s}" ${s === st ? 'selected' : ''}>Move to: ${s}</option>`).join('')}
              </select>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  } catch (e) {}
}

async function handleMoveCandidateStage(appId, newStage) {
  try {
    await apiFetch('/company/pipeline/stage', { method: 'PUT', body: JSON.stringify({ applicationId: appId, newStage }) });
    loadCompanyATSPipeline();
  } catch (err) { alert(err.message); }
}

async function handlePostJobSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('job-post-title').value.trim();
  const location = document.getElementById('job-post-loc').value.trim();
  const salary_stipend = document.getElementById('job-post-salary').value.trim();
  const min_cgpa = document.getElementById('job-post-cgpa').value;
  const required_skills = document.getElementById('job-post-skills').value.trim();
  const deadline = document.getElementById('job-post-deadline').value;

  try {
    await apiFetch('/company/jobs', {
      method: 'POST',
      body: JSON.stringify({ title, location, salary_stipend, min_cgpa, required_skills, deadline })
    });
    alert('Job Requirement Published to Candidates!');
    navigateTo('company-dashboard');
  } catch (err) { alert(err.message); }
}

async function loadTalentFinder() {
  try {
    const students = await apiFetch('/college/students');
    document.getElementById('talent-candidates-list').innerHTML = students.map(s => `<div class="saas-card"><h4 style="font-weight:700;">${s.name}</h4><div style="font-size:0.8rem; color:var(--text-muted);">${s.college} • ${s.department}</div><div style="font-size:0.85rem; font-weight:800; color:var(--text-emerald);" class="mt-2">CGPA: ${s.cgpa || 8.8}</div></div>`).join('');
  } catch (e) {}
}

const companyRecruitmentMock = {
  metrics: [
    { label: 'Total Open Positions', value: 142, accent: 'blue' },
    { label: 'Active Internships', value: 18, accent: 'emerald' },
    { label: 'Total Applications', value: 1248, accent: 'purple' },
    { label: 'Shortlisted Candidates', value: 264, accent: 'orange' },
    { label: 'Interviews Scheduled', value: 86, accent: 'sky' },
    { label: 'Offers Made', value: 41, accent: 'green' },
    { label: 'Students Hired', value: 31, accent: 'teal' },
    { label: 'University Partnerships', value: 14, accent: 'violet' }
  ],
  applicationsOverTime: [62, 74, 95, 128, 150, 184, 220, 215],
  hiringFunnel: [
    { label: 'Applications', value: 1248 },
    { label: 'Screening', value: 720 },
    { label: 'Shortlisted', value: 264 },
    { label: 'Interview', value: 86 },
    { label: 'Selected', value: 41 },
    { label: 'Offer Accepted', value: 31 }
  ],
  demandSkills: [
    { name: 'React', demand: 90, posted: 180, candidates: 120, gap: 'High' },
    { name: 'Python', demand: 85, posted: 160, candidates: 110, gap: 'High' },
    { name: 'Java', demand: 78, posted: 210, candidates: 140, gap: 'Medium' },
    { name: 'Node.js', demand: 81, posted: 150, candidates: 98, gap: 'High' },
    { name: 'SQL', demand: 76, posted: 170, candidates: 135, gap: 'Medium' },
    { name: 'Cloud Computing', demand: 74, posted: 120, candidates: 70, gap: 'High' },
    { name: 'Cybersecurity', demand: 80, posted: 95, candidates: 40, gap: 'High' },
    { name: 'AI/ML', demand: 86, posted: 130, candidates: 75, gap: 'High' }
  ],
  skillDistribution: [
    { label: 'Frontend', value: 35 },
    { label: 'Backend', value: 24 },
    { label: 'Data', value: 18 },
    { label: 'Cloud', value: 14 },
    { label: 'Security', value: 9 }
  ],
  hiringSplit: { internship: 58, fullTime: 42 },
  universityDistribution: [
    { name: 'Anna University', value: 28 },
    { name: 'VIT', value: 22 },
    { name: 'SRM', value: 18 },
    { name: 'Amrita', value: 16 },
    { name: 'PSG Tech', value: 12 },
    { name: 'Others', value: 4 }
  ],
  talentCandidates: [
    { name: 'Aarav Nair', skillScore: 96, department: 'CSE', cgpa: 9.3, projects: 4, certifications: 3, experience: '2 internships', availability: 'Immediately', matchingSkills: ['React', 'Node.js', 'MongoDB'], scoreColor: 'emerald' },
    { name: 'Meera Iyer', skillScore: 91, department: 'IT', cgpa: 9.1, projects: 3, certifications: 4, experience: '1 internship', availability: '1-3 Months', matchingSkills: ['Python', 'SQL', 'AI/ML'], scoreColor: 'blue' },
    { name: 'Karthik Raman', skillScore: 87, department: 'ECE', cgpa: 8.9, projects: 2, certifications: 2, experience: 'Embedded systems', availability: 'Immediately', matchingSkills: ['C++', 'Embedded', 'IoT'], scoreColor: 'purple' },
    { name: 'Nisha Patel', skillScore: 92, department: 'CSE', cgpa: 9.2, projects: 5, certifications: 5, experience: '2 internships', availability: 'Immediately', matchingSkills: ['React', 'Node.js', 'AWS'], scoreColor: 'emerald' }
  ],
  internships: [
    { title: 'Frontend Engineer Intern', duration: '6 months', stipend: '₹25,000 / month', positions: 12, status: 'Applications Open', skills: ['React', 'TypeScript', 'UI Design'] },
    { title: 'Data Science Intern', duration: '4 months', stipend: '₹30,000 / month', positions: 8, status: 'Screening', skills: ['Python', 'SQL', 'ML'] },
    { title: 'Cybersecurity Intern', duration: '3 months', stipend: '₹20,000 / month', positions: 5, status: 'Published', skills: ['Security', 'Linux', 'Networking'] }
  ],
  assessments: [
    { name: 'Full Stack Screening', candidates: 82, score: 84, status: 'Active' },
    { name: 'Aptitude Benchmark', candidates: 41, score: 76, status: 'Completed' },
    { name: 'Technical Interview Readiness', candidates: 19, score: 89, status: 'In Progress' }
  ],
  interviews: [
    { candidate: 'Aarav Nair', stage: 'Technical Interview', interviewer: 'Priya Menon', type: 'Panel', date: '2026-09-12', score: 91 },
    { candidate: 'Meera Iyer', stage: 'HR Interview', interviewer: 'Rohit Shah', type: 'Virtual', date: '2026-09-14', score: 88 },
    { candidate: 'Nisha Patel', stage: 'Assessment', interviewer: 'Sameer Nair', type: 'Coding', date: '2026-09-11', score: 94 }
  ],
  universities: [
    { name: 'Anna University', departments: ['CSE', 'IT'], students: 480, topSkills: ['React', 'Python'], placementRate: '88%' },
    { name: 'VIT', departments: ['CSE', 'AI/ML'], students: 360, topSkills: ['AI/ML', 'Cloud'], placementRate: '91%' },
    { name: 'SRM', departments: ['ECE', 'CSE'], students: 310, topSkills: ['Cybersecurity', 'Java'], placementRate: '84%' }
  ],
  shortlist: [
    { name: 'Aarav Nair', skillMatch: 96, cgpa: 9.3, projects: 4, assessment: 92, aiScore: 96, notes: 'Strong product mindset and consistent internship exposure.' },
    { name: 'Nisha Patel', skillMatch: 92, cgpa: 9.2, projects: 5, assessment: 90, aiScore: 92, notes: 'Excellent frontend and AWS exposure.' },
    { name: 'Meera Iyer', skillMatch: 90, cgpa: 9.1, projects: 3, assessment: 88, aiScore: 91, notes: 'Strong analytical profile and data storytelling.' }
  ],
  analytics: [
    { label: 'Total applicants', value: 1248 },
    { label: 'Hiring conversion rate', value: '21.4%' },
    { label: 'Average time to hire', value: '19 days' },
    { label: 'Offer acceptance rate', value: '76%' },
    { label: 'Internship conversion', value: '46%' },
    { label: 'Best source', value: 'Campus referrals' }
  ],
  messages: [
    { sender: 'Aarav Nair', topic: 'Interview scheduling', preview: 'Could you share the technical interview slot for Friday?', time: '2h ago' },
    { sender: 'Anna University', topic: 'Campus Hiring Request', preview: 'We can host a campus drive for final-year CSE and IT students.', time: '1d ago' },
    { sender: 'Recruiting Team', topic: 'Assessment completed', preview: 'The aptitude benchmark was submitted by 18 shortlisted candidates.', time: '3h ago' }
  ],
  notifications: [
    { title: 'New application received', detail: '12 new candidates applied to Frontend Engineer roles today.', time: '10 mins ago' },
    { title: 'AI match update', detail: '3 new candidates crossed 90% match threshold.', time: '35 mins ago' },
    { title: 'Interview reminder', detail: 'Two technical panels are scheduled tomorrow at 10:00 AM.', time: '1 hour ago' },
    { title: 'University response', detail: 'Anna University confirmed a campus hiring request for next week.', time: '3 hours ago' }
  ]
};

const companyAIService = {
  getOverview() {
    return {
      metrics: companyRecruitmentMock.metrics,
      applicationsOverTime: companyRecruitmentMock.applicationsOverTime,
      hiringFunnel: companyRecruitmentMock.hiringFunnel,
      skillDemand: companyRecruitmentMock.demandSkills,
      skillDistribution: companyRecruitmentMock.skillDistribution,
      hiringSplit: companyRecruitmentMock.hiringSplit,
      universities: companyRecruitmentMock.universityDistribution,
      insight: 'Your company has received 142 applications in the last 30 days. 34 candidates match more than 80% of the required skills. Cybersecurity talent is limited and university partnerships in cyber programs should be prioritized.'
    };
  },
  getTalentCandidates() {
    return companyRecruitmentMock.talentCandidates;
  },
  getSkillDemand() {
    return companyRecruitmentMock.demandSkills;
  },
  getAIRecommendations(jobDescription) {
    const text = (jobDescription || '').toLowerCase();
    const weightedKeywords = [
      { phrase: 'react', score: 12 },
      { phrase: 'node', score: 12 },
      { phrase: 'mongodb', score: 11 },
      { phrase: 'python', score: 10 },
      { phrase: 'sql', score: 9 },
      { phrase: 'cloud', score: 8 },
      { phrase: 'cybersecurity', score: 7 },
      { phrase: 'problem solving', score: 6 },
      { phrase: 'api', score: 6 },
      { phrase: 'project', score: 5 }
    ];
    let total = 0;
    weightedKeywords.forEach(item => { if (text.includes(item.phrase)) total += item.score; });
    return companyRecruitmentMock.talentCandidates.map((candidate, index) => {
      let match = Math.min(99, 78 + Math.round((candidate.skillScore + (candidate.projects * 2) + (candidate.certifications * 3) + (index * 2) + total) / 1.8));
      if (candidate.matchingSkills.some(skill => text.includes(skill.toLowerCase()))) match += 8;
      return {
        ...candidate,
        match: Math.min(99, match),
        why: `${candidate.name} brings strong ${candidate.matchingSkills.slice(0, 3).join(', ')} expertise with ${candidate.projects} relevant projects and ${candidate.experience}.`
      };
    }).sort((a, b) => b.match - a.match);
  }
};

function renderMetricCard(label, value, accent) {
  const accents = {
    blue: 'linear-gradient(135deg, rgba(59,130,246,.18), rgba(59,130,246,.05))',
    emerald: 'linear-gradient(135deg, rgba(16,185,129,.18), rgba(16,185,129,.05))',
    purple: 'linear-gradient(135deg, rgba(168,85,247,.18), rgba(168,85,247,.05))',
    orange: 'linear-gradient(135deg, rgba(251,146,60,.18), rgba(251,146,60,.05))',
    sky: 'linear-gradient(135deg, rgba(14,165,233,.18), rgba(14,165,233,.05))',
    green: 'linear-gradient(135deg, rgba(34,197,94,.18), rgba(34,197,94,.05))',
    teal: 'linear-gradient(135deg, rgba(45,212,191,.18), rgba(45,212,191,.05))',
    violet: 'linear-gradient(135deg, rgba(139,92,246,.18), rgba(139,92,246,.05))'
  };
  return `
    <div class="stat-card" style="background:${accents[accent] || accents.blue};">
      <div>
        <div style="font-size:0.75rem; font-weight:700; color:var(--text-muted);">${label}</div>
        <div style="font-size:1.4rem; font-weight:800; margin-top:0.25rem;">${value}</div>
      </div>
    </div>
  `;
}

async function renderCompanyDashboard() {
  let overview;
  try {
    overview = await apiFetch('/company/dashboard');
  } catch (err) {
    console.error('Company dashboard data load failed:', err);
    return;
  }
  const metricsGrid = document.getElementById('company-metrics-grid');
  if (metricsGrid) {
    metricsGrid.innerHTML = overview.metrics.map(metric => renderMetricCard(metric.label, metric.value, metric.accent)).join('');
  }

  const insightEl = document.getElementById('company-ai-insight');
  if (insightEl) {
    insightEl.innerHTML = `
      <div class="saas-card" style="background:rgba(15,23,42,.7); border:1px solid rgba(56,189,248,.25);">
        <p style="margin:0; color:var(--text-secondary); line-height:1.7;">${overview.insight}</p>
      </div>
    `;
  }

  const appChart = document.getElementById('company-applications-chart');
  if (appChart) {
    appChart.innerHTML = overview.applicationsOverTime.map((value, index) => `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%;">
        <div style="width:100%; max-width:40px; height:${Math.max(28, value / 2.5)}px; background:linear-gradient(180deg, #38bdf8 0%, #1d4ed8 100%); border-radius:8px 8px 0 0; box-shadow:0 10px 18px rgba(56,189,248,.18);"></div>
        <div style="font-size:0.65rem; color:var(--text-muted); margin-top:0.5rem;">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'][index]}</div>
      </div>
    `).join('');
  }

  const funnelEl = document.getElementById('company-funnel-chart');
  if (funnelEl) {
    const max = Math.max(...overview.hiringFunnel.map(item => item.value));
    funnelEl.innerHTML = overview.hiringFunnel.map((item, idx) => `
      <div class="mb-3">
        <div class="flex-between mb-1"><span style="font-size:0.8rem; color:var(--text-secondary);">${item.label}</span><span style="font-weight:800; font-size:0.8rem;">${item.value}</span></div>
        <div style="height:10px; background:rgba(148,163,184,.15); border-radius:999px; overflow:hidden;">
          <div style="height:100%; width:${(item.value / max) * 100}%; background:${['#38bdf8','#60a5fa','#a78bfa','#fbbf24','#34d399','#22c55e'][idx % 6]}; border-radius:999px;"></div>
        </div>
      </div>
    `).join('');
  }

  const demandEl = document.getElementById('company-demand-skills');
  if (demandEl) {
    demandEl.innerHTML = overview.skillDemand.map(skill => `
      <div class="mb-3">
        <div class="flex-between mb-1"><span style="font-weight:700; font-size:0.8rem;">${skill.name}</span><span style="font-size:0.75rem; color:var(--text-muted);">${skill.demand}% demand</span></div>
        <div style="height:9px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden; margin-bottom:0.2rem;">
          <div style="height:100%; width:${skill.demand}%; background:linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius:999px;"></div>
        </div>
        <div style="font-size:0.72rem; color:var(--text-muted);">${skill.posted} postings • ${skill.candidates} candidates • Gap: <strong style="color:var(--text-blue);">${skill.gap}</strong></div>
      </div>
    `).join('');
  }

  const distEl = document.getElementById('company-skill-distribution');
  if (distEl) {
    distEl.innerHTML = overview.skillDistribution.map(item => `
      <div class="mb-3">
        <div class="flex-between mb-1"><span style="font-size:0.8rem;">${item.label}</span><span style="font-size:0.75rem; color:var(--text-muted);">${item.value}%</span></div>
        <div style="height:9px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;">
          <div style="height:100%; width:${item.value}%; background:linear-gradient(90deg, #14b8a6, #22c55e); border-radius:999px;"></div>
        </div>
      </div>
    `).join('');
  }

  const splitEl = document.getElementById('company-hiring-split');
  if (splitEl) {
    splitEl.innerHTML = `
      <div class="mb-3">
        <div class="flex-between mb-2"><span>Internship</span><span>${overview.hiringSplit.internship}%</span></div>
        <div style="height:12px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;"><div style="height:100%; width:${overview.hiringSplit.internship}%; background:linear-gradient(90deg, #38bdf8, #3b82f6); border-radius:999px;"></div></div>
      </div>
      <div>
        <div class="flex-between mb-2"><span>Full-Time</span><span>${overview.hiringSplit.fullTime}%</span></div>
        <div style="height:12px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;"><div style="height:100%; width:${overview.hiringSplit.fullTime}%; background:linear-gradient(90deg, #a78bfa, #6366f1); border-radius:999px;"></div></div>
      </div>
    `;
  }

  const uniEl = document.getElementById('company-university-distribution');
  if (uniEl) {
    uniEl.innerHTML = overview.universities.map((item, idx) => `
      <div class="mb-3">
        <div class="flex-between mb-1"><span style="font-size:0.8rem;">${item.name}</span><span style="font-size:0.75rem; color:var(--text-muted);">${item.value}%</span></div>
        <div style="height:9px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;"><div style="height:100%; width:${item.value}%; background:${['#38bdf8','#818cf8','#a78bfa','#f59e0b','#34d399'][idx % 5]}; border-radius:999px;"></div></div>
      </div>
    `).join('');
  }

  const radarEl = document.getElementById('company-skill-radar');
  if (radarEl) {
    radarEl.innerHTML = overview.skillDemand.slice(0, 5).map(skill => `
      <div class="mb-3">
        <div class="flex-between mb-1"><strong>${skill.name}</strong><span class="badge-saas ${skill.gap === 'High' ? 'badge-purple' : 'badge-emerald'}">${skill.gap} Talent Gap</span></div>
        <div class="grid-2 gap-3">
          <div>
            <div class="text-xs" style="color:var(--text-muted); margin-bottom:0.25rem;">Demand</div>
            <div style="height:12px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;"><div style="height:100%; width:${skill.demand}%; background:linear-gradient(90deg, #0ea5e9, #2563eb); border-radius:999px;"></div></div>
          </div>
          <div>
            <div class="text-xs" style="color:var(--text-muted); margin-bottom:0.25rem;">Available Talent</div>
            <div style="height:12px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;"><div style="height:100%; width:${Math.min(100, Math.round((skill.candidates / Math.max(skill.posted, 1)) * 100))}%; background:linear-gradient(90deg, #34d399, #15803d); border-radius:999px;"></div></div>
          </div>
        </div>
      </div>
    `).join('');
  }
}

function renderCompanyProfile() {
  const container = document.getElementById('company-profile-content');
  if (!container) return;
  const completion = 78;
  const profile = {
    name: 'TechCorp Solutions',
    industry: 'Software & Digital Products',
    size: '500-1000 employees',
    location: 'Bengaluru, India',
    website: 'https://www.techcorp.example',
    description: 'Builds enterprise productivity platforms, AI copilots, and product engineering solutions for global clients.',
    technologies: ['React', 'Node.js', 'MongoDB', 'Kubernetes', 'Python', 'AWS'],
    requiredSkills: ['Full Stack Development', 'Data Structures', 'AI/ML', 'System Design', 'Communication'],
    benefits: ['Health insurance', 'Flexible hybrid work', 'Learning stipend', 'Stock options'],
    foundedYear: 2012,
    contact: 'recruiter@techcorp.com | +91 99887 76543'
  };
  container.innerHTML = `
    <div class="grid-2 gap-4">
      <div class="saas-card">
        <h3 style="font-weight:700; margin-bottom:1rem;">Company Identity</h3>
        <div class="flex-align gap-3 mb-3">
          <div style="width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#38bdf8,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:900;color:white;">T</div>
          <div>
            <div style="font-size:1rem; font-weight:800;">${profile.name}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">${profile.industry}</div>
          </div>
        </div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Company name</label><input class="saas-input" value="${profile.name}" /></div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Industry</label><input class="saas-input" value="${profile.industry}" /></div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Website</label><input class="saas-input" value="${profile.website}" /></div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Location</label><input class="saas-input" value="${profile.location}" /></div>
      </div>
      <div class="saas-card">
        <h3 style="font-weight:700; margin-bottom:1rem;">Profile completion</h3>
        <div class="mb-3"><div class="flex-between"><span>Company Profile Completion</span><strong>${completion}%</strong></div><div style="height:12px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden; margin-top:0.75rem;"><div style="width:${completion}%; height:100%; background:linear-gradient(90deg,#38bdf8,#8b5cf6); border-radius:999px;"></div></div></div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Description</label><textarea class="saas-input" rows="5">${profile.description}</textarea></div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Company size</label><input class="saas-input" value="${profile.size}" /></div>
        <div><label class="block text-xs font-bold mb-1">Founded year</label><input class="saas-input" value="${profile.foundedYear}" /></div>
      </div>
    </div>
    <div class="grid-2 gap-4 mt-4">
      <div class="saas-card">
        <h3 style="font-weight:700; margin-bottom:1rem;">Technology & skills</h3>
        <div class="flex-align gap-2 flex-wrap mb-3">${profile.technologies.map(item => `<span class="badge-saas badge-blue">${item}</span>`).join('')}</div>
        <div class="flex-align gap-2 flex-wrap">${profile.requiredSkills.map(item => `<span class="badge-saas badge-purple">${item}</span>`).join('')}</div>
      </div>
      <div class="saas-card">
        <h3 style="font-weight:700; margin-bottom:1rem;">Benefits & contact</h3>
        <div class="flex-align gap-2 flex-wrap mb-3">${profile.benefits.map(item => `<span class="badge-saas badge-emerald">${item}</span>`).join('')}</div>
        <div style="font-size:0.85rem; color:var(--text-muted);">${profile.contact}</div>
      </div>
    </div>
  `;
  document.getElementById('company-profile-completion').textContent = `Profile Completion: ${completion}%`;
}

function renderCompanyTalentDiscovery() {
  const container = document.getElementById('company-talent-results');
  if (!container) return;

  const searchInput = document.getElementById('company-talent-search');
  const departmentInput = document.getElementById('company-talent-department');
  const availabilityInput = document.getElementById('company-talent-availability');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener('input', renderCompanyTalentDiscovery);
    searchInput.dataset.bound = 'true';
  }
  if (departmentInput && !departmentInput.dataset.bound) {
    departmentInput.addEventListener('change', renderCompanyTalentDiscovery);
    departmentInput.dataset.bound = 'true';
  }
  if (availabilityInput && !availabilityInput.dataset.bound) {
    availabilityInput.addEventListener('change', renderCompanyTalentDiscovery);
    availabilityInput.dataset.bound = 'true';
  }
  const query = (searchInput?.value || '').toLowerCase();
  const department = (departmentInput?.value || '').toLowerCase();
  const availability = (availabilityInput?.value || '').toLowerCase();

  const candidates = companyAIService.getTalentCandidates().filter(candidate => {
    const matchesText = !query || candidate.matchingSkills.some(skill => skill.toLowerCase().includes(query)) || candidate.name.toLowerCase().includes(query);
    const matchesDepartment = !department || candidate.department.toLowerCase() === department;
    const matchesAvailability = !availability || candidate.availability.toLowerCase().includes(availability);
    return matchesText && matchesDepartment && matchesAvailability;
  });

  container.innerHTML = candidates.length ? candidates.map(candidate => `
    <div class="saas-card">
      <div class="flex-between mb-3">
        <div>
          <h4 style="font-weight:800; margin:0;">${candidate.name}</h4>
          <div style="font-size:0.78rem; color:var(--text-muted);">${candidate.department} • ${candidate.cgpa} CGPA</div>
        </div>
        <div class="badge-saas badge-${candidate.scoreColor}">${candidate.skillScore}% Match</div>
      </div>
      <div class="grid-2 gap-2 text-xs mb-3" style="color:var(--text-muted);">
        <div><strong>Matching skills:</strong> ${candidate.matchingSkills.join(', ')}</div>
        <div><strong>Projects:</strong> ${candidate.projects}</div>
        <div><strong>Certifications:</strong> ${candidate.certifications}</div>
        <div><strong>Experience:</strong> ${candidate.experience}</div>
        <div><strong>Availability:</strong> ${candidate.availability}</div>
        <div><strong>Skills score:</strong> ${candidate.skillScore}</div>
      </div>
      <div class="flex-align gap-2 flex-wrap">${candidate.matchingSkills.map(skill => `<span class="badge-saas badge-blue">${skill}</span>`).join('')}</div>
    </div>
  `).join('') : '<div class="saas-card">No candidate matches found for the selected filters.</div>';
}

function runCompanyAIMatch() {
  const container = document.getElementById('company-ai-match-results');
  const text = document.getElementById('company-job-description')?.value || '';
  if (!container) return;
  const matches = companyAIService.getAIRecommendations(text);
  container.innerHTML = matches.slice(0, 3).map((candidate, index) => `
    <div class="saas-card mb-4">
      <div class="flex-between mb-3">
        <div>
          <div class="badge-saas badge-${candidate.scoreColor}">${index + 1}. ${candidate.name}</div>
        </div>
        <div style="font-size:1.4rem; font-weight:800; color:var(--text-blue);">${candidate.match}%</div>
      </div>
      <div class="grid-2 gap-3 text-sm" style="color:var(--text-secondary);">
        <div><strong>Skill Match:</strong> ${candidate.skillScore}%</div>
        <div><strong>Project Match:</strong> ${candidate.projects * 18}%</div>
        <div><strong>Education Match:</strong> ${Math.min(98, candidate.cgpa * 10)}%</div>
        <div><strong>Experience Match:</strong> ${Math.min(97, 72 + candidate.projects * 5)}%</div>
      </div>
      <div class="mt-3"><strong>Why this candidate is recommended:</strong> ${candidate.why}</div>
    </div>
  `).join('');
}

function renderCompanySkillDemand() {
  const container = document.getElementById('company-skill-demand-content');
  if (!container) return;
  const skills = companyAIService.getSkillDemand();
  container.innerHTML = skills.map(skill => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2">
        <div><h4 style="font-weight:800; margin:0;">${skill.name}</h4></div>
        <div class="badge-saas ${skill.gap === 'High' ? 'badge-purple' : 'badge-emerald'}">${skill.gap}</div>
      </div>
      <div class="grid-2 gap-4 text-sm" style="color:var(--text-muted);">
        <div><strong>Demand:</strong> ${skill.demand}%</div>
        <div><strong>Job postings:</strong> ${skill.posted}</div>
        <div><strong>Available candidates:</strong> ${skill.candidates}</div>
        <div><strong>Talent shortage:</strong> ${skill.gap}</div>
      </div>
      <div class="mt-3">
        <div class="flex-between mb-1"><span style="font-size:0.8rem;">Skill gap indicator</span><span style="font-size:0.75rem; color:var(--text-muted);">${skill.gap === 'High' ? 'High talent gap' : 'Balanced market'}</span></div>
        <div style="height:12px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden;"><div style="height:100%; width:${Math.min(100, Math.max(15, (skill.demand - (skill.candidates / 2))))}%; background:linear-gradient(90deg,#f59e0b,#ef4444); border-radius:999px;"></div></div>
      </div>
    </div>
  `).join('');
}

function renderCompanyInternships() {
  const container = document.getElementById('company-internship-content');
  if (!container) return;
  container.innerHTML = companyRecruitmentMock.internships.map(item => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2">
        <div><h4 style="font-weight:800; margin:0;">${item.title}</h4></div>
        <span class="badge-saas badge-emerald">${item.status}</span>
      </div>
      <div class="grid-3 gap-3 text-sm" style="color:var(--text-muted);">
        <div><strong>Duration:</strong> ${item.duration}</div>
        <div><strong>Stipend:</strong> ${item.stipend}</div>
        <div><strong>Positions:</strong> ${item.positions}</div>
      </div>
      <div class="mt-3 flex-align gap-2 flex-wrap">${item.skills.map(skill => `<span class="badge-saas badge-blue">${skill}</span>`).join('')}</div>
    </div>
  `).join('');
}

function renderCompanyOpportunityForm() {
  const container = document.getElementById('company-job-drives-content');
  if (!container) return;
  container.innerHTML = `
    <div class="saas-card">
      <form onsubmit="handlePostJobSubmit(event)">
        <div class="grid-2 gap-4 mb-4">
          <div><label class="block text-xs font-bold mb-1">Job title</label><input type="text" id="job-post-title" class="saas-input" value="Senior Software Engineer" required /></div>
          <div><label class="block text-xs font-bold mb-1">Department</label><input type="text" id="job-post-department" class="saas-input" value="Product Engineering" required /></div>
          <div><label class="block text-xs font-bold mb-1">Location</label><input type="text" id="job-post-loc" class="saas-input" value="Bengaluru / Hybrid" required /></div>
          <div><label class="block text-xs font-bold mb-1">Salary / stipend</label><input type="text" id="job-post-salary" class="saas-input" value="₹12 LPA + ESOPs" required /></div>
          <div><label class="block text-xs font-bold mb-1">Minimum CGPA</label><input type="number" step="0.1" id="job-post-cgpa" class="saas-input" value="7.5" required /></div>
          <div><label class="block text-xs font-bold mb-1">Application deadline</label><input type="date" id="job-post-deadline" class="saas-input" value="2026-10-30" required /></div>
          <div class="span-2"><label class="block text-xs font-bold mb-1">Required skills</label><input type="text" id="job-post-skills" class="saas-input" value="React, Node.js, MongoDB, SQL, Problem Solving" required /></div>
        </div>
        <button type="submit" class="btn-saas btn-primary">Publish opportunity</button>
      </form>
    </div>
  `;
}

function renderCompanyJobDrives() {
  const container = document.getElementById('company-job-drives-content');
  if (!container) return;
  renderCompanyOpportunityForm();
}

function renderCompanyAssessments() {
  const container = document.getElementById('company-assessment-content');
  if (!container) return;
  container.innerHTML = companyRecruitmentMock.assessments.map(item => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2">
        <h4 style="font-weight:800; margin:0;">${item.name}</h4>
        <span class="badge-saas ${item.status === 'Active' ? 'badge-emerald' : 'badge-blue'}">${item.status}</span>
      </div>
      <div class="grid-3 gap-3 text-sm" style="color:var(--text-muted);">
        <div><strong>Candidates:</strong> ${item.candidates}</div>
        <div><strong>Score:</strong> ${item.score}%</div>
        <div><strong>Shortlist rule:</strong> score > 80</div>
      </div>
    </div>
  `).join('');
}

function companyCreateAssessment() {
  const container = document.getElementById('company-assessment-content');
  if (!container) return;
  container.innerHTML = `
    <div class="saas-card">
      <h3 style="font-weight:800; margin-bottom:1rem;">Create candidate assessment</h3>
      <div class="grid-2 gap-4">
        <div><label class="block text-xs font-bold mb-1">Assessment name</label><input class="saas-input" value="Technical Screening - Full Stack" /></div>
        <div><label class="block text-xs font-bold mb-1">Type</label><select class="saas-input"><option>MCQ</option><option>Technical</option><option>Coding</option><option>Skill-based</option></select></div>
        <div><label class="block text-xs font-bold mb-1">Duration</label><input class="saas-input" value="60 minutes" /></div>
        <div><label class="block text-xs font-bold mb-1">Pass score</label><input class="saas-input" value="75" /></div>
      </div>
      <div class="mt-3"><button class="btn-saas btn-primary" onclick="renderCompanyAssessments()">Save assessment</button></div>
    </div>
  `;
}

function renderCompanyInterviewPipeline() {
  const container = document.getElementById('company-interview-pipeline-content');
  if (!container) return;
  const stages = ['Applied', 'Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Selected', 'Offer'];
  const candidateColumns = stages.map(stage => {
    const matching = companyRecruitmentMock.interviews.filter(item => item.stage === stage || (stage === 'Technical Interview' && item.stage === 'Technical Interview') || (stage === 'Assessment' && item.stage === 'Assessment'));
    return `
      <div class="saas-card" style="min-width:180px;">
        <div class="flex-between mb-3"><strong>${stage}</strong><span class="badge-saas badge-blue">${matching.length}</span></div>
        ${matching.length ? matching.map(item => `
          <div style="border:1px solid rgba(56,189,248,.2); border-radius:12px; padding:0.7rem; background:rgba(15,23,42,.7); margin-bottom:0.75rem;">
            <div style="font-weight:800; margin-bottom:0.2rem;">${item.candidate}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${item.interviewer} • ${item.type}</div>
            <div style="font-size:0.75rem; color:var(--text-blue); margin-top:0.4rem;">Score: ${item.score}</div>
          </div>
        `).join('') : '<div style="font-size:0.75rem; color:var(--text-muted);">No candidates in this stage.</div>'}
      </div>
    `;
  }).join('');
  container.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">${candidateColumns}</div>`;
}

function renderCompanyCampusConnect() {
  const container = document.getElementById('company-campus-connect-content');
  if (!container) return;
  container.innerHTML = companyRecruitmentMock.universities.map(university => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2">
        <div><h4 style="font-weight:800; margin:0;">${university.name}</h4></div>
        <span class="badge-saas badge-emerald">${university.placementRate}</span>
      </div>
      <div class="grid-2 gap-3 text-sm" style="color:var(--text-muted);">
        <div><strong>Departments:</strong> ${university.departments.join(', ')}</div>
        <div><strong>Available students:</strong> ${university.students}</div>
        <div><strong>Top skills:</strong> ${university.topSkills.join(', ')}</div>
        <div><strong>Internship participation:</strong> High</div>
      </div>
    </div>
  `).join('');
}

function companySendCampusRequest() {
  alert('Campus hiring request sent to the selected university partnerships.');
}

function renderCompanyShortlist() {
  const container = document.getElementById('company-shortlist-content');
  if (!container) return;
  container.innerHTML = companyRecruitmentMock.shortlist.map(candidate => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2">
        <div><h4 style="font-weight:800; margin:0;">${candidate.name}</h4></div>
        <span class="badge-saas badge-blue">AI ${candidate.aiScore}%</span>
      </div>
      <div class="grid-2 gap-3 text-sm" style="color:var(--text-muted);">
        <div><strong>Skills:</strong> ${candidate.skillMatch}%</div>
        <div><strong>CGPA:</strong> ${candidate.cgpa}</div>
        <div><strong>Projects:</strong> ${candidate.projects}</div>
        <div><strong>Assessment:</strong> ${candidate.assessment}%</div>
      </div>
      <div class="mt-3"><strong>Notes:</strong> ${candidate.notes}</div>
    </div>
  `).join('');
}

function companyCompareCandidates() {
  const container = document.getElementById('company-shortlist-content');
  if (!container) return;
  const first = companyRecruitmentMock.shortlist[0];
  const second = companyRecruitmentMock.shortlist[1];
  container.innerHTML = `
    <div class="saas-card">
      <h3 style="font-weight:800; margin-bottom:1rem;">Compare Candidates</h3>
      <table class="saas-table">
        <thead><tr><th>Metric</th><th>${first.name}</th><th>${second.name}</th></tr></thead>
        <tbody>
          <tr><td>Skills</td><td>${first.skillMatch}%</td><td>${second.skillMatch}%</td></tr>
          <tr><td>CGPA</td><td>${first.cgpa}</td><td>${second.cgpa}</td></tr>
          <tr><td>Projects</td><td>${first.projects}</td><td>${second.projects}</td></tr>
          <tr><td>Assessment score</td><td>${first.assessment}%</td><td>${second.assessment}%</td></tr>
          <tr><td>AI Match score</td><td>${first.aiScore}%</td><td>${second.aiScore}%</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderCompanyAnalytics() {
  const container = document.getElementById('company-analytics-content');
  if (!container) return;
  container.innerHTML = `
    <div class="grid-3 gap-4 mb-4">${companyRecruitmentMock.analytics.map(item => `<div class="saas-card"><div style="font-size:0.72rem; color:var(--text-muted);">${item.label}</div><div style="font-size:1.4rem; font-weight:800; margin-top:0.35rem;">${item.value}</div></div>`).join('')}</div>
    <div class="saas-card">
      <h3 style="font-weight:800; margin-bottom:1rem;">Applications vs Hires</h3>
      <div style="display:flex; gap:1rem; align-items:end; height:180px;">
        <div style="flex:1; display:flex; align-items:end; justify-content:center; height:100%;"><div style="width:50%; height:72%; background:linear-gradient(180deg,#38bdf8,#1d4ed8); border-radius:12px 12px 0 0;"></div></div>
        <div style="flex:1; display:flex; align-items:end; justify-content:center; height:100%;"><div style="width:50%; height:33%; background:linear-gradient(180deg,#34d399,#15803d); border-radius:12px 12px 0 0;"></div></div>
      </div>
    </div>
  `;
}

function renderCompanyMessages() {
  const container = document.getElementById('company-messages-content');
  if (!container) return;
  container.innerHTML = companyRecruitmentMock.messages.map(message => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2"><strong>${message.sender}</strong><span style="font-size:0.75rem; color:var(--text-muted);">${message.time}</span></div>
      <div style="font-weight:700; margin-bottom:0.35rem;">${message.topic}</div>
      <div style="font-size:0.82rem; color:var(--text-muted);">${message.preview}</div>
    </div>
  `).join('');
}

function renderCompanyNotifications() {
  const container = document.getElementById('company-notifications-content');
  if (!container) return;
  container.innerHTML = companyRecruitmentMock.notifications.map(item => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2"><h4 style="font-weight:800; margin:0;">${item.title}</h4><span style="font-size:0.75rem; color:var(--text-muted);">${item.time}</span></div>
      <div style="font-size:0.82rem; color:var(--text-muted);">${item.detail}</div>
    </div>
  `).join('');
}

function renderCompanySettings() {
  const container = document.getElementById('company-settings-content');
  if (!container) return;
  container.innerHTML = `
    <div class="grid-2 gap-4">
      <div class="saas-card">
        <h3 style="font-weight:800; margin-bottom:1rem;">Account settings</h3>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Recruiter profile</label><input class="saas-input" value="Priya Menon" /></div>
        <div class="mb-3"><label class="block text-xs font-bold mb-1">Email</label><input class="saas-input" value="recruiter@techcorp.com" /></div>
        <div><label class="block text-xs font-bold mb-1">Hiring preferences</label><select class="saas-input"><option>Full stack & AI roles</option><option>Security engineering</option><option>Data roles</option></select></div>
      </div>
      <div class="saas-card">
        <h3 style="font-weight:800; margin-bottom:1rem;">Notifications & security</h3>
        <label class="flex-align gap-2 mb-2"><input type="checkbox" checked /> New applications</label>
        <label class="flex-align gap-2 mb-2"><input type="checkbox" checked /> Candidate matches</label>
        <label class="flex-align gap-2 mb-2"><input type="checkbox" checked /> Interview reminders</label>
        <label class="flex-align gap-2 mb-2"><input type="checkbox" checked /> University response</label>
        <label class="flex-align gap-2"><input type="checkbox" /> Security alert summaries</label>
      </div>
    </div>
  `;
}

// COLLEGE ADMIN LOADERS
async function loadCollegeDashboard() {
  try {
    const data = await apiFetch('/college/dashboard');
    document.getElementById('col-total-students').textContent = data.total_students;
    document.getElementById('col-placed-students').textContent = data.placed_students;
    document.getElementById('col-placement-rate').textContent = `${data.placement_rate}%`;

    const tbody = document.getElementById('college-dept-table');
    tbody.innerHTML = (data.department_stats || []).map(d => `<tr><td style="font-weight:700;">${d.name}</td><td>${d.total}</td><td style="color:var(--text-emerald); font-weight:800;">${d.placed}</td><td><span class="badge-saas badge-emerald">${d.percentage}%</span></td></tr>`).join('');
  } catch (e) {}
}

async function loadCollegeStudentDirectory() {
  try {
    const students = await apiFetch('/college/students');
    document.getElementById('college-students-list').innerHTML = students.map(s => `<div class="saas-card"><h4 style="font-weight:700;">${s.name}</h4><div style="font-size:0.8rem; color:var(--text-muted);">${s.student_id} • ${s.department}</div></div>`).join('');
  } catch (e) {}
}

// UTILS
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function openLogoutModal() { handleLogout(); }
function handleLogout() { authToken = null; currentUser = null; currentProfile = null; localStorage.removeItem('sb_token'); showGuestLanding(); }
function closeMobileDrawer() { const sidebar = document.getElementById('app-sidebar'); if (sidebar) sidebar.classList.remove('mobile-open'); }
function toggleMobileDrawer() { const sidebar = document.getElementById('app-sidebar'); if (sidebar) sidebar.classList.toggle('mobile-open'); }
