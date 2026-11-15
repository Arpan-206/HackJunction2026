import { installNetGuard } from './netGuard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import '../theme/theme.css';
import '../styles/global.css';
import '../components/ui/ui.css';
import '../features/shared/robot/robot.css';
import './tour.css';
import { ThemeProvider } from '../theme';
import { TourApp } from './TourApp';

// The public tour: everything runs in this browser from bundled files. The guard goes in before anything can make a request.
installNetGuard();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <TourApp />
    </ThemeProvider>
  </StrictMode>,
);
