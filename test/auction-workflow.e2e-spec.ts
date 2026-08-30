import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp, createTestTenant, ensureGlobalPermissions, setupGoldMetal } from './test-utils';

describe('Auction workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    prisma = setup.prisma;
    await ensureGlobalPermissions(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOverdueGirvi(prefix: string) {
    const tenant = await createTestTenant(app, prisma, prefix);
    await setupGoldMetal(prisma, tenant.tenantId, '6000');
    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ fullName: 'Auction Test Customer', mobile: '9222222222' })
      .expect(201);

    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId: customerRes.body.id,
        branchId: tenant.branchId,
        items: [
          { itemType: 'chain', metalCode: 'GOLD', purityCode: '24K', grossWeight: '10.000', stoneWeight: '0.000' },
        ],
        requestedLoanAmount: '20000',
      })
      .expect(201);

    // Force the transaction into OVERDUE directly — the point of this test
    // is the auction pipeline itself, not the scheduler.
    await prisma.girviTransaction.update({
      where: { id: girviRes.body.id },
      data: { status: 'OVERDUE' },
    });

    return { tenant, girviId: girviRes.body.id };
  }

  it('rejects sending a notice for a transaction that is not OVERDUE', async () => {
    const tenant = await createTestTenant(app, prisma, 'auction-notovderdue');
    await setupGoldMetal(prisma, tenant.tenantId);
    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ fullName: 'Not Overdue Customer', mobile: '9222222223' })
      .expect(201);
    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId: customerRes.body.id,
        branchId: tenant.branchId,
        items: [{ itemType: 'ring', metalCode: 'GOLD', purityCode: '24K', grossWeight: '5.000', stoneWeight: '0.000' }],
        requestedLoanAmount: '5000',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/auctions/${girviRes.body.id}/notice`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('walks the full pipeline in order and rejects skipping a step', async () => {
    const { tenant, girviId } = await createOverdueGirvi('auction-fullpath');

    await request(app.getHttpServer())
      .post(`/auctions/${girviId}/notice`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({})
      .expect(201);

    // Skipping straight to schedule (bypassing "eligible") must fail.
    const skipRes = await request(app.getHttpServer())
      .post(`/auctions/${girviId}/schedule`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    expect(skipRes.status).toBe(400);

    await request(app.getHttpServer())
      .post(`/auctions/${girviId}/eligible`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({})
      .expect(201);

    const girviAfterEligible = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(girviAfterEligible.body.status).toBe('AUCTION_ELIGIBLE');

    await request(app.getHttpServer())
      .post(`/auctions/${girviId}/schedule`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ scheduledAt: new Date(Date.now() + 86400000).toISOString() })
      .expect(201);

    const saleRes = await request(app.getHttpServer())
      .post(`/auctions/${girviId}/sale`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ finalSaleAmount: '25000', buyerName: 'Test Buyer' })
      .expect(201);
    expect(saleRes.body.status).toBe('AUCTIONED');

    const girviAfterSale = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(girviAfterSale.body.status).toBe('AUCTIONED');

    await request(app.getHttpServer())
      .post(`/auctions/${girviId}/close`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({})
      .expect(201);

    const girviAfterClose = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(girviAfterClose.body.status).toBe('CLOSED');

    // Settlement math: sale amount minus what was owed = profit/loss, and it's persisted.
    const settlement = await prisma.auctionSettlement.findFirst({
      where: { auctionCase: { girviTransactionId: girviId } },
    });
    expect(settlement).not.toBeNull();
    expect(settlement?.finalSaleAmount?.toString()).toBe('25000');
  });

  it('does not allow a second notice to be sent for the same transaction', async () => {
    const { tenant, girviId } = await createOverdueGirvi('auction-doublenotice');

    await request(app.getHttpServer())
      .post(`/auctions/${girviId}/notice`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({})
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/auctions/${girviId}/notice`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
