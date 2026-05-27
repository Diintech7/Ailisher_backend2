const fs = require('fs');
const path = require('path');

const serverContent = fs.readFileSync('server.js', 'utf8');

// Step 1: Find all require lines for routes
// Format: const authRoutes = require('./routes/auth');
const requireRegex = /const\s+(\w+)\s*=\s*require\(\s*['"](\.\/routes\/[^'"]+)['"]\s*\)/g;
const routeFiles = {};
let match;
while ((match = requireRegex.exec(serverContent)) !== null) {
  routeFiles[match[1]] = match[2];
}

// Add special ones like require("./routes/userAnalytics")
// E.g. require('./routes/reel')
const directRequireRegex = /require\(\s*['"](\.\/routes\/[^'"]+)['"]\s*\)/g;
while ((match = directRequireRegex.exec(serverContent)) !== null) {
  // We will map it if needed
}

console.log('Detected route files in server.js:', Object.keys(routeFiles).length);

// Step 2: Parse all app.use calls
// Let's use a regex to find all app.use blocks and extract the path and the route variable/require
const appUseRegex = /app\.use\(\s*(?:['"]([^'"]+)['"]\s*,[\s\S]*?(\w+|require\([^)]+\))\s*)\)/g;
const mountedRoutes = [];

// Let's manually parse or use a robust regex to get app.use lines
const lines = serverContent.split('\n');
let currentAppUseBlock = '';
let inAppUse = false;

lines.forEach(line => {
  if (line.includes('app.use(')) {
    inAppUse = true;
    currentAppUseBlock = line;
  } else if (inAppUse) {
    currentAppUseBlock += '\n' + line;
  }
  
  if (inAppUse && (line.includes(')') || line.trim() === '')) {
    // Check if parentheses are balanced in block
    const openCount = (currentAppUseBlock.match(/\(/g) || []).length;
    const closeCount = (currentAppUseBlock.match(/\)/g) || []).length;
    if (closeCount >= openCount) {
      inAppUse = false;
      // Parse currentAppUseBlock
      // Extract path string
      const pathMatch = currentAppUseBlock.match(/app\.use\(\s*['"]([^'"]+)['"]/);
      if (pathMatch) {
        const mountPath = pathMatch[1];
        // Find the router identifier or direct require
        // Usually the last argument before the closing parenthesis
        const cleanBlock = currentAppUseBlock.trim().replace(/\s+/g, ' ');
        // Find last argument
        // If it ends with userProfileRoutes, ) -> get userProfileRoutes
        // Let's find matches of route variables or requires
        let routerName = '';
        const requireInUseMatch = currentAppUseBlock.match(/require\(\s*['"](\.\/routes\/[^'"]+)['"]\s*\)/);
        if (requireInUseMatch) {
          routerName = requireInUseMatch[1];
        } else {
          // Find identifier at the end before )
          const idMatch = currentAppUseBlock.match(/,\s*(\w+)\s*\)$/);
          if (idMatch) {
            routerName = idMatch[1];
          } else {
            // Check if there is an identifier before trailing comma/spaces/parenthesis
            const idMatch2 = currentAppUseBlock.match(/,\s*(\w+)\s*,\s*\)$/) || currentAppUseBlock.match(/,\s*(\w+)\s*\n*\s*\)$/);
            if (idMatch2) {
              routerName = idMatch2[1];
            }
          }
        }
        
        if (routerName) {
          mountedRoutes.push({
            path: mountPath,
            router: routerName,
            raw: currentAppUseBlock
          });
        }
      }
      currentAppUseBlock = '';
    }
  }
});

console.log(`Mounted routes count: ${mountedRoutes.length}`);
mountedRoutes.forEach(r => {
  console.log(`Mount Path: ${r.path} -> Router: ${r.router}`);
});

process.exit(0);
