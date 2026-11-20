// Preloaded into the e2e test server only when coverage is collected
// (see tests/global-setup.js). Node writes NODE_V8_COVERAGE data on a normal exit,
// but not when a signal terminates the process — so exit normally on SIGTERM/SIGINT.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => process.exit(0));
}
