import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Minimal local-disk file storage. No file-storage service existed
 * anywhere in the project yet — this is the smallest correct
 * implementation, deliberately not tied to any specific cloud provider.
 * If/when a real object-storage integration (S3, Cloudinary, etc.) is
 * added, only this service's internals need to change — every caller
 * (currently just the signature upload endpoint) is unaffected because
 * it only depends on `save()`'s return shape.
 */
@Injectable()
export class UploadsService {
  private readonly storageRoot = process.env.STORAGE_LOCAL_PATH || './storage';

  /**
   * Decodes a base64 data URL and writes it under
   * `<storageRoot>/<tenantId>/<subfolder>/<uuid>.<ext>`, namespaced by
   * tenant to keep file storage tenant-isolated the same way every other
   * resource in this system is. Returns the public path the file is
   * served at (see main.ts's useStaticAssets prefix) — never the absolute
   * disk path.
   */
  async saveDataUrl(tenantId: string, subfolder: string, dataUrl: string): Promise<string> {
    const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URL format');
    }
    const [, ext, base64Payload] = match;
    const buffer = Buffer.from(base64Payload, 'base64');

    const dir = join(this.storageRoot, tenantId, subfolder);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
    await writeFile(join(dir, filename), buffer);

    return `/files/${tenantId}/${subfolder}/${filename}`;
  }
}