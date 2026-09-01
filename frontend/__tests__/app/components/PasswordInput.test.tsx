import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PasswordInput from '@/app/components/PasswordInput';
import { UI_STRINGS } from '@/lib/uiStrings';

const AUTH = UI_STRINGS.auth;

/** Wrapper so the reveal toggle is exercised against real controlled state. */
function Harness(props: Partial<React.ComponentProps<typeof PasswordInput>> = {}) {
  const [value, setValue] = useState('');
  return <PasswordInput label="Password" value={value} onChange={setValue} {...props} />;
}

describe('PasswordInput', () => {
  it('renders a masked field wired to its label', () => {
    render(<Harness />);

    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'current-password');
  });

  it('reserves both icon gutters so the icons never overlap the text', () => {
    render(<Harness />);

    const field = screen.getByLabelText('Password');
    // The global input rules outrank Tailwind padding utilities, so these classes
    // are what actually create the space for the lock and eye icons.
    expect(field).toHaveClass('has-leading-icon');
    expect(field).toHaveClass('has-trailing-icon');
  });

  it('toggles between masked and revealed, updating the accessible label', () => {
    render(<Harness />);

    const field = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: AUTH.showPassword });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(field).toHaveAttribute('type', 'text');
    const hideToggle = screen.getByRole('button', { name: AUTH.hidePassword });
    expect(hideToggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(hideToggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: AUTH.showPassword })).toBeInTheDocument();
  });

  it('reports edits through onChange', () => {
    const onChange = jest.fn();
    render(<PasswordInput label="Password" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret@123' } });
    expect(onChange).toHaveBeenCalledWith('Secret@123');
  });

  it('forwards placeholder, required, minLength and autoComplete', () => {
    render(
      <Harness
        placeholder="At least 8 characters"
        autoComplete="new-password"
        required
        minLength={8}
      />
    );

    const field = screen.getByLabelText('Password');
    expect(field).toHaveAttribute('placeholder', 'At least 8 characters');
    expect(field).toHaveAttribute('autocomplete', 'new-password');
    expect(field).toBeRequired();
    expect(field).toHaveAttribute('minLength', '8');
  });

  it('uses the supplied id, and generates one when omitted', () => {
    const { unmount } = render(<Harness id="my-password" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute('id', 'my-password');
    unmount();

    render(<Harness />);
    expect(screen.getByLabelText('Password').getAttribute('id')).toMatch(/^password-/);
  });

  it('renders an optional hint', () => {
    render(<Harness hint="Use a passphrase you have not reused." />);
    expect(screen.getByText('Use a passphrase you have not reused.')).toBeInTheDocument();
  });

  it('omits the hint element when none is given', () => {
    render(<Harness />);
    expect(screen.queryByText(/passphrase/i)).not.toBeInTheDocument();
  });

  it('can drop the leading icon and its gutter for compact forms', () => {
    render(<Harness showLeadingIcon={false} />);

    const field = screen.getByLabelText('Password');
    expect(field).not.toHaveClass('has-leading-icon');
    expect(field).toHaveClass('has-trailing-icon');
  });

  it('accepts label and input class overrides', () => {
    render(
      <Harness
        labelClassName="custom-label"
        inputClassName="custom-input"
      />
    );

    expect(screen.getByText('Password')).toHaveClass('custom-label');
    expect(screen.getByLabelText('Password')).toHaveClass('custom-input');
  });
});
