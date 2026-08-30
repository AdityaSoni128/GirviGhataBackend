import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RulesService } from '../rules/rules.service';

const SYSTEM_ACTOR = 'system-scheduler';

/**
 * Section 31/73: nothing else in the app flips a transaction to OVERDUE —
 * a due date passing is not itself a state change until this job (or a
 * manual override) says so. Deliberately conservative: it only ever moves
 * ACTIVE/PARTIALLY_PAID/RENEWED -> OVERDUE. It never auto-advances a
 * transaction into auction eligibility — that requires an explicit action
 * via AuctionService per Section 33's "must NOT automatically auction...
 * unless the configured business/legal workflow explicitly permits it".
 */
@Injectable()
export class OverdueSchedulerService {
  private readonly logger = new Logger(OverdueSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RulesService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async flagOverdueTransactions(): Promise<void> {
    const candidates = await this.prisma.girviTransaction.findMany({
      where: {
        status: { in: ['ACTIVE', 'PARTIALLY_PAID', 'RENEWED'] },
        dueDate: { not: null, lt: new Date() },
      },
      include: { items: true },
    });

    let flagged = 0;
    for (const tx of candidates) {
      const metalCode = tx.items[0]?.metalCode ?? 'GOLD';
      let graceDays = 0;
      try {
        const rules = await this.rules.getActiveRules(tx.tenantId, metalCode);
        graceDays = rules.gracePeriodDays;
      } catch {
        // No active rule set found for this metal (e.g. deleted since pledge)
        // — fall back to zero grace rather than skipping the transaction
        // silently.
      }

      const graceDeadline = new Date(tx.dueDate!.getTime() + graceDays * 24 * 60 * 60 * 1000);
      if (graceDeadline.getTime() > Date.now()) continue; // still within grace period

      await this.prisma.$transaction([
        this.prisma.girviTransaction.update({
          where: { id: tx.id },
          data: { status: 'OVERDUE', updatedBy: SYSTEM_ACTOR },
        }),
        this.prisma.auditLog.create({
          data: {
            tenantId: tx.tenantId,
            actorId: null,
            action: 'GIRVI_AUTO_OVERDUE',
            entityType: 'GirviTransaction',
            entityId: tx.id,
            oldValue: { status: tx.status },
            newValue: { status: 'OVERDUE', dueDate: tx.dueDate, graceDays },
            reason: 'Automated: due date + grace period elapsed',
          },
        }),
      ]);
      flagged += 1;
    }

    if (flagged > 0) {
      this.logger.log(`Flagged ${flagged} transaction(s) as OVERDUE`);
    }
  }
}
