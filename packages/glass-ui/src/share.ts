/**
 * Share links keep a program in the URL fragment (`#code=…`, `#wat=…`), which
 * browsers never send to a server, so sharing stays private and needs no backend.
 */

/** Bytes → base64url (for binary modules in a link). */
export function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The inverse of encodeBytes; null for anything malformed. */
export function decodeBytes(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

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

/** The program in `#<key>=…`, or null when the fragment holds something else. */
export function sourceFromFragment(hash: string, key: string): string | null {
  const prefix = `#${key}=`;
  return hash.startsWith(prefix) ? decodeSource(hash.slice(prefix.length)) : null;
}

export function fragmentUrl(href: string, key: string, source: string): string {
  return `${href.split('#')[0]}#${key}=${encodeSource(source)}`;
}
