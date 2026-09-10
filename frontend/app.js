// SkillBridge — Enforced Security Client Engine for Student, Company & College Modules

// Use relative API path that works in both local and production environments
const API_BASE ='https://interview-wc6b.onrender.com/api';

let currentUser = null;
let currentProfile = null;
let currentRole = 'student';
let authToken = localStorage.getItem('sb_token') || null;
let pendingStudentOtpEmail = null;
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
  { en: 'Tell me about yourself and the kind of software role you are looking for.', ta: 'உங்களைப் பற்றியும் நீங்கள் தேடும் மென்பொருள் பணியைப் பற்றியும் சொல்லுங்கள்.' },
  { en: 'Explain one project you built and the most important technical decision you made.', ta: 'நீங்கள் உருவாக்கிய ஒரு திட்டத்தையும் அதில் எடுத்த முக்கியமான தொழில்நுட்ப முடிவையும் விளக்குங்கள்.' },
  { en: 'How would you debug an API that suddenly became slow in production?', ta: 'Production-ல் திடீரென மெதுவான API-யை எப்படி debug செய்வீர்கள்?' },
  { en: 'Describe a time you solved a difficult problem with a teammate.', ta: 'ஒரு குழு உறுப்பினருடன் சேர்ந்து கடினமான பிரச்சினையைத் தீர்த்த அனுபவத்தைச் சொல்லுங்கள்.' },
  { en: 'Why should we select you for this role?', ta: 'இந்த பணிக்கு உங்களை ஏன் தேர்வு செய்ய வேண்டும்?' }
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
  initializeRoleAwareUI();
  if (currentRole === 'student' && currentProfile && currentProfile.onboarding_complete === false) navigateTo('profile');
}

// Role-Aware UI Initialization
async function initializeRoleAwareUI() {
  try {
    // Load AI context for the current role
    const contextData = await apiFetch('/api/ai/context');
    updateAIAssistantContext(contextData);
    
    // Load role-specific suggestions
    const suggestionsData = await apiFetch('/api/ai/suggestions');
    updateAISuggestions(suggestionsData.suggestions);
    
    // Load and render role-specific navigation
    await loadRoleSpecificNavigation();
  } catch (err) {
    console.warn('Failed to load role-aware UI context:', err.message);
  }
}

// Load and render role-specific navigation
async function loadRoleSpecificNavigation() {
  try {
    const navData = await apiFetch('/api/navigation');
    renderRoleNavigation(navData);
  } catch (err) {
    console.warn('Failed to load role-specific navigation:', err.message);
  }
}

// Render role-specific navigation in the sidebar
function renderRoleNavigation(navData) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  // Find or create the role-specific group
  let roleGroup = document.getElementById(`sidebar-${currentRole}-links`);
  if (!roleGroup) {
    roleGroup = document.createElement('div');
    roleGroup.id = `sidebar-${currentRole}-links`;
    roleGroup.className = 'role-sidebar-group';
    sidebar.appendChild(roleGroup);
  }

  // Clear existing items
  roleGroup.innerHTML = '';

  // Render grouped navigation
  Object.entries(navData.groups || {}).forEach(([groupKey, items]) => {
    if (items.length === 0) return;

    // Add group label
    const label = document.createElement('div');
    label.className = 'menu-label';
    label.textContent = getGroupLabelByKey(groupKey);
    roleGroup.appendChild(label);

    // Add menu items
    items.forEach(item => {
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'sidebar-item';
      link.dataset.target = item.id;
      link.onclick = (e) => {
        e.preventDefault();
        navigateTo(item.id);
      };
      
      link.innerHTML = `
        <i class="fa-solid fa-${item.icon}"></i>
        <span>${item.label}</span>
      `;

      roleGroup.appendChild(link);
    });
  });
}

// Map group keys to display labels
function getGroupLabelByKey(key) {
  const labels = {
    main: 'Main',
    academic: 'Academic',
    portfolio: 'Portfolio',
    opportunities: 'Opportunities',
    recruitment: 'Recruitment',
    management: 'Management',
    analytics: 'Analytics',
    content: 'Content',
    system: 'System',
    other: 'Other'
  };
  return labels[key] || key;
}

function updateAIAssistantContext(contextData) {
  const assistantTitle = document.getElementById('ai-assistant-title');
  const assistantGreeting = document.getElementById('ai-assistant-greeting');
  
  if (assistantTitle) {
    assistantTitle.textContent = contextData.assistantTitle;
  }
  
  if (assistantGreeting) {
    assistantGreeting.textContent = contextData.greeting;
  }
  
  // Store role info for later use
  window.currentAIContext = contextData;
}

function updateAISuggestions(suggestions) {
  const suggestionsContainer = document.getElementById('ai-suggestions-container');
  if (!suggestionsContainer) return;
  
  suggestionsContainer.innerHTML = suggestions.slice(0, 4).map((question, idx) => 
    `<button class="ai-suggestion-btn" onclick="askAiQuick('${question.replace(/'/g, "\\'")}')">${question}</button>`
  ).join('');
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

  const collegeRoles = ['college', 'college_admin', 'university_admin'];
  if (targetRole === 'college' && (!currentUser || !collegeRoles.includes(currentUser.role))) {
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
  if (badge) {
    const roleBadges = {
      'student': 'Student Module',
      'company': 'Recruiter Module',
      'college_admin': 'College Admin',
      'university_admin': 'University Admin',
      'super_admin': 'Super Admin'
    };
    badge.textContent = roleBadges[role] || role;
  }

  document.querySelectorAll('.role-sidebar-group').forEach(group => group.classList.add('hidden'));
  const targetGroup = document.getElementById(`sidebar-${role}-links`);
  if (targetGroup) targetGroup.classList.remove('hidden');

  // Route to appropriate dashboard based on role
  if (role === 'student') navigateTo('dashboard');
  else if (role === 'company') navigateTo('company-dashboard');
  else if (role === 'college_admin') navigateTo('college-dashboard');
  else if (role === 'university_admin') navigateTo('university-dashboard');
  else if (role === 'super_admin') navigateTo('admin-dashboard');
}

function navigateToRoleHome() {
  switchPortalRole(currentRole);
}

function navigateTo(viewId) {
  if (viewId === 'dashboard' && currentRole === 'student' && currentProfile && currentProfile.onboarding_complete === false) {
    viewId = 'profile';
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
  else if (viewId === 'ats-resume') loadATSResumeView();
  else if (viewId === 'academics') loadAcademicsView();
  else if (viewId === 'skills') loadSkillsView();
  else if (viewId === 'certificates') loadCertificatesView();
  else if (viewId === 'assessments') loadAssessmentsView();
  else if (viewId === 'portfolio') loadPortfolioView();
  else if (viewId === 'ai-skill-analyzer') loadAISkillAnalyzerView();
  else if (viewId === 'skill-map') loadSkillMapView();
  else if (viewId === 'opportunities') loadOpportunitiesView();
  else if (viewId === 'applications') loadApplicationsView();
  else if (viewId === 'interview-prep') loadInterviewPrepView();
  else if (viewId === 'notifications') loadNotificationsView();
  else if (viewId === 'campus-drives') loadCampusDrivesView();
  else if (viewId === 'placement') loadPlacementView();
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
  else if (viewId === 'college-skill-mapping') loadCollegeSkillMapping();
  else if (viewId === 'college-partnerships') loadCollegePartnerships();
  else if (viewId === 'college-placements') loadCollegePlacements();
  else if (viewId === 'college-campus-drives') loadCollegeCampusDrives();
  else if (viewId === 'college-reports') loadCollegeReports();
  else if (viewId === 'university-dashboard') loadUniversityDashboard();
  else if (viewId === 'admin-dashboard') loadAdminDashboard();
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

  if (tab === 'login') {
    title.innerHTML = '<i class="fa-solid fa-graduation-cap text-blue"></i> Student Sign In';
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
  } else {
    title.innerHTML = '<i class="fa-solid fa-user-plus text-blue"></i> Register Student Account';
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
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
  const passwordError = document.getElementById('stu-reg-password-error');
  const otpInput = document.getElementById('stu-reg-otp');

  passwordError.classList.toggle('hidden', password === confirmPassword);
  if (password !== confirmPassword) return;

  try {
    if (pendingStudentOtpEmail !== email) {
      const otp = await apiFetch('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) });
      pendingStudentOtpEmail = email;
      document.getElementById('student-otp-block').classList.remove('hidden');
      document.getElementById('stu-reg-submit-btn').textContent = 'Verify OTP & Create Account';
      if (otp.devCode && otpInput) otpInput.value = otp.devCode;
      return;
    }
    if (!otpInput || !/^\d{6}$/.test(otpInput.value.trim())) {
      alert('Enter the 6-digit OTP sent to your email.');
      return;
    }
    await apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp: otpInput.value.trim() }) });
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, username, email, mobile, password, confirmPassword, role: 'student' })
    });
    authToken = data.token;
    localStorage.setItem('sb_token', authToken);
    currentUser = data.user;
    currentProfile = data.profile;
    pendingStudentOtpEmail = null;
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

// ===== READ-ONLY & EDIT MODE UTILITIES =====
class ReadOnlyEditManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.isEditMode = false;
    this.originalData = {};
  }

  enableEditMode() {
    this.isEditMode = true;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    // Convert all read-only fields to editable
    container.querySelectorAll('[data-field]').forEach(field => {
      const fieldName = field.dataset.field;
      const value = field.textContent.trim();
      this.originalData[fieldName] = value;

      // Create editable input
      const input = document.createElement('input');
      input.type = field.dataset.type || 'text';
      input.className = 'form-control';
      input.value = value;
      input.id = `edit-${fieldName}`;
      field.replaceWith(input);
    });

    // Show save/cancel buttons
    const buttons = container.querySelector('.edit-mode-buttons');
    if (buttons) buttons.classList.remove('hidden');
  }

  disableEditMode(shouldSave = false) {
    if (!this.isEditMode) return;
    this.isEditMode = false;

    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.querySelectorAll('input[id^="edit-"]').forEach(input => {
      const fieldName = input.id.replace('edit-', '');
      const value = shouldSave ? input.value : this.originalData[fieldName];

      const display = document.createElement('span');
      display.dataset.field = fieldName;
      display.dataset.type = input.type;
      display.className = 'read-only-field';
      display.textContent = value;
      input.replaceWith(display);
    });

    // Hide save/cancel buttons
    const buttons = container.querySelector('.edit-mode-buttons');
    if (buttons) buttons.classList.add('hidden');
  }

  getSavedData() {
    const data = {};
    document.querySelectorAll(`#${this.containerId} input[id^="edit-"]`).forEach(input => {
      const fieldName = input.id.replace('edit-', '');
      data[fieldName] = input.value;
    });
    return data;
  }
}

