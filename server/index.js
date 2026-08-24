const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const ServerManager = require('./serverManager');

const WEB_PORT = parseInt(process.env.WEB_PORT || '3099', 10);
// Por defecto solo escucha en esta misma maquina: nadie mas en la red
// puede controlar el audio. Para usarla desde una tablet/otra pantalla
// en la red local, arrancar con WEB_HOST=0.0.0.0.
const WEB_HOST = process.env.WEB_HOST || '127.0.0.1';

const manager = new ServerManager();
manager.start();

const app = express();
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

const server = app.listen(WEB_PORT, WEB_HOST, () => {
  console.log(`Consola vMix Audio disponible en http://localhost:${WEB_PORT}`);
  if (WEB_HOST === '127.0.0.1') {
    console.log('Solo accesible desde esta maquina. Para permitir tablets/otras pantallas en la red local, arrancar con WEB_HOST=0.0.0.0');
  } else {
    console.log(`Accesible en la red local en el puerto ${WEB_PORT} (WEB_HOST=${WEB_HOST}) -- cualquiera en la red puede controlar el audio.`);
  }
});

const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

manager.on('state', ({ id, state }) => broadcast({ type: 'state', serverId: id, state }));
manager.on('status', ({ id, connected }) => broadcast({ type: 'status', serverId: id, connected }));

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'servers', list: manager.list() }));
  for (const entry of manager.list()) {
    const live = manager.get(entry.id);
    if (live.client.lastState) {
      ws.send(JSON.stringify({ type: 'state', serverId: entry.id, state: live.client.lastState }));
    }
  }

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'addServer') {
      const name = (msg.name || '').trim();
      const host = (msg.host || '').trim();
      const port = parseInt(msg.port, 10) || 8099;
      if (!name || !host) {
        ws.send(JSON.stringify({ type: 'error', message: 'Falta nombre o direccion del servidor' }));
        return;
      }
      manager.add(name, host, port);
      broadcast({ type: 'servers', list: manager.list() });
      return;
    }

    if (msg.type === 'editServer') {
      const name = (msg.name || '').trim();
      const host = (msg.host || '').trim();
      const port = parseInt(msg.port, 10) || 8099;
      if (!name || !host) {
        ws.send(JSON.stringify({ type: 'error', message: 'Falta nombre o direccion del servidor' }));
        return;
      }
      manager.edit(msg.id, name, host, port);
      broadcast({ type: 'servers', list: manager.list() });
      return;
    }

    if (msg.type === 'removeServer') {
      manager.remove(msg.id);
      broadcast({ type: 'servers', list: manager.list() });
      return;
    }

    const entry = manager.get(msg.serverId);
    if (!entry) {
      ws.send(JSON.stringify({ type: 'error', message: 'Servidor vMix no encontrado' }));
      return;
    }
    const vmix = entry.client;

    try {
      switch (msg.type) {
        case 'setVolume':
          // target: numero de input, o 'Master', 'Bus A', 'Bus B', 'Bus C'
          await vmix.setVolume(msg.target, msg.value);
          break;
        case 'setMute':
          await vmix.setMute(msg.target, msg.muted);
          break;
        case 'setBusRouting':
          // solo aplica a inputs: target = numero de input, bus = 'A'|'B'|'C'|'M'
          await vmix.setBusRouting(msg.target, msg.bus, msg.on);
          break;
        case 'setBalance':
          await vmix.setBalance(msg.target, msg.value);
          break;
        case 'setSolo':
          await vmix.setSolo(msg.target, msg.on);
          break;
        case 'setGain':
          await vmix.setGainDb(msg.target, msg.value);
          break;
        case 'setAudioAuto':
          await vmix.setAudioAuto(msg.target, msg.on);
          break;
        default:
          break;
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
});
