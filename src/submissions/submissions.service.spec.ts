import { normalizeOutput } from './submissions.service';

describe('normalizeOutput', () => {
  it('normalizes line endings and trailing whitespace', () => {
    expect(normalizeOutput('1  \r\n2\r\n')).toBe('1\n2');
  });

  it('does not ignore meaningful spaces inside a line', () => {
    expect(normalizeOutput('hello  world')).not.toBe(normalizeOutput('hello world'));
  });
});
