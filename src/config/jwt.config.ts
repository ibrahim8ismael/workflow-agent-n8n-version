import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? '',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  issuer: process.env.JWT_ISSUER ?? 'woops',
}));
