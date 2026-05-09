import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  getCourse,
  publishCourse,
  updateCourse,
  addModule,
  addLesson,
} from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';

const LESSON_TYPES = ['tutorial', 'exercise', 'quiz'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export const CourseEditorPage = () => {
  const { id } = useParams();
  const [course, setCourse] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    return getCourse(id)
      .then(setCourse)
      .catch((err) => setError(err.response?.data?.error?.message || err.message));
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const [meta, setMeta] = useState({ title: '', description: '', category: '', difficulty: 'beginner' });
  useEffect(() => {
    if (course) {
      setMeta({
        title: course.title,
        description: course.description,
        category: course.category || '',
        difficulty: course.difficulty,
      });
    }
  }, [course]);

  const handleSaveMeta = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateCourse(id, meta);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    try {
      await publishCourse(id);
      await reload();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    }
  };

  if (error && !course) return <ErrorBanner message={error} />;
  if (!course) return <Spinner />;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/instructor" className="text-sm text-brand-600 hover:text-brand-700">
          ← My courses
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Edit course</h1>
          <div className="flex items-center gap-3">
            <Link to={`/instructor/courses/${id}/analytics`} className="btn-ghost">
              View analytics
            </Link>
            {course.isPublished ? (
              <span className="rounded bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
                Published
              </span>
            ) : (
              <button type="button" onClick={handlePublish} className="btn-primary">
                Publish
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={handleSaveMeta} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Details</h2>

        <div>
          <label htmlFor="title" className="label">Title</label>
          <input id="title" value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} required className="field" />
        </div>
        <div>
          <label htmlFor="description" className="label">Description</label>
          <textarea id="description" value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} required rows={3} className="field" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="label">Category</label>
            <input id="category" value={meta.category} onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))} className="field" />
          </div>
          <div>
            <label htmlFor="difficulty" className="label">Difficulty</label>
            <select id="difficulty" value={meta.difficulty} onChange={(e) => setMeta((m) => ({ ...m, difficulty: e.target.value }))} className="field">
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      <ModulesSection course={course} onChange={reload} setError={setError} />
    </div>
  );
};

const ModulesSection = ({ course, onChange, setError }) => {
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const handleAddModule = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      await addModule(course._id, { title: newTitle.trim() });
      setNewTitle('');
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">Modules</h2>

      {course.modules && course.modules.length > 0 ? (
        <ol className="space-y-4">
          {course.modules.map((mod, i) => (
            <ModuleCard
              key={mod._id}
              module={mod}
              index={i}
              onChange={onChange}
              setError={setError}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
          No modules yet.
        </p>
      )}

      <form onSubmit={handleAddModule} className="flex gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New module title"
          className="field flex-1"
        />
        <button type="submit" className="btn-primary" disabled={creating || !newTitle.trim()}>
          {creating ? 'Adding…' : 'Add module'}
        </button>
      </form>
    </section>
  );
};

const ModuleCard = ({ module, index, onChange, setError }) => {
  const [adding, setAdding] = useState(false);
  const [lessonForm, setLessonForm] = useState({ title: '', type: 'tutorial', xpReward: 10 });

  const handleAddLesson = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await addLesson(module._id, {
        title: lessonForm.title,
        type: lessonForm.type,
        xpReward: Number(lessonForm.xpReward) || 10,
      });
      setLessonForm({ title: '', type: 'tutorial', xpReward: 10 });
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900">
        {index + 1}. {module.title}
      </h3>

      {module.lessons && module.lessons.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {module.lessons.map((lesson) => (
            <li key={lesson._id} className="flex items-center justify-between py-2">
              <div>
                <span className="font-medium text-slate-800">{lesson.title}</span>
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {lesson.type}
                </span>
                <span className="ml-2 text-xs text-slate-500">{lesson.xpReward} XP</span>
              </div>
              <Link to={`/instructor/lessons/${lesson._id}`} className="text-sm text-brand-600 hover:text-brand-700">
                Edit →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No lessons yet.</p>
      )}

      <form onSubmit={handleAddLesson} className="mt-4 grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
        <div>
          <label className="label">Lesson title</label>
          <input
            value={lessonForm.title}
            onChange={(e) => setLessonForm((f) => ({ ...f, title: e.target.value }))}
            required
            className="field"
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            value={lessonForm.type}
            onChange={(e) => setLessonForm((f) => ({ ...f, type: e.target.value }))}
            className="field"
          >
            {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">XP</label>
          <input
            type="number"
            min="0"
            value={lessonForm.xpReward}
            onChange={(e) => setLessonForm((f) => ({ ...f, xpReward: e.target.value }))}
            className="field w-20"
          />
        </div>
        <button type="submit" className="btn-primary" disabled={adding || !lessonForm.title.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
    </li>
  );
};
