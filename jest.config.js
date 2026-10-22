// Unit + component test runner (SCRUM-64). Maestro owns E2E (ADR-0015); pgTAP owns the database.
// Two projects so src/domain stays a zero-mock, plain-Node suite (mobile-architecture §1):
//   domain — node environment, babel-jest only, no React Native preset or mocks.
//   app    — jest-expo (iOS platform), React Native Testing Library, everything outside src/domain.
// Repo tooling tests under scripts/ (doc-gates, dependency-audit) stay on node:test — they test
// Node scripts, not app code, and run before `npm ci` in app.yml.
/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'domain',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/domain'],
      testMatch: ['**/__tests__/**/*.test.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    {
      displayName: 'app',
      preset: 'jest-expo',
      roots: ['<rootDir>/src', '<rootDir>/app'],
      testMatch: ['**/__tests__/**/*.test.ts?(x)'],
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/domain/'],
    },
  ],
};
