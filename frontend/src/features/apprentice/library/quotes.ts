/**
 * Renaissance quotes for the Today panel, one a day. Every entry is genuine and checked against the cited English edition
 * (docs/ideas/RENAISSANCE_QUOTES.md, entries 1 to 9). The wording is exact; "..." marks an omission in the source list. Add a
 * quote only from that vetted list, with its source.
 */
export interface Quote {
  /** The English text, exactly as in the cited translation. */
  text: string;
  author: string;
  work: string;
  /** Chapter, section or book within the work. */
  section: string;
  /** Translator (or editor and translator) and edition year. */
  translator: string;
}

export const QUOTES: readonly Quote[] = [
  {
    text: 'And begin to submit yourself to the direction of a master for instruction as early as you can; and do not leave the master until you have to.',
    author: 'Cennino Cennini',
    work: "Il Libro dell'Arte",
    section: 'Chapter III',
    translator: 'Daniel V. Thompson Jr., 1933',
  },
  {
    text: 'Do not fail, as you go on, to draw something every day, for no matter how little it is it will be well worth while, and will do you a world of good.',
    author: 'Cennino Cennini',
    work: "Il Libro dell'Arte",
    section: 'Chapter XXVIII',
    translator: 'Daniel V. Thompson Jr., 1933',
  },
  {
    text: '...your hand and your mind, being always accustomed to gather flowers, would ill know how to pluck thorns.',
    author: 'Cennino Cennini',
    work: "Il Libro dell'Arte",
    section: 'Chapter XXVII',
    translator: 'Daniel V. Thompson Jr., 1933',
  },
  {
    text: 'And remember to acquire diligence rather than rapidity.',
    author: 'Leonardo da Vinci',
    work: 'Notebooks',
    section: 'Richter section 491',
    translator: 'Jean Paul Richter, 1883',
  },
  {
    text: 'And when you have thus schooled your hand and your judgment by such diligence, you will acquire rapidity before you are aware.',
    author: 'Leonardo da Vinci',
    work: 'Notebooks',
    section: 'Richter section 492',
    translator: 'Jean Paul Richter, 1883',
  },
  {
    text: 'Obstacles cannot crush me. Every obstacle yields to stern resolve.',
    author: 'Leonardo da Vinci',
    work: 'Notebooks',
    section: 'Richter section 682',
    translator: 'Jean Paul Richter, 1883',
  },
  {
    text: 'Just as iron rusts unless it is used, and water putrifies or, in cold, turns to ice, so our intellect spoils unless it is kept in use.',
    author: 'Leonardo da Vinci',
    work: 'Notebooks',
    section: 'Richter section 1177',
    translator: 'Jean Paul Richter, 1883',
  },
  {
    text: 'Nothing is ever so difficult that study and application cannot conquer it.',
    author: 'Leon Battista Alberti',
    work: 'On Painting',
    section: 'Book III',
    translator: 'John R. Spencer, 1966',
  },
  {
    text: 'I devoted myself with sustained diligence and industry to acquiring mastery in the several branches of art...',
    author: 'Benvenuto Cellini',
    work: 'Autobiography',
    section: 'Book I, chapter XXXI',
    translator: 'John Addington Symonds, 1887',
  },
];

/** The short credit under a quote: "Leonardo da Vinci, Notebooks". */
export const quoteCredit = (q: Quote): string => `${q.author}, ${q.work}`;

/** The full source, for a tooltip or screen readers: author, work, section and translator. */
export const quoteSource = (q: Quote): string => `${q.author}, ${q.work}, ${q.section}, translated by ${q.translator}`;

/** Days since 1 January 1970 for a local day key, so the pick changes at local midnight. */
function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** The quote for a day ('YYYY-MM-DD'): the same all day, the next one tomorrow, cycling through the list. */
export function quoteOfDay(day: string, list: readonly Quote[] = QUOTES): Quote {
  const n = list.length;
  return list[((dayNumber(day) % n) + n) % n];
}
