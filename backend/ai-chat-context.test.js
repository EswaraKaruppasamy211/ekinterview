const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAIChatContext, hasContextData, NO_DATA_REPLY } = require('./ai-chat-context');

function makeUserDb(data = {}) {
  return {
    async listRecords(collection, filter = {}) {
      return (data[collection] || []).filter(record => Object.entries(filter)
        .every(([key, value]) => String(record[key]) === String(value)));
    },
    async getStudentProfileByUserId(userId) {
      return (data.studentProfiles || {})[String(userId)] || null;
    },
    async getCompanyProfileByUserId(userId) {
      return (data.companyProfiles || {})[String(userId)] || null;
    },
    async getFacultyStudentAuthorization() { return null; },
    async listFacultyStudentAuthorizationsForFaculty() { return []; },
    async getRecord() { return null; }
  };
}

test('student context uses the authenticated student records and redacts secrets', async () => {
  const userDb = makeUserDb({
    studentProfiles: {
      12: { name: 'Student', email: 'private@example.test', password_hash: 'not-for-ai', department: 'Computing' }
    },
    projects: [
      { user_id: '12', title: 'Owned project', description: 'api_key=AIza12345678901234567890123456789012345' },
      { user_id: '13', title: 'Other student project' }
    ]
  });
  const context = await buildAIChatContext({ id: 12, role: 'student' }, {
    userDb,
    academiaDb: { async list() { return []; } }
  });

  assert.equal(context.module, 'student');
  assert.deepEqual(context.data.projects.map(project => project.title), ['Owned project']);
  assert.equal(context.data.profile.email, undefined);
  assert.equal(context.data.profile.password_hash, undefined);
  assert.equal(context.data.projects[0].description, '[REDACTED]');
});

test('company context scopes every workflow query to the authenticated company', async () => {
  const queriedCompanyIds = [];
  const userDb = makeUserDb({
    companyProfiles: { 4: { company_id: 'cmp-4', company_name: 'Owned company' } },
    jobs: [{ companyId: 'cmp-4', id: 'job-1', title: 'Owned job' }, { companyId: 'cmp-5', id: 'job-2', title: 'Other job' }],
    applications: [
      { companyId: 'cmp-4', job_id: 'job-1', candidate_name: 'Authorized candidate' },
      { companyId: 'cmp-5', job_id: 'job-2', candidate_name: 'Other candidate' }
    ]
  });
  const scopedListRecords = userDb.listRecords.bind(userDb);
  userDb.listRecords = async (collection, filter) => {
    if (collection !== 'jobs' || Object.keys(filter).length) queriedCompanyIds.push(filter.companyId);
    return scopedListRecords(collection, filter);
  };

  const context = await buildAIChatContext({ id: 4, role: 'company', companyId: 'cmp-4' }, { userDb });
  assert.ok(queriedCompanyIds.every(companyId => companyId === 'cmp-4'));
  assert.deepEqual(context.data.jobs.map(job => job.title), ['Owned job']);
  assert.deepEqual(context.data.applications.map(application => application.candidate_name), ['Authorized candidate']);
});

test('company context fails closed when the authenticated account has no company ID', async () => {
  const userDb = makeUserDb({
    jobs: [{ companyId: 'other-company', title: 'Private job' }]
  });
  let queryCount = 0;
  userDb.listRecords = async () => {
    queryCount += 1;
    return [{ companyId: 'other-company', title: 'Private job' }];
  };

  const context = await buildAIChatContext({ id: 4, role: 'company' }, { userDb });
  assert.equal(queryCount, 0);
  assert.deepEqual(context.data.jobs, []);
});

test('faculty context includes only owned activities and authorized students', async () => {
  const userDb = makeUserDb({
    studentProfiles: {
      21: { name: 'Assigned student', email: 'private@example.test', department: 'Engineering' },
      22: { name: 'Unassigned student', department: 'Engineering' }
    },
    student_skills: [{ user_id: '21', skill_name: 'SQL' }, { user_id: '22', skill_name: 'Other skill' }]
  });
  userDb.listFacultyStudentAuthorizationsForFaculty = async () => [
    { student_user_id: 21 }, { student_user_id: 22 }
  ];
  const academiaDb = {
    RESOURCE_NAMES: ['research-projects'],
    async get() { return { created_by: '7', name: 'Faculty', email: 'private@example.test' }; },
    async list() {
      return [
        { created_by: '7', title: 'Owned research' },
        { created_by: '8', title: 'Another faculty research' }
      ];
    }
  };
  const context = await buildAIChatContext({ id: 7, role: 'faculty' }, {
    userDb,
    academiaDb,
    async canAccessStudentAcademicData(studentId) { return studentId === '21'; }
  });

  assert.deepEqual(context.data.activities['research-projects'].map(item => item.title), ['Owned research']);
  assert.deepEqual(context.data.authorized_students.map(student => student.profile.name), ['Assigned student']);
  assert.equal(context.data.authorized_students[0].profile.email, undefined);
});

test('university context only queries academics for its scoped student directory', async () => {
  const academicQueries = [];
  const userDb = makeUserDb({
    student_academics: [
      { user_id: '31', semester_number: 1, gpa: 8.5 },
      { user_id: '32', semester_number: 1, gpa: 2.0 }
    ]
  });
  const listRecords = userDb.listRecords.bind(userDb);
  userDb.listRecords = async (collection, filter, sort) => {
    if (collection === 'student_academics') academicQueries.push(filter.user_id);
    return listRecords(collection, filter, sort);
  };
  const context = await buildAIChatContext({ id: 3, role: 'college' }, {
    userDb,
    async buildCollegeAnalytics() {
      return {
        total_students: 1,
        student_directory: [{ user_id: 31, name: 'In-scope student', skills: ['SQL'], placed: true }],
        partners: ['Scoped partner']
      };
    }
  });

  assert.deepEqual(academicQueries, ['31']);
  assert.deepEqual(context.data.student_academics[0].semesters.map(item => item.gpa), [8.5]);
  assert.equal(context.data.student_directory[0].user_id, undefined);
});

test('university role aliases resolve to the same scoped context', async () => {
  const userDb = makeUserDb({
    student_academics: [{ user_id: '41', semester_number: 1, gpa: 8.7 }]
  });
  const context = await buildAIChatContext({ id: 4, role: 'University Admin' }, {
    userDb,
    async buildCollegeAnalytics() {
      return {
        total_students: 1,
        student_directory: [{ user_id: 41, name: 'Scoped student', skills: ['SQL'], placed: true }],
        partners: ['Scoped partner']
      };
    }
  });

  assert.equal(context.module, 'university');
  assert.deepEqual(context.data.student_academics[0].semesters.map(item => item.gpa), [8.7]);
  assert.equal(context.data.student_directory[0].name, 'Scoped student');
});

test('empty context is recognized for the no-data response', () => {
  assert.equal(hasContextData({ data: { profile: {}, projects: [] } }), false);
  assert.equal(NO_DATA_REPLY, "I couldn't find that information in your available profile data.");
});

test('large record collections are bounded and marked as partial context', async () => {
  const userDb = makeUserDb({
    projects: Array.from({ length: 60 }, (_, index) => ({
      user_id: '12',
      title: `Project ${index}`,
      description: 'x'.repeat(1600)
    }))
  });
  const context = await buildAIChatContext({ id: 12, role: 'student' }, {
    userDb,
    academiaDb: { async list() { return []; } }
  });

  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 48000);
  assert.ok(context.data.truncated_sections.includes('projects'));
});
