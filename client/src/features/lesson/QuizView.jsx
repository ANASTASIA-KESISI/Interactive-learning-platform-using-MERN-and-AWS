import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { submitQuiz } from '../../services/lessons.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Card, Chip, EmptyState, ProgressBar } from '../../components/ui/index.js';
import { ErrorBanner } from '../../components/Spinner.jsx';
import { LessonNotesPanel } from '../notes/LessonNotesPanel.jsx';
import { CompletionOverlay } from './CompletionOverlay.jsx';

// Taking a quiz (`Lesson.type === 'quiz'`).
//
// The page never holds the answer key: `GET /api/lessons/:id` sends prompts and
// options only, and `POST /api/lessons/:id/quiz` grades server-side and returns
// per-question feedback with the attempt. So the earliest moment a correct
// answer exists in the browser is after the learner has committed to theirs —
// the same rule that keeps `expectedOutput` off the wire for a coding exercise.

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

const letter = (index) => String.fromCharCode(65 + index);

const QuestionCard = ({ question, index, selected, feedback, disabled, onSelect }) => {
  const graded = Boolean(feedback);
  const tone = !graded ? 'border-slate-200' : feedback.correct ? 'border-green-300' : 'border-red-300';

  return (
    <li className={`rounded-lg border bg-white p-4 shadow-sm ${tone}`}>
      <fieldset disabled={disabled}>
        <legend className="mb-3 flex items-start gap-2 text-sm font-medium text-slate-900">
          <span className="mt-0.5 shrink-0 text-slate-400">{index + 1}.</span>
          <span className="flex-1">{question.prompt}</span>
          {graded && (
            <Chip tone={feedback.correct ? 'success' : 'danger'}>
              {feedback.correct ? 'Correct' : feedback.answered ? 'Incorrect' : 'Not answered'}
            </Chip>
          )}
        </legend>

        <div className="space-y-2">
          {question.options.map((option, optionIndex) => {
            const isSelected = selected === optionIndex;
            const isAnswer = graded && feedback.correctIndex === optionIndex;
            const isWrongPick = graded && isSelected && !feedback.correct;

            // After grading, colour carries meaning — so it is never the only
            // signal: the right answer is also labelled in words.
            let style = 'border-slate-200 hover:border-brand-300 hover:bg-slate-50';
            if (graded && isAnswer) style = 'border-green-400 bg-green-50';
            else if (isWrongPick) style = 'border-red-400 bg-red-50';
            else if (isSelected) style = 'border-brand-400 bg-brand-50';

            return (
              <label
                key={optionIndex}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${style} ${
                  disabled ? 'cursor-default' : ''
                }`}
              >
                <input
                  type="radio"
                  name={`q-${index}`}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  checked={isSelected}
                  onChange={() => onSelect(index, optionIndex)}
                />
                <span className="mr-1 font-mono text-xs text-slate-400">{letter(optionIndex)}</span>
                <span className="flex-1 text-slate-800">{option}</span>
                {graded && isAnswer && (
                  <span className="shrink-0 text-xs font-medium text-green-700">Correct answer</span>
                )}
              </label>
            );
          })}
        </div>

        {graded && feedback.explanation && (
          <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {feedback.explanation}
          </p>
        )}
      </fieldset>
    </li>
  );
};

export const QuizView = ({ lesson, onGraded }) => {
  const { refreshProfile } = useAuth();
  const questions = useMemo(() => lesson.questions || [], [lesson.questions]);

  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    setAnswers({});
    setResult(null);
    setError(null);
  }, [lesson._id]);

  const select = useCallback((questionIndex, optionIndex) => {
    setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }));
  }, []);

  const answeredCount = Object.keys(answers).length;
  const allAnswered = answeredCount === questions.length && questions.length > 0;
  const graded = Boolean(result);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // A sparse object becomes a dense array: an unanswered question sends
      // null rather than collapsing the sheet and shifting every later answer
      // onto the wrong question.
      const sheet = questions.map((_, i) => (i in answers ? answers[i] : null));
      const res = await submitQuiz(lesson._id, sheet);
      setResult(res);

      if (res.quiz?.passed && res.progress?.firstCompletion) {
        setCelebration(res);
        refreshProfile?.().catch(() => {});
      }
      onGraded?.(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    setResult(null);
    setAnswers({});
    setError(null);
  };

  if (questions.length === 0) {
    return (
      <EmptyState
        icon="📝"
        title="This quiz has no questions yet"
        description="The instructor has not added any questions to this lesson."
      />
    );
  }

  const feedbackFor = (index) => result?.quiz?.results?.[index] || null;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {questions.length} question{questions.length === 1 ? '' : 's'}
            </h2>
            <p className="text-xs text-slate-500">
              {graded
                ? `You scored ${result.quiz.score}% · pass mark ${result.quiz.passMark}%`
                : `Answer every question, then submit. Pass mark ${lesson.passMark ?? 70}%.`}
            </p>
          </div>
          {graded && (
            <Chip tone={result.quiz.passed ? 'success' : 'warning'}>
              {result.quiz.passed ? 'Passed' : 'Not passed'}
            </Chip>
          )}
        </div>

        <div className="mt-3">
          <ProgressBar
            value={
              graded
                ? result.quiz.score
                : Math.round((answeredCount / questions.length) * 100)
            }
            srLabel={graded ? 'Score' : 'Questions answered'}
          />
          <p className="mt-1 text-xs text-slate-500">
            {graded
              ? `${result.quiz.correctCount} of ${result.quiz.total} correct`
              : `${answeredCount} of ${questions.length} answered`}
          </p>
        </div>
      </Card>

      {error && <ErrorBanner message={error} />}

      <ol className="space-y-3">
        {questions.map((question, index) => (
          <QuestionCard
            key={question.index ?? index}
            question={question}
            index={index}
            selected={answers[index] ?? null}
            feedback={feedbackFor(index)}
            disabled={graded || submitting}
            onSelect={select}
          />
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
        {!graded ? (
          <>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSubmit}
              disabled={submitting || !allAnswered}
            >
              {submitting ? 'Checking…' : 'Submit answers'}
            </button>
            {!allAnswered && (
              <span className="text-xs text-slate-500">
                Answer all {questions.length} questions to submit.
              </span>
            )}
          </>
        ) : (
          <>
            {!result.quiz.passed && (
              <button type="button" className="btn-primary" onClick={retry}>
                Try again
              </button>
            )}
            {result.progress?.previewMode && (
              <span className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
                Preview mode — no XP awarded and no progress recorded.
              </span>
            )}
            {result.quiz.passed && !result.progress?.firstCompletion
              && !result.progress?.previewMode && (
              <span className="text-xs text-slate-500">
                You had already completed this quiz, so it awards no further XP.
              </span>
            )}
          </>
        )}
      </div>

      {celebration && (
        <CompletionOverlay
          xpDelta={celebration.xpDelta ?? 0}
          gamification={celebration.gamification}
          newBadges={celebration.newBadges || []}
          moduleCompleted={Boolean(celebration.moduleCompleted)}
          onClose={() => setCelebration(null)}
        />
      )}
    </div>
  );
};

export const QuizLessonView = ({ lesson, header, nav }) => (
  <div className="mx-auto max-w-3xl space-y-6 px-4">
    {header}

    {lesson.content && (
      <article className="prose prose-slate max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{lesson.content}</ReactMarkdown>
      </article>
    )}

    <QuizView lesson={lesson} />

    <Card title="Your notes">
      <div className="h-56">
        <LessonNotesPanel lessonId={lesson._id} className="h-full" />
      </div>
    </Card>

    {nav}
  </div>
);
