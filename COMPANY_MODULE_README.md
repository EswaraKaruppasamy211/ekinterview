# SkillBridge Company Recruiter Module - Implementation Guide

## Overview
This document provides a complete guide to the SkillBridge Company Recruiter Module - a comprehensive ATS (Applicant Tracking System) and recruitment platform that integrates with the existing Student Module.

## Architecture

### Backend Architecture
- **Technology**: Node.js HTTP Server (native, no Express)
- **Authentication**: JWT Token-based
- **Database**: PostgreSQL with JSONB workflow records
- **Data Isolation**: 100% multi-tenant company isolation
- **API Pattern**: RESTful endpoints under `/api` namespace

### Frontend Architecture
- **Technology**: Vanilla JavaScript (no frameworks)
- **UI Framework**: Custom CSS with glassmorphism design
- **API Integration**: Fetch-based with JWT auth headers
- **Role-Based Navigation**: Student, Company, College Admin portals

## Implemented Features

### ✅ Backend APIs (30+ endpoints)

#### Company Profile Management
- `GET /api/company/profile` - Retrieve company profile and stats
- `PUT /api/company/profile` - Update company information

#### Job Management (CRUD)
- `GET /api/company/jobs` - List all company jobs
- `GET /api/company/jobs/:id` - Get job details
- `POST /api/company/jobs` - Create new job posting
- `PUT /api/company/jobs/:id` - Update job
- `DELETE /api/company/jobs/:id` - Delete job

#### Application & ATS Pipeline
- `GET /api/company/applications` - List applications with filtering
- `GET /api/company/applications/kanban` - Get Kanban board view
- `PUT /api/company/applications/:id/stage` - Move application between stages
- Supports 8-stage pipeline: Applied → Screening → Shortlisted → Assessment → Technical Interview → HR Interview → Final Review → Selected

#### Assessment System
- `GET /api/company/assessments` - List assessments
- `POST /api/company/assessments` - Create new assessment
- Supports multiple types: Technical, MCQ, Coding, Aptitude, HR

#### Interview Management
- `GET /api/company/interviews` - List scheduled interviews
- `POST /api/company/interviews/schedule` - Schedule new interview
- Interview types: Video, Phone, In-Person
- Tracks interview rounds: Technical, HR, Final

#### Talent Search & Discovery
- `GET /api/company/candidates/search` - Search candidates with filters
- `GET /api/company/candidates/:id` - Get detailed candidate profile
- Filters: Skill, CGPA, Department, AI Score
- Respects candidate privacy settings

#### Offer Management
- `GET /api/company/offers` - List all offers
- `POST /api/company/offers` - Generate and send offer
- Tracks offer status: Sent, Viewed, Accepted, Rejected, Expired

#### Team Member Management
- `GET /api/company/team` - List team members
- `POST /api/company/team` - Add new team member
- Roles: COMPANY_ADMIN, HR_RECRUITER, TECHNICAL_RECRUITER, INTERVIEWER

#### Analytics & Reporting
- `GET /api/company/analytics/dashboard` - Recruitment metrics and funnel
- Provides: Pipeline stage breakdown, ratios, job performance data

### ✅ Frontend Components

#### Files Created/Modified:
1. **frontend/company-module.js** - Core company module functions
   - `initializeCompanyModule()` - Initialize company portal
   - `loadCompanyDashboard()` - Load ATS dashboard
   - `loadATSKanbanBoard()` - Render Kanban board
   - `handlePostJobSubmit()` - Post new job
   - `loadTalentFinder()` - Search candidates
   - `viewCandidateProfile()` - View candidate details
   - `shortlistCandidate()` - Shortlist candidate

2. **frontend/company-screens-extension.html** - Additional UI screens
   - Company Jobs List & Management
   - Candidate Comparison (5-way)
   - Assessment Builder
   - Interview Scheduler
   - Offer Management
   - Recruitment Analytics
   - Campus Recruitment Drives
   - Team Member Management

