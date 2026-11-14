import { Link } from 'react-router-dom';
import { NOT_RECORDED, usePacks } from './packs';
import './fingerspelling.css';

/** The fingerspelling packs on the skill page: how many letters each has recorded, and which are not recorded yet. */
export function FingerspellingPacks() {
  const { packs } = usePacks();
  return (
    <section className="fs-packs" aria-labelledby="fs-packs-h">
      <h2 id="fs-packs-h">Alphabets</h2>
      <ul className="fs-packs__list">
        {packs.map((v) => {
          const missing = v.letters.filter((l) => !l.recorded).map((l) => l.letter);
          return (
            <li key={v.pack.id} className="fs-packs__item">
              <Link to={`/apprentice/fingerspelling?tab=chart&pack=${encodeURIComponent(v.pack.id)}`} className="fs-packs__name">
                {v.pack.name}
              </Link>
              <span className="fs-packs__count">
                {v.recorded} of {v.letters.length} letters recorded
              </span>
              {missing.length > 0 && (
                <span className="fs-packs__missing">
                  {NOT_RECORDED}: {missing.join(', ')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