// Global edit managers for different sections
const editManagers = {
  profile: new ReadOnlyEditManager('profile-view'),
  academics: new ReadOnlyEditManager('academics-view'),
  skills: new ReadOnlyEditManager('skills-view')
};

// Read-only wrapper for displaying dashboard fields
function createReadOnlyField(label, value, fieldName = '', fieldType = 'text') {
  return `
    <div class="form-group">
      <label>${label}</label>
      <div class="read-only-display">
        <span data-field="${fieldName}" data-type="${fieldType}" class="read-only-value">${value || '-'}</span>
        <button class="btn-edit" onclick="toggleFieldEdit('${fieldName}', true)">✎ Edit</button>
      </div>
    </div>
  `;
}

// Toggle between read-only and edit mode for a field
function toggleFieldEdit(fieldName, enable = true) {
  const field = document.querySelector(`[data-field="${fieldName}"]`);
  if (!field) return;

  const container = field.closest('.read-only-display');
  if (!container) return;

  if (enable) {
    const value = field.textContent;
    const input = document.createElement('input');
    input.type = field.dataset.type || 'text';
    input.className = 'form-control';
    input.value = value;
    input.id = `input-${fieldName}`;
    container.classList.add('edit-mode');
    field.replaceWith(input);
  } else {
    const input = container.querySelector('input');
    if (input) {
      const display = document.createElement('span');
      display.dataset.field = fieldName;
      display.dataset.type = input.type;
      display.className = 'read-only-value';
      display.textContent = input.value;
      container.classList.remove('edit-mode');
      input.replaceWith(display);
    }
  }
}

// STUDENT LOADERS
async function loadDashboardHome() {
  try {
    const data = await apiFetch('/student/profile');
    currentProfile = data.profile;
    document.getElementById('welcome-header').textContent = `Welcome back, ${currentProfile.name || 'Student'}`;
    const completion = data.completion || { percentage: 80, missingItems: [] };
    document.getElementById('dash-profile-pct').textContent = `${completion.percentage}%`;
    document.getElementById('dash-profile-bar').style.width = `${completion.percentage}%`;

    const acad = await apiFetch('/student/academics');
    document.getElementById('school-tenth').value = acad.school?.tenth_percentage ?? '';
    document.getElementById('school-twelfth').value = acad.school?.twelfth_percentage ?? '';
    document.getElementById('backlogs-count').value = acad.backlog?.current_backlogs ?? 0;
    document.getElementById('stat-cgpa').textContent = acad.cgpa === null ? 'Not available' : Number(acad.cgpa).toFixed(2);

    const opps = await apiFetch('/opportunities');
    const recContainer = document.getElementById('dash-recommended-jobs');
    recContainer.innerHTML = opps.slice(0, 3).map(j => `
      <div class="saas-card">
        <div class="badge-saas badge-purple mb-2">${j.match_percentage}% MATCH</div>
        <h4 style="font-weight:700;">${j.title}</h4>
        <div style="font-size:0.8rem; color:var(--text-blue); font-weight:700;" class="mb-2">${j.company_name}</div>
        <button class="btn-saas btn-primary w-full" onclick="navigateTo('opportunities')">View & Apply</button>
      </div>
    `).join('');
    const skills = await apiFetch('/student/skills');
    document.getElementById('dash-skills-list').innerHTML = (skills.technical || []).length ? skills.technical.map(skill => `<div>${skill.skillName || skill.skill_name}: ${skill.proficiencyPercentage}% | ${skill.scoreOutOfTen}/10</div>`).join('') : '<span>No skills added yet</span>';
    const portfolio = await apiFetch('/student/portfolio');
    document.getElementById('stat-skills').textContent = skills.technical?.length || 0;
    document.getElementById('stat-projects').textContent = portfolio.projects?.length || 0;
    document.getElementById('stat-certs').textContent = portfolio.certificates?.length || 0;
    document.getElementById('stat-score').textContent = 'Calculated from profile';
    document.getElementById('dash-certificates-count').textContent = `${(portfolio.certificates || []).length} certificate(s)`;
    const match = opps[0];
    document.getElementById('dash-ai-match').textContent = match ? `${match.match_percentage}% match` : 'No job match available';
  } catch (e) {}
}

async function loadProfileView() {
  try {
    const data = await apiFetch('/student/profile');
    const p = data.profile || {};
    document.getElementById('prof-name').value = p.name || '';
    document.getElementById('prof-student-id').value = p.student_id || currentUser.student_id || '';
    document.getElementById('prof-phone').value = p.phone || '';
    document.getElementById('prof-college').value = p.college || '';
    ['university','department','degree','city','state','country','pincode'].forEach(field => { const el = document.getElementById(`prof-${field}`); if (el) el.value = p[field] || ''; });
    ['doorHouse','street','area','district'].forEach(field => { const el = document.getElementById(`prof-${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}`); if (el) el.value = p.address?.[field] || ''; });
    document.getElementById('prof-dob').value = p.dateOfBirth || '';
    document.getElementById('prof-gender').value = p.gender || '';
    document.getElementById('prof-graduation').value = p.graduationYear || '';
    const acad = await apiFetch('/student/academics');
    const bySemester = Object.fromEntries((acad.records || []).map(record => [record.semester, record.gpa]));
    const fields = document.getElementById('onboarding-gpa-fields');
    fields.innerHTML = Array.from({ length: 8 }, (_, index) => `<div><label class="block text-xs font-bold mb-1">Semester ${index + 1}</label><input type="number" min="0" max="10" step="0.01" class="saas-input onboarding-gpa" data-semester="${index + 1}" value="${bySemester[`Semester ${index + 1}`] ?? ''}" /></div>`).join('');
    fields.querySelectorAll('.onboarding-gpa').forEach(input => input.addEventListener('input', updateOnboardingCGPA));
    updateOnboardingCGPA();
    const pref = await apiFetch('/student/preferences');
    document.getElementById('onboarding-roles').value = (pref.preferences.jobRoles || []).join(', ');
    document.getElementById('onboarding-industries').value = (pref.preferences.industries || []).join(', ');
    document.getElementById('onboarding-locations').value = (pref.preferences.locations || []).join(', ');
    document.getElementById('onboarding-type').value = (pref.preferences.opportunityTypes || [])[0] || '';
    document.getElementById('onboarding-resume').value = p.resume_url || '';
    const skills = await apiFetch('/student/skills');
    document.getElementById('onboarding-skills').value = (skills.technical || []).map(s => `${s.skill_name}:${s.level_pct}`).join(', ');
  } catch (e) {}
}

async function extractPdfText(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Only PDF resumes are accepted.');
  if (!window.pdfjsLib) throw new Error('PDF analysis is still loading. Please try again.');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
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
  const foundSections = sections.filter(section => normalized.includes(section));
  const keywords = ['python', 'java', 'javascript', 'sql', 'react', 'docker', 'api', 'aws'];
  const verbs = ['built', 'developed', 'implemented', 'designed', 'deployed', 'led'];
  const sectionsScore = foundSections.length / sections.length * 35;
  const contactScore = (/@/.test(text) ? 8 : 0) + (/(linkedin|github|https?:\/\/)/i.test(text) ? 7 : 0);
  const keywordScore = keywords.filter(keyword => normalized.includes(keyword)).length / keywords.length * 25;
  const actionScore = verbs.filter(verb => normalized.includes(verb)).length / verbs.length * 15;
  const lengthScore = text.length >= 800 && text.length <= 12000 ? 10 : (text.length > 200 ? 5 : 0);
  const score = Math.min(100, Math.round(sectionsScore + contactScore + keywordScore + actionScore + lengthScore));
  return {
    score,
    aiScore: Math.min(100, Math.round(score * 0.85 + 15)),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    missingSections: sections.filter(section => !normalized.includes(section)),
    breakdown: [
      ['Resume sections', sectionsScore, 35],
      ['Contact & links', contactScore, 15],
      ['Technical keywords', keywordScore, 25],
      ['Action language', actionScore, 15],
      ['Length & readability', lengthScore, 10]
    ]
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the PDF file.'));
    reader.readAsDataURL(file);
  });
}

function renderResumeATSAnalysis(analysis) {
  document.getElementById('resume-ats-empty').classList.add('hidden');
  document.getElementById('resume-ats-results').classList.remove('hidden');
  document.getElementById('resume-ats-score').textContent = `${analysis.score} / 100`;
  document.getElementById('resume-ai-score').textContent = `${analysis.aiScore} / 100`;
  const status = document.getElementById('resume-ats-status');
  status.textContent = analysis.score >= 80 ? 'Strong match' : analysis.score >= 60 ? 'Needs tuning' : 'Needs improvement';
  status.className = `badge-saas ${analysis.score >= 80 ? 'badge-emerald' : 'badge-purple'}`;
  document.getElementById('resume-ats-breakdown').innerHTML = analysis.breakdown.map(item => `
    <div><div class="flex-between text-sm"><strong>${item[0]}</strong><span>${Math.round(item[1])}% / ${item[2]}%</span></div>
    <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div style="width:${Math.min(100, item[1] / item[2] * 100)}%;height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);"></div></div></div>
  `).join('');
  document.getElementById('resume-ats-findings').textContent = `${analysis.wordCount} words analyzed. ${analysis.missingSections.length ? `Missing sections: ${analysis.missingSections.join(', ')}.` : 'All core sections detected.'}`;
}

async function loadATSResumeView() {
  try {
    const data = await apiFetch('/student/profile');
    if (data.resume && data.resume.ats_analysis) renderResumeATSAnalysis(data.resume.ats_analysis);
  } catch (error) {
    console.error('ATS resume analysis load failed:', error);
  }
}

