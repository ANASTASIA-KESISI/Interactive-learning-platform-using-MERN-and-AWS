// The client is `"type": "module"` and Vite handles JSX in dev/build, so Jest
// needs its own transform. Babel is configured inline here rather than in a
// babel.config file so it cannot leak into the Vite build, which runs its own
// Babel pass through @vitejs/plugin-react.
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
        ],
      },
    ],
  },
  // Stylesheets and static assets are Vite's concern; a test only needs them to
  // import without throwing.
  moduleNameMapper: {
    '\\.(css|svg|png|jpg|gif)$': '<rootDir>/tests/fileMock.cjs',
  },
};
