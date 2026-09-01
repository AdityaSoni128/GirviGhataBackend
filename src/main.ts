import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import helmet from 'helmet';
import { AppModule } from './app.module';

function validateProductionSecrets(): void {
  const requiredSecrets = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'KYC_ENCRYPTION_KEY',
  ];

  const missingOrWeakSecrets = requiredSecrets.filter((name) => {
    const value = process.env[name];
    return !value || value.length < 32;
  });

  if (missingOrWeakSecrets.length > 0) {
    throw new Error(
      `Missing or weak production secrets: ${missingOrWeakSecrets.join(', ')}. ` +
      'Each secret must be set and at least 32 characters long.',
    );
  }
}

async function bootstrap() {
  validateProductionSecrets();

  // NestExpressApplication (not the plain INestApplication) so we get
  // useStaticAssets for serving uploaded signature images — this is part
  // of @nestjs/platform-express, already a project dependency, so this
  // adds zero new packages.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(helmet());
  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : ['http://localhost:4200'];

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.useStaticAssets(join(process.cwd(), process.env.STORAGE_LOCAL_PATH || 'storage'), {
    prefix: '/files/',
  });

  // Global validation: every DTO is validated; unknown/extra fields rejected.
  // This is the first line of defense per Section 55 — never trust client input.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Girvi Ghata backend listening on port ${port}`);
}

bootstrap();