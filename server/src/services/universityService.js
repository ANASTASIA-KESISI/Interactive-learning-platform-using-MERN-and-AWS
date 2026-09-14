const { University } = require('../models/University');
const { Department } = require('../models/Department');
const { User } = require('../models/User');
const { Course } = require('../models/Course');
const { badRequest, conflict, notFound } = require('../utils/httpError');

// Client-writable fields per resource, same rule as courseService: the admin
// panel posts whole form objects, and `_id`/`createdAt` must never be among the
// keys that reach the document.
const UNIVERSITY_WRITABLE = ['name', 'code'];
const DEPARTMENT_WRITABLE = ['name', 'code', 'semesterCount'];

const NAME_MAX = 200;
const CODE_MAX = 16;
const SEMESTER_MIN = 1;
const SEMESTER_MAX = 12;

const pick = (source, allowed) =>
  Object.fromEntries(
    Object.entries(source || {}).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    ),
  );

const requireText = (value, field, max) => {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw badRequest(`${field} must be ${max} characters or fewer`);
  return trimmed;
};

const validateSemesterCount = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < SEMESTER_MIN || n > SEMESTER_MAX) {
    throw badRequest(`semesterCount must be an integer between ${SEMESTER_MIN} and ${SEMESTER_MAX}`);
  }
  return n;
};

// Normalises a create/update payload for either resource. `partial` skips the
// required checks for fields the caller did not send (PATCH semantics).
const cleanUniversity = (data, { partial = false } = {}) => {
  const updates = pick(data, UNIVERSITY_WRITABLE);
  if (!partial || 'name' in updates) updates.name = requireText(updates.name, 'name', NAME_MAX);
  if (!partial || 'code' in updates) {
    updates.code = requireText(updates.code, 'code', CODE_MAX).toUpperCase();
  }
  return updates;
};

const cleanDepartment = (data, { partial = false } = {}) => {
  const updates = pick(data, DEPARTMENT_WRITABLE);
  if (!partial || 'name' in updates) updates.name = requireText(updates.name, 'name', NAME_MAX);
  if (!partial || 'code' in updates) {
    updates.code = requireText(updates.code, 'code', CODE_MAX).toUpperCase();
  }
  if ('semesterCount' in updates) updates.semesterCount = validateSemesterCount(updates.semesterCount);
  return updates;
};

// ── Read ──────────────────────────────────────────────────────────────────────

// Public list behind `GET /api/universities` — the signup form's two selects.
// Two lean queries rather than a populate-per-university: the whole tree is a
// handful of documents and is read on every signup page view.
const listWithDepartments = async () => {
  const universities = await University.find().sort({ name: 1 }).lean();
  const departments = await Department.find({
    universityId: { $in: universities.map((u) => u._id) },
  })
    .sort({ name: 1 })
    .lean();

  const byUniversity = new Map();
  for (const d of departments) {
    const key = d.universityId.toString();
    if (!byUniversity.has(key)) byUniversity.set(key, []);
    byUniversity.get(key).push({
      id: d._id.toString(),
      name: d.name,
      code: d.code,
      semesterCount: d.semesterCount,
    });
  }

  return universities.map((u) => ({
    id: u._id.toString(),
    name: u.name,
    code: u.code,
    departments: byUniversity.get(u._id.toString()) || [],
  }));
};

// ── Admin CRUD ────────────────────────────────────────────────────────────────

const createUniversity = (data) => University.create(cleanUniversity(data));

const updateUniversity = async (universityId, updates) => {
  const university = await University.findById(universityId);
  if (!university) throw notFound('University not found');
  Object.assign(university, cleanUniversity(updates, { partial: true }));
  return university.save();
};

// Refuses while departments still hang off it: cascading would orphan the
// `departmentId` on every user and course that references them, and those
// references are what the Courses page groups by.
const deleteUniversity = async (universityId) => {
  const university = await University.findById(universityId);
  if (!university) throw notFound('University not found');

  const departments = await Department.countDocuments({ universityId });
  if (departments > 0) {
    throw conflict('Delete this university\u2019s departments first', { departments });
  }

  await University.deleteOne({ _id: university._id });
  return { deletedUniversityId: universityId };
};

const createDepartment = async (universityId, data) => {
  const university = await University.findById(universityId);
  if (!university) throw notFound('University not found');
  return Department.create({ ...cleanDepartment(data), universityId: university._id });
};

const updateDepartment = async (departmentId, updates) => {
  const department = await Department.findById(departmentId);
  if (!department) throw notFound('Department not found');
  Object.assign(department, cleanDepartment(updates, { partial: true }));
  return department.save();
};

const deleteDepartment = async (departmentId) => {
  const department = await Department.findById(departmentId);
  if (!department) throw notFound('Department not found');

  const [users, courses] = await Promise.all([
    User.countDocuments({ departmentId }),
    Course.countDocuments({ departmentId }),
  ]);
  if (users > 0 || courses > 0) {
    throw conflict('This department is still referenced by users or courses', { users, courses });
  }

  await Department.deleteOne({ _id: department._id });
  return { deletedDepartmentId: departmentId };
};

module.exports = {
  listWithDepartments,
  createUniversity,
  updateUniversity,
  deleteUniversity,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  UNIVERSITY_WRITABLE,
  DEPARTMENT_WRITABLE,
};
