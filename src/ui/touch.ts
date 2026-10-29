/**
 * Phones and tablets: a coarse pointer on a touch screen. They get on-screen arrows,
 * single player only, and the lighter lighting setup. (Laptops with touch screens
 * report a fine pointer and keep the keyboard.)
 */
export const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;

/** How fast the running parts play on phones, as a fraction of normal speed. */
export const TOUCH_PACE = 0.7;
