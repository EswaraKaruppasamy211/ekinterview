/* ============================================================================
   SkillBridge Company Recruiter Module — Frontend Extension
   Complete UI Screens & Functionality
   ============================================================================ */

// Initialize company module
async function initializeCompanyModule() {
  // Load and display company dashboard
  loadCompanyDashboard();
  // Setup event listeners
  setupCompanyEventListeners();
}

// COMPANY DASHBOARD
async function loadCompanyDashboard() {
  try {
    const data = await apiFetch('/company/dashboard');
    const { company, jobs, total_jobs, total_applicants, shortlisted, pipeline } = data;
    
    // Update header
    document.getElementById('comp-header').textContent = `${company.name} Recruiter Portal 👋`;
    document.getElementById('comp-id-badge').textContent = company.companyId;
    
    // Update stats
    document.getElementById('comp-total-jobs').textContent = total_jobs || '0';
    document.getElementById('comp-total-apps').textContent = total_applicants || '0';
    document.getElementById('comp-shortlisted').textContent = shortlisted || '0';
    
    // Load ATS Kanban board
    loadATSKanbanBoard(pipeline);
  } catch (error) {
    console.error('Failed to load company dashboard:', error);
  }
}

// ATS KANBAN BOARD
async function loadATSKanbanBoard(applications) {
  const stages = ['Applied', 'Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Final Review', 'Selected'];
  const kanbanBoard = document.getElementById('ats-kanban-board');
  kanbanBoard.innerHTML = '';
  
  const stageMap = {};
  stages.forEach(stage => {
    stageMap[stage] = [];
  });
  
  // Organize applications by stage
  (applications || []).forEach(app => {
    const stage = app.status || 'Applied';
    if (stageMap[stage]) {
      stageMap[stage].push(app);
    }
  });
  
  // Render Kanban columns
  stages.forEach(stage => {
    const column = document.createElement('div');
    column.className = 'kanban-column';
    column.style.cssText = 'flex: 1; min-width: 200px; background: rgba(30, 41, 59, 0.5); border-radius: 12px; padding: 1rem; border: 1px solid rgba(56, 189, 248, 0.2); max-height: 500px; overflow-y: auto;';
    
    const header = document.createElement('div');
    header.className = 'kanban-header';
    header.style.cssText = 'font-weight: 700; font-size: 0.85rem; margin-bottom: 1rem; color: var(--text-blue);';
    header.innerHTML = `${stage} <span style="background: rgba(56, 189, 248, 0.2); color: var(--text-blue); padding: 0.2rem 0.6rem; border-radius: 4px; margin-left: 0.5rem;">${stageMap[stage].length}</span>`;
    
    column.appendChild(header);
    
    // Add candidate cards
    stageMap[stage].forEach(app => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.style.cssText = 'background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem; cursor: grab; transition: all 0.2s;';
      card.draggable = true;
      
      card.innerHTML = `
        <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 0.3rem;">${app.candidate_name || 'Candidate'}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">${app.job_title || 'Job'}</div>
        <div style="font-size: 0.8rem; color: var(--text-blue); font-weight: 600;">Match: ${app.match_percentage || 0}%</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.3rem;">Applied: ${app.applied_at || 'N/A'}</div>
      `;
      
      // Add drag event listeners
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('applicationId', app.id);
        e.dataTransfer.setData('sourceStage', stage);
      });
      
      column.appendChild(card);
    });
    
    // Add drop zone
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      column.style.background = 'rgba(56, 189, 248, 0.15)';
    });
    
    column.addEventListener('dragleave', () => {
      column.style.background = 'rgba(30, 41, 59, 0.5)';
    });
    
    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.style.background = 'rgba(30, 41, 59, 0.5)';
      const appId = e.dataTransfer.getData('applicationId');
      
      // Move application to new stage
      try {
        const response = await apiFetch(`/company/applications/${appId}/stage`, {
          method: 'PUT',
          body: JSON.stringify({ stage })
        });
        
        if (response.success) {
          // Reload dashboard
          loadCompanyDashboard();
        }
      } catch (error) {
        console.error('Failed to move application:', error);
      }
    });
    
    kanbanBoard.appendChild(column);
  });
}

// POST JOB
async function legacyHandlePostJobSubmit(e) {
  e.preventDefault();
  
  const jobData = {
    title: document.getElementById('job-post-title')?.value,
    location: document.getElementById('job-post-loc')?.value,
    salary_stipend: document.getElementById('job-post-salary')?.value,
    min_cgpa: Number(document.getElementById('job-post-cgpa')?.value),
    required_skills: (document.getElementById('job-post-skills')?.value || '').split(',').map(s => s.trim()),
    deadline: document.getElementById('job-post-deadline')?.value,
    status: 'Published'
  };
  
  try {
    const response = await apiFetch('/company/jobs', {
      method: 'POST',
      body: JSON.stringify(jobData)
    });
    
    if (response.success) {
      alert('Job posted successfully!');
      navigateTo('company-dashboard');
    }
  } catch (error) {
    alert('Failed to post job: ' + error.message);
  }
}

