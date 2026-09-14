import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { AdminSettingsPage } from '../../src/features/admin/AdminSettingsPage.jsx';
import { getInstructorInviteCode, setInstructorInviteCode } from '../../src/services/admin.js';

jest.mock('../../src/services/admin.js', () => ({
  getInstructorInviteCode: jest.fn(),
  setInstructorInviteCode: jest.fn(),
}));

const CODE = 'seed-code-from-env';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AdminSettingsPage', () => {
  test('masks the current code until revealed and explains where it comes from', async () => {
    getInstructorInviteCode.mockResolvedValue({ code: CODE, source: 'environment' });
    render(<AdminSettingsPage />);

    const current = await screen.findByTestId('current-code');
    expect(current).not.toHaveTextContent(CODE);
    expect(screen.getByText(/INSTRUCTOR_INVITE_CODE environment variable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(current).toHaveTextContent(CODE);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(current).not.toHaveTextContent(CODE);
  });

  test('explains that self-signup is disabled when nothing is set', async () => {
    getInstructorInviteCode.mockResolvedValue({ code: '', source: 'unset' });
    render(<AdminSettingsPage />);

    expect(await screen.findByText(/self-signup is disabled/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull();
  });

  test('saves a new code and reports the saved value', async () => {
    getInstructorInviteCode.mockResolvedValue({ code: CODE, source: 'environment' });
    setInstructorInviteCode.mockResolvedValue({
      code: 'rotated-code-2026',
      source: 'database',
      updatedAt: '2026-09-13T10:00:00.000Z',
    });
    render(<AdminSettingsPage />);

    const input = await screen.findByLabelText('New code');
    const save = screen.getByRole('button', { name: 'Save code' });
    expect(save).toBeDisabled();

    fireEvent.change(input, { target: { value: 'rotated-code-2026' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(setInstructorInviteCode).toHaveBeenCalledWith('rotated-code-2026'));
    expect(await screen.findByRole('status')).toHaveTextContent(/Invite code saved/);
    expect(screen.getByText(/Set from this panel/)).toBeInTheDocument();
  });

  test('Generate fills the field with a fresh code the admin can then save', async () => {
    getInstructorInviteCode.mockResolvedValue({ code: '', source: 'unset' });
    render(<AdminSettingsPage />);

    const input = await screen.findByLabelText('New code');
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(input.value.length).toBeGreaterThanOrEqual(30);
    expect(input.value).not.toMatch(/\s/);
    expect(screen.getByRole('button', { name: 'Save code' })).toBeEnabled();
  });

  test('shows a server validation error without losing the draft', async () => {
    getInstructorInviteCode.mockResolvedValue({ code: '', source: 'unset' });
    setInstructorInviteCode.mockRejectedValue({
      response: { data: { error: { message: 'code must be at least 8 characters' } } },
    });
    render(<AdminSettingsPage />);

    const input = await screen.findByLabelText('New code');
    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save code' }));

    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(input).toHaveValue('short');
  });
});
