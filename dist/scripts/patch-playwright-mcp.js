/**
 * Postinstall patch: stub out playwright-core's MCP bundle.
 *
 * playwright-core v1.58+ includes mcpBundleImpl/index.js with ESM import()
 * calls that crash inside pkg snapshots ("Invalid host defined options").
 * This app never uses MCP features, so we replace mcpBundle.js with a
 * minimal stub that provides the exports consumed by nodePlatform.js.
 */

const fs = require('fs');
const path = require('path');

// Robust node_modules search: check current, parent, or grandparent (for backend/scripts/ or dist/scripts/)
let nodeModulesBase = '';
const pathsToCheck = [
  path.join(__dirname, '..', 'node_modules'), // dist/scripts/ -> dist/node_modules/
  path.join(__dirname, '..', '..', 'node_modules'), // backend/scripts/ -> root/node_modules/
  path.join(process.cwd(), 'node_modules'), // Current working directory
  path.join(process.cwd(), '..', 'node_modules'), // Parent of CWD
];

for (const p of pathsToCheck) {
  if (fs.existsSync(path.join(p, 'playwright-core'))) {
    nodeModulesBase = p;
    break;
  }
}

if (!nodeModulesBase) {
  console.log('[patch] playwright-core not found in expected node_modules locations, skipping.');
  process.exit(0);
}

const possibleBundlePaths = [
  path.join(nodeModulesBase, 'playwright-core', 'lib', 'mcpBundle.js'),
  path.join(nodeModulesBase, 'playwright-core', 'lib', 'utils', 'mcpBundle.js'),
  path.join(nodeModulesBase, 'playwright-core', 'lib', 'server', 'mcpBundle.js'),
];

const stub = `"use strict";
// Stubbed by patch-playwright-mcp.js to avoid pkg snapshot crash.
// Original mcpBundleImpl uses ESM import() incompatible with pkg + Node 18.

const recursiveProxy = new Proxy(() => recursiveProxy, {
    get: (target, prop) => {
        if (prop === 'toJSONSchema') return () => ({});
        return recursiveProxy;
    }
});

module.exports = {
  z: recursiveProxy,
  zodToJsonSchema: () => ({}),
  Client: function() {},
  Server: function() {},
  SSEClientTransport: function() {},
  SSEServerTransport: function() {},
  StdioClientTransport: function() {},
  StdioServerTransport: function() {},
  StreamableHTTPClientTransport: function() {},
  StreamableHTTPServerTransport: function() {},
  CallToolRequestSchema: {},
  ListRootsRequestSchema: {},
  ListToolsRequestSchema: {},
  PingRequestSchema: {},
  ProgressNotificationSchema: {},
  Loop: function() {},
};
`;

let patched = false;
for (const bPath of possibleBundlePaths) {
  if (fs.existsSync(bPath)) {
    fs.writeFileSync(bPath, stub, 'utf8');
    console.log(`[patch] Replaced ${path.relative(nodeModulesBase, bPath)} with pkg-compatible stub.`);
    patched = true;
  }
}

// 2. Patch all bundles for dynamic import() crash in Node 18+ inside pkg snapshots
const libDir = path.join(nodeModulesBase, 'playwright-core', 'lib');
if (fs.existsSync(libDir)) {
  const files = fs.readdirSync(libDir);
  for (const file of files) {
    if (file.endsWith('.js') && !file.includes('mcpBundle')) {
      const filePath = path.join(libDir, file);
      try {
        let content = fs.readFileSync(filePath, 'utf8');
        const regex = /import\(['"]node:([^'"]+)['"]\)/g;
        if (regex.test(content)) {
          // Replace dynamic import with a Promise-wrapped require to avoid pkg crash
          content = content.replace(regex, 'Promise.resolve(require("$1"))');
          fs.writeFileSync(filePath, content, 'utf8');
          console.log(`[patch] Patched ${file} to remove dynamic node: imports.`);
          patched = true;
        }
      } catch (e) {
        console.warn(`[patch] Failed to process ${file}: ${e.message}`);
      }
    }
  }
}

if (!patched) {
  console.log('[patch] No files found to patch or already patched.');
} else {
  // Also stub out the impl directory if it exists to be safe
  const implDir = path.join(nodeModulesBase, 'playwright-core', 'lib', 'mcpBundleImpl');
  if (fs.existsSync(implDir)) {
    try {
      const indexFile = path.join(implDir, 'index.js');
      fs.writeFileSync(indexFile, stub, 'utf8');
      console.log('[patch] Also stubbed mcpBundleImpl/index.js');
    } catch (e) { }
  }
}
