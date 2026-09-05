import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listCourses } from '../../services/courses.js';
import { listUniversities } from '../../services/universities.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';
import { Chip, EmptyState } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';

const DIFFICULTY_TONES = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'danger',
};

// `departmentId` arrives as a bare id from the list endpoint and as a populated
// object from the detail endpoint; both shapes reach this page over time.
const idOf = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  const id = value.id ?? value._id;
  return id ? String(id) : null;
};

const CourseCard = ({ course }) => (
  <li>
    <Link
      to={`/courses/${course._id}`}
      className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {course.icon && (
            <span className="text-2xl leading-none" aria-hidden="true">
              {course.icon}
            </span>
          )}
          {course.category && (
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {course.category}
            </span>
          )}
        </div>
        <Chip tone={DIFFICULTY_TONES[course.difficulty] || 'neutral'}>{titleCase(course.difficulty)}</Chip>
      </div>

      <h3 className="mt-3 text-lg font-semibold text-slate-900">{course.title}</h3>
      <p className="mt-2 line-clamp-3 text-sm text-slate-600">{course.description}</p>

      <div className="mt-auto pt-4">
        {course.semester ? (
          <Chip tone="brand" className="mb-2">
            Semester {course.semester}
          </Chip>
        ) : null}
        <p className="text-xs text-slate-500">
          {course.enrollmentCount || 0} enrolled ·{' '}
          {course.instructor?.firstName
            ? `${course.instructor.firstName} ${course.instructor.lastName || ''}`.trim()
            : 'Instructor'}
        </p>
      </div>
    </Link>
  </li>
);

const CourseGrid = ({ courses }) => (
  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {courses.map((course) => (
      <CourseCard key={course._id} course={course} />
    ))}
  </ul>
);

export const CoursesListPage = () => {
  const { user } = useAuth();
  const department = user?.profile?.department || null;
  // Only a student with a department gets the semester curriculum; everyone
  // else (instructors, admins, accounts predating S7) keeps the flat list with
  // explicit filters.
  const grouped = user?.role === 'student' && Boolean(department);

  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('');
  const [allDepartments, setAllDepartments] = useState(false);

  // Flat-list filters (instructors, admins, students with no department).
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    if (grouped) return undefined;
    let cancelled = false;
    listUniversities()
      .then((universities) => {
        if (cancelled) return;
        setDepartments(
          universities.flatMap((u) =>
            (u.departments || []).map((d) => ({ ...d, universityName: u.name })),
          ),
        );
      })
      .catch(() => {
        // Non-fatal: without the tree the department select simply stays empty.
      });
    return () => {
      cancelled = true;
    };
  }, [grouped]);

  // The grouped view needs courses outside the learner's department too — the
  // "Other courses" section holds the ones with no institutional placement —
  // so it groups client-side instead of asking the server to filter.
  const query = useMemo(() => {
    const params = {};
    if (category) params.category = category;
    if (!grouped) {
      if (departmentFilter) params.departmentId = departmentFilter;
      if (semesterFilter) params.semester = semesterFilter;
    }
    return params;
  }, [category, grouped, departmentFilter, semesterFilter]);

  useEffect(() => {
    let cancelled = false;
    setCourses(null);
    setError(null);
    listCourses(query)
      .then((data) => {
        if (!cancelled) setCourses(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error?.message || err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const categories = useMemo(() => {
    if (!courses) return [];
    return Array.from(new Set(courses.map((c) => c.category).filter(Boolean))).sort();
  }, [courses]);

  const sections = useMemo(() => {
    if (!grouped || !courses) return null;
    const semesterCount = department?.semesterCount || 8;
    const visible = allDepartments
      ? courses
      : courses.filter((c) => !c.departmentId || idOf(c.departmentId) === department.id);

    const bySemester = [];
    for (let semester = 1; semester <= semesterCount; semester += 1) {
      const inSemester = visible.filter((c) => c.semester === semester);
      if (inSemester.length > 0) bySemester.push({ semester, courses: inSemester });
    }

    const placed = new Set(bySemester.flatMap((s) => s.courses.map((c) => c._id)));
    const other = visible.filter((c) => !placed.has(c._id));
    return { bySemester, other, total: visible.length };
  }, [grouped, courses, department, allDepartments]);

  if (error) return <ErrorBanner message={error} />;
  if (!courses) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Courses</h1>
          <p className="mt-1 text-slate-600">
            {grouped
              ? `${department.name} — browse by semester and enrol to start learning.`
              : 'Browse published courses and enrol to start learning.'}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {categories.length > 0 && (
            <div>
              <label htmlFor="category" className="label">
                Category
              </label>
              <select
                id="category"
                className="field"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!grouped && (
            <>
              <div>
                <label htmlFor="department" className="label">
                  Department
                </label>
                <select
                  id="department"
                  className="field"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                >
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
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
                  value={semesterFilter}
                  onChange={(e) => setSemesterFilter(e.target.value)}
                >
                  <option value="">All semesters</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {grouped && (
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={allDepartments}
                onChange={(e) => setAllDepartments(e.target.checked)}
              />
              All departments
            </label>
          )}
        </div>
      </div>

      {grouped ? (
        sections.total === 0 ? (
          <EmptyState
            icon="📚"
            title="No courses here yet"
            description={
              allDepartments
                ? 'No published courses are available.'
                : `No courses have been published for ${department.name} yet. Try “All departments”.`
            }
          />
        ) : (
          <div className="space-y-8">
            {sections.bySemester.map(({ semester, courses: semesterCourses }) => (
              <section key={semester} aria-labelledby={`semester-${semester}`}>
                <h2
                  id={`semester-${semester}`}
                  className="mb-3 text-lg font-semibold text-slate-900"
                >
                  Semester {semester}
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {semesterCourses.length} course{semesterCourses.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <CourseGrid courses={semesterCourses} />
              </section>
            ))}

            {sections.other.length > 0 && (
              <section aria-labelledby="other-courses">
                <h2 id="other-courses" className="mb-3 text-lg font-semibold text-slate-900">
                  Other courses
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    not tied to a semester
                  </span>
                </h2>
                <CourseGrid courses={sections.other} />
              </section>
            )}
          </div>
        )
      ) : courses.length === 0 ? (
        <EmptyState
          icon="📚"
          title="No published courses yet"
          description="Once an instructor publishes a course it appears here."
        />
      ) : (
        <CourseGrid courses={courses} />
      )}
    </div>
  );
};
