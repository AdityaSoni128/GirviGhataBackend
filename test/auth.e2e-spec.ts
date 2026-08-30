import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp, createTestTenant, ensureGlobalPermissions } from './test-utils';

describe('Auth (e2e)', () => {
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

  it('rejects login with a wrong password', async () => {
    const fixture = await createTestTenant(app, prisma, 'auth-wrongpw');

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: fixture.ownerEmail, password: 'DefinitelyWrongPassword!' })
      .expect(401);
  });

  it('rejects login for a non-existent email without leaking whether the account exists', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'no-such-user@example.test', password: 'whatever123' })
      .expect(401);
    expect(res.body.message).not.toMatch(/not found/i);
  });

  it('rejects any request to a protected route without a token', async () => {
    await request(app.getHttpServer()).get('/customers').expect(401);
  });

  it('rejects a request with a garbage bearer token', async () => {
    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('accepts a valid token and issues a working refresh token', async () => {
    const fixture = await createTestTenant(app, prisma, 'auth-refresh');

    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${fixture.accessToken}`)
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: fixture.ownerEmail, password: fixture.ownerPassword })
      .expect(201);

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(201);

    expect(refreshRes.body.accessToken).toBeDefined();

    await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
      .expect(200);
  });

  it('logout-all invalidates existing refresh tokens (tokenVersion bump)', async () => {
    const fixture = await createTestTenant(app, prisma, 'auth-logoutall');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: fixture.ownerEmail, password: fixture.ownerPassword })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(201);

    // The refresh token issued before logout-all must now be rejected.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);
  });

  it('a deactivated user cannot log in even with the correct password', async () => {
    const fixture = await createTestTenant(app, prisma, 'auth-deactivated');
    await prisma.user.update({ where: { id: fixture.ownerUserId }, data: { isActive: false } });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: fixture.ownerEmail, password: fixture.ownerPassword })
      .expect(401);
  });
});