3. **index.html** - Updated with company views
   - `view-company-dashboard` - 8-stage ATS pipeline with Kanban
   - `view-company-jobs` - Job posting form
   - `view-talent-finder` - Candidate discovery

4. **frontend/app.js** - Enhanced
   - Fixed API_BASE to support localhost
   - Navigation handlers for company module
   - Company dashboard loader
   - Job posting handler
   - Talent finder loader

## Integration Steps

### Step 1: Backend Integration
The company APIs are already integrated into `/backend/server.js` (lines 1461-1655). No additional action needed - the server includes:
- All company endpoints with proper authentication
- Multi-tenant data isolation
- AI matching algorithms (reused from student module)
- State management and persistence

### Step 2: Frontend Integration
To add remaining UI screens to index.html:

1. Copy all HTML sections from `frontend/company-screens-extension.html`
2. Insert before the closing `</main>` tag in index.html
3. Ensure `frontend/company-module.js` is loaded (already done)

### Step 3: Frontend Function Implementations
Add these functions to `frontend/app.js` navigateTo() handler:

```javascript
else if (viewId === 'company-jobs-list') loadCompanyJobsList();
else if (viewId === 'candidate-comparison') loadCandidateComparison();
else if (viewId === 'assessment-builder') loadAssessmentBuilder();
else if (viewId === 'interview-scheduler') loadInterviewScheduler();
else if (viewId === 'offer-management') loadOfferManagement();
else if (viewId === 'recruitment-analytics') loadRecruitmentAnalytics();
else if (viewId === 'campus-recruitment') loadCampusRecruitment();
else if (viewId === 'team-management') loadTeamManagement();
```

## Database Schema

### Key Data Structures

```javascript
state = {
  // Existing
  users: [],           // All users (students, companies, admins)
  companies: [],       // Company profiles
  jobs: [],           // Job postings
  applications: [],   // Job applications
  
  // Company-specific
  companyAssessments: {       // Keyed by companyId
    'CMP-10001': [assessment]
  },
  companyInterviews: {        // Keyed by companyId
    'CMP-10001': [interview]
  },
  companyOffers: {            // Keyed by companyId
    'CMP-10001': [offer]
  },
  teamMembers: [],            // Team members across all companies
  companyCampusDrives: {      // Keyed by companyId
    'CMP-10001': [drive]
  },
  messages: []                // Company to student messages
}
```

## AI Algorithms

### Candidate Matching
The system uses `calculateCompanyMatch(studentId, company)` to determine candidate fit:
- Skills Match: 70% weight
- CGPA Match: 30% weight
- Returns: Match percentage, strengths, gaps, recommendations

### AI Employability Score
The `calculateSkillScore(studentId)` function computes overall readiness:
- CGPA: 40 points
- Skills: 30 points
- Certifications: 15 points
- Projects: 15 points
- Backlogs penalty: -10 per backlog

## Authentication Flow

### Company Login
1. User enters: Company Name, Email, Password
2. System finds user with role='company' and matching companyId
3. Generates JWT token with userId, email, companyId, role
4. Token stored in localStorage
5. All API requests include Authorization header: `Bearer {token}`

### Multi-Tenant Isolation
Every company endpoint checks:
```javascript
const authUser = getAuthUser();
if (!authUser || authUser.role !== 'company') return sendJSON(401, ...);
// Filter all data by authUser.companyId
```

## Key Features

### 1. ATS Pipeline
- 8-stage Kanban board with drag-drop
- Real-time status tracking
- Stage transition history
- Bulk operations support

### 2. AI Talent Matching
- Automatic candidate scoring for each job
- Privacy-respecting (checks visibility settings)
- Skill gap analysis
- Recommendation levels (Excellent, Strong, Good, Partial, Low)

### 3. Multi-Tenant Isolation
- Company A cannot access Company B's:
  - Job postings
  - Applications
  - Assessments
  - Interviews
  - Offers
  - Analytics
  - Team members

