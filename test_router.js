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
console.log('App._router:', !!app._router);
if (app._router) {
  console.log('Stack length:', app._router.stack.length);
  app._router.stack.forEach((layer, idx) => {
    console.log(`${idx}: route = ${!!layer.route}, name = ${layer.name}, regexp = ${layer.regexp}`);
  });
} else {
  // If _router is not initialized, let's print keys
  console.log('App keys:', Object.keys(app));
}

// Cleanup
try {
  fs.unlinkSync(path.join(__dirname, 'server_export.js'));
} catch (e) {}
process.exit(0);
