'use strict';

const watt = require('watt');
const fs = require('fs');
const crypto = require('crypto');
const {Readable} = require('stream');
const {RewindableStream, concatStreams} = require('./stream-utils.js');

const algorithm = 'aes-256-cbc';
const ivSize = 16;

const testKey = 'p8DxjCZeEhE6n4d/zixk29O/xImjQbRHCDH0RCO1DbI=';

const encrypt = watt(function* (inputStream, encryptionKey, next) {
  // The IV is usually passed along with the ciphertext.
  const iv = yield crypto.randomBytes(ivSize, next);

  const keyBytes = Buffer.from(encryptionKey, 'base64');

  // Create cipher
  const cipher = crypto.createCipheriv(algorithm, keyBytes, iv, {});
  let ivStream = Readable.from(iv);

  // Return iv + crypted stream
  return yield concatStreams([ivStream, inputStream.pipe(cipher)], next);
});

const decrypt = watt(function* (inputStream, encryptionKey, next) {
  const keyBytes = Buffer.from(encryptionKey, 'base64');

  // transform readableStream into RewindableStream
  let rewindableStream = inputStream.pipe(new RewindableStream());
  yield inputStream.once('end', next);

  // Get first chunk of stream
  let firstChunk = rewindableStream.getChunk(0);
  // Get iv from first chunk
  let iv = firstChunk.slice(0, ivSize);
  // Remove iv from data to decrypt
  rewindableStream.setChunk(0, firstChunk.slice(ivSize));

  // Reset stream
  inputStream = rewindableStream.rewind();

  // Create decipher
  const decipher = crypto.createDecipheriv(algorithm, keyBytes, iv);
  // Return decrypted stream
  return inputStream.pipe(decipher);
});

const testEncrypt = watt(function* (inputFile, outputFile, next) {
  const inputStream = fs.createReadStream(inputFile); // .json
  const outputStream = fs.createWriteStream(outputFile); // .enc

  const encryptedStream = yield encrypt(inputStream, testKey, next);
  encryptedStream.pipe(outputStream);
  yield encryptedStream.once('end', next);
  inputStream.close();
  outputStream.close();
});

const testDecrypt = watt(function* (inputFile, outputFile, next) {
  const inputStream = fs.createReadStream(inputFile); // .enc
  const outputStream = fs.createWriteStream(outputFile); // .json

  const decryptedStream = yield decrypt(inputStream, testKey, next);
  decryptedStream.pipe(outputStream);
  yield decryptedStream.once('end', next);
  inputStream.close();
  outputStream.close();
});

module.exports = {
  encrypt,
  decrypt,
  testEncrypt,
  testDecrypt,
};
