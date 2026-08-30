'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '..', 'config', 'profanity.json');
const targetPath = path.join(__dirname, '..', 'public', 'js', 'profanity-words.generated.js');
const wordList = require(sourcePath);

const output = `// Generated from config/profanity.json. Do not edit by hand.\n` +
  `window.DELULU_PROFANITY = Object.freeze(${JSON.stringify(wordList, null, 2)});\n`;

fs.writeFileSync(targetPath, output);
