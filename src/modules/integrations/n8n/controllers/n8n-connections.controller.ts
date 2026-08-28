import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { TenantAccessGuard } from '../../../../common/guards/tenant-access.guard';
import { JwtAuthGuard } from '../../../auth/guards/auth.guard';
import { createN8nConnectionSchema, updateN8nConnectionSchema } from '../dto/n8n-connection.dto';
import { N8nConnectionsService } from '../services/n8n-connections.service';

@Controller('integrations/n8n')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class N8nConnectionsController {
  constructor(private readonly connections: N8nConnectionsService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @CurrentUser() user: ControllerUser,
  ): Promise<N8nConnectionsView> {
    const dto = createN8nConnectionSchema.parse(body);
    return this.connections.create(dto, this.scopeFor(dto.organizationId, user));
  }

  @Get()
  async list(@CurrentUser() user: ControllerUser): Promise<N8nConnectionsView[]> {
    return this.connections.list(this.scopeFor(undefined, user));
  }

  @Get(':id')
  async findById(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.connections.findById(id, this.scopeFor(undefined, user));
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: ControllerUser,
  ) {
    const dto = updateN8nConnectionSchema.parse(body);
    return this.connections.update(id, dto, this.scopeFor(undefined, user));
  }

  @Post(':id/verify')
  async verify(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.connections.verify(id, this.scopeFor(undefined, user));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: ControllerUser) {
    return this.connections.softDelete(id, this.scopeFor(undefined, user));
  }

  /** Acting context: organization mode when the client is operating in an org. */
  private scopeFor(
    explicitOrganizationId: string | undefined,
    user: ControllerUser,
  ): { userId?: string; organizationId?: string } {
    if (explicitOrganizationId && user.activeContext === 'organization') {
      // Never trust a body-provided org id blindly — only accept it when it
      // matches the authenticated acting context.
      return { userId: user.id, organizationId: user.organizationId };
    }
    if (user.activeContext === 'organization' && user.organizationId) {
      return { userId: user.id, organizationId: user.organizationId };
    }
    return { userId: user.id };
  }
}

type ControllerUser = { id: string; activeContext?: string; organizationId?: string };
type N8nConnectionsView = Awaited<ReturnType<N8nConnectionsService['findById']>>;
