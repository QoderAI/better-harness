import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { imageSize } = require('../docs/vendor/image-size/index.cjs');
const { imageSizeFromFile } = require('../docs/vendor/image-size/fromFile.cjs');

describe('docs image-size shim', () => {
  it('keeps Docusaurus-compatible image dimension detection', async () => {
    const fixturePath = fileURLToPath(
      new URL('../assets/install/codex-add-marketplace.jpg', import.meta.url),
    );

    const size = await imageSizeFromFile(fixturePath);

    expect(size.type).toBe('jpg');
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });

  it('rejects unsupported parser families instead of loading vulnerable handlers', () => {
    const unsupportedContainer = new TextEncoder().encode('icns\0\0\0\0');

    expect(() => imageSize(unsupportedContainer)).toThrow(/unsupported file type/);
  });

  it('parses SVG dimensions without using binary container parsers', () => {
    const svg = new TextEncoder().encode('<svg width="120" height="80" viewBox="0 0 120 80"></svg>');

    expect(imageSize(svg)).toEqual({ width: 120, height: 80, type: 'svg' });
  });
});
