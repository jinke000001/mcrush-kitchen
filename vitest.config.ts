import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.test.ts'], exclude: ['**/._*', '**/node_modules/**'], environment: 'node', maxWorkers: 2 } });
