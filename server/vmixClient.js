const net = require('net');
const { XMLParser } = require('fast-xml-parser');
const { EventEmitter } = require('events');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

// Buses de audio conocidos por vMix (mas alla de M, se agregan si aparecen en el XML)
const KNOWN_BUS_KEYS = ['busA', 'busB', 'busC', 'busD', 'busE', 'busF', 'busG'];

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function toBool(v) {
  return v === true || v === 'True' || v === 'true';
}

function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

class VmixClient extends EventEmitter {
  constructor({ host = '127.0.0.1', port = 8099, pollIntervalMs = 150 } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.pollIntervalMs = pollIntervalMs;
    this.socket = null;
    this.connected = false;
    this.buf = Buffer.alloc(0);
    this.mode = 'line'; // 'line' | 'xmlbody'
    this.xmlLen = 0;
    this.queue = []; // { resolve, reject }
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.lastState = null;
    this._stopped = false;
  }

  start() {
    this._stopped = false;
    this._connect();
  }

  stop() {
    // Marca que este cierre es intencional para que el handler de 'close'
    // no programe una reconexion -- si no, el cliente sigue vivo en
    // segundo plano reconectandose cada 2s para siempre aunque ya no
    // este en la lista de servidores.
    this._stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pollTimer);
    if (this.socket) this.socket.destroy();
  }

  _connect() {
    this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
      this.connected = true;
      this.emit('connected');
      this._startPolling();
    });

    this.socket.on('data', (chunk) => this._onData(chunk));

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      clearInterval(this.pollTimer);
      this._rejectQueue(new Error('vMix connection closed'));
      if (!this._stopped) {
        this.reconnectTimer = setTimeout(() => this._connect(), 2000);
      }
    });
  }

  _startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this._requestXml().catch(() => {});
    }, this.pollIntervalMs);
    this._requestXml().catch(() => {});
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);

    let progressed = true;
    while (progressed) {
      progressed = false;

      if (this.mode === 'line') {
        const idx = this.buf.indexOf('\r\n');
        if (idx === -1) break;
        const line = this.buf.slice(0, idx).toString('utf8');
        this.buf = this.buf.slice(idx + 2);
        progressed = true;

        if (line.startsWith('XML ')) {
          this.xmlLen = parseInt(line.split(' ')[1], 10) || 0;
          this.mode = 'xmlbody';
        } else if (line.startsWith('FUNCTION')) {
          if (line.startsWith('FUNCTION OK')) {
            this._resolveNext({ type: 'function', line });
          } else {
            this._rejectNext(new Error(line));
          }
        } else if (line.startsWith('VERSION')) {
          // Saludo espontaneo de vMix al conectar: no es respuesta a ningun
          // comando en cola, asi que no debe consumir un slot de la cola.
        } else {
          this._resolveNext({ type: 'other', line });
        }
      } else if (this.mode === 'xmlbody') {
        if (this.buf.length < this.xmlLen) break;
        const xml = this.buf.slice(0, this.xmlLen).toString('utf8');
        this.buf = this.buf.slice(this.xmlLen);
        this.mode = 'line';
        progressed = true;
        this._handleXml(xml);
        this._resolveNext({ type: 'xml', xml });
      }
    }
  }

  _handleXml(xml) {
    let data;
    try {
      data = parser.parse(xml);
    } catch (e) {
      return;
    }
    const vmix = data.vmix;
    if (!vmix) return;

    const inputs = asArray(vmix.inputs && vmix.inputs.input).map((i) => ({
      key: i.key,
      number: toNum(i.number),
      type: i.type,
      title: i.title,
      shortTitle: i.shortTitle,
      muted: toBool(i.muted),
      volume: toNum(i.volume, 100),
      balance: toNum(i.balance, 0),
      solo: toBool(i.solo),
      soloPFL: toBool(i.soloPFL),
      audiobusses: (i.audiobusses || '').split(',').map((s) => s.trim()).filter(Boolean),
      meterF1: toNum(i.meterF1, 0),
      meterF2: toNum(i.meterF2, 0),
      gainDb: toNum(i.gainDb, 0),
    }));

    const audio = vmix.audio || {};
    const master = audio.master
      ? {
          volume: toNum(audio.master.volume, 100),
          muted: toBool(audio.master.muted),
          meterF1: toNum(audio.master.meterF1, 0),
          meterF2: toNum(audio.master.meterF2, 0),
          headphonesVolume: toNum(audio.master.headphonesVolume, 100),
        }
      : null;

    const buses = {};
    for (const busKey of KNOWN_BUS_KEYS) {
      if (audio[busKey]) {
        const b = audio[busKey];
        const label = busKey.replace('bus', ''); // 'A', 'B', ...
        buses[label] = {
          volume: toNum(b.volume, 100),
          muted: toBool(b.muted),
          meterF1: toNum(b.meterF1, 0),
          meterF2: toNum(b.meterF2, 0),
          solo: toBool(b.solo),
          sendToMaster: toBool(b.sendToMaster),
        };
      }
    }

    this.lastState = {
      version: vmix.version,
      edition: vmix.edition,
      recording: toBool(vmix.recording),
      streaming: toBool(vmix.streaming),
      preview: toNum(vmix.preview, null),
      active: toNum(vmix.active, null),
      inputs,
      master,
      buses,
      updatedAt: Date.now(),
    };

    this.emit('state', this.lastState);
  }

  _resolveNext(result) {
    const pending = this.queue.shift();
    if (pending) pending.resolve(result);
  }

  _rejectNext(err) {
    const pending = this.queue.shift();
    if (pending) pending.reject(err);
  }

  _rejectQueue(err) {
    while (this.queue.length) {
      const p = this.queue.shift();
      p.reject(err);
    }
  }

  _send(cmd) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error('vMix not connected'));
        return;
      }
      this.queue.push({ resolve, reject });
      this.socket.write(cmd + '\r\n');
    });
  }

  _requestXml() {
    return this._send('XML');
  }

  /**
   * Envia una funcion generica FUNCTION <name> con parametros.
   * params: objeto simple { Input, Value, ... }
   */
  sendFunction(name, params = {}) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const cmd = qs ? `FUNCTION ${name} ${qs}` : `FUNCTION ${name}`;
    return this._send(cmd);
  }

  // --- Helpers de alto nivel -------------------------------------------
  //
  // vMix expone controles de volumen distintos segun el objetivo:
  //   - Input normal: FUNCTION SetVolume Input=<num>&Value=<v>
  //   - Master:       FUNCTION SetMasterVolume Value=<v>
  //   - Bus A/B/C/D:  FUNCTION SetBus{Letra}Volume Value=<v>
  // "Input=Master" / "Input=Bus A" en las funciones genericas NO tiene
  // efecto (vMix responde OK igual, pero no aplica el cambio). Verificado
  // empiricamente contra una instancia real de vMix 27.
  //
  // El parametro Value de estas funciones es la POSICION del fader
  // (0-100), no el volumen percibido: vMix aplica una curva de audio
  // volume% = (Value/100)^4 * 100 (asi es como se ve tambien en el fader
  // nativo de vMix). Se manda la posicion del slider tal cual, sin
  // invertir la curva, para que el fader de la UI se mueva igual que el
  // de vMix (aunque el % resultante no sea lineal).

  static _busLetter(target) {
    const m = typeof target === 'string' && target.match(/^Bus ([A-Z])$/);
    return m ? m[1] : null;
  }

  static _toFaderValue(position) {
    // vMix rechaza valores no enteros para estas funciones (FUNCTION ER
    // Invalid Parameters), asi que se redondea antes de enviar.
    return Math.round(Math.max(0, Math.min(100, Number(position) || 0)));
  }

  setVolume(target, faderPosition) {
    const faderValue = VmixClient._toFaderValue(faderPosition);
    const busLetter = VmixClient._busLetter(target);
    if (target === 'Master') {
      return this.sendFunction('SetMasterVolume', { Value: faderValue });
    }
    if (busLetter) {
      return this.sendFunction(`SetBus${busLetter}Volume`, { Value: faderValue });
    }
    return this.sendFunction('SetVolume', { Input: target, Value: faderValue });
  }

  setMute(target, muted) {
    // AudioOn = audio activo (no muteado) / AudioOff = muteado
    const state = muted ? 'Off' : 'On';
    const busLetter = VmixClient._busLetter(target);
    if (target === 'Master') {
      return this.sendFunction(`MasterAudio${state}`);
    }
    if (busLetter) {
      return this.sendFunction(`Bus${busLetter}Audio${state}`);
    }
    return this.sendFunction(`Audio${state}`, { Input: target });
  }

  // "Audio Auto" (AFV): activa el audio del input automaticamente cuando
  // pasa a preview/programa. Solo aplica a inputs, no a master/buses.
  setAudioAuto(target, on) {
    return this.sendFunction(on ? 'AudioAutoOn' : 'AudioAutoOff', { Input: target });
  }

  setBusRouting(inputTarget, busLetter, on) {
    return this.sendFunction(on ? 'AudioBusOn' : 'AudioBusOff', {
      Input: inputTarget,
      Value: busLetter,
    });
  }

  setBalance(target, value) {
    return this.sendFunction('SetBalance', { Input: target, Value: Math.round(value) });
  }

  setSolo(target, on) {
    return this.sendFunction(on ? 'SoloOn' : 'SoloOff', { Input: target });
  }

  // Ganancia (trim) en dB, solo disponible para inputs (no master/buses).
  // vMix rechaza valores no enteros (FUNCTION ER Invalid Parameters).
  setGainDb(target, valueDb) {
    valueDb = Math.round(valueDb);
    return this.sendFunction('SetGain', { Input: target, Value: valueDb });
  }
}

module.exports = VmixClient;
