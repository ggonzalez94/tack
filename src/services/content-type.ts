const extensionToMimeType: Record<string, string> = {
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  mjs: 'application/javascript; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4'
};

const MIME_TOKEN_REGEX = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SAFE_INLINE_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'text/plain'
]);

function hasOnlyTextCharacters(content: Uint8Array): boolean {
  for (const byte of content) {
    if (byte === 9 || byte === 10 || byte === 13) {
      continue;
    }

    if (byte < 32 || byte > 126) {
      return false;
    }
  }

  return true;
}

function sniffMimeType(content: Uint8Array): string {
  if (content.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47];
    if (png.every((value, index) => content[index] === value)) {
      return 'image/png';
    }
  }

  if (content.length >= 3) {
    const jpeg = [0xff, 0xd8, 0xff];
    if (jpeg.every((value, index) => content[index] === value)) {
      return 'image/jpeg';
    }
  }

  if (content.length >= 4) {
    const gif87a = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
    const gif89a = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
    if (
      (content.length >= 6 && gif87a.every((value, index) => content[index] === value)) ||
      (content.length >= 6 && gif89a.every((value, index) => content[index] === value))
    ) {
      return 'image/gif';
    }
  }

  if (content.length >= 4) {
    const pdf = [0x25, 0x50, 0x44, 0x46];
    if (pdf.every((value, index) => content[index] === value)) {
      return 'application/pdf';
    }
  }

  const sample = content.subarray(0, Math.min(content.length, 1024));
  if (sample.length > 0 && hasOnlyTextCharacters(sample)) {
    return 'text/plain; charset=utf-8';
  }

  return 'application/octet-stream';
}

function mimeTypeFromFilename(filename: string | null): string | null {
  if (!filename) {
    return null;
  }

  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return null;
  }

  const extension = filename.slice(dotIndex + 1).toLowerCase();
  return extensionToMimeType[extension] ?? null;
}

function normalizeDeclaredMimeType(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\r\n]/.test(trimmed) || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return null;
  }

  const [rawEssence, ...rawParameters] = trimmed.split(';');
  const [rawType, rawSubtype] = rawEssence.trim().toLowerCase().split('/', 2);
  if (!rawType || !rawSubtype || !MIME_TOKEN_REGEX.test(rawType) || !MIME_TOKEN_REGEX.test(rawSubtype)) {
    return null;
  }

  const normalizedParameters = rawParameters
    .map((parameter) => parameter.trim())
    .filter((parameter) => parameter.length > 0);

  if (normalizedParameters.length === 0) {
    return `${rawType}/${rawSubtype}`;
  }

  return `${rawType}/${rawSubtype}; ${normalizedParameters.join('; ')}`;
}

function mimeEssence(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? 'application/octet-stream';
}

export function resolveContentType(content: ArrayBuffer, filename: string | null, meta: Record<string, string>): string {
  const fromMeta = meta.contentType ?? meta['content-type'] ?? meta.mimeType;
  if (fromMeta) {
    const normalized = normalizeDeclaredMimeType(fromMeta);
    if (normalized) {
      return normalized;
    }
  }

  const fromFilename = mimeTypeFromFilename(filename);
  if (fromFilename) {
    return fromFilename;
  }

  return sniffMimeType(new Uint8Array(content));
}

export function shouldServeContentAsAttachment(contentType: string): boolean {
  const essence = mimeEssence(contentType);
  if (SAFE_INLINE_MIME_TYPES.has(essence)) {
    return false;
  }

  if (essence.startsWith('audio/') || essence.startsWith('video/')) {
    return false;
  }

  if (essence.startsWith('image/') && essence !== 'image/svg+xml') {
    return false;
  }

  return true;
}

export function createContentDispositionHeader(filename: string | null): string {
  if (!filename) {
    return 'attachment';
  }

  const sanitizedFilename = filename
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `attachment; filename=\"${sanitizedFilename || 'download'}\"`;
}
