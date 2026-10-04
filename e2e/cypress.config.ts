import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    specPattern: 'specs/**/*.cy.ts',
    supportFile: 'support/e2e.ts',
    baseUrl: process.env['CYPRESS_BASE_URL'] ?? 'http://127.0.0.1:4300/signal-timeline/',
    viewportWidth: 1440,
    viewportHeight: 900,
    video: false,
    screenshotsFolder: 'screenshots',
    defaultCommandTimeout: 6000,
    retries: { runMode: 1, openMode: 0 },
    setupNodeEvents(on) {
      on('task', {
        log(message: string) {
          console.log(message);
          return null;
        },
      });
    },
  },
});
