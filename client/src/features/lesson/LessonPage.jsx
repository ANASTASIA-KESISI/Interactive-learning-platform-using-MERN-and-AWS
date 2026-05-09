import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';

import { getLesson, revealHint, submitCode } from '../../services/lessons.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

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
    <div className="space-y-6">
      <div>
        <Link to="/courses" className="text-sm text-brand-600 hover:text-brand-700">
          ← Courses
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            {lesson.type}
          </span>
          <span className="text-slate-500">{lesson.xpReward} XP</span>
        </div>
        <h1 className="text-3xl font-semibold text-slate-900">{lesson.title}</h1>
      </header>

      {lesson.type === 'exercise'
        ? <ExerciseView lesson={lesson} />
        : <ReadOnlyView lesson={lesson} />}
    </div>
  );
};

const ReadOnlyView = ({ lesson }) => (
  <article className="prose prose-slate max-w-none">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {lesson.content || '_(This lesson has no content yet.)_'}
    </ReactMarkdown>
  </article>
);

const ExerciseView = ({ lesson }) => {
  const [code, setCode] = useState(lesson.codeTemplate || '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState(null);

  const handleRun = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await submitCode(lesson._id, code);
      setResult(res);
    } catch (err) {
      setRunError(err.response?.data?.error?.message || err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleReset = () => {
    setCode(lesson.codeTemplate || '');
    setResult(null);
    setRunError(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-6">
        <article className="prose prose-slate max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {lesson.content || '_(This lesson has no content yet.)_'}
          </ReactMarkdown>
        </article>

        {lesson.hints && lesson.hints.length > 0 && (
          <HintList lessonId={lesson._id} hints={lesson.hints} />
        )}
      </section>

      <section className="space-y-3">
        <div className="overflow-hidden rounded-md border border-slate-300">
          <Editor
            height="420px"
            defaultLanguage={lesson.language || 'javascript'}
            value={code}
            onChange={(v) => setCode(v ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={handleRun} disabled={running} className="btn-primary">
            {running ? 'Running…' : 'Run'}
          </button>
          <button type="button" onClick={handleReset} disabled={running} className="btn-ghost">
            Reset
          </button>
        </div>

        {runError && <ErrorBanner message={runError} />}

        {result && <OutputPanel result={result} />}
      </section>
    </div>
  );
};

const HintList = ({ lessonId, hints }) => {
  const [revealedCount, setRevealedCount] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState(null);

  const handleReveal = async () => {
    const next = revealedCount;
    setRevealing(true);
    setRevealError(null);
    try {
      await revealHint(lessonId, next);
      setRevealedCount(next + 1);
    } catch (err) {
      setRevealError(err.response?.data?.error?.message || err.message);
    } finally {
      setRevealing(false);
    }
  };

  const allRevealed = revealedCount >= hints.length;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Hints</h2>

      <ol className="space-y-2 text-sm">
        {hints.slice(0, revealedCount).map((hint, i) => (
          <li key={i} className="rounded bg-slate-50 p-2 text-slate-800">
            <span className="mr-2 font-medium text-slate-500">#{i + 1}</span>
            {hint}
          </li>
        ))}
      </ol>

      {revealError && <div className="mt-2 text-sm text-red-700">{revealError}</div>}

      {!allRevealed && (
        <button
          type="button"
          onClick={handleReveal}
          disabled={revealing}
          className="btn-ghost mt-3 text-sm"
        >
          {revealing
            ? 'Revealing…'
            : revealedCount === 0
              ? 'Reveal first hint'
              : `Reveal hint #${revealedCount + 1}`}
        </button>
      )}
      {allRevealed && hints.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">All hints revealed.</p>
      )}
    </div>
  );
};

const OutputPanel = ({ result }) => {
  const { execution, xpDelta, newBadges } = result;
  const passed = execution.passed;

  return (
    <div className="space-y-2">
      <div
        className={`rounded-md px-3 py-2 text-sm font-medium ${
          passed
            ? 'bg-green-50 text-green-800'
            : 'bg-amber-50 text-amber-900'
        }`}
      >
        {passed ? '✓ Passed — output matches expected' : '✗ Output did not match expected'}
        {passed && xpDelta > 0 && (
          <span className="ml-2 font-normal">+{xpDelta} XP</span>
        )}
      </div>

      {execution.error && (
        <pre className="overflow-x-auto rounded-md bg-red-50 p-3 font-mono text-xs text-red-800">
          {execution.error}
        </pre>
      )}

      {execution.stdout && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">stdout</div>
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
            {execution.stdout}
          </pre>
        </div>
      )}

      {newBadges && newBadges.length > 0 && (
        <div className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
          New badge{newBadges.length > 1 ? 's' : ''}: {newBadges.map((b) => b.name).join(', ')}
        </div>
      )}
    </div>
  );
};
