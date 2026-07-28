export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
}

export interface SendEmailResult {
  id: string;
  success: boolean;
}

export interface EmailProvider {
  send(params: SendEmailParams): Promise<SendEmailResult>;
  sendTemplate(params: SendTemplateParams): Promise<SendEmailResult>;
  verifyAddress(email: string): Promise<boolean>;
}

export interface SendTemplateParams {
  to: string | string[];
  template: string;
  data: Record<string, unknown>;
  from?: string;
}
