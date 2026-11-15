import { DefaultLoadingManager } from 'three';
import { basePath, underBase } from './netGuard';

// Imported first by every 3D stop: three's loaders (textures, the hand mesh) resolve the app's root-absolute asset paths
// under the tour's base path, as the fetch guard does for fetch.
const base = basePath();
DefaultLoadingManager.setURLModifier((url) => underBase(url, base));
