import { publishBlocker } from '../../src/lib/publishRule.js';

// Mirrors courseService.assertPublishable (S8 D1) so the Publish button is
// disabled for exactly the courses the server would refuse.
describe('publishBlocker', () => {
  test('a course with no modules cannot be published', () => {
    expect(publishBlocker({ modules: [] })).toMatch(/at least one module/);
    expect(publishBlocker({})).toMatch(/at least one module/);
    expect(publishBlocker(null)).toMatch(/at least one module/);
  });

  test('names the first module that has no lessons', () => {
    const course = {
      modules: [
        { title: 'Basics', lessons: [{ _id: 'l1' }] },
        { title: 'Week 2', lessons: [] },
        { title: 'Week 3' },
      ],
    };
    const reason = publishBlocker(course);
    expect(reason).toMatch(/Every module needs at least one lesson/);
    expect(reason).toContain('Week 2');
    expect(reason).not.toContain('Week 3');
  });

  test('null when every module has a lesson', () => {
    expect(
      publishBlocker({
        modules: [
          { title: 'Basics', lessons: [{ _id: 'l1' }] },
          { title: 'Week 2', lessons: [{ _id: 'l2' }] },
        ],
      }),
    ).toBeNull();
  });
});
