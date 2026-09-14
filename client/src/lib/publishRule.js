// Client-side mirror of the server's publish rule (S8 D1): a course needs at
// least one module, and no module may be without a lesson. Returns the reason
// the course cannot be published, or null. The server re-checks on every
// publish, so this only decides whether the button is worth pressing — it is
// not the gate.
export const publishBlocker = (course) => {
  const modules = course?.modules || [];
  if (modules.length === 0) return 'Add at least one module before publishing.';
  const empty = modules.find((m) => !m.lessons || m.lessons.length === 0);
  if (empty) {
    return `Every module needs at least one lesson before publishing (“${empty.title}” is empty).`;
  }
  return null;
};
