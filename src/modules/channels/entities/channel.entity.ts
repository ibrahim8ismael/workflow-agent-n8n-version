export class Channel {
  id!: string;
  name!: string;
  type!: string;
  organizationId!: string;
  config?: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
}
