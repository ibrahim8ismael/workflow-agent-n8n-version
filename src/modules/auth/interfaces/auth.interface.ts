export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  tokenVersion: number;
}
