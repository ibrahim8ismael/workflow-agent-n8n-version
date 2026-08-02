import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export const CurrentOrganization = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.organization;
});
