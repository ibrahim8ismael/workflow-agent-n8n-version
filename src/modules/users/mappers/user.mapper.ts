import { UserResponseDto } from '../dto/user-response.dto';

interface UserRecord {
  id: string;
  email: string;
  phone: string | null;
  name: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  role: string;
  isActive: boolean;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export const UserMapper = {
  toResponse(entity: UserRecord): UserResponseDto {
    return {
      id: entity.id,
      email: entity.email,
      name: entity.name ?? undefined,
      avatarUrl: entity.avatarUrl ?? undefined,
      emailVerifiedAt: entity.emailVerifiedAt?.toISOString(),
      role: entity.role,
      isActive: entity.isActive,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  },

  toBrief(entity: UserRecord) {
    return {
      id: entity.id,
      email: entity.email,
      name: entity.name,
    };
  },
};
