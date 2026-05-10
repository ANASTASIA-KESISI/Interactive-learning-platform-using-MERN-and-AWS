import { Link, Navigate, useLocation, useParams } from 'react-router-dom';

// Celebration screen shown after a passing submission. Receives the run
// result and lesson context via router state from LessonPage. If the user
// lands here directly (e.g. refresh, deep link), state is missing and we
// bounce them back to the lesson — there's nothing to celebrate without it.
export const LessonCompletePage = () => {
  const { id } = useParams();
  const { state } = useLocation();

  if (!state) return <Navigate to={`/lessons/${id}`} replace />;

  const {
    lessonTitle,
    courseId,
    courseTitle,
    xpDelta = 0,
    xpReward = 0,
    hintsUsed = 0,
    newBadges = [],
  } = state;

  const discounted = xpDelta > 0 && xpReward > 0 && xpDelta < xpReward;
  const fullCredit = xpDelta > 0 && xpDelta === xpReward;

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
        <div className="text-5xl">🎉</div>
        <h1 className="mt-3 text-3xl font-semibold text-green-900">Lesson complete</h1>
        {lessonTitle && (
          <p className="mt-1 text-sm text-green-800">{lessonTitle}</p>
        )}

        {xpDelta > 0 && (
          <div className="mt-6 inline-flex items-baseline gap-2 rounded-full bg-white px-5 py-2 shadow-sm">
            <span className="text-3xl font-bold text-amber-600">+{xpDelta}</span>
            <span className="text-sm font-medium text-slate-600">XP</span>
          </div>
        )}

        {discounted && (
          <p className="mt-3 text-xs text-slate-600">
            {xpDelta} of {xpReward} XP — {hintsUsed} hint{hintsUsed === 1 ? '' : 's'} used
            ({hintsUsed === 1 ? '50%' : '20%'} of full reward)
          </p>
        )}
        {fullCredit && hintsUsed === 0 && (
          <p className="mt-3 text-xs text-slate-600">Full XP — no hints used.</p>
        )}
      </div>

      {newBadges.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-900">
            🏅 New badge{newBadges.length > 1 ? 's' : ''} unlocked
          </h2>
          <ul className="mt-3 space-y-3">
            {newBadges.map((b) => (
              <li
                key={b.id}
                className="flex items-start gap-3 rounded-md bg-white p-3 shadow-sm"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">
                  {b.icon || '🏅'}
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{b.name}</div>
                  {b.description && (
                    <div className="text-sm text-slate-600">{b.description}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        {courseId ? (
          <Link to={`/courses/${courseId}`} className="btn-primary">
            ← Back to {courseTitle || 'course'}
          </Link>
        ) : (
          <Link to="/courses" className="btn-primary">
            ← Back to courses
          </Link>
        )}
        <Link to={`/lessons/${id}`} className="btn-ghost">
          Review lesson
        </Link>
        <Link to="/" className="btn-ghost">
          Dashboard
        </Link>
      </div>
    </div>
  );
};
