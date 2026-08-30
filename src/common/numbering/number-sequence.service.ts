import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Generates configurable, gapless-per-tenant transaction numbers
 * (Section 50), e.g. GRV-2026-000001. Uses a row-level lock via
 * SELECT ... FOR UPDATE inside the caller's transaction so two concurrent
 * requests never get the same number (Section 73 concurrency edge case).
 *
 * IMPORTANT: must be called with a `tx` (Prisma.TransactionClient) that is
 * the SAME transaction used to create the entity that consumes the number,
 * so the entity and the sequence bump commit or roll back together.
 */
@Injectable()
export class NumberSequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entity: 'GIRVI' | 'PAYMENT' | 'REDEMPTION' | 'CUSTOMER' | 'EXPENSE',
  ): Promise<string> {
    // Lock the sequence row for this tenant+entity to serialize concurrent increments.
    const rows = await tx.$queryRaw<
      Array<{ id: string; prefix: string; yearInKey: boolean; lastValue: number }>
    >(Prisma.sql`
      SELECT id, prefix, "yearInKey", "lastValue"
      FROM number_sequences
      WHERE "tenantId" = ${tenantId} AND entity = ${entity}
      FOR UPDATE
    `);

    if (rows.length === 0) {
      throw new Error(`No number sequence configured for tenant ${tenantId} entity ${entity}`);
    }

    const seq = rows[0];
    const nextValue = seq.lastValue + 1;

    await tx.numberSequence.update({
      where: { id: seq.id },
      data: { lastValue: nextValue },
    });

    const padded = String(nextValue).padStart(6, '0');
    const year = new Date().getFullYear();
    return seq.yearInKey ? `${seq.prefix}-${year}-${padded}` : `${seq.prefix}-${padded}`;
  }
}
