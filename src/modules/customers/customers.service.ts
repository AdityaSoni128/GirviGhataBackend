import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { NumberSequenceService } from '../../common/numbering/number-sequence.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sequences: NumberSequenceService,
  ) { }

  async create(ctx: RequestContext, dto: CreateCustomerDto) {
    return this.prisma.$transaction(async (tx) => {
      const customerCode = await this.sequences.next(tx, ctx.tenantId, 'CUSTOMER');

      const customer = await tx.customer.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: dto.branchId,
          customerCode,
          fullName: dto.fullName,
          guardianName: dto.guardianName,
          mobile: dto.mobile,
          altMobile: dto.altMobile,
          dob: dto.dob ? new Date(dto.dob) : undefined,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
        },
      });

      if (dto.aadhaarNumber || dto.panNumber) {
        await tx.customerKyc.create({
          data: {
            customerId: customer.id,
            aadhaarEncrypted: dto.aadhaarNumber ? this.crypto.encrypt(dto.aadhaarNumber) : undefined,
            aadhaarLast4: dto.aadhaarNumber ? dto.aadhaarNumber.slice(-4) : undefined,
            panNumber: dto.panNumber, // PAN is masked in output, not encrypted at rest (lower sensitivity than Aadhaar)
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'CUSTOMER_CREATE',
          entityType: 'Customer',
          entityId: customer.id,
          newValue: { customerCode, fullName: dto.fullName, mobile: dto.mobile },
        },
      });

      return this.toSafeCustomer(customer, null);
    });
  }

  async update(ctx: RequestContext, customerId: string, dto: UpdateCustomerDto) {
    const existing = await this.getOwnedOrThrow(ctx.tenantId, customerId);

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        fullName: dto.fullName,
        guardianName: dto.guardianName,
        mobile: dto.mobile,
        altMobile: dto.altMobile,
        dob: dto.dob ? new Date(dto.dob) : undefined,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'CUSTOMER_EDIT',
        entityType: 'Customer',
        entityId: customerId,
        oldValue: { fullName: existing.fullName, mobile: existing.mobile },
        newValue: { fullName: updated.fullName, mobile: updated.mobile },
      },
    });

    return this.findOne(ctx, customerId);
  }

  /** Fast multi-field search (Section 7). Aadhaar/PAN are matched on their
   * stored plaintext lookup fields (last-4 / full PAN), never by decrypting
   * every row — that would be both slow and a KYC-exposure risk. */
  async search(ctx: RequestContext, q: string | undefined, page: number, pageSize: number) {
    const where = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...(q
        ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { mobile: { contains: q } },
            { customerCode: { contains: q, mode: 'insensitive' as const } },
            { kyc: { aadhaarLast4: { contains: q } } },
            { kyc: { panNumber: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: { kyc: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      results: rows.map((c: any) => this.toSafeCustomer(c, c.kyc)),
      total,
      page,
      pageSize,
    };
  }

  /** Full profile view (Section 7): active/closed loans, outstanding, history. */
  async findOne(ctx: RequestContext, customerId: string, viewFullKyc = false) {
    const customer = await this.getOwnedOrThrow(ctx.tenantId, customerId, true);

    if (viewFullKyc && !ctx.permissions.includes('kyc:view_full')) {
      throw new ForbiddenException('Missing permission kyc:view_full');
    }
    if (viewFullKyc) {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'KYC_UNMASK_VIEW',
          entityType: 'Customer',
          entityId: customerId,
        },
      });
    }

    const transactions = await this.prisma.girviTransaction.findMany({
      where: { tenantId: ctx.tenantId, customerId },
      include: { valuation: true, payments: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...this.toSafeCustomer(customer, (customer as any).kyc, viewFullKyc),
      transactions: transactions.map((t: any) => ({
        girviNumber: t.girviNumber,
        status: t.status,
        pledgeDate: t.pledgeDate,
        dueDate: t.dueDate,
        loanAmount: t.valuation?.actualLoanAmount ?? null,
        totalPaid: t.payments
          .filter((p: any) => !p.isReversed)
          .reduce((sum: number, p: any) => sum + Number(p.amount), 0),
      })),
    };
  }

  private async getOwnedOrThrow(tenantId: string, customerId: string, withKyc = false) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      include: withKyc ? { kyc: true } : undefined,
    });
    if (!customer) {
      // Tenant isolation: a customer belonging to another tenant returns
      // 404, never 403 — we don't want to confirm the ID even exists.
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private toSafeCustomer(customer: any, kyc: any, unmask = false) {
    const { deletedAt, ...rest } = customer;
    return {
      ...rest,
      kyc: kyc
        ? {
          aadhaarMasked: kyc.aadhaarLast4 ? this.crypto.maskAadhaar(kyc.aadhaarLast4) : null,
          aadhaarFull: unmask && kyc.aadhaarEncrypted ? this.crypto.decrypt(kyc.aadhaarEncrypted) : undefined,
          panNumber: unmask ? kyc.panNumber : kyc.panNumber ? this.maskPan(kyc.panNumber) : null,
        }
        : null,
    };
  }

  private maskPan(pan: string): string {
    if (pan.length < 4) return 'XXXXXXXXXX';
    return `${'X'.repeat(pan.length - 4)}${pan.slice(-4)}`;
  }
}
