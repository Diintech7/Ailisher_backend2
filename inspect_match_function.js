const express = require('express');
const app = express();
const router = express.Router();

router.get('/hello', (req, res) => {});
app.use('/api/test', router);

const layer = app.router.stack[0];
const matchFunc = layer.matchers[0];
console.log('matchFunc properties:', Object.getOwnPropertyNames(matchFunc));
console.log('matchFunc toString:');
console.log(matchFunc.toString());

process.exit(0);
