import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  getCourse,
  publishCourse,
  updateCourse,
  addModule,
  addLesson,
  updateModule,
  deleteModule,
  deleteLesson,
} from '../../services/courses.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import { titleCase } from '../../lib/labels.js';
// The institutional pair is authored identically on both course forms; the
// fields live with the creation page rather than being duplicated here.
import { DepartmentSemesterFields, useDepartments } from './NewCoursePage.jsx';

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

  const universities = useDepartments();
  const [meta, setMeta] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'beginner',
    departmentId: '',
    semester: '',
    icon: '',
    about: '',
  });
  useEffect(() => {
    if (course) {
      setMeta({
        title: course.title,
        description: course.description,
        category: course.category || '',
        difficulty: course.difficulty,
        // `getCourseDetail` flattens the populated department back to its id.
        departmentId: course.departmentId ? String(course.departmentId) : '',
        semester: course.semester ? String(course.semester) : '',
        icon: course.icon || '',
        about: course.about || '',
      });
    }
  }, [course]);

  const handleSaveMeta = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Only the fields the server allowlists (courseService.COURSE_WRITABLE).
      await updateCourse(id, {
        title: meta.title,
        description: meta.description,
        category: meta.category,
        difficulty: meta.difficulty,
        departmentId: meta.departmentId || null,
        semester: meta.semester || null,
        icon: meta.icon,
        about: meta.about,
      });
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

        <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
          <div>
            <label htmlFor="icon" className="label">Icon</label>
            <input
              id="icon"
              value={meta.icon}
              onChange={(e) => setMeta((m) => ({ ...m, icon: e.target.value }))}
              maxLength={8}
              placeholder="📘"
              className="field text-center text-xl"
            />
          </div>
          <div>
            <label htmlFor="title" className="label">Title</label>
            <input id="title" value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} required className="field" />
          </div>
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
              {DIFFICULTIES.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
            </select>
          </div>
        </div>

        <DepartmentSemesterFields
          universities={universities}
          departmentId={meta.departmentId}
          semester={meta.semester}
          onChange={(patch) => setMeta((m) => ({ ...m, ...patch }))}
        />

        <div>
          <label htmlFor="about" className="label">About this course (Markdown)</label>
          <textarea
            id="about"
            value={meta.about}
            onChange={(e) => setMeta((m) => ({ ...m, about: e.target.value }))}
            rows={8}
            className="field font-mono text-sm"
            placeholder="What the course covers, what a learner will be able to do, prerequisites."
          />
          <p className="mt-1 text-xs text-slate-500">
            Rendered on the course page under “About this course”. Supports GFM.
          </p>
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
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(module.title);
  const [busy, setBusy] = useState(false);

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

  const handleRename = async (e) => {
    e.preventDefault();
    if (!title.trim() || title.trim() === module.title) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await updateModule(module._id, { title: title.trim() });
      setRenaming(false);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  // Deleting a module takes its lessons with it, so the count goes in the
  // prompt — an instructor should not discover that after the fact.
  const handleDeleteModule = async () => {
    const lessonCount = module.lessons?.length || 0;
    const detail = lessonCount
      ? ` and its ${lessonCount} lesson${lessonCount === 1 ? '' : 's'}`
      : '';
    if (!window.confirm(`Delete "${module.title}"${detail}? This cannot be undone.`)) return;

    setBusy(true);
    try {
      await deleteModule(module._id);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
      setBusy(false);
    }
  };

  const handleDeleteLesson = async (lesson) => {
    if (!window.confirm(`Delete lesson "${lesson.title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteLesson(lesson._id);
      await onChange();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {renaming ? (
          <form onSubmit={handleRename} className="flex flex-1 items-center gap-2">
            <label className="sr-only" htmlFor={`module-title-${module._id}`}>
              Module title
            </label>
            <input
              id={`module-title-${module._id}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field flex-1"
              autoFocus
            />
            <button type="submit" className="btn-primary text-sm" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => {
                setTitle(module.title);
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-3">
              {/* The numbered square makes the module the unit of the page:
                  previously a module and a lesson were both a line of text, so
                  the structure of a course was invisible while editing it. */}
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-lg font-semibold text-brand-700 ring-1 ring-brand-100"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-900">{module.title}</h3>
                <p className="text-xs text-slate-500">
                  {module.lessons?.length || 0} lesson
                  {(module.lessons?.length || 0) === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                onClick={() => setRenaming(true)}
                disabled={busy}
              >
                Rename
              </button>
              <button
                type="button"
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                onClick={handleDeleteModule}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      {module.lessons && module.lessons.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {module.lessons.map((lesson, lessonIndex) => (
            <li
              key={lesson._id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 transition-colors hover:bg-slate-50"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-8 shrink-0 font-mono text-xs text-slate-400">
                  {index + 1}.{lessonIndex + 1}
                </span>
                <div className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{lesson.title}</span>
                  <span className="text-xs text-slate-500">
                    {titleCase(lesson.type)} · {lesson.xpReward} XP
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/instructor/lessons/${lesson._id}`}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  className="rounded-md border border-transparent px-2 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                  onClick={() => handleDeleteLesson(lesson)}
                  disabled={busy}
                  aria-label={`Delete lesson ${lesson.title}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
          No lessons in this module yet.
        </p>
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
            {LESSON_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
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
