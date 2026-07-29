import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { updateUserSchema } from '../dto/update-user.dto';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserOwnerGuard } from '../guards/user-owner.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: { id: string }) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(updateUserSchema)) body: { name?: string; avatarUrl?: string },
  ) {
    return this.usersService.updateProfile(user.id, body);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateAccount(@CurrentUser() user: { id: string }) {
    await this.usersService.deactivateAccount(user.id);
  }

  @Get('me/sessions')
  async getUserSessions(@CurrentUser() user: { id: string }) {
    return this.usersService.getUserSessions(user.id);
  }

  @Delete('me/sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@CurrentUser() user: { id: string }, @Param('sessionId') sessionId: string) {
    await this.usersService.revokeSession(user.id, sessionId);
  }

  @Get(':id')
  @UseGuards(UserOwnerGuard)
  async getUserById(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }
}
