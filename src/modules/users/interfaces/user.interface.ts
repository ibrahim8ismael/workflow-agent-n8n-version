export interface IUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
