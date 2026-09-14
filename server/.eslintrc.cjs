// Mirrors client/.eslintrc.cjs, adjusted for a CommonJS Node service.
// `npm run lint` previously failed outright for want of this file — S6's
// GitHub Actions pipeline gates deploys on lint + test, so it has to resolve.
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  rules: {
    // ignoreRestSiblings lets `const { secret, ...safe } = doc` stand as the
    // way we strip fields from a response payload.
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    // Structured logging goes through utils/logger; bare console in src is a
    // mistake. Seed/migration scripts opt out with a file-level disable.
    'no-console': 'warn',
  },
  overrides: [
    {
      files: ['tests/**/*.js'],
      env: { jest: true },
    },
  ],
};