async function handleResumeUpload(event) {
  event.preventDefault();
  const file = document.getElementById('resume-file-input').files[0];
  if (!file || file.type !== 'application/pdf') {
    alert('Please select a PDF resume.');
    return;
  }
  try {
    const analysis = calculateResumeATS(await extractPdfText(file));
    renderResumeATSAnalysis(analysis);
    await apiFetch('/student/resume', {
      method: 'POST',
      body: JSON.stringify({ fileUrl: await readFileAsDataUrl(file), resumeUrl: await readFileAsDataUrl(file), fileName: file.name, atsAnalysis: analysis })
    });
    document.getElementById('resume-file-input').value = '';
    alert('PDF analyzed successfully.');
  } catch (error) {
    alert(error.message || 'Resume analysis failed.');
  }
}

function updateOnboardingCGPA() {
  const values = [...document.querySelectorAll('.onboarding-gpa')].map(input => input.value).filter(value => value !== '').map(Number).filter(inputValueIsPresent);
  const element = document.getElementById('onboarding-cgpa');
  element.textContent = values.length ? `Current CGPA: ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)}` : 'Enter semester GPA to calculate CGPA';
}
function inputValueIsPresent(value) { return Number.isFinite(value) && value >= 0; }
async function handleSaveProfile(e) {
  e.preventDefault();
  try {
    const skills = document.getElementById('onboarding-skills').value.split(',').map(item => { const [skillName, proficiencyPercentage] = item.split(':'); return { skillName: (skillName || '').trim(), proficiencyPercentage: Number(proficiencyPercentage), category: 'Other' }; }).filter(skill => skill.skillName && Number.isFinite(skill.proficiencyPercentage));
    const semesterGpa = [...document.querySelectorAll('.onboarding-gpa')].map(input => input.value === '' ? null : Number(input.value));
    const data = await apiFetch('/student/onboarding', {
      method: 'POST',
      body: JSON.stringify({
        profile: { name: document.getElementById('prof-name').value.trim(), phone: document.getElementById('prof-phone').value.trim(), college: document.getElementById('prof-college').value.trim(), university: document.getElementById('prof-university').value.trim(), department: document.getElementById('prof-department').value.trim(), degree: document.getElementById('prof-degree').value.trim(), dateOfBirth: document.getElementById('prof-dob').value, gender: document.getElementById('prof-gender').value, graduationYear: Number(document.getElementById('prof-graduation').value), city: document.getElementById('prof-city').value.trim(), state: document.getElementById('prof-state').value.trim(), country: document.getElementById('prof-country').value.trim(), pincode: document.getElementById('prof-pincode').value.trim(), address: { doorHouse: document.getElementById('prof-door-house').value.trim(), street: document.getElementById('prof-street').value.trim(), area: document.getElementById('prof-area').value.trim(), city: document.getElementById('prof-city').value.trim(), district: document.getElementById('prof-district').value.trim(), state: document.getElementById('prof-state').value.trim(), pincode: document.getElementById('prof-pincode').value.trim() }, resume_url: document.getElementById('onboarding-resume').value.trim() },
        school: { tenth_percentage: Number(document.getElementById('school-tenth').value) || null, twelfth_percentage: Number(document.getElementById('school-twelfth').value) || null },
        backlog: { current_backlogs: Number(document.getElementById('backlogs-count').value) || 0 },
        semesterGpa, skills,
        preferences: { jobRoles: document.getElementById('onboarding-roles').value.split(',').map(value => value.trim()).filter(Boolean), industries: document.getElementById('onboarding-industries').value.split(',').map(value => value.trim()).filter(Boolean), locations: document.getElementById('onboarding-locations').value.split(',').map(value => value.trim()).filter(Boolean), opportunityTypes: [document.getElementById('onboarding-type').value] }
      })
    });
    currentProfile = data.profile;
    alert('Profile saved. Welcome to your dashboard!');
    navigateTo('dashboard');
  } catch (err) { alert(err.message || 'Profile update failed.'); }
}
async function loadAcademicsView() {
  try {
    const data = await apiFetch('/student/academics');
    const tbody = document.getElementById('semester-table-body');
    const records = Object.fromEntries((data.records || []).map(record => [record.semester, record]));
    document.getElementById('academic-tenth').value = data.school?.tenth_percentage ?? '';
    document.getElementById('academic-twelfth').value = data.school?.twelfth_percentage ?? '';
    document.getElementById('academic-backlogs').value = data.backlog?.current_backlogs ?? 0;
    tbody.innerHTML = Array.from({ length: 8 }, (_, index) => { const record = records[`Semester ${index + 1}`]; return `<tr><td style="font-weight:700;">Semester ${index + 1}</td><td><input class="saas-input semester-edit" data-semester="${index + 1}" type="number" min="0" max="10" step="0.01" value="${record?.gpa ?? ''}" oninput="updateAcademicCGPA()"></td><td>${record?.gpa !== null && record?.gpa !== undefined ? 'Completed' : 'Not Completed'}</td></tr>`; }).join('');
    updateAcademicCGPA();
  } catch (e) {}
}
function updateAcademicCGPA() { const values = [...document.querySelectorAll('.semester-edit')].map(input => Number(input.value)).filter(value => Number.isFinite(value) && value >= 0); const target = document.getElementById('academic-cgpa'); if (target) target.textContent = values.length ? `Calculated CGPA: ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)}` : 'Calculated CGPA: Not available'; }
async function saveAcademicSummary() { try { const semesterGpa = [...document.querySelectorAll('.semester-edit')].map(input => input.value === '' ? null : Number(input.value)); await apiFetch('/student/academics', { method: 'PUT', body: JSON.stringify({ semesterGpa, school: { tenth_percentage: Number(document.getElementById('academic-tenth').value) || null, twelfth_percentage: Number(document.getElementById('academic-twelfth').value) || null }, backlog: { current_backlogs: Number(document.getElementById('academic-backlogs').value) || 0 } }) }); alert('Academic record saved.'); loadAcademicsView(); } catch (err) { alert(err.message); } }
async function loadSkillsView() {
  try {
    const data = await apiFetch('/student/skills');
    document.getElementById('technical-skills-list').innerHTML = (data.technical || []).map(s => `<div class="flex-between"><span>${s.skill_name}</span> <span class="badge-saas badge-purple">${s.level_pct}% · ${s.scoreOutOfTen}/10</span></div>`).join('');
  } catch (e) {}
}
async function handleSkillSubmit(event) { event.preventDefault(); try { const data = await apiFetch('/student/skills', { method: 'POST', body: JSON.stringify({ skillName: document.getElementById('skill-entry-name').value, category: document.getElementById('skill-entry-category').value, proficiencyPercentage: Number(document.getElementById('skill-entry-percent').value) }) }); if (data.duplicate) alert(`${document.getElementById('skill-entry-name').value} already exists in your skills. It was updated.`); else alert('Skill added.'); event.target.reset(); loadSkillsView(); } catch (err) { alert(err.message); } }
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
    const projects = (data.projects || []).map(p => `<div class="saas-card mb-3"><h4 style="font-weight:700;">${p.title}</h4><p style="font-size:0.85rem; color:var(--text-muted);">${p.description}</p></div>`).join('');
    const certificates = (data.certificates || []).map(cert => `<div class="saas-card mb-3 flex-between"><div><h4>${cert.certificateName || cert.name}</h4><p class="text-xs">${cert.category || 'Other'} · ${cert.issuer || ''} · ${cert.issueDate || ''}</p></div><div>${cert.certificateUrl ? `<a class="btn-saas btn-outline" href="${cert.certificateUrl}" target="_blank" rel="noreferrer">View</a>` : ''}<button class="btn-saas btn-outline" onclick="deleteCertificate(${cert.id})">Delete</button></div></div>`).join('');
    const achievements = (data.achievements || []).map(item => `<div class="saas-card mb-3"><h4>${item.title || 'Achievement'}</h4><p class="text-xs">${item.organization || ''} · ${item.date || ''}</p></div>`).join('');
    document.getElementById('portfolio-tab-content').innerHTML = `<h2 class="mb-3">Projects</h2>${projects || '<p class="mb-4">No projects recorded.</p>'}<h2 class="mb-3">Certificates</h2>${certificates || '<p class="mb-4">No certificates recorded.</p>'}<h2 class="mb-3">Achievements</h2>${achievements || '<p>No achievements recorded.</p>'}`;
  } catch (e) {}
}
async function loadCertificatesView() {
  try {
    const data = await apiFetch('/student/portfolio');
    const certificates = data.certificates || [];
    document.getElementById('certificates-page-list').innerHTML = certificates.length ? certificates.map(cert => `<div class="saas-card mb-3 flex-between"><div><h4>${cert.certificateName || cert.name}</h4><p class="text-xs">${cert.category || 'Other'} · ${cert.issuer || ''} · ${cert.issueDate || ''}</p></div><div>${cert.certificateUrl ? `<a class="btn-saas btn-outline" href="${cert.certificateUrl}" target="_blank" rel="noreferrer">View</a>` : ''}<button class="btn-saas btn-outline" onclick="deleteCertificate(${cert.id})">Delete</button></div></div>`).join('') : '<div class="saas-card"><p>No certificates added yet</p><button class="btn-saas btn-primary mt-3" onclick="document.getElementById(\'certificate-name\').focus()">+ Add Your First Certificate</button></div>';
  } catch (e) { document.getElementById('certificates-page-list').textContent = 'Unable to load certificates.'; }
}
async function handleCertificateSubmit(event) { event.preventDefault(); try { await apiFetch('/student/certificates', { method: 'POST', body: JSON.stringify({ certificateName: document.getElementById('certificate-name').value.trim(), category: document.getElementById('certificate-category').value, issuer: document.getElementById('certificate-issuer').value.trim(), issueDate: document.getElementById('certificate-date').value, credentialId: document.getElementById('certificate-credential').value.trim(), certificateUrl: document.getElementById('certificate-url').value.trim() }) }); event.target.reset(); alert('Certificate saved.'); loadPortfolioView(); } catch (err) { alert(err.message); } }
async function deleteCertificate(id) { if (!window.confirm('Are you sure you want to delete this certificate?')) return; try { await apiFetch(`/student/certificates/${id}`, { method: 'DELETE' }); if (!document.getElementById('view-certificates').classList.contains('hidden')) loadCertificatesView(); else loadPortfolioView(); } catch (err) { alert(err.message); } }
function openAiAssistant() { document.getElementById('ai-assistant-panel').classList.remove('hidden'); }
function closeAiAssistant() { document.getElementById('ai-assistant-panel').classList.add('hidden'); }
function askAiQuick(message) { document.getElementById('student-ai-chat-input').value = message; document.getElementById('student-ai-chat-input').focus(); }
async function handleAiChatSubmit(event) { 
  event.preventDefault(); 
  const input = document.getElementById('student-ai-chat-input'); 
  const log = document.getElementById('student-ai-chat-log'); 
  const message = input.value.trim(); 
  if (!message) return; 
  log.insertAdjacentHTML('beforeend', `<div class="chat-bubble user">${message}</div>`); 
  input.value = ''; 
  try { 
    const data = await apiFetch('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message }) }); 
    log.insertAdjacentHTML('beforeend', `<div class="chat-bubble bot">${data.reply}</div>`); 
    log.scrollTop = log.scrollHeight; 
  } catch (err) { 
    log.insertAdjacentHTML('beforeend', `<div class="chat-bubble bot">Error: ${err.message}</div>`); 
  } 
}
async function loadAISkillAnalyzerView() {
  try {
    const data = await apiFetch('/student/jobs/101');
    document.getElementById('ai-match-pct').textContent = `${data.matchPercentage}% Match`;
    document.getElementById('ai-match-details').innerHTML = `<p class="mt-2">${data.recommendationLevel}</p><p class="text-xs mt-2">${data.nonGuarantee}</p><table class="saas-table mt-3"><thead><tr><th>Skill</th><th>Required</th><th>Student</th><th>Result</th></tr></thead><tbody>${(data.skillGaps || []).map(item => `<tr><td>${item.skill}</td><td>${item.reqLevel}</td><td>${item.studentLevel}</td><td>${item.result === 'Match' ? '✓ Match' : '⚠ Gap'}</td></tr>`).join('')}</tbody></table>`;
  } catch (e) {}
}
async function loadSkillMapView() {
  try {
    const data = await apiFetch('/student/skill-map');
    document.getElementById('skill-map-companies').innerHTML = (data.companies || []).map(company => `<span class="badge-saas badge-blue">${company}</span>`).join('') || '<span class="text-sm">No companies available.</span>';
    document.getElementById('skill-map-list').innerHTML = (data.jobs || []).map(job => `<div class="saas-card mb-3"><div class="flex-between"><div><h3>${job.jobTitle}</h3><p class="text-xs" style="color:var(--text-muted);">${job.companyName} · ${job.location || 'Location not specified'} · ${job.jobType || 'Opportunity'}</p></div><div class="text-right"><strong style="color:var(--text-emerald);">${job.matchPercentage}%</strong><div class="text-xs">${job.recommendationLevel}</div></div></div><div class="grid-2 gap-3 mt-3"><div><strong class="text-xs">Strengths</strong><p class="text-xs mt-1">${job.strengths?.join(' ') || 'No matching requirements recorded.'}</p></div><div><strong class="text-xs">Skill gaps</strong><p class="text-xs mt-1">${job.skillGaps?.join(' ') || 'No skill gaps detected.'}</p></div></div><button class="btn-saas btn-outline mt-3" onclick="navigateTo('ai-skill-analyzer'); loadJobAnalysis(${job.jobId})">View AI Analysis</button></div>`).join('') || '<div class="saas-card">No jobs are available for skill mapping.</div>';
  } catch (e) { document.getElementById('skill-map-list').innerHTML = '<div class="saas-card">Unable to load the AI skill map.</div>'; }
}
async function loadJobAnalysis(jobId) { try { const data = await apiFetch(`/student/jobs/${jobId}`); document.getElementById('ai-match-pct').textContent = `${data.matchPercentage}% Match`; document.getElementById('ai-match-details').innerHTML = `<p class="mt-2">${data.recommendationLevel}</p><p class="text-xs mt-2">${data.nonGuarantee}</p><table class="saas-table mt-3"><thead><tr><th>Skill</th><th>Required</th><th>Student</th><th>Result</th></tr></thead><tbody>${(data.skillGaps || []).map(item => `<tr><td>${item.skill}</td><td>${item.reqLevel}</td><td>${item.studentLevel}</td><td>${item.result === 'Match' ? '✓ Match' : '⚠ Gap'}</td></tr>`).join('')}</tbody></table>`; } catch (e) {} }
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
    document.getElementById('applications-list-container').innerHTML = apps.map(a => `<div class="saas-card mb-3 flex-between application-row"><div><h4 style="font-weight:700;">${a.job_title}</h4><div style="font-size:0.85rem; color:var(--text-blue);">${a.company_name}</div><div class="text-xs mt-2" style="color:var(--text-muted);">${a.interview ? `Interview: ${a.interview.date} at ${a.interview.time}` : 'Application in progress'}</div></div><div class="flex-align gap-2"><span class="badge-saas badge-emerald">${a.status}</span>${a.interview ? '<button class="btn-saas btn-primary" onclick="navigateTo(\'interview-prep\')"><i class="fa-solid fa-microphone-lines"></i> Practice</button>' : ''}</div></div>`).join('') || '<div class="saas-card">No applications yet.</div>';
  } catch (e) {}
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
    const text = language === 'ta-IN' ? question.ta : question.en;
    const questionEl = document.getElementById('interview-question');
    const currentText = questionEl.textContent || '';
    if (!voiceInterview.sessionStarted && (currentText.includes('Choose a language') || currentText.includes('Ready when you are'))) {
      questionEl.textContent = text;
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
  document.getElementById('interview-progress').textContent = '0 / 5';
  document.getElementById('interview-question').textContent = 'Choose a language and start the mock interview. The agent will ask one question at a time.';
  document.getElementById('interview-transcript').value = '';
  document.getElementById('interview-summary').innerHTML = '<span class="text-sm" style="color:var(--text-muted);">Your practice summary will appear here when you finish.</span>';
  setInterviewStatus('Microphone is off');
}

