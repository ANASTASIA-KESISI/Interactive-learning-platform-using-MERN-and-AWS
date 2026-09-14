// The "nothing here yet" surface. Every list in S7 has one — an empty state
// that names the next action is the difference between a learner enrolling and
// a learner bouncing.
export const EmptyState = ({ icon, title, description, action, className = '' }) => (
  <div
    className={`rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center ${className}`.trim()}
  >
    {icon && (
      <div className="mb-2 text-3xl" aria-hidden="true">
        {icon}
      </div>
    )}
    <p className="text-sm font-medium text-slate-900">{title}</p>
    {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);
