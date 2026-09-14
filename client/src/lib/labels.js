// Display labels for the lowercase enum values the API stores.
//
// The values themselves must stay exactly as the server's enums spell them
// (`difficulty`, `Lesson.type`, `User.role`, `Lesson.language`) — a select's
// `value` is what gets submitted, and capitalising that would fail validation.
// So only the visible TEXT is transformed.
//
// This replaces the `capitalize` CSS class the project reached for previously.
// Two reasons: the class silently does nothing on a `<select>` in some
// browsers, which is why several dropdowns still showed raw lowercase; and CSS
// cannot know that "javascript" is written "JavaScript", so it produced
// "Javascript" wherever it did work.

// Words whose capitalisation is not simply "upper-case the first letter".
const SPECIAL_CASE = {
  javascript: 'JavaScript',
  python: 'Python',
  js: 'JS',
  py: 'PY',
};

export const titleCase = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';

  const special = SPECIAL_CASE[text.toLowerCase()];
  if (special) return special;

  // `snake_case` and `kebab-case` read as words, not as identifiers.
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
};

// Convenience for the common `{ENUM.map(v => <option>)}` shape.
export const optionLabel = titleCase;
