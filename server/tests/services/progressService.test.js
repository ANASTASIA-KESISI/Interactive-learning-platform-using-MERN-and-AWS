jest.mock('../../src/dynamo/progressTable', () => ({
  scanByLessonIds: jest.fn(),
  getProgress: jest.fn(),
  putProgress: jest.fn(),
  updateProgress: jest.fn(),
  queryByUser: jest.fn(),
}));

const progressTable = require('../../src/dynamo/progressTable');
const progressService = require('../../src/services/progressService');

describe('progressService.getCourseAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns zeroed rows for lessons with no progress records', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([]);

    const result = await progressService.getCourseAnalytics(['l1', 'l2']);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      lessonId: 'l1',
      uniqueLearners: 0,
      totalAttempts: 0,
      completions: 0,
      passRate: 0,
      avgHintsUsed: 0,
      avgTimeSpentSec: 0,
    });
  });

  test('aggregates pass rate, attempts, hints and time across multiple learners', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'completed', attempts: 3, hintsUsed: 1, timeSpent: 120 },
      { userId: 'u2', lessonId: 'l1', status: 'completed', attempts: 1, hintsUsed: 0, timeSpent: 60 },
      { userId: 'u3', lessonId: 'l1', status: 'in_progress', attempts: 2, hintsUsed: 2, timeSpent: 180 },
    ]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson).toEqual({
      lessonId: 'l1',
      uniqueLearners: 3,
      totalAttempts: 6,
      completions: 2,
      passRate: 67,
      avgHintsUsed: 1,
      avgTimeSpentSec: 120,
    });
  });

  test('preserves order of requested lessonIds and ignores foreign records', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l2', status: 'completed', attempts: 1, hintsUsed: 0, timeSpent: 30 },
      { userId: 'u2', lessonId: 'lx', status: 'completed', attempts: 1, hintsUsed: 0, timeSpent: 30 },
    ]);

    const result = await progressService.getCourseAnalytics(['l1', 'l2', 'l3']);

    expect(result.map((r) => r.lessonId)).toEqual(['l1', 'l2', 'l3']);
    expect(result[0].uniqueLearners).toBe(0);
    expect(result[1].uniqueLearners).toBe(1);
    expect(result[2].uniqueLearners).toBe(0);
  });

  test('handles missing fields on records (treats as zero)', async () => {
    progressTable.scanByLessonIds.mockResolvedValue([
      { userId: 'u1', lessonId: 'l1', status: 'in_progress' },
    ]);

    const [lesson] = await progressService.getCourseAnalytics(['l1']);

    expect(lesson.totalAttempts).toBe(0);
    expect(lesson.avgHintsUsed).toBe(0);
    expect(lesson.avgTimeSpentSec).toBe(0);
    expect(lesson.passRate).toBe(0);
  });

  test('returns empty array when no lessonIds are provided', async () => {
    const result = await progressService.getCourseAnalytics([]);
    expect(result).toEqual([]);
  });
});
