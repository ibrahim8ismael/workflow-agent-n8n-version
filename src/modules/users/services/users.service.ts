import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UserMapper } from '../mappers/user.mapper';
import { UsersRepository } from '../repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return UserMapper.toResponse(user);
  }

  async updateProfile(userId: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.repo.update(userId, dto);
    return UserMapper.toResponse(updated);
  }

  async deactivateAccount(userId: string): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.isActive) {
      throw new ConflictException('Account is already deactivated');
    }

    await this.repo.deactivateUser(userId);
    await this.repo.revokeAllSessions(userId);
  }

  async getUserById(requestedId: string): Promise<UserResponseDto> {
    const user = await this.repo.findById(requestedId);
    if (!user) throw new NotFoundException('User not found');
    return UserMapper.toResponse(user);
  }

  async getUserSessions(userId: string) {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    return this.repo.findActiveSessions(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) throw new NotFoundException('Session not found');

    if (session.userId !== userId) {
      throw new UnauthorizedException('You can only revoke your own sessions');
    }

    await this.repo.revokeSession(sessionId);
  }
}
