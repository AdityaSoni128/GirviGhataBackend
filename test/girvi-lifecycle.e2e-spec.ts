import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp, createTestTenant, ensureGlobalPermissions, setupGoldMetal } from './test-utils';

describe('Girvi lifecycle (e2e)', () => {
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

  async function setupTenantWithCustomer(prefix: string) {
    const tenant = await createTestTenant(app, prisma, prefix);
    await setupGoldMetal(prisma, tenant.tenantId, '6000'); // ₹6000/gram
    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ fullName: 'Lifecycle Customer', mobile: '9111111111' })
      .expect(201);
    return { tenant, customerId: customerRes.body.id };
  }

  it('rejects a requested loan amount above the server-computed maximum', async () => {
    const { tenant, customerId } = await setupTenantWithCustomer('lifecycle-reject');

    // 10g net * 22K (0.9167) * ₹6000/g = ₹55,002 metal value
    // 70% eligibility = ₹38,501.4; minus ₹5,000 fixed margin = ₹33,501.4 max loan
    const res = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId,
        branchId: tenant.branchId,
        items: [
          { itemType: 'chain', metalCode: 'GOLD', purityCode: '22K', grossWeight: '10.000', stoneWeight: '0.000' },
        ],
        requestedLoanAmount: '50000', // intentionally exceeds the max
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds the maximum eligible amount/i);
  });

  it('creates a Girvi transaction matching the documented ₹100,000 → 70% → ₹5,000 margin → ₹65,000 example', async () => {
    const { tenant, customerId } = await setupTenantWithCustomer('lifecycle-example');

    // Constructed so total metal value lands at exactly ₹100,000:
    // netWeight * fineFactor * rate = 100000 -> with 24K (factor 1) and rate 6000/g,
    // netWeight = 100000/6000 = 16.6667g
    const res = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId,
        branchId: tenant.branchId,
        items: [
          {
            itemType: 'bar',
            metalCode: 'GOLD',
            purityCode: '24K',
            grossWeight: '16.66667',
            stoneWeight: '0.00000',
          },
        ],
        requestedLoanAmount: '65000',
      })
      .expect(201);

    expect(res.body.valuation.actualLoanAmount).toBe('65000');
    expect(res.body.status).toBe('ACTIVE');
  });

  it('full lifecycle: create -> partial payment -> full payment -> redemption', async () => {
    const { tenant, customerId } = await setupTenantWithCustomer('lifecycle-full');

    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId,
        branchId: tenant.branchId,
        items: [
          { itemType: 'ring', metalCode: 'GOLD', purityCode: '24K', grossWeight: '20.000', stoneWeight: '0.000' },
        ],
        requestedLoanAmount: '50000',
      })
      .expect(201);

    const girviId = girviRes.body.id;

    // Cannot redeem while outstanding > 0.
    const earlyRedeemRes = await request(app.getHttpServer())
      .post('/redemptions')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ girviTransactionId: girviId });
    expect(earlyRedeemRes.status).toBe(400);

    // Partial payment.
    const partialPayRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ girviTransactionId: girviId, amount: '10000', mode: 'CASH' })
      .expect(201);
    expect(partialPayRes.body.allocations.length).toBeGreaterThan(0);

    const afterPartial = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(afterPartial.body.status).toBe('PARTIALLY_PAID');

    // Pay off the rest.
    const outstandingRes = await request(app.getHttpServer())
      .get(`/payments/outstanding/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    const remaining = outstandingRes.body.totalOutstanding;

    await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ girviTransactionId: girviId, amount: remaining, mode: 'UPI' })
      .expect(201);

    const afterFull = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(afterFull.body.status).toBe('CLOSED');

    // Now redemption should succeed.
    const redeemRes = await request(app.getHttpServer())
      .post('/redemptions')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ girviTransactionId: girviId })
      .expect(201);
    expect(redeemRes.body.redemptionNumber).toMatch(/^RED-/);

    const afterRedeem = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(afterRedeem.body.status).toBe('REDEEMED');
  });

  it('a payment larger than outstanding is rejected rather than silently overpaying', async () => {
    const { tenant, customerId } = await setupTenantWithCustomer('lifecycle-overpay');

    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId,
        branchId: tenant.branchId,
        items: [
          { itemType: 'chain', metalCode: 'GOLD', purityCode: '24K', grossWeight: '10.000', stoneWeight: '0.000' },
        ],
        requestedLoanAmount: '20000',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ girviTransactionId: girviRes.body.id, amount: '999999', mode: 'CASH' });

    expect(res.status).toBe(400);
  });

  it('reversing a payment restores ACTIVE status and is never a hard delete', async () => {
    const { tenant, customerId } = await setupTenantWithCustomer('lifecycle-reverse');

    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId,
        branchId: tenant.branchId,
        items: [
          { itemType: 'chain', metalCode: 'GOLD', purityCode: '24K', grossWeight: '10.000', stoneWeight: '0.000' },
        ],
        requestedLoanAmount: '20000',
      })
      .expect(201);

    const paymentRes = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ girviTransactionId: girviRes.body.id, amount: '5000', mode: 'CASH' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/payments/${paymentRes.body.id}/reverse`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ reason: 'Entered by mistake' })
      .expect(201);

    // The row still exists — never hard-deleted (Section 41) — just flagged.
    const stillExists = await prisma.payment.findUnique({ where: { id: paymentRes.body.id } });
    expect(stillExists).not.toBeNull();
    expect(stillExists?.isReversed).toBe(true);

    const afterReversal = await request(app.getHttpServer())
      .get(`/girvi/${girviRes.body.id}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(afterReversal.body.status).toBe('ACTIVE');
  });

  it('a user without payment:receive permission cannot record a payment', async () => {
    const { tenant, customerId } = await setupTenantWithCustomer('lifecycle-perm');

    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({
        customerId,
        branchId: tenant.branchId,
        items: [
          { itemType: 'chain', metalCode: 'GOLD', purityCode: '24K', grossWeight: '10.000', stoneWeight: '0.000' },
        ],
        requestedLoanAmount: '20000',
      })
      .expect(201);

    const viewPermission = await prisma.permission.findUniqueOrThrow({ where: { code: 'customer:view' } });
    const limitedRole = await prisma.role.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'ViewOnly',
        permissions: { create: [{ permissionId: viewPermission.id }] },
      },
    });
    const limitedEmail = `limited-${Date.now()}@example.test`;
    const limitedPasswordHash = await argon2.hash('Password123!');
    await prisma.user.create({
      data: {
        tenantId: tenant.tenantId,
        fullName: 'Limited User',
        email: limitedEmail,
        passwordHash: limitedPasswordHash,
        roles: { create: [{ roleId: limitedRole.id }] },
        branches: { create: [{ branchId: tenant.branchId }] },
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: limitedEmail, password: 'Password123!' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ girviTransactionId: girviRes.body.id, amount: '1000', mode: 'CASH' });

    expect(res.status).toBe(403);
  });
});
