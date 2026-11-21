import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import QuoteMatrixErrorBoundary from '@/app/components/QuoteMatrixErrorBoundary';

function ProblematicChild({ shouldThrow, message }: { shouldThrow: boolean; message?: string }) {
  if (shouldThrow) {
    throw new Error(message || 'Test error message');
  }
  return <div>Safe content</div>;
}

describe('QuoteMatrixErrorBoundary', () => {
  const originalConsoleError = console.error;
  beforeAll(() => {
    console.error = jest.fn();
  });
  afterAll(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error occurs', () => {
    const handleBack = jest.fn();
    render(
      <QuoteMatrixErrorBoundary onBack={handleBack}>
        <div>Normal content</div>
      </QuoteMatrixErrorBoundary>
    );

    expect(screen.getByText('Normal content')).toBeInTheDocument();
  });

  it('renders fallback error UI when child throws an error', () => {
    const handleBack = jest.fn();
    render(
      <QuoteMatrixErrorBoundary onBack={handleBack}>
        <ProblematicChild shouldThrow={true} message="Crash in quote matrix" />
      </QuoteMatrixErrorBoundary>
    );

    expect(screen.getByText('Unable to display Quote Matrix')).toBeInTheDocument();
    expect(screen.getByText('Crash in quote matrix')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to all rfqs/i })).toBeInTheDocument();
  });

  it('falls back to default error text if error has no message', () => {
    const handleBack = jest.fn();
    const errorWithoutMessage = new Error();
    errorWithoutMessage.message = '';

    function EmptyErrorChild(): React.ReactNode {
      throw errorWithoutMessage;
    }

    render(
      <QuoteMatrixErrorBoundary onBack={handleBack}>
        <EmptyErrorChild />
      </QuoteMatrixErrorBoundary>
    );

    expect(screen.getByText('An unexpected rendering error occurred while loading the quote matrix.')).toBeInTheDocument();
  });

  it('calls onBack when Back button is clicked', () => {
    const handleBack = jest.fn();
    render(
      <QuoteMatrixErrorBoundary onBack={handleBack}>
        <ProblematicChild shouldThrow={true} message="Failed" />
      </QuoteMatrixErrorBoundary>
    );

    fireEvent.click(screen.getByRole('button', { name: /back to all rfqs/i }));
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('resets error state when Retry button is clicked', () => {
    const handleBack = jest.fn();
    let shouldThrow = true;

    function ConditionalChild() {
      if (shouldThrow) {
        throw new Error('Initial fail');
      }
      return <div>Recovered content</div>;
    }

    const { rerender } = render(
      <QuoteMatrixErrorBoundary onBack={handleBack}>
        <ConditionalChild />
      </QuoteMatrixErrorBoundary>
    );

    expect(screen.getByText('Unable to display Quote Matrix')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    rerender(
      <QuoteMatrixErrorBoundary onBack={handleBack}>
        <ConditionalChild />
      </QuoteMatrixErrorBoundary>
    );

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });
});
