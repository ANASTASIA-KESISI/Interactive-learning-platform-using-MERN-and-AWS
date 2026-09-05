import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getLessonForEdit, updateLesson } from '../../services/lessons.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';

const LESSON_TYPES = ['tutorial', 'exercise', 'quiz'];
// Must stay in step with LESSON_LANGUAGES in server/src/models/Lesson.js — the
// server rejects anything outside its own enum.
const LESSON_LANGUAGES = ['javascript', 'python'];

export const LessonEditorPage = () => {
  const { id } = useParams();
  const [lesson, setLesson] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showTaskPreview, setShowTaskPreview] = useState(false);

  useEffect(() => {
    getLessonForEdit(id)
      .then((l) => {
        setLesson(l);
        setForm({
          title: l.title || '',
          type: l.type || 'tutorial',
          content: l.content || '',
          task: l.task || '',
          codeTemplate: l.codeTemplate || '',
          expectedOutput: l.expectedOutput || '',
          language: l.language || 'javascript',
          hints: (l.hints && l.hints.length > 0) ? l.hints : [''],
          xpReward: l.xpReward ?? 10,
          questions: (l.questions && l.questions.length > 0)
            ? l.questions.map((q) => ({
                prompt: q.prompt || '',
                options: q.options && q.options.length >= 2 ? [...q.options] : ['', ''],
                correctIndex: Number.isInteger(q.correctIndex) ? q.correctIndex : 0,
                explanation: q.explanation || '',
              }))
            : [],
          passMark: l.passMark ?? 70,
        });
      })
      .catch((err) => setLoadError(err.response?.data?.error?.message || err.message));
  }, [id]);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const updateHint = (i) => (e) => {
    setForm((f) => {
      const next = [...f.hints];
      next[i] = e.target.value;
      return { ...f, hints: next };
    });
  };

  const addHint = () =>
    setForm((f) => ({ ...f, hints: [...f.hints, ''] }));

  const removeHint = (i) =>
    setForm((f) => ({ ...f, hints: f.hints.filter((_, idx) => idx !== i) }));

  // ── Quiz questions ──────────────────────────────────────────────────────────
  // One helper edits a question in place; the rest are add/remove for questions
  // and for the options inside one. `correctIndex` is a radio across the
  // options, so marking an answer is one click and exactly one can be right.
  const editQuestion = (i, patch) =>
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
    }));

  const addQuestion = () =>
    setForm((f) => ({
      ...f,
      questions: [
        ...f.questions,
        { prompt: '', options: ['', ''], correctIndex: 0, explanation: '' },
      ],
    }));

  const removeQuestion = (i) =>
    setForm((f) => ({ ...f, questions: f.questions.filter((_, idx) => idx !== i) }));

  const editOption = (qi, oi, value) =>
    editQuestion(qi, {
      options: form.questions[qi].options.map((o, idx) => (idx === oi ? value : o)),
    });

  const addOption = (qi) =>
    editQuestion(qi, { options: [...form.questions[qi].options, ''] });

  const removeOption = (qi, oi) => {
    const question = form.questions[qi];
    const options = question.options.filter((_, idx) => idx !== oi);
    // Deleting the option that was marked correct must not silently promote a
    // different one: clamp, and let the author see which is marked.
    const correctIndex =
      question.correctIndex === oi
        ? 0
        : question.correctIndex > oi
          ? question.correctIndex - 1
          : question.correctIndex;
    editQuestion(qi, { options, correctIndex });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const payload = {
        title: form.title,
        type: form.type,
        content: form.content,
        task: form.task,
        codeTemplate: form.codeTemplate,
        expectedOutput: form.expectedOutput,
        language: form.language,
        hints: form.hints.map((h) => h.trim()).filter(Boolean),
        xpReward: Number(form.xpReward) || 0,
      };

      // Only a quiz sends a question set, so switching a lesson's type never
      // silently wipes the other type's body. The server re-validates all of
      // this and is the authority on it.
      if (form.type === 'quiz') {
        payload.questions = form.questions.map((q) => ({
          prompt: q.prompt.trim(),
          options: q.options.map((o) => o.trim()).filter(Boolean),
          correctIndex: q.correctIndex,
          explanation: q.explanation.trim(),
        }));
        payload.passMark = Number(form.passMark) || 70;
      }
      const updated = await updateLesson(id, payload);
      setLesson(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err.response?.data?.error?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!lesson || !form) return <Spinner />;

  const isCodeLesson = form.type === 'exercise';
  const isQuiz = form.type === 'quiz';

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <Link to="/instructor" className="text-sm text-brand-600 hover:text-brand-700">
          ← My courses
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Edit lesson</h1>
      </div>

      {saveError && <ErrorBanner message={saveError} />}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <label htmlFor="title" className="label">Title</label>
            <input id="title" value={form.title} onChange={update('title')} required className="field" />
          </div>
          <div>
            <label htmlFor="type" className="label">Type</label>
            <select id="type" value={form.type} onChange={update('type')} className="field">
              {LESSON_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="xp" className="label">XP reward</label>
            <input id="xp" type="number" min="0" value={form.xpReward} onChange={update('xpReward')} className="field w-28" />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Instructional content (Markdown)</h2>
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="btn-ghost"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>

        {showPreview ? (
          <article className="prose prose-slate max-w-none rounded border border-slate-200 p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {form.content || '_(empty)_'}
            </ReactMarkdown>
          </article>
        ) : (
          <textarea
            value={form.content}
            onChange={update('content')}
            rows={14}
            className="field font-mono text-sm"
            placeholder="# Lesson title&#10;&#10;Write the lesson in Markdown. Supports GFM (tables, task lists, strikethrough)."
          />
        )}
      </section>

      {/* Distinct from the lesson body above: `content` is what the learner
          reads, `task` is the brief on the Challenge tab beside the editor. */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Your Task (Markdown)</h2>
            <p className="text-sm text-slate-500">
              Shown on the lesson’s Challenge tab — the concrete thing the learner must make the
              code do. Keep the teaching material in the lesson content above.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowTaskPreview((p) => !p)}
            className="btn-ghost shrink-0"
          >
            {showTaskPreview ? 'Edit' : 'Preview'}
          </button>
        </div>

        {showTaskPreview ? (
          <article className="prose prose-slate max-w-none rounded border border-slate-200 p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.task || '_(empty)_'}</ReactMarkdown>
          </article>
        ) : (
          <textarea
            id="task"
            value={form.task}
            onChange={update('task')}
            rows={6}
            className="field font-mono text-sm"
            placeholder="Write a program that prints…&#10;&#10;- Requirement one&#10;- Requirement two"
          />
        )}
      </section>

      {isQuiz && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Questions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Multiple choice. Mark exactly one option per question as correct — answers are
                graded on the server and never sent to the learner&apos;s browser beforehand.
              </p>
            </div>
            <div>
              <label htmlFor="passMark" className="label">Pass mark (%)</label>
              <input
                id="passMark"
                type="number"
                min={1}
                max={100}
                value={form.passMark}
                onChange={update('passMark')}
                className="field w-28"
              />
            </div>
          </div>

          {form.questions.length === 0 && (
            <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No questions yet. Add the first one to make this quiz answerable.
            </p>
          )}

          <ol className="space-y-4">
            {form.questions.map((question, qi) => (
              <li key={qi} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="mt-2 text-sm font-semibold text-slate-500">{qi + 1}.</span>
                  <div className="flex-1 space-y-3">
                    <div>
                      <label htmlFor={`prompt-${qi}`} className="label">Question</label>
                      <textarea
                        id={`prompt-${qi}`}
                        value={question.prompt}
                        onChange={(e) => editQuestion(qi, { prompt: e.target.value })}
                        rows={2}
                        className="field"
                        placeholder="What does console.log do?"
                      />
                    </div>

                    <fieldset>
                      <legend className="label">Options (select the correct one)</legend>
                      <div className="space-y-2">
                        {question.options.map((option, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`correct-${qi}`}
                              className="h-4 w-4 shrink-0 accent-brand-600"
                              checked={question.correctIndex === oi}
                              onChange={() => editQuestion(qi, { correctIndex: oi })}
                              aria-label={`Mark option ${oi + 1} of question ${qi + 1} as correct`}
                            />
                            <input
                              type="text"
                              value={option}
                              onChange={(e) => editOption(qi, oi, e.target.value)}
                              className="field flex-1"
                              placeholder={`Option ${oi + 1}`}
                            />
                            {question.options.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeOption(qi, oi)}
                                className="btn-ghost px-2 text-sm text-red-700"
                                aria-label={`Remove option ${oi + 1} of question ${qi + 1}`}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {question.options.length < 6 && (
                        <button
                          type="button"
                          onClick={() => addOption(qi)}
                          className="btn-ghost mt-2 text-sm"
                        >
                          + Add option
                        </button>
                      )}
                    </fieldset>

                    <div>
                      <label htmlFor={`explanation-${qi}`} className="label">
                        Explanation (shown after answering, optional)
                      </label>
                      <input
                        id={`explanation-${qi}`}
                        type="text"
                        value={question.explanation}
                        onChange={(e) => editQuestion(qi, { explanation: e.target.value })}
                        className="field"
                        placeholder="Why this answer is right"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeQuestion(qi)}
                    className="btn-ghost px-2 text-sm text-red-700"
                    aria-label={`Remove question ${qi + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <button type="button" onClick={addQuestion} className="btn-ghost text-sm">
            + Add question
          </button>
        </section>
      )}

      {isCodeLesson && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Exercise scaffolding</h2>

          <div>
            <label htmlFor="language" className="label">Language</label>
            <select id="language" value={form.language} onChange={update('language')} className="field w-48">
              {LESSON_LANGUAGES.map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="codeTemplate" className="label">Starter code (shown to student)</label>
            <textarea id="codeTemplate" value={form.codeTemplate} onChange={update('codeTemplate')} rows={8} className="field font-mono text-sm" />
          </div>

          <div>
            <label htmlFor="expectedOutput" className="label">Expected stdout (exact match, trimmed)</label>
            <textarea id="expectedOutput" value={form.expectedOutput} onChange={update('expectedOutput')} rows={3} className="field font-mono text-sm" />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="label">Progressive hints (index 0 = least revealing)</span>
              <button type="button" onClick={addHint} className="btn-ghost text-sm">
                + Add hint
              </button>
            </div>

            <div className="space-y-2">
              {form.hints.map((hint, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-6 text-sm text-slate-500">#{i}</span>
                  <textarea
                    value={hint}
                    onChange={updateHint(i)}
                    rows={2}
                    className="field flex-1"
                    placeholder={`Hint ${i + 1}`}
                  />
                  <button type="button" onClick={() => removeHint(i)} className="btn-ghost text-sm text-red-600">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-sm text-green-700">Saved</span>}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save lesson'}
        </button>
      </div>
    </form>
  );
};
