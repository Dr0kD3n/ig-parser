/**
 * Postinstall patch: stub out playwright-core's MCP bundle.
 *
 * playwright-core v1.58+ includes mcpBundleImpl/index.js with ESM import()
 * calls that crash inside pkg snapshots ("Invalid host defined options").
 * This app never uses MCP features, so we replace mcpBundle.js with a
 * minimal stub that provides the two exports consumed by nodePlatform.js:
 *   - z          (Zod-like object with a toJSONSchema no-op)
 *   - zodToJsonSchema (no-op function)
 */

const fs = require('fs');
const path = require('path');

// Robust node_modules search: check current, parent, or grandparent (for backend/scripts/ or dist/scripts/)
let nodeModulesBase = '';
const pathsToCheck = [
  path.join(__dirname, '..', 'node_modules'),      // dist/scripts/ -> dist/node_modules/
  path.join(__dirname, '..', '..', 'node_modules') // backend/scripts/ -> root/node_modules/
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

const mcpBundlePath = path.join(nodeModulesBase, 'playwright-core', 'lib', 'mcpBundle.js');


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

fs.writeFileSync(mcpBundlePath, stub, 'utf8');
console.log('[patch] Replaced playwright-core mcpBundle.js with pkg-compatible stub.');
