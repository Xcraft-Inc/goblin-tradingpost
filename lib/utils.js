const watt = require('gigawatts');

function readEncryptionKey(keyPath) {
  const fs = require('fs');
  if (fs.existsSync(keyPath)) {
    const content = fs.readFileSync(keyPath, 'utf8');

    if (!content) {
      throw new Error('Encryption key file is empty !');
    }

    const securityInfo = JSON.parse(content);
    if (!securityInfo || !securityInfo.EncryptionKey) {
      throw new Error(
        'Encryption key file is corrupted or no encryption key is provided !'
      );
    }

    return securityInfo.EncryptionKey;
  } else {
    throw new Error(
      `Encryption key file doesn't exist ! Wrong keyPath "${keyPath}" ?`
    );
  }
}

function publicMethods(obj) {
  // Keep only functions of goblin exposed
  return Object.getOwnPropertyNames(obj).filter(
    (property) => typeof obj[property] === 'function'
  );
}

function transformQuestName(name) {
  let newName = '';
  for (let i = 0; i < name.length; i++) {
    if (name[i] === name[i].toUpperCase()) {
      newName += `-${name[i].toLowerCase()}`;
    } else {
      newName += name[i];
    }
  }
  return newName;
}

const parseJsonFromStream = watt(function* (stream, next) {
  const chunks = [];
  stream.on('data', (chunk) => {
    chunks.push(chunk);
  });
  yield stream.on('end', next);
  return JSON.parse(Buffer.concat(chunks).toString());
});

module.exports = {
  readEncryptionKey,
  publicMethods,
  transformQuestName,
  parseJsonFromStream,
};
