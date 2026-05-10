import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { enrollInCourse, getCourse } from '../../services/courses.js';
import { getStudentProgress } from '../../services/student.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { useAuth } from '../../hooks/useAuth.js';

export const CourseDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [course, setCourse] = useState(null);
  const [completedLessonIds, setCompletedLessonIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    setCourse(null);
    setError(null);
    getCourse(id)
      .then(setCourse)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, [id]);

  useEffect(() => {
    if (user?.role !== 'student') return;
    getStudentProgress()
      .then((records) => {
        setCompletedLessonIds(
          new Set(records.filter((r) => r.status === 'completed').map((r) => r.lessonId)),
        );
      })
      .catch(() => {
        // Non-fatal: course page still renders without checkmarks if progress fetch fails.
      });
  }, [id, user?.role]);

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      await enrollInCourse(id);
      const fresh = await getCourse(id);
      setCourse(fresh);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setEnrolling(false);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (!course) return <Spinner />;

  const isOwnCourse =
    user?.role === 'instructor' && course.instructor?._id === user?.dbId;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link to="/courses" className="text-sm text-brand-600 hover:text-brand-700">
          ← All courses
        </Link>
        <h1 className="text-3xl font-semibold text-slate-900">{course.title}</h1>
        <p className="text-slate-600">{course.description}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          {course.category && <span>{course.category}</span>}
          <span>·</span>
          <span>{course.difficulty}</span>
          <span>·</span>
          <span>
            {course.instructor?.firstName} {course.instructor?.lastName}
          </span>
          <span>·</span>
          <span>{course.enrollmentCount || 0} enrolled</span>
          {!course.isPublished && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Draft
            </span>
          )}
        </div>

        {user?.role === 'student' && (
          <button
            type="button"
            className="btn-primary mt-4"
            onClick={handleEnroll}
            disabled={enrolling}
          >
            {enrolling ? 'Enrolling…' : 'Enrol in this course'}
          </button>
        )}
        {isOwnCourse && (
          <button
            type="button"
            className="btn-ghost mt-4"
            onClick={() => navigate(`/instructor/courses/${course._id}`)}
          >
            Edit course
          </button>
        )}
      </header>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-slate-900">Modules</h2>
        {(!course.modules || course.modules.length === 0) ? (
          <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            This course has no modules yet.
          </p>
        ) : (
          <ol className="space-y-4">
            {course.modules.map((mod, i) => (
              <li key={mod._id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">
                  {i + 1}. {mod.title}
                </h3>
                {mod.lessons && mod.lessons.length > 0 ? (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {mod.lessons.map((lesson) => {
                      const completed = completedLessonIds.has(lesson._id.toString());
                      return (
                        <li key={lesson._id} className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2">
                            {completed ? (
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700"
                                title="Completed"
                                aria-label="Completed"
                              >
                                ✓
                              </span>
                            ) : (
                              <span
                                className="h-5 w-5 rounded-full border border-slate-300"
                                aria-hidden="true"
                              />
                            )}
                            <Link
                              to={`/lessons/${lesson._id}`}
                              className={`font-medium hover:text-brand-700 ${
                                completed ? 'text-slate-500 line-through' : 'text-slate-800'
                              }`}
                            >
                              {lesson.title}
                            </Link>
                            <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                              {lesson.type}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500">{lesson.xpReward} XP</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No lessons in this module yet.</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
};
