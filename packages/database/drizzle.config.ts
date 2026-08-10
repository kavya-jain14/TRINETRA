import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://trinetra:trinetra_local@localhost:5432/trinetra',
  },
  strict: true,
  verbose: true,
});
