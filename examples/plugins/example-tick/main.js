// Example StreamNook plugin: a minimal protocol v1 implementation in Node.
// Speaks JSON-RPC 2.0 over stdio with Content-Length framing per
// docs/plugins/PROTOCOL.md. Register it through Settings > Plugins > Develop.

'use strict';

let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();

function writeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function respond(id, result) {
  writeFrame({ jsonrpc: '2.0', id, result });
}

function notifyHost(method, params) {
  writeFrame({ jsonrpc: '2.0', method, params });
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    writeFrame({ jsonrpc: '2.0', id, method, params });
  });
}

function log(level, message) {
  notifyHost('log', { level, message });
}

const PANEL = {
  title: 'Example Tick Logger',
  sections: [
    {
      label: 'Behavior',
      description: 'These values persist on the host and arrive as on_panel_change.',
      fields: [
        { key: 'chatty', type: 'toggle', label: 'Log every tick', default: true },
        { key: 'note', type: 'text', label: 'Note to self', placeholder: 'anything', default: '' },
      ],
    },
  ],
};

let chatty = true;

async function onInitialized() {
  try {
    await request('register_panel', { schema: PANEL });
    const panel = await request('get_panel_values', {});
    if (panel && panel.values && typeof panel.values.chatty === 'boolean') {
      chatty = panel.values.chatty;
    }
    await request('notify', { level: 'info', message: 'Example plugin started' });
    log('info', 'initialized and panel registered');
  } catch (err) {
    log('error', `startup calls failed: ${err}`);
  }
}

function handleMessage(message) {
  // Response to one of our requests.
  if (message.id !== undefined && message.method === undefined) {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    return;
  }

  // Request or notification from the host.
  switch (message.method) {
    case 'initialize':
      respond(message.id, { plugin_version: '0.1.0', hooks: ['on_watch_tick', 'on_followed_live', 'on_panel_change'] });
      break;
    case 'initialized':
      onInitialized();
      break;
    case 'ping':
      respond(message.id, {});
      break;
    case 'shutdown':
      respond(message.id, null);
      break;
    case 'exit':
      process.exit(0);
      break;
    case 'on_watch_tick':
      if (chatty) {
        const active = message.params && message.params.active_channel_id;
        log('info', `tick, active channel: ${active || 'none'}`);
      }
      break;
    case 'on_followed_live': {
      const count = ((message.params && message.params.channels) || []).length;
      log('info', `followed live: ${count} channels`);
      break;
    }
    case 'on_panel_change': {
      const values = (message.params && message.params.values) || {};
      if (typeof values.chatty === 'boolean') chatty = values.chatty;
      log('info', `panel changed: ${JSON.stringify(values)}`);
      break;
    }
    default:
      // Unknown request: answer method-not-found; unknown notification: ignore.
      if (message.id !== undefined) {
        writeFrame({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `method not found: ${message.method}` },
        });
      }
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString('utf8');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      process.exit(1);
    }
    const length = parseInt(match[1], 10);
    const frameEnd = headerEnd + 4 + length;
    if (buffer.length < frameEnd) return;
    const body = buffer.slice(headerEnd + 4, frameEnd).toString('utf8');
    buffer = buffer.slice(frameEnd);
    try {
      handleMessage(JSON.parse(body));
    } catch (err) {
      process.stderr.write(`bad frame: ${err}\n`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
