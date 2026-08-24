const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const VmixClient = require('./vmixClient');

const DATA_FILE = process.env.SERVERS_FILE || path.join(__dirname, '..', 'servers.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const list = JSON.parse(raw);
    if (Array.isArray(list) && list.length) return list;
  } catch {
    // sin archivo todavia, o corrupto: arrancamos con el default
  }
  return [
    {
      id: crypto.randomUUID(),
      name: 'Local',
      host: process.env.VMIX_HOST || '127.0.0.1',
      port: parseInt(process.env.VMIX_PORT || '8099', 10),
    },
  ];
}

class ServerManager extends EventEmitter {
  constructor() {
    super();
    this.entries = new Map(); // id -> { id, name, host, port, client }
  }

  start() {
    for (const cfg of loadConfig()) this._spawn(cfg);
    this._save();
  }

  _spawn({ id, name, host, port }) {
    const client = new VmixClient({ host, port, pollIntervalMs: 150 });
    const entry = { id, name, host, port, client };
    this.entries.set(id, entry);
    this._wireClient(entry);
    client.start();
    return entry;
  }

  _wireClient(entry) {
    const { id, client } = entry;
    client.on('state', (state) => this.emit('state', { id, state }));
    client.on('connected', () => this.emit('status', { id, connected: true }));
    client.on('disconnected', () => this.emit('status', { id, connected: false }));
    client.on('error', () => this.emit('status', { id, connected: client.connected }));
  }

  list() {
    return [...this.entries.values()].map(({ id, name, host, port, client }) => ({
      id,
      name,
      host,
      port,
      connected: client.connected,
    }));
  }

  get(id) {
    return this.entries.get(id);
  }

  add(name, host, port) {
    const id = crypto.randomUUID();
    const entry = this._spawn({ id, name, host, port });
    this._save();
    return entry;
  }

  edit(id, name, host, port) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.name = name;
    const hostChanged = entry.host !== host || entry.port !== port;
    if (hostChanged) {
      entry.client.stop();
      entry.host = host;
      entry.port = port;
      entry.client = new VmixClient({ host, port, pollIntervalMs: 150 });
      this._wireClient(entry);
      entry.client.start();
    }
    this._save();
    return true;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.client.stop();
    this.entries.delete(id);
    this._save();
    return true;
  }

  _save() {
    const list = [...this.entries.values()].map(({ id, name, host, port }) => ({
      id,
      name,
      host,
      port,
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
  }
}

module.exports = ServerManager;
