import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { AssignPacketDto } from './dto/assign-packet.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('locations')
  @RequirePermissions('girvi:approve')
  createLocation(@CurrentContext() ctx: RequestContext, @Body() dto: CreateLocationDto) {
    return this.inventoryService.createLocation(ctx, dto);
  }

  @Get('locations')
  @RequirePermissions('girvi:create')
  listLocations(@CurrentContext() ctx: RequestContext, @Query('branchId') branchId?: string) {
    return this.inventoryService.listLocations(ctx, branchId);
  }

  @Post('packets')
  @RequirePermissions('girvi:create')
  assignPacket(@CurrentContext() ctx: RequestContext, @Body() dto: AssignPacketDto) {
    return this.inventoryService.assignPacket(ctx, dto);
  }

  @Patch('packets/:id/move')
  @RequirePermissions('girvi:create')
  move(
    @CurrentContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body('storageLocationId') storageLocationId: string,
  ) {
    return this.inventoryService.moveLocation(ctx, id, storageLocationId);
  }

  @Get('packets/qr/:qrCode')
  @RequirePermissions('girvi:create')
  findByQr(@CurrentContext() ctx: RequestContext, @Param('qrCode') qrCode: string) {
    return this.inventoryService.findByQr(ctx, qrCode);
  }
}
