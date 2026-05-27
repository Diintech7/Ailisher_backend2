const express = require('express');
const app = express();
const router = express.Router();

router.get('/hello', (req, res) => {});
app.use('/api/test', router);

console.log('App router stack length:', app.router.stack.length);
const layer = app.router.stack[0];
console.log('Layer keys:', Object.getOwnPropertyNames(layer));
console.log('Layer properties:');
for (let key of Object.getOwnPropertyNames(layer)) {
  console.log(`${key}:`, layer[key]);
}
console.log('Layer matchers stringify:', JSON.stringify(layer.matchers));

process.exit(0);
