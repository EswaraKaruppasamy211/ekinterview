const NO_DATA_REPLY = "I couldn't find that information in your available profile data.";
const MAX_RECORDS = 60;
const MAX_STUDENTS = 80;
const MAX_CONTEXT_BYTES = 48000;
const SENSITIVE_KEYS = /password|secret|token|salt|hash|api.?key|access.?key|private.?key|credential|authorization|email|phone|mobile|address|date.?of.?birth|\bdob\b|\bjwt\b/i;

function normalizeRole(role) {
  const normalized = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    college_admin: 'college',
    collegeadmin: 'college',
    university: 'college',
    university_admin: 'college',
    universityadmin: 'college'
  };
  return aliases[normalized] || normalized;
}

function safeValue(value, depth = 0) {
  if (typeof value === 'string') {
    return value
      .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED]')
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]')
      .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|ya29\.[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED]')
      .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, '[REDACTED]')
      .replace(/([?&](?:key|token|api[_-]?key)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/\b(?:api[_ -]?key|access[_ -]?key|private[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|jwt|password|secret|authorization)\s*(?:is|[:=])\s*[^\s,;]+/gi, '[REDACTED]')
      .slice(0, 1600);
  }
  if (Array.isArray(value)) return value.slice(0, MAX_RECORDS).map(item => safeValue(item, depth + 1));
  if (!value || typeof value !== 'object' || depth >= 4) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEYS.test(key))
    .map(([key, item]) => [key, safeValue(item, depth + 1)]));
}

function pick(record, fields) {
  if (!record || typeof record !== 'object') return {};
  return safeValue(Object.fromEntries(fields
    .filter(field => record[field] !== undefined && record[field] !== null)
    .map(field => [field, record[field]])));
}

async function records(db, collection, filter, fields, sort = { created_at: -1 }) {
  const found = await db.listRecords(collection, filter, sort);
  return {
    items: found.slice(0, MAX_RECORDS).map(record => pick(record, fields)),
    truncated: found.length > MAX_RECORDS
  };
}

function recordFields(recordSets) {
  const truncated = Object.entries(recordSets)
    .filter(([, value]) => value.truncated)
    .map(([name]) => name);
  return {
    ...Object.fromEntries(Object.entries(recordSets).map(([name, value]) => [name, value.items])),
    ...(truncated.length ? { truncated_sections: truncated } : {})
  };
}

