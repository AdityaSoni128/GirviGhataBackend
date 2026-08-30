import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Canonical permission list (Section 40). Kept as data, not enums, so a
// Super Admin can extend this list without a code deploy.
const PERMISSIONS: Array<{ code: string; description: string }> = [
  { code: 'customer:view', description: 'View customer profiles' },
  { code: 'customer:create', description: 'Create customers' },
  { code: 'customer:edit', description: 'Edit customer profiles' },
  { code: 'kyc:view_masked', description: 'View masked KYC fields' },
  { code: 'kyc:view_full', description: 'View unmasked KYC fields (audited)' },
  { code: 'girvi:create', description: 'Create Girvi transactions' },
  { code: 'girvi:modify', description: 'Modify draft Girvi transactions' },
  { code: 'girvi:approve', description: 'Approve/activate Girvi transactions' },
  { code: 'payment:receive', description: 'Receive customer payments' },
  { code: 'payment:cancel', description: 'Cancel/reverse a payment' },
  { code: 'item:redeem', description: 'Redeem pledged items' },
  { code: 'rate:change', description: 'Change metal rates' },
  { code: 'rules:change', description: 'Change interest/eligibility/margin rules' },
  { code: 'tenant:manage', description: 'Manage branches, roles, and users for the tenant' },
  { code: 'auction:manage', description: 'Manage the auction/default workflow for overdue loans' },
  { code: 'reports:view', description: 'View reports' },
  { code: 'reports:export', description: 'Export reports (PDF/Excel/CSV)' },
  { code: 'records:delete', description: 'Soft-delete records' },
  { code: 'audit:view', description: 'View audit logs' },
];

// Default role -> permission mapping (Section 40). Tenants can edit this
// after seeding; these are just sensible starting points.
const DEFAULT_ROLES: Record<string, string[]> = {
  'Business Owner': PERMISSIONS.map((p) => p.code), // everything
  'Branch Manager': [
    'customer:view', 'customer:create', 'customer:edit',
    'kyc:view_masked', 'kyc:view_full',
    'girvi:create', 'girvi:modify', 'girvi:approve',
    'payment:receive', 'payment:cancel', 'item:redeem',
    'reports:view', 'reports:export', 'auction:manage',
  ],
  Staff: [
    'customer:view', 'customer:create', 'customer:edit',
    'kyc:view_masked',
    'girvi:create', 'girvi:modify',
  ],
  Cashier: ['customer:view', 'payment:receive', 'reports:view'],
  Valuator: ['customer:view', 'girvi:create', 'girvi:modify'],
  Auditor: ['customer:view', 'kyc:view_masked', 'reports:view', 'audit:view'],
};

