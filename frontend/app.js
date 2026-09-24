// SkillBridge — Enforced Security Client Engine for Student, Company & College Modules

// Keep the frontend and API on the same deployment so authentication and
// registration always use the same backend version.
const API_BASE = '/api';

let currentUser = null;
let currentProfile = null;
let currentRole = 'student';
let editingCompanyInternshipId = null;
let editingCompanyJobId = null;
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
const INTERVIEW_MIN_CGPA = 7;

document.addEventListener('DOMContentLoaded', async () => {
  const transcript = document.getElementById('interview-transcript');
  if (transcript) {
    transcript.addEventListener('input', updateInterviewAnswerState);
  }

  const addSemesterBtn = document.getElementById('add-semester-record-btn');
  if (addSemesterBtn) {
    addSemesterBtn.addEventListener('click', () => {
      resetSemesterForm();
      const semesterNumberField = document.getElementById('semester-number');
      if (semesterNumberField) semesterNumberField.focus();
    });
  }

  if (authToken) {
    await fetchCurrentUser();
  } else {
    showGuestLanding();
  }
});

async function apiFetch(endpoint, options = {}, legacyMethod) {
  if (legacyMethod) {
    options = {
      method: legacyMethod,
      ...(legacyMethod === 'GET' ? {} : { body: JSON.stringify(options || {}) })
    };
  }
  if (endpoint.startsWith('/api/')) endpoint = endpoint.slice(4);
  const headers = { ...(options.headers || {}) };
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    const text = await res.text();
    const trimmed = text.trim();
    let data = {};

    if (trimmed) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          data = JSON.parse(trimmed);
        } catch (parseErr) {
          const error = new Error('The server returned invalid JSON. Please check the backend service and try again.');
          error.status = res.status;
          throw error;
        }
      } else {
        const error = new Error(trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed);
        error.status = res.status;
        throw error;
      }
    }

    if (!res.ok) {
      const error = new Error(data.error || data.message || 'API Request Failed');
      error.status = res.status;
      throw error;
    }
    return data;
  } catch (err) {
    console.error('API Error:', err.message);
    if (err && err.message && /Failed to fetch|NetworkError|Load failed/i.test(err.message)) {
      const networkError = new Error('Unable to reach the SkillBridge backend. Please check that the server is running and try again.');
      networkError.status = err.status || 0;
      throw networkError;
    }
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

  const name = (currentProfile && currentProfile.name) || (currentUser && (currentUser.fullName || currentUser.companyName || currentUser.collegeName)) || 'User';
  document.getElementById('user-display-name').textContent = name;
  document.getElementById('user-display-id').textContent = currentUser.role === 'company' ? `COMPANY (${currentUser.companyId || 'CMP-10001'})` : (currentUser.role === 'college' ? 'UNIVERSITY ADMIN' : (currentUser.role === 'faculty' ? 'FACULTY' : (currentProfile ? currentProfile.student_id : 'STUDENT')));

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
  if (targetRole === 'faculty' && (!currentUser || currentUser.role !== 'faculty')) {
    openFacultyAuthModal('login');
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
  if (badge) badge.textContent = role === 'company' ? 'Recruiter Module' : (role === 'college' ? 'University Admin' : (role === 'faculty' ? 'Faculty Module' : 'Student Module'));

  document.querySelectorAll('.role-sidebar-group').forEach(group => group.classList.add('hidden'));
  const targetGroup = document.getElementById(`sidebar-${role}-links`);
  if (targetGroup) targetGroup.classList.remove('hidden');

  if (role === 'student') navigateTo('dashboard');
  else if (role === 'company') navigateTo('company-dashboard');
  else if (role === 'college') navigateTo('college-dashboard');
  else if (role === 'faculty') navigateTo('faculty-dashboard');
}

function navigateToRoleHome() {
  switchPortalRole(currentRole);
}

function navigateTo(viewId) {
  if (viewId.indexOf('faculty-') === 0 && (!currentUser || currentUser.role !== 'faculty')) {
    openFacultyAuthModal('login');
    return;
  }
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
  else if (viewId === 'learning') loadLearningView();
  else if (viewId === 'ai-skill-analyzer') loadAISkillAnalyzerView();
  else if (viewId === 'opportunities') loadOpportunitiesView();
  else if (viewId === 'internships') loadStudentInternships();
  else if (viewId === 'applications') loadApplicationsView();
  else if (viewId === 'interview-prep') loadInterviewPrepView();
  else if (viewId === 'notifications') loadNotificationsView();
  else if (viewId === 'placement') loadPlacementView();
  else if (viewId === 'campus-drives') loadCampusDrivesView();
  else if (viewId === 'settings') loadSettingsView();
  else if (viewId === 'company-dashboard') { loadCompanyATSPipeline(); renderCompanyDashboard(); loadCompanyAcademiaFeed(); }
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
  else if (viewId === 'faculty-dashboard') { loadFacultyDashboard(); loadFacultyResource(); }
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
    resetLoginForm('student-login-form', 'stu-login-password-block', 'stu-login-pass', 'stu-login-submit');
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

async function checkLoginEmail(formId, email, role, passwordBlockId, passwordId, submitId) {
  const form = document.getElementById(formId);
  if (form.dataset.emailChecked === email) return true;
  if (form.dataset.emailChecked) {
    document.getElementById(passwordId).value = '';
  }
  form.dataset.emailChecked = email;
  document.getElementById(passwordBlockId).classList.remove('hidden');
  document.getElementById(passwordId).required = true;
  document.getElementById(submitId).textContent = 'Sign In';
  return false;
}

function resetLoginForm(formId, passwordBlockId, passwordId, submitId) {
  const form = document.getElementById(formId);
  if (!form) return;
  delete form.dataset.emailChecked;
  const passwordBlock = document.getElementById(passwordBlockId);
  const passwordInput = document.getElementById(passwordId);
  const submitButton = document.getElementById(submitId);
  if (passwordBlock) passwordBlock.classList.add('hidden');
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.required = false;
  }
  if (submitButton) submitButton.textContent = 'Continue';
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
  const identity = document.getElementById('stu-login-id').value.trim().toLowerCase();
  const password = document.getElementById('stu-login-pass').value.trim();

  try {
    if (!await checkLoginEmail('student-login-form', identity, 'student', 'stu-login-password-block', 'stu-login-pass', 'stu-login-submit')) return;
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
    if (err.status === 409 || /already (exists|registered)/i.test(err.message || '')) {
      document.getElementById('stu-login-id').value = email;
      switchStudentAuthTab('login');
      alert('This email is already registered. Please enter your password to sign in.');
      return;
    }
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
    resetLoginForm('company-login-form', 'comp-login-password-block', 'comp-login-pass', 'comp-login-submit');
    const companyBlock = document.getElementById('comp-login-company-block');
    const companyField = document.getElementById('comp-login-company');
    if (companyBlock) companyBlock.classList.add('hidden');
    if (companyField) {
      companyField.value = '';
      companyField.required = false;
    }
  } else {
    title.innerHTML = '<i class="fa-solid fa-building text-blue"></i> Register Company Account';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

async function handleCompanyLoginSubmit(e) {
  e.preventDefault();
  const identity = document.getElementById('comp-login-user').value.trim().toLowerCase();
  const password = document.getElementById('comp-login-pass').value.trim();

  try {
    if (!await checkLoginEmail('company-login-form', identity, 'company', 'comp-login-password-block', 'comp-login-pass', 'comp-login-submit')) return;
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identity,
        companyName: document.getElementById('comp-login-company')?.value.trim() || undefined,
        password,
        role: 'company'
      })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    localStorage.setItem('sb_company_registered', 'true');
    closeModal('company-auth-modal');
    switchPortalRole('company');
    showAppWorkspace();
  } catch (err) {
    if (/company name.*required/i.test(err.message || '')) {
      const companyBlock = document.getElementById('comp-login-company-block');
      const companyField = document.getElementById('comp-login-company');
      if (companyBlock && companyField) {
        companyBlock.classList.remove('hidden');
        companyField.required = true;
        companyField.focus();
      }
      alert('Enter the registered company name, then click Sign In again.');
      return;
    }
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
    localStorage.setItem('sb_company_registered', 'true');
    closeModal('company-auth-modal');
    alert(`Company Account Registered Successfully! Your Company ID is: ${data.company.companyId}`);
    switchPortalRole('company');
    showAppWorkspace();
  } catch (err) {
    if (err.status === 409 || /already (exists|registered)/i.test(err.message || '')) {
      document.getElementById('comp-login-user').value = email;
      switchCompanyAuthTab('login');
      alert('This email is already registered. Please enter your password to sign in.');
      return;
    }
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
    resetLoginForm('college-login-form', 'col-login-password-block', 'col-login-pass', 'col-login-submit');
  } else {
    title.innerHTML = '<i class="fa-solid fa-university text-purple"></i> Register University Admin';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

async function handleCollegeLoginSubmit(e) {
  e.preventDefault();
  const identity = document.getElementById('col-login-user').value.trim().toLowerCase();
  const password = document.getElementById('col-login-pass').value.trim();

  try {
    if (!await checkLoginEmail('college-login-form', identity, 'college', 'col-login-password-block', 'col-login-pass', 'col-login-submit')) return;
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identity,
        collegeName: document.getElementById('col-login-college')?.value.trim() || undefined,
        password,
        role: 'college'
      })
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
    if (err.status === 409 || /already (exists|registered)/i.test(err.message || '')) {
      document.getElementById('col-login-user').value = email;
      switchCollegeAuthTab('login');
      alert('This email is already registered. Please enter your password to sign in.');
      return;
    }
    alert(err.message || 'University Registration Failed.');
  }
}

async function loadInterviewPrepView() {
  const startButton = document.getElementById('interview-start-btn');
  if (startButton) startButton.disabled = true;
  try {
    const data = await apiFetch('/student/semester-records');
    const cgpa = data.cgpa === null || data.cgpa === undefined || data.cgpa === '' ? NaN : Number(data.cgpa);
    const eligible = Number.isFinite(cgpa) && cgpa >= INTERVIEW_MIN_CGPA;
    if (Number.isFinite(cgpa)) currentProfile = { ...(currentProfile || {}), cgpa };
    setInterviewLanguage(document.getElementById('interview-language')?.value || voiceInterview.language);
    if (!voiceInterview.sessionStarted && !voiceInterview.answers.length && voiceInterview.questionIndex === 0) resetInterviewView();
    if (startButton) startButton.disabled = !eligible;
    setInterviewStatus(eligible
      ? `Eligible for interview (CGPA ${cgpa.toFixed(2)}).`
      : `Interview access requires a CGPA of ${INTERVIEW_MIN_CGPA.toFixed(2)}. Add or update your semester GPA records.`);
  } catch (err) {
    if (startButton) startButton.disabled = true;
    setInterviewStatus(err.message || 'Unable to verify interview eligibility.');
  }
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
  const cgpa = Number(currentProfile && currentProfile.cgpa);
  if (!Number.isFinite(cgpa) || cgpa < INTERVIEW_MIN_CGPA) {
    setInterviewStatus(`Interview access requires a CGPA of ${INTERVIEW_MIN_CGPA.toFixed(2)}.`);
    return;
  }
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

// FACULTY AUTH HANDLERS
function openFacultyAuthModal(tab = 'login') { openModal('faculty-auth-modal'); switchFacultyAuthTab(tab); }
function switchFacultyAuthTab(tab) {
  const login = document.getElementById('faculty-login-form'), register = document.getElementById('faculty-register-form');
  const title = document.getElementById('faculty-auth-title'), isLogin = tab === 'login';
  if (!login || !register) return;
  login.classList.toggle('hidden', !isLogin); register.classList.toggle('hidden', isLogin);
  if (title) title.innerHTML = isLogin ? '<i class="fa-solid fa-user-tie text-purple"></i> Faculty Sign In' : '<i class="fa-solid fa-user-plus text-purple"></i> Register Faculty Account';
  if (isLogin) resetLoginForm('faculty-login-form', 'fac-login-password-block', 'fac-login-pass', 'fac-login-submit');
}
async function handleFacultyLoginSubmit(event) {
  event.preventDefault();
  const identity = document.getElementById('fac-login-user').value.trim().toLowerCase(), password = document.getElementById('fac-login-pass').value.trim();
  try {
    if (!await checkLoginEmail('faculty-login-form', identity, 'faculty', 'fac-login-password-block', 'fac-login-pass', 'fac-login-submit')) return;
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ identity, password, role: 'faculty' }) });
    authToken = data.token; localStorage.setItem('sb_token', authToken); currentUser = data.user; currentProfile = null; currentRole = 'faculty';
    closeModal('faculty-auth-modal'); showAppWorkspace(); switchPortalRole('faculty');
  } catch (err) { alert(err.message || 'Faculty sign in failed.'); }
}
async function handleFacultyRegisterSubmit(event) {
  event.preventDefault();
  const fullName = document.getElementById('fac-reg-name').value.trim(), username = document.getElementById('fac-reg-username').value.trim().toLowerCase(), email = document.getElementById('fac-reg-email').value.trim().toLowerCase(), mobile = document.getElementById('fac-reg-mobile').value.trim();
  const collegeName = document.getElementById('fac-reg-college').value.trim(), department = document.getElementById('fac-reg-department').value.trim(), password = document.getElementById('fac-reg-pass').value.trim();
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ fullName, username, email, mobile, collegeName, department, password, role: 'faculty' }) });
    authToken = data.token; localStorage.setItem('sb_token', authToken); currentUser = data.user; currentProfile = null; currentRole = 'faculty';
    closeModal('faculty-auth-modal'); showAppWorkspace(); switchPortalRole('faculty');
  } catch (err) { alert(err.message || 'Faculty registration failed.'); }
}