function collectArrays(value, path, found) {
  if (Array.isArray(value)) {
    if (value.length && path !== 'data.truncated_sections') found.push({ value, path, size: Buffer.byteLength(JSON.stringify(value)) });
    value.forEach((item, index) => collectArrays(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectArrays(item, `${path}.${key}`, found));
  }
}

function limitContextSize(context) {
  const truncated = new Set(context.data.truncated_sections || []);
  while (Buffer.byteLength(JSON.stringify(context)) > MAX_CONTEXT_BYTES) {
    const arrays = [];
    collectArrays(context.data, 'data', arrays);
    if (!arrays.length) break;
    arrays.sort((left, right) => right.size - left.size);
    const largest = arrays[0];
    largest.value.pop();
    truncated.add(largest.path.replace(/^data\./, '').replace(/\[\d+\]/g, ''));
  }
  if (truncated.size) context.data.truncated_sections = [...truncated];
  return context;
}

async function buildStudentContext(user, { userDb, academiaDb }) {
  const userId = String(user.id);
  const profile = await userDb.getStudentProfileByUserId(user.id);
  const [skills, projects, assessments, academics, academicSummary, certifications, internships,
    internshipApplications, applications, placements, campusRegistrations, achievements, backlogs,
    jobs, availableInternships, portfolio] = await Promise.all([
    records(userDb, 'student_skills', { user_id: userId }, ['skill_name', 'name', 'proficiency', 'category', 'level']),
    records(userDb, 'projects', { user_id: userId }, ['title', 'description', 'technologies', 'status', 'start_date', 'end_date']),
    records(userDb, 'assessments', { user_id: userId }, ['name', 'title', 'score', 'total', 'status', 'completed_at', 'created_at']),
    records(userDb, 'student_academics', { user_id: userId }, ['semester', 'semester_number', 'academic_year', 'gpa', 'cgpa', 'total_marks', 'percentage', 'subjects_count', 'passed_subjects', 'failed_subjects', 'backlogs', 'academic_status', 'remarks'], { semester_number: -1, semester: -1 }),
    records(userDb, 'student_academic_summary', { user_id: userId }, ['qualification', 'institution', 'board', 'year', 'percentage', 'grade']),
    records(userDb, 'certifications', { user_id: userId }, ['name', 'title', 'organization', 'issuer', 'issue_date', 'expiry_date', 'status']),
    records(userDb, 'internships', { user_id: userId }, ['company', 'company_name', 'role', 'title', 'summary', 'start_date', 'end_date', 'status']),
    records(userDb, 'internship_applications', { student_id: userId }, ['internship_id', 'title', 'company_name', 'status', 'applied_at', 'updated_at']),
    records(userDb, 'applications', { student_id: userId }, ['job_id', 'job_title', 'company_name', 'status', 'stage', 'match_percentage', 'applied_at', 'last_updated']),
    records(userDb, 'student_placements', { user_id: userId }, ['company_name', 'job_title', 'status', 'offer_date', 'joining_date', 'placement_date']),
    records(userDb, 'campus_registrations', { user_id: userId }, ['drive_id', 'status', 'registered_at', 'created_at']),
    records(userDb, 'achievements', { user_id: userId }, ['title', 'description', 'category', 'date', 'status']),
    records(userDb, 'backlogs', { user_id: userId }, ['current_backlogs', 'history', 'updated_at']),
    userDb.listRecords('jobs', {}, { created_at: -1 }).then(found => ({
      items: found.filter(job => ['open', 'published', 'active'].includes(String(job.status || '').toLowerCase()))
        .slice(0, 30).map(job => pick(job, ['title', 'company_name', 'location', 'type', 'required_skills', 'description', 'deadline', 'status'])),
      truncated: false
    })),
    userDb.listRecords('company_internships', {}, { created_at: -1 }).then(found => ({
      items: found.filter(internship => ['open', 'published', 'active'].includes(String(internship.status || '').toLowerCase()))
        .slice(0, 30).map(internship => pick(internship, ['title', 'company_name', 'location', 'required_skills', 'duration', 'stipend', 'description', 'status'])),
      truncated: false
    })),
    academiaDb.list('portfolio-extensions', {}, user).then(found => ({
      items: found.filter(item => String(item.created_by) === userId || String(item.owner_id) === userId || String(item.user_id) === userId)
        .slice(0, MAX_RECORDS).map(item => pick(item, ['title', 'type', 'achievement', 'certificate', 'status', 'source_id', 'created_at'])),
      truncated: false
    }))
  ]);

  const fields = recordFields({ skills, projects, assessments, academics, academicSummary, certifications, internships,
    internshipApplications, applications, placements, campusRegistrations, achievements, backlogs, portfolio });
  fields.available_jobs = jobs.items;
  fields.available_internships = availableInternships.items;
  fields.profile = pick(profile, ['name', 'student_id', 'department', 'degree', 'university', 'college', 'graduation_year', 'cgpa', 'goal', 'experience', 'education', 'skills', 'bio', 'portfolio_url']);
  return { module: 'student', data: fields };
}

async function buildCompanyContext(user, { userDb }) {
  const profile = await userDb.getCompanyProfileByUserId(user.id);
  const companyId = String(user.companyId || (profile && profile.company_id) || '');
  const companyRecords = (collection, fields) => companyId
    ? records(userDb, collection, { companyId }, fields)
    : Promise.resolve({ items: [], truncated: false });
  const [jobs, internships, applications, internshipApplications, assessments, assessmentApplicants, interviews, drives, offers] = await Promise.all([
    companyRecords('jobs', ['id', 'title', 'description', 'location', 'type', 'required_skills', 'status', 'deadline', 'created_at']),
    companyRecords('company_internships', ['id', 'title', 'description', 'location', 'required_skills', 'duration', 'stipend', 'status', 'created_at']),
    companyRecords('applications', ['job_id', 'job_title', 'candidate_name', 'student_id', 'status', 'stage', 'match_percentage', 'applied_at', 'last_updated']),
    companyRecords('company_internship_applications', ['internship_id', 'internship_title', 'candidate_name', 'student_id', 'status', 'applied_at', 'updated_at']),
    companyRecords('company_assessments', ['id', 'assessmentId', 'title', 'name', 'description', 'status', 'created_at']),
    companyRecords('company_assessment_applicants', ['assessmentId', 'candidate_name', 'student_id', 'status', 'score', 'completed_at']),
    companyRecords('company_interviews', ['job_title', 'candidate_name', 'status', 'scheduledAt', 'scheduled_at', 'duration', 'createdAt']),
    companyRecords('campus_drives', ['title', 'name', 'institution', 'university', 'location', 'date', 'status', 'created_at']),
    companyRecords('offers', ['jobTitle', 'candidateName', 'status', 'createdAt', 'joiningDate'])
  ]);
  const authorizedJobs = jobs.items;
  const jobIds = new Set(companyId
    ? (await userDb.listRecords('jobs', { companyId })).map(job => String(job.id))
    : []);
  applications.items = applications.items.filter(application => !application.job_id || jobIds.has(String(application.job_id)));
  const demand = {};
  authorizedJobs.forEach(job => {
    const required = Array.isArray(job.required_skills) ? job.required_skills : String(job.required_skills || '').split(',');
    required.map(skill => String(skill).trim()).filter(Boolean).forEach(skill => { demand[skill] = (demand[skill] || 0) + 1; });
  });
  return {
    module: 'company',
    data: {
      profile: pick(profile, ['company_name', 'industry', 'description', 'website', 'location', 'company_size', 'founded_year', 'technologies', 'required_skills', 'benefits']),
      ...recordFields({ jobs, internships, applications, internshipApplications, assessments, assessmentApplicants, interviews, drives, offers }),
      recruitment_analytics: {
        total_jobs: jobIds.size,
        active_jobs: authorizedJobs.filter(job => ['open', 'published', 'active'].includes(String(job.status || '').toLowerCase())).length,
        total_applications: applications.items.length,
        pipeline_by_status: applications.items.reduce((totals, application) => {
          const status = String(application.status || application.stage || 'Unspecified');
          totals[status] = (totals[status] || 0) + 1;
          return totals;
        }, {}),
        skill_demand: demand
      }
    }
  };
}

async function buildFacultyContext(user, { userDb, academiaDb, canAccessStudentAcademicData }) {
  const userId = String(user.id);
  const facultyProfile = await academiaDb.get('faculty-profiles', userId, user);
  const resources = {};
  for (const resource of academiaDb.RESOURCE_NAMES) {
    const found = await academiaDb.list(resource, {}, user);
    resources[resource] = found.filter(item => String(item.created_by) === userId)
      .slice(0, MAX_RECORDS)
      .map(item => pick(item, ['title', 'description', 'summary', 'type', 'status', 'company', 'company_name', 'organization', 'industry', 'department', 'start_date', 'end_date', 'date', 'duration', 'research_area', 'publication', 'achievement', 'certificate', 'created_at']));
  }
  const assignments = await userDb.listFacultyStudentAuthorizationsForFaculty(user.id);
  const authorizedStudents = [];
  for (const assignment of assignments) {
    const studentId = String(assignment.student_user_id);
    if (!(await canAccessStudentAcademicData(studentId, user))) continue;
    const [profile, skills, academics] = await Promise.all([
      userDb.getStudentProfileByUserId(studentId),
      records(userDb, 'student_skills', { user_id: studentId }, ['skill_name', 'name', 'proficiency', 'category']),
      records(userDb, 'student_academics', { user_id: studentId }, ['semester', 'semester_number', 'gpa', 'cgpa', 'percentage', 'backlogs', 'academic_status'], { semester_number: -1, semester: -1 })
    ]);
    authorizedStudents.push({
      profile: pick(profile, ['name', 'student_id', 'department', 'degree', 'graduation_year', 'cgpa']),
      skills: skills.items,
      academics: academics.items
    });
    if (authorizedStudents.length >= MAX_STUDENTS) break;
  }
  return {
    module: 'faculty',
    data: {
      profile: pick(facultyProfile && String(facultyProfile.created_by) === userId ? facultyProfile : user,
        ['name', 'department', 'college', 'university', 'institution', 'designation', 'research_interests']),
      activities: resources,
      authorized_students: authorizedStudents
    }
  };
}

async function buildUniversityContext(user, { userDb, buildCollegeAnalytics }) {
  const analytics = await buildCollegeAnalytics(user);
  const studentDirectory = Array.isArray(analytics.student_directory) ? analytics.student_directory : [];
  const scopedStudents = studentDirectory.slice(0, MAX_STUDENTS);
  const registrations = await Promise.all(scopedStudents.map(student =>
    userDb.listRecords('campus_registrations', { user_id: String(student.user_id) })));
  const driveIds = new Set(registrations.flat().map(registration => String(registration.drive_id)));
  const campusDrives = driveIds.size
    ? (await userDb.listRecords('campus_drives'))
      .filter(drive => driveIds.has(String(drive.id)) || driveIds.has(String(drive.driveId)))
      .slice(0, MAX_RECORDS)
      .map(drive => pick(drive, ['title', 'name', 'company_name', 'location', 'date', 'status', 'description']))
    : [];
  const academicRecords = await Promise.all(scopedStudents.map(async student => {
    const recordsForStudent = await userDb.listRecords('student_academics', { user_id: String(student.user_id) }, { semester_number: -1, semester: -1 });
    return {
      student: pick(student, ['name', 'student_id', 'department']),
      semesters: recordsForStudent.slice(0, 5).map(record => pick(record, ['semester', 'semester_number', 'academic_year', 'gpa', 'cgpa', 'total_marks', 'percentage', 'subjects_count', 'passed_subjects', 'failed_subjects', 'backlogs', 'academic_status']))
    };
  }));
  const institutionProfile = await userDb.getRecord('college_profiles', { user_id: String(user.id) });
  const { student_directory, ...summary } = analytics;
  return {
    module: 'university',
    data: {
      profile: pick(institutionProfile, ['institution', 'college', 'university', 'institution_id', 'college_id', 'university_id', 'department']),
      analytics: safeValue(summary),
      student_directory: studentDirectory.slice(0, MAX_STUDENTS).map(student => pick(student, ['name', 'student_id', 'department', 'skills', 'internship_participation', 'applications', 'placed'])),
      student_academics: academicRecords,
      campus_drives: campusDrives,
      ...(studentDirectory.length > MAX_STUDENTS ? { truncated_sections: ['student_directory', 'student_academics'] } : {})
    }
  };
}

async function buildAIChatContext(user, dependencies) {
  if (!user || !user.id) throw new Error('Authenticated user is required to build chat context.');
  const role = normalizeRole(user.role);
  let context;
  if (role === 'student') context = await buildStudentContext(user, dependencies);
  else if (role === 'company') context = await buildCompanyContext(user, dependencies);
  else if (role === 'faculty') context = await buildFacultyContext(user, dependencies);
  else if (role === 'college') context = await buildUniversityContext(user, dependencies);
  else throw new Error('This account role does not have access to the context-aware chatbot.');
  return limitContextSize(context);
}

function hasContextData(context) {
  return Boolean(context && context.data && Object.values(context.data).some(value => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== null && value !== undefined && value !== '';
  }));
}

module.exports = { NO_DATA_REPLY, buildAIChatContext, hasContextData, normalizeRole };
