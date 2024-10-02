'use strict';

const watt = require('gigawatts');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const randomBytes = util.promisify(crypto.randomBytes);
const {PassThrough, Transform} = require('stream');

const algorithm = 'aes-256-cbc';
const ivSize = 16;

const testKey = 'p8DxjCZeEhE6n4d/zixk29O/xImjQbRHCDH0RCO1DbI=';

const encryptStream = async function (inputStream, encryptionKey) {
  const keyBytes = Buffer.from(encryptionKey, 'base64');
  const iv = await randomBytes(ivSize);

  const cipher = crypto.createCipheriv(algorithm, keyBytes, iv);
  let ivStream = new PassThrough();
  ivStream.push(iv);

  // Return iv + crypted stream
  return inputStream.pipe(cipher).pipe(ivStream);
};

const decryptStream = function (inputStream, encryptionKey) {
  const keyBytes = Buffer.from(encryptionKey, 'base64');

  let iv, decipher;
  const decryptStreamWithIV = new Transform({
    transform: (chunk, encoding, done) => {
      let error;
      try {
        if (!iv) {
          iv = chunk.slice(0, ivSize);
          // Remove IV from chunk
          chunk = chunk.slice(ivSize);
          decipher = crypto.createDecipheriv(algorithm, keyBytes, iv);
        }
      } catch (err) {
        error = err;
      } finally {
        done(error, decipher.update(chunk));
      }
    },
    flush: (done) => {
      let chunk, error;
      try {
        chunk = decipher.final();
      } catch (err) {
        error = err;
      } finally {
        done(error, chunk);
      }
    },
  });

  // Return decrypted stream
  return inputStream.pipe(decryptStreamWithIV);
};

const encryptText = async function (input, encryptionKey) {
  const keyBytes = Buffer.from(encryptionKey, 'base64');

  const iv = await randomBytes(ivSize);

  const cipher = crypto.createCipheriv(algorithm, keyBytes, iv);
  const encryptedInput = cipher.update(input);

  return Buffer.concat([iv, encryptedInput, cipher.final()]);
};

const decryptText = function (encryptedInput, encryptionKey) {
  const keyBytes = Buffer.from(encryptionKey, 'base64');

  const iv = encryptedInput.slice(0, ivSize);
  encryptedInput = encryptedInput.slice(ivSize);

  const decipher = crypto.createDecipheriv(algorithm, keyBytes, iv);
  let decryptedInput = decipher.update(encryptedInput) + decipher.final();

  return decryptedInput;
};

const testEncryptDecryptStream = watt(function* (
  inputFilePath = './data/data.json',
  cryptedFilePath = './data/data_crypted.enc',
  decryptedFilePath = './data/data_decrypted.json',
  next
) {
  console.log('Start encryption...');

  let inputStream = fs.createReadStream(inputFilePath); // .json
  let outputStream = fs.createWriteStream(cryptedFilePath); // .enc

  const encryptedStream = yield encryptStream(inputStream, testKey, next);
  encryptedStream.pipe(outputStream);
  yield encryptedStream.on('finish', next);

  console.log('Finished encryption !');
  console.log('Start decryption...');

  inputStream = fs.createReadStream(cryptedFilePath); // .enc
  outputStream = fs.createWriteStream(decryptedFilePath); // .json

  const decryptedStream = decryptStream(inputStream, testKey);
  decryptedStream.pipe(outputStream);
  yield decryptedStream.on('finish', next);

  console.log('Finished decryption !');
});

const testEncryptDecryptData = watt(function* (input = 'Hello world !', next) {
  console.log(`Start encryption of input: ${input}`);

  const encryptedInput = yield encryptText(input, testKey, next);

  console.log(`Finished encryption ! Result: ${encryptedInput.toString()}`);
  console.log('Start decryption...');

  const decryptedInput = decryptText(encryptedInput, testKey);

  console.log(`Finished decryption ! Result: ${decryptedInput.toString()}`);
});

module.exports = {
  // Stream
  encryptStream,
  decryptStream,
  // Buffer
  encryptText,
  decryptText,
  // Test functions
  testEncryptDecryptStream,
  testEncryptDecryptData,
};