// TALENT FINDER
async function legacyLoadTalentFinder() {
  try {
    const candidates = await apiFetch('/company/talent-finder');
    const container = document.getElementById('talent-candidates-list');
    container.innerHTML = '';
    
    if (!candidates.length) {
      container.innerHTML = '<p style="grid-column: 1/-1; color: var(--text-muted);">No candidates found matching your criteria.</p>';
      return;
    }
    
    candidates.forEach(candidate => {
      const card = document.createElement('div');
      card.className = 'saas-card';
      
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem;">
          <div>
            <div style="font-weight: 700; font-size: 1rem; margin-bottom: 0.2rem;">${candidate.name || 'Candidate'}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">${candidate.studentId || 'ID'}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-blue);">${candidate.matchPercentage || 0}%</div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">AI Match</div>
          </div>
        </div>
        
        <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid rgba(56, 189, 248, 0.2);">
          <div style="font-size: 0.8rem; margin-bottom: 0.5rem;"><strong>Department:</strong> ${candidate.department || 'N/A'}</div>
          <div style="font-size: 0.8rem; margin-bottom: 0.5rem;"><strong>CGPA:</strong> ${candidate.cgpa ? candidate.cgpa.toFixed(2) : 'N/A'}</div>
          <div style="font-size: 0.8rem;"><strong>Recommendation:</strong> <span style="color: var(--text-emerald);">${candidate.recommendationLevel || 'Pending'}</span></div>
        </div>
        
        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5rem;">Top Skills:</div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${(candidate.skills || []).slice(0, 4).map(s => `<span class="badge-saas badge-blue">${s.name} (${s.scoreOutOfTen}/10)</span>`).join('')}
          </div>
        </div>
        
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn-saas btn-primary" style="flex: 1;" onclick="viewCandidateProfile('${candidate.studentId}')">View Profile</button>
          <button class="btn-saas btn-outline" style="flex: 1;" onclick="shortlistCandidate('${candidate.studentId}')">Shortlist</button>
        </div>
      `;
      
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Failed to load talent finder:', error);
  }
}

// VIEW CANDIDATE PROFILE
async function viewCandidateProfile(studentId) {
  try {
    const candidate = await apiFetch(`/company/candidates/${studentId}`);
    
    // Open modal or navigate to detailed view
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000;';
    modal.onclick = () => modal.remove();
    
    const content = document.createElement('div');
    content.className = 'saas-card';
    content.style.cssText = 'max-width: 600px; max-height: 80vh; overflow-y: auto; position: relative;';
    content.onclick = (e) => e.stopPropagation();
    
    content.innerHTML = `
      <button style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; color: var(--text-muted); font-size: 1.5rem; cursor: pointer;" onclick="this.closest('div').parentElement.remove()">×</button>
      
      <div style="margin-bottom: 1rem;">
        <h2 style="margin: 0; font-size: 1.5rem; font-weight: 800;">${candidate.name || 'Candidate'}</h2>
        <p style="margin: 0.2rem 0 0; color: var(--text-muted);">${candidate.studentId || ''}</p>
      </div>
      
      <div style="background: rgba(56, 189, 248, 0.1); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
        <div style="font-size: 0.85rem; margin-bottom: 0.5rem;">
          <strong style="color: var(--text-blue); font-size: 2rem;">Match Score: ${candidate.match.matchPercentage}%</strong>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">Recommendation: <strong style="color: var(--text-emerald);">${candidate.match.recommendationLevel}</strong></div>
      </div>
      
      <div style="margin-bottom: 1.5rem;">
        <h3 style="font-weight: 700; margin-bottom: 0.75rem;">Profile Information</h3>
        <table style="width: 100%; font-size: 0.9rem;">
          <tr><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);"><strong>Email:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);">${candidate.email || 'Private'}</td></tr>
          <tr><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);"><strong>Department:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);">${candidate.profile.department || 'N/A'}</td></tr>
          <tr><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);"><strong>CGPA:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);">${candidate.profile.cgpa ? candidate.profile.cgpa.toFixed(2) : 'Private'}</td></tr>
          <tr><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2);"><strong>AI Score:</strong></td><td style="padding: 0.5rem; border-bottom: 1px solid rgba(56,189,248,0.2); color: var(--text-blue); font-weight: 600;">${candidate.aiScore}/100</td></tr>
        </table>
      </div>
      
      <div style="margin-bottom: 1.5rem;">
        <h3 style="font-weight: 700; margin-bottom: 0.75rem;">Skills</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
          ${candidate.skills.map(s => `<span class="badge-saas badge-purple">${s.skill_name} - ${s.level_pct}%</span>`).join('')}
        </div>
      </div>
      
      ${candidate.projects.length ? `
        <div style="margin-bottom: 1.5rem;">
          <h3 style="font-weight: 700; margin-bottom: 0.75rem;">Projects</h3>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${candidate.projects.slice(0, 3).map(p => `
              <div style="background: rgba(30, 41, 59, 0.5); padding: 0.75rem; border-radius: 8px;">
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${p.title || 'Project'}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted);">${p.description || ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div style="display: flex; gap: 0.5rem; margin-top: 1.5rem;">
        <button class="btn-saas btn-primary" style="flex: 1;" onclick="shortlistCandidate('${candidate.studentId}')">Shortlist</button>
        <button class="btn-saas btn-outline" style="flex: 1;">Schedule Interview</button>
      </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
  } catch (error) {
    alert('Failed to load candidate profile: ' + error.message);
  }
}

// SHORTLIST CANDIDATE
async function shortlistCandidate(studentId) {
  // This would create/update an application with shortlist status
  console.log('Shortlisting candidate:', studentId);
}

// Setup Event Listeners
function setupCompanyEventListeners() {
  // Add any global company module event listeners
}

// Export functions
window.initializeCompanyModule = initializeCompanyModule;
window.loadCompanyDashboard = loadCompanyDashboard;
// The active company portal is implemented in app.js. Keep these legacy
// helpers private so loading this optional extension cannot overwrite active
// job-management and candidate-discovery workflows.
window.viewCandidateProfile = viewCandidateProfile;
window.shortlistCandidate = shortlistCandidate;
