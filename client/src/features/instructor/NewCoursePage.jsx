import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { createCourse } from '../../services/courses.js';
import { ErrorBanner } from '../../components/Spinner.jsx';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export const NewCoursePage = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'beginner',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const course = await createCourse(form);
      navigate(`/instructor/courses/${course._id}`, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/instructor" className="text-sm text-brand-600 hover:text-brand-700">
        ← My courses
      </Link>
      <h1 className="text-3xl font-semibold text-slate-900">New course</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="title" className="label">Title</label>
          <input id="title" value={form.title} onChange={update('title')} required className="field" />
        </div>

        <div>
          <label htmlFor="description" className="label">Description</label>
          <textarea
            id="description"
            value={form.description}
            onChange={update('description')}
            required
            rows={4}
            className="field"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="category" className="label">Category</label>
            <input id="category" value={form.category} onChange={update('category')} className="field" />
          </div>
          <div>
            <label htmlFor="difficulty" className="label">Difficulty</label>
            {/* `capitalize` is display-only: the option values stay lowercase to
                match the Course.difficulty enum on the server. */}
            <select id="difficulty" value={form.difficulty} onChange={update('difficulty')} className="field capitalize">
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end gap-3">
          <Link to="/instructor" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create course'}
          </button>
        </div>
      </form>
    </div>
  );
};
