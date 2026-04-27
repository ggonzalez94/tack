import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

export interface PrivateObjectStorage {
  put(input: {
    key: string;
    content: ArrayBuffer;
    contentType: string;
  }): Promise<{ sizeBytes: number; sha256: string }>;
  get(key: string): Promise<{ content: ArrayBuffer; sizeBytes: number }>;
  delete(key: string): Promise<void>;
}

function bufferFromArrayBuffer(content: ArrayBuffer): Buffer {
  return Buffer.from(content);
}

export class LocalPrivateObjectStorage implements PrivateObjectStorage {
  constructor(private readonly rootDir: string) {}

  async put(input: { key: string; content: ArrayBuffer; contentType: string }): Promise<{ sizeBytes: number; sha256: string }> {
    const path = this.resolveKey(input.key);
    const content = bufferFromArrayBuffer(input.content);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return {
      sizeBytes: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex')
    };
  }

  async get(key: string): Promise<{ content: ArrayBuffer; sizeBytes: number }> {
    const content = await readFile(this.resolveKey(key));
    return {
      content: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
      sizeBytes: content.byteLength
    };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  private resolveKey(key: string): string {
    if (isAbsolute(key) || key.split('/').includes('..')) {
      throw new Error('private object storage key is invalid');
    }

    const normalized = normalize(key);
    if (normalized.startsWith('..')) {
      throw new Error('private object storage key is invalid');
    }

    return join(this.rootDir, normalized);
  }
}
