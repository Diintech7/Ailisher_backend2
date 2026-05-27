const fs = require('fs');
const path = require('path');

const serverContent = fs.readFileSync('server.js', 'utf8');

// Step 1: Parse require mapping
const requireRegex = /const\s+(\w+)\s*=\s*require\(\s*['"](\.\/routes\/[^'"]+)['"]\s*\)/g;
const routeFiles = {};
let match;
while ((match = requireRegex.exec(serverContent)) !== null) {
  routeFiles[match[1]] = match[2];
}

// Function to find balanced closing parenthesis
function getBalancedContent(str, startIndex) {
  let depth = 1; // We start after the opening '(' of app.use(
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') {
      depth--;
      if (depth === 0) {
        return str.substring(startIndex, i);
      }
    }
  }
  return null;
}

// Function to split arguments by comma, ignoring commas inside parentheses/quotes
function splitArguments(argString) {
  const args = [];
  let currentArg = '';
  let parenDepth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < argString.length; i++) {
    const char = argString[i];
    if (inQuote) {
      currentArg += char;
      if (char === quoteChar && argString[i - 1] !== '\\') {
        inQuote = false;
      }
    } else {
      if (char === '\'' || char === '"' || char === '`') {
        inQuote = true;
        quoteChar = char;
        currentArg += char;
      } else if (char === '(' || char === '[' || char === '{') {
        parenDepth++;
        currentArg += char;
      } else if (char === ')' || char === ']' || char === '}') {
        parenDepth--;
        currentArg += char;
      } else if (char === ',' && parenDepth === 0) {
        args.push(currentArg.trim());
        currentArg = '';
      } else {
        currentArg += char;
      }
    }
  }
  if (currentArg.trim()) {
    args.push(currentArg.trim());
  }
  return args;
}

const mountedRoutes = [];
let searchIndex = 0;
while (true) {
  const appUseIndex = serverContent.indexOf('app.use(', searchIndex);
  if (appUseIndex === -1) break;
  
  const startIndex = appUseIndex + 'app.use('.length;
  const content = getBalancedContent(serverContent, startIndex);
  if (content !== null) {
    const args = splitArguments(content);
    if (args.length >= 2) {
      const pathArg = args[0];
      const pathQuoteMatch = pathArg.match(/^['"]([^'"]+)['"]$/);
      if (pathQuoteMatch) {
        const mountPath = pathQuoteMatch[1];
        const lastArg = args[args.length - 1];
        mountedRoutes.push({
          path: mountPath,
          routerArg: lastArg
        });
      }
    }
    searchIndex = appUseIndex + content.length;
  } else {
    searchIndex = startIndex;
  }
}

console.log(`Found ${mountedRoutes.length} mounted routes:`);
mountedRoutes.forEach(r => {
  console.log(`Mount: ${r.path} -> RouterArg: ${r.routerArg}`);
});

process.exit(0);
