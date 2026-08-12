import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { getLessonForEdit, updateLesson } from '../../services/lessons.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

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

  useEffect(() => {
    getLessonForEdit(id)
      .then((l) => {
        setLesson(l);
        setForm({
          title: l.title || '',
          type: l.type || 'tutorial',
          content: l.content || '',
          codeTemplate: l.codeTemplate || '',
          expectedOutput: l.expectedOutput || '',
          language: l.language || 'javascript',
          hints: (l.hints && l.hints.length > 0) ? l.hints : [''],
          xpReward: l.xpReward ?? 10,
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
        codeTemplate: form.codeTemplate,
        expectedOutput: form.expectedOutput,
        language: form.language,
        hints: form.hints.map((h) => h.trim()).filter(Boolean),
        xpReward: Number(form.xpReward) || 0,
      };
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
              {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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

      {isCodeLesson && (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Exercise scaffolding</h2>

          <div>
            <label htmlFor="language" className="label">Language</label>
            <select id="language" value={form.language} onChange={update('language')} className="field w-48">
              {LESSON_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
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
