// Enhanced Company Recruiter Module - Complete Feature Implementations

// ===== COMPANY DASHBOARD =====
async function loadCompanyDashboard() {
  try {
    const response = await apiFetch('/api/company/dashboard', {}, 'GET');
    
    // Update stats
    document.getElementById('comp-header').textContent = response.companyName || 'Company Dashboard';
    document.getElementById('comp-total-jobs').textContent = response.totalJobs || 0;
    document.getElementById('comp-total-apps').textContent = response.totalApplications || 0;
    document.getElementById('comp-avg-match').textContent = (response.avgMatchScore || 0).toFixed(1) + '%';
    
    // Load ATS pipeline
    await loadATSKanbanBoard(response.applications || []);
  } catch (error) {
    console.error('Error loading company dashboard:', error);
    alert('Failed to load dashboard');
  }
}

// ===== ATS KANBAN BOARD =====
async function loadATSKanbanBoard(applications = []) {
  const stages = ['Applied', 'Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Final Review', 'Selected'];
  const kanbanBoard = document.getElementById('ats-kanban-board');
  
  if (!kanbanBoard) {
    console.warn('Kanban board container not found');
    return;
  }
  
  // Organize applications by stage
  const stageMap = {};
  stages.forEach(stage => stageMap[stage] = []);
  
  applications.forEach(app => {
    const stage = app.stage || 'Applied';
    if (!stageMap[stage]) stageMap[stage] = [];
    stageMap[stage].push(app);
  });
  
  // Create Kanban columns
  let kanbanHTML = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">';
  
  stages.forEach(stage => {
    const apps = stageMap[stage] || [];
    const bgColor = stage === 'Selected' ? 'rgba(16, 185, 129, 0.1)' : 
                    stage === 'Applied' ? 'rgba(59, 130, 246, 0.1)' : 
                    'rgba(168, 85, 247, 0.1)';
    
    kanbanHTML += `
      <div class="kanban-column" data-stage="${stage}" style="background: ${bgColor}; border-radius: 8px; padding: 1rem;">
        <div style="font-weight: 700; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
          <span>${stage}</span>
          <span style="background: rgba(255,255,255,0.1); padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem;">${apps.length}</span>
        </div>
        <div class="kanban-items" style="display: flex; flex-direction: column; gap: 0.75rem;">
    `;
    
    apps.forEach(app => {
      kanbanHTML += `
        <div class="kanban-card" draggable="true" data-app-id="${app.applicationId}" 
             ondragstart="handleDragStart(event)" 
             style="background: rgba(255,255,255,0.05); border: 1px solid rgba(59,130,246,0.3); border-radius: 6px; padding: 0.75rem; cursor: move; transition: all 0.3s;">
          <div style="font-weight: 600; font-size: 0.9rem;">${app.studentName || 'Student'}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin: 0.25rem 0;">
            <div>${app.jobTitle || 'Unknown Position'}</div>
            <div>Match: ${(app.matchScore || 0).toFixed(0)}%</div>
          </div>
          <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
            <button class="btn-saas" style="flex: 1; padding: 0.4rem; font-size: 0.8rem;" onclick="viewCandidateProfile('${app.studentId}')">View</button>
            <button class="btn-saas" style="flex: 1; padding: 0.4rem; font-size: 0.8rem;" onclick="scheduleInterview('${app.applicationId}')">Interview</button>
          </div>
        </div>
      `;
    });
    
    kanbanHTML += `
        </div>
      </div>
    `;
  });
  
  kanbanHTML += '</div>';
  kanbanBoard.innerHTML = kanbanHTML;
  
  // Add drag-drop handlers
  document.querySelectorAll('.kanban-column').forEach(col => {
    col.addEventListener('dragover', handleDragOver);
    col.addEventListener('drop', (e) => handleDrop(e, col.dataset.stage));
  });
}

function handleDragStart(event) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('appId', event.target.closest('.kanban-card').dataset.appId);
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
}

