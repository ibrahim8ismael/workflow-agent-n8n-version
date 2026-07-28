export enum UserRole {
  USER = 'USER',
  SYSTEM_ADMINISTRATOR = 'SYSTEM_ADMINISTRATOR',
}

export class UserEntity {
  id!: string;
  email!: string;
  name!: string | null;
  avatarUrl!: string | null;
  emailVerifiedAt!: Date | null;
  role!: UserRole;
  isActive!: boolean;
  tokenVersion!: number;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
}
