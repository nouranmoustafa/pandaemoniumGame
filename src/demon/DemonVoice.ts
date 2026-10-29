/**
 * The house's narrative lines: the bookends of the park chapter, shown as
 * quiet subtitles. Everything said mid-chase goes through Sarcasm instead,
 * written onto the park itself and rationed.
 */
export const PARK_LINES = {
  opening: 'Why would I go inside this creepy house?',
  arrive: 'Come in. Wipe your feet.',
  untouched: 'Not a scratch. How disappointing. How *impressive*.',
  versusDemon: 'There. Was that so difficult?',
  versusVisitor: 'You made it. It was always going to let you.',
} as const;

/** Stage 4: the house, the aisle, the gown. */
export const HOUSE_LINES = {
  grip: 'Let me take your coat. And you.',
  locked: 'Locked. For your safety. Mostly mine.',
  ceremony: "I've arranged a small ceremony. Just us. And the chairs.",
  noGuests: "The chairs won't talk. I made sure.",
  measure: "Hold still. I've had your measurements for *years*.",
  found: "There. Don't you look *found*.",
  mirror: "Not the mirror. Not yet. It isn't ready for you.",
  /** Said as she pulls back, on her 1st, 2nd, 3rd, 5th and 8th try; the house keeps count. */
  resist: [
    'You can pull. The ribbons find it charming.',
    'Every bride gets cold feet. Yours are merely *colder*.',
    "That's three. I'm writing them down for the speech.",
    'Struggle if you like. It photographs well.',
    'Still? You are going to be such a *difficult* wife.',
  ],
} as const;
