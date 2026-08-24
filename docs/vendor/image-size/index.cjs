'use strict';

const decoder = new TextDecoder();
const supportedTypes = ['gif', 'jpg', 'png', 'svg', 'webp'];
const globalOptions = { disabledTypes: [] };

function normalizeInput(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError('Expected Uint8Array input');
}

function toUTF8String(input, start = 0, end = input.length) {
  return decoder.decode(input.subarray(start, Math.min(end, input.length)));
}

function readUInt16BE(input, offset) {
  return new DataView(input.buffer, input.byteOffset + offset, 2).getUint16(0, false);
}

function readUInt16LE(input, offset) {
  return new DataView(input.buffer, input.byteOffset + offset, 2).getUint16(0, true);
}

function readUInt24LE(input, offset) {
  return input[offset] + (input[offset + 1] << 8) + (input[offset + 2] << 16);
}

function readUInt32BE(input, offset) {
  return new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0, false);
}

function hasSignature(input, offset, signature) {
  return toUTF8String(input, offset, offset + signature.length) === signature;
}

function calculatePng(input) {
  const chunkName = toUTF8String(input, 12, 16);
  if (chunkName === 'CgBI') {
    if (toUTF8String(input, 28, 32) !== 'IHDR') {
      throw new TypeError('Invalid PNG');
    }
    return { width: readUInt32BE(input, 32), height: readUInt32BE(input, 36) };
  }
  if (chunkName !== 'IHDR') {
    throw new TypeError('Invalid PNG');
  }
  return { width: readUInt32BE(input, 16), height: readUInt32BE(input, 20) };
}

function calculateGif(input) {
  return { width: readUInt16LE(input, 6), height: readUInt16LE(input, 8) };
}

const sofMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function calculateJpg(input) {
  let offset = 2;
  while (offset < input.length) {
    while (offset < input.length && input[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= input.length) {
      break;
    }

    const marker = input[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    if (offset + 2 > input.length) {
      break;
    }

    const segmentLength = readUInt16BE(input, offset);
    if (segmentLength < 2) {
      throw new TypeError('Invalid JPG, zero-length segment');
    }
    if (offset + segmentLength > input.length) {
      throw new TypeError('Corrupt JPG, exceeded buffer limits');
    }

    if (sofMarkers.has(marker)) {
      if (segmentLength < 7) {
        throw new TypeError('Invalid JPG, malformed size segment');
      }
      return {
        height: readUInt16BE(input, offset + 3),
        width: readUInt16BE(input, offset + 5),
      };
    }

    offset += segmentLength;
  }
  throw new TypeError('Invalid JPG, no size found');
}

const svgRootPattern = /<svg\s([^>"']|"[^"]*"|'[^']*')*>/i;
const svgWidthPattern = /\swidth=(["'])([^%]+?)\1/i;
const svgHeightPattern = /\sheight=(["'])([^%]+?)\1/i;
const svgViewBoxPattern = /\sviewBox=(["'])(.+?)\1/i;
const units = {
  in: 96,
  cm: 96 / 2.54,
  em: 16,
  ex: 8,
  m: (96 / 2.54) * 100,
  mm: 96 / 2.54 / 10,
  pc: 96 / 72 / 12,
  pt: 96 / 72,
  px: 1,
};
const unitsPattern = new RegExp(`^([0-9.]+(?:e\\d+)?)(${Object.keys(units).join('|')})?$`, 'i');

function parseLength(length) {
  const match = unitsPattern.exec(length.trim());
  if (!match) {
    return undefined;
  }
  const unit = match[2] ? match[2].toLowerCase() : 'px';
  return Math.round(Number(match[1]) * (units[unit] ?? 1));
}

function parseViewBox(viewBox) {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || parts.some((part) => Number.isNaN(part))) {
    return undefined;
  }
  return { width: parts[2], height: parts[3] };
}

function calculateSvg(input) {
  const source = toUTF8String(input);
  const root = source.match(svgRootPattern);
  if (!root) {
    throw new TypeError('Invalid SVG');
  }

  const width = root[0].match(svgWidthPattern)?.[2];
  const height = root[0].match(svgHeightPattern)?.[2];
  const viewBox = root[0].match(svgViewBoxPattern)?.[2];
  const parsedWidth = width ? parseLength(width) : undefined;
  const parsedHeight = height ? parseLength(height) : undefined;

  if (parsedWidth && parsedHeight) {
    return { width: parsedWidth, height: parsedHeight };
  }

  const parsedViewBox = viewBox ? parseViewBox(viewBox) : undefined;
  if (parsedViewBox) {
    if (parsedWidth) {
      return {
        width: parsedWidth,
        height: Math.floor(parsedWidth / (parsedViewBox.width / parsedViewBox.height)),
      };
    }
    if (parsedHeight) {
      return {
        width: Math.floor(parsedHeight * (parsedViewBox.width / parsedViewBox.height)),
        height: parsedHeight,
      };
    }
    return parsedViewBox;
  }

  throw new TypeError('Invalid SVG');
}

function calculateWebp(input) {
  const chunk = toUTF8String(input, 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + readUInt24LE(input, 24),
      height: 1 + readUInt24LE(input, 27),
    };
  }
  if (chunk === 'VP8L') {
    if (input[20] !== 0x2f) {
      throw new TypeError('Invalid WebP');
    }
    return {
      width: 1 + (((input[22] & 0x3f) << 8) | input[21]),
      height: 1 + (((input[24] & 0x0f) << 10) | (input[23] << 2) | ((input[22] & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8 ') {
    return {
      width: readUInt16LE(input, 26) & 0x3fff,
      height: readUInt16LE(input, 28) & 0x3fff,
    };
  }
  throw new TypeError('Invalid WebP');
}

const handlers = {
  gif: {
    validate: (input) => /^GIF8[79]a/.test(toUTF8String(input, 0, 6)),
    calculate: calculateGif,
  },
  jpg: {
    validate: (input) => input.length >= 2 && input[0] === 0xff && input[1] === 0xd8,
    calculate: calculateJpg,
  },
  png: {
    validate: (input) => input.length >= 24 && input[0] === 0x89 && hasSignature(input, 1, 'PNG\r\n\x1a\n'),
    calculate: calculatePng,
  },
  svg: {
    validate: (input) => svgRootPattern.test(toUTF8String(input, 0, 1024)),
    calculate: calculateSvg,
  },
  webp: {
    validate: (input) => input.length >= 30 && hasSignature(input, 0, 'RIFF') && hasSignature(input, 8, 'WEBP'),
    calculate: calculateWebp,
  },
};

function detector(input) {
  return supportedTypes.find((type) => handlers[type].validate(input));
}

function imageSize(rawInput) {
  const input = normalizeInput(rawInput);
  const type = detector(input);
  if (typeof type !== 'undefined') {
    if (globalOptions.disabledTypes.includes(type)) {
      throw new TypeError(`disabled file type: ${type}`);
    }
    const size = handlers[type].calculate(input);
    return { ...size, type: size.type ?? type };
  }
  throw new TypeError(`unsupported file type: ${type}`);
}

function disableTypes(typesToDisable) {
  globalOptions.disabledTypes = Array.isArray(typesToDisable) ? typesToDisable : [];
}

exports.default = imageSize;
exports.disableTypes = disableTypes;
exports.imageSize = imageSize;
exports.types = supportedTypes;
