// The default surface for every panel in the S7 screens. `action` sits opposite
// the title (a "View all" link, a filter select); the header row disappears
// entirely when neither is given so a bare Card is just a padded surface.
export const Card = ({ title, action, className = '', children }) => (
  <section
    className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`.trim()}
  >
    {(title || action) && (
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        {title ? (
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        ) : (
          <span />
        )}
        {action}
      </header>
    )}
    <div className="p-5">{children}</div>
  </section>
);
