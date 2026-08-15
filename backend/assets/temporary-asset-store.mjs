import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RETENTION_MS = 60 * 60 * 1000;

const supportedImages = {
  'image/png': { extension: 'png', inspect: inspectPng },
  'image/jpeg': { extension: 'jpg', inspect: inspectJpeg },
};

export class AssetValidationError extends Error {
  constructor(message, { code, status = 400 } = {}) {
    super(message);
    this.name = 'AssetValidationError';
    this.code = code;
    this.status = status;
  }
}

function inspectPng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + segmentLength + 2 > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += segmentLength + 2;
  }
  return undefined;
}

function publicAsset(asset) {
  return {
    id: asset.id,
    mediaType: 'image',
    mimeType: asset.mimeType,
    role: asset.role,
    width: asset.width,
    height: asset.height,
    hash: asset.hash,
    temporaryUrl: `/v1/assets/images/${asset.id}`,
    retentionPolicy: 'temporary',
    expiresAt: asset.expiresAt.toISOString(),
  };
}

export function createTemporaryAssetStore({
  baseDirectory = join(tmpdir(), 'logofacil-assets'),
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  retentionMs = DEFAULT_RETENTION_MS,
  now = () => new Date(),
  createId = randomUUID,
} = {}) {
  const assets = new Map();

  async function cleanupExpired() {
    const currentTime = now().getTime();
    const expired = [...assets.values()].filter(
      (asset) => asset.expiresAt.getTime() <= currentTime,
    );
    await Promise.all(expired.map(async (asset) => {
      assets.delete(asset.id);
      await rm(asset.path, { force: true });
    }));
    return expired.length;
  }

  return {
    maxImageBytes,
    async saveImage({ bytes, mimeType, role = 'product', originalName }) {
      void originalName;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw new AssetValidationError('A imagem está vazia.', {
          code: 'EMPTY_IMAGE',
        });
      }
      if (bytes.length > maxImageBytes) {
        throw new AssetValidationError('A imagem excede o tamanho permitido.', {
          code: 'IMAGE_TOO_LARGE',
          status: 413,
        });
      }
      const imageType = supportedImages[mimeType];
      if (!imageType) {
        throw new AssetValidationError('Formato de imagem não suportado.', {
          code: 'UNSUPPORTED_IMAGE_TYPE',
          status: 415,
        });
      }
      const dimensions = imageType.inspect(bytes);
      if (!dimensions) {
        throw new AssetValidationError('O conteúdo não corresponde a uma imagem válida.', {
          code: 'INVALID_IMAGE_CONTENT',
          status: 415,
        });
      }

      await cleanupExpired();
      await mkdir(baseDirectory, { recursive: true });
      const id = createId();
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) {
        throw new Error('O gerador de IDs retornou um identificador inválido.');
      }
      const safeFilename = `${id}.${imageType.extension}`;
      const filePath = join(baseDirectory, safeFilename);
      await writeFile(filePath, bytes, { flag: 'wx' });
      const createdAt = now();
      const asset = {
        id,
        path: filePath,
        mimeType,
        role,
        ...dimensions,
        hash: createHash('sha256').update(bytes).digest('hex'),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + retentionMs),
      };
      assets.set(id, asset);
      return publicAsset(asset);
    },
    async readImage(id) {
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return undefined;
      await cleanupExpired();
      const asset = assets.get(id);
      if (!asset) return undefined;
      return {
        bytes: await readFile(asset.path),
        mimeType: asset.mimeType,
        metadata: publicAsset(asset),
      };
    },
    cleanupExpired,
    async listStoredFilenames() {
      try {
        return await readdir(baseDirectory);
      } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
    },
  };
}