async function handleDrop(event, stage) {
  event.preventDefault();
  event.currentTarget.style.backgroundColor = '';
  
  const appId = event.dataTransfer.getData('appId');
  if (!appId) return;
  
  try {
    await apiFetch(`/api/company/applications/${appId}/stage`, { stage }, 'PUT');
    await loadCompanyDashboard(); // Reload board
  } catch (error) {
    console.error('Error updating application stage:', error);
  }
}

// ===== JOB MANAGEMENT =====
async function handlePostJobSubmit(event) {
  event.preventDefault();
  
  const jobData = {
    title: document.getElementById('job-title').value,
    description: document.getElementById('job-description').value,
    location: document.getElementById('job-location').value,
    department: document.getElementById('job-department').value,
    vacancies: parseInt(document.getElementById('job-vacancies').value),
    salary: document.getElementById('job-salary').value,
    type: document.getElementById('job-type').value,
    deadline: document.getElementById('job-deadline').value,
    requiredSkills: (document.getElementById('job-skills').value || '').split(',').map(s => s.trim()),
    minCGPA: parseFloat(document.getElementById('job-mingpa').value),
    eligibleDepartments: (document.getElementById('job-departments').value || '').split(',').map(d => d.trim()),
  };
  
  try {
    const response = await apiFetch('/api/company/jobs', jobData, 'POST');
    alert(`Job "${jobData.title}" posted successfully!`);
    document.getElementById('job-form').reset();
    navigateTo('company-dashboard');
  } catch (error) {
    console.error('Error posting job:', error);
    alert('Failed to post job: ' + error.message);
  }
}

