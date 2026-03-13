import { describe, expect, it } from 'vitest';
import {
  createContentDispositionHeader,
  resolveContentType,
  shouldServeContentAsAttachment
} from '../../src/services/content-type';

describe('resolveContentType', () => {
  it('prefers explicit metadata content type', () => {
    const resolved = resolveContentType(new TextEncoder().encode('hello').buffer, 'file.txt', {
      contentType: 'application/custom'
    });

    expect(resolved).toBe('application/custom');
  });

  it('falls back to filename extension mapping', () => {
    const resolved = resolveContentType(new TextEncoder().encode('hello').buffer, 'payload.JSON', {});
    expect(resolved).toBe('application/json; charset=utf-8');
  });

  it('sniffs known binary signatures', () => {
    const png = resolveContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer, null, {});
    const jpeg = resolveContentType(new Uint8Array([0xff, 0xd8, 0xff, 0x00]).buffer, null, {});
    const gif = resolveContentType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer, null, {});
    const pdf = resolveContentType(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer, null, {});

    expect(png).toBe('image/png');
    expect(jpeg).toBe('image/jpeg');
    expect(gif).toBe('image/gif');
    expect(pdf).toBe('application/pdf');
  });

  it('detects plain text when content bytes are printable', () => {
    const resolved = resolveContentType(new TextEncoder().encode('hello\\nworld').buffer, null, {});
    expect(resolved).toBe('text/plain; charset=utf-8');
  });

  it('returns application/octet-stream for non-text unknown bytes', () => {
    const resolved = resolveContentType(new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer, null, {});
    expect(resolved).toBe('application/octet-stream');
  });

  it('ignores invalid metadata content types', () => {
    const resolved = resolveContentType(new TextEncoder().encode('hello').buffer, 'payload.txt', {
      contentType: 'text/html\r\nx-injected: true'
    });

    expect(resolved).toBe('text/plain; charset=utf-8');
  });
});

describe('gateway content headers', () => {
  it('forces attachment for active browser content types', () => {
    expect(shouldServeContentAsAttachment('text/html; charset=utf-8')).toBe(true);
    expect(shouldServeContentAsAttachment('image/svg+xml')).toBe(true);
    expect(shouldServeContentAsAttachment('application/javascript; charset=utf-8')).toBe(true);
  });

  it('keeps safe content types inline', () => {
    expect(shouldServeContentAsAttachment('text/plain; charset=utf-8')).toBe(false);
    expect(shouldServeContentAsAttachment('image/png')).toBe(false);
    expect(shouldServeContentAsAttachment('video/mp4')).toBe(false);
  });

  it('sanitizes attachment filenames', () => {
    expect(createContentDispositionHeader('unsafe file<>.html')).toBe('attachment; filename=\"unsafe_file_.html\"');
    expect(createContentDispositionHeader(null)).toBe('attachment');
  });
});
