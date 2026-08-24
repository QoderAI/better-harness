'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { imageSize } = require('./index.cjs');

const maxInputSize = 512 * 1024;
let concurrency = 100;

function setConcurrency(value) {
  concurrency = value;
}

async function imageSizeFromFile(filePath) {
  const handle = await fs.promises.open(path.resolve(filePath), 'r');
  try {
    const { size } = await handle.stat();
    if (size <= 0) {
      throw new Error('Empty file');
    }

    const inputSize = Math.min(size, maxInputSize);
    const input = new Uint8Array(inputSize);
    await handle.read(input, 0, inputSize, 0);
    return imageSize(input);
  } finally {
    await handle.close();
  }
}

exports.imageSizeFromFile = imageSizeFromFile;
exports.setConcurrency = setConcurrency;
