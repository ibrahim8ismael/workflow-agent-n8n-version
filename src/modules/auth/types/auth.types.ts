export interface OtpRecord {
  hashedOtp: string;
  expiresAt: number;
  attempts: number;
}
