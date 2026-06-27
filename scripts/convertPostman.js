const fs = require('fs');
const path = require('path');

const collectionsDir = path.join(__dirname, '../../postman collection/app_developer_collections');
const outputFile = path.join(__dirname, '../swagger.json');

console.log('🔄 Starting Postman to OpenAPI 3.0 compilation...');

if (!fs.existsSync(collectionsDir)) {
  console.error(`❌ Error: Collections directory not found: ${collectionsDir}`);
  process.exit(1);
}

// Initial Swagger skeleton
const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Ailisher Mobile App API Documentation",
    description: "Unified interactive API documentation compiled automatically from the Postman app developer collections.",
    version: "1.0.0"
  },
  servers: [
    {
      "url": "http://localhost:4000",
      "description": "Local Development Server"
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      }
    }
  },
  security: [
    {
      bearerAuth: []
    }
  ],
  paths: {}
};

// Extract path parameters from string e.g. {clientId}
const extractPathParams = (pathStr) => {
  const matches = pathStr.match(/{([^}]+)}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
};

// Infern JSON properties to OpenAPI schema
const inferSchema = (data) => {
  if (data === null || data === undefined) {
    return { type: "string" };
  }
  const type = typeof data;
  if (type === "string") {
    return { type: "string", example: data };
  }
  if (type === "number") {
    return { type: "number", example: data };
  }
  if (type === "boolean") {
    return { type: "boolean", example: data };
  }
  if (Array.isArray(data)) {
    return {
      type: "array",
      items: data.length > 0 ? inferSchema(data[0]) : { type: "string" }
    };
  }
  if (type === "object") {
    const properties = {};
    const required = [];
    for (const key of Object.keys(data)) {
      properties[key] = inferSchema(data[key]);
      required.push(key);
    }
    return {
      type: "object",
      properties,
      required
    };
  }
  return { type: "string" };
};

// Read all collection files and sort them numerically
const files = fs.readdirSync(collectionsDir)
  .filter(f => f.endsWith('.json'))
  .sort((a, b) => {
    const numA = parseInt(a.split('_')[0], 10) || 0;
    const numB = parseInt(b.split('_')[0], 10) || 0;
    return numA - numB;
  });

console.log(`📁 Found ${files.length} collection files.`);

const globalVariables = {};

// First pass: collect all Postman environment/collection variables
for (const file of files) {
  const filePath = path.join(collectionsDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(data.variable)) {
      for (const v of data.variable) {
        if (v.key && v.value) {
          const valStr = String(v.value);
          // Avoid over-writing active values with generic place-holders
          if (!globalVariables[v.key] || (!valStr.includes('here') && !valStr.includes('placeholder'))) {
            globalVariables[v.key] = valStr;
          }
        }
      }
    }
  } catch (err) {}
}

console.log('🔑 Collected global variables:', globalVariables);

// Recursive traversal of postman items
const processItem = (item, parentFolders = []) => {
  if (item.request) {
    const request = item.request;
    const method = request.method.toLowerCase();
    
    // Build raw URL path
    let urlRaw = "";
    if (typeof request.url === "string") {
      urlRaw = request.url;
    } else if (request.url && request.url.raw) {
      urlRaw = request.url.raw;
    }

    if (!urlRaw) return;

    // Normalize path variables: replace {{varName}} with {varName} and :varName with {varName}
    let normalizedPath = urlRaw
      .replace(/{{base_url}}/g, '')
      .split('?')[0] // remove query string
      .replace(/{{([a-zA-Z0-9_-]+)}}/g, '{$1}')
      .replace(/:([a-zA-Z0-9_-]+)/g, '{$1}');

    // Ensure path starts with /
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }

    // Initialize path if not present
    if (!swaggerSpec.paths[normalizedPath]) {
      swaggerSpec.paths[normalizedPath] = {};
    }

    // Create tag hierarchy string: "Collection Name | Folder Name"
    const tag = parentFolders.join(' | ');

    const op = {
      summary: item.name,
      description: request.description || item.description || `Endpoint mapping for ${item.name}`,
      tags: [tag],
      parameters: [],
      responses: {
        "200": {
          "description": "Successful Response"
        }
      }
    };

    // Extract path params from normalized path
    const pathParams = extractPathParams(normalizedPath);
    for (const param of pathParams) {
      const defaultValue = globalVariables[param];
      op.parameters.push({
        name: param,
        in: "path",
        required: true,
        schema: {
          type: "string",
          ...(defaultValue ? { default: defaultValue } : {})
        },
        description: `Path parameter ${param}`
      });
    }

    // Extract query params from URL
    if (request.url && Array.isArray(request.url.query)) {
      for (const q of request.url.query) {
        if (q.disabled) continue;
        op.parameters.push({
          name: q.key,
          in: "query",
          required: false,
          schema: {
            type: "string",
            default: q.value || ""
          },
          description: q.description || `Query parameter ${q.key}`
        });
      }
    }

    // Extract headers (exclude Authorization and Content-Type)
    if (Array.isArray(request.header)) {
      for (const h of request.header) {
        if (['authorization', 'content-type'].includes(h.key.toLowerCase())) continue;
        op.parameters.push({
          name: h.key,
          in: "header",
          required: h.disabled ? false : true,
          schema: {
            type: "string",
            default: h.value || ""
          },
          description: h.description || `Header key ${h.key}`
        });
      }
    }

    // Extract request body
    if (request.body && request.body.mode === 'raw' && request.body.raw) {
      try {
        const bodyClean = request.body.raw.trim();
        if (bodyClean.startsWith('{') || bodyClean.startsWith('[')) {
          const parsedJSON = JSON.parse(bodyClean);
          op.requestBody = {
            required: true,
            content: {
              "application/json": {
                schema: inferSchema(parsedJSON)
              }
            }
          };
        }
      } catch (err) {
        // Fallback if parsing template JSON fails
        op.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object"
              }
            }
          }
        };
      }
    }

    swaggerSpec.paths[normalizedPath][method] = op;
  } else if (item.item && Array.isArray(item.item)) {
    for (const child of item.item) {
      processItem(child, [...parentFolders, item.name]);
    }
  }
};

// Process each file
for (const file of files) {
  const filePath = path.join(collectionsDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const collectionName = data.info.name || file.replace('.json', '');
    if (data.item && Array.isArray(data.item)) {
      for (const item of data.item) {
        processItem(item, [collectionName]);
      }
    }
    console.log(`✅ Processed: ${file}`);
  } catch (err) {
    console.error(`❌ Failed to process ${file}:`, err.message);
  }
}

// Write compiled Swagger JSON
fs.writeFileSync(outputFile, JSON.stringify(swaggerSpec, null, 2), 'utf8');
console.log(`🚀 Swagger compilation completed successfully! Saved to: ${outputFile}`);
