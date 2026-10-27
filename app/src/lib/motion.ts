// Durations for Svelte transitions: none when the system asks for reduced motion.
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

export const ms = (n: number) => (reduced.matches ? 0 : n);
