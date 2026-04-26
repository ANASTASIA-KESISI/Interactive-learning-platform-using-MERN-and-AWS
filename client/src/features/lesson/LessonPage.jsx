import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getLesson } from '../../services/lessons.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

// Sprint-2 scope: read-only lesson reader for `type === 'tutorial'`.
// The interactive split-pane with Monaco + hint reveal + submit arrives in Sprint 3.
export const LessonPage = () => {
  const { id } = useParams();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLesson(null);
    setError(null);
    getLesson(id)
      .then(setLesson)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, [id]);

  if (error) return <ErrorBanner message={error} />;
  if (!lesson) return <Spinner />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/courses" className="text-sm text-brand-600 hover:text-brand-700">
        ← Courses
      </Link>

      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            {lesson.type}
          </span>
          <span className="text-slate-500">{lesson.xpReward} XP</span>
        </div>
        <h1 className="text-3xl font-semibold text-slate-900">{lesson.title}</h1>
      </header>

      {lesson.type === 'exercise' ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The interactive editor for code exercises ships in Sprint 3. For now, this is the
          read-only lesson content.
        </div>
      ) : null}

      <article className="prose prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {lesson.content || '_(This lesson has no content yet.)_'}
        </ReactMarkdown>
      </article>
    </div>
  );
};
