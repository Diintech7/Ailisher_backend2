const fs = require('fs');
const path = require('path');

const app = require('./server_export.js');

console.log('Keys of app:');
console.log(Object.getOwnPropertyNames(app));
console.log('Keys of app.router:');
if (app.router) {
  console.log(Object.getOwnPropertyNames(app.router));
} else {
  console.log('app.router is undefined');
}

// Let's search for anything router related on app
for (let key in app) {
  if (key.toLowerCase().includes('router')) {
    console.log(`Found router key: ${key}, type: ${typeof app[key]}`);
  }
}

// In Express 5, router stack might be on app.router or app._router, let's inspect
console.log('app.router type:', typeof app.router);
console.log('app._router type:', typeof app._router);

// Let's print the prototype of app
console.log('App prototype keys:');
console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(app)));

process.exit(0);
