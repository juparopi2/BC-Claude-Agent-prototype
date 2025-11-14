import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Simple test component
function TestComponent() {
  return <div>Hello Test</div>;
}

describe('Example Test Suite', () => {
  it('should pass a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should render a simple component', () => {
    render(<TestComponent />);
    expect(screen.getByText('Hello Test')).toBeInTheDocument();
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('test-value');
    expect(result).toBe('test-value');
  });
});
