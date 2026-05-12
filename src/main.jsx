import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
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
  <BrowserRouter>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <ModalsProvider>
        <Notifications position="top-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </BrowserRouter>
);
