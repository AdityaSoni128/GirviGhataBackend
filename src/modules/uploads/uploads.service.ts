import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

@Injectable()
export class UploadsService {
  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'Missing Cloudinary configuration: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are required.',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  /**
   * Decodes a PNG/JPEG data URL and uploads it to Cloudinary.
   *
   * Files are namespaced by tenant and subfolder:
   * girvi-ghata/<tenantId>/<subfolder>/
   *
   * Returns the permanent HTTPS Cloudinary URL.
   */
  async saveDataUrl(
    tenantId: string,
    subfolder: string,
    dataUrl: string,
  ): Promise<string> {
    const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);

    if (!match) {
      throw new Error('Invalid data URL format');
    }

    const [, ext, base64Payload] = match;
    const buffer = Buffer.from(base64Payload, 'base64');

    const filename = randomUUID();

    const folder = `girvi-ghata/${tenantId}/${subfolder}`;

    const result = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            public_id: filename,
            resource_type: 'image',
            format: ext === 'jpeg' ? 'jpg' : ext,
          },
          (error, result) => {
            if (error) {
              reject(error);
              return;
            }

            if (!result) {
              reject(new Error('Cloudinary upload returned no result'));
              return;
            }

            resolve(result);
          },
        );

        uploadStream.end(buffer);
      },
    );

    return result.secure_url;
  }
}