### 4. Interview Management
- Calendar-based scheduling
- Multiple interview types (Video, Phone, In-Person)
- Interview rounds (Technical, HR, Final)
- Automatic reminders (ready to implement)

### 5. Assessment System
- Online assessment builder
- Multiple question types
- Automatic scoring
- Candidate performance tracking

### 6. Campus Recruitment
- Create company-specific campus drives
- Set eligibility criteria (CGPA, Department, Skills)
- Track registrations and selections
- University approval workflow

### 7. Reporting & Analytics
- Hiring funnel visualization
- Application trends
- Selection rates
- Time-to-hire metrics
- Job performance analytics

## Testing

### Test Company Credentials
```
Email: recruiter@techcorp.com
Company: TechCorp Solutions
Password: Company@123
Role: company
```

### Test Endpoints
```bash
# Get company dashboard
curl -H "Authorization: Bearer {token}" \
  http://localhost:3000/api/company/dashboard

# Search candidates
curl -H "Authorization: Bearer {token}" \
  "http://localhost:3000/api/company/candidates/search?skill=Java&minCGPA=7.5"

# Get analytics
curl -H "Authorization: Bearer {token}" \
  http://localhost:3000/api/company/analytics/dashboard
```

## Future Enhancements

### Phase 2 (Recommended)
- [ ] Email notifications integration
- [ ] Interview feedback forms
- [ ] Offer letter PDF generation
- [ ] Bulk candidate import/export
- [ ] Interview recording integration
- [ ] Candidate skill certifications verification
- [ ] Machine learning for skill gap prediction

### Phase 3
- [ ] Video interview integration
- [ ] Coding challenge platform integration
- [ ] Background check integration
- [ ] Offer letter e-signature
- [ ] Integrated messaging and video chat
- [ ] Advanced reporting with visualizations
- [ ] API rate limiting and advanced security

## Performance Optimization

### Implemented
- State persistence to avoid DB calls
- In-memory filtering for large datasets
- Efficient JWT authentication
- Client-side pagination capability

### Recommended
- Database indexing is provided by the PostgreSQL schema
- Implement Redis caching for candidate lists
- Lazy-load analytics charts
- Implement API rate limiting
- Add request pagination

## Security Measures

### Implemented
1. JWT token-based authentication
2. Role-based access control (RBAC)
3. Multi-tenant data isolation
4. Password hashing with scrypt
5. CORS support
6. HTTPS ready (for production)
7. Privacy settings respect

### Recommended
1. Add rate limiting
2. Implement CSRF protection
3. Input validation and sanitization
4. SQL injection prevention (for DB migration)
5. XSS protection
6. Security headers (CSP, X-Frame-Options, etc.)
7. API key management

## Deployment

### Production Deployment
1. Set environment variables:
   - `NODE_ENV=production`
   - `JWT_SECRET={strong-secret}`
   - `SMTP_*` for email
   - `DATABASE_URL` for production DB

2. Use process manager (PM2)
3. Set up HTTPS with reverse proxy (Nginx)
4. Configure environment-based API URLs

### Local Development
```bash
cd d:\interapp
node backend/server.js
# Server runs on http://localhost:3000
```

## Support & Documentation

### API Documentation
Endpoint reference available at `/api/docs`

### Code Structure
- Backend: `/backend/server.js` (1600+ lines, single file)
- Frontend: 
  - `/index.html` - Main application shell
  - `/frontend/app.js` - Core application logic
  - `/frontend/company-module.js` - Company-specific logic
  - `/frontend/company-screens-extension.html` - Additional screens
  - `/styles.css` - Styling

### Important Notes
- The application uses a single-file HTTP server architecture
- External Node.js libraries include nodemailer and pg
- All company data is isolated by companyId
- Student privacy settings are respected in all candidate searches

---

**Last Updated**: 2026-08-29
**Version**: 2.0
**Status**: Company Recruiter Module - MVP Complete
