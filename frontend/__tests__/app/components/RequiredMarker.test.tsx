import { render } from '@testing-library/react';
import RequiredMarker from '@/app/components/RequiredMarker';
import { UI_STRINGS } from '@/lib/uiStrings';

describe('RequiredMarker', () => {
  it('shows the required mark from the string dictionary, hidden from assistive technology', () => {
    const { container } = render(<RequiredMarker />);

    const mark = container.querySelector('span');
    expect(mark).toHaveTextContent(UI_STRINGS.manualRfqModal.requiredMarker);
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });
});
