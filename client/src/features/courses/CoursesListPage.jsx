import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { listCourses } from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

const DIFFICULTY_STYLES = {
  beginner: 'bg-green-100 text-green-800',
  intermediate: 'bg-yellow-100 text-yellow-800',
  advanced: 'bg-red-100 text-red-800',
};

export const CoursesListPage = () => {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState('');

  useEffect(() => {
    setCourses(null);
    setError(null);
    listCourses(category ? { category } : {})
      .then(setCourses)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, [category]);

  const categories = useMemo(() => {
    if (!courses) return [];
    return Array.from(new Set(courses.map((c) => c.category).filter(Boolean)));
  }, [courses]);

  if (error) return <ErrorBanner message={error} />;
  if (!courses) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Courses</h1>
          <p className="mt-1 text-slate-600">Browse published courses and enrol to start learning.</p>
        </div>

        {categories.length > 0 && (
          <div>
            <label htmlFor="category" className="label">Category</label>
            <select
              id="category"
              className="field"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {courses.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No published courses yet.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course._id}>
              <Link
                to={`/courses/${course._id}`}
                className="block h-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-500 hover:shadow"
              >
                <div className="flex items-center justify-between">
                  {course.category && (
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {course.category}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      DIFFICULTY_STYLES[course.difficulty] || 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {course.difficulty}
                  </span>
                </div>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">{course.title}</h2>
                <p className="mt-2 line-clamp-3 text-sm text-slate-600">{course.description}</p>
                <div className="mt-4 text-xs text-slate-500">
                  {course.enrollmentCount || 0} enrolled ·{' '}
                  {course.instructor?.firstName
                    ? `${course.instructor.firstName} ${course.instructor.lastName}`
                    : 'Instructor'}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
