import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp, createTestTenant, ensureGlobalPermissions, setupGoldMetal } from './test-utils';

describe('Tenant isolation (e2e)', () => {
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

  it("tenant B cannot fetch tenant A's customer by ID (404, not 403 — no existence leak)", async () => {
    const tenantA = await createTestTenant(app, prisma, 'iso-a');
    const tenantB = await createTestTenant(app, prisma, 'iso-b');

    const createRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ fullName: 'Tenant A Customer', mobile: '9000000001' })
      .expect(201);

    const customerId = createRes.body.id;

    await request(app.getHttpServer())
      .get(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const crossTenantRes = await request(app.getHttpServer())
      .get(`/customers/${customerId}`)
      .set('Authorization', `Bearer ${tenantB.accessToken}`);

    expect(crossTenantRes.status).toBe(404);
  });

  it("tenant B's customer search never returns tenant A's customers", async () => {
    const tenantA = await createTestTenant(app, prisma, 'iso-search-a');
    const tenantB = await createTestTenant(app, prisma, 'iso-search-b');

    await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ fullName: 'VeryUniqueNameXYZ', mobile: '9000000002' })
      .expect(201);

    const searchRes = await request(app.getHttpServer())
      .get('/customers')
      .query({ q: 'VeryUniqueNameXYZ' })
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .expect(200);

    expect(searchRes.body.results).toHaveLength(0);
  });

  it("a Girvi transaction created in tenant A is invisible via tenant B's token", async () => {
    const tenantA = await createTestTenant(app, prisma, 'iso-girvi-a');
    const tenantB = await createTestTenant(app, prisma, 'iso-girvi-b');
    await setupGoldMetal(prisma, tenantA.tenantId);

    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ fullName: 'Girvi Iso Customer', mobile: '9000000003' })
      .expect(201);

    const girviRes = await request(app.getHttpServer())
      .post('/girvi')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({
        customerId: customerRes.body.id,
        branchId: tenantA.branchId,
        items: [
          {
            itemType: 'chain',
            metalCode: 'GOLD',
            purityCode: '22K',
            grossWeight: '10.000',
            stoneWeight: '0.000',
          },
        ],
        requestedLoanAmount: '1000',
      })
      .expect(201);

    const girviId = girviRes.body.id;

    const crossTenantRes = await request(app.getHttpServer())
      .get(`/girvi/${girviId}`)
      .set('Authorization', `Bearer ${tenantB.accessToken}`);

    expect(crossTenantRes.status).toBe(404);

    const listRes = await request(app.getHttpServer())
      .get('/girvi')
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .expect(200);
    expect(listRes.body.results.find((t: any) => t.id === girviId)).toBeUndefined();
  });

  it('a user cannot modify a customer belonging to another tenant', async () => {
    const tenantA = await createTestTenant(app, prisma, 'iso-update-a');
    const tenantB = await createTestTenant(app, prisma, 'iso-update-b');

    const customerRes = await request(app.getHttpServer())
      .post('/customers')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ fullName: 'Update Iso Customer', mobile: '9000000004' })
      .expect(201);

    const updateRes = await request(app.getHttpServer())
      .patch(`/customers/${customerRes.body.id}`)
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .send({ fullName: 'Hijacked Name' });

    expect(updateRes.status).toBe(404);

    const stillOriginal = await prisma.customer.findUnique({ where: { id: customerRes.body.id } });
    expect(stillOriginal?.fullName).toBe('Update Iso Customer');
  });
});
