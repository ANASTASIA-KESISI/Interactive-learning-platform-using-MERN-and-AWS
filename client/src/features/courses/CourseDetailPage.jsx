import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { enrollInCourse, getCourse, getCourseLeaderboard } from '../../services/courses.js';
import { getStudentProgress } from '../../services/student.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';
import { Avatar, Card, Chip, EmptyState, ProgressBar } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';

const DIFFICULTY_TONES = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'danger',
};

const LESSON_TYPE_TONES = {
  exercise: 'brand',
  tutorial: 'neutral',
  quiz: 'warning',
};

const fullName = (person, fallback = 'Instructor') =>
  [person?.firstName, person?.lastName].filter(Boolean).join(' ') || fallback;

// ── Leaderboard rail (S7 D9) ──────────────────────────────────────────────────

const WINDOW_LABELS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const MEDALS = ['🥇', '🥈', '🥉'];

const CourseLeaderboard = ({ courseId, viewerName, showMe }) => {
  const [window, setWindow] = useState('7d');
  const [board, setBoard] = useState(null);
  // A viewer who is neither enrolled, the owner, nor an admin gets a 403. That
  // is an expected state, not an error: the rail simply disappears.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBoard(null);
    getCourseLeaderboard(courseId, window)
      .then((data) => {
        if (!cancelled) setBoard(data);
      })
      .catch(() => {
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, window]);

  if (hidden) return null;

  const inTop = board?.top?.some((row) => row.rank === board.me?.rank);

  return (
    <Card
      title="🏆 Course leaderboard"
      action={
        <div className="flex items-center gap-2">
          <label htmlFor="leaderboard-window" className="sr-only">
            Leaderboard period
          </label>
          <select
            id="leaderboard-window"
            className="field w-auto py-1 text-xs"
            value={window}
            onChange={(e) => setWindow(e.target.value)}
          >
            {WINDOW_LABELS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">Most XP earned in this course</p>

      {!board ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : board.top.length === 0 ? (
        <p className="text-sm text-slate-500">No XP earned in this period yet.</p>
      ) : (
        <ol className="space-y-1">
          {board.top.map((row) => (
            <li
              key={row.userId}
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${
                row.rank === board.me?.rank ? 'bg-brand-50' : ''
              }`}
            >
              <span className="w-5 shrink-0 text-center text-sm text-slate-500" aria-hidden="true">
                {MEDALS[row.rank - 1] || row.rank}
              </span>
              <span className="sr-only">Rank {row.rank}</span>
              <Avatar src={row.avatar} name={row.displayName} size="sm" />
              <span className="flex-1 truncate text-sm text-slate-800">{row.displayName}</span>
              <span className="text-sm font-semibold text-slate-900">{row.xp} XP</span>
            </li>
          ))}
        </ol>
      )}

      {board && showMe && !inTop && (
        <div className="mt-3 flex items-center gap-3 rounded-md border-t border-slate-100 bg-slate-50 px-2 py-1.5 pt-3">
          <span className="w-5 shrink-0 text-center text-sm text-slate-500">
            {board.me.rank ?? '–'}
          </span>
          <Avatar name={viewerName} size="sm" />
          <span className="flex-1 truncate text-sm text-slate-800">
            {viewerName}
            <Chip tone="brand" className="ml-2">
              You
            </Chip>
          </span>
          <span className="text-sm font-semibold text-slate-900">{board.me.xp} XP</span>
        </div>
      )}
    </Card>
  );
};

// ── Course content accordion ──────────────────────────────────────────────────

const ModuleAccordion = ({ modules, moduleIndex, open, onToggle, completedLessonIds }) => {
  const module = modules[moduleIndex];
  const lessons = module.lessons || [];
  const panelId = `module-panel-${module._id}`;
  const buttonId = `module-toggle-${module._id}`;

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50"
        >
          <span className="font-semibold text-slate-900">
            {moduleIndex + 1}. {module.title}
          </span>
          <span className="flex shrink-0 items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
            {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
            <span aria-hidden="true" className="text-slate-400">
              {open ? '▲' : '▼'}
            </span>
          </span>
        </button>
      </h3>

      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open}>
        {lessons.length === 0 ? (
          <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
            No lessons in this module yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {lessons.map((lesson, i) => {
              const completed = completedLessonIds.has(lesson._id.toString());
              return (
                <li
                  key={lesson._id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {completed ? (
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700"
                        title="Completed"
                        aria-label="Completed"
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        className="h-5 w-5 shrink-0 rounded-full border border-slate-300"
                        aria-hidden="true"
                      />
                    )}
                    <span className="shrink-0 text-sm tabular-nums text-slate-500">
                      {moduleIndex + 1}.{i + 1}
                    </span>
                    <Link
                      to={`/lessons/${lesson._id}`}
                      className={`truncate font-medium hover:text-brand-700 ${
                        completed ? 'text-slate-500' : 'text-slate-800'
                      }`}
                    >
                      {lesson.title}
                    </Link>
                    <Chip tone={LESSON_TYPE_TONES[lesson.type] || 'neutral'}>{titleCase(lesson.type)}</Chip>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">{lesson.xpReward} XP</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

export const CourseDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [course, setCourse] = useState(null);
  const [completedLessonIds, setCompletedLessonIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [enrolling, setEnrolling] = useState(false);
  const [openModuleId, setOpenModuleId] = useState(null);

  const load = useCallback(
    () =>
      getCourse(id)
        .then((data) => {
          setCourse(data);
          // First module open, the rest collapsed (S7 §4 P1-B).
          setOpenModuleId((current) => current ?? data.modules?.[0]?._id ?? null);
          return data;
        })
        .catch((err) => setError(err.response?.data?.error?.message || err.message)),
    [id],
  );

  useEffect(() => {
    setCourse(null);
    setError(null);
    setOpenModuleId(null);
    load();
  }, [load]);

  useEffect(() => {
    if (user?.role !== 'student') return;
    getStudentProgress()
      .then((records) => {
        setCompletedLessonIds(
          new Set(records.filter((r) => r.status === 'completed').map((r) => r.lessonId)),
        );
      })
      .catch(() => {
        // Non-fatal: the page still renders without ticks if progress fails.
      });
  }, [id, user?.role]);

  // Flattened lesson order drives both the "1.2" numbering and the Continue
  // deep link — the CTA points at the first lesson the learner has not passed.
  const orderedLessons = useMemo(
    () => (course?.modules || []).flatMap((m) => m.lessons || []),
    [course],
  );
  const nextLesson = useMemo(
    () =>
      orderedLessons.find((l) => !completedLessonIds.has(l._id.toString())) ||
      orderedLessons[0] ||
      null,
    [orderedLessons, completedLessonIds],
  );
  const completedCount = orderedLessons.filter((l) =>
    completedLessonIds.has(l._id.toString()),
  ).length;

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      await enrollInCourse(id);
      // Re-read the course (its `viewerEnrolled` flips) and refresh the shell's
      // profile so the CTA and the leaderboard appear without a reload.
      await load();
      await refreshProfile().catch(() => null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setEnrolling(false);
    }
  };

  if (error && !course) return <ErrorBanner message={error} />;
  if (!course) return <Spinner />;

  const isStudent = user?.role === 'student';
  const isOwnCourse =
    (user?.role === 'instructor' || user?.role === 'admin') &&
    String(course.instructor?.id || course.instructor?._id || '') === String(user?.dbId || '');
  const enrolled = Boolean(course.viewerEnrolled);
  const canStart = Boolean(nextLesson) && (enrolled || !isStudent);
  const started = completedCount > 0;
  const showLeaderboard = enrolled || isOwnCourse || user?.role === 'admin';

  return (
    <div className="space-y-6">
      <Link to="/courses" className="inline-block text-sm text-brand-600 hover:text-brand-700">
        ← All courses
      </Link>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          {/* Hero */}
          <Card>
            <div className="flex items-start gap-4">
              {course.icon && (
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-3xl"
                  aria-hidden="true"
                >
                  {course.icon}
                </span>
              )}
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
                  {course.title}
                </h1>
                <p className="mt-2 text-slate-600">{course.description}</p>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                  <span className="flex items-center gap-2">
                    <Avatar
                      src={course.instructor?.avatar}
                      name={fullName(course.instructor)}
                      size="sm"
                    />
                    Taught by <strong className="font-medium">{fullName(course.instructor)}</strong>
                  </span>
                  <span>{course.enrollmentCount || 0} enrolled</span>
                  <span>
                    {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Chip tone={DIFFICULTY_TONES[course.difficulty] || 'neutral'}>
                    {titleCase(course.difficulty)}
                  </Chip>
                  {course.semester && <Chip tone="brand">Semester {course.semester}</Chip>}
                  {course.department && <Chip>{course.department.name}</Chip>}
                  {course.category && <Chip>{course.category}</Chip>}
                  {!course.isPublished && <Chip tone="warning">Draft</Chip>}
                </div>
              </div>
            </div>
          </Card>

          {/* Primary CTA */}
          <Card className="bg-brand-50/40">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  Start learning
                </p>
                <p className="mt-1 font-semibold text-slate-900">
                  Build real skills one lesson at a time
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {canStart && nextLesson
                    ? `Next up: ${nextLesson.title}`
                    : 'Explore the curriculum below, then enrol to start.'}
                </p>
                {enrolled && orderedLessons.length > 0 && (
                  <div className="mt-3 max-w-xs">
                    <ProgressBar
                      value={Math.round((completedCount / orderedLessons.length) * 100)}
                      label={`${completedCount} of ${orderedLessons.length} lessons`}
                    />
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {isStudent && !enrolled && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleEnroll}
                    disabled={enrolling}
                  >
                    {enrolling ? 'Enrolling…' : 'Enrol in this course'}
                  </button>
                )}
                {canStart && (
                  <Link to={`/lessons/${nextLesson._id}`} className="btn-primary">
                    {started ? 'Continue' : 'Start course'}
                  </Link>
                )}
                {isOwnCourse && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => navigate(`/instructor/courses/${course._id}`)}
                  >
                    Edit course
                  </button>
                )}
              </div>
            </div>
          </Card>

          {/* About */}
          {course.about ? (
            <section aria-labelledby="about-course">
              <h2 id="about-course" className="mb-3 text-lg font-semibold text-slate-900">
                About this course
              </h2>
              <Card>
                <article className="prose prose-slate max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{course.about}</ReactMarkdown>
                </article>
              </Card>
            </section>
          ) : null}

          {/* Instructor */}
          {course.instructor && (
            <Card>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                Course instructor
              </p>
              <div className="mt-3 flex items-start gap-4">
                <Avatar
                  src={course.instructor.avatar}
                  name={fullName(course.instructor)}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-slate-900">
                    {fullName(course.instructor)}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {course.instructor.bio || 'This instructor has not added a bio yet.'}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Content accordion */}
          <section aria-labelledby="course-content">
            <h2 id="course-content" className="mb-3 text-lg font-semibold text-slate-900">
              Course content
            </h2>
            {!course.modules || course.modules.length === 0 ? (
              <EmptyState
                icon="🗂️"
                title="No modules yet"
                description="This course has no content published yet."
              />
            ) : (
              <ul className="space-y-3">
                {course.modules.map((mod, i) => (
                  <ModuleAccordion
                    key={mod._id}
                    modules={course.modules}
                    moduleIndex={i}
                    open={openModuleId === mod._id}
                    onToggle={() =>
                      setOpenModuleId((current) => (current === mod._id ? null : mod._id))
                    }
                    completedLessonIds={completedLessonIds}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right rail — stacks under the content below `lg` */}
        {showLeaderboard && (
          <aside className="min-w-0 space-y-4">
            <CourseLeaderboard
              courseId={id}
              viewerName={fullName(user, user?.email || 'You')}
              showMe={isStudent}
            />
          </aside>
        )}
      </div>
    </div>
  );
};
