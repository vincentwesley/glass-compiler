/**
 * Share links keep the program in the URL fragment (#code=...), which browsers
 * never send to a server, so sharing stays private and needs no backend.
 */

const PREFIX = '#code=';

/** UTF-8 → base64url, so the link survives any characters in the program. */
export function encodeSource(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The inverse of encodeSource; returns null for anything malformed. */
export function decodeSource(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function sourceFromHash(hash: string): string | null {
  return hash.startsWith(PREFIX) ? decodeSource(hash.slice(PREFIX.length)) : null;
}

export function shareUrl(href: string, source: string): string {
  return `${href.split('#')[0]}${PREFIX}${encodeSource(source)}`;
}
