/**
 * The stylesheets of the expert and apprentice pages. The pages' code loads on demand (App.tsx, lazyPage), but their
 * styles stay in the main stylesheet, in the same order as when the pages were bundled with it: other screens (the demo,
 * the playground, the gloves and robot screens) use these classes too, and the cascade must not change.
 * A page stylesheet added later can be imported where it is used, as usual; list it here only if other screens share it.
 */
import '../features/master/files/files.css';
import '../features/master/home/home.css';
import '../features/master/master.css';
import '../features/shared/ModelLabel.css';
import '../features/shared/robot/robot.css';
import '../features/master/scratch/scratch.css';
import '../features/apprentice/apprentice.css';
import '../features/apprentice/skills/skills.css';
