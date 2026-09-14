import { render, screen, fireEvent } from '@testing-library/react';

import { PasswordField } from '../../src/components/PasswordField.jsx';

const renderField = (props = {}) =>
  render(
    <PasswordField
      id="password"
      label="Password"
      value="hunter22"
      onChange={() => {}}
      autoComplete="current-password"
      {...props}
    />,
  );

describe('PasswordField', () => {
  test('starts masked and passes input props through', () => {
    renderField();
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
  });

  test('the toggle reveals and re-masks the value, and says which it will do', () => {
    renderField();
    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('hunter22');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  test('the toggle is not a submit button', () => {
    renderField();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('type', 'button');
  });

  test('renders the hint under the field', () => {
    renderField({ hint: <p>At least 8 characters.</p> });
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
  });
});
