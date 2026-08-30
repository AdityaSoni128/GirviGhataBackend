import { Body, Controller, Post } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { UploadSignatureDto } from './dto/upload-signature.dto';
import { CurrentContext, RequestContext } from '../../common/decorators/current-context.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Uploads a customer's pledge-acknowledgement signature captured during
   * Girvi creation. Gated behind girvi:create since that's the only flow
   * that currently produces this kind of upload — reusing the existing
   * permission rather than inventing a new one for a single call site.
   */
  @Post('signature')
  @RequirePermissions('girvi:create')
  async uploadSignature(@CurrentContext() ctx: RequestContext, @Body() dto: UploadSignatureDto) {
    const url = await this.uploadsService.saveDataUrl(ctx.tenantId, 'signatures', dto.dataUrl);
    return { url };
  }
}