import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL ?? 'postgresql://woops:woops@localhost:5432/woops',
}));
