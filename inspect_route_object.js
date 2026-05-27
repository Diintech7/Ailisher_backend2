const express = require('express');
const app = express();
const router = express.Router();

router.get('/hello', (req, res) => {});
app.use('/api/test', router);

const layer = app.router.stack[0];
const subLayer = layer.handle.stack[0];
const route = subLayer.route;
console.log('Route keys:', Object.getOwnPropertyNames(route));
console.log('Route properties:');
for (let key of Object.getOwnPropertyNames(route)) {
  console.log(`${key}:`, route[key]);
}

process.exit(0);
