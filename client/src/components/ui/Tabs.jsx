import { useRef } from 'react';

// WAI-ARIA tabs (NFR5 / WCAG 2.1 AA): exactly one tab is in the tab order and
// the arrow keys move between them, so a keyboard user does not have to tab
// through every panel switch. Panels are the caller's business — render the
// content for `value` next to this component and give it
// `role="tabpanel" id={`panel-${value}`} aria-labelledby={`tab-${value}`}`.
export const Tabs = ({ tabs = [], value, onChange, className = '' }) => {
  const refs = useRef({});

  const move = (delta) => {
    const index = tabs.findIndex((t) => t.id === value);
    if (index === -1) return;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    onChange?.(next.id);
    refs.current[next.id]?.focus();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange?.(tabs[0]?.id);
      refs.current[tabs[0]?.id]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = tabs[tabs.length - 1];
      onChange?.(last?.id);
      refs.current[last?.id]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      onKeyDown={handleKeyDown}
      className={`flex items-center gap-1 border-b border-slate-200 ${className}`.trim()}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            onClick={() => onChange?.(tab.id)}
            className={[
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium',
              'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              selected
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            ].join(' ')}
          >
            {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