async function main() {
  // --- Permissions (global, not tenant-scoped) ---
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }

  // --- Subscription plans ---
  await prisma.subscriptionPlan.upsert({
    where: { code: 'STARTER' },
    update: {},
    create: {
      code: 'STARTER',
      name: 'Starter',
      maxBranches: 1,
      maxUsers: 3,
      featureFlags: { advancedReports: false, whatsapp: false, api: false },
    },
  });
  await prisma.subscriptionPlan.upsert({
    where: { code: 'PROFESSIONAL' },
    update: {},
    create: {
      code: 'PROFESSIONAL',
      name: 'Professional',
      maxBranches: 5,
      maxUsers: 20,
      featureFlags: { advancedReports: true, whatsapp: true, api: false },
    },
  });
  await prisma.subscriptionPlan.upsert({
    where: { code: 'ENTERPRISE' },
    update: {},
    create: {
      code: 'ENTERPRISE',
      name: 'Enterprise',
      maxBranches: null,
      maxUsers: null,
      featureFlags: { advancedReports: true, whatsapp: true, api: true, customBranding: true },
    },
  });

  // --- Demo tenant: Shree Ram Jwellers ---
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Shree Ram Jwellers',
      legalName: 'Shree Ram Jwellers',
      city: 'Nagda',
      state: 'Madhya Pradesh',
    },
  });

  const starterPlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'STARTER' } });
  await prisma.tenantSubscription.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, planId: starterPlan.id },
  });

  const branch = await prisma.branch.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'MAIN' } },
    update: {},
    create: { tenantId: tenant.id, code: 'MAIN', name: 'Main Branch' },
  });

  // --- Roles + role-permission mapping for this tenant ---
  for (const [roleName, permCodes] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
      update: {},
      create: { tenantId: tenant.id, name: roleName, isSystem: true },
    });
    for (const code of permCodes) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // --- Metals + purities ---
  const gold = await prisma.metal.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'GOLD' } },
    update: {},
    create: { tenantId: tenant.id, code: 'GOLD', name: 'Gold' },
  });
  const silver = await prisma.metal.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'SILVER' } },
    update: {},
    create: { tenantId: tenant.id, code: 'SILVER', name: 'Silver' },
  });

  const goldPurities: Array<[string, string]> = [
    ['24K', '1.0000'], ['22K', '0.9167'], ['20K', '0.8333'], ['18K', '0.7500'], ['14K', '0.5833'],
  ];
  for (const [code, factor] of goldPurities) {
    await prisma.purity.upsert({
      where: { tenantId_metalId_code: { tenantId: tenant.id, metalId: gold.id, code } },
      update: {},
      create: { tenantId: tenant.id, metalId: gold.id, code, fineFactor: factor },
    });
  }

   const silverPurities: Array<[string, string]> = [
    ['999', '0.9990'], ['925', '0.9250'], ['900', '0.9000'], ['835', '0.8350'],
    ['70', '0.7000'], ['65', '0.6500'], ['60', '0.6000'],
    ['50', '0.5000'], ['40', '0.4000'], ['35', '0.3500'],
  ];
  for (const [code, factor] of silverPurities) {
    await prisma.purity.upsert({
      where: { tenantId_metalId_code: { tenantId: tenant.id, metalId: silver.id, code } },
      update: {},
      create: { tenantId: tenant.id, metalId: silver.id, code, fineFactor: factor },
    });
  }

  // --- Default business rules (Phase 1 Step 2 defaults; pending your confirmation) ---
  for (const metalCode of ['GOLD', 'SILVER']) {
    await prisma.businessRuleSet.upsert({
      where: { tenantId_metalCode_version: { tenantId: tenant.id, metalCode, version: 1 } },
      update: {},
      create: {
        tenantId: tenant.id,
        metalCode,
        version: 1,
        isActive: true,
        eligibilityPercent: '70.000',
        marginType: 'FIXED',
        marginValue: '5000.00',
        interestMethod: 'FLAT_MONTHLY',
        interestPercent: '2.000',
        gracePeriodDays: 0,
        roundingRule: 'ROUND_NEAREST_10',
        paymentAllocationOrder: ['PENALTY', 'CHARGES', 'INTEREST', 'PRINCIPAL'],
        createdBy: 'seed-script',
      },
    });
  }

  // --- Number sequences ---
  const sequences: Array<[string, string]> = [
    ['GIRVI', 'GRV'], ['PAYMENT', 'PAY'], ['REDEMPTION', 'RED'], ['CUSTOMER', 'CUS'], ['EXPENSE', 'EXP'],
  ];
  for (const [entity, prefix] of sequences) {
    await prisma.numberSequence.upsert({
      where: { tenantId_entity: { tenantId: tenant.id, entity } },
      update: {},
      create: { tenantId: tenant.id, entity, prefix, yearInKey: true, lastValue: 0 },
    });
  }

  // --- One initial Business Owner user (password must be changed on first login) ---
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Business Owner' } },
  });
  const passwordHash = await argon2.hash('Msdhoni0707@');
  const owner = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'owner@shreeramjwellers.example' } },
    update: {},
    create: {
      tenantId: tenant.id,
      fullName: 'Shree Ram Jwellers Owner',
      email: 'owner@shreeramjwellers.example',
      passwordHash,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    update: {},
    create: { userId: owner.id, roleId: ownerRole.id },
  });
  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId: owner.id, branchId: branch.id } },
    update: {},
    create: { userId: owner.id, branchId: branch.id },
  });

  // eslint-disable-next-line no-console
  console.log('Seed complete. Demo login: owner@shreeramjwellers.example / ChangeMe123! (change immediately)');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
