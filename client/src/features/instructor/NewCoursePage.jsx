import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { createCourse } from '../../services/courses.js';
import { listUniversities } from '../../services/universities.js';
import { ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

// Shared by this page and CourseEditorPage: the institutional pair plus the two
// presentation fields the course page renders. Kept here (rather than in a
// shared module) because only these two forms author a course.
export const useDepartments = () => {
  const [universities, setUniversities] = useState([]);

  useEffect(() => {
    let cancelled = false;
    listUniversities()
      .then((data) => {
        if (!cancelled) setUniversities(data);
      })
      .catch(() => {
        // Non-fatal: the department select stays empty and the course is
        // simply created without an institutional placement.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return universities;
};

export const departmentById = (universities, departmentId) =>
  universities
    .flatMap((u) => u.departments || [])
    .find((d) => d.id === departmentId) || null;

export const DepartmentSemesterFields = ({ universities, departmentId, semester, onChange }) => {
  const department = useMemo(
    () => departmentById(universities, departmentId),
    [universities, departmentId],
  );
  const semesterCount = department?.semesterCount || 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="departmentId" className="label">
          Department
        </label>
        <select
          id="departmentId"
          className="field"
          value={departmentId}
          onChange={(e) => onChange({ departmentId: e.target.value, semester: '' })}
        >
          <option value="">No department</option>
          {universities.map((u) => (
            <optgroup key={u.id} label={u.name}>
              {(u.departments || []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="semester" className="label">
          Semester
        </label>
        <select
          id="semester"
          className="field"
          value={semester}
          disabled={semesterCount === 0}
          onChange={(e) => onChange({ semester: e.target.value })}
        >
          <option value="">
            {semesterCount === 0 ? 'Choose a department first' : 'No semester'}
          </option>
          {Array.from({ length: semesterCount }, (_, i) => i + 1).map((s) => (
            <option key={s} value={s}>
              Semester {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export const NewCoursePage = () => {
  const navigate = useNavigate();
  const universities = useDepartments();
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'beginner',
    departmentId: '',
    semester: '',
    icon: '',
    about: '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Only the fields the server allowlists (courseService.COURSE_WRITABLE).
      const course = await createCourse({
        title: form.title,
        description: form.description,
        category: form.category,
        difficulty: form.difficulty,
        departmentId: form.departmentId || null,
        semester: form.semester || null,
        icon: form.icon,
        about: form.about,
      });
      navigate(`/instructor/courses/${course._id}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/instructor" className="text-sm text-brand-600 hover:text-brand-700">
        ← My courses
      </Link>
      <h1 className="text-3xl font-semibold text-slate-900">New course</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
          <div>
            <label htmlFor="icon" className="label">Icon</label>
            <input
              id="icon"
              value={form.icon}
              onChange={update('icon')}
              maxLength={8}
              placeholder="📘"
              className="field text-center text-xl"
            />
          </div>
          <div>
            <label htmlFor="title" className="label">Title</label>
            <input id="title" value={form.title} onChange={update('title')} required className="field" />
          </div>
        </div>

        <div>
          <label htmlFor="description" className="label">Description</label>
          <textarea
            id="description"
            value={form.description}
            onChange={update('description')}
            required
            rows={3}
            className="field"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="label">Category</label>
            <input id="category" value={form.category} onChange={update('category')} className="field" />
          </div>
          <div>
            <label htmlFor="difficulty" className="label">Difficulty</label>
            <select id="difficulty" value={form.difficulty} onChange={update('difficulty')} className="field">
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{titleCase(d)}</option>
              ))}
            </select>
          </div>
        </div>

        <DepartmentSemesterFields
          universities={universities}
          departmentId={form.departmentId}
          semester={form.semester}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />

        <div>
          <label htmlFor="about" className="label">About this course (Markdown)</label>
          <textarea
            id="about"
            value={form.about}
            onChange={update('about')}
            rows={6}
            className="field font-mono text-sm"
            placeholder={'What the course covers, what a learner will be able to do, prerequisites.'}
          />
          <p className="mt-1 text-xs text-slate-500">
            Rendered on the course page under “About this course”. Supports GFM.
          </p>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end gap-3">
          <Link to="/instructor" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create course'}
          </button>
        </div>
      </form>
    </div>
  );
};
