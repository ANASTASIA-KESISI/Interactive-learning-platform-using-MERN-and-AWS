import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';

import { getLesson, revealHint, runCode, submitCode } from '../../services/lessons.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';
import { Card, Chip, EmptyState, Tabs } from '../../components/ui/index.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useTimeOnTask } from '../../hooks/useTimeOnTask.js';
import { LessonNotesPanel } from '../notes/LessonNotesPanel.jsx';
import { ChatDock } from '../messages/ChatDock.jsx';
import { CompletionOverlay } from './CompletionOverlay.jsx';
import { QuizLessonView } from './QuizView.jsx';

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

export const LessonPage = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState(null);
  // The chat lives at page level, not inside a layout, so every lesson type
  // gets it and the Challenge tab's "Ask your instructor" can open it.
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    setLesson(null);
    setError(null);
    setChatOpen(false);
    getLesson(id)
      .then(setLesson)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  // Above the early returns, or the hook order changes the moment the lesson
  // finishes loading. Students only: an instructor previewing their own lesson
  // must not land in the pilot's engagement data (the server ignores them too,
  // but there is no reason to make the request).
  useTimeOnTask(id, { enabled: user?.role === 'student' });

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4">
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (!lesson) return <Spinner />;

  const dock = (
    <ChatDock
      courseId={lesson.courseId}
      lessonId={lesson._id}
      instructor={lesson.instructor}
      open={chatOpen}
      onOpenChange={setChatOpen}
    />
  );

  // `key` remounts the whole workspace when the learner walks to the next
  // lesson: editor buffer, hints, output and tab state all belong to one
  // lesson and must not bleed into the next.
  const body =
    lesson.type === 'exercise' ? (
      <ExerciseWorkspace
        key={lesson._id}
        lesson={lesson}
        onAskInstructor={() => setChatOpen(true)}
      />
    ) : lesson.type === 'quiz' ? (
      <QuizLessonView
        key={lesson._id}
        lesson={lesson}
        header={<LessonHeader lesson={lesson} />}
        nav={<LessonNav lesson={lesson} />}
      />
    ) : (
      <ReadingView key={lesson._id} lesson={lesson} />
    );

  return (
    <>
      {body}
      {dock}
    </>
  );
};

// ── Reading lessons (tutorial) ───────────────────────────────────────────────
// The old single-column layout, plus the notes section every lesson now has.
const ReadingView = ({ lesson }) => (
  <div className="mx-auto max-w-3xl space-y-6 px-4">
    <LessonHeader lesson={lesson} />

    <article className="prose prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {lesson.content || '_(This lesson has no content yet.)_'}
      </ReactMarkdown>
    </article>

    {/* The panel sizes itself to its container, so the container is what
        decides how much room a reading lesson's notes get. */}
    <Card title="Your notes">
      <div className="h-56">
        <LessonNotesPanel lessonId={lesson._id} className="h-full" />
      </div>
    </Card>

    <LessonNav lesson={lesson} />
  </div>
);

const LessonHeader = ({ lesson, compact = false }) => (
  <header className={compact ? 'min-w-0' : 'space-y-2'}>
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <Link
        to={lesson.courseId ? `/courses/${lesson.courseId}` : '/courses'}
        className="text-brand-600 hover:text-brand-700"
      >
        ← {lesson.courseTitle || 'Courses'}
      </Link>
      {lesson.moduleTitle && <span className="truncate">· {lesson.moduleTitle}</span>}
      <Chip>{titleCase(lesson.type)}</Chip>
      <span>{lesson.xpReward} XP</span>
    </div>
    <h1
      className={
        compact
          ? 'truncate text-base font-semibold text-slate-900'
          : 'text-3xl font-semibold text-slate-900'
      }
    >
      {lesson.title}
    </h1>
  </header>
);

