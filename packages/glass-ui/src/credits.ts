// Runs the credits-card animations only while the card is on screen (adds .is-live).
// Same behaviour as the house kit's credits.js; motion is still off under
// prefers-reduced-motion (credits.css).
const el = document.querySelector('.creator');
if (el) {
  if (!('IntersectionObserver' in window)) el.classList.add('is-live');
  else new IntersectionObserver(([e]) => el.classList.toggle('is-live', !!e?.isIntersecting)).observe(el);
}
export {};
