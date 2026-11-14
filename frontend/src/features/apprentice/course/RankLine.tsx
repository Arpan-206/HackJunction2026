import { RANK_LABEL, type Rank } from '../pipeline/progress';

const ORDER: Rank[] = ['apprentice', 'journeyman', 'sealed'];

/** The three guild ranks as a quiet ledger line, the current one underlined. No badges, no points. */
export function RankLine({ rank }: { rank: Rank }) {
  const at = ORDER.indexOf(rank);
  return (
    <ol className="ap-rank" aria-label={`Guild rank: ${RANK_LABEL[rank]}`}>
      {ORDER.map((r, i) => (
        <li key={r} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>
          {RANK_LABEL[r]}
        </li>
      ))}
    </ol>
  );
}
