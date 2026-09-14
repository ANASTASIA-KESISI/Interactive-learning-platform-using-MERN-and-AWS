import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { LessonPage } from '../../src/features/lesson/LessonPage.jsx';
import { completeLesson, getLesson } from '../../src/services/lessons.js';

// The page pulls in Monaco, react-markdown (ESM-only) and confetti. None of
// them are what this spec is about — it pins the tutorial completion control.
jest.mock('react-markdown', () => ({ children }) => <div>{children}</div>);
jest.mock('remark-gfm', () => () => null);
jest.mock('@monaco-editor/react', () => () => <div data-testid="editor" />);
jest.mock('../../src/features/notes/LessonNotesPanel.jsx', () => ({
  LessonNotesPanel: () => <div data-testid="notes" />,
}));
jest.mock('../../src/features/messages/ChatDock.jsx', () => ({ ChatDock: () => null }));
jest.mock('../../src/features/lesson/CompletionOverlay.jsx', () => ({
  CompletionOverlay: ({ xpDelta }) => <div role="dialog">Completed! +{xpDelta} XP</div>,
}));
jest.mock('../../src/hooks/useTimeOnTask.js', () => ({ useTimeOnTask: () => {} }));

const mockRefreshProfile = jest.fn().mockResolvedValue({});
jest.mock('../../src/hooks/useAuth.js', () => ({
  useAuth: () => ({ user: { role: 'student' }, refreshProfile: mockRefreshProfile }),
}));

jest.mock('../../src/services/lessons.js', () => ({
  getLesson: jest.fn(),
  completeLesson: jest.fn(),
  revealHint: jest.fn(),
  runCode: jest.fn(),
  submitCode: jest.fn(),
}));

const tutorial = (overrides = {}) => ({
  _id: 'l1',
  type: 'tutorial',
  title: 'Variables',
  content: 'A variable holds a value.',
  xpReward: 15,
  courseId: 'c1',
  courseTitle: 'JS Basics',
  nextLessonId: 'l2',
  completed: false,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter
      initialEntries={['/lessons/l1']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/lessons/:id" element={<LessonPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => jest.clearAllMocks());

describe('reading lesson completion', () => {
  test('offers "Mark as complete" with the lesson XP on an unfinished tutorial', async () => {
    getLesson.mockResolvedValue(tutorial());
    renderPage();

    expect(
      await screen.findByRole('button', { name: /Mark as complete · \+15 XP/ }),
    ).toBeInTheDocument();
  });

  test('marking it complete awards XP, celebrates and refreshes the header profile', async () => {
    getLesson.mockResolvedValue(tutorial());
    completeLesson.mockResolvedValue({
      progress: { status: 'completed', firstCompletion: true },
      xpDelta: 15,
      newBadges: [],
      gamification: { xpPoints: 15, level: 1 },
      moduleCompleted: false,
      nextLessonId: 'l2',
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Mark as complete/ }));

    await waitFor(() => expect(completeLesson).toHaveBeenCalledWith('l1'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('+15 XP');
    expect(mockRefreshProfile).toHaveBeenCalled();
    expect(screen.getByText('✓ Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark as complete/ })).toBeNull();
  });

  test('an already-completed tutorial shows the completed state, not the button', async () => {
    getLesson.mockResolvedValue(tutorial({ completed: true }));
    renderPage();

    expect(await screen.findByText('✓ Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark as complete/ })).toBeNull();
  });

  test('a preview (instructor) completion says so and stays markable', async () => {
    getLesson.mockResolvedValue(tutorial());
    completeLesson.mockResolvedValue({
      progress: { previewMode: true },
      xpDelta: 0,
      newBadges: [],
      gamification: null,
      moduleCompleted: false,
      nextLessonId: 'l2',
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Mark as complete/ }));

    expect(await screen.findByText(/Preview mode — no XP awarded/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockRefreshProfile).not.toHaveBeenCalled();
  });
});
