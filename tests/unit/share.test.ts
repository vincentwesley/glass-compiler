import { describe, expect, it } from 'vitest';
import { decodeSource, encodeSource, shareUrl, sourceFromHash } from '../../src/ui/share';
import { EXAMPLES } from '../../src/examples';

describe('share links', () => {
  it('round-trips every example', () => {
    for (const ex of EXAMPLES) expect(decodeSource(encodeSource(ex.source))).toBe(ex.source);
  });

  it('round-trips non-ASCII text and stays URL-safe', () => {
    const src = 'print "héllo, 世界 😀 +/=";';
    const encoded = encodeSource(src);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
    expect(decodeSource(encoded)).toBe(src);
  });

  it('round-trips an empty program', () => {
    expect(decodeSource(encodeSource(''))).toBe('');
  });

  it('rejects malformed input instead of throwing', () => {
    expect(decodeSource('not base64!')).toBeNull();
    expect(decodeSource('/w')).toBeNull(); // invalid alphabet for base64url
    expect(decodeSource('_w')).toBeNull(); // decodes to 0xff, which is not valid UTF-8
  });

  it('builds and reads #code= links', () => {
    const url = shareUrl('https://example.test/glass-compiler/#old', 'print 1;');
    expect(url.startsWith('https://example.test/glass-compiler/#code=')).toBe(true);
    expect(sourceFromHash(url.slice(url.indexOf('#')))).toBe('print 1;');
    expect(sourceFromHash('#other')).toBeNull();
    expect(sourceFromHash('')).toBeNull();
  });
});
