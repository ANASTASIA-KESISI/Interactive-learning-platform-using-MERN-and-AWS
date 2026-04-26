import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { listMyCourses } from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

export const InstructorDashboardPage = () => {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listMyCourses()
      .then(setCourses)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!courses) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold text-slate-900">My courses</h1>
        <Link to="/instructor/courses/new" className="btn-primary">
          + New course
        </Link>
      </div>

      {courses.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">
          You haven&apos;t created any courses yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {courses.map((course) => (
            <li
              key={course._id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{course.title}</h2>
                  {course.isPublished ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Published
                    </span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Draft
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600 line-clamp-1">{course.description}</p>
                <div className="mt-1 text-xs text-slate-500">
                  {course.category} · {course.difficulty} · {course.enrollmentCount || 0} enrolled
                </div>
              </div>
              <Link
                to={`/instructor/courses/${course._id}`}
                className="btn-ghost"
              >
                Edit →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
