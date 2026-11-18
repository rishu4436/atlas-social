import type { Transition, Variants } from "motion/react";

export const spring: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 };
export const softSpring: Transition = { type: "spring", stiffness: 220, damping: 28 };
export const ease = [0.22, 1, 0.36, 1] as const;

/** Only transform + opacity: compositor-friendly, stays at 60fps. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease } },
};
export const stagger = (s = 0.05, d = 0): Variants => ({ hidden: {}, show: { transition: { staggerChildren: s, delayChildren: d } } });
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  show: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 500, damping: 22 } },
};
