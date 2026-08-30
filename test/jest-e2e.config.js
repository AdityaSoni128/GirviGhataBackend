module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  // Integration tests hit a real Postgres (see .github/workflows/ci.yml or
  // run `docker compose up postgres` locally) and run sequentially since
  // several tests reset/seed shared tables.
  maxWorkers: 1,
  testTimeout: 30000,
};
