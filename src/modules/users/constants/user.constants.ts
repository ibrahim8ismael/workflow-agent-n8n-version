export const USER_ROLES = ['USER', 'SYSTEM_ADMINISTRATOR'] as const;

export type UserRole = (typeof USER_ROLES)[number];
