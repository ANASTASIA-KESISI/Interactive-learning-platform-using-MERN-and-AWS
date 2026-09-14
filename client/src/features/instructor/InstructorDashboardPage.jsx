import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listMyCourses } from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { Chip, EmptyState } from '../../components/ui/index.js';
import { titleCase } from '../../lib/labels.js';

// The authoring home. Courses are grouped by the semester they are taught in,
// because that is how a department timetables them and how a student browses
// them — a flat list gave no clue that "semester" was even a property a course
// had, let alone one the instructor is expected to set.

// Courses with no semester sort last under their own heading, so an unplaced
// course is visible as unplaced rather than quietly filed under Semester 1.
const UNPLACED = 'unplaced';

const groupBySemester = (courses) => {
  const groups = new Map();

  courses.forEach((course) => {
    const key = Number.isInteger(course.semester) ? course.semester : UNPLACED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(course);
  });

  return [...groups.entries()].sort(([a], [b]) => {
    if (a === UNPLACED) return 1;
    if (b === UNPLACED) return -1;
    return a - b;
  });
};

const CourseCard = ({ course }) => {
  const department = course.departmentId?.name || null;

  return (
    <li className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xl"
          >
            {course.icon || '📘'}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-slate-900">{course.title}</h3>
              <Chip tone={course.isPublished ? 'success' : 'warning'}>
                {course.isPublished ? 'Published' : 'Draft'}
              </Chip>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">{course.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              {department && <span className="truncate">{department}</span>}
              {department && <span aria-hidden="true">·</span>}
              <span>{titleCase(course.difficulty)}</span>
              {course.category && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{titleCase(course.category)}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>
                {course.enrollmentCount || 0} enrolled
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            to={`/instructor/courses/${course._id}`}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            Edit
          </Link>
          <Link
            to={`/instructor/courses/${course._id}/analytics`}
            className="text-xs text-brand-600 hover:text-brand-700"
          >
            Analytics →
          </Link>
        </div>
      </div>
    </li>
  );
};

export const InstructorDashboardPage = () => {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listMyCourses()
      .then(setCourses)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, []);

  const groups = useMemo(() => groupBySemester(courses || []), [courses]);
  const unplacedCount = (courses || []).filter((c) => !Number.isInteger(c.semester)).length;

  if (error) return <ErrorBanner message={error} />;
  if (!courses) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">My courses</h1>
          <p className="mt-1 text-sm text-slate-600">
            Grouped by the semester each course is taught in.
          </p>
        </div>
        <Link to="/instructor/courses/new" className="btn-primary">
          + New course
        </Link>
      </div>

      {courses.length === 0 ? (
        <EmptyState
          icon="📘"
          title="No courses yet"
          description="Create your first course, assign it to a department and semester, then add modules and lessons."
        />
      ) : (
        <>
          {unplacedCount > 0 && (
            <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {unplacedCount} course{unplacedCount === 1 ? '' : 's'} not assigned to a semester.
              Students browse by semester, so an unassigned course is harder to find. Open it and
              set its department and semester.
            </p>
          )}

          <div className="space-y-8">
            {groups.map(([semester, semesterCourses]) => (
              <section key={semester} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {semester === UNPLACED ? 'No semester assigned' : `Semester ${semester}`}
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {semesterCourses.length}
                  </span>
                  <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                </div>

                <ul className="grid gap-3 xl:grid-cols-2">
                  {semesterCourses.map((course) => (
                    <CourseCard key={course._id} course={course} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