function setInterviewStatus(message) {
  const status = document.getElementById('interview-status');
  if (status) status.textContent = message;
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
  const transcript = document.getElementById('interview-transcript').value.trim();
  const nextButton = document.getElementById('interview-next-btn');
  nextButton.disabled = !transcript;
  setInterviewStatus(transcript ? 'Answer ready. Review it and continue.' : 'Ready for your answer');
}

function startVoiceInterview() {
  resetInterviewView();
  voiceInterview.sessionStarted = true;
  const question = interviewQuestions[0];
  const text = voiceInterview.language === 'ta-IN' ? question.ta : question.en;
  document.getElementById('interview-question-number').textContent = 'Question 1';
  document.getElementById('interview-progress').textContent = '1 / 5';
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
    voiceInterview.recognition.stop();
    return;
  }

  const recognition = new Recognition();
  recognition.lang = voiceInterview.language;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 3;

  voiceInterview.recognition = recognition;
  voiceInterview.listening = true;

  recognition.onstart = () => setInterviewStatus('Listening... Speak clearly into the mic.');
  recognition.onresult = event => {
    // Build a transcript that prefers final results but also shows interim text.
    let interim = '';
    let finalTranscript = '';
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      const piece = (res[0] && res[0].transcript) ? res[0].transcript : '';
      if (res.isFinal) finalTranscript += piece + ' ';
      else interim += piece + ' ';
    }
    const combined = (finalTranscript + interim).trim();
    if (!combined) return;
    document.getElementById('interview-transcript').value = combined;
    voiceInterview.lastTranscript = combined;
    updateInterviewAnswerState();
    // If we received a final result, offer the user to continue immediately.
    if (finalTranscript.trim()) {
      document.getElementById('interview-next-btn').disabled = false;
      setInterviewStatus('Answer captured. Review and continue.');
    }
  };
  recognition.onerror = event => {
    const errorMessage = event.error === 'not-allowed'
      ? 'Microphone permission was denied. You can still type your answer.'
      : `Voice input error: ${event.error}`;
    setInterviewStatus(errorMessage);
    voiceInterview.listening = false;
    // Ensure recognition reference is cleared so future toggles recreate it.
    try { voiceInterview.recognition && voiceInterview.recognition.abort(); } catch (e) {}
    voiceInterview.recognition = null;
  };
  recognition.onend = () => {
    voiceInterview.listening = false;
    const typedValue = document.getElementById('interview-transcript').value.trim();
    const last = (voiceInterview.lastTranscript || '').trim();
    if (typedValue || last) {
      if (!typedValue && last) document.getElementById('interview-transcript').value = last;
      setInterviewStatus('Answer ready. Review it and continue.');
      document.getElementById('interview-next-btn').disabled = false;
    } else {
      setInterviewStatus('No answer captured. Type your response or try again.');
    }
    // Clear recognition so subsequent toggles create a fresh instance.
    voiceInterview.recognition = null;
  };

  recognition.start();
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
  document.getElementById('interview-progress').textContent = `${voiceInterview.questionIndex + 1} / 5`;
  document.getElementById('interview-question').textContent = text;
  document.getElementById('interview-transcript').value = '';
  document.getElementById('interview-next-btn').disabled = true;
  setInterviewStatus('Ready for your answer');
  speakInterviewQuestion(text);
}

