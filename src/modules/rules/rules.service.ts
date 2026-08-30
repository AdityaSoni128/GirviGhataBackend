import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestContext } from '../../common/decorators/current-context.decorator';
import { CreateRuleSetDto } from './dto/create-rule-set.dto';
import { BusinessRules } from '../calculation-engine/calculation.types';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches the active rule set for a metal and converts it into the
   * CalculationEngine's BusinessRules shape. This is the only place that
   * bridges "stored config" to "engine input" — Girvi/Payments services
   * call this, never read business_rule_sets directly.
   */
  async getActiveRules(tenantId: string, metalCode: string): Promise<BusinessRules & { ruleSetDbId: string }> {
    const ruleSet = await this.prisma.businessRuleSet.findFirst({
      where: { tenantId, metalCode, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!ruleSet) {
      throw new NotFoundException(`No active business rules configured for ${metalCode}`);
    }

    return {
      ruleSetId: ruleSet.id,
      ruleSetDbId: ruleSet.id,
      eligibilityPercent: new Decimal(ruleSet.eligibilityPercent.toString()),
      marginType: ruleSet.marginType as 'FIXED' | 'PERCENT' | 'NONE',
      marginValue: new Decimal(ruleSet.marginValue.toString()),
      interestMethod: ruleSet.interestMethod as 'FLAT_MONTHLY' | 'DAILY' | 'REDUCING_BALANCE',
      interestPercent: new Decimal(ruleSet.interestPercent.toString()),
      gracePeriodDays: ruleSet.gracePeriodDays,
      loanTermDays: ruleSet.loanTermDays,
      roundingRule: ruleSet.roundingRule as 'NONE' | 'ROUND_NEAREST_1' | 'ROUND_NEAREST_10',
      minLoanAmount: ruleSet.minLoanAmount ? new Decimal(ruleSet.minLoanAmount.toString()) : undefined,
      maxLoanAmount: ruleSet.maxLoanAmount ? new Decimal(ruleSet.maxLoanAmount.toString()) : undefined,
      paymentAllocationOrder: ruleSet.paymentAllocationOrder as Array<
        'PENALTY' | 'CHARGES' | 'INTEREST' | 'PRINCIPAL'
      >,
    };
  }

  /**
   * Creates a NEW version and deactivates the old one — rule sets are never
   * edited in place (Section 58/64), so every past Girvi transaction's
   * snapshot still points at the exact rule version that applied to it.
   */
  async createNewVersion(ctx: RequestContext, dto: CreateRuleSetDto) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const previous = await tx.businessRuleSet.findFirst({
        where: { tenantId: ctx.tenantId, metalCode: dto.metalCode, isActive: true },
        orderBy: { version: 'desc' },
      });

      if (previous) {
        await tx.businessRuleSet.update({
          where: { id: previous.id },
          data: { isActive: false },
        });
      }

      const created = await tx.businessRuleSet.create({
        data: {
          tenantId: ctx.tenantId,
          metalCode: dto.metalCode,
          version: (previous?.version ?? 0) + 1,
          isActive: true,
          eligibilityPercent: dto.eligibilityPercent,
          marginType: dto.marginType,
          marginValue: dto.marginValue,
          interestMethod: dto.interestMethod,
          interestPercent: dto.interestPercent,
          gracePeriodDays: dto.gracePeriodDays,
          loanTermDays: dto.loanTermDays,
          roundingRule: dto.roundingRule,
          minLoanAmount: dto.minLoanAmount,
          maxLoanAmount: dto.maxLoanAmount,
          paymentAllocationOrder: dto.paymentAllocationOrder,
          createdBy: ctx.userId,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          action: 'RULES_CHANGE',
          entityType: 'BusinessRuleSet',
          entityId: created.id,
          oldValue: previous ? { version: previous.version } : "",
          newValue: { version: created.version, ...dto },
        },
      });

      return created;
    });
  }

  async listVersions(ctx: RequestContext, metalCode: string) {
    return this.prisma.businessRuleSet.findMany({
      where: { tenantId: ctx.tenantId, metalCode },
      orderBy: { version: 'desc' },
    });
  }
}
