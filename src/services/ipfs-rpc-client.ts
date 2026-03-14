import { GatewayTimeoutError, PayloadTooLargeError, UpstreamServiceError } from '../lib/errors';
import { logger } from './logger';

interface IpfsAddResponse {
  Name: string;
  Hash: string;
  Size: string;
}

export interface IpfsClient {
  pinAdd(cid: string): Promise<void>;
  pinRm(cid: string): Promise<void>;
  addContent(content: Blob, filename: string): Promise<string>;
  cat(cid: string, options?: { maxBytes?: number }): Promise<ArrayBuffer>;
}

export interface IpfsRpcClientOptions {
  timeoutMs?: number;
  contentTimeoutMs?: number;
}

const DEFAULT_IPFS_TIMEOUT_MS = 30000;
const DEFAULT_IPFS_CONTENT_TIMEOUT_MS = 60000;

export class IpfsRpcClient implements IpfsClient {
  private readonly timeoutMs: number;
  private readonly contentTimeoutMs: number;

  constructor(
    private readonly apiBaseUrl: string,
    options?: IpfsRpcClientOptions
  ) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_IPFS_TIMEOUT_MS;
    this.contentTimeoutMs = options?.contentTimeoutMs ?? DEFAULT_IPFS_CONTENT_TIMEOUT_MS;
  }

  async pinAdd(cid: string): Promise<void> {
    await this.postJson('/api/v0/pin/add', { arg: cid }, this.timeoutMs, 'pin/add');
  }

  async pinRm(cid: string): Promise<void> {
    await this.postJson('/api/v0/pin/rm', { arg: cid }, this.timeoutMs, 'pin/rm');
  }

  async pinLs(cid?: string): Promise<Record<string, { Type: string }>> {
    const payload = await this.postJson('/api/v0/pin/ls', cid ? { arg: cid } : undefined, this.timeoutMs, 'pin/ls');
    return (payload.Keys ?? {}) as Record<string, { Type: string }>;
  }

  async id(): Promise<Record<string, unknown>> {
    return this.postJson('/api/v0/id', undefined, this.timeoutMs, 'id');
  }

  async addContent(content: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.append('file', content, filename);

    const response = await this.fetchWithTimeout(new URL('/api/v0/add', this.apiBaseUrl), {
      method: 'POST',
      body: form
    }, this.timeoutMs, 'add');

    if (!response.ok) {
      await this.logUpstreamError(response, 'add');
      throw new UpstreamServiceError('IPFS request failed');
    }

    const data = (await response.json()) as IpfsAddResponse;
    return data.Hash;
  }

  async cat(cid: string, options?: { maxBytes?: number }): Promise<ArrayBuffer> {
    const url = new URL('/api/v0/cat', this.apiBaseUrl);
    url.searchParams.set('arg', cid);

    const response = await this.fetchWithTimeout(url, { method: 'POST' }, this.contentTimeoutMs, 'cat');
    if (!response.ok) {
      await this.logUpstreamError(response, 'cat');
      throw new UpstreamServiceError('IPFS request failed');
    }

    return this.readContentWithLimit(response, options?.maxBytes);
  }

  private async postJson(
    path: string,
    query: Record<string, string> | undefined,
    timeoutMs: number,
    operation: string
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, this.apiBaseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await this.fetchWithTimeout(url, { method: 'POST' }, timeoutMs, operation);
    if (!response.ok) {
      await this.logUpstreamError(response, operation);
      throw new UpstreamServiceError('IPFS request failed');
    }

    return (await response.json()) as Record<string, unknown>;
  }

  private async fetchWithTimeout(
    url: URL,
    init: RequestInit,
    timeoutMs: number,
    operation: string
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new GatewayTimeoutError(`IPFS request timed out after ${timeoutMs}ms`);
      }

      logger.error({
        operation,
        url: url.toString(),
        err: error
      }, 'IPFS request failed');
      throw new UpstreamServiceError('IPFS request failed');
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async logUpstreamError(response: Response, operation: string): Promise<void> {
    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch {
      responseBody = '<failed to read response body>';
    }

    logger.error({
      operation,
      status: response.status,
      statusText: response.statusText,
      body: responseBody
    }, 'IPFS upstream response was not successful');
  }

  private async readContentWithLimit(response: Response, maxBytes?: number): Promise<ArrayBuffer> {
    if (maxBytes !== undefined) {
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const declaredLength = Number.parseInt(contentLength, 10);
        if (Number.isInteger(declaredLength) && declaredLength > maxBytes) {
          await response.body?.cancel();
          throw new PayloadTooLargeError(`Gateway content exceeds ${maxBytes} bytes`);
        }
      }
    }

    if (!response.body) {
      const buffer = await response.arrayBuffer();
      if (maxBytes !== undefined && buffer.byteLength > maxBytes) {
        throw new PayloadTooLargeError(`Gateway content exceeds ${maxBytes} bytes`);
      }

      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        totalBytes += value.byteLength;
        if (maxBytes !== undefined && totalBytes > maxBytes) {
          await reader.cancel('gateway content too large');
          throw new PayloadTooLargeError(`Gateway content exceeds ${maxBytes} bytes`);
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return buffer.buffer;
  }
}
