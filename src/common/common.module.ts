import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { TenantAccessGuard } from './guards/tenant-access.guard';

@Global()
@Module({
  providers: [
    TenantAccessGuard,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
  exports: [TenantAccessGuard],
})
export class CommonModule {}
