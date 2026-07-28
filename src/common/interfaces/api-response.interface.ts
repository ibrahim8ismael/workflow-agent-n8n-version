export interface ApiResponse<T = unknown> {
  statusCode: number;
  message: string;
  data?: T;
  timestamp: string;
}
