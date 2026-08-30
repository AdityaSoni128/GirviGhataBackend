-- CreateEnum
CREATE TYPE "GirviStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_PAID', 'OVERDUE', 'RENEWED', 'CLOSED', 'REDEEMED', 'AUCTION_ELIGIBLE', 'AUCTIONED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "gstin" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxBranches" INTEGER,
    "maxUsers" INTEGER,
    "featureFlags" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branches" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "user_branches_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "login_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "guardianName" TEXT,
    "mobile" TEXT NOT NULL,
    "altMobile" TEXT,
    "dob" TIMESTAMP(3),
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_kyc" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "aadhaarEncrypted" TEXT,
    "aadhaarLast4" TEXT,
    "panNumber" TEXT,
    "otherIdType" TEXT,
    "otherIdNumber" TEXT,
    "signatureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "metals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fineFactor" DECIMAL(6,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "purities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metal_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "metalId" TEXT NOT NULL,
    "ratePerGram" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metal_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metal_rate_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metalId" TEXT NOT NULL,
    "purityCode" TEXT,
    "oldRate" DECIMAL(12,2),
    "newRate" DECIMAL(12,2) NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metal_rate_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_rule_sets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metalCode" TEXT NOT NULL,
    "eligibilityPercent" DECIMAL(6,3) NOT NULL,
    "marginType" TEXT NOT NULL,
    "marginValue" DECIMAL(12,2) NOT NULL,
    "interestMethod" TEXT NOT NULL,
    "interestPercent" DECIMAL(6,3) NOT NULL,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "loanTermDays" INTEGER,
    "roundingRule" TEXT NOT NULL,
    "minLoanAmount" DECIMAL(14,2),
    "maxLoanAmount" DECIMAL(14,2),
    "paymentAllocationOrder" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "girvi_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "girviNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "GirviStatus" NOT NULL DEFAULT 'DRAFT',
    "pledgeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "girvi_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pledged_items" (
    "id" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "description" TEXT,
    "metalCode" TEXT NOT NULL,
    "purityCode" TEXT NOT NULL,
    "grossWeight" DECIMAL(10,3) NOT NULL,
    "stoneWeight" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "netWeight" DECIMAL(10,3) NOT NULL,
    "condition" TEXT,
    "conditionNotes" TEXT,
    "hallmark" TEXT,
    "huid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "pledged_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_photos" (
    "id" TEXT NOT NULL,
    "pledgedItemId" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "girvi_valuation_snapshots" (
    "id" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "metalRateId" TEXT NOT NULL,
    "totalFineWeight" DECIMAL(10,4) NOT NULL,
    "totalMetalValue" DECIMAL(14,2) NOT NULL,
    "eligibilityPercent" DECIMAL(6,3) NOT NULL,
    "eligibleValue" DECIMAL(14,2) NOT NULL,
    "marginApplied" DECIMAL(14,2) NOT NULL,
    "maxLoanAmount" DECIMAL(14,2) NOT NULL,
    "actualLoanAmount" DECIMAL(14,2) NOT NULL,
    "calculationBreakdown" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "girvi_valuation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_accruals" (
    "id" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "principalBase" DECIMAL(14,2) NOT NULL,
    "interestAmount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "receivedBy" TEXT NOT NULL,
    "notes" TEXT,
    "isReversed" BOOLEAN NOT NULL DEFAULT false,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redemptions" (
    "id" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "redemptionNumber" TEXT NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL,
    "releasedBy" TEXT NOT NULL,
    "customerAckUrl" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accountType" TEXT NOT NULL,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentMode" TEXT NOT NULL,
    "description" TEXT,
    "receiptUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_closings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "closingDate" TIMESTAMP(3) NOT NULL,
    "expectedCash" DECIMAL(14,2) NOT NULL,
    "actualCash" DECIMAL(14,2) NOT NULL,
    "discrepancy" DECIMAL(14,2) NOT NULL,
    "discrepancyReason" TEXT,
    "closedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,

    CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packets" (
    "id" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "packetNumber" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "storageLocationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_cases" (
    "id" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "noticeSentAt" TIMESTAMP(3),
    "eligibleAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_settlements" (
    "id" TEXT NOT NULL,
    "auctionCaseId" TEXT NOT NULL,
    "outstandingPrincipal" DECIMAL(14,2) NOT NULL,
    "outstandingInterest" DECIMAL(14,2) NOT NULL,
    "otherCharges" DECIMAL(14,2) NOT NULL,
    "reservePrice" DECIMAL(14,2) NOT NULL,
    "finalSaleAmount" DECIMAL(14,2),
    "buyerName" TEXT,
    "soldAt" TIMESTAMP(3),
    "profitOrLoss" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "yearInKey" BOOLEAN NOT NULL DEFAULT true,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "channel" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_tenantId_key" ON "tenant_subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_code_key" ON "branches"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_key" ON "roles"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "customers_tenantId_mobile_idx" ON "customers"("tenantId", "mobile");

-- CreateIndex
CREATE INDEX "customers_tenantId_fullName_idx" ON "customers"("tenantId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_customerCode_key" ON "customers"("tenantId", "customerCode");

-- CreateIndex
CREATE UNIQUE INDEX "customer_kyc_customerId_key" ON "customer_kyc"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "metals_tenantId_code_key" ON "metals"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purities_tenantId_metalId_code_key" ON "purities"("tenantId", "metalId", "code");

-- CreateIndex
CREATE INDEX "metal_rates_tenantId_metalId_effectiveFrom_idx" ON "metal_rates"("tenantId", "metalId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "business_rule_sets_tenantId_metalCode_version_key" ON "business_rule_sets"("tenantId", "metalCode", "version");

-- CreateIndex
CREATE INDEX "girvi_transactions_tenantId_status_idx" ON "girvi_transactions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "girvi_transactions_tenantId_customerId_idx" ON "girvi_transactions"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "girvi_transactions_tenantId_girviNumber_key" ON "girvi_transactions"("tenantId", "girviNumber");

-- CreateIndex
CREATE UNIQUE INDEX "girvi_valuation_snapshots_girviTransactionId_key" ON "girvi_valuation_snapshots"("girviTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_receiptNumber_key" ON "payments"("tenantId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "redemptions_girviTransactionId_key" ON "redemptions"("girviTransactionId");

-- CreateIndex
CREATE INDEX "cash_ledger_entries_tenantId_branchId_createdAt_idx" ON "cash_ledger_entries"("tenantId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_closings_tenantId_branchId_closingDate_key" ON "daily_closings"("tenantId", "branchId", "closingDate");

-- CreateIndex
CREATE UNIQUE INDEX "storage_locations_tenantId_branchId_type_code_key" ON "storage_locations"("tenantId", "branchId", "type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "packets_girviTransactionId_key" ON "packets"("girviTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "packets_qrCode_key" ON "packets"("qrCode");

-- CreateIndex
CREATE UNIQUE INDEX "auction_cases_girviTransactionId_key" ON "auction_cases"("girviTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_settlements_auctionCaseId_key" ON "auction_settlements"("auctionCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_tenantId_entity_key" ON "number_sequences"("tenantId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_tenantId_event_channel_key" ON "notification_templates"("tenantId", "event", "channel");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_kyc" ADD CONSTRAINT "customer_kyc_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metals" ADD CONSTRAINT "metals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purities" ADD CONSTRAINT "purities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purities" ADD CONSTRAINT "purities_metalId_fkey" FOREIGN KEY ("metalId") REFERENCES "metals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metal_rates" ADD CONSTRAINT "metal_rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metal_rates" ADD CONSTRAINT "metal_rates_metalId_fkey" FOREIGN KEY ("metalId") REFERENCES "metals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rule_sets" ADD CONSTRAINT "business_rule_sets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "girvi_transactions" ADD CONSTRAINT "girvi_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "girvi_transactions" ADD CONSTRAINT "girvi_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pledged_items" ADD CONSTRAINT "pledged_items_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_pledgedItemId_fkey" FOREIGN KEY ("pledgedItemId") REFERENCES "pledged_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "girvi_valuation_snapshots" ADD CONSTRAINT "girvi_valuation_snapshots_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_accruals" ADD CONSTRAINT "interest_accruals_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ledger_entries" ADD CONSTRAINT "cash_ledger_entries_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packets" ADD CONSTRAINT "packets_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packets" ADD CONSTRAINT "packets_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_cases" ADD CONSTRAINT "auction_cases_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_settlements" ADD CONSTRAINT "auction_settlements_auctionCaseId_fkey" FOREIGN KEY ("auctionCaseId") REFERENCES "auction_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
