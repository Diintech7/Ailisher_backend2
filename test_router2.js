const fs = require('fs');
const path = require('path');

// Read server.js
const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const modifiedServerCode = serverCode.replace(
  /app\.listen\([\s\S]*/, 
  'module.exports = app;'
);
fs.writeFileSync(path.join(__dirname, 'server_export.js'), modifiedServerCode);

const app = require('./server_export.js');
console.log('App type:', typeof app);
console.log('Is app express app?', !!app.handle);

// Force initialize router if it isn't
if (typeof app.lazyrouter === 'function') {
  app.lazyrouter();
}

console.log('App._router after lazyrouter:', !!app._router);
if (app._router) {
  console.log('Stack length:', app._router.stack.length);
  app._router.stack.forEach((layer, idx) => {
    console.log(`${idx}: name = ${layer.name}, regexp = ${layer.regexp}`);
  });
}
process.exit(0);
