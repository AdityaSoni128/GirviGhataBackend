import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { AssignPacketDto } from './dto/assign-packet.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async createLocation(ctx: RequestContext, dto: CreateLocationDto) {
    return this.prisma.storageLocation.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: dto.branchId,
        type: dto.type,
        code: dto.code,
        parentId: dto.parentId,
      },
    });
  }

  async listLocations(ctx: RequestContext, branchId?: string) {
    return this.prisma.storageLocation.findMany({
      where: { tenantId: ctx.tenantId, ...(branchId ? { branchId } : {}) },
      include: { children: true },
    });
  }

  /**
   * Creates (or re-points) the physical packet for a transaction, with a
   * unique QR code token. Scanning the QR in the client app should hit an
   * authenticated endpoint (findByQr) — never render KYC/customer data from
   * an unauthenticated scan (Section 22).
   */
  async assignPacket(ctx: RequestContext, dto: AssignPacketDto) {
    const transaction = await this.prisma.girviTransaction.findFirst({
      where: { id: dto.girviTransactionId, tenantId: ctx.tenantId },
    });
    if (!transaction) throw new NotFoundException('Girvi transaction not found');

    if (dto.storageLocationId) {
      const location = await this.prisma.storageLocation.findFirst({
        where: { id: dto.storageLocationId, tenantId: ctx.tenantId },
      });
      if (!location) throw new BadRequestException('Storage location not found');
    }

    const existing = await this.prisma.packet.findUnique({
      where: { girviTransactionId: transaction.id },
    });

    if (existing) {
      return this.prisma.packet.update({
        where: { id: existing.id },
        data: { storageLocationId: dto.storageLocationId },
      });
    }

    const packetNumber = `PKT-${transaction.girviNumber}`;
    const qrCode = randomUUID();

    const packet = await this.prisma.packet.create({
      data: {
        girviTransactionId: transaction.id,
        packetNumber,
        qrCode,
        storageLocationId: dto.storageLocationId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'PACKET_ASSIGN',
        entityType: 'Packet',
        entityId: packet.id,
        newValue: { packetNumber, storageLocationId: dto.storageLocationId },
      },
    });

    return packet;
  }

  /** Moves an existing packet to a different vault/locker/rack/tray (Section 73 "item moved between vault locations"). */
  async moveLocation(ctx: RequestContext, packetId: string, storageLocationId: string) {
    const packet = await this.prisma.packet.findFirst({
      where: { id: packetId, girviTransaction: { tenantId: ctx.tenantId } },
    });
    if (!packet) throw new NotFoundException('Packet not found');

    const updated = await this.prisma.packet.update({
      where: { id: packetId },
      data: { storageLocationId },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'PACKET_MOVE',
        entityType: 'Packet',
        entityId: packetId,
        oldValue: { storageLocationId: packet.storageLocationId },
        newValue: { storageLocationId },
      },
    });

    return updated;
  }

  /** Authenticated QR-scan lookup — requires the caller to already be authorized (Section 22). */
  async findByQr(ctx: RequestContext, qrCode: string) {
    const packet = await this.prisma.packet.findFirst({
      where: { qrCode, girviTransaction: { tenantId: ctx.tenantId } },
      include: { girviTransaction: { include: { customer: true, items: true } }, storageLocation: true },
    });
    if (!packet) throw new NotFoundException('Packet not found');
    return packet;
  }
}
