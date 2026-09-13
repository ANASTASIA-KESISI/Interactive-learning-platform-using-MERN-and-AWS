import { renderHook } from '@testing-library/react';

import { useSessionHeartbeat } from '../../src/hooks/useSessionHeartbeat.js';
import { sendSessionHeartbeat } from '../../src/services/me.js';

jest.mock('../../src/services/me.js', () => ({
  sendSessionHeartbeat: jest.fn(() => Promise.resolve()),
}));

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

// jsdom has no crypto.randomUUID; a deterministic stand-in that still yields
// a fresh id per call is enough to tell one session from another.
let uuidCounter = 0;
const randomUUID = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;

describe('useSessionHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendSessionHeartbeat.mockClear();
    window.sessionStorage.clear();
    Object.defineProperty(window, 'crypto', { value: { randomUUID }, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('posts a heartbeat immediately on mount, then every 60 s while visible', () => {
    renderHook(() => useSessionHeartbeat());
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(120_000);
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(4);

    // Every beat carries the same session id.
    const ids = new Set(sendSessionHeartbeat.mock.calls.map(([id]) => id));
    expect(ids.size).toBe(1);
  });

  test('the session id is minted once and kept in sessionStorage for the tab', () => {
    renderHook(() => useSessionHeartbeat());
    const [id] = sendSessionHeartbeat.mock.calls[0];

    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(window.sessionStorage.getItem('learncode.sessionId')).toBe(id);
  });

  test('a remount in the same tab continues the stored session', () => {
    window.sessionStorage.setItem('learncode.sessionId', 'existing-session-id');

    renderHook(() => useSessionHeartbeat());

    expect(sendSessionHeartbeat).toHaveBeenCalledWith('existing-session-id');
  });

  test('beats once as the tab goes hidden, then stays silent until it is visible again', () => {
    renderHook(() => useSessionHeartbeat());
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(2);

    // Hidden: the interval fires but sends nothing.
    jest.advanceTimersByTime(180_000);
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(2);

    // Visible again: no beat on the change itself; the next interval resumes.
    setVisibility('visible');
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(60_000);
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(3);
  });

  test('stops on unmount', () => {
    const { unmount } = renderHook(() => useSessionHeartbeat());
    unmount();

    jest.advanceTimersByTime(180_000);
    setVisibility('hidden');
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(1);
  });

  test('does nothing when disabled', () => {
    renderHook(() => useSessionHeartbeat({ enabled: false }));

    jest.advanceTimersByTime(120_000);
    setVisibility('hidden');
    expect(sendSessionHeartbeat).not.toHaveBeenCalled();
  });

  test('swallows a failed request', () => {
    sendSessionHeartbeat.mockImplementation(() => Promise.reject(new Error('offline')));

    expect(() => {
      renderHook(() => useSessionHeartbeat());
      jest.advanceTimersByTime(60_000);
    }).not.toThrow();
    expect(sendSessionHeartbeat).toHaveBeenCalledTimes(2);
  });
});
