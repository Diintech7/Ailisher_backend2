const express = require('express');
const app = express();
const router = express.Router();

router.get('/hello', (req, res) => {});
app.use('/api/test', router);

const layer = app.router.stack[0];
console.log('Symbols on layer:', Object.getOwnPropertySymbols(layer));
console.log('All descriptors on layer:');
const desc = Object.getOwnPropertyDescriptors(layer);
for (let key in desc) {
  console.log(`${key}: enumerable = ${desc[key].enumerable}, value type = ${typeof desc[key].value}`);
}

process.exit(0);
