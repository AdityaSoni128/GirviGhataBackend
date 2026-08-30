import request = require('supertest');
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

export interface TestTenantFixture {
  tenantId: string;
  branchId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerPassword: string;
  accessToken: string;
}

/**
 * Boots the real AppModule (all guards/interceptors active) against
 * whatever DATABASE_URL is set in the environment.
 *
 * See .github/workflows/ci.yml or run
 * `docker compose up postgres` locally and point DATABASE_URL
 * at it before running `npm run test:e2e`.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();

  const prisma = moduleRef.get(PrismaService);

  return {
    app,
    prisma,
  };
}

/**
 * Creates a minimal but complete tenant:
 *
 * - Tenant
 * - Main branch
 * - Role
 * - All global permissions assigned to the role
 * - Active owner user
 * - Number sequences required by the application
 * - Real login/access token
 *
 * Number sequences are initialized here because they are tenant-level
 * configuration and are required by customer/girvi/payment/etc. services.
 */
export async function createTestTenant(
  app: INestApplication,
  prisma: PrismaService,
  namePrefix: string,
): Promise<TestTenantFixture> {
  const unique = `${namePrefix}-${Date.now()}-${Math.floor(
    Math.random() * 100000,
  )}`;

  // ---------------------------------------------------------------------------
  // Tenant
  // ---------------------------------------------------------------------------

  const tenant = await prisma.tenant.create({
    data: {
      name: `Test Tenant ${unique}`,
    },
  });

  // ---------------------------------------------------------------------------
  // Branch
  // ---------------------------------------------------------------------------

  const branch = await prisma.branch.create({
    data: {
      tenantId: tenant.id,
      code: 'MAIN',
      name: 'Main Branch',
    },
  });

  // ---------------------------------------------------------------------------
  // Global permissions
  // ---------------------------------------------------------------------------

  const allPermissions = await prisma.permission.findMany();

  // ---------------------------------------------------------------------------
  // Tenant role with every permission
  // ---------------------------------------------------------------------------

  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: 'Everything',
      permissions: {
        create: allPermissions.map((permission) => ({
          permissionId: permission.id,
        })),
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Owner user
  // ---------------------------------------------------------------------------

  const ownerEmail = `owner-${unique}@example.test`;
  const ownerPassword = 'TestPassword123!';
  const passwordHash = await argon2.hash(ownerPassword);

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Test Owner',
      email: ownerEmail,
      passwordHash,
      roles: {
        create: [
          {
            roleId: role.id,
          },
        ],
      },
      branches: {
        create: [
          {
            branchId: branch.id,
          },
        ],
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Tenant number sequences
  // ---------------------------------------------------------------------------
  //
  // These are tenant-level configuration.
  //
  // IMPORTANT:
  // Do NOT create these again inside setupGoldMetal().
  //
  // upsert is intentionally used so this helper remains safe even if another
  // test setup has already initialized the sequences for this tenant.
  //

  const sequences: Array<[string, string]> = [
    ['GIRVI', 'GRV'],
    ['PAYMENT', 'PAY'],
    ['REDEMPTION', 'RED'],
    ['CUSTOMER', 'CUS'],
    ['EXPENSE', 'EXP'],
  ];

  for (const [entity, prefix] of sequences) {
    await prisma.numberSequence.upsert({
      where: {
        tenantId_entity: {
          tenantId: tenant.id,
          entity,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        entity,
        prefix,
        lastValue: 0,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Real login
  // ---------------------------------------------------------------------------

  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: ownerEmail,
      password: ownerPassword,
    })
    .expect(201);

  return {
    tenantId: tenant.id,
    branchId: branch.id,
    ownerUserId: user.id,
    ownerEmail,
    ownerPassword,
    accessToken: loginRes.body.accessToken,
  };
}

/**
 * Ensures the global (non-tenant-scoped) permission catalogue exists
 * before tests run.
 */
export async function ensureGlobalPermissions(
  prisma: PrismaService,
): Promise<void> {
  const PERMISSIONS = [
    'customer:view',
    'customer:create',
    'customer:edit',

    'kyc:view_masked',
    'kyc:view_full',

    'girvi:create',
    'girvi:modify',
    'girvi:approve',

    'payment:receive',
    'payment:cancel',

    'item:redeem',

    'rate:change',
    'rules:change',

    'reports:view',
    'reports:export',

    'records:delete',
    'audit:view',

    'tenant:manage',
    'auction:manage',
  ];

  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({
      where: {
        code,
      },
      update: {},
      create: {
        code,
        description: code,
      },
    });
  }
}

/**
 * Sets up gold + purity + current rate + default business rules
 * for a tenant so Girvi tests have everything they need.
 *
 * NOTE:
 * Number sequences are intentionally NOT created here.
 * They are initialized by createTestTenant().
 */
export async function setupGoldMetal(
  prisma: PrismaService,
  tenantId: string,
  ratePerGram = '6000',
) {
  // ---------------------------------------------------------------------------
  // Gold metal
  // ---------------------------------------------------------------------------

  const gold = await prisma.metal.create({
    data: {
      tenantId,
      code: 'GOLD',
      name: 'Gold',
    },
  });

  // ---------------------------------------------------------------------------
  // Purities
  // ---------------------------------------------------------------------------

  await prisma.purity.create({
    data: {
      tenantId,
      metalId: gold.id,
      code: '24K',
      fineFactor: '1.0000',
    },
  });

  await prisma.purity.create({
    data: {
      tenantId,
      metalId: gold.id,
      code: '22K',
      fineFactor: '0.9167',
    },
  });

  // ---------------------------------------------------------------------------
  // Current gold rate
  // ---------------------------------------------------------------------------

  await prisma.metalRate.create({
    data: {
      tenantId,
      metalId: gold.id,
      ratePerGram,
      createdBy: 'test-setup',
    },
  });

  // ---------------------------------------------------------------------------
  // Default business rules
  // ---------------------------------------------------------------------------

  await prisma.businessRuleSet.create({
    data: {
      tenantId,
      metalCode: 'GOLD',
      version: 1,
      isActive: true,

      eligibilityPercent: '70.000',

      marginType: 'FIXED',
      marginValue: '5000.00',

      interestMethod: 'FLAT_MONTHLY',
      interestPercent: '2.000',

      gracePeriodDays: 0,

      roundingRule: 'NONE',

      paymentAllocationOrder: [
        'PENALTY',
        'CHARGES',
        'INTEREST',
        'PRINCIPAL',
      ],

      createdBy: 'test-setup',
    },
  });

  return gold;
}