const LessonNav = ({ lesson }) => {
  if (!lesson.prevLessonId && !lesson.nextLessonId) return null;

  return (
    <nav aria-label="Lesson navigation" className="flex items-center justify-between gap-3 pt-2">
      {lesson.prevLessonId ? (
        <Link to={`/lessons/${lesson.prevLessonId}`} className="btn-ghost">
          ← Previous lesson
        </Link>
      ) : (
        <span />
      )}
      {lesson.nextLessonId && (
        <Link to={`/lessons/${lesson.nextLessonId}`} className="btn-primary">
          Next lesson →
        </Link>
      )}
    </nav>
  );
};

// ── Exercise workspace ───────────────────────────────────────────────────────
// Three panes at `lg`: instructional panel · editor + tests · output
// (demo_assets/lesson_page_lesson.png). Below `lg` the same three regions
// stack in reading order with the editor at a fixed height — no pane ever
// scrolls the page sideways (NFR1).

const TABS = [
  { id: 'lesson', label: 'Lesson', icon: '📖' },
  { id: 'challenge', label: 'Challenge', icon: '🎯' },
  { id: 'notes', label: 'Notes', icon: '🗒️' },
];

const fileNameFor = (language) => (language === 'python' ? 'main.py' : 'main.js');
const fileTagFor = (language) => (language === 'python' ? 'PY' : 'JS');