function finishVoiceInterview() {
  if (voiceInterview.recognition && voiceInterview.listening) voiceInterview.recognition.stop();
  const answered = voiceInterview.answers.length;
  const summaryItems = voiceInterview.answers.map((answer, index) => `<div class="text-sm mb-2"><strong>Q${index + 1}:</strong> ${answer.slice(0, 220)}${answer.length > 220 ? '…' : ''}</div>`).join('');

  document.getElementById('interview-question-number').textContent = 'Practice complete';
  document.getElementById('interview-progress').textContent = `${answered} / 5 answered`;
  document.getElementById('interview-question').textContent = 'Good work. Review your answers and repeat the round to improve clarity and structure.';
  document.getElementById('interview-start-btn').disabled = false;
  document.getElementById('interview-next-btn').disabled = true;
  document.getElementById('interview-listen-btn').disabled = true;
  document.getElementById('interview-summary').innerHTML = `<strong>${answered}/5 responses captured</strong><div class="mt-3">${summaryItems || '<p class="text-sm mt-2">No answers recorded yet.</p>'}</div><p class="text-sm mt-2">Try answering with a clear situation, action, and result. No audio or transcript was uploaded.</p>`;
  setInterviewStatus('Session complete');
  if ('speechSynthesis' in window) speakInterviewQuestion(voiceInterview.language === 'ta-IN' ? 'நன்றி. உங்கள் நேர்காணல் பயிற்சி முடிந்தது.' : 'Thank you. Your interview practice is complete.');
}
async function loadNotificationsView() {
  try {
    const list = await apiFetch('/student/notifications');
    document.getElementById('notifications-list-container').innerHTML = list.map(n => `<div class="saas-card mb-3"><h4 style="font-weight:700;">${n.title}</h4><p style="font-size:0.85rem; color:var(--text-muted);">${n.message}</p></div>`).join('');
  } catch (e) {}
}
async function loadCampusDrivesView() {
  try {
    const drives = await apiFetch('/student/campus-drives');
    document.getElementById('campus-drives-list').innerHTML = drives.length ? drives.map(drive => `<div class="saas-card mb-3"><div class="flex-between"><div><h3>${drive.company}</h3><p>${drive.role} · ${drive.location}</p></div><span class="badge-saas ${drive.eligible ? 'badge-emerald' : 'badge-red'}">${drive.eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</span></div><p class="text-xs mt-2">Drive: ${drive.date} · Deadline: ${drive.deadline} · ${drive.salary}</p><p class="text-xs mt-2" style="color:var(--text-muted);">${drive.reason}</p>${drive.eligible && !drive.registered ? `<button class="btn-saas btn-primary mt-3" onclick="registerForDrive(${drive.id})">Register</button>` : drive.registered ? '<span class="badge-saas badge-emerald mt-3">Registered</span>' : ''}</div>`).join('') : '<div class="saas-card">No campus drives are available.</div>';
  } catch (e) { document.getElementById('campus-drives-list').innerHTML = '<div class="saas-card">Unable to load campus drives.</div>'; }
}
async function registerForDrive(driveId) {
  try { await apiFetch(`/student/campus-drives/${driveId}/register`, { method: 'POST' }); alert('Registered for the campus drive.'); loadCampusDrivesView(); } catch (err) { alert(err.message); }
}
async function loadPlacementView() {
  try {
    const data = await apiFetch('/student/placement');
    const placement = data.placement;
    document.getElementById('placement-current').innerHTML = placement ? `<div class="badge-saas badge-emerald">${placement.status || 'Placed'}</div><h3 class="mt-2">${placement.companyName} · ${placement.role}</h3><p>${placement.package || ''} ${placement.location || ''}</p>` : '<p style="color:var(--text-muted);">No placement recorded yet.</p>';
    if (placement) ['company','role','department','package','location'].forEach(field => { const element = document.getElementById(`placement-${field}`); if (element) element.value = placement[field === 'company' ? 'companyName' : field] || ''; });
  } catch (e) {}
}
async function handleSavePlacement(e) {
  e.preventDefault();
  try { await apiFetch('/student/placement', { method: 'POST', body: JSON.stringify({ companyName: document.getElementById('placement-company').value.trim(), role: document.getElementById('placement-role').value.trim(), department: document.getElementById('placement-department').value.trim(), package: document.getElementById('placement-package').value.trim(), placementDate: document.getElementById('placement-date').value, joiningDate: document.getElementById('placement-joining').value, location: document.getElementById('placement-location').value.trim(), placementType: document.getElementById('placement-type').value, status: 'Placed' }) }); alert('Placement saved.'); loadPlacementView(); } catch (err) { alert(err.message); }
}

