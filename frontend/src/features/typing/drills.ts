/** Drills in teaching order: home row first, then words that reach up and down from it. */
export interface Drill {
  id: string;
  title: string;
  /** One line on what the drill trains. */
  about: string;
  text: string;
}

export const DRILLS: Drill[] = [
  {
    id: 'home-index',
    title: 'Home row: index fingers',
    about: 'Rest on F and J. Feel the bumps. Press each with its own index finger.',
    text: 'fff jjj fjf jfj ffj jjf fj fj',
  },
  {
    id: 'home-middle',
    title: 'Home row: middle fingers',
    about: 'D takes the left middle finger. K takes the right middle finger.',
    text: 'ddd kkk dkd kdk fdk jkd dk kd',
  },
  {
    id: 'home-ring-little',
    title: 'Home row: ring and little fingers',
    about: 'S and L take the ring fingers. A and the semicolon take the little fingers.',
    text: 'sss lll aaa ;;; sla ;ls asl; ;lsa',
  },
  {
    id: 'home-words',
    title: 'Home row words',
    about: 'Real words from the home row only. Your thumbs share the space bar.',
    text: 'a sad lad; all fall; ask dad; a flask; salad; alfalfa',
  },
  {
    id: 'reach-up',
    title: 'Reach up',
    about: 'Each finger reaches up from its home key and comes back.',
    text: 'the rose is red; we sit at the top; quiet water; your poet',
  },
  {
    id: 'reach-down',
    title: 'Reach down',
    about: 'Each finger reaches down from its home key and comes back.',
    text: 'can men van; zinc box; a calm cave; nimble hands; vex me',
  },
  {
    id: 'sentences',
    title: 'Whole sentences',
    about: 'Every row, at an even pace. Accuracy first, speed later.',
    text: 'the quick brown fox jumps over the lazy dog. sphinx of black quartz, judge my vow.',
  },
];
