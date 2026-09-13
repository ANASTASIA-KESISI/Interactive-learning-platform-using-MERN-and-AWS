import { render, screen, fireEvent } from '@testing-library/react';

import { BadgeIcon } from '../../src/components/BadgeIcon.jsx';

const MEDAL = '\u{1F3C5}';
const FLAME = '\u{1F525}';

describe('BadgeIcon', () => {
  test('renders an emoji icon as text, not as an image', () => {
    const { container } = render(<BadgeIcon icon={FLAME} name="Streak" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(FLAME)).toBeInTheDocument();
  });

  test('renders a path icon as a decorative image', () => {
    render(<BadgeIcon icon="/badges/first-steps.svg" name="First Steps" />);
    const img = screen.getByTitle('First Steps');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', '/badges/first-steps.svg');
    expect(img).toHaveAttribute('alt', '');
  });

  test('falls back to the medal when the artwork fails to load', () => {
    const { container } = render(<BadgeIcon icon="/badges/missing.svg" name="Missing" />);
    fireEvent.error(screen.getByTitle('Missing'));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(MEDAL)).toBeInTheDocument();
  });

  test('shows the medal when a badge has no icon at all', () => {
    render(<BadgeIcon name="Blank" />);
    expect(screen.getByText(MEDAL)).toBeInTheDocument();
  });
});
