import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource/eb-garamond/500-italic.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/500.css';
import '@fontsource/alegreya-sans/700.css';
import './theme/theme.css';
import './styles/global.css';
import './app/app.css';
import { App } from './app/App';
import { ThemeProvider } from './theme';
import { ToastProvider } from './components/ui';
import { DevPanel } from './dev/DevPanel';

/** Installs the in-browser mock backend first when it is requested or the real backend is down (see src/mock). */
const mockReady = import('./mock/install').then((m) => m.maybeInstallMock()).catch(() => false);

void mockReady.then(() => createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <DevPanel />
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
));