async function loadSettingsView() {
  const container = document.getElementById('view-settings');
  if (!container) return;

  try {
    const data = await apiFetch('/student/settings');
    const user = data.user || {};
    const settings = data.settings || {};

    container.innerHTML = `
      <div class="settings-container">
        <div class="view-header">
          <h1>Settings</h1>
          <p>Manage your account, preferences, and privacy settings</p>
        </div>

        <!-- ACCOUNT SECTION -->
        <div class="settings-section">
          <h2>Account</h2>
          <form id="account-form" class="settings-form">
            <div class="form-group">
              <label>Username</label>
              <input type="text" id="setting-username" class="form-control" value="${user.username || ''}" />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="setting-email" class="form-control" value="${user.email || ''}" />
            </div>
            <div class="form-group">
              <label>Mobile</label>
              <input type="tel" id="setting-mobile" class="form-control" value="${user.mobile || ''}" />
            </div>
            ${currentRole === 'student' ? `
            <div class="form-group">
              <label>Student ID (Read-only)</label>
              <input type="text" class="form-control" value="${user.student_id || '-'}" readonly />
            </div>
            ` : ''}
            <button type="button" class="btn-saas btn-primary" onclick="saveAccountSettings()">Save Changes</button>
          </form>
        </div>

        <!-- PASSWORD SECTION -->
        <div class="settings-section">
          <h2>Password</h2>
          <form id="password-form" class="settings-form">
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" id="current-password" class="form-control" placeholder="Enter your current password" />
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="new-password" class="form-control" placeholder="Enter new password" />
            </div>
            <div class="form-group">
              <label>Confirm Password</label>
              <input type="password" id="confirm-password" class="form-control" placeholder="Confirm new password" />
            </div>
            <button type="button" class="btn-saas btn-primary" onclick="changePassword(event)">Change Password</button>
          </form>
        </div>

        <!-- NOTIFICATIONS SECTION -->
        ${currentRole === 'student' || currentRole === 'company' ? `
        <div class="settings-section">
          <h2>Notifications</h2>
          <div class="settings-form notification-toggles">
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="jobNotifications" ${settings.jobNotifications ? 'checked' : ''} />
                <div>
                  <strong>Job Matches</strong>
                  <p class="text-xs">Get notified when jobs match your profile</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="internshipNotifications" ${settings.internshipNotifications ? 'checked' : ''} />
                <div>
                  <strong>Internships</strong>
                  <p class="text-xs">Get notified about internship opportunities</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="campusDriveNotifications" ${settings.campusDriveNotifications ? 'checked' : ''} />
                <div>
                  <strong>Campus Drives</strong>
                  <p class="text-xs">Get notified about upcoming campus drives</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="applicationNotifications" ${settings.applicationNotifications ? 'checked' : ''} />
                <div>
                  <strong>Application Updates</strong>
                  <p class="text-xs">Get updates on your applications</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="interviewNotifications" ${settings.interviewNotifications ? 'checked' : ''} />
                <div>
                  <strong>Interview Updates</strong>
                  <p class="text-xs">Get notified about interview schedules</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="placementNotifications" ${settings.placementNotifications ? 'checked' : ''} />
                <div>
                  <strong>Placement Updates</strong>
                  <p class="text-xs">Get notified about placement outcomes</p>
                </div>
              </label>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- PRIVACY SECTION -->
        ${currentRole === 'student' ? `
        <div class="settings-section">
          <h2>Privacy</h2>
          <div class="settings-form privacy-toggles">
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="profileVisibility" ${settings.profileVisibility === 'public' ? 'checked' : ''} />
                <div>
                  <strong>Public Profile</strong>
                  <p class="text-xs">Allow recruiters to view your profile</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="recruiterDiscovery" ${settings.recruiterDiscovery !== false ? 'checked' : ''} />
                <div>
                  <strong>Recruiter Discovery</strong>
                  <p class="text-xs">Allow companies to discover your profile</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="showSkills" ${settings.showSkills !== false ? 'checked' : ''} />
                <div>
                  <strong>Show Skills</strong>
                  <p class="text-xs">Display your skills to recruiters</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="showAcademicInfo" ${settings.showAcademicInfo !== false ? 'checked' : ''} />
                <div>
                  <strong>Show Academic Information</strong>
                  <p class="text-xs">Display CGPA and academic details to recruiters</p>
                </div>
              </label>
            </div>
            <div class="toggle-item">
              <label class="flex-align gap-2">
                <input type="checkbox" data-setting="showContactInfo" ${settings.showContactInfo !== false ? 'checked' : ''} />
                <div>
                  <strong>Show Contact Information</strong>
                  <p class="text-xs">Display email and mobile to recruiters</p>
                </div>
              </label>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- APPEARANCE SECTION -->
        <div class="settings-section">
          <h2>Appearance</h2>
          <div class="settings-form">
            <div class="form-group">
              <label>Theme</label>
              <select id="setting-theme" class="form-control" onchange="applyTheme(this.value)">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>
        </div>

        <!-- ACCOUNT CONTROL SECTION -->
        <div class="settings-section danger-zone">
          <h2>Account Control</h2>
          <div class="settings-form">
            <div class="control-group">
              <h3>Logout</h3>
              <p class="text-xs">Log out of your current session</p>
              <button type="button" class="btn-saas btn-outline" onclick="handleLogout()">Logout</button>
            </div>
            <div class="control-group">
              <h3>Delete Account</h3>
              <p class="text-xs danger-text">This action cannot be undone. All your data will be permanently deleted.</p>
              <button type="button" class="btn-saas btn-danger" onclick="deleteStudentAccount()">Delete Account</button>
            </div>
          </div>
        </div>

        <button type="button" class="btn-saas btn-primary mt-5" onclick="saveAllSettings()">Save All Settings</button>
      </div>
    `;

    // Set theme value
    document.getElementById('setting-theme').value = settings.theme || 'system';
    applyTheme(settings.theme || 'system');

  } catch (e) {
    console.error('Failed to load settings:', e);
    document.getElementById('view-settings').innerHTML = '<div class="saas-card">Unable to load settings. Please try again.</div>';
  }
}

// Save account settings
async function saveAccountSettings() {
  try {
    const accountData = {
      username: document.getElementById('setting-username').value.trim(),
      email: document.getElementById('setting-email').value.trim(),
      mobile: document.getElementById('setting-mobile').value.trim()
    };
    
    if (!accountData.username || !accountData.email) {
      alert('Username and Email are required.');
      return;
    }

    await apiFetch('/student/account', { 
      method: 'PUT', 
      body: JSON.stringify(accountData) 
    });
    alert('Account settings saved successfully.');
  } catch (err) {
    alert(err.message || 'Failed to save account settings.');
  }
}

// Save all settings
async function saveAllSettings() {
  try {
    const settings = { theme: document.getElementById('setting-theme').value };
    
    // Collect all checkbox settings
    document.querySelectorAll('[data-setting]').forEach(input => {
      settings[input.dataset.setting] = input.checked;
    });

    // Save settings
    await apiFetch('/student/settings', { 
      method: 'PUT', 
      body: JSON.stringify(settings) 
    });

    // Save account info
    const accountData = {
      username: document.getElementById('setting-username').value.trim(),
      email: document.getElementById('setting-email').value.trim(),
      mobile: document.getElementById('setting-mobile').value.trim()
    };

    await apiFetch('/student/account', { 
      method: 'PUT', 
      body: JSON.stringify(accountData) 
    });

    applyTheme(settings.theme);
    alert('All settings saved successfully.');
  } catch (err) {
    alert(err.message || 'Failed to save settings.');
  }
}
async function changePassword(event) { event.preventDefault(); try { const data = await apiFetch('/student/change-password', { method: 'PUT', body: JSON.stringify({ currentPassword: document.getElementById('current-password').value, newPassword: document.getElementById('new-password').value, confirmPassword: document.getElementById('confirm-password').value }) }); alert(data.message); event.target.reset(); } catch (err) { alert(err.message); } }
async function deleteStudentAccount() { if (!window.confirm('Delete your account and all associated profile data? This action cannot be undone.')) return; try { await apiFetch('/student/account', { method: 'DELETE' }); alert('Your account and associated data were deleted.'); handleLogout(); } catch (err) { alert(err.message); } }
function applyTheme(theme) { const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme; document.body.dataset.theme = resolved; localStorage.setItem('sb_theme', theme); }

async function loadCollegeDashboard() {
  const overview = document.getElementById('college-overview-cards');
  const deptTable = document.getElementById('college-dept-table');
  const skillDemandList = document.getElementById('college-skill-demand-list');
  const strategyInsights = document.getElementById('college-strategy-insights');

  if (overview) {
    overview.innerHTML = universityAdminMock.overview.map(item => renderMetricCard(item.label, item.value, item.accent)).join('');
  }

  if (deptTable) {
    deptTable.innerHTML = universityAdminMock.departments.map(item => `
      <tr>
        <td style="font-weight:700;">${item.department}</td>
        <td>${item.total}</td>
        <td>${item.placed}</td>
        <td><span class="badge-saas badge-emerald">${item.rate}%</span></td>
      </tr>
    `).join('');
  }

  if (skillDemandList) {
    skillDemandList.innerHTML = universityAdminMock.skillSignals.map(item => `
      <div class="mb-3">
        <div class="flex-between mb-1"><span style="font-weight:700; font-size:0.8rem;">${item.name}</span><span style="font-size:0.75rem; color:var(--text-muted);">${item.demand}% demand</span></div>
        <div style="height:9px; background:rgba(148,163,184,.13); border-radius:999px; overflow:hidden; margin-bottom:0.2rem;">
          <div style="height:100%; width:${item.demand}%; background:linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius:999px;"></div>
        </div>
        <div style="font-size:0.72rem; color:var(--text-muted);">Readiness: <strong>${item.readiness}%</strong></div>
      </div>
    `).join('');
  }

  if (strategyInsights) {
    strategyInsights.innerHTML = universityAdminMock.recommendations.map(item => `
      <div class="saas-card">
        <div class="badge-saas badge-blue mb-2">Action</div>
        <p style="margin:0; line-height:1.6; color:var(--text-secondary);">${item}</p>
      </div>
    `).join('');
  }
}

async function loadCollegeStudentDirectory() {
  const container = document.getElementById('college-students-list');
  if (!container) return;

  const deptFilter = document.getElementById('college-student-dept')?.value || 'all';
  const statusFilter = document.getElementById('college-student-status')?.value || 'all';
  const searchValue = (document.getElementById('college-student-search')?.value || '').trim().toLowerCase();

  const filtered = universityAdminMock.students.filter(student => {
    const matchesDept = deptFilter === 'all' || student.department === deptFilter;
    const matchesStatus = statusFilter === 'all' || student.status === statusFilter;
    const searchText = `${student.name} ${student.department} ${student.id}`.toLowerCase();
    const matchesSearch = !searchValue || searchText.includes(searchValue);
    return matchesDept && matchesStatus && matchesSearch;
  });

  container.innerHTML = filtered.map(student => `
    <div class="saas-card">
      <div class="flex-between mb-2">
        <h4 style="font-weight:700; margin:0;">${student.name}</h4>
        <span class="badge-saas ${student.status === 'Placed' ? 'badge-emerald' : student.status === 'Shortlisted' ? 'badge-blue' : 'badge-purple'}">${student.status}</span>
      </div>
      <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.5rem;">${student.id} • ${student.department}</div>
      <div class="grid-2 gap-2 text-sm">
        <div><strong>CGPA:</strong> ${student.cgpa}</div>
        <div><strong>Track:</strong> ${student.specialization}</div>
      </div>
    </div>
  `).join('') || '<div class="saas-card">No students match the current filters.</div>';

  ['college-student-search', 'college-student-dept', 'college-student-status'].forEach(id => {
    const element = document.getElementById(id);
    if (element && !element.dataset.bound) {
      element.dataset.bound = 'true';
      element.addEventListener('input', loadCollegeStudentDirectory);
      element.addEventListener('change', loadCollegeStudentDirectory);
    }
  });
}

async function loadCollegeSkillMapping() {
  const container = document.getElementById('college-skill-mapping-content');
  if (!container) return;

  container.innerHTML = `
    <div class="grid-2 gap-4">
      ${universityAdminMock.skillMapping.map(item => `
        <div class="saas-card">
          <div class="flex-between mb-2">
            <h3 style="font-weight:800; margin:0;">${item.department}</h3>
            <span class="badge-saas badge-blue">${item.readiness}% readiness</span>
          </div>
          <p style="color: var(--text-muted); margin-bottom: 1rem;">${item.coach}</p>
          <div class="mb-3">
            <div class="flex-between mb-1"><span class="text-xs">Department readiness</span><span class="text-xs">${item.readiness}%</span></div>
            <div style="height: 10px; background: rgba(148,163,184,.13); border-radius: 999px; overflow: hidden;">
              <div style="height:100%; width:${item.readiness}%; background: linear-gradient(90deg, #38bdf8, #2563eb); border-radius:999px;"></div>
            </div>
          </div>
          <div class="mb-2"><strong>Primary gap:</strong> ${item.gap}</div>
          <div><strong>Recommended action:</strong> ${item.action}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadCollegePartnerships() {
  const container = document.getElementById('college-partnerships-content');
  if (!container) return;

  container.innerHTML = `
    <div class="grid-2 gap-4">
      ${universityAdminMock.partnerships.map(item => `
        <div class="saas-card">
          <div class="flex-between mb-3">
            <div>
              <h3 style="font-weight:800; margin:0;">${item.company}</h3>
              <div class="text-xs mt-1" style="color:var(--text-muted);">${item.type}</div>
            </div>
            <span class="badge-saas ${item.status === 'Active' ? 'badge-emerald' : 'badge-orange'}">${item.status}</span>
          </div>
          <div class="grid-2 gap-2 text-sm">
            <div><strong>Engagement:</strong><br>${item.engagement}</div>
            <div><strong>Reach:</strong><br>${item.reach}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadCollegePlacements() {
  const container = document.getElementById('college-placements-content');
  if (!container) return;

  container.innerHTML = `
    <div class="grid-2 gap-4">
      ${universityAdminMock.placements.map(item => `
        <div class="saas-card">
          <div class="flex-between mb-2">
            <h3 style="font-weight:800; margin:0;">${item.company}</h3>
            <span class="badge-saas badge-purple">${item.role}</span>
          </div>
          <div class="grid-3 gap-2 text-sm">
            <div><strong>Offers</strong><br>${item.offers}</div>
            <div><strong>Accepted</strong><br>${item.accepted}</div>
            <div><strong>Avg Package</strong><br>${item.avgPackage}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadCollegeCampusDrives() {
  const container = document.getElementById('college-campus-drives-list');
  if (!container) return;

  container.innerHTML = `
    <div class="grid-2 gap-4">
      ${universityAdminMock.campusDrives.map(item => `
        <div class="saas-card">
          <div class="flex-between mb-2">
            <h3 style="font-weight:800; margin:0;">${item.company}</h3>
            <span class="badge-saas ${item.status === 'Scheduled' ? 'badge-blue' : item.status === 'Confirmed' ? 'badge-emerald' : item.status === 'Shortlisted' ? 'badge-purple' : 'badge-orange'}">${item.status}</span>
          </div>
          <div class="text-sm" style="color: var(--text-muted);">${item.date}</div>
          <div class="mt-2 text-sm"><strong>Department:</strong> ${item.department}</div>
          <div class="mt-1 text-sm"><strong>Mode:</strong> ${item.mode}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadCollegeReports() {
  const container = document.getElementById('college-reports-content');
  if (!container) return;

  container.innerHTML = `
    <div class="grid-3 gap-4">
      ${universityAdminMock.reports.map(item => `
        <div class="saas-card">
          <div class="badge-saas badge-sky mb-2">Report</div>
          <h3 style="font-weight:800; margin-bottom:0.75rem;">${item.title}</h3>
          <p style="color:var(--text-secondary); line-height:1.7; margin:0;">${item.summary}</p>
        </div>
      `).join('')}
    </div>
  `;
}

async function askCollegeAssistant(event) {
  event.preventDefault();
  const input = document.getElementById('college-assistant-input');
  const output = document.getElementById('college-assistant-reply');
  if (!input || !output) return;

  const message = input.value.trim();
  if (!message) {
    output.textContent = 'Ask about placement trends, department gaps, or employer engagement.';
    return;
  }

  const lower = message.toLowerCase();
  let reply = 'Based on current university performance, the strongest placement momentum is in Computer Science and IT, while cloud and AI/ML readiness remain the main skill gaps to address.';

  if (lower.includes('skill') || lower.includes('gap')) {
    reply = 'The biggest skill gaps are in Cloud, AI/ML, and advanced coding readiness for EEE/ECE departments. A targeted upskilling program would improve placement conversion within one semester.';
  } else if (lower.includes('company') || lower.includes('partnership')) {
    reply = 'Current employer partnerships are strongest in software services and campus connect programs. Additional product-company tie-ups would improve final-offer conversion and salary outcomes.';
  } else if (lower.includes('department') || lower.includes('cse') || lower.includes('it')) {
    reply = 'CSE and IT remain highest-performing departments with the strongest placement conversion, while ECE and EEE need more bridge programs for coding and product readiness.';
  } else if (lower.includes('report') || lower.includes('summary')) {
    reply = 'University placement conversion improved by 6.2% this cycle, with the biggest growth in software and analytics roles. The next strategic focus should be cloud and AI/ML readiness.';
  }

  output.textContent = reply;
}

// UNIVERSITY ADMIN DASHBOARD
async function loadUniversityDashboard() {
  const dashboard = document.getElementById('view-university-dashboard');
  if (!dashboard) return;
  
  dashboard.innerHTML = `
    <div class="view-header">
      <h1>University Dashboard</h1>
      <p>University-wide analytics and insights</p>
    </div>
    <div class="dashboard-grid">
      <div class="dashboard-card">
        <h3>Total Students</h3>
        <p class="stat-value">12,450</p>
      </div>
      <div class="dashboard-card">
        <h3>Affiliated Colleges</h3>
        <p class="stat-value">8</p>
      </div>
      <div class="dashboard-card">
        <h3>Placement Rate</h3>
        <p class="stat-value">87%</p>
      </div>
      <div class="dashboard-card">
        <h3>Active Companies</h3>
        <p class="stat-value">125</p>
      </div>
    </div>
    <div class="dashboard-section mt-5">
      <h2>College Performance Comparison</h2>
      <div class="college-comparison-table">
        <table class="saas-table">
          <thead>
            <tr>
              <th>College</th>
              <th>Students</th>
              <th>Placement Rate</th>
              <th>Avg Package</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>College of Engineering</td>
              <td>3,200</td>
              <td>92%</td>
              <td>₹ 7.5 LPA</td>
            </tr>
            <tr>
              <td>Institute of Technology</td>
              <td>2,800</td>
              <td>85%</td>
              <td>₹ 7.2 LPA</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// SUPER ADMIN DASHBOARD
async function loadAdminDashboard() {
  const dashboard = document.getElementById('view-admin-dashboard');
  if (!dashboard) return;
  
  dashboard.innerHTML = `
    <div class="view-header">
      <h1>Platform Admin Dashboard</h1>
      <p>System-wide management and analytics</p>
    </div>
    <div class="dashboard-grid">
      <div class="dashboard-card">
        <h3>Total Users</h3>
        <p class="stat-value">28,500</p>
      </div>
      <div class="dashboard-card">
        <h3>Active Students</h3>
        <p class="stat-value">18,200</p>
      </div>
      <div class="dashboard-card">
        <h3>Companies</h3>
        <p class="stat-value">856</p>
      </div>
      <div class="dashboard-card">
        <h3>Universities</h3>
        <p class="stat-value">42</p>
      </div>
    </div>
    <div class="dashboard-section mt-5">
      <h2>Platform Statistics</h2>
      <div class="stats-grid">
        <div class="stat-box">
          <h4>Job Postings</h4>
          <p class="stat-number">2,345</p>
        </div>
        <div class="stat-box">
          <h4>Placements</h4>
          <p class="stat-number">4,523</p>
        </div>
        <div class="stat-box">
          <h4>Applications</h4>
          <p class="stat-number">15,678</p>
        </div>
        <div class="stat-box">
          <h4>Avg Placement Rate</h4>
          <p class="stat-number">84%</p>
        </div>
      </div>
    </div>
  `;
}

// COMPANY RECRUITER LOADERS
async function loadCompanyATSPipeline() {
  try {
    const data = await apiFetch('/company/dashboard');
    const comp = data.company || {};
    document.getElementById('comp-header').textContent = `${comp.name || 'TechCorp'} ATS Pipeline`;
    document.getElementById('comp-id-badge').textContent = comp.companyId || 'CMP-10001';
    document.getElementById('comp-total-jobs').textContent = data.total_jobs || 0;
    document.getElementById('comp-total-apps').textContent = data.total_applicants || 0;
    document.getElementById('comp-shortlisted').textContent = data.shortlisted || 0;

    const stages = ['Eligible', 'Applied', 'AI Screening', 'Shortlisted', 'Technical Interview', 'HR Interview', 'Selected', 'Rejected'];
    const board = document.getElementById('ats-kanban-board');
    const apps = data.pipeline || [];

    board.innerHTML = stages.map(st => {
      const filtered = apps.filter(a => a.status === st);
      return `
        <div class="pipeline-stage-col">
          <div class="pipeline-stage-header"><span>${st}</span><span class="badge-saas badge-blue">${filtered.length}</span></div>
          ${filtered.map(cand => `
            <div class="candidate-kanban-card">
              <div style="font-weight:700;">${cand.candidate_name || 'Student'}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);" class="mb-2">CGPA: ${cand.cgpa ?? 'Hidden'} • ${cand.job_title || 'Job'}</div>
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
  const container = document.getElementById('view-talent-finder');
  if (!container) return;

  try {
    if (currentRole === 'student') {
      await loadStudentTalentFinder();
    } else if (currentRole === 'company') {
      await loadCompanyTalentFinder();
    }
  } catch (err) {
    console.error('Failed to load Talent Finder:', err);
    if (container) container.innerHTML = `<div class="error-message">${err.message}</div>`;
  }
}

// Student Talent Finder - Show matched jobs
async function loadStudentTalentFinder() {
  try {
    const data = await apiFetch('/api/talent-finder/matched-jobs');
    const container = document.getElementById('view-talent-finder');
    
    if (!container) return;

    const matches = data.matches || [];
    
    container.innerHTML = `
      <div class="talent-finder-container">
        <div class="view-header">
          <h1>Talent Finder - Job Matches</h1>
          <p>We found ${matches.length} job(s) that match your skills and profile</p>
        </div>

        ${matches.length === 0 ? `
          <div class="saas-card">
            <p class="text-center">No matching jobs found. Complete your skills profile to see more opportunities.</p>
          </div>
        ` : `
          <div class="talent-matches-grid">
            ${matches.map((job, idx) => `
              <div class="talent-match-card saas-card">
                <div class="match-header">
                  <h3>${job.title}</h3>
                  <div class="match-score" style="background: ${getMatchScoreColor(job.matchPercentage)}">
                    ${job.matchPercentage}%
                  </div>
                </div>
                <p class="company-name">${job.company}</p>
                <p class="recommendation-level">${job.recommendationLevel}</p>
                <div class="match-details mt-3">
                  <div class="detail-item">
                    <strong class="text-xs">Strengths</strong>
                    <p class="text-xs mt-1">${job.strengths || 'No matches recorded'}</p>
                  </div>
                  <div class="detail-item">
                    <strong class="text-xs">Skill Gaps</strong>
                    <p class="text-xs mt-1">${job.skillGaps || 'No gaps detected'}</p>
                  </div>
                </div>
                <button class="btn-saas btn-primary mt-3" onclick="handleApplyJob(${job.jobId})">Apply Now</button>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  } catch (err) {
    throw new Error('Failed to load matched jobs: ' + err.message);
  }
}

// Company Talent Finder - Show matched candidates for jobs
async function loadCompanyTalentFinder() {
  try {
    // First get company's jobs
    const dashboardData = await apiFetch('/company/dashboard');
    const jobs = dashboardData.jobs || [];
    
    if (jobs.length === 0) {
      const container = document.getElementById('view-talent-finder');
      if (container) {
        container.innerHTML = `
          <div class="view-header">
            <h1>Talent Finder</h1>
            <p>Find qualified candidates for your job positions</p>
          </div>
          <div class="saas-card">
            <p>No jobs posted yet. <a href="#" onclick="navigateTo('create-job')">Create your first job post</a> to find matching candidates.</p>
          </div>
        `;
      }
      return;
    }

    // Create job selector and container for candidates
    const container = document.getElementById('view-talent-finder');
    if (!container) return;

    container.innerHTML = `
      <div class="talent-finder-container">
        <div class="view-header">
          <h1>Talent Finder - Candidate Matching</h1>
          <p>Select a job to view matching candidates</p>
        </div>

        <div class="talent-finder-controls mb-5">
          <select id="company-job-selector" class="form-control" onchange="loadCompanyJobCandidates()">
            <option value="">-- Select a Job --</option>
            ${jobs.map(job => `<option value="${job.id}">${job.title}</option>`).join('')}
          </select>
        </div>

        <div id="talent-candidates-list" class="talent-candidates-container">
          <p class="text-center">Select a job to view matching candidates</p>
        </div>
      </div>
    `;
  } catch (err) {
    throw new Error('Failed to load company talent finder: ' + err.message);
  }
}

// Load candidates for selected company job
async function loadCompanyJobCandidates() {
  const jobId = document.getElementById('company-job-selector')?.value;
  const container = document.getElementById('talent-candidates-list');
  
  if (!jobId || !container) return;

  try {
    const data = await apiFetch(`/api/talent-finder/job/${jobId}/candidates`);
    const candidates = data.candidates || [];

    if (candidates.length === 0) {
      container.innerHTML = '<p class="text-center">No privacy-eligible candidates match this job.</p>';
      return;
    }

    container.innerHTML = `
      <div class="candidates-summary mb-3">
        <p>Found <strong>${candidates.length}</strong> matching candidate(s)</p>
      </div>
      <div class="talent-candidates-grid">
        ${candidates.map(candidate => `
          <div class="talent-candidate-card saas-card">
            <div class="candidate-header">
              <h4>${candidate.name}</h4>
              <div class="match-score" style="background: ${getMatchScoreColor(candidate.matchPercentage)}">
                ${candidate.matchPercentage}%
              </div>
            </div>
            <p class="text-xs">${candidate.studentId}</p>
            ${candidate.department ? `<p class="text-xs">${candidate.department}</p>` : ''}
            ${candidate.cgpa ? `<p class="text-xs">CGPA: ${candidate.cgpa}</p>` : ''}
            <p class="recommendation mt-2">${candidate.recommendationLevel}</p>
            <div class="match-details mt-3">
              ${candidate.strengths ? `
                <div class="detail-item">
                  <strong class="text-xs">Matching Skills</strong>
                  <p class="text-xs mt-1">${candidate.strengths}</p>
                </div>
              ` : ''}
              ${candidate.skillGaps ? `
                <div class="detail-item">
                  <strong class="text-xs">Skill Gaps</strong>
                  <p class="text-xs mt-1">${candidate.skillGaps}</p>
                </div>
              ` : ''}
            </div>
            <button class="btn-saas btn-primary mt-3" onclick="shortlistCandidate('${candidate.studentId}')">Shortlist</button>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="error-message">${err.message}</div>`;
  }
}

// Helper function to get match score color
function getMatchScoreColor(percentage) {
  if (percentage >= 90) return 'linear-gradient(135deg, #34d399 0%, #10b981 100%)'; // Emerald
  if (percentage >= 75) return 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)'; // Blue
  if (percentage >= 60) return 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)'; // Amber
  return 'linear-gradient(135deg, #f87171 0%, #dc2626 100%)'; // Red
}

// Shortlist a candidate
async function shortlistCandidate(studentId) {
  try {
    alert(`Candidate ${studentId} has been added to your shortlist!`);
    // TODO: Implement actual shortlist API endpoint
  } catch (err) {
    alert('Failed to shortlist candidate: ' + err.message);
  }
}

async function loadCompanyJobCandidates_old() { const jobId = document.getElementById('company-job-selector')?.value; if (!jobId) { document.getElementById('talent-candidates-list').innerHTML = '<p>No jobs posted yet.</p>'; return; } try { const data = await apiFetch(`/company/jobs/${jobId}/candidates`); document.getElementById('talent-candidates-list').innerHTML = data.candidates.length ? data.candidates.map(candidate => `<div class="saas-card"><h4>${candidate.name}</h4><div class="text-xs">${candidate.studentId} · CGPA: ${candidate.cgpa ?? 'Hidden'}</div><strong style="color:var(--text-emerald);">${candidate.matchPercentage}% · ${candidate.recommendationLevel}</strong><p class="text-xs mt-2">${candidate.skills.map(skill => `${skill.name} ${skill.scoreOutOfTen}/10`).join(', ') || 'Skills hidden by privacy settings'}</p><p class="text-xs mt-2">${candidate.skillGaps.filter(item => item.result === 'Gap').map(item => `Gap: ${item.skill}`).join(', ') || 'All listed requirements matched'}</p></div>`).join('') : '<p>No privacy-eligible candidates available.</p>'; } catch (err) { document.getElementById('talent-candidates-list').textContent = err.message; } }
async function askCompanyAssistant(event) { event.preventDefault(); try { const data = await apiFetch('/company/assistant', { method: 'POST', body: JSON.stringify({ message: document.getElementById('company-assistant-input').value }) }); document.getElementById('company-assistant-reply').textContent = data.reply; } catch (err) { document.getElementById('company-assistant-reply').textContent = err.message; } }
async function askCompanyAssistantFromDashboard(event) { event.preventDefault(); try { const data = await apiFetch('/company/assistant', { method: 'POST', body: JSON.stringify({ message: document.getElementById('company-dashboard-assistant-input').value }) }); document.getElementById('company-dashboard-assistant-reply').textContent = data.reply; } catch (err) { document.getElementById('company-dashboard-assistant-reply').textContent = err.message; } }

const universityAdminMock = {
  overview: [
    { label: 'Total Students', value: '12,480', accent: 'blue' },
    { label: 'Placed Students', value: '9,430', accent: 'emerald' },
    { label: 'Placement Rate', value: '75.6%', accent: 'purple' },
    { label: 'Active Recruiters', value: '188', accent: 'orange' }
  ],
  departments: [
    { department: 'Computer Science & Engineering', total: 1480, placed: 1165, rate: 78.7 },
    { department: 'Information Technology', total: 860, placed: 664, rate: 77.2 },
    { department: 'Electronics & Communication', total: 930, placed: 680, rate: 73.1 },
    { department: 'Electrical & Electronics', total: 740, placed: 520, rate: 70.3 }
  ],
  skillSignals: [
    { name: 'Python', demand: 91, readiness: 84 },
    { name: 'React', demand: 88, readiness: 80 },
    { name: 'SQL', demand: 84, readiness: 78 },
    { name: 'Cloud', demand: 79, readiness: 68 }
  ],
  recommendations: [
    'Introduce a Python + Data Analytics bootcamp to improve interview readiness for analytics tracks.',
    'Increase AI/ML lab hours and mock technical rounds to reduce the current skill gap in cloud and data roles.',
    'Strengthen employer partnerships with 3 more product-based companies to raise final-placement conversion.'
  ],
  students: [
    { id: 'STU-2026-101', name: 'Aarav Nair', department: 'Computer Science & Engineering', status: 'Placed', cgpa: 9.4, specialization: 'Full Stack' },
    { id: 'STU-2026-145', name: 'Meera Iyer', department: 'Information Technology', status: 'Shortlisted', cgpa: 9.1, specialization: 'Data Analytics' },
    { id: 'STU-2026-187', name: 'Karthik Raman', department: 'Electronics & Communication', status: 'Available', cgpa: 8.7, specialization: 'Embedded Systems' },
    { id: 'STU-2026-219', name: 'Nisha Patel', department: 'Computer Science & Engineering', status: 'Placed', cgpa: 9.2, specialization: 'Frontend Engineering' },
    { id: 'STU-2026-233', name: 'Rohit Shah', department: 'Electrical & Electronics', status: 'Shortlisted', cgpa: 8.9, specialization: 'Power Systems' },
    { id: 'STU-2026-250', name: 'Vikram S', department: 'Information Technology', status: 'Available', cgpa: 8.6, specialization: 'Cybersecurity' }
  ],
  skillMapping: [
    { department: 'CSE', readiness: 86, gap: 'AI/ML', action: 'Expand advanced ML labs and internship-linked projects.', coach: 'Strong in full-stack and problem solving.' },
    { department: 'IT', readiness: 81, gap: 'Cloud', action: 'Add AWS/GCP certification pathways and mock cloud labs.', coach: 'Solid analytics and database exposure.' },
    { department: 'ECE', readiness: 74, gap: 'Embedded + IoT', action: 'Create focused product incubator sessions for IoT roles.', coach: 'Good hardware fundamentals but needs product demos.' },
    { department: 'EEE', readiness: 69, gap: 'Core Software', action: 'Support coding workshops and Python bridge training.', coach: 'High aptitude but low programming breadth.' }
  ],
  partnerships: [
    { company: 'Microsoft', type: 'Mentorship + Hackathons', status: 'Active', engagement: '28 sessions', reach: '340 students' },
    { company: 'Infosys', type: 'Campus Connect', status: 'Active', engagement: '6 drives', reach: '1,200 students' },
    { company: 'Tata Consultancy Services', type: 'Skill Bootcamp', status: 'In Review', engagement: '3 tracks', reach: '470 students' },
    { company: 'Zoho', type: 'Product Internship Collaboration', status: 'Active', engagement: '2 cohorts', reach: '140 students' }
  ],
  placements: [
    { company: 'Infosys', role: 'Software Engineer', offers: 180, accepted: 144, avgPackage: '₹7.8 LPA' },
    { company: 'Wipro', role: 'Project Engineer', offers: 120, accepted: 98, avgPackage: '₹6.9 LPA' },
    { company: 'Amazon', role: 'SDE Intern', offers: 44, accepted: 29, avgPackage: '₹18.4 LPA' },
    { company: 'Accenture', role: 'Associate Analyst', offers: 96, accepted: 80, avgPackage: '₹5.2 LPA' }
  ],
  campusDrives: [
    { company: 'Google', date: '12 Sep 2026', department: 'CSE / IT', mode: 'Hybrid', status: 'Scheduled' },
    { company: 'Cognizant', date: '18 Sep 2026', department: 'ECE / EEE', mode: 'On Campus', status: 'Confirmed' },
    { company: 'Zeta', date: '27 Sep 2026', department: 'CSE', mode: 'Virtual', status: 'Shortlisted' },
    { company: 'HashedIn', date: '02 Oct 2026', department: 'All tech departments', mode: 'On Campus', status: 'Proposed' }
  ],
  reports: [
    { title: 'Annual Placement Summary', summary: 'Placement conversion improved by 6.2% over the previous academic year, with highest growth in frontend and analytics tracks.' },
    { title: 'Skill Gap Analysis', summary: 'Highest gap remains in cloud deployment, AI/ML product readiness, and structured communication for core engineering departments.' },
    { title: 'Employer Pulse Report', summary: 'Companies ranked communication, project depth, and certification proof as the biggest differentiators in shortlist decisions.' }
  ]
};

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

function renderCompanyDashboard() {
  const overview = companyAIService.getOverview();
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
  const completionEl = document.getElementById('company-profile-completion');
  if (completionEl) completionEl.textContent = `Profile Completion: ${completion}%`;
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

// CAMPUS DRIVES & APPLICATIONS
async function loadApplicationsView() {
  try {
    const apps = await apiFetch('/student/applications');
    const container = document.getElementById('view-applications');
    
    container.innerHTML = `
      <div class="view-header">
        <h1>My Applications</h1>
        <p>Track the status of all your job applications</p>
      </div>

      ${apps.length === 0 ? `
        <div class="saas-card">
          <p class="text-center">No applications yet. <a href="#" onclick="navigateTo('campus-drives')">Apply for campus drives</a> or explore <a href="#" onclick="navigateTo('talent-finder')">job opportunities</a>.</p>
        </div>
      ` : `
        <div class="applications-list">
          ${apps.map(app => `
            <div class="saas-card mb-3 application-card">
              <div class="flex-between">
                <div>
                  <h3>${app.company}</h3>
                  <p>${app.role}</p>
                  <p class="text-xs" style="color:var(--text-muted);">Applied: ${new Date(app.appliedDate).toLocaleDateString()}</p>
                </div>
                <div class="text-right">
                  <div class="match-score" style="background: ${getMatchScoreColor(app.matchScore)}">
                    ${Math.round(app.matchScore)}%
                  </div>
                  <span class="badge-saas badge-blue mt-2">${app.status}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  } catch (e) {
    console.error('Failed to load applications:', e);
  }
}

// UTILS
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function openLogoutModal() { handleLogout(); }
function handleLogout() { authToken = null; currentUser = null; currentProfile = null; localStorage.removeItem('sb_token'); showGuestLanding(); }
function closeMobileDrawer() { const sidebar = document.getElementById('app-sidebar'); if (sidebar) sidebar.classList.remove('mobile-open'); }
function toggleMobileDrawer() { const sidebar = document.getElementById('app-sidebar'); if (sidebar) sidebar.classList.toggle('mobile-open'); }