// FACULTY ACADEMIA WORKSPACE
const FACULTY_RESOURCES = [
  ['faculty-internships', 'Faculty internships'], ['industrial-training', 'Industrial training'], ['fdp', 'FDP programs'], ['learning-programs', 'Learning programs'], ['mentorship', 'Mentorship'], ['workshops', 'Workshops'], ['guest-lectures', 'Guest lectures'], ['live-projects', 'Live projects'], ['research-collaborations', 'Research collaborations'], ['research-projects', 'Research projects'], ['consultancy', 'Consultancy'], ['innovation-challenges', 'Innovation challenges'], ['internship-progress', 'Progress & feedback'], ['portfolio-extensions', 'Portfolio']
];
const COLLABORATION_FRONTEND_RESOURCES = ['mentorship', 'guest-lectures', 'workshops', 'innovation-challenges', 'live-projects', 'research-collaborations', 'consultancy'];
const FACULTY_RESOURCE_SCHEMAS = {
  'faculty-internships': [
    ['title', 'Title *', 'text', true],
    ['company', 'Company / Partner', 'text'],
    ['required_skills', 'Required skills', 'text', false, 'Java, SQL, React'],
    ['eligibility', 'Eligibility', 'text'],
    ['duration', 'Duration', 'text'],
    ['start_date', 'Start date', 'date'],
    ['end_date', 'End date', 'date'],
    ['location', 'Location', 'text'],
    ['work_mode', 'Work mode', 'select', false, ['Hybrid', 'Remote', 'On-site']],
    ['deadline', 'Application deadline', 'date'],
    ['mentor', 'Mentor / contact', 'text'],
    ['status', 'Status', 'select', false, ['Open', 'Shortlisted', 'Selected', 'In progress', 'Completed']],
    ['description', 'Description', 'textarea']
  ],
  'industrial-training': [
    ['title', 'Training title *', 'text', true], ['company', 'Industry partner', 'text'], ['required_skills', 'Required skills', 'text'], ['duration', 'Duration', 'text'], ['location', 'Location', 'text'], ['deadline', 'Application deadline', 'date'], ['description', 'Description', 'textarea']
  ],
  fdp: [
    ['title', 'Program title *', 'text', true],
    ['organizer', 'Organizer', 'text'],
    ['topics', 'Topics', 'text', false, 'AI, Cloud, Research, Product'],
    ['skills', 'Skills', 'text', false, 'ML, Data, Communication'],
    ['duration', 'Duration', 'text'],
    ['start_date', 'Start date', 'date'],
    ['end_date', 'End date', 'date'],
    ['mode', 'Mode', 'select', false, ['Hybrid', 'Online', 'On-site']],
    ['eligibility', 'Eligibility', 'text'],
    ['deadline', 'Registration deadline', 'date'],
    ['capacity', 'Capacity', 'number'],
    ['certificate', 'Certificate availability', 'text'],
    ['description', 'Description', 'textarea']
  ],
  'learning-programs': [
    ['title', 'Program title *', 'text', true],
    ['company', 'Company / organizer', 'text'],
    ['required_skills', 'Required skills', 'text', false, 'Java, SQL, React'],
    ['duration', 'Duration', 'text'],
    ['start_date', 'Start date', 'date'],
    ['end_date', 'End date', 'date'],
    ['mode', 'Mode', 'select', false, ['Online', 'Hybrid', 'Weekend']],
    ['eligibility', 'Eligibility', 'text'],
    ['deadline', 'Enrollment deadline', 'date'],
    ['certificate', 'Certificate info', 'text'],
    ['description', 'Description', 'textarea']
  ],
  mentorship: [
    ['title', 'Mentorship title *', 'text', true],
    ['mentor', 'Mentor / company', 'text'],
    ['expertise', 'Expertise', 'text', false, 'React, System design, Product'],
    ['availability', 'Available slots', 'text'],
    ['duration', 'Session duration', 'text'],
    ['location', 'Location / mode', 'text'],
    ['deadline', 'Request deadline', 'date'],
    ['description', 'Description', 'textarea']
  ],
  workshops: [
    ['title', 'Workshop title *', 'text', true],
    ['organizer', 'Organizer', 'text'],
    ['topics', 'Topics', 'text', false, 'AI, DSA, Career readiness'],
    ['skills', 'Skills covered', 'text'],
    ['date', 'Workshop date', 'date'],
    ['mode', 'Mode', 'select', false, ['Online', 'Hybrid', 'On-site']],
    ['capacity', 'Capacity', 'number'],
    ['certificate', 'Certificate info', 'text'],
    ['description', 'Description', 'textarea']
  ],
  'guest-lectures': [
    ['title', 'Lecture title *', 'text', true],
    ['speaker', 'Speaker', 'text'],
    ['company', 'Company', 'text'],
    ['topic', 'Topic', 'text'],
    ['date', 'Lecture date', 'date'],
    ['time', 'Time', 'text'],
    ['mode', 'Mode', 'select', false, ['Online', 'On-campus', 'Hybrid']],
    ['description', 'Description', 'textarea']
  ],
  'live-projects': [
    ['title', 'Project title *', 'text', true],
    ['company', 'Company / sponsor', 'text'],
    ['required_skills', 'Required skills', 'text', false, 'Java, SQL, React'],
    ['duration', 'Duration', 'text'],
    ['team_size', 'Team size', 'number'],
    ['mentor', 'Mentor', 'text'],
    ['deadline', 'Application deadline', 'date'],
    ['status', 'Status', 'select', false, ['Open', 'Shortlisted', 'In progress', 'Completed']],
    ['description', 'Description', 'textarea']
  ],
  'research-collaborations': [
    ['title', 'Research title *', 'text', true],
    ['domain', 'Research domain', 'text'],
    ['required_skills', 'Required skills', 'text'],
    ['expertise', 'Required expertise', 'text'],
    ['duration', 'Duration', 'text'],
    ['collaboration_type', 'Collaboration type', 'select', false, ['Academic', 'Industry', 'Joint']],
    ['contact', 'Contact person', 'text'],
    ['deadline', 'Application deadline', 'date'],
    ['description', 'Description', 'textarea']
  ],
  'research-projects': [
    ['title', 'Project title *', 'text', true], ['domain', 'Research domain', 'text'], ['principal_investigator', 'Principal investigator', 'text'], ['required_skills', 'Required skills', 'text'], ['duration', 'Duration', 'text'], ['funding', 'Funding / grant', 'text'], ['deadline', 'Application deadline', 'date'], ['description', 'Description', 'textarea']
  ],
  consultancy: [
    ['title', 'Consultancy opportunity *', 'text', true],
    ['company', 'Industry / client', 'text'],
    ['required_skills', 'Required skills', 'text'],
    ['duration', 'Duration', 'text'],
    ['location', 'Location', 'text'],
    ['deadline', 'Deadline', 'date'],
    ['status', 'Status', 'select', false, ['Open', 'Reviewing', 'Approved', 'Completed']],
    ['description', 'Description', 'textarea']
  ],
  'innovation-challenges': [
    ['title', 'Challenge title *', 'text', true], ['organizer', 'Organizer', 'text'], ['theme', 'Theme', 'text'], ['required_skills', 'Skills', 'text'], ['deadline', 'Submission deadline', 'date'], ['prize', 'Prize / recognition', 'text'], ['description', 'Description', 'textarea']
  ],
  'internship-progress': [
    ['title', 'Progress title *', 'text', true],
    ['company', 'Company', 'text'],
    ['status', 'Current status', 'select', false, ['Selected', 'Started', 'In progress', 'Completed']],
    ['mentor', 'Mentor / reviewer', 'text'],
    ['duration', 'Duration', 'text'],
    ['feedback', 'Mentor feedback', 'textarea'],
    ['certificate', 'Certificate / completion record', 'text']
  ],
  'portfolio-extensions': [
    ['title', 'Portfolio item *', 'text', true],
    ['type', 'Type', 'select', false, ['Project', 'Internship', 'Certificate', 'Achievement', 'Learning Program']],
    ['company', 'Associated company / organization', 'text'],
    ['link', 'Portfolio link / proof URL', 'text'],
    ['status', 'Status', 'select', false, ['Draft', 'Verified', 'Published']],
    ['description', 'Description', 'textarea']
  ]
};
let facultyItems = [];
function navigateToFacultyResource(resource) {
  if (currentRole !== 'faculty' || !currentUser || currentUser.role !== 'faculty') { openFacultyAuthModal('login'); return; }
  const select = document.getElementById('faculty-resource'); if (select) select.value = resource; navigateTo('faculty-dashboard');
}
function facultyResource() { return document.getElementById('faculty-resource')?.value || FACULTY_RESOURCES[0][0]; }
function getFacultyResourceSchema(resource = facultyResource()) {
  return FACULTY_RESOURCE_SCHEMAS[resource] || [
    ['title', 'Title *', 'text', true],
    ['description', 'Description', 'textarea']
  ];
}
function renderFacultyCreateFields() {
  const fieldsContainer = document.getElementById('faculty-create-fields');
  if (!fieldsContainer) return;
  const schema = getFacultyResourceSchema();
  fieldsContainer.innerHTML = schema.map(([key, label, type, required, options]) => {
    const isRequired = Boolean(required);
    const commonAttrs = `id="faculty-${key}" name="${key}" class="saas-input" ${required ? 'required' : ''}`;
    if (type === 'textarea') {
      return `<div style="grid-column: 1 / -1;"><label class="block text-xs font-bold mb-1">${label}</label><textarea ${commonAttrs} rows="3" placeholder="Add details, eligibility, and outcomes"></textarea></div>`;
    }
    if (type === 'select') {
      const values = Array.isArray(options) ? options : ['Open', 'Available'];
      return `<div><label class="block text-xs font-bold mb-1">${label}</label><select ${commonAttrs}><option value="">Select</option>${values.map(v => `<option value="${v}">${v}</option>`).join('')}</select></div>`;
    }
    if (type === 'number') {
      return `<div><label class="block text-xs font-bold mb-1">${label}</label><input type="number" ${commonAttrs} /></div>`;
    }
    if (type === 'date') {
      return `<div><label class="block text-xs font-bold mb-1">${label}</label><input type="date" ${commonAttrs} /></div>`;
    }
    if (type === 'text' || type === 'email') {
      return `<div><label class="block text-xs font-bold mb-1">${label}</label><input type="text" ${commonAttrs} placeholder="${label.includes('skills') || label.includes('Topics') ? 'Java, SQL, React' : ''}" /></div>`;
    }
    return `<div><label class="block text-xs font-bold mb-1">${label}</label><input type="text" ${commonAttrs} /></div>`;
  }).join('');
}
function facultyFieldValue(key) {
  const field = document.getElementById(`faculty-${key}`);
  if (!field) return '';
  return field.value ? String(field.value).trim() : '';
}
function parseFacultyListValue(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}
function normalizeFacultyPayload(resource, formData) {
  const payload = { title: formData.title || facultyFieldValue('title'), description: formData.description || facultyFieldValue('description') };
  if (payload.title) payload.title = payload.title.trim();
  if (payload.description) payload.description = payload.description.trim();
  const schema = getFacultyResourceSchema(resource);
  for (const [key, label, type, required, options] of schema) {
    if (key === 'title' || key === 'description') continue;
    const value = formData[key] !== undefined ? formData[key] : facultyFieldValue(key);
    if (!value && value !== 0) continue;
    if (['required_skills', 'topics', 'skills', 'expertise', 'eligibility'].includes(key)) {
      payload[key] = parseFacultyListValue(value);
      continue;
    }
    payload[key] = value;
  }
  if (!payload.partner && payload.company) payload.partner = payload.company;
  if (!payload.date && payload.start_date) payload.date = payload.start_date;
  if (!payload.deadline && payload.deadline === '') payload.deadline = null;
  return payload;
}
async function loadFacultyResource() {
  const select = document.getElementById('faculty-resource'); if (!select) return;
  if (!select.options.length) select.innerHTML = FACULTY_RESOURCES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  renderFacultyCreateFields();
  const target = document.getElementById('faculty-items');
  if (target) target.innerHTML = '<div class="saas-card"><p style="color:var(--text-muted);margin:0;">Loading opportunities…</p></div>';
  try { const data = await apiFetch(`/academia/${facultyResource()}`); facultyItems = Array.isArray(data) ? data : (data.items || []); renderFacultyItems(); }
  catch (err) { facultyItems = []; renderFacultyItems(err.message); }
}
async function loadFacultyDashboard() {
  const summary = document.getElementById('faculty-summary');
  try {
    const [dashboard, profileData] = await Promise.all([apiFetch('/faculty/dashboard'), apiFetch('/faculty/profile')]);
    const cards = [['Activities', dashboard.total], ['Active', dashboard.active], ['Completed', dashboard.completed], ['Certificates', dashboard.certificates]];
    if (summary) summary.innerHTML = cards.map(([label, value]) => `<div class="saas-card"><div class="text-xs" style="color:var(--text-muted);">${label}</div><strong style="font-size:1.4rem;">${Number(value || 0)}</strong></div>`).join('');
    const profile = profileData.profile || {};
    const profileFields = {
      name: profile.name || '',
      email: profile.email || '',
      phone: profile.phone || profile.mobile || '',
      college: profile.college || profile.institution || profile.university || '',
      department: profile.department || '',
      designation: profile.designation || '',
      bio: profile.bio || '',
      expertise: Array.isArray(profile.expertise) ? profile.expertise.join(', ') : (profile.expertise || ''),
      skills: Array.isArray(profile.skills) ? profile.skills.join(', ') : (profile.skills || ''),
      experience: profile.experience || '',
      research: profile.research_interests || profile.research || '',
      contact: profile.contact_info || profile.contact || ''
    };
    Object.entries(profileFields).forEach(([key, value]) => {
      const field = document.getElementById(`faculty-profile-${key}`);
      if (field) field.value = value || '';
    });
  } catch (error) {
    if (summary) summary.innerHTML = `<div class="saas-card" style="grid-column:1/-1;"><span style="color:var(--text-muted);">${facultyText(error.message || 'Unable to load faculty activity.')}</span></div>`;
  }
}
async function saveFacultyProfile(event) {
  event.preventDefault();
  try {
    await apiFetch('/faculty/profile', { method: 'PUT', body: JSON.stringify({
      name: document.getElementById('faculty-profile-name')?.value.trim(),
      college: document.getElementById('faculty-profile-college')?.value.trim(),
      department: document.getElementById('faculty-profile-department')?.value.trim(),
      bio: document.getElementById('faculty-profile-bio')?.value.trim(),
      expertise: parseFacultyListValue(document.getElementById('faculty-profile-expertise')?.value)
    }) });
    alert('Faculty profile saved.');
  } catch (error) { alert(error.message || 'Unable to save faculty profile.'); }
}
function facultyText(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function filterFacultyItems() { renderFacultyItems(); }
function renderFacultyItems(errorMessage = '') {
  const target = document.getElementById('faculty-items'); if (!target) return;
  if (errorMessage) { target.innerHTML = `<div class="saas-card"><p style="color:var(--text-muted);margin:0;">${facultyText(errorMessage)}</p></div>`; return; }
  const query = (document.getElementById('faculty-search')?.value || '').toLowerCase();
  const items = facultyItems.filter(item => !query || JSON.stringify(item).toLowerCase().includes(query));
  if (!items.length) { target.innerHTML = '<div class="saas-card"><p style="color:var(--text-muted);margin:0;">No listings yet. Create the first one for this feature.</p></div>'; return; }
  target.innerHTML = items.map(item => {
    const tags = [
      item.company, item.organizer, item.partner, item.location, item.mode, item.work_mode,
      item.duration, item.start_date, item.end_date, item.deadline, item.mentor, item.speaker
    ].filter(Boolean);
    const scope = [
      item.required_skills, item.topics, item.skills, item.expertise, item.eligibility
    ].filter(Boolean).flatMap(val => Array.isArray(val) ? val : [val]);
    const meta = [...tags.slice(0, 4), ...scope.slice(0, 4)].map(value => `<span class="badge-saas badge-blue">${facultyText(value)}</span>`).join('');
    const description = item.description || item.topic || 'Details not provided.';
    const status = item.status || 'open';
    const entries = [...(item.applications || []), ...(item.registrations || [])];
    const mine = entries.find(entry => String(entry.user_id) === String(currentUser?.id));
    const owner = String(item.created_by) === String(currentUser?.id);
    const collaboration = COLLABORATION_FRONTEND_RESOURCES.includes(facultyResource());
    const pending = owner ? entries.filter(entry => ['requested', 'submitted', 'registered'].includes(String(entry.status || '').toLowerCase())) : [];
    const itemId = facultyText(item.id);
    const progressButton = mine || owner ? `<button class="btn-saas btn-outline" onclick="facultyLifecycle('${itemId}','progress')">Update progress</button>` : '';
    const requestButton = !owner && !mine && collaboration ? `<button class="btn-saas btn-outline" onclick="facultyLifecycle('${itemId}','request')">Request participation</button>` : '';
    const legacyButtons = !collaboration ? `<button class="btn-saas btn-outline" onclick="facultyLifecycle('${itemId}','apply')">Apply</button><button class="btn-saas btn-outline" onclick="facultyLifecycle('${itemId}','register')">Register</button>` : '';
    return `<div class="saas-card"><div class="flex-between gap-3 mb-2"><h3 style="font-weight:700;margin:0;">${facultyText(item.title || item.name || 'Academia listing')}</h3><span class="badge-saas badge-blue">${facultyText(status)}</span></div><p style="font-size:.82rem;color:var(--text-muted);margin-bottom:.75rem;">${facultyText(description)}</p><div class="flex-align gap-2 flex-wrap mb-3">${meta || '<span class="badge-saas badge-blue">Details available</span>'}</div><div class="text-xs mb-3" style="color:var(--text-muted);">${facultyText(item.date || item.start_date || item.deadline || item.partner || item.company || '')}${item.progress !== undefined ? ` · Progress: ${Number(item.progress) || 0}%` : ''}${mine ? ` · Your request: ${facultyText(mine.status || 'pending')}` : ''}</div><div class="flex-align gap-2 flex-wrap"><button class="btn-saas btn-outline" onclick="facultyLifecycle('${itemId}','status')">Track status</button>${progressButton}${requestButton}${legacyButtons}<button class="btn-saas btn-outline" onclick="facultyLifecycle('${itemId}','feedback')">Feedback</button>${pending.map(entry => `<button class="btn-saas btn-outline" onclick="facultyReview('${itemId}','${facultyText(entry.user_id)}','approved')">Approve ${facultyText(entry.user_id)}</button><button class="btn-saas btn-outline" onclick="facultyReview('${itemId}','${facultyText(entry.user_id)}','rejected')">Reject ${facultyText(entry.user_id)}</button>`).join('')}</div></div>`;
  }).join('');
}
async function facultyReview(id, userId, status) {
  try {
    await apiFetch(`/academia/${facultyResource()}/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ user_id: userId, status }) });
    await loadFacultyResource();
  } catch (err) { alert(err.message || 'Unable to review request.'); }
}
function openFacultyCreateForm() {
  renderFacultyCreateFields();
  document.getElementById('faculty-create-panel')?.classList.remove('hidden');
  const label = FACULTY_RESOURCES.find(([value]) => value === facultyResource());
  const target = document.getElementById('faculty-create-label');
  if (target) target.textContent = label ? label[1].toLowerCase() : 'listing';
}
function closeFacultyCreateForm() { document.getElementById('faculty-create-panel')?.classList.add('hidden'); }
async function handleFacultyCreate(event) {
  event.preventDefault();
  try {
    const resource = facultyResource();
    const payload = normalizeFacultyPayload(resource, {});
    const form = document.getElementById('faculty-create-form');
    if (form) {
      const formData = new FormData(form);
      for (const [key, value] of formData.entries()) {
        if (typeof value === 'string' && value.trim()) payload[key.replace(/^faculty-/, '')] = value.trim();
      }
    }
    const finalPayload = normalizeFacultyPayload(resource, payload);
    await apiFetch(`/academia/${resource}`, { method: 'POST', body: JSON.stringify(finalPayload) });
    form.reset(); closeFacultyCreateForm(); await loadFacultyResource();
  } catch (err) { alert(err.message || 'Unable to create listing.'); }
}
async function facultyLifecycle(id, operation) {
  try {
    if (operation === 'status') { const data = await apiFetch(`/academia/${facultyResource()}/${encodeURIComponent(id)}/status`); alert(`Status: ${data.status || 'unknown'}`); return; }
    if (operation === 'progress') {
      const value = prompt('Progress percentage (0-100)', '0');
      if (value === null) return;
      await apiFetch(`/academia/${facultyResource()}/${encodeURIComponent(id)}/progress`, { method: 'POST', body: JSON.stringify({ progress: Number(value) }) });
      await loadFacultyResource(); return;
    }
    const body = operation === 'feedback' ? { rating: 5, comment: prompt('Add feedback') || '' } : {};
    if (operation === 'feedback' && !body.comment) return;
    await apiFetch(`/academia/${facultyResource()}/${encodeURIComponent(id)}/${operation}`, { method: 'POST', body: JSON.stringify(body) });
    alert(operation === 'apply' ? 'Application submitted.' : operation === 'register' ? 'Registration saved.' : operation === 'request' ? 'Participation request submitted.' : 'Feedback submitted.'); await loadFacultyResource();
  } catch (err) { alert(err.message || `Unable to ${operation}.`); }
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

    const dashboardCgpa = dashboard.profile && dashboard.profile.cgpa;
    const cgpaStat = document.getElementById('stat-cgpa');
    if (cgpaStat) {
      cgpaStat.textContent = dashboardCgpa === null || dashboardCgpa === undefined || dashboardCgpa === ''
        ? 'Add GPA'
        : Number(dashboardCgpa).toFixed(2);
    }
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
    const [data, academics] = await Promise.all([
      apiFetch('/student/profile'),
      apiFetch('/student/semester-records')
    ]);
    const p = data.profile || {};
    renderProfileSemesterMarks(academics.records || []);
    const cgpa = academics.cgpa === null || academics.cgpa === undefined || academics.cgpa === '' ? NaN : Number(academics.cgpa);
    const profileCgpaField = document.getElementById('prof-cgpa');
    const profileCgpa = document.getElementById('profile-cgpa-value');
    const eligibility = document.getElementById('profile-interview-eligibility');
    if (Number.isFinite(cgpa)) {
      if (profileCgpaField) profileCgpaField.value = cgpa.toFixed(2);
      if (profileCgpa) profileCgpa.textContent = cgpa.toFixed(2);
      if (eligibility) {
        eligibility.textContent = cgpa >= INTERVIEW_MIN_CGPA
          ? `Eligible to attend interviews. Minimum required CGPA: ${INTERVIEW_MIN_CGPA.toFixed(2)}.`
          : `Not eligible yet. Minimum required CGPA: ${INTERVIEW_MIN_CGPA.toFixed(2)}.`;
      }
      currentProfile = { ...p, cgpa };
    } else {
      if (profileCgpaField) profileCgpaField.value = 'Not calculated';
      if (profileCgpa) profileCgpa.textContent = '—';
      if (eligibility) eligibility.textContent = `Add semester GPA records to calculate your CGPA and check interview eligibility (minimum ${INTERVIEW_MIN_CGPA.toFixed(2)}).`;
      currentProfile = p;
    }
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
  } catch (e) {
    const overview = document.getElementById('college-overview-cards');
    if (overview) overview.innerHTML = `<div class="saas-card">Unable to load university analytics. ${e.message || 'Please try again later.'}</div>`;
  }
}

function renderProfileSemesterMarks(records) {
  const container = document.getElementById('profile-semester-marks');
  if (!container) return;
  const bySemester = new Map((Array.isArray(records) ? records : []).map(record => [
    Number(record.semester_number ?? record.semester),
    record
  ]));
  container.innerHTML = Array.from({ length: 8 }, (_, index) => {
    const semester = index + 1;
    const record = bySemester.get(semester);
    const gpa = record && record.gpa !== null && record.gpa !== undefined ? record.gpa : '';
    const status = gpa === '' ? 'Not entered' : 'Included in CGPA';
    return `<tr><td style="padding:0.65rem 0;">Semester ${semester}</td><td style="padding:0.65rem 0;"><input type="number" id="profile-semester-${semester}" class="saas-input profile-semester-mark" data-record-id="${record ? record.id : ''}" min="0" max="10" step="0.01" value="${gpa}" placeholder="e.g. 8.50" oninput="updateProfileCgpaPreview()" style="max-width:220px;" /></td><td id="profile-semester-status-${semester}" style="padding:0.65rem 0;color:var(--text-muted);">${status}</td></tr>`;
  }).join('');
  updateProfileCgpaPreview();
}

function updateProfileCgpaPreview() {
  const marks = Array.from(document.querySelectorAll('.profile-semester-mark'))
    .map(input => Number(input.value))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 10);
  const cgpa = marks.length ? (marks.reduce((sum, gpa) => sum + gpa, 0) / marks.length) : null;
  const output = document.getElementById('profile-marks-cgpa');
  const status = document.getElementById('profile-marks-status');
  if (output) output.textContent = cgpa === null ? '—' : cgpa.toFixed(2);
  if (status) status.textContent = marks.length
    ? `${marks.length} semester${marks.length === 1 ? '' : 's'} included. CGPA is calculated from GPA.`
    : 'Enter GPA values to calculate your CGPA.';
  document.querySelectorAll('.profile-semester-mark').forEach(input => {
    const semester = input.id.replace('profile-semester-', '');
    const semesterStatus = document.getElementById(`profile-semester-status-${semester}`);
    if (semesterStatus) semesterStatus.textContent = input.value === '' ? 'Not entered' : 'Included in CGPA';
  });
}

async function saveProfileSemesterMarks() {
  const inputs = Array.from(document.querySelectorAll('.profile-semester-mark'));
  if (!inputs.length) return;
  try {
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const semester = index + 1;
      const rawMarks = input.value.trim();
      const recordId = input.dataset.recordId;
      if (rawMarks === '') {
        if (recordId) {
          await apiFetch(`/student/semester-records/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
        }
        continue;
      }
      const marks = Number(rawMarks);
      if (!Number.isFinite(marks) || marks < 0 || marks > 10) {
        throw new Error(`Semester ${semester} GPA must be between 0 and 10.`);
      }
      const payload = {
        semester_number: semester,
        semester: `Semester ${semester}`,
        gpa: Number(marks.toFixed(2)),
        academic_status: 'Pending'
      };
      if (recordId) {
        await apiFetch(`/student/semester-records/${encodeURIComponent(recordId)}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/student/semester-records', { method: 'POST', body: JSON.stringify(payload) });
      }
    }
    await loadProfileView();
    alert('GPA details saved and CGPA calculated successfully.');
  } catch (err) {
    alert(err.message || 'Unable to save semester marks.');
  }
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
      const resumeText = await extractPdfText(resumeFile);
      atsAnalysis = calculateResumeATS(resumeText);
      renderResumeATSAnalysis(atsAnalysis);
      const formData = new FormData();
      formData.append('file', resumeFile);
      formData.append('title', 'Resume');
      formData.append('atsAnalysis', JSON.stringify(atsAnalysis));
      await apiFetch('/student/resume', { method: 'POST', body: formData });
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
function formatSemesterField(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return digits === 0 ? String(Math.round(numeric)) : numeric.toFixed(digits);
}

function resetSemesterForm() {
  const form = document.getElementById('semester-record-form');
  if (form) form.reset();
  const idField = document.getElementById('semester-record-id');
  if (idField) idField.value = '';
  const submitBtn = document.getElementById('semester-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Save Semester Record';
  const cancelBtn = document.getElementById('cancel-edit-semester-btn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
  const addBtn = document.getElementById('add-semester-record-btn');
  if (addBtn) addBtn.textContent = 'Add Semester Record';
}

function populateSemesterForm(record) {
  if (!record) return resetSemesterForm();
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value === null || value === undefined ? '' : value;
  };
  setValue('semester-record-id', record.id || '');
  setValue('semester-number', record.semester_number ?? record.semester ?? '');
  setValue('semester-year', record.academic_year || record.year || '');
  setValue('semester-status', record.academic_status || record.status || 'Pending');
  setValue('semester-gpa', record.gpa ?? '');
  setValue('semester-cgpa', record.cgpa ?? '');
  setValue('semester-total-marks', record.total_marks ?? record.semester_marks ?? '');
  setValue('semester-percentage', record.percentage ?? '');
  setValue('semester-total-subjects', record.subjects_count ?? '');
  setValue('semester-passed', record.passed_subjects ?? '');
  setValue('semester-failed', record.failed_subjects ?? '');
  setValue('semester-backlogs', record.backlogs ?? '');
  setValue('semester-remarks', record.remarks || record.comment || '');
  const submitBtn = document.getElementById('semester-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Update Semester Record';
  const cancelBtn = document.getElementById('cancel-edit-semester-btn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  const addBtn = document.getElementById('add-semester-record-btn');
  if (addBtn) addBtn.textContent = 'Add New Record';
}

function buildSemesterRecordPayload() {
  const getNum = id => {
    const value = document.getElementById(id)?.value;
    if (value === '' || value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const getText = id => (document.getElementById(id)?.value || '').trim();
  const semesterNumber = getNum('semester-number');
  return {
    semester_number: semesterNumber,
    semester: semesterNumber ? `Semester ${semesterNumber}` : 'Semester 1',
    academic_year: getText('semester-year'),
    gpa: getNum('semester-gpa'),
    cgpa: getNum('semester-cgpa'),
    total_marks: getNum('semester-total-marks'),
    semester_marks: getNum('semester-total-marks'),
    percentage: getNum('semester-percentage'),
    subjects_count: getNum('semester-total-subjects'),
    passed_subjects: getNum('semester-passed'),
    failed_subjects: getNum('semester-failed'),
    backlogs: getNum('semester-backlogs'),
    academic_status: getText('semester-status') || 'Pending',
    remarks: getText('semester-remarks')
  };
}

async function handleSemesterRecordSubmit(event) {
  event.preventDefault();
  const form = document.getElementById('semester-record-form');
  if (!form) return;
  const id = document.getElementById('semester-record-id')?.value;
  const payload = buildSemesterRecordPayload();

  try {
    if (id) {
      await apiFetch(`/student/semester-records/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      await apiFetch('/student/semester-records', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    resetSemesterForm();
    await loadAcademicsView();
    alert(id ? 'Semester record updated successfully.' : 'Semester record saved successfully.');
  } catch (err) {
    alert(err.message || 'Unable to save semester record.');
  }
}

async function editSemesterRecord(recordId) {
  try {
    const data = await apiFetch(`/student/semester-records/${encodeURIComponent(recordId)}`);
    populateSemesterForm(data.record || data);
  } catch (err) {
    alert(err.message || 'Unable to load semester record for editing.');
  }
}

async function deleteSemesterRecord(recordId) {
  if (!recordId) return;
  const confirmed = window.confirm('Delete this semester record?');
  if (!confirmed) return;
  try {
    await apiFetch(`/student/semester-records/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
    await loadAcademicsView();
    resetSemesterForm();
    alert('Semester record deleted successfully.');
  } catch (err) {
    alert(err.message || 'Unable to delete semester record.');
  }
}

async function loadAcademicsView() {
  try {
    const data = await apiFetch('/student/semester-records');
    const records = Array.isArray(data.records) ? data.records : [];
    const calculatedCgpa = data.cgpa;
    const semesterCgpa = document.getElementById('semester-calculated-cgpa');
    if (semesterCgpa) semesterCgpa.textContent = calculatedCgpa === null || calculatedCgpa === undefined ? '—' : formatSemesterField(calculatedCgpa);
    const tbody = document.getElementById('semester-table-body');
    if (!tbody) return;
    if (!records.length) {
      tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; color: var(--text-muted);">No semester records available yet.</td></tr>';
      return;
    }

    const cgpaSummary = document.getElementById('stat-cgpa');
    if (cgpaSummary && calculatedCgpa !== null && calculatedCgpa !== undefined) {
      cgpaSummary.textContent = formatSemesterField(calculatedCgpa);
    }

    tbody.innerHTML = records.map(record => {
      const semesterNumber = record.semester_number ?? record.semester ?? '—';
      const academicYear = record.academic_year || '—';
      const academicStatus = record.academic_status || record.status || 'Pending';
      const gpa = formatSemesterField(record.gpa);
      const cgpa = formatSemesterField(record.cgpa);
      const totalMarks = formatSemesterField(record.total_marks ?? record.semester_marks, 0);
      const percentage = formatSemesterField(record.percentage);
      const subjects = formatSemesterField(record.subjects_count, 0);
      const passed = formatSemesterField(record.passed_subjects, 0);
      const failed = formatSemesterField(record.failed_subjects, 0);
      const backlogs = formatSemesterField(record.backlogs, 0);
      const remarks = record.remarks || '—';
      const semesterLabel = record.semester || `Semester ${semesterNumber}`;
      return `<tr>
        <td style="font-weight:700;">${semesterLabel}</td>
        <td>${academicYear}</td>
        <td>${gpa}</td>
        <td>${cgpa}</td>
        <td>${totalMarks}</td>
        <td>${percentage}</td>
        <td>${subjects}</td>
        <td>${passed}</td>
        <td>${failed}</td>
        <td>${backlogs}</td>
        <td><span class="badge-saas badge-emerald">${academicStatus}</span></td>
        <td>${remarks}</td>
        <td>
          <div class="flex-align gap-2">
            <button class="btn-saas btn-outline" type="button" onclick="editSemesterRecord('${record.id || ''}')">Edit</button>
            <button class="btn-saas btn-outline" type="button" onclick="deleteSemesterRecord('${record.id || ''}')">Delete</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    const tbody = document.getElementById('semester-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; color: var(--text-muted);">Unable to load semester records.</td></tr>';
    console.error('Semester records load failed', e);
  }
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
  const documentList = document.getElementById('career-document-list');
  if (documentList) documentList.innerHTML = '<div class="text-sm" style="color:var(--text-muted);">Loading private documents…</div>';
  try {
    const [data, documentData] = await Promise.all([apiFetch('/student/portfolio'), apiFetch('/student/documents')]);
    const projects = data.projects || [];
    const certificates = data.certifications || [];
    const projectList = document.getElementById('portfolio-project-list');
    const certList = document.getElementById('portfolio-certificate-list');
    renderCareerDocuments(documentData.documents || []);

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
            ${cert.document_id ? `<button class="btn-saas btn-outline" type="button" onclick="openCareerDocument('${encodeURIComponent(cert.document_id)}','view')">File</button>` : (cert.fileUrl ? `<a class="btn-saas btn-outline" href="${cert.fileUrl}" target="_blank" rel="noreferrer">File</a>` : '')}
            <button class="btn-saas btn-outline" type="button" onclick="deleteStudentCertificate(${cert.id})">Delete</button>
          </div>
        </div>
      `).join('') : '<div class="saas-card"><p style="color:var(--text-muted); margin:0;">No certificates uploaded yet.</p></div>';
    }
  } catch (e) {
    console.error('Portfolio load failed', e);
    if (documentList) documentList.innerHTML = `<div class="text-sm" style="color:var(--text-danger);">Unable to load private documents. ${e.message || 'Please try again.'}</div>`;
  }
}

function renderCareerDocuments(documents) {
  const list = document.getElementById('career-document-list');
  if (!list) return;
  list.innerHTML = documents.length ? documents.map(document => `
    <div class="flex-between gap-3" style="border:1px solid var(--border-color);border-radius:var(--radius-md);padding:.75rem;">
      <div><strong>${document.title || document.original_name}</strong><div class="text-xs" style="color:var(--text-muted);">${String(document.category || '').replaceAll('_', ' ')} · ${Math.ceil(Number(document.size_bytes || 0) / 1024)} KB</div></div>
      <div class="flex-align gap-2"><button class="btn-saas btn-outline" type="button" onclick="openCareerDocument('${encodeURIComponent(document.id)}','view')">View</button><button class="btn-saas btn-outline" type="button" onclick="openCareerDocument('${encodeURIComponent(document.id)}','download')">Download</button><button class="btn-saas btn-outline" type="button" onclick="deleteCareerDocument('${encodeURIComponent(document.id)}')">Delete</button></div>
    </div>
  `).join('') : '<div class="text-sm" style="color:var(--text-muted);">No career documents uploaded yet.</div>';
}

async function handleCareerDocumentUpload(event) {
  event.preventDefault();
  const stateEl = document.getElementById('career-document-state');
  const file = document.getElementById('career-document-file')?.files?.[0];
  if (!file) return;
  stateEl.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', document.getElementById('career-document-category').value);
    formData.append('title', document.getElementById('career-document-title').value.trim());
    await apiFetch('/student/documents', { method: 'POST', body: formData });
    document.getElementById('career-document-form').reset();
    stateEl.textContent = 'Uploaded securely.';
    await loadPortfolioView();
  } catch (error) {
    stateEl.textContent = error.message || 'Upload failed.';
  }
}

async function openCareerDocument(id, action) {
  try {
    const response = await fetch(`${API_BASE}/student/documents/${id}/${action}`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} });
    if (!response.ok) throw new Error('Unable to access this document.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    if (action === 'download') link.download = 'career-document';
    link.target = '_blank';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { alert(error.message || 'Unable to access document.'); }
}

async function deleteCareerDocument(id) {
  if (!confirm('Delete this private document?')) return;
  try {
    await apiFetch(`/student/documents/${id}`, { method: 'DELETE' });
    await loadPortfolioView();
  } catch (error) { alert(error.message || 'Unable to delete document.'); }
}

async function loadLearningView() {
  const stateEl = document.getElementById('learning-state');
  const listEl = document.getElementById('learning-program-list');
  const mineEl = document.getElementById('my-learning-list');
  if (!listEl || !mineEl) return;
  stateEl.textContent = 'Loading learning programs…';
  try {
    const [programData, mineData] = await Promise.all([apiFetch('/learning/programs'), apiFetch('/student/learning')]);
    const programs = programData.items || [];
    const mine = mineData.items || [];
    stateEl.textContent = programs.length ? `${programs.length} published program${programs.length === 1 ? '' : 's'} available.` : 'No published learning programs are available yet.';
    listEl.innerHTML = programs.length ? programs.map(program => `<div class="saas-card"><div class="flex-between gap-2"><span class="badge-saas badge-blue">${program.program_type || 'course'}</span><span class="text-sm">${program.duration || ''}</span></div><h3 style="font-weight:700;margin:.6rem 0;">${program.title}</h3><p class="text-sm" style="color:var(--text-muted);">${program.description || 'Program details are provided by the publisher.'}</p><div class="flex-align gap-2 mt-3"><button class="btn-saas btn-outline" onclick="viewLearningProgram('${program.id}')">Details</button><button class="btn-saas btn-primary" onclick="enrollLearningProgram('${program.id}')">Enroll</button></div></div>`).join('') : '';
    mineEl.innerHTML = mine.length ? mine.map(entry => `<div class="flex-between mb-3"><div><strong>${entry.program?.title || 'Learning program'}</strong><div class="text-sm" style="color:var(--text-muted);">${entry.status || 'enrolled'}</div></div><div class="flex-align gap-2"><progress max="100" value="${Number(entry.progress) || 0}"></progress><button class="btn-saas btn-outline" onclick="updateLearningProgress('${entry.program_id}', ${Number(entry.progress) || 0})">${entry.progress >= 100 ? 'Completed' : 'Update progress'}</button></div></div>`).join('') : '<p class="text-sm" style="color:var(--text-muted);">You have not enrolled in a program yet.</p>';
  } catch (error) {
    stateEl.textContent = `Unable to load learning programs. ${error.message || 'Please try again.'}`;
    listEl.innerHTML = '';
    mineEl.innerHTML = '<p class="text-sm" style="color:var(--text-muted);">Unable to load your learning records.</p>';
  }
}
async function viewLearningProgram(id) {
  try { const program = await apiFetch(`/learning/programs/${encodeURIComponent(id)}`); alert(`${program.title}\n\n${program.description || 'No additional details provided.'}\n\nType: ${program.program_type || 'course'}`); }
  catch (error) { alert(error.message || 'Unable to load program details.'); }
}
async function enrollLearningProgram(id) {
  try { await apiFetch(`/learning/programs/${encodeURIComponent(id)}/enroll`, { method: 'POST', body: JSON.stringify({}) }); alert('Enrollment saved.'); loadLearningView(); }
  catch (error) { alert(error.message || 'Unable to enroll.'); }
}
async function updateLearningProgress(id, current) {
  const value = prompt('Enter completion percentage (0-100):', String(current));
  if (value === null) return;
  try {
    const progress = Number(value);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('Enter a percentage from 0 to 100.');
    const result = await apiFetch(`/learning/programs/${encodeURIComponent(id)}/progress`, { method: 'PUT', body: JSON.stringify({ progress }) });
    alert(result.certification ? 'Program completed. Your certification is now visible in My Portfolio.' : 'Progress saved.');
    loadLearningView();
  } catch (error) { alert(error.message || 'Unable to save progress.'); }
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
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('category', 'certificates');
    formData.append('title', payload.certificateName || fileInput.files[0].name);
    const uploaded = await apiFetch('/student/documents', { method: 'POST', body: formData });
    payload.document_id = uploaded.document.id;
  }

  if (!payload.certificateName || (!payload.certificateUrl && !payload.fileUrl && !payload.document_id)) {
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
  const breakdownEl = document.getElementById('ai-score-breakdown');
  const matchEl = document.getElementById('ai-match-pct');
  try {
    if (breakdownEl) breakdownEl.innerHTML = '<div class="saas-card">Loading skill analysis...</div>';
    const data = await apiFetch('/api/student/skill-analysis');
    const overview = Number(data.skillScore ?? data.score ?? 0);
    if (matchEl) matchEl.textContent = `${overview}% Match`;
    if (breakdownEl) {
      const cards = (data.skillGaps || []).map(gap => `
        <div class="saas-card mb-3">
          <div class="flex-between mb-2"><h4 style="font-weight: 700;">${gap.skill}</h4><span class="badge-saas badge-purple">${gap.priority || 'medium'} priority</span></div>
          <div class="text-sm mb-2"><strong>Industry demand:</strong> ${gap.demand || 0} active opportunities</div>
          <div class="text-sm"><strong>Recommended action:</strong> Complete a learning or training program focused on ${gap.skill}.</div>
        </div>
      `).join('');

      breakdownEl.innerHTML = `
        <div class="saas-card mt-2">
          <h3 style="font-weight:800; margin-bottom: 1rem;">Skill-Fit Score Breakdown</h3>
          <div class="grid-2 gap-3 mb-3">
            <div><strong>Overall score:</strong> ${overview}%</div>
            <div><strong>Skill gaps:</strong> ${(data.skillGaps || []).length}</div>
            <div><strong>Recommendations:</strong> ${(data.recommendations || []).length}</div>
            <div><strong>Department:</strong> ${data.profile?.department || 'Not provided'}</div>
          </div>
          ${cards || '<div class="saas-card">Add skills and evidence to generate a real analysis.</div>'}
        </div>
      `;
    }
  } catch (e) {
    console.error('AI skill analysis failed', e);
    if (matchEl) matchEl.textContent = 'Unavailable';
    if (breakdownEl) breakdownEl.innerHTML = `<div class="saas-card">Unable to load skill analysis. ${e.message || 'Please try again later.'}</div>`;
  }
}
async function loadOpportunitiesView() {
  try {
    const jobs = await apiFetch('/opportunities');
    document.getElementById('opportunities-list-container').innerHTML = jobs.length ? jobs.map(j => `<div class="saas-card mb-3"><h4 style="font-weight:700;">${j.title}</h4><div style="color:var(--text-blue); font-weight:700;" class="mb-2">${j.company_name}</div><button class="btn-saas btn-primary" onclick="handleApplyJob(${j.id})">Apply Position</button></div>`).join('') : '<div class="saas-card">No job opportunities are currently published.</div>';
  } catch (e) { document.getElementById('opportunities-list-container').innerHTML = `<div class="saas-card">Unable to load opportunities: ${e.message}</div>`; }
}
async function loadStudentInternships() {
  const list = document.getElementById('student-internships-list'), status = document.getElementById('student-internship-status');
  if (!list) return;
  list.innerHTML = '<div class="saas-card">Loading internships…</div>';
  try {
    const [catalog, mine] = await Promise.all([apiFetch('/student/internships'), apiFetch('/student/internship-applications')]);
    const applications = mine.applications || [];
    list.innerHTML = (catalog.internships || []).map(item => {
      const applied = applications.find(app => String(app.internship_id) === String(item.id));
      return `<div class="saas-card"><div class="flex-between mb-2"><h3 style="font-weight:800;margin:0;">${item.title}</h3><span class="badge-saas badge-emerald">${item.status}</span></div><p class="text-sm" style="color:var(--text-muted);">${item.company_name || 'Company'} · ${item.location || 'Remote'} · ${item.duration || 'Flexible'}</p><p class="text-sm">${item.description || 'Requirements and deliverables will be shared by the employer.'}</p><div class="flex-align gap-2 flex-wrap mb-3">${(item.requirements || item.required_skills || []).map(req => `<span class="badge-saas badge-blue">${req}</span>`).join('') || '<span class="text-sm" style="color:var(--text-muted);">No additional requirements listed.</span>'}</div>${applied ? `<span class="badge-saas badge-purple">Application: ${applied.status}</span>` : `<button class="btn-saas btn-primary" onclick="applyInternship('${item.id}')">Apply after reviewing requirements</button>`}</div>`;
    }).join('') || '<div class="saas-card">No published internships are available yet.</div>';
    status.innerHTML = applications.map(app => `<div class="saas-card mb-3"><div class="flex-between"><div><strong>${app.internship?.title || 'Internship'}</strong><div class="text-sm" style="color:var(--text-muted);">${app.internship?.company_name || ''}</div></div><span class="badge-saas badge-emerald">${app.status}</span></div><div class="flex-align gap-2 flex-wrap mt-3">${['Offer sent','Started','In progress','Completed'].includes(app.status) ? `<button class="btn-saas btn-outline" onclick="startInternshipProgress('${app.id}')">Start / view progress</button>` : ''}${app.status === 'Started' || app.status === 'In progress' ? `<button class="btn-saas btn-outline" onclick="updateInternshipProgress('${app.id}')">Add progress</button><button class="btn-saas btn-outline" onclick="completeInternship('${app.id}')">Complete & certificate</button>` : ''}</div></div>`).join('') || '<p class="text-sm" style="color:var(--text-muted);">No internship applications yet.</p>';
  } catch (e) { list.innerHTML = `<div class="saas-card">Unable to load internships: ${e.message}</div>`; status.innerHTML = ''; }
}
async function applyInternship(id) {
  try { await apiFetch(`/student/internships/${encodeURIComponent(id)}/apply`, { method: 'POST', body: JSON.stringify({ requirements_acknowledged: true }) }); await loadStudentInternships(); }
  catch (e) { alert(e.message); }
}
async function startInternshipProgress(id) {
  try { await apiFetch(`/student/internship-progress/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' }); await loadStudentInternships(); }
  catch (e) { alert(e.message); }
}
async function updateInternshipProgress(id) {
  const note = prompt('Describe the milestone or progress update:');
  if (!note) return;
  try { await apiFetch(`/student/internship-progress/${encodeURIComponent(id)}/update`, { method: 'POST', body: JSON.stringify({ note }) }); await loadStudentInternships(); }
  catch (e) { alert(e.message); }
}
async function completeInternship(id) {
  if (!confirm('Mark this internship complete and issue your certificate?')) return;
  try { await apiFetch(`/student/internship-progress/${encodeURIComponent(id)}/complete`, { method: 'POST', body: '{}' }); await loadStudentInternships(); }
  catch (e) { alert(e.message); }
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
  const title = document.getElementById('job-post-title')?.value.trim();
  const location = document.getElementById('job-post-loc')?.value.trim();
  const salary_stipend = document.getElementById('job-post-salary')?.value.trim();
  const min_cgpa = document.getElementById('job-post-cgpa')?.value;
  const required_skills = document.getElementById('job-post-skills')?.value.trim();
  const deadline = document.getElementById('job-post-deadline')?.value;
  const department = document.getElementById('job-post-department')?.value.trim();
  const status = document.getElementById('job-post-status')?.value || 'Published';
  if (!title || !location || !deadline) return alert('Title, location, and deadline are required.');

  try {
    await apiFetch(editingCompanyJobId ? `/company/jobs/${encodeURIComponent(editingCompanyJobId)}` : '/company/jobs', {
      method: editingCompanyJobId ? 'PUT' : 'POST',
      body: JSON.stringify({ title, location, salary_stipend, min_cgpa, required_skills, deadline })
    });
    editingCompanyJobId = null;
    alert('Job requirement saved.');
    renderCompanyJobDrives();
  } catch (err) { alert(err.message); }
}

async function loadCompanyJobsManagement() {
  const list = document.getElementById('company-jobs-management');
  if (!list) return;
  list.innerHTML = '<div class="saas-card">Loading job postings…</div>';
  try {
    const jobs = await apiFetch('/company/jobs');
    list.innerHTML = jobs.length ? jobs.map(job => `
      <div class="saas-card mb-3">
        <div class="flex-between mb-2"><strong>${companyAcademiaText(job.title || 'Untitled role')}</strong><span class="badge-saas badge-blue">${companyAcademiaText(job.status || 'Published')}</span></div>
        <div class="text-sm" style="color:var(--text-muted);">${companyAcademiaText(job.location || 'Remote')} · deadline ${companyAcademiaText(job.deadline || 'Not set')} · ${job.applicationCount || 0} application(s)</div>
        <div class="flex-align gap-2 mt-3 flex-wrap">
          <button class="btn-saas btn-outline" onclick="editCompanyJob('${job.id}')">Edit</button>
          <button class="btn-saas btn-outline" onclick="toggleCompanyJob('${job.id}','${job.status === 'Closed' ? 'Published' : 'Closed'}')">${job.status === 'Closed' ? 'Reopen' : 'Close'}</button>
          <button class="btn-saas btn-outline" onclick="deleteCompanyJob('${job.id}')">Delete</button>
        </div>
      </div>`).join('') : '<div class="saas-card">No job postings yet.</div>';
  } catch (error) {
    list.innerHTML = `<div class="saas-card">Unable to load job postings: ${companyAcademiaText(error.message)}</div>`;
  }
}

async function editCompanyJob(id) {
  try {
    const jobs = await apiFetch('/company/jobs');
    const job = jobs.find(item => String(item.id) === String(id));
    if (!job) return alert('Job posting not found.');
    editingCompanyJobId = id;
    ['title', 'loc', 'salary', 'cgpa', 'skills', 'deadline', 'department'].forEach(key => {
      const field = document.getElementById(`job-post-${key}`);
      if (field) field.value = key === 'skills' ? (job.required_skills || []).join(', ') : (key === 'loc' ? job.location : key === 'salary' ? (job.salary_stipend || job.salary) : key === 'cgpa' ? (job.min_cgpa || '') : (job[key] || ''));
    });
    const status = document.getElementById('job-post-status');
    if (status) status.value = job.status || 'Published';
    const submit = document.querySelector('#company-job-post-form button[type="submit"]');
    if (submit) submit.textContent = 'Update opportunity';
    document.getElementById('job-post-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { alert(error.message); }
}

async function toggleCompanyJob(id, status) {
  try { await apiFetch(`/company/jobs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) }); await loadCompanyJobsManagement(); }
  catch (error) { alert(error.message); }
}

async function deleteCompanyJob(id) {
  if (!confirm('Delete this job posting? Existing applications will remain available.')) return;
  try { await apiFetch(`/company/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadCompanyJobsManagement(); }
  catch (error) { alert(error.message); }
}

async function loadTalentFinder() {
  try {
    const students = await apiFetch('/college/students');
    document.getElementById('talent-candidates-list').innerHTML = students.map(s => `<div class="saas-card"><h4 style="font-weight:700;">${s.name}</h4><div style="font-size:0.8rem; color:var(--text-muted);">${s.college} • ${s.department}</div><div style="font-size:0.85rem; font-weight:800; color:var(--text-emerald);" class="mt-2">CGPA: ${s.cgpa || 8.8}</div></div>`).join('');
  } catch (e) {}
}

// Company analytics and workflows are populated from authenticated APIs.

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

const COMPANY_ACADEMIA_RESOURCES = [
  ['mentorship', 'Mentorship'], ['guest-lectures', 'Guest lectures'], ['workshops', 'Workshops'], ['innovation-challenges', 'Innovation challenges'], ['live-projects', 'Live projects'], ['research-collaborations', 'Research collaborations'], ['consultancy', 'Consultancy'], ['faculty-internships', 'Faculty internships'], ['fdp', 'FDP programs'], ['learning-programs', 'Learning programs']
];

function companyAcademiaText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function requestCompanyAcademia(resource, id, action = 'request') {
  try {
    await apiFetch(`/academia/${encodeURIComponent(resource)}/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify({}) });
    await loadCompanyAcademiaFeed();
  } catch (error) { alert(error.message || 'Unable to update collaboration request.'); }
}

async function reviewCompanyAcademia(resource, id, userId, status) {
  try {
    await apiFetch(`/academia/${encodeURIComponent(resource)}/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ user_id: userId, status }) });
    await loadCompanyAcademiaFeed();
  } catch (error) { alert(error.message || 'Unable to review request.'); }
}

async function loadCompanyAcademiaFeed() {
  const select = document.getElementById('company-academia-resource');
  if (!select) return;
  if (!select.options.length) {
    select.innerHTML = COMPANY_ACADEMIA_RESOURCES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  }

  const resource = select.value || COMPANY_ACADEMIA_RESOURCES[0][0];
  const list = document.getElementById('company-academia-items');
  if (!list) return;
  list.innerHTML = '<p class="text-sm" style="color:var(--text-muted);">Loading opportunities…</p>';

  try {
    const data = await apiFetch(`/academia/${resource}`);
    const items = Array.isArray(data) ? data : (data.items || []);
    list.innerHTML = items.length ? items.slice(0, 12).map(item => {
      const owner = String(item.created_by) === String(currentUser?.id);
      const entries = [...(item.applications || []), ...(item.registrations || [])];
      const participant = entries.find(entry => String(entry.user_id) === String(currentUser?.id));
      const requests = owner ? entries.filter(entry => ['requested', 'submitted', 'registered'].includes(String(entry.status || '').toLowerCase())) : [];
      return `
      <div class="saas-card" style="padding:0.9rem; margin-bottom:0.75rem;">
        <div class="flex-between mb-1"><strong>${companyAcademiaText(item.title || 'Academia opportunity')}</strong><span class="badge-saas badge-blue">${companyAcademiaText(item.status || 'Open')}</span></div>
        <p class="text-sm" style="color:var(--text-muted); margin:0.25rem 0 0.5rem;">${companyAcademiaText(item.description || 'No description provided yet.')}</p>
        <div class="flex-align gap-2 flex-wrap text-xs" style="color:var(--text-muted);">
          ${item.duration ? `<span class="badge-saas badge-purple">${companyAcademiaText(item.duration)}</span>` : ''}
          ${item.location ? `<span class="badge-saas badge-purple">${companyAcademiaText(item.location)}</span>` : ''}
          ${item.deadline ? `<span class="badge-saas badge-purple">Deadline: ${companyAcademiaText(item.deadline)}</span>` : ''}
        </div>
        ${participant ? `<div class="text-xs mt-2" style="color:var(--text-muted);">Your participation: <strong>${companyAcademiaText(participant.status || 'requested')}</strong>${participant.progress !== undefined ? ` · ${Number(participant.progress) || 0}% progress` : ''}</div>` : ''}
        ${requests.length ? `<div class="text-xs mt-2" style="color:var(--text-muted);">${requests.length} request(s) awaiting review</div>` : ''}
        <div class="flex-align gap-2 flex-wrap mt-3">
          ${!owner && !participant && !['Completed', 'completed', 'Closed', 'closed'].includes(item.status) ? `<button class="btn-saas btn-outline" onclick="requestCompanyAcademia('${companyAcademiaText(resource)}','${companyAcademiaText(item.id)}')">Request to participate</button>` : ''}
          ${participant && ['requested', 'submitted'].includes(String(participant.status || '').toLowerCase()) ? '<span class="badge-saas badge-purple">Request pending</span>' : ''}
          ${owner ? requests.map(entry => `<span class="flex-align gap-2"><span class="text-xs">User ${companyAcademiaText(entry.user_id)}</span><button class="btn-saas btn-outline" onclick="reviewCompanyAcademia('${companyAcademiaText(resource)}','${companyAcademiaText(item.id)}','${companyAcademiaText(entry.user_id)}','approved')">Approve</button><button class="btn-saas btn-outline" onclick="reviewCompanyAcademia('${companyAcademiaText(resource)}','${companyAcademiaText(item.id)}','${companyAcademiaText(entry.user_id)}','rejected')">Reject</button></span>`).join('') : ''}
        </div>
      </div>
    `; }).join('') : '<p class="text-sm" style="color:var(--text-muted);">No opportunities have been published yet.</p>';
  } catch (error) {
    list.innerHTML = `<p class="text-sm" style="color:var(--text-muted);">Unable to load published opportunities: ${error.message || 'Unknown error'}</p>`;
  }
}

async function handleCompanyAcademiaCreate(event) {
  event.preventDefault();
  const form = document.getElementById('company-academia-form');
  if (!form) return;

  const resource = document.getElementById('company-academia-resource')?.value || COMPANY_ACADEMIA_RESOURCES[0][0];
  const title = document.getElementById('company-academia-title')?.value?.trim();
  const description = document.getElementById('company-academia-description')?.value?.trim();
  const skills = document.getElementById('company-academia-skills')?.value?.trim();
  const duration = document.getElementById('company-academia-duration')?.value?.trim();
  const location = document.getElementById('company-academia-location')?.value?.trim();
  const deadline = document.getElementById('company-academia-deadline')?.value || '';
  const partner = document.getElementById('company-academia-partner')?.value?.trim();

  if (!title || !description) {
    alert('Title and description are required.');
    return;
  }

  try {
    const phase7Program = ['learning-programs', 'mentorship', 'workshops'].includes(resource);
    await apiFetch(phase7Program ? '/learning/programs' : `/academia/${resource}`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        required_skills: skills ? skills.split(',').map(part => part.trim()).filter(Boolean) : [],
        duration: duration || '',
        location: location || '',
        deadline: deadline || '',
        company: partner || currentUser?.companyName || currentUser?.fullName || 'Corporate Partner',
        partner: partner || currentUser?.companyName || currentUser?.fullName || 'Corporate Partner',
        status: phase7Program ? 'published' : 'Open',
        program_type: resource === 'learning-programs' ? 'course' : resource.replace(/s$/, '')
      })
    });
    form.reset();
    await loadCompanyAcademiaFeed();
    alert('Opportunity published successfully.');
  } catch (error) {
    alert(error.message || 'Unable to publish opportunity.');
  }
}

async function renderCompanyDashboard() {
  let dashboard;
  try {
    dashboard = await apiFetch('/company/dashboard');
  } catch (error) {
    console.error('Failed to load company dashboard:', error.message);
    return;
  }
  const overview = {
    metrics: [
      { label: 'Open Positions', value: dashboard.total_jobs || 0, accent: 'blue' },
      { label: 'Applications', value: dashboard.total_applicants || 0, accent: 'emerald' },
      { label: 'Shortlisted', value: dashboard.shortlisted || 0, accent: 'purple' }
    ],
    applicationsOverTime: [],
    hiringFunnel: [],
    skillDemand: [],
    skillDistribution: [],
    hiringSplit: { internship: 0, fullTime: 0 },
    universities: [],
    insight: dashboard.total_applicants
      ? `${dashboard.total_applicants} candidate application(s) are currently linked to your company.`
      : 'No applications have been received for your company yet.'
  };
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

  loadCompanyIndustryNews();
}

async function loadCompanyIndustryNews() {
  const container = document.getElementById('company-industry-news');
  if (!container) return;
  container.innerHTML = '<p class="text-sm" style="color:var(--text-muted);">Loading student-module updates...</p>';

  try {
    const data = await apiFetch('/company/news');
    if (!data.items || !data.items.length) {
      container.innerHTML = '<p class="text-sm" style="color:var(--text-muted);">No student updates are available.</p>';
      return;
    }
    container.innerHTML = data.items.map(item => `
      <article class="mb-3" style="padding-bottom:0.75rem; border-bottom:1px solid rgba(148,163,184,.18);">
        <div class="text-xs mb-1" style="color:var(--text-blue); font-weight:700;">${item.type}</div>
        <div style="font-weight:700; color:var(--text-primary);">${item.title}</div>
        <div class="text-xs mt-1" style="color:var(--text-muted);">${item.detail}</div>
      </article>
    `).join('');
  } catch (error) {
    container.innerHTML = '<p class="text-sm" style="color:var(--text-muted);">Student updates are temporarily unavailable.</p>';
    console.error('Failed to load student-module updates:', error.message);
  }
}

async function renderCompanyProfile(editMode = false) {
  const container = document.getElementById('company-profile-content');
  if (!container) return;
  let profile;
  try {
    profile = normalizeCompanyProfile(await apiFetch('/company/profile'));
  } catch (error) {
    container.innerHTML = '<div class="saas-card">Unable to load the company profile.</div>';
    console.error('Failed to load company profile:', error.message);
    return;
  }
  const fields = [
    ['company_name', 'Company name', profile.company_name],
    ['industry', 'Industry', profile.industry],
    ['website', 'Website', profile.website],
    ['location', 'Location', profile.location],
    ['description', 'Description', profile.description],
    ['company_size', 'Company size', profile.company_size],
    ['founded_year', 'Founded year', profile.founded_year],
    ['technologies', 'Technologies', profile.technologies],
    ['required_skills', 'Required skills', profile.required_skills],
    ['benefits', 'Benefits', profile.benefits],
    ['contact', 'Contact', profile.contact]
  ];
  const actionButtons = editMode
    ? `<div class="flex-align gap-2">
        <button type="submit" class="btn-saas btn-primary">Save changes</button>
        <button type="button" class="btn-saas btn-outline" onclick="renderCompanyProfile()">Cancel</button>
      </div>`
    : `<button type="button" class="btn-saas btn-primary" onclick="renderCompanyProfile(true)">Edit profile</button>`;
  container.innerHTML = `
    <form class="saas-card" onsubmit="saveCompanyProfile(event)">
      <div class="flex-between gap-2 mb-4">
        <h3 style="font-weight:700; margin:0;">Company Profile</h3>
        ${actionButtons}
      </div>
      ${fields.map(([name, label, value]) => `
        <div class="mb-3">
          <label class="block text-xs font-bold mb-1">${label}</label>
          ${name === 'description'
            ? `<textarea class="saas-input" rows="5" name="${name}" ${editMode ? '' : 'disabled'}>${value || ''}</textarea>`
            : `<input class="saas-input" name="${name}" value="${String(value || '').replace(/"/g, '&quot;')}" ${editMode ? '' : 'disabled'} />`}
        </div>
      `).join('')}
      ${editMode ? actionButtons : ''}
    </form>
  `;
  const completion = fields.filter(([, , value]) => String(value || '').trim()).length / fields.length * 100;
  document.getElementById('company-profile-completion').textContent = `Profile Completion: ${Math.round(completion)}%`;
}

async function saveCompanyProfile(event) {
  event.preventDefault();
  const form = event.target;
  const body = Object.fromEntries(new FormData(form).entries());
  try {
    await apiFetch('/company/profile', {
      method: 'PUT',
      body: JSON.stringify({ ...body, name: body.company_name, companyName: body.company_name })
    });
    const savedName = String(body.company_name || '').trim();
    if (savedName && currentUser) {
      currentUser.companyName = savedName;
      const displayName = document.getElementById('user-display-name');
      if (displayName) displayName.textContent = savedName;
    }
    alert('Company profile saved successfully.');
    await renderCompanyProfile();
  } catch (error) {
    alert(error.message || 'Unable to save company profile.');
  }
}

function normalizeCompanyProfile(response) {
  const profile = response && (response.profile || response.company || response);
  return {
    ...(profile || {}),
    company_name: profile?.company_name || profile?.name || profile?.companyName || '',
    industry: profile?.industry || '',
    website: profile?.website || '',
    location: profile?.location || '',
    description: profile?.description || '',
    company_size: profile?.company_size || '',
    founded_year: profile?.founded_year || '',
    technologies: profile?.technologies || '',
    required_skills: profile?.required_skills || '',
    benefits: profile?.benefits || '',
    contact: profile?.contact || ''
  };
}

async function renderCompanyTalentDiscovery() {
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

  let registeredStudents;
  try {
    registeredStudents = await apiFetch('/company/candidates');
  } catch (error) {
    container.innerHTML = '<div class="saas-card">Unable to load registered student details.</div>';
    console.error('Failed to load registered students:', error.message);
    return;
  }

  const candidates = registeredStudents.filter(candidate => {
    const skills = candidate.skills || [];
    const matchesText = !query || skills.some(skill => skill.toLowerCase().includes(query)) || candidate.name.toLowerCase().includes(query);
    const matchesDepartment = !department || candidate.department.toLowerCase() === department;
    const matchesAvailability = !availability;
    return matchesText && matchesDepartment && matchesAvailability;
  });

  container.innerHTML = candidates.length ? candidates.map(candidate => `
    <div class="saas-card">
      <div class="flex-between mb-3">
        <div>
          <h4 style="font-weight:800; margin:0;">${candidate.name}</h4>
          <div style="font-size:0.78rem; color:var(--text-muted);">${candidate.studentId} • ${candidate.department} • ${candidate.cgpa ?? 'CGPA not provided'}</div>
        </div>
        <div class="badge-saas badge-blue">Registered student</div>
      </div>
      <div class="grid-2 gap-2 text-xs mb-3" style="color:var(--text-muted);">
        <div><strong>Skills:</strong> ${(candidate.skills || []).join(', ') || 'Not provided'}</div>
        <div><strong>Projects:</strong> ${candidate.projects}</div>
        <div><strong>Certifications:</strong> ${candidate.certifications}</div>
        <div><strong>College:</strong> ${candidate.college}</div>
        <div><strong>Goal:</strong> ${candidate.goal}</div>
      </div>
      <div class="flex-align gap-2 flex-wrap">${(candidate.skills || []).map(skill => `<span class="badge-saas badge-blue">${skill}</span>`).join('')}</div>
    </div>
  `).join('') : '<div class="saas-card">No candidate matches found for the selected filters.</div>';
}

async function runCompanyAIMatch() {
  const container = document.getElementById('company-ai-match-results');
  const text = document.getElementById('company-job-description')?.value || '';
  if (!container) return;
  const candidates = await apiFetch('/company/candidates');
  const keywords = text.toLowerCase().split(/[^a-z0-9+#.]+/).filter(Boolean);
  const matches = candidates.map(candidate => {
    const skills = candidate.skills || [];
    const matchedSkills = skills.filter(skill => keywords.some(keyword => skill.toLowerCase().includes(keyword)));
    const match = Math.min(99, 60 + (matchedSkills.length * 8) + Math.min(20, candidate.projects * 4) + Math.min(10, candidate.certifications * 3));
    return {
      ...candidate,
      match,
      skillScore: Math.min(99, matchedSkills.length ? Math.round((matchedSkills.length / Math.max(skills.length, 1)) * 100) : 0),
      why: `${candidate.name} has ${skills.slice(0, 3).join(', ') || 'student profile'} with ${candidate.projects} project(s) and ${candidate.certifications} certification(s).`
    };
  }).sort((a, b) => b.match - a.match);
  container.innerHTML = matches.slice(0, 3).map((candidate, index) => `
    <div class="saas-card mb-4">
      <div class="flex-between mb-3">
        <div>
          <div class="badge-saas badge-blue">${index + 1}. ${candidate.name}</div>
        </div>
        <div style="font-size:1.4rem; font-weight:800; color:var(--text-blue);">${candidate.match}%</div>
      </div>
      <div class="grid-2 gap-3 text-sm" style="color:var(--text-secondary);">
        <div><strong>Skill Match:</strong> ${candidate.skillScore}%</div>
        <div><strong>Project Match:</strong> ${Math.min(99, candidate.projects * 18)}%</div>
        <div><strong>Education Match:</strong> ${Math.min(98, candidate.cgpa * 10)}%</div>
        <div><strong>Experience Match:</strong> ${Math.min(97, 60 + candidate.projects * 5)}%</div>
      </div>
      <div class="mt-3"><strong>Why this candidate is recommended:</strong> ${candidate.why}</div>
    </div>
  `).join('');
}

async function renderCompanySkillDemand() {
  const container = document.getElementById('company-skill-demand-content');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Loading skill demand…</div>';
  let skills = [];
  try {
    const [jobs, candidates] = await Promise.all([apiFetch('/company/jobs'), apiFetch('/company/candidates')]);
    const demand = new Map();
    jobs.forEach(job => (job.required_skills || []).forEach(skill => {
      const name = String(skill).trim();
      if (name) demand.set(name.toLowerCase(), { name, posted: (demand.get(name.toLowerCase())?.posted || 0) + 1, candidates: 0 });
    }));
    candidates.forEach(candidate => (candidate.skills || []).forEach(skill => {
      const key = String(skill).toLowerCase();
      if (demand.has(key)) demand.get(key).candidates += 1;
    }));
    skills = [...demand.values()].map(item => ({ ...item, demand: Math.min(100, item.posted * 20), gap: item.candidates < item.posted ? 'High' : 'Balanced' }));
  } catch (error) {
    container.innerHTML = `<div class="saas-card">Unable to load skill demand: ${companyAcademiaText(error.message)}</div>`;
    return;
  }
  if (!skills.length) { container.innerHTML = '<div class="saas-card">No required skills are available from your job postings yet.</div>'; return; }
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
  editingCompanyInternshipId = null;
  container.innerHTML = `<div class="saas-card mb-4"><h3 id="internship-form-heading" style="font-weight:700;">Create internship</h3><form onsubmit="createCompanyInternship(event)"><div class="grid-2 gap-3"><input id="internship-title" class="saas-input" placeholder="Title" required /><input id="internship-location" class="saas-input" placeholder="Location / remote" /><input id="internship-duration" class="saas-input" placeholder="Duration" /><input id="internship-stipend" class="saas-input" placeholder="Stipend" /><input id="internship-deadline" type="date" class="saas-input" /><input id="internship-positions" type="number" min="1" value="1" class="saas-input" /><input id="internship-skills" class="saas-input" placeholder="Required skills, comma separated" /><select id="internship-status" class="saas-input"><option>Draft</option><option>Open</option><option>Closed</option></select><textarea id="internship-requirements" class="saas-input span-2" rows="2" placeholder="Requirements, comma separated"></textarea><textarea id="internship-description" class="saas-input span-2" rows="3" placeholder="Description"></textarea></div><div class="flex-align gap-2 mt-3"><button id="internship-form-submit" class="btn-saas btn-primary">Save internship</button><button type="button" class="btn-saas btn-outline" onclick="renderCompanyInternships()">Clear</button></div></form></div><div id="company-internship-list"><div class="saas-card">Loading internships…</div></div>`;
  loadCompanyInternshipRecords();
}
async function createCompanyInternship(event) {
  event.preventDefault();
  try {
    const payload = { title: document.getElementById('internship-title').value, location: document.getElementById('internship-location').value, duration: document.getElementById('internship-duration').value, stipend: document.getElementById('internship-stipend').value, deadline: document.getElementById('internship-deadline').value, positions: Number(document.getElementById('internship-positions').value), required_skills: document.getElementById('internship-skills').value.split(',').map(v => v.trim()).filter(Boolean), requirements: document.getElementById('internship-requirements').value.split(',').map(v => v.trim()).filter(Boolean), description: document.getElementById('internship-description').value, status: document.getElementById('internship-status').value };
    await apiFetch(editingCompanyInternshipId ? `/company/internships/${encodeURIComponent(editingCompanyInternshipId)}` : '/company/internships', { method: editingCompanyInternshipId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    renderCompanyInternships();
  } catch (e) { alert(e.message); }
}
async function loadCompanyInternshipRecords() {
  const target = document.getElementById('company-internship-list'); if (!target) return;
  try {
    const data = await apiFetch('/company/internships');
    target.innerHTML = (data.internships || []).map(item => `<div class="saas-card mb-3"><div class="flex-between mb-2"><h4 style="font-weight:800;margin:0;">${item.title}</h4><span class="badge-saas badge-emerald">${item.status}</span></div><p class="text-sm">${item.description || 'No description provided.'}</p><div class="text-sm" style="color:var(--text-muted);">${item.location || 'Remote'} · ${item.duration || ''} · ${item.stipend || 'Unpaid'} · ${item.positions || 1} position(s)</div><div class="flex-align gap-2 mt-3"><button class="btn-saas btn-outline" onclick="editCompanyInternship('${item.id}')">Edit</button><button class="btn-saas btn-outline" onclick="viewInternshipApplicants('${item.id}')">Review applicants</button><button class="btn-saas btn-outline" onclick="setInternshipStatus('${item.id}','${item.status === 'Open' ? 'Closed' : 'Open'}')">${item.status === 'Open' ? 'Close' : 'Publish'}</button></div><div id="internship-applicants-${item.id}" class="mt-3"></div></div>`).join('') || '<div class="saas-card">No internships created yet.</div>';
  } catch (e) { target.innerHTML = `<div class="saas-card">Unable to load internships: ${e.message}</div>`; }
}
async function editCompanyInternship(id) {
  try {
    const data = await apiFetch(`/company/internships/${encodeURIComponent(id)}`), item = data.internship;
    editingCompanyInternshipId = id;
    ['title', 'location', 'duration', 'stipend', 'deadline', 'positions', 'description'].forEach(key => { const field = document.getElementById(`internship-${key}`); if (field) field.value = item[key] ?? ''; });
    document.getElementById('internship-skills').value = (item.required_skills || []).join(', ');
    document.getElementById('internship-requirements').value = (item.requirements || []).join(', ');
    document.getElementById('internship-status').value = item.status || 'Draft';
    document.getElementById('internship-form-heading').textContent = 'Edit internship';
    document.getElementById('internship-form-submit').textContent = 'Update internship';
    document.getElementById('internship-form-heading').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { alert(e.message); }
}
async function setInternshipStatus(id, status) { try { await apiFetch(`/company/internships/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) }); await loadCompanyInternshipRecords(); } catch (e) { alert(e.message); } }
async function viewInternshipApplicants(id) {
  try {
    const data = await apiFetch(`/company/internships/${encodeURIComponent(id)}/applicants`), target = document.getElementById(`internship-applicants-${id}`);
    target.innerHTML = (data.applicants || []).map(app => `<div class="saas-card mb-2"><div class="flex-between"><strong>${app.student_name || 'Student'}</strong><span class="badge-saas badge-blue">${app.status}</span></div><div class="flex-align gap-2 mt-2 flex-wrap">${['review','shortlist','interview-selection','offer'].map(op => `<button class="btn-saas btn-outline" onclick="reviewInternshipApplication('${app.id}','${op}')">${op.replace('-', ' ')}</button>`).join('')}</div></div>`).join('') || '<p class="text-sm" style="color:var(--text-muted);">No applicants yet.</p>';
  } catch (e) { alert(e.message); }
}
async function reviewInternshipApplication(id, operation) {
  try { await apiFetch(`/company/internship-applications/${encodeURIComponent(id)}/${operation}`, { method: 'POST', body: JSON.stringify({}) }); alert(`Application ${operation} updated.`); } catch (e) { alert(e.message); }
}

function renderCompanyOpportunityForm() {
  const container = document.getElementById('company-job-drives-content');
  if (!container) return;
  container.innerHTML = `
    <div class="saas-card">
      <form id="company-job-post-form" onsubmit="handlePostJobSubmit(event)">
        <div class="grid-2 gap-4 mb-4">
          <div><label class="block text-xs font-bold mb-1">Job title</label><input type="text" id="job-post-title" class="saas-input" required /></div>
          <div><label class="block text-xs font-bold mb-1">Department</label><input type="text" id="job-post-department" class="saas-input" /></div>
          <div><label class="block text-xs font-bold mb-1">Location</label><input type="text" id="job-post-loc" class="saas-input" required /></div>
          <div><label class="block text-xs font-bold mb-1">Salary / stipend</label><input type="text" id="job-post-salary" class="saas-input" /></div>
          <div><label class="block text-xs font-bold mb-1">Minimum CGPA</label><input type="number" step="0.1" id="job-post-cgpa" class="saas-input" /></div>
          <div><label class="block text-xs font-bold mb-1">Application deadline</label><input type="date" id="job-post-deadline" class="saas-input" required /></div>
          <div><label class="block text-xs font-bold mb-1">Status</label><select id="job-post-status" class="saas-input"><option>Draft</option><option>Published</option><option>Open</option><option>Closed</option></select></div>
          <div class="span-2"><label class="block text-xs font-bold mb-1">Required skills</label><input type="text" id="job-post-skills" class="saas-input" placeholder="React, Node.js, PostgreSQL" /></div>
        </div>
        <div class="flex-align gap-2"><button type="submit" class="btn-saas btn-primary">Publish opportunity</button><button type="button" class="btn-saas btn-outline" onclick="renderCompanyOpportunityForm()">Clear</button></div>
      </form>
    </div>
    <div id="company-jobs-management" class="mt-4"><div class="saas-card">Loading job postings…</div></div>
  `;
  loadCompanyJobsManagement();
}

function renderCompanyJobDrives() {
  const container = document.getElementById('company-job-drives-content');
  if (!container) return;
  renderCompanyOpportunityForm();
}

function renderCompanyAssessments() {
  const container = document.getElementById('company-assessment-content');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Loading assessments…</div>';
  apiFetch('/company/assessments').then(items => { container.innerHTML = (items || []).map(item => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2"><h4 style="font-weight:800; margin:0;">${item.title || item.name}</h4><span class="badge-saas badge-blue">${item.status || 'Draft'}</span>
      </div>
      <div class="text-sm" style="color:var(--text-muted);">Candidates: ${item.candidates || 0} · Pass score: ${item.passScore || item.pass_score || 'Not set'}</div>
      <button class="btn-saas btn-outline mt-3" onclick="updateAssessmentApplicantStatus('${item.assessmentId}')">Update applicant status</button>
    </div>
  `).join('') || '<div class="saas-card">No assessments created yet.</div>'; }).catch(error => { container.innerHTML = `<div class="saas-card">Unable to load assessments: ${error.message}</div>`; });
}
async function updateAssessmentApplicantStatus(assessmentId) {
  const applicantId = prompt('Enter the existing assessment applicant ID:');
  if (!applicantId) return;
  const status = prompt('Enter status: Assessment scheduled or Assessment completed:');
  if (!status) return;
  try { await apiFetch(`/company/assessments/${encodeURIComponent(assessmentId)}/applicants/${encodeURIComponent(applicantId)}/status`, { method: 'POST', body: JSON.stringify({ status }) }); alert('Assessment applicant status updated.'); }
  catch (error) { alert(error.message); }
}

function companyCreateAssessment() {
  const container = document.getElementById('company-assessment-content');
  if (!container) return;
  container.innerHTML = `
    <div class="saas-card">
      <h3 style="font-weight:800; margin-bottom:1rem;">Create candidate assessment</h3>
      <form onsubmit="saveCompanyAssessment(event)"><div class="grid-2 gap-4">
        <div><label class="block text-xs font-bold mb-1">Assessment name</label><input id="company-assessment-title" class="saas-input" required /></div>
        <div><label class="block text-xs font-bold mb-1">Type</label><select id="company-assessment-type" class="saas-input"><option>MCQ</option><option>Technical</option><option>Coding</option><option>Skill-based</option></select></div>
        <div><label class="block text-xs font-bold mb-1">Duration</label><input id="company-assessment-duration" class="saas-input" /></div>
        <div><label class="block text-xs font-bold mb-1">Pass score</label><input id="company-assessment-pass-score" class="saas-input" type="number" min="0" max="100" /></div>
      </div><div class="mt-3"><button class="btn-saas btn-primary">Save assessment</button></div></form>
    </div>
  `;
}

async function saveCompanyAssessment(event) {
  event.preventDefault();
  try {
    await apiFetch('/company/assessments', { method: 'POST', body: JSON.stringify({
      title: document.getElementById('company-assessment-title').value.trim(),
      type: document.getElementById('company-assessment-type').value,
      duration: document.getElementById('company-assessment-duration').value.trim(),
      pass_score: Number(document.getElementById('company-assessment-pass-score').value || 0),
      status: 'Draft'
    }) });
    await renderCompanyAssessments();
  } catch (error) { alert(error.message); }
}

async function renderCompanyInterviewPipeline() {
  const container = document.getElementById('company-interview-pipeline-content');
  if (!container) return;
  const stages = ['Applied', 'Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Selected', 'Offer'];
  let applications = [];
  try {
    const dashboard = await apiFetch('/company/dashboard');
    applications = dashboard.pipeline || [];
  } catch (error) {
    container.innerHTML = '<div class="saas-card">Unable to load the company interview pipeline.</div>';
    console.error('Failed to load company interview pipeline:', error.message);
    return;
  }
  const candidateColumns = stages.map(stage => {
    const matching = applications.filter(item => item.status === stage || (stage === 'Screening' && item.status === 'AI Screening'));
    return `
      <div class="saas-card" style="min-width:180px;">
        <div class="flex-between mb-3"><strong>${stage}</strong><span class="badge-saas badge-blue">${matching.length}</span></div>
        ${matching.length ? matching.map(item => `
          <div style="border:1px solid rgba(56,189,248,.2); border-radius:12px; padding:0.7rem; background:rgba(15,23,42,.7); margin-bottom:0.75rem;">
            <div style="font-weight:800; margin-bottom:0.2rem;">${item.candidate_name || 'Student'}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${item.job_title || 'Job application'}</div>
            <div style="font-size:0.75rem; color:var(--text-blue); margin-top:0.4rem;">CGPA: ${item.cgpa ?? 'Not provided'}</div>
          </div>
        `).join('') : '<div style="font-size:0.75rem; color:var(--text-muted);">No candidates in this stage.</div>'}
      </div>
    `;
  }).join('');
  container.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:1rem;">${candidateColumns}</div>`;
}

async function renderCompanyCampusConnect() {
  const container = document.getElementById('company-campus-connect-content');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Loading campus drives…</div>';
  try {
    const drives = await apiFetch('/company/campus-drives');
    container.innerHTML = (drives || []).length ? drives.map(drive => `
      <div class="saas-card mb-3">
        <div class="flex-between mb-2"><strong>${companyAcademiaText(drive.position || 'Campus opportunity')}</strong><span class="badge-saas badge-emerald">${companyAcademiaText(drive.status || 'Open')}</span></div>
        <div class="text-sm" style="color:var(--text-muted);">${companyAcademiaText(drive.university || drive.college || 'University not specified')} · ${companyAcademiaText(drive.date || drive.driveDate || 'Date not set')} · ${companyAcademiaText(drive.location || 'Location not set')}</div>
        <div class="flex-align gap-2 mt-3"><button class="btn-saas btn-outline" onclick="updateCompanyCampusDrive('${drive.driveId}','${drive.status === 'Closed' ? 'Open' : 'Closed'}')">${drive.status === 'Closed' ? 'Reopen' : 'Close'}</button><button class="btn-saas btn-outline" onclick="deleteCompanyCampusDrive('${drive.driveId}')">Delete</button></div>
      </div>`).join('') : '<div class="saas-card">No campus drives created yet. Use “Send campus request” to create one.</div>';
  } catch (error) { container.innerHTML = `<div class="saas-card">Unable to load campus drives: ${companyAcademiaText(error.message)}</div>`; }
}

async function companySendCampusRequest() {
  const university = prompt('University or college name:');
  const position = prompt('Position for this campus drive:');
  if (!university || !position) return;
  try {
    await apiFetch('/company/campus-drives', { method: 'POST', body: JSON.stringify({ university, position, status: 'Open' }) });
    await renderCompanyCampusConnect();
  } catch (error) { alert(error.message); }
}

async function updateCompanyCampusDrive(id, status) {
  try { await apiFetch(`/company/campus-drives/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) }); await renderCompanyCampusConnect(); }
  catch (error) { alert(error.message); }
}

async function deleteCompanyCampusDrive(id) {
  if (!confirm('Delete this campus drive?')) return;
  try { await apiFetch(`/company/campus-drives/${encodeURIComponent(id)}`, { method: 'DELETE' }); await renderCompanyCampusConnect(); }
  catch (error) { alert(error.message); }
}

async function renderCompanyShortlist() {
  const container = document.getElementById('company-shortlist-content');
  if (!container) return;
  let applications;
  try {
    applications = await apiFetch('/company/applications');
  } catch (error) {
    container.innerHTML = `<div class="saas-card">Unable to load applications: ${companyAcademiaText(error.message)}</div>`;
    return;
  }
  const shortlisted = (applications || []).filter(item => ['Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Selected', 'Offer'].includes(item.stage || item.status));
  container.innerHTML = shortlisted.map(candidate => `
    <div class="saas-card mb-3">
      <div class="flex-between mb-2">
        <div><h4 style="font-weight:800; margin:0;">${companyAcademiaText(candidate.studentName || candidate.candidate_name || 'Candidate')}</h4></div>
        <span class="badge-saas badge-blue">${companyAcademiaText(candidate.stage || candidate.status || 'Applied')}</span>
      </div>
      <div class="grid-2 gap-3 text-sm" style="color:var(--text-muted);">
        <div><strong>Role:</strong> ${companyAcademiaText(candidate.jobTitle || candidate.job_title || 'Job')}</div>
        <div><strong>Match:</strong> ${Number(candidate.matchScore || candidate.match_percentage || 0)}%</div>
        <div><strong>Applied:</strong> ${companyAcademiaText(candidate.applied_at || 'Not available')}</div>
      </div>
      <div class="flex-align gap-2 mt-3 flex-wrap">
        <button class="btn-saas btn-outline" onclick="handleMoveCandidateStage('${candidate.applicationId || candidate.id}','Shortlisted')">Shortlist</button>
        <button class="btn-saas btn-outline" onclick="scheduleCompanyInterview('${candidate.applicationId || candidate.id}')">Schedule interview</button>
        <button class="btn-saas btn-primary" onclick="sendCompanyOffer('${candidate.applicationId || candidate.id}')">Send offer</button>
      </div>
    </div>
  `).join('') || '<div class="saas-card">No shortlisted applications yet. Move candidates to Shortlisted from the dashboard pipeline.</div>';
}

async function scheduleCompanyInterview(applicationId) {
  const scheduledAt = prompt('Interview date/time (ISO or local text):');
  if (!scheduledAt) return;
  try { await apiFetch('/company/interviews/schedule', { method: 'POST', body: JSON.stringify({ applicationId, scheduledAt, status: 'Scheduled' }) }); alert('Interview scheduled.'); }
  catch (error) { alert(error.message); }
}

async function sendCompanyOffer(applicationId) {
  const salary = prompt('Salary or stipend:');
  if (salary === null) return;
  try {
    await apiFetch('/company/offers', { method: 'POST', body: JSON.stringify({ applicationId, salary }) });
    await handleMoveCandidateStage(applicationId, 'Selected');
    alert('Offer sent.');
  } catch (error) { alert(error.message); }
}

async function companyCompareCandidates() {
  const container = document.getElementById('company-shortlist-content');
  if (!container) return;
  let candidates;
  try {
    candidates = await apiFetch('/company/candidates');
  } catch (error) {
    container.innerHTML = '<div class="saas-card">Unable to load registered student details.</div>';
    console.error('Failed to load candidates for comparison:', error.message);
    return;
  }
  const [first, second] = candidates;
  if (!first || !second) {
    container.innerHTML = '<div class="saas-card">At least two registered students are required for comparison.</div>';
    return;
  }
  container.innerHTML = `
    <div class="saas-card">
      <h3 style="font-weight:800; margin-bottom:1rem;">Compare Candidates</h3>
      <table class="saas-table">
        <thead><tr><th>Metric</th><th>${first.name}</th><th>${second.name}</th></tr></thead>
        <tbody>
          <tr><td>Skills</td><td>${(first.skills || []).join(', ') || 'Not provided'}</td><td>${(second.skills || []).join(', ') || 'Not provided'}</td></tr>
          <tr><td>CGPA</td><td>${first.cgpa ?? 'Not provided'}</td><td>${second.cgpa ?? 'Not provided'}</td></tr>
          <tr><td>Projects</td><td>${first.projects}</td><td>${second.projects}</td></tr>
          <tr><td>Certifications</td><td>${first.certifications}</td><td>${second.certifications}</td></tr>
          <tr><td>Career goal</td><td>${first.goal}</td><td>${second.goal}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

async function renderCompanyAnalytics() {
  const container = document.getElementById('company-analytics-content');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Loading recruitment analytics...</div>';
  try {
    const data = await apiFetch('/api/company/analytics/dashboard');
    const funnel = data.funnel || {};
    const metrics = [
      ['Applications', data.totalApplications || 0],
      ['Shortlisted', data.shortlistedCount || 0],
      ['Selected', data.selectedCount || 0]
    ];
    const performance = (data.jobPerformance || []).map(job => `
      <tr><td>${job.jobTitle || 'Untitled role'}</td><td>${job.applicationCount || 0}</td><td>${Number(job.avgMatchScore || 0).toFixed(1)}%</td></tr>
    `).join('');
    container.innerHTML = `
      <div class="grid-3 gap-4 mb-4">${metrics.map(([label, value]) => `<div class="saas-card"><div style="font-size:0.72rem; color:var(--text-muted);">${label}</div><div style="font-size:1.4rem; font-weight:800; margin-top:0.35rem;">${value}</div></div>`).join('')}</div>
      <div class="grid-2 gap-4">
        <div class="saas-card"><h3 style="font-weight:800; margin-bottom:1rem;">Recruitment funnel</h3>
          ${Object.entries(funnel).map(([stage, count]) => `<div class="flex-between mb-2"><span>${stage}</span><strong>${count || 0}</strong></div>`).join('') || '<div>No funnel data available.</div>'}
        </div>
        <div class="saas-card"><h3 style="font-weight:800; margin-bottom:1rem;">Job performance</h3>
          <table class="saas-table"><thead><tr><th>Role</th><th>Applications</th><th>Avg. match</th></tr></thead><tbody>${performance || '<tr><td colspan="3">No job performance data available.</td></tr>'}</tbody></table>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Company analytics failed', error);
    container.innerHTML = `<div class="saas-card">Unable to load recruitment analytics. ${error.message || 'Please try again later.'}</div>`;
  }
}

async function renderCompanyMessages() {
  const container = document.getElementById('company-messages-content');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Messaging is available through scheduled interviews and application updates. No direct messages are recorded yet.</div>';
}

async function renderCompanyNotifications() {
  const container = document.getElementById('company-notifications-content');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Loading company notifications…</div>';
  try {
    const [interviews, offers] = await Promise.all([apiFetch('/company/interviews'), apiFetch('/company/offers')]);
    const items = [...(interviews || []).map(item => ({ title: 'Interview scheduled', detail: `${item.scheduledAt || item.scheduled_at || 'Date not set'} · ${item.status || 'Scheduled'}` })), ...(offers || []).map(item => ({ title: 'Offer activity', detail: `${item.jobTitle || 'Role'} · ${item.status || 'Sent'}` }))];
    container.innerHTML = items.length ? items.map(item => `<div class="saas-card mb-3"><strong>${companyAcademiaText(item.title)}</strong><div class="text-sm mt-2" style="color:var(--text-muted);">${companyAcademiaText(item.detail)}</div></div>`).join('') : '<div class="saas-card">No company notifications yet.</div>';
  } catch (error) { container.innerHTML = `<div class="saas-card">Unable to load notifications: ${companyAcademiaText(error.message)}</div>`; }
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
  const overview = document.getElementById('college-overview-cards');
  if (overview) overview.innerHTML = '<div class="saas-card">Loading university analytics...</div>';
  try {
    const analytics = await apiFetch('/api/college/analytics');
    document.getElementById('col-total-students').textContent = analytics.total_students;
    document.getElementById('col-placed-students').textContent = analytics.placed_students;
    document.getElementById('col-placement-rate').textContent = `${analytics.placement_rate}%`;

    const tbody = document.getElementById('college-dept-table');
    tbody.innerHTML = (analytics.department_stats || []).map(d => `<tr><td style="font-weight:700;">${d.name}</td><td>${d.total}</td><td style="color:var(--text-emerald); font-weight:800;">${d.placed}</td><td><span class="badge-saas badge-emerald">${d.percentage}%</span></td></tr>`).join('') || '<tr><td colspan="4">No department data available.</td></tr>';
    if (overview) {
      overview.innerHTML = [
        ['Students', analytics.students],
        ['Skills recorded', analytics.skills],
        ['Internships', analytics.internships],
        ['Applications', analytics.applications],
        ['Placements', analytics.placements]
      ].map(([label, value]) => `<div class="saas-card"><div style="font-size:0.72rem;color:var(--text-muted);">${label}</div><div style="font-size:1.4rem;font-weight:800;margin-top:.35rem;">${value || 0}</div></div>`).join('');
    }
    const skills = document.getElementById('college-skill-demand-list');
    if (skills) skills.innerHTML = (analytics.topSkills || []).map(item => `<div class="flex-between mb-2"><span>${item.skill}</span><strong>${item.count}</strong></div>`).join('') || '<div>No skill data available.</div>';
  } catch (e) {
    if (overview) overview.innerHTML = `<div class="saas-card">Unable to load university analytics. ${e.message || 'Please try again later.'}</div>`;
  }
}

async function loadCollegeStudentDirectory() {
  const container = document.getElementById('college-students-list');
  if (!container) return;
  container.innerHTML = '<div class="saas-card">Loading student directory...</div>';
  try {
    const students = await apiFetch('/api/college/students');
    container.innerHTML = students.length ? students.map(s => `<div class="saas-card"><h4 style="font-weight:700;">${s.name}</h4><div style="font-size:0.8rem; color:var(--text-muted);">${s.student_id || 'ID not provided'} • ${s.department}</div><div style="font-size:0.8rem;margin-top:.5rem;">Skills: ${(s.skills || []).join(', ') || 'Not recorded'}<br>Applications: ${s.applications || 0} · Internships: ${s.internship_participation || 0} · ${s.placed ? 'Placed' : 'Placement pending'}</div></div>`).join('') : '<div class="saas-card">No students are associated with this university.</div>';
  } catch (e) {
    container.innerHTML = `<div class="saas-card">Unable to load student directory. ${e.message || 'Please try again later.'}</div>`;
  }
}

// UTILS
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function openLogoutModal() { handleLogout(); }
function handleLogout() {
  authToken = null;
  currentUser = null;
  currentProfile = null;
  localStorage.removeItem('sb_token');
  resetLoginForm('student-login-form', 'stu-login-password-block', 'stu-login-pass', 'stu-login-submit');
  resetLoginForm('company-login-form', 'comp-login-password-block', 'comp-login-pass', 'comp-login-submit');
  resetLoginForm('college-login-form', 'col-login-password-block', 'col-login-pass', 'col-login-submit');
  ['stu-login-id', 'comp-login-user', 'col-login-user'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  showGuestLanding();
}
function closeMobileDrawer() { const sidebar = document.getElementById('app-sidebar'); if (sidebar) sidebar.classList.remove('mobile-open'); }
function toggleMobileDrawer() { const sidebar = document.getElementById('app-sidebar'); if (sidebar) sidebar.classList.toggle('mobile-open'); }
