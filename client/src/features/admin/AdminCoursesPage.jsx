import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { listAllCourses, setCoursePublished } from '../../services/admin.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';

export const AdminCoursesPage = () => {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(
    () =>
      listAllCourses()
        .then(setCourses)
        .catch((err) => setError(err.response?.data?.error?.message || err.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const togglePublished = async (course) => {
    setSavingId(course._id);
    setError(null);
    try {
      await setCoursePublished(course._id, !course.isPublished);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Courses</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every course on the platform, including unpublished drafts. Unpublishing hides a
          course from browsing; enrolled learners keep their progress.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      {!courses ? (
        <Spinner />
      ) : courses.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No courses have been created yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2">Course</th>
                <th scope="col" className="px-4 py-2">Instructor</th>
                <th scope="col" className="px-4 py-2 text-right">Enrolled</th>
                <th scope="col" className="px-4 py-2">Status</th>
                <th scope="col" className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courses.map((c) => (
                <tr key={c._id}>
                  <td className="px-4 py-2">
                    <Link
                      to={`/courses/${c._id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {c.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {c.category || 'Uncategorised'} · {titleCase(c.difficulty)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.instructor
                      ? [c.instructor.firstName, c.instructor.lastName].filter(Boolean).join(' ') ||
                        c.instructor.email
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.enrollmentCount ?? 0}</td>
                  <td className="px-4 py-2">
                    {c.isPublished ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Published
                      </span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      className="btn-ghost text-sm"
                      disabled={savingId === c._id}
                      onClick={() => togglePublished(c)}
                    >
                      {savingId === c._id
                        ? 'Saving…'
                        : c.isPublished
                          ? 'Unpublish'
                          : 'Publish'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
