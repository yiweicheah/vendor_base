import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles/mobile.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { HelmetProvider } from 'react-helmet-async';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Analytics } from '@vercel/analytics/react';
import App from './App';

const theme = createTheme({
  fontFamily: 'IBM Plex Mono, monospace',
  fontFamilyMonospace: 'IBM Plex Mono, monospace',
  headings: {
    fontFamily: 'IBM Plex Mono, monospace',
  },
  primaryColor: 'violet',
  defaultRadius: 'sm',
});

createRoot(document.getElementById('root')).render(
  <HelmetProvider>
    <BrowserRouter>
      <MantineProvider theme={theme} defaultColorScheme="dark">
        <ModalsProvider>
          <Notifications position="top-right" autoClose={3000} />
          <App />
        </ModalsProvider>
      </MantineProvider>
      <SpeedInsights />
      <Analytics />
    </BrowserRouter>
  </HelmetProvider>
);
