import { describe, expect, it } from 'vitest';
import { assertExpectedRevision } from './index';

describe('private snapshot revisions', () => {
  it('accepts the revision currently stored in the private repository', () => {
    expect(() => assertExpectedRevision('abc123', 'abc123')).not.toThrow();
  });

  it('rejects a write based on a stale revision', () => {
    expect(() => assertExpectedRevision('old-revision', 'new-revision')).toThrow('Revision conflict');
  });

  it('allows only an explicit first write when no snapshot exists', () => {
    expect(() => assertExpectedRevision(null, null)).not.toThrow();
    expect(() => assertExpectedRevision('unexpected', null)).toThrow('Revision conflict');
    expect(() => assertExpectedRevision(null, 'already-created')).toThrow('Revision conflict');
  });
});
