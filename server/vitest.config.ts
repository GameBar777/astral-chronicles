import { defineConfig } from 'vitest/config';
// Tests run against a separate database (astral_test) so dev data is untouched.
export default defineConfig({ test: { fileParallelism: false, env: {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://astral:astral_dev_pw@127.0.0.1:5433/astral_test', BCRYPT_ROUNDS: '4' } } });
