// GitHub-style contribution grid for `GET /api/student/activity`: one column
// per week, one row per weekday, 365 zero-filled days from the server.
//
// Colour is never the only signal (NFR5 / WCAG 2.1 AA) — every cell carries an
// accessible label that states the count and the date in words, so the grid is
// readable with the palette stripped out entirely.

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Only three labels are shown, as on GitHub: seven would not fit the row height
// and the pattern is obvious from three.
const LABELLED_ROWS = new Set([0, 2, 4]);

// Four steps plus the empty state. Thresholds are tuned to pilot volumes — a
// learner finishing two lessons in a day is already an unusually good day.
const STEPS = [
  'bg-slate-100 border border-slate-200',
  'bg-brand-200',
  'bg-brand-400',
  'bg-brand-500',
  'bg-brand-700',
];

const stepFor = (completions) => {
  if (!completions) return 0;
  if (completions === 1) return 1;
  if (completions === 2) return 2;
  if (completions <= 4) return 3;
  return 4;
};

// Dates arrive as UTC calendar days ('2026-03-12'); parse and format them in
// UTC so a learner west of Greenwich does not see every cell shifted a day.
const parseDay = (date) => new Date(`${date}T00:00:00Z`);

const formatLong = (date) =>
  parseDay(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const formatMonth = (date) =>
  parseDay(date).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

// 0 = Monday … 6 = Sunday, so the Mon/Wed/Fri labels line up with rows 0/2/4.
const weekdayIndex = (date) => (parseDay(date).getUTCDay() + 6) % 7;

const cellLabel = ({ date, completions }) => {
  const when = formatLong(date);
  if (!completions) return `No lessons on ${when}`;
  return `${completions} lesson${completions === 1 ? '' : 's'} on ${when}`;
};

// Days → columns of 7, the first column padded with nulls so every row is the
// same weekday. 365 days spans 53 columns at most, which is the grid width the
// mockup shows.
const toWeeks = (days) => {
  const weeks = [];
  let current = new Array(weekdayIndex(days[0].date)).fill(null);

  for (const day of days) {
    current.push(day);
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    weeks.push([...current, ...new Array(7 - current.length).fill(null)]);
  }
  return weeks;
};

export const ActivityHeatmap = ({ days = [] }) => {
  if (!Array.isArray(days) || days.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Activity will appear here once you have completed a lesson.
      </p>
    );
  }

  const weeks = toWeeks(days);
  const total = days.reduce((sum, d) => sum + (d.completions || 0), 0);

  // A month label sits above the first column that starts a new month, which is
  // how GitHub places them: the label marks where the month begins, not its
  // centre.
  let previousMonth = null;
  const monthLabels = weeks.map((week) => {
    const first = week.find(Boolean);
    if (!first) return null;
    const month = formatMonth(first.date);
    if (month === previousMonth) return null;
    previousMonth = month;
    return month;
  });

  return (
    <div>
      <div className="flex gap-2">
        {/* Weekday labels stay put while the year scrolls beside them, so the
            rows remain identifiable on a narrow screen (NFR1). */}
        <div className="shrink-0 pt-4" aria-hidden="true">
          {WEEKDAY_LABELS.map((label, row) => (
            <div
              key={label}
              className="flex h-[15px] items-center pr-1 text-[10px] leading-none text-slate-500"
            >
              {LABELLED_ROWS.has(row) ? label : ''}
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="inline-flex flex-col gap-1">
            <div className="flex h-3 gap-[3px]" aria-hidden="true">
              {monthLabels.map((label, index) => (
                <div
                  key={`month-${index}`}
                  className="w-3 text-[10px] leading-none text-slate-500"
                >
                  {label && <span className="whitespace-nowrap">{label}</span>}
                </div>
              ))}
            </div>

            <div className="flex gap-[3px]">
              {weeks.map((week, weekIndex) => (
                <div key={`week-${weekIndex}`} className="flex flex-col gap-[3px]">
                  {week.map((day, dayIndex) =>
                    day ? (
                      <div
                        key={day.date}
                        role="img"
                        aria-label={cellLabel(day)}
                        title={cellLabel(day)}
                        className={`h-3 w-3 rounded-sm ${STEPS[stepFor(day.completions)]}`}
                      />
                    ) : (
                      <div
                        key={`pad-${weekIndex}-${dayIndex}`}
                        className="h-3 w-3"
                        aria-hidden="true"
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{total === 0 ? 'No activity yet' : `${total} completions in this window`}</span>
        <div className="flex items-center gap-1">
          <span>Less</span>
          {STEPS.map((step, index) => (
            <span
              key={step}
              className={`h-3 w-3 rounded-sm ${step}`}
              role="img"
              aria-label={
                index === 0 ? 'No lessons' : `Intensity level ${index} of ${STEPS.length - 1}`
              }
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
};