const ExerciseWorkspace = ({ lesson, onAskInstructor }) => {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [tab, setTab] = useState('lesson');
  const [panelOpen, setPanelOpen] = useState(true);
  const [code, setCode] = useState(lesson.codeTemplate || '');
  const [busy, setBusy] = useState(null); // 'run' | 'submit' | null
  const [output, setOutput] = useState(null); // { stdout, error, durationMs }
  const [result, setResult] = useState(null); // last /submit payload
  const [actionError, setActionError] = useState(null);
  const [celebration, setCelebration] = useState(null);

  const editorRef = useRef(null);

  const focusEditor = useCallback(() => {
    editorRef.current?.focus?.();
  }, []);

  const handleRun = useCallback(async () => {
    setBusy('run');
    setActionError(null);
    try {
      const { execution } = await runCode(lesson._id, code);
      setOutput(execution);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [lesson._id, code]);

  const handleSubmit = useCallback(async () => {
    setBusy('submit');
    setActionError(null);
    try {
      const res = await submitCode(lesson._id, code);
      // A failing submission stays inline — the learner keeps their editor
      // state and iterates. Only a FIRST pass earns the overlay: re-passing a
      // finished lesson awards nothing, so celebrating it would misreport
      // their progress.
      setResult(res);
      setOutput(res.execution);
      if (res.execution?.passed && res.progress?.firstCompletion) {
        setCelebration(res);
        // The header XP pill and rank chip are rendered from /api/me.
        refreshProfile?.().catch(() => {});
      }
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [lesson._id, code, refreshProfile]);

  const handleReset = () => {
    setCode(lesson.codeTemplate || '');
    setResult(null);
    setOutput(null);
    setActionError(null);
  };

  // Ctrl/⌘ + Enter submits from anywhere in the workspace, including from
  // inside Monaco — the affordance on the button has to be real. Monaco's own
  // input IS a textarea, so the "don't hijack typing" guard has to let it
  // through while still leaving the notes field and the instructor composer
  // alone: nobody means "submit my code" while writing a question.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;

      const target = event.target;
      const inEditor = target?.closest?.('.monaco-editor');
      if (!inEditor && target?.closest?.('textarea, input, [contenteditable="true"]')) return;

      event.preventDefault();
      if (!busy) handleSubmit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSubmit, busy]);

  const closeCelebration = () => {
    setCelebration(null);
    focusEditor();
  };

  // "Next lesson →" walks the course order the server resolved; at the end of
  // a course there is nowhere to go but back to the syllabus.
  const goToNextLesson = () => {
    setCelebration(null);
    const next = celebration?.nextLessonId || lesson.nextLessonId;
    if (next) return navigate(`/lessons/${next}`);
    return navigate(lesson.courseId ? `/courses/${lesson.courseId}` : '/courses');
  };

  return (
    <div className="flex flex-col gap-3 px-3 lg:h-[calc(100vh-9rem)] lg:min-h-[34rem] lg:px-4">
      <div className="flex items-center justify-between gap-3">
        <LessonHeader lesson={lesson} compact />
        {lesson.nextLessonId && (
          <Link to={`/lessons/${lesson.nextLessonId}`} className="btn-ghost shrink-0 text-sm">
            Next lesson →
          </Link>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <SidePanel
          lesson={lesson}
          tab={tab}
          onTabChange={setTab}
          open={panelOpen}
          onToggle={() => setPanelOpen((open) => !open)}
          onAskInstructor={onAskInstructor}
        />

        <section
          aria-label="Code editor and tests"
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
              <span className="rounded bg-amber-400 px-1 text-[10px] font-bold text-slate-900">
                {fileTagFor(lesson.language)}
              </span>
              {fileNameFor(lesson.language)}
            </span>
          </div>

          <div className="h-72 shrink-0 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
            <Editor
              height="100%"
              defaultLanguage={lesson.language || 'javascript'}
              value={code}
              onChange={(v) => setCode(v ?? '')}
              onMount={(editor) => {
                editorRef.current = editor;
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                ariaLabel: `${lesson.title} — code editor`,
              }}
            />
          </div>

          <TestsPanel
            lesson={lesson}
            result={result}
            actionError={actionError}
            busy={busy}
            onRun={handleRun}
            onSubmit={handleSubmit}
            onReset={handleReset}
          />
        </section>

        <OutputPane output={output} running={busy === 'run'} />
      </div>

      {celebration && (
        <CompletionOverlay
          xpDelta={celebration.xpDelta ?? 0}
          gamification={celebration.gamification}
          newBadges={celebration.newBadges || []}
          moduleCompleted={Boolean(celebration.moduleCompleted)}
          onNextLesson={goToNextLesson}
          onClose={closeCelebration}
        />
      )}
    </div>
  );
};

// The instructional column. Collapsing it hands the space to the editor, which
// is what a learner wants once they have read the task (the mockup's icon in
// the tab strip).
const SidePanel = ({ lesson, tab, onTabChange, open, onToggle, onAskInstructor }) => {
  if (!open) {
    return (
      <div className="flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-2 shadow-sm lg:w-12 lg:flex-col">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand lesson panel"
          aria-expanded={false}
          className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <span aria-hidden="true">⇥</span>
        </button>
        <span className="ml-2 text-xs text-slate-500 lg:hidden">Lesson · Challenge · Notes</span>
      </div>
    );
  }

  return (
    <section className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:w-[24rem] xl:w-[28rem]">
      <div className="flex items-stretch">
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={onTabChange}
          className="min-w-0 flex-1 overflow-x-auto"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse lesson panel"
          aria-expanded
          className="border-b border-slate-200 px-3 text-slate-400 hover:text-slate-700"
        >
          <span aria-hidden="true">⇤</span>
        </button>
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className={`min-h-0 flex-1 overflow-y-auto p-4 ${tab === 'notes' ? 'flex flex-col' : ''}`}
      >
        {tab === 'lesson' && <LessonTab lesson={lesson} />}
        {tab === 'challenge' && <ChallengeTab lesson={lesson} onAskInstructor={onAskInstructor} />}
        {tab === 'notes' && <LessonNotesPanel lessonId={lesson._id} className="h-full" />}
      </div>
    </section>
  );
};

// The conversation moved out of this tab and into the floating ChatDock: it
// used to push the lesson text down the page, and a reply was only readable
// from whichever tab happened to hold it.
const LessonTab = ({ lesson }) => (
  <div className="space-y-5">
    <article className="prose prose-sm prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {lesson.content || '_(This lesson has no content yet.)_'}
      </ReactMarkdown>
    </article>
  </div>
);

const ChallengeTab = ({ lesson, onAskInstructor }) => (
  <div className="space-y-5">
    <Card title="🎯 Your Task">
      <article className="prose prose-sm prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {lesson.task ||
            lesson.content ||
            '_Write your solution in the editor, then Submit to check it._'}
        </ReactMarkdown>
      </article>
    </Card>

    {lesson.hintCount > 0 && (
      <HintList
        lessonId={lesson._id}
        hintCount={lesson.hintCount}
        initialRevealed={lesson.revealedHints || []}
        xpReward={lesson.xpReward}
      />
    )}

    <button
      type="button"
      onClick={onAskInstructor}
      className="btn-ghost w-full border border-slate-200"
    >
      💬 Ask your instructor
    </button>
  </div>
);

// Hint TEXT is never bundled with the lesson — only the count, plus whichever
// hints this learner has already unlocked (replayed from their progress record
// so a refresh doesn't hide them again). Each new hint arrives from the reveal
// endpoint, which is also what logs the scaffolding event for analytics.
const HintList = ({ lessonId, hintCount, initialRevealed, xpReward = 0 }) => {
  const [hints, setHints] = useState(initialRevealed);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState(null);

  const handleReveal = async () => {
    setRevealing(true);
    setRevealError(null);
    try {
      const { hint } = await revealHint(lessonId, hints.length);
      setHints((current) => [...current, hint]);
    } catch (err) {
      setRevealError(errorMessage(err));
    } finally {
      setRevealing(false);
    }
  };

  const revealedCount = hints.length;
  const allRevealed = revealedCount >= hintCount;
  // Mirrors the server rule (0 hints → full, 1 → 50%, 2+ → 20%). Shown BEFORE
  // the reveal so the trade-off is an informed choice, which is the point of
  // scaffolding being progressive rather than free.
  const nextReward = revealedCount === 0 ? Math.round(xpReward * 0.5) : Math.round(xpReward * 0.2);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Hints</h2>
        <span className="text-xs text-slate-500">
          {revealedCount} of {hintCount} used
        </span>
      </div>

      <ol className="space-y-2 text-sm">
        {hints.map((hint, i) => (
          <li key={i} className="rounded bg-slate-50 p-2 text-slate-800">
            <span className="mr-2 font-medium text-slate-500">#{i + 1}</span>
            {hint}
          </li>
        ))}
      </ol>

      {revealError && <div className="mt-2 text-sm text-red-700">{revealError}</div>}

      {!allRevealed && (
        <div className="mt-3 space-y-1">
          <button
            type="button"
            onClick={handleReveal}
            disabled={revealing}
            className="btn-ghost border border-slate-200 text-sm"
          >
            {revealing
              ? 'Revealing…'
              : revealedCount === 0
                ? '💡 Get a hint'
                : `💡 Get hint #${revealedCount + 1}`}
          </button>
          {xpReward > 0 && (
            <p className="text-xs text-slate-500">
              Using {revealedCount === 0 ? 'a hint' : 'another hint'} lowers this lesson&apos;s
              reward to {nextReward} of {xpReward} XP.
            </p>
          )}
        </div>
      )}
      {allRevealed && hintCount > 0 && (
        <p className="mt-3 text-xs text-slate-500">All hints revealed.</p>
      )}
    </div>
  );
};

const TestsPanel = ({ lesson, result, actionError, busy, onRun, onSubmit, onReset }) => {
  const execution = result?.execution;
  const passed = execution?.passed;
  const xpDelta = result?.xpDelta ?? 0;
  const hintsUsed = result?.progress?.hintsUsed ?? 0;
  const discounted = passed && xpDelta > 0 && lesson.xpReward > 0 && xpDelta < lesson.xpReward;
  // A pass can correctly earn nothing, and both reasons used to be invisible:
  // the celebration just never appeared and nothing explained the absence.
  // Preview mode is deliberate — an instructor or admin running their own
  // lesson must not move learner metrics — and a re-pass is deliberate too,
  // since the lesson was already banked. Say which, or the screen reads as a
  // bug.
  const previewMode = Boolean(result?.progress?.previewMode);
  const alreadyCompleted = passed && !previewMode && !result?.progress?.firstCompletion;

  return (
    <div className="shrink-0 border-t border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-700">
          <span aria-hidden="true">🧪</span> Tests
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            disabled={Boolean(busy)}
            className="btn-ghost text-sm"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={Boolean(busy)}
            className="btn-ghost border border-slate-200 text-sm"
          >
            {busy === 'run' ? 'Running…' : '▷ Run'}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={Boolean(busy)}
            className="btn-primary text-sm"
          >
            {busy === 'submit' ? 'Checking…' : 'Submit'}
            <kbd className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-normal">
              Ctrl + ↵
            </kbd>
          </button>
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-label="Test results"
        className="max-h-44 min-h-[6rem] overflow-y-auto px-3 py-3 lg:max-h-56"
      >
        {actionError && <ErrorBanner message={actionError} />}

        {!execution && !actionError && (
          <p className="font-mono text-sm text-slate-500">
            No test results yet. Submit your answer to see them here.
          </p>
        )}

        {execution && (
          <div className="space-y-2">
            <div
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                passed ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'
              }`}
            >
              {passed ? '✓ Passed — output matches expected' : '✗ Output did not match expected'}
              {passed && xpDelta > 0 && <span className="ml-2 font-normal">+{xpDelta} XP</span>}
            </div>

            {passed && previewMode && (
              <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <span className="font-medium">Preview mode.</span> You are signed in as an
                instructor or admin, so this run earns no XP, records no progress and shows no
                celebration. Sign in with a student account to see what a learner sees.
              </div>
            )}

            {alreadyCompleted && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                You had already completed this lesson, so it awards no further XP. Your original
                completion still stands.
              </div>
            )}

            {discounted && (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Earned {xpDelta} of {lesson.xpReward} XP — {hintsUsed} hint
                {hintsUsed === 1 ? '' : 's'} used ({hintsUsed === 1 ? '50%' : '20%'} of full
                reward).
              </div>
            )}

            {execution.error && (
              <pre className="overflow-x-auto rounded-md bg-red-50 p-3 font-mono text-xs text-red-800">
                {execution.error}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const OutputPane = ({ output, running }) => (
  <section
    aria-label="Output"
    className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:w-[20rem] xl:w-[24rem]"
  >
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
      <h2 className="text-sm font-semibold text-slate-700">
        <span aria-hidden="true" className="font-mono">
          &gt;_
        </span>{' '}
        Output
      </h2>
      {output?.durationMs != null && (
        <span className="text-xs text-slate-400">{output.durationMs} ms</span>
      )}
    </div>

    <div
      role="status"
      aria-live="polite"
      aria-label="Program output"
      className="min-h-[8rem] flex-1 overflow-auto p-3 lg:min-h-0"
    >
      {running && <p className="text-sm text-slate-500">Running…</p>}

      {!running && !output && (
        <EmptyState
          icon="›_"
          title="No output yet"
          description={
            <>
              Click <strong>Run</strong> to execute your code and see the output here.
            </>
          }
          className="border-0"
        />
      )}

      {!running && output && (
        <div className="space-y-3">
          {output.error && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-red-50 p-3 font-mono text-xs text-red-800">
              {output.error}
            </pre>
          )}
          {output.stdout ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
              {output.stdout}
            </pre>
          ) : (
            !output.error && <p className="text-sm text-slate-500">Your code printed nothing.</p>
          )}
        </div>
      )}
    </div>
  </section>
);
