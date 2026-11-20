// Config for `npx playwright merge-reports --config tests/reporting/merge.config.mjs <blob dirs>`.
// Merges the blob reports of every CI job into the Playwright HTML report and the
// MMGIS capability report.
export default {
  testDir: '../..',
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }],
    ['./capability-reporter.mjs', { outputFolder: 'test-report' }],
  ],
};
