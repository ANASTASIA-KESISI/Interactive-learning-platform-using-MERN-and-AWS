import { renderHook } from '@testing-library/react';

import { useTimeOnTask } from '../../src/hooks/useTimeOnTask.js';
import { reportTimeOnTask } from '../../src/services/lessons.js';

jest.mock('../../src/services/lessons.js', () => ({
  reportTimeOnTask: jest.fn(() => Promise.resolve()),
}));

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useTimeOnTask', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    reportTimeOnTask.mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('reports active seconds on the flush interval', () => {
    renderHook(() => useTimeOnTask('lesson-1'));
    jest.advanceTimersByTime(30_000);
    expect(reportTimeOnTask).toHaveBeenCalledTimes(1);
    expect(reportTimeOnTask).toHaveBeenCalledWith('lesson-1', 30);
  });

  test('flushes the last partial interval on unmount', () => {
    const { unmount } = renderHook(() => useTimeOnTask('lesson-1'));
    jest.advanceTimersByTime(12_000);
    unmount();
    expect(reportTimeOnTask).toHaveBeenCalledWith('lesson-1', 12);
  });

  test('drops a report shorter than five seconds as noise', () => {
    const { unmount } = renderHook(() => useTimeOnTask('lesson-1'));
    jest.advanceTimersByTime(3_000);
    unmount();
    expect(reportTimeOnTask).not.toHaveBeenCalled();
  });

  test('stops the clock while the tab is hidden', () => {
    renderHook(() => useTimeOnTask('lesson-1'));
    jest.advanceTimersByTime(10_000);
    setVisibility('hidden'); // flushes the 10 s accrued so far
    expect(reportTimeOnTask).toHaveBeenCalledWith('lesson-1', 10);

    // Hidden: nothing accrues, so the interval flushes have nothing to send.
    jest.advanceTimersByTime(60_000);
    expect(reportTimeOnTask).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    jest.advanceTimersByTime(30_000);
    const lastCall = reportTimeOnTask.mock.calls.at(-1);
    expect(lastCall[0]).toBe('lesson-1');
    // The interval is not aligned to the visibility change, so what is flushed
    // is the visible time since the tab came back, never the hidden time.
    expect(lastCall[1]).toBeGreaterThanOrEqual(5);
    expect(lastCall[1]).toBeLessThanOrEqual(30);
  });

  test('does nothing when disabled or without a lesson', () => {
    const { unmount } = renderHook(() => useTimeOnTask('lesson-1', { enabled: false }));
    jest.advanceTimersByTime(60_000);
    unmount();
    const { unmount: unmount2 } = renderHook(() => useTimeOnTask(undefined));
    jest.advanceTimersByTime(60_000);
    unmount2();
    expect(reportTimeOnTask).not.toHaveBeenCalled();
  });
});
