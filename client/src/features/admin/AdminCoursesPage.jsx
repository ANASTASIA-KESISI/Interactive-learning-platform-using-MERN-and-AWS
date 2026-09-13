import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { listAllCourses, setCoursePublished, deleteCourse } from '../../services/admin.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { Modal } from '../../components/ui/index.js';
import { titleCase } from '../../lib/labels.js';

const errorMessage = (err) => err.response?.data?.error?.message || err.message;

export const AdminCoursesPage = () => {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [savingId, setSavingId] = useState(null);
  // The course awaiting delete confirmation (D9: Modal, not window.confirm).
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

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

  // Publishing can be refused with a 409 that names the missing module or
  // lesson (S8 D1); the message is shown verbatim so the admin knows what the
  // instructor still has to add. Unpublishing always succeeds.
  const togglePublished = async (course) => {
    setSavingId(course._id);
    setError(null);
    setNotice(null);
    try {
      await setCoursePublished(course._id, !course.isPublished);
      await load();
    } catch (err) {
      const message = errorMessage(err);
      setError(
        err.response?.status === 409 ? `“${course.title}” cannot be published: ${message}` : message,
      );
    } finally {
      setSavingId(null);
    }
  };

  // Drafts only — the button is disabled on a published row and the server
  // refuses with 409 regardless (S8 D2). Learner progress records are kept.
  const runDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await deleteCourse(confirm._id);
      setConfirm(null);
      await load();
      setNotice(`Deleted “${confirm.title}”.`);
    } catch (err) {
      setError(errorMessage(err));
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Courses</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every course on the platform, including unpublished drafts. Unpublishing hides a
          course from browsing; enrolled learners keep their progress. Only drafts can be
          deleted — unpublish first.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <p role="status" className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}

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
                    <div className="flex items-center justify-end gap-1">
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
                      <button
                        type="button"
                        className="btn-ghost text-sm text-red-700 hover:bg-red-50"
                        disabled={c.isPublished || savingId === c._id}
                        title={c.isPublished ? 'Unpublish the course before deleting it' : undefined}
                        onClick={() => setConfirm(c)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <Modal title={`Delete “${confirm.title}”?`} onClose={() => setConfirm(null)}>
          <p className="text-sm text-slate-600">
            This removes the course with all of its modules, lessons, notes and messages, and
            unenrols every learner. Learner progress records are kept for the pilot&rsquo;s
            evaluation. This cannot be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setConfirm(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn bg-red-600 text-white hover:bg-red-700"
              onClick={runDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};
