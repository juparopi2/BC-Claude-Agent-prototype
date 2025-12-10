import { describe, it, expect } from 'vitest';
import { fixFilenameMojibake } from '@/routes/files';

/**
 * Helper function to simulate mojibake corruption
 * This is what happens when UTF-8 bytes are interpreted as Latin-1
 */
function createMojibake(utf8String: string): string {
  const utf8Buffer = Buffer.from(utf8String, 'utf8');
  return utf8Buffer.toString('latin1');
}

describe('Filename Mojibake Fix', () => {
  it('should detect and fix mojibake in filenames', () => {
    // Create mojibake by simulating UTF-8 bytes interpreted as Latin-1
    const original = 'Order received – pro•duhk•tiv Store.pdf';
    const corrupted = createMojibake(original);
    const fixed = fixFilenameMojibake(corrupted);

    expect(fixed).toBe(original);
    expect(fixed).toContain('–');
    expect(fixed).toContain('•');
  });

  it('should preserve already-correct filenames', () => {
    const correct = 'Normal File Name.pdf';
    const result = fixFilenameMojibake(correct);

    expect(result).toBe(correct);
  });

  it('should handle Danish characters', () => {
    // Create mojibake for Danish characters
    const original = 'Test æøå.pdf';
    const corrupted = createMojibake(original);
    const fixed = fixFilenameMojibake(corrupted);

    expect(fixed).toBe(original);
  });

  it('should handle complex multi-byte characters', () => {
    // Test with French accented characters that use 2-byte UTF-8
    const original = 'Résumé Naïve Café.pdf';
    const corrupted = createMojibake(original);
    const fixed = fixFilenameMojibake(corrupted);

    expect(fixed).toBe(original);
    expect(fixed).toContain('é');
    expect(fixed).toContain('ï');
  });

  it('should not break on files without mojibake', () => {
    const normal = 'Simple-File-123.pdf';
    const result = fixFilenameMojibake(normal);

    expect(result).toBe(normal);
  });
});
