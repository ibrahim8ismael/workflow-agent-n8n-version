import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { requestOtpSchema } from '../dto/request-otp.dto';
import { verifyOtpSchema } from '../dto/verify-otp.dto';
import { JwtAuthGuard } from '../guards/auth.guard';
import type { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Body(new ZodValidationPipe(requestOtpSchema)) body: { email: string },
    @Req() req: Request,
  ) {
    await this.authService.requestOtp(body.email, req.ip ?? '');
    return { success: true, message: 'OTP sent to email' };
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body(new ZodValidationPipe(verifyOtpSchema)) body: { email: string; otp: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(
      body.email,
      body.otp,
      req.ip ?? '',
      req.headers['user-agent'] ?? '',
    );

    res.cookie('woops_refresh', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return {
      success: true,
      data: {
        accessToken: result.accessToken,
        sessionId: result.sessionId,
        user: result.user,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.woops_refresh;
    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: 'NO_REFRESH_TOKEN', message: 'Refresh token not found' },
      });
    }

    const result = await this.authService.refresh(token, req.ip ?? '');

    res.cookie('woops_refresh', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return {
      success: true,
      data: { accessToken: result.accessToken },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.woops_refresh;
    const user = req.user as { id: string; sessionId: string } | undefined;

    await this.authService.logout(token, user?.sessionId);

    res.clearCookie('woops_refresh', { path: '/api/v1/auth' });
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: { id: string }, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutAll(user.id);
    res.clearCookie('woops_refresh', { path: '/api/v1/auth' });
  }

  @Post('switch-organization')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async switchOrganization(
    @CurrentUser() user: { id: string; sessionId: string },
    @Body() body: { organizationId: string },
  ) {
    const result = await this.authService.switchOrganization(
      user.id,
      user.sessionId,
      body.organizationId,
    );

    return {
      success: true,
      data: { accessToken: result.accessToken },
    };
  }
}
