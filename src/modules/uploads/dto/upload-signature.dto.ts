import { IsString, Matches } from 'class-validator';

export class UploadSignatureDto {
  /**
   * Base64 data URL as produced by canvas.toDataURL('image/png'), e.g.
   * "data:image/png;base64,iVBORw0KG...". Validated against this exact
   * shape server-side — never trust the client to send a well-formed
   * image just because the frontend's signature pad only ever produces
   * this format.
   */
  @IsString()
  @Matches(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, {
    message: 'dataUrl must be a base64-encoded PNG or JPEG data URL',
  })
  dataUrl!: string;
}