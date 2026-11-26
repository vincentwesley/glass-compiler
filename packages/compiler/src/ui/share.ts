/**
 * Glass Compiler share links: the program travels in `#code=…` (see
 * @glass/ui/share, shared with Glass Wasm's `#wat=…` links).
 */
import { fragmentUrl, sourceFromFragment } from '@glass/ui/share';

export { decodeSource, encodeSource } from '@glass/ui/share';

export function sourceFromHash(hash: string): string | null {
  return sourceFromFragment(hash, 'code');
}

export function shareUrl(href: string, source: string): string {
  return fragmentUrl(href, 'code', source);
}
