// Image checks for logos: the format is decided by magic bytes only (a Content-Type header or file name
// is never trusted). Only PNG, JPEG and WebP are accepted; SVG and everything else is rejected.

/** Largest logo accepted from a provider. */
export const FETCH_MAX_BYTES = 256 * 1024;

/** Largest manually uploaded logo (1 MiB). */
export const UPLOAD_MAX_BYTES = 1024 * 1024;

export type ImageFormat = { extension: "png" | "jpg" | "webp"; contentType: "image/png" | "image/jpeg" | "image/webp" };

/** A verified image: its bytes and the format the magic bytes name. */
export type LogoImage = ImageFormat & { bytes: Uint8Array };

/** Content types a stored logo may carry. */
export const LOGO_CONTENT_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The image format of `bytes` by magic bytes, or `null` when it is not PNG, JPEG or WebP. */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG)) return { extension: "png", contentType: "image/png" };
  if (startsWith(bytes, JPEG)) return { extension: "jpg", contentType: "image/jpeg" };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return { extension: "webp", contentType: "image/webp" };
  return null;
}
