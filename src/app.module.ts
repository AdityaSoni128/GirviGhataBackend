import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { CryptoModule } from './common/crypto/crypto.module';
import { NumberingModule } from './common/numbering/numbering.module';

import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { CustomersModule } from './modules/customers/customers.module';
import { RatesModule } from './modules/rates/rates.module';
import { RulesModule } from './modules/rules/rules.module';
import { GirviModule } from './modules/girvi/girvi.module';
import { CalculationEngineModule } from './modules/calculation-engine/calculation-engine.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuctionModule } from './modules/auction/auction.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]), // global default; tighten per-route in Phase 3
    PrismaModule,
    CryptoModule,
    NumberingModule,

    // Foundation modules — real implementation lands per the phase noted
    // in each module file. Registered now so routing/DI wiring is stable
    // and later phases only add providers/controllers, not restructure.
    AuthModule,
    TenantsModule,
    CustomersModule,
    RatesModule,
    RulesModule,
    CalculationEngineModule, // fully implemented in Phase 2 — see calculation-engine.service.ts
    GirviModule,
    PaymentsModule,
    InventoryModule,
    ReportsModule,
    AuditModule,
    AuctionModule,
    SchedulerModule,
    UploadsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, // must run before PermissionsGuard: populates request.context
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}