'use strict';

const watt = require('watt');
const aesjs = require('aes-js');
const crypto = require('crypto');

const defaultKeySize = 32;
const defaultIvSize = 16;
const defaultBlockSize = 128;
const defaultCipherMode = 'cbc';
const defaultPaddingMode = 'pkcs7';

function toBytesArray(buffer) {
  const array = [buffer.length];

  for (let i = 0; i < buffer.length; i++) {
    array[i] = buffer[i];
  }

  return array;
}

const encryptText = watt(function* (plainText, EncryptionKey, next) {
  return yield encryptTextEx(
    plainText,
    toBytesArray(new Buffer(EncryptionKey, 'base64')),
    defaultKeySize,
    defaultIvSize,
    defaultBlockSize,
    defaultCipherMode,
    defaultPaddingMode,
    next
  );
});

function decryptBytes(encryptedBytes, EncryptionKey) {
  return decryptBytesEx(
    encryptedBytes,
    toBytesArray(new Buffer(EncryptionKey, 'base64')),
    defaultKeySize,
    defaultIvSize,
    defaultBlockSize,
    defaultCipherMode,
    defaultPaddingMode
  );
}

const encryptTextWithDerivedKey = watt(function* (
  plainText,
  key,
  keySize,
  ivSize,
  blockSize,
  cipherMode,
  paddingMode,
  derivationIterations,
  next
) {
  // Salt is randomly generated each time, but is preprended to encrypted cipher text
  // so that the same Salt value can be used when decrypting.
  const salt = yield crypto.randomBytes(keySize, next);
  const derivedKey = crypto.pbkdf2Sync(
    key,
    salt,
    derivationIterations,
    keySize,
    'sha1'
  );

  return toBytesArray(salt).concat(
    yield encryptTextEx(
      plainText,
      derivedKey,
      keySize,
      ivSize,
      blockSize,
      cipherMode,
      paddingMode,
      next
    )
  );
});

const encryptTextEx = watt(function* (
  plainText,
  keyBytes,
  keySize,
  ivSize,
  blockSize,
  cipherMode,
  paddingMode,
  next
) {
  if (keyBytes.length !== keySize) {
    throw `key should have a length of ${keySize} bytes`;
  }

  // The initialization vector (must be ivSize bytes)
  const iv = yield crypto.randomBytes(ivSize, next);
  const textBytes = aesjs.utils.utf8.toBytes(plainText);

  // TODO: support other cipher and padding modes
  const aesCbc = new aesjs.ModeOfOperation.cbc(keyBytes, iv);
  const encryptedBytes = aesCbc.encrypt(aesjs.padding.pkcs7.pad(textBytes));

  return toBytesArray(iv).concat(toBytesArray(encryptedBytes));
});

function decryptBytesWithDerivedKey(
  encryptedBytes,
  key,
  keySize,
  ivSize,
  blockSize,
  cipherMode,
  paddingMode,
  derivationIterations
) {
  // Get the complete stream of bytes that represent:
  // [keySize bytes of Salt] + [n bytes of CipherText]
  const cipherTextBytesWithSaltAndIv = Buffer.isBuffer(encryptedBytes)
    ? toBytesArray(encryptedBytes)
    : encryptedBytes;
  // Get the saltbytes by extracting the first keySize bytes from the supplied cipherText bytes.
  const salt = new Buffer(cipherTextBytesWithSaltAndIv.slice(0, keySize));
  // Get the actual cipher text bytes by removing the first keySize bytes from the cipherText string.
  const cipherTextBytes = cipherTextBytesWithSaltAndIv.slice(keySize);
  const derivedKey = crypto.pbkdf2Sync(
    key,
    salt,
    derivationIterations,
    keySize,
    'sha1'
  );

  return decryptBytesEx(
    cipherTextBytes,
    derivedKey,
    keySize,
    ivSize,
    blockSize,
    cipherMode,
    paddingMode
  );
}

function decryptBytesEx(
  encryptedBytes,
  keyBytes,
  keySize,
  ivSize,
  blockSize,
  cipherMode,
  paddingMode
) {
  if (keyBytes.length !== keySize) {
    throw `key should have a length of ${keySize} bytes`;
  }

  const cipherTextBytesWithIv = Buffer.isBuffer(encryptedBytes)
    ? toBytesArray(encryptedBytes)
    : encryptedBytes;
  // Get the IV bytes by extracting the next ivSize bytes from the supplied cipherText bytes.
  const iv = new Buffer(cipherTextBytesWithIv.slice(0, ivSize));
  // Get the actual cipher text bytes by removing the first 64 bytes from the cipherText string.
  const cipherTextBytes = new Buffer(cipherTextBytesWithIv.slice(ivSize));

  // TODO: support other cipher and padding modes

  // The cipher-block chaining mode of operation maintains internal
  // state, so to decrypt a new instance must be instantiated.
  const aesCbc = new aesjs.ModeOfOperation.cbc(new Buffer(keyBytes), iv);
  const decryptedBytes = aesjs.padding.pkcs7.strip(
    aesCbc.decrypt(cipherTextBytes)
  );

  // Convert our bytes back into text
  return aesjs.utils.utf8.fromBytes(decryptedBytes);
}

module.exports = {
  encryptText,
  encryptTextWithDerivedKey,
  encryptTextEx,
  decryptBytes,
  decryptBytesWithDerivedKey,
  decryptBytesEx,
};
