const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadBridgeHelpers(env = {}) {
  const filename = path.join(__dirname, 'opencode-bridge.js');
  const code = `${fs.readFileSync(filename, 'utf8')}\nmodule.exports = { createOpencodeArgs };`;
  const sandbox = {
    __dirname,
    console,
    module: { exports: {} },
    process: {
      env: {
        ...process.env,
        ...env,
      },
      platform: process.platform,
    },
    require(moduleName) {
      if (moduleName === 'http') {
        return {
          createServer: () => ({
            listen: () => undefined,
            on: () => undefined,
          }),
        };
      }
      if (moduleName === 'express') {
        const express = () => ({
          delete: () => undefined,
          get: () => undefined,
          post: () => undefined,
          use: () => undefined,
        });
        express.json = () => () => undefined;
        return express;
      }
      if (moduleName === 'cors') {
        return () => () => undefined;
      }
      if (moduleName === 'cookie') {
        return { parse: () => ({}) };
      }
      if (moduleName === 'child_process') {
        return { spawn: () => ({}) };
      }
      if (moduleName === 'ws') {
        return {
          WebSocket: { OPEN: 1 },
          WebSocketServer: class {
            on() {}
            handleUpgrade() {}
          },
        };
      }
      return require(moduleName);
    },
  };

  vm.runInNewContext(code, sandbox, { filename });
  return sandbox.module.exports;
}

test('createOpencodeArgs appends configured model', () => {
  const { createOpencodeArgs } = loadBridgeHelpers({
    OPENCODE_BRIDGE_MODEL: 'mimo/mimo-v2.5-pro',
  });

  assert.deepEqual(Array.from(createOpencodeArgs('hello')), [
    'run',
    'hello',
    '--format',
    'json',
    '--pure',
    '-m',
    'mimo/mimo-v2.5-pro',
  ]);
});

test('createOpencodeArgs omits empty model configuration', () => {
  const { createOpencodeArgs } = loadBridgeHelpers({
    OPENCODE_BRIDGE_MODEL: '   ',
  });

  assert.deepEqual(Array.from(createOpencodeArgs('hello', 'ses_123')), [
    'run',
    'hello',
    '--format',
    'json',
    '--pure',
    '--session',
    'ses_123',
  ]);
});
