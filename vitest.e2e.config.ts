import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      tsconfigFile: false,
      module: { type: 'es6' },
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: 'es2022',
        keepClassNames: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/testing',
      '@nestjs/jwt',
      '@nestjs/passport',
      '@nestjs/config',
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/e2e/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup.e2e.ts', './test/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
    sequence: {
      shuffle: false,
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
