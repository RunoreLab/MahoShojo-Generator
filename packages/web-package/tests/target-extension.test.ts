import { describe, expect, it } from 'vitest';
import { WEB_PACKAGE_TEXT_MEDIA_TYPES } from '@mahoshojo/contracts/web-package';
import { resolveWebPackageTargetExtension } from '../src';

const legacyArenaExtensions = [
  ['application/json', 'json'],
  ['text/html', 'html'],
  ['text/plain', 'txt'],
  ['text/markdown', 'md'],
  ['text/css', 'css'],
  ['text/javascript', 'js'],
  ['application/javascript', 'js'],
  ['image/svg+xml', 'svg'],
] as const;

describe('shared Web Package target download suffix', () => {
  it.each(legacyArenaExtensions)('preserves the existing Arena %s suffix', (mediaType, extension) => {
    expect(resolveWebPackageTargetExtension(mediaType)).toBe(extension);
  });

  it('covers every canonical generated target media type', () => {
    expect(legacyArenaExtensions.map(([mediaType]) => mediaType).sort()).toEqual([...WEB_PACKAGE_TEXT_MEDIA_TYPES].sort());
  });

  it.each(['application/octet-stream', 'image/png', 'text/html;charset=utf-8', 'TEXT/HTML', '', '__proto__', 'constructor'])
    ('keeps unknown media types as plain text: %s', (mediaType) => {
      expect(resolveWebPackageTargetExtension(mediaType)).toBe('txt');
    });
});