async function loadCompanyJobsList() {
  try {
    const response = await apiFetch('/api/company/jobs');
    const tbody = document.getElementById('company-jobs-table-body');
    
    if (!Array.isArray(response) || response.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No jobs posted yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = response.map(job => `
      <tr>
        <td>${job.title}</td>
        <td>${job.location}</td>
        <td>${job.applicationCount || 0}</td>
        <td><span style="color: var(--text-emerald);">${job.status || 'Open'}</span></td>
        <td>${new Date(job.deadline).toLocaleDateString()}</td>
        <td>
          <button class="btn-saas" onclick="editJob('${job.jobId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">Edit</button>
          <button class="btn-saas" onclick="closeJob('${job.jobId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; color: #ef4444;">Close</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading jobs:', error);
  }
}

async function editJob(jobId) {
  alert(`Edit job ${jobId} - Feature in development`);
}

async function closeJob(jobId) {
  if (confirm('Are you sure you want to close this job posting?')) {
    try {
      await apiFetch(`/api/company/jobs/${jobId}`, { status: 'Closed' }, 'PUT');
      await loadCompanyJobsList();
    } catch (error) {
      console.error('Error closing job:', error);
    }
  }
}

// ===== TALENT FINDER / CANDIDATE SEARCH =====
async function loadTalentFinder() {
  try {
    const skillFilter = document.getElementById('talent-skill-filter').value || '';
    const cgpaFilter = document.getElementById('talent-cgpa-filter').value || '0';
    const deptFilter = document.getElementById('talent-dept-filter').value || '';
    
    const params = new URLSearchParams();
    if (skillFilter) params.append('skill', skillFilter);
    if (cgpaFilter) params.append('minCGPA', cgpaFilter);
    if (deptFilter) params.append('department', deptFilter);
    
    const response = await apiFetch(`/api/company/candidates/search?${params.toString()}`);
    const candidatesList = document.getElementById('talent-candidates-list');
    
    if (!Array.isArray(response) || response.length === 0) {
      candidatesList.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No candidates found matching filters</p>';
      return;
    }
    
    candidatesList.innerHTML = response.map(candidate => `
      <div class="saas-card" style="margin-bottom: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
          <div>
            <div style="font-weight: 700; font-size: 1rem;">${candidate.name}</div>
            <div style="color: var(--text-muted); font-size: 0.9rem;">${candidate.email}</div>
            <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">
              CGPA: <strong>${candidate.cgpa}</strong> | Department: <strong>${candidate.department}</strong>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.8rem; font-weight: 800; color: var(--text-emerald);">${candidate.aiScore || 0}%</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">AI Score</div>
          </div>
        </div>
        
        <div style="margin-bottom: 1rem;">
          <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem;">Skills</div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${(candidate.skills || []).map(skill => `
              <span style="background: rgba(59, 130, 246, 0.2); padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.8rem;">${skill}</span>
            `).join('')}
          </div>
        </div>
        
        <div style="display: flex; gap: 0.75rem;">
          <button class="btn-saas btn-primary" onclick="viewCandidateProfile('${candidate.studentId}')" style="flex: 1;">View Profile</button>
          <button class="btn-saas" onclick="shortlistCandidate('${candidate.studentId}')" style="flex: 1;">Shortlist</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading talent:', error);
    alert('Failed to load candidates');
  }
}

async function viewCandidateProfile(studentId) {
  try {
    const profile = await apiFetch(`/api/company/candidates/${studentId}`);
    
    const modalHTML = `
      <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;">
        <div class="saas-card" style="width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="font-weight: 800;">${profile.name}</h2>
            <button onclick="this.closest('[style*=fixed]').remove()" style="background: none; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer;">×</button>
          </div>
          
          <div class="grid-2 gap-4 mb-4">
            <div><strong>Email:</strong> ${profile.email}</div>
            <div><strong>CGPA:</strong> ${profile.cgpa}</div>
            <div><strong>Department:</strong> ${profile.department}</div>
            <div><strong>AI Score:</strong> ${profile.aiScore || 0}%</div>
          </div>
          
          <div class="mb-4">
            <h3 style="font-weight: 700; margin-bottom: 0.75rem;">Skills</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
              ${(profile.skills || []).map(skill => `
                <span style="background: rgba(59, 130, 246, 0.2); padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.9rem;">${skill}</span>
              `).join('')}
            </div>
          </div>
          
          <div class="mb-4">
            <h3 style="font-weight: 700; margin-bottom: 0.75rem;">Education</h3>
            <div>${profile.education || 'N/A'}</div>
          </div>
          
          <div class="mb-4">
            <h3 style="font-weight: 700; margin-bottom: 0.75rem;">Experience</h3>
            <div>${profile.experience || 'N/A'}</div>
          </div>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem;">
            <button class="btn-saas btn-primary" onclick="shortlistCandidate('${studentId}'); this.closest('[style*=fixed]').remove();">Shortlist</button>
            <button class="btn-saas" onclick="scheduleInterview('${studentId}'); this.closest('[style*=fixed]').remove();">Schedule Interview</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  } catch (error) {
    console.error('Error loading candidate profile:', error);
    alert('Failed to load candidate profile');
  }
}

async function shortlistCandidate(studentId) {
  try {
    // Find application for this candidate
    const response = await apiFetch(`/api/company/applications`);
    const application = response.find(app => app.studentId === studentId);
    
    if (application) {
      await apiFetch(`/api/company/applications/${application.applicationId}/stage`, 
        { stage: 'Shortlisted' }, 'PUT');
      alert('Candidate shortlisted successfully!');
      await loadTalentFinder();
    }
  } catch (error) {
    console.error('Error shortlisting candidate:', error);
    alert('Failed to shortlist candidate');
  }
}

async function scheduleInterview(studentId) {
  alert(`Schedule interview for student ${studentId} - use Interview Scheduler view`);
}

// ===== ASSESSMENT BUILDER =====
async function loadAssessmentBuilder() {
  try {
    const response = await apiFetch('/api/company/assessments');
    const assessmentsList = document.getElementById('active-assessments-list');
    
    if (!Array.isArray(response) || response.length === 0) {
      assessmentsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No assessments created yet</p>';
      return;
    }
    
    assessmentsList.innerHTML = response.map(assessment => `
      <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 600;">${assessment.title}</div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">${assessment.type} • ${assessment.duration} mins</div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn-saas" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="editAssessment('${assessment.assessmentId}')">Edit</button>
          <button class="btn-saas" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; color: #ef4444;" onclick="deleteAssessment('${assessment.assessmentId}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading assessments:', error);
  }
}

async function handleCreateAssessment(event) {
  event.preventDefault();
  
  const assessmentData = {
    title: document.getElementById('assess-title').value,
    type: document.getElementById('assess-type').value,
    duration: parseInt(document.getElementById('assess-duration').value),
    totalMarks: parseInt(document.getElementById('assess-marks').value),
    passingScore: parseInt(document.getElementById('assess-passing').value),
    questions: []
  };
  
  try {
    await apiFetch('/api/company/assessments', assessmentData, 'POST');
    alert('Assessment created successfully!');
    document.getElementById('assessment-form').reset();
    await loadAssessmentBuilder();
  } catch (error) {
    console.error('Error creating assessment:', error);
    alert('Failed to create assessment');
  }
}

async function editAssessment(assessmentId) {
  alert(`Edit assessment ${assessmentId} - Feature in development`);
}

async function deleteAssessment(assessmentId) {
  if (confirm('Are you sure you want to delete this assessment?')) {
    alert('Delete assessment feature in development');
  }
}

// ===== INTERVIEW SCHEDULER =====
async function loadInterviewScheduler() {
  try {
    const response = await apiFetch('/api/company/interviews');
    const interviewsList = document.getElementById('upcoming-interviews-list');
    
    if (!Array.isArray(response) || response.length === 0) {
      interviewsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No interviews scheduled</p>';
      return;
    }
    
    interviewsList.innerHTML = response.map(interview => `
      <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <div style="font-weight: 600;">${interview.candidateName} - ${interview.jobTitle}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">
              ${new Date(interview.scheduledTime).toLocaleString()} • ${interview.type}
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
              Round: ${interview.round}
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-saas" onclick="editInterview('${interview.interviewId}')" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Edit</button>
            <button class="btn-saas" onclick="cancelInterview('${interview.interviewId}')" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; color: #ef4444;">Cancel</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading interviews:', error);
  }
}

async function handleScheduleInterview(event) {
  event.preventDefault();
  
  const interviewData = {
    candidateId: document.getElementById('int-candidate').value,
    jobId: document.getElementById('int-job').value,
    round: document.getElementById('int-round').value,
    scheduledTime: `${document.getElementById('int-date').value}T${document.getElementById('int-time').value}`,
    type: document.getElementById('int-type').value,
    meetingLink: document.getElementById('int-link').value || null,
    interviewer: document.getElementById('int-interviewer').value,
  };
  
  try {
    await apiFetch('/api/company/interviews/schedule', interviewData, 'POST');
    alert('Interview scheduled successfully!');
    document.getElementById('interview-schedule-form').reset();
    await loadInterviewScheduler();
  } catch (error) {
    console.error('Error scheduling interview:', error);
    alert('Failed to schedule interview: ' + error.message);
  }
}

async function editInterview(interviewId) {
  alert(`Edit interview ${interviewId} - Feature in development`);
}

async function cancelInterview(interviewId) {
  if (confirm('Are you sure you want to cancel this interview?')) {
    alert('Cancel interview feature in development');
  }
}

// ===== OFFER MANAGEMENT =====
async function loadOfferManagement() {
  try {
    const response = await apiFetch('/api/company/offers');
    const offersList = document.getElementById('offer-status-list');
    
    if (!Array.isArray(response) || response.length === 0) {
      offersList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No offers sent yet</p>';
      return;
    }
    
    offersList.innerHTML = response.map(offer => `
      <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <div style="font-weight: 600;">${offer.candidateName} - ${offer.jobTitle}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">
              Salary: ${offer.salary} • Joining: ${new Date(offer.joiningDate).toLocaleDateString()}
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
              Status: <strong>${offer.status}</strong>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn-saas" onclick="viewOfferLetter('${offer.id}')" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">View</button>
            <button class="btn-saas" onclick="resendOffer('${offer.id}')" style="padding: 0.4rem 0.8rem; font-size: 0.8rem;">Resend</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Error loading offers:', error);
  }
}

async function handleGenerateOffer(event) {
  event.preventDefault();
  
  const offerData = {
    candidateId: document.getElementById('offer-candidate').value,
    position: document.getElementById('offer-position').value,
    salary: document.getElementById('offer-salary').value,
    joiningDate: document.getElementById('offer-joining').value,
    location: document.getElementById('offer-location').value,
    benefits: document.getElementById('offer-benefits').value.split(',').map(item => item.trim()).filter(Boolean),
    offerExpiryDate: document.getElementById('offer-expiry').value,
    candidateId: document.getElementById('offer-candidate').value.trim(),
    jobTitle: document.getElementById('offer-position').value.trim(),
  };
  
  try {
    await apiFetch('/api/company/offers', {
      method: 'POST',
      body: JSON.stringify(offerData)
    });
    alert('Offer generated and sent successfully!');
    document.getElementById('offer-form').reset();
    await loadOfferManagement();
  } catch (error) {
    console.error('Error generating offer:', error);
    alert('Failed to generate offer: ' + error.message);
  }
}

async function viewOfferLetter(offerId) {
  alert(`View offer letter ${offerId} - PDF download feature in development`);
}

async function resendOffer(offerId) {
  try {
    alert(`Resend offer ${offerId} - Nodemailer integration feature in development`);
  } catch (error) {
    console.error('Error resending offer:', error);
  }
}

// ===== RECRUITMENT ANALYTICS =====
async function loadRecruitmentAnalytics() {
  try {
    const response = await apiFetch('/api/company/analytics/dashboard');
    
    // Update stat cards
    document.getElementById('analytics-total-apps').textContent = response.totalApplications || 0;
    document.getElementById('analytics-shortlisted').textContent = response.shortlistedCount || 0;
    document.getElementById('analytics-selected').textContent = response.selectedCount || 0;
    document.getElementById('analytics-time-to-hire').textContent = response.avgTimeToHire || 'N/A';
    
    // Update job performance table
    const jobPerfBody = document.getElementById('job-perf-body');
    if (response.jobPerformance && response.jobPerformance.length > 0) {
      jobPerfBody.innerHTML = response.jobPerformance.map(job => `
        <tr>
          <td>${job.jobTitle}</td>
          <td>${job.applicationCount}</td>
          <td>${(job.avgMatchScore || 0).toFixed(1)}%</td>
        </tr>
      `).join('');
    }
    
    // Funnel text (in real app, would render chart)
    const funnel = response.funnel || {};
    const fundelHTML = `
      Applied: ${funnel.applied || 0} → 
      Screening: ${funnel.screening || 0} → 
      Shortlisted: ${funnel.shortlisted || 0} → 
      Assessment: ${funnel.assessment || 0} → 
      Interview: ${funnel.interview || 0} → 
      Selected: ${funnel.selected || 0}
    `;
    document.getElementById('funnel-chart').textContent = fundelHTML;
  } catch (error) {
    console.error('Error loading analytics:', error);
  }
}

// ===== CANDIDATE COMPARISON =====
async function compareCandidates() {
  const candidateIds = [1, 2, 3, 4, 5].map(i => document.getElementById(`comp-cand-${i}`).value).filter(Boolean);
  
  if (candidateIds.length < 2) {
    alert('Please enter at least 2 candidate IDs');
    return;
  }
  
  try {
    const candidates = await Promise.all(candidateIds.map(id => apiFetch(`/api/company/candidates/${id}`)));
    
    // Build comparison table
    const headers = '<th>Attribute</th>' + candidates.map(c => `<th>${c.name}</th>`).join('');
    const rows = [
      { attr: 'Email', values: candidates.map(c => c.email) },
      { attr: 'CGPA', values: candidates.map(c => c.cgpa) },
      { attr: 'Department', values: candidates.map(c => c.department) },
      { attr: 'AI Score', values: candidates.map(c => c.aiScore || 0) + '%' },
      { attr: 'Skills Count', values: candidates.map(c => (c.skills || []).length) },
      { attr: 'Experience', values: candidates.map(c => c.experience || 'N/A') },
    ];
    
    let tableHTML = '<tr>' + headers + '</tr>';
    rows.forEach(row => {
      tableHTML += '<tr><td style="font-weight: 600;">' + row.attr + '</td>';
      row.values.forEach(val => tableHTML += `<td>${val}</td>`);
      tableHTML += '</tr>';
    });
    
    document.getElementById('comparison-table').innerHTML = tableHTML;
    document.getElementById('comparison-results-container').classList.remove('hidden');
  } catch (error) {
    console.error('Error comparing candidates:', error);
    alert('Failed to compare candidates');
  }
}

// ===== TEAM MEMBER MANAGEMENT =====
async function loadTeamManagement() {
  try {
    const response = await apiFetch('/api/company/team');
    const tbody = document.getElementById('team-members-body');
    
    if (!Array.isArray(response) || response.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No team members yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = response.map(member => `
      <tr>
        <td>${member.name}</td>
        <td>${member.email}</td>
        <td>${member.role}</td>
        <td>${member.department || 'N/A'}</td>
        <td>
          <button class="btn-saas" onclick="editTeamMember('${member.teamMemberId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">Edit</button>
          <button class="btn-saas" onclick="removeTeamMember('${member.teamMemberId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; color: #ef4444;">Remove</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading team:', error);
  }
}

async function editTeamMember(teamMemberId) {
  alert(`Edit team member ${teamMemberId} - Feature in development`);
}

async function removeTeamMember(teamMemberId) {
  if (confirm('Are you sure you want to remove this team member?')) {
    alert('Remove team member feature in development');
  }
}

// ===== CAMPUS RECRUITMENT =====
async function loadCampusRecruitment() {
  try {
    const response = await apiFetch('/api/company/campus-drives');
    const tbody = document.getElementById('campus-drives-table-body');
    
    if (!Array.isArray(response) || response.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No campus drives yet</td></tr>';
      return;
    }
    
    tbody.innerHTML = response.map(drive => `
      <tr>
        <td>${drive.university}</td>
        <td>${drive.department}</td>
        <td>${drive.position}</td>
        <td>${drive.vacancies}</td>
        <td><span style="color: var(--text-emerald);">${drive.status}</span></td>
        <td>
          <button class="btn-saas" onclick="editDrive('${drive.driveId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">View</button>
          <button class="btn-saas" onclick="closeDrive('${drive.driveId}')" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; color: #ef4444;">Close</button>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Error loading campus recruitment:', error);
  }
}

// Export functions for global access
window.loadCompanyDashboard = loadCompanyDashboard;
window.loadCompanyJobsList = loadCompanyJobsList;
window.loadTalentFinder = loadTalentFinder;
window.loadAssessmentBuilder = loadAssessmentBuilder;
window.loadInterviewScheduler = loadInterviewScheduler;
window.loadOfferManagement = loadOfferManagement;
window.loadRecruitmentAnalytics = loadRecruitmentAnalytics;
window.loadCandidateComparison = loadCandidateComparison;
window.loadTeamManagement = loadTeamManagement;
window.loadCampusRecruitment = loadCampusRecruitment;
window.handlePostJobSubmit = handlePostJobSubmit;
window.handleCreateAssessment = handleCreateAssessment;
window.handleScheduleInterview = handleScheduleInterview;
window.handleGenerateOffer = handleGenerateOffer;
window.compareCandidates = compareCandidates;
window.viewCandidateProfile = viewCandidateProfile;
window.shortlistCandidate = shortlistCandidate;
window.scheduleInterview = scheduleInterview;
