const statusEl = document.getElementById('status');
const disconnectBanner = document.getElementById('disconnectBanner');
const busListEl = document.getElementById('busList');
const inputListEl = document.getElementById('inputList');
const emptyCategoryEl = document.getElementById('emptyCategory');
const rowTemplate = document.getElementById('rowTemplate');
const tabsBarEl = document.getElementById('tabsBar');

const serverPillsEl = document.getElementById('serverPills');
const serverPillTemplate = document.getElementById('serverPillTemplate');
const addServerBtn = document.getElementById('addServerBtn');
const addServerFormTitle = document.getElementById('addServerFormTitle');
const addServerForm = document.getElementById('addServerForm');
const newServerName = document.getElementById('newServerName');
const newServerHost = document.getElementById('newServerHost');
const newServerPort = document.getElementById('newServerPort');
const saveServerBtn = document.getElementById('saveServerBtn');
const cancelServerBtn = document.getElementById('cancelServerBtn');

const profilesBtn = document.getElementById('profilesBtn');
const profilesPanel = document.getElementById('profilesPanel');
const profilesListEl = document.getElementById('profilesList');
const profileRowTemplate = document.getElementById('profileRowTemplate');
const newProfileName = document.getElementById('newProfileName');
const saveProfileBtn = document.getElementById('saveProfileBtn');

const accountBtn = document.getElementById('accountBtn');
const accountPanel = document.getElementById('accountPanel');
const accountUserLabel = document.getElementById('accountUserLabel');
const curPassword = document.getElementById('curPassword');
const newUser = document.getElementById('newUser');
const newPassword = document.getElementById('newPassword');
const changePasswordBtn = document.getElementById('changePasswordBtn');
const accountError = document.getElementById('accountError');
const logoutBtn = document.getElementById('logoutBtn');

const masterMeterL = document.getElementById('masterMeterL');
const masterMeterR = document.getElementById('masterMeterR');
const selectedMeterLabel = document.getElementById('selectedMeterLabel');
const selectedMeterL = document.getElementById('selectedMeterL');
const selectedMeterR = document.getElementById('selectedMeterR');
const dbScaleTemplate = document.getElementById('dbScaleTemplate');
const masterScaleEl = document.getElementById('masterScale');
const selectedScaleEl = document.getElementById('selectedScale');
masterScaleEl.appendChild(dbScaleTemplate.content.cloneNode(true));
selectedScaleEl.appendChild(dbScaleTemplate.content.cloneNode(true));

const metersBarEl = document.getElementById('metersBar');
const meterStyleBtns = document.querySelectorAll('.meter-style-btn');
const METER_STYLE_KEY = 'vmixAudioConsole.meterStyle';

function applyMeterStyle(style) {
  metersBarEl.classList.remove('meters-bar--continuous', 'meters-bar--led', 'meters-bar--blocks');
  metersBarEl.classList.add('meters-bar--' + style);
  for (const btn of meterStyleBtns) btn.classList.toggle('active', btn.dataset.style === style);
  localStorage.setItem(METER_STYLE_KEY, style);
}

for (const btn of meterStyleBtns) {
  btn.addEventListener('click', () => applyMeterStyle(btn.dataset.style));
}

applyMeterStyle(localStorage.getItem(METER_STYLE_KEY) || 'continuous');

const popover = document.getElementById('popover');
const popVolume = document.getElementById('popVolume');
const popVolumeValue = document.getElementById('popVolumeValue');
const popGainRow = document.getElementById('popGainRow');
const popGain = document.getElementById('popGain');
const popGainValue = document.getElementById('popGainValue');

const ACTIVE_SERVER_KEY = 'vmixAudioConsole.activeServerId';

// --- Datos por servidor (selección "Mis entradas", inputs ya vistos,
// selecciones guardadas) ---------------------------------------------------
//
// Cada servidor vMix tiene sus propios inputs, asi que cada uno guarda su
// propia lista independiente -- elegir algo en un servidor no toca la
// seleccion de otro. Se cachea en memoria por serverId y se persiste en
// localStorage con una clave por servidor.

let customSetByServer = new Map(); // serverId -> Set<number>
let knownInputsByServer = new Map(); // serverId -> Set<number> | null
let profilesByServer = new Map(); // serverId -> [{id, name, inputs}]

function customKeyFor(serverId) { return `vmixAudioConsole.customInputs.${serverId}`; }
function knownKeyFor(serverId) { return `vmixAudioConsole.knownInputs.${serverId}`; }
function profilesKeyFor(serverId) { return `vmixAudioConsole.selectionProfiles.${serverId}`; }

// Migracion unica: antes de separar por servidor, todo esto vivia en una
// sola clave global compartida. Si todavia no hay nada guardado para este
// servidor puntual pero existe el dato viejo, se adopta una sola vez para
// no perder lo que el usuario ya habia armado.
function migrateOnce(oldKey, newKey) {
  if (localStorage.getItem(newKey) !== null) return null;
  const old = localStorage.getItem(oldKey);
  return old !== null ? old : null;
}

function loadCustomSet(serverId) {
  if (!customSetByServer.has(serverId)) {
    const key = customKeyFor(serverId);
    const raw = localStorage.getItem(key) ?? migrateOnce('vmixAudioConsole.customInputs', key);
    customSetByServer.set(serverId, new Set(raw ? JSON.parse(raw) : []));
  }
  return customSetByServer.get(serverId);
}

function loadKnownInputs(serverId) {
  if (!knownInputsByServer.has(serverId)) {
    const key = knownKeyFor(serverId);
    const raw = localStorage.getItem(key) ?? migrateOnce('vmixAudioConsole.knownInputs', key);
    knownInputsByServer.set(serverId, raw ? new Set(JSON.parse(raw)) : null);
  }
  return knownInputsByServer.get(serverId);
}

function loadProfiles(serverId) {
  if (!profilesByServer.has(serverId)) {
    const key = profilesKeyFor(serverId);
    const raw = localStorage.getItem(key) ?? migrateOnce('vmixAudioConsole.selectionProfiles', key);
    profilesByServer.set(serverId, raw ? JSON.parse(raw) : []);
  }
  return profilesByServer.get(serverId);
}

// Variables "activas": siempre apuntan a los datos del servidor
// actualmente seleccionado. loadServerScopedData() las reasigna cada vez
// que cambia activeServerId.
let customSet = new Set();
let knownInputs = null;
let selectionProfiles = [];

function loadServerScopedData(serverId) {
  customSet = loadCustomSet(serverId);
  knownInputs = loadKnownInputs(serverId);
  selectionProfiles = loadProfiles(serverId);
}

function saveKnownInputs() {
  if (!activeServerId) return;
  knownInputsByServer.set(activeServerId, knownInputs);
  localStorage.setItem(knownKeyFor(activeServerId), JSON.stringify([...knownInputs]));
}

let ws;
let activeTab = 'all';
let rowCache = new Map(); // rowKey -> { el, refs, kind, target }
let draggingTargets = new Set();
let openPopoverTarget = null;
let lastState = null;

let servers = []; // [{id, name, host, port, connected}]
let activeServerId = localStorage.getItem(ACTIVE_SERVER_KEY) || null;
let statesByServer = new Map();
let connectedByServer = new Map();

let selectedTarget = null; // target (numero de input, 'Master', 'Bus A', ...) que se muestra en el 2do vumetro
let selectedLabel = null;

let wsGeneration = 0;

function connect() {
  // Cada llamada a connect() reemplaza el socket anterior. Si ese socket
  // viejo todavia dispara eventos (close/message) despues de haber sido
  // reemplazado, hay que ignorarlos -- si no, un close tardio de un socket
  // abandonado puede pisar el estado "conectado" correcto del socket nuevo
  // y quedar mostrando "desconectado" para siempre (nada lo vuelve a
  // corregir porque el status solo se reenvia cuando cambia).
  const myGen = ++wsGeneration;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.addEventListener('close', () => {
    if (myGen !== wsGeneration) return;
    setStatus(false);
    setTimeout(connect, 1500);
  });
  ws.addEventListener('message', (ev) => {
    if (myGen !== wsGeneration) return;
    const msg = JSON.parse(ev.data);
    if (msg.type === 'servers') handleServers(msg.list);
    if (msg.type === 'status') handleServerStatus(msg.serverId, msg.connected);
    if (msg.type === 'state') handleServerState(msg.serverId, msg.state);
    if (msg.type === 'error') console.error('vMix error:', msg.message);
  });
}

function setStatus(connected) {
  statusEl.textContent = connected ? 'vMix conectado' : 'vMix desconectado';
  statusEl.className = 'status ' + (connected ? 'status--online' : 'status--offline');
  disconnectBanner.hidden = connected;
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function sendControl(obj) {
  if (!activeServerId) return;
  send({ ...obj, serverId: activeServerId });
}

function saveCustom() {
  if (!activeServerId) return;
  customSetByServer.set(activeServerId, customSet);
  localStorage.setItem(customKeyFor(activeServerId), JSON.stringify([...customSet]));
}

function detectNewInputs(inputs) {
  if (knownInputs === null) {
    // primera lista que vemos: se toma como base, sin auto-seleccionar
    knownInputs = new Set(inputs.map((i) => i.number));
    saveKnownInputs();
    return;
  }
  let isNew = false;
  for (const input of inputs) {
    if (!knownInputs.has(input.number)) {
      knownInputs.add(input.number);
      customSet.add(input.number);
      isNew = true;
    }
  }
  if (isNew) {
    saveKnownInputs();
    saveCustom();
  }
}

// --- Selecciones guardadas ("proyectos") --------------------------------
//
// Cada proyecto de vMix suele necesitar tildar otro grupo de entradas en
// "Mis entradas". Esto guarda esa selección con un nombre para poder
// volver a cargarla despues, sin tener que tildar todo de nuevo.

function saveProfiles() {
  if (!activeServerId) return;
  profilesByServer.set(activeServerId, selectionProfiles);
  localStorage.setItem(profilesKeyFor(activeServerId), JSON.stringify(selectionProfiles));
}

function renderProfilesList() {
  profilesListEl.innerHTML = '';
  for (const profile of selectionProfiles) {
    const node = profileRowTemplate.content.cloneNode(true);
    const row = node.querySelector('.profile-row');
    const loadBtn = row.querySelector('.profile-row__load');
    loadBtn.textContent = `${profile.name} (${profile.inputs.length})`;
    loadBtn.addEventListener('click', () => loadProfile(profile));
    row.querySelector('.profile-row__remove').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!confirm(`¿Borrar la selección "${profile.name}"?`)) return;
      selectionProfiles = selectionProfiles.filter((p) => p.id !== profile.id);
      saveProfiles();
      renderProfilesList();
    });
    profilesListEl.appendChild(row);
  }
}

function loadProfile(profile) {
  customSet = new Set(profile.inputs);
  saveCustom();
  setActiveTab('all');
  if (lastState) renderState(lastState);
  profilesPanel.hidden = true;
}

profilesBtn.addEventListener('click', () => {
  if (!profilesPanel.hidden) {
    profilesPanel.hidden = true;
    return;
  }
  renderProfilesList();
  addServerForm.hidden = true;
  accountPanel.hidden = true;
  profilesPanel.hidden = false;
});

saveProfileBtn.addEventListener('click', () => {
  const name = newProfileName.value.trim();
  if (!name) {
    alert('Ponele un nombre a la selección.');
    return;
  }
  selectionProfiles.push({
    id: crypto.randomUUID(),
    name,
    inputs: [...customSet],
  });
  saveProfiles();
  renderProfilesList();
  newProfileName.value = '';
});

document.addEventListener('click', (ev) => {
  if (profilesPanel.hidden) return;
  if (profilesPanel.contains(ev.target) || ev.target === profilesBtn) return;
  profilesPanel.hidden = true;
});

// --- Cuenta (login / cambiar contraseña) --------------------------------

fetch('/api/me')
  .then((r) => r.json())
  .then((data) => {
    if (data.ok) accountUserLabel.textContent = data.user;
    else location.href = '/login.html';
  })
  .catch(() => {});

accountBtn.addEventListener('click', () => {
  if (!accountPanel.hidden) {
    accountPanel.hidden = true;
    return;
  }
  accountError.textContent = '';
  curPassword.value = '';
  newUser.value = '';
  newPassword.value = '';
  addServerForm.hidden = true;
  profilesPanel.hidden = true;
  accountPanel.hidden = false;
});

document.addEventListener('click', (ev) => {
  if (accountPanel.hidden) return;
  if (accountPanel.contains(ev.target) || ev.target === accountBtn) return;
  accountPanel.hidden = true;
});

changePasswordBtn.addEventListener('click', async () => {
  accountError.textContent = '';
  accountError.style.color = '';
  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: curPassword.value,
        newUser: newUser.value.trim(),
        newPassword: newPassword.value,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      accountError.textContent = data.error || 'No se pudo cambiar la contraseña.';
      return;
    }
    accountUserLabel.textContent = newUser.value.trim() || accountUserLabel.textContent;
    curPassword.value = '';
    newUser.value = '';
    newPassword.value = '';
    accountError.style.color = 'var(--accent)';
    accountError.textContent = 'Contraseña actualizada.';
  } catch {
    accountError.textContent = 'No se pudo conectar con el servidor.';
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    // igual redirige aunque falle el pedido
  }
  location.href = '/login.html';
});

// --- Servidores vMix ----------------------------------------------------

function handleServers(list) {
  servers = list;
  if (!activeServerId || !servers.some((s) => s.id === activeServerId)) {
    activeServerId = servers.length ? servers[0].id : null;
    localStorage.setItem(ACTIVE_SERVER_KEY, activeServerId || '');
  }
  if (activeServerId) loadServerScopedData(activeServerId);
  for (const s of servers) connectedByServer.set(s.id, s.connected);
  renderServerPills();
  setStatus(!!connectedByServer.get(activeServerId));
  const cached = statesByServer.get(activeServerId);
  if (cached) { lastState = cached; renderState(cached); }
}

function handleServerStatus(serverId, connected) {
  connectedByServer.set(serverId, connected);
  const s = servers.find((x) => x.id === serverId);
  if (s) s.connected = connected;
  renderServerPills();
  if (serverId === activeServerId) setStatus(connected);
}

function handleServerState(serverId, state) {
  statesByServer.set(serverId, state);
  // Si nos esta llegando estado en vivo para este servidor, es prueba de
  // que esta conectado -- corrige cualquier desincronizacion del status.
  if (connectedByServer.get(serverId) !== true) handleServerStatus(serverId, true);
  if (serverId === activeServerId) {
    lastState = state;
    renderState(state);
  }
}

function switchActiveServer(id) {
  if (id === activeServerId) return;
  activeServerId = id;
  localStorage.setItem(ACTIVE_SERVER_KEY, id);
  loadServerScopedData(activeServerId);
  closePopover();
  selectedTarget = null;
  selectedLabel = null;
  selectedMeterLabel.textContent = 'Tocá un canal';
  selectedMeterLabel.classList.add('vumeter__label--dim');
  selectedMeterL.style.width = '0%';
  selectedMeterR.style.width = '0%';
  clearRows();
  renderServerPills();
  setStatus(!!connectedByServer.get(activeServerId));
  const cached = statesByServer.get(activeServerId);
  if (cached) { lastState = cached; renderState(cached); }
}

function clearRows() {
  busListEl.innerHTML = '';
  inputListEl.innerHTML = '';
  rowCache.clear();
}

let editingServerId = null; // null = formulario en modo "agregar"

function renderServerPills() {
  serverPillsEl.innerHTML = '';
  for (const s of servers) {
    const node = serverPillTemplate.content.cloneNode(true);
    const pill = node.querySelector('.pill');
    pill.classList.toggle('pill--active', s.id === activeServerId);
    pill.querySelector('.pill__dot').classList.toggle('pill__dot--online', !!s.connected);
    pill.querySelector('.pill__name').textContent = s.name;
    pill.addEventListener('click', () => switchActiveServer(s.id));

    const editBtn = pill.querySelector('.pill__edit');
    editBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEditServerForm(s);
    });

    const removeBtn = pill.querySelector('.pill__remove');
    removeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (servers.length <= 1) {
        alert('Tiene que quedar al menos un servidor vMix configurado.');
        return;
      }
      if (confirm(`¿Quitar "${s.name}" de la lista?`)) send({ type: 'removeServer', id: s.id });
    });
    serverPillsEl.appendChild(pill);
  }
}

function openEditServerForm(s) {
  editingServerId = s.id;
  newServerName.value = s.name;
  newServerHost.value = s.host;
  newServerPort.value = s.port;
  addServerFormTitle.textContent = 'Editar servidor';
  saveServerBtn.textContent = 'Guardar cambios';
  profilesPanel.hidden = true;
  addServerForm.hidden = false;
  newServerName.focus();
}

function resetServerForm() {
  editingServerId = null;
  addServerForm.hidden = true;
  newServerName.value = '';
  newServerHost.value = '';
  newServerPort.value = '8099';
  addServerFormTitle.textContent = 'Agregar servidor vMix';
  saveServerBtn.textContent = 'Guardar';
}

addServerBtn.addEventListener('click', () => {
  if (!addServerForm.hidden) {
    resetServerForm();
    return;
  }
  editingServerId = null;
  addServerFormTitle.textContent = 'Agregar servidor vMix';
  saveServerBtn.textContent = 'Guardar';
  profilesPanel.hidden = true;
  accountPanel.hidden = true;
  addServerForm.hidden = false;
  newServerName.focus();
});

document.addEventListener('click', (ev) => {
  if (addServerForm.hidden) return;
  if (addServerForm.contains(ev.target) || ev.target === addServerBtn || ev.target.closest('.pill__edit')) return;
  resetServerForm();
});

cancelServerBtn.addEventListener('click', resetServerForm);

saveServerBtn.addEventListener('click', () => {
  const name = newServerName.value.trim();
  const host = newServerHost.value.trim();
  const port = parseInt(newServerPort.value, 10) || 8099;
  if (!name || !host) {
    alert('Completá el nombre y la IP/host del vMix.');
    return;
  }
  if (editingServerId) {
    send({ type: 'editServer', id: editingServerId, name, host, port });
  } else {
    send({ type: 'addServer', name, host, port });
  }
  resetServerForm();
});

// --- Tabs / categorias ---------------------------------------------------
//
// "Todos" es fija. Las demas pestañas se arman solas segun los tipos de
// input (vMix: Video, VideoList, Image, Call, Camera, GT, etc.) que haya
// entre las entradas que el usuario tildo en "Todos" -- no aparecen hasta
// que elige algo.

const CATEGORY_LABELS = {
  Video: 'Video',
  VideoList: 'Playlist',
  Image: 'Imagen',
  Photos: 'Fotos',
  Call: 'Llamada',
  Camera: 'Cámara',
  Colour: 'Color',
  GT: 'Título',
  VirtualSet: 'Set virtual',
  AudioInput: 'Audio',
  Flash: 'Flash',
  PowerPoint: 'PowerPoint',
  Blank: 'Blank',
};

function categoryLabel(type) {
  return CATEGORY_LABELS[type] || type || 'Otros';
}

const CATEGORY_COLORS = {
  Video: '#3ddc84',
  VideoList: '#b47cf0',
  Image: '#f5c542',
  Photos: '#ffa64d',
  Call: '#ff5f8f',
  Camera: '#4dd0e1',
  Colour: '#c0c4cc',
  GT: '#5b9dff',
  VirtualSet: '#7c8cff',
  AudioInput: '#4dd0e1',
  Flash: '#ffa64d',
  PowerPoint: '#ff6b6b',
  Blank: '#8a8f9b',
};

function categoryColor(type) {
  if (CATEGORY_COLORS[type]) return CATEGORY_COLORS[type];
  // color determinista para tipos que no estan en la lista de arriba
  let hash = 0;
  for (let i = 0; i < (type || '').length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 65%)`;
}

tabsBarEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab');
  if (!btn) return;
  setActiveTab(btn.dataset.tab);
});

function setActiveTab(tab) {
  activeTab = tab;
  for (const t of tabsBarEl.querySelectorAll('.tab')) {
    t.classList.toggle('tab--active', t.dataset.tab === tab);
  }
  if (lastState) renderState(lastState);
}

function updateCategoryTabs(inputs) {
  const presentTypes = new Set();
  for (const input of inputs) {
    if (customSet.has(input.number)) presentTypes.add(input.type || 'Otros');
  }

  const existingBtns = [...tabsBarEl.querySelectorAll('.tab[data-tab^="cat:"]')];
  const existingTypes = new Set(existingBtns.map((b) => b.dataset.tab.slice(4)));

  for (const btn of existingBtns) {
    const type = btn.dataset.tab.slice(4);
    if (!presentTypes.has(type)) btn.remove();
  }
  for (const type of presentTypes) {
    if (existingTypes.has(type)) continue;
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = 'cat:' + type;
    btn.style.setProperty('--tab-color', categoryColor(type));
    const dot = document.createElement('span');
    dot.className = 'tab__dot';
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(categoryLabel(type)));
    tabsBarEl.appendChild(btn);
  }

  if (activeTab !== 'all' && !presentTypes.has(activeTab.slice(4))) {
    setActiveTab('all');
  } else {
    for (const t of tabsBarEl.querySelectorAll('.tab')) {
      t.classList.toggle('tab--active', t.dataset.tab === activeTab);
    }
  }
}

// --- Popover ----------------------------------------------------------
//
// vMix mueve el fader por POSICION (0-100), y el volumen real que muestra
// (y que guardamos en input.volume / master.volume / bus.volume) sale de
// aplicarle una curva: volumen% = (posicion/100)^4 * 100. Para que el
// slider de acá se mueva exactamente igual que el fader nativo de vMix,
// el slider representa la POSICION (se manda tal cual), y el % que se ve
// al lado se calcula con la curva -- igual que en vMix.

function positionToVolumePercent(position) {
  return 100 * Math.pow(position / 100, 4);
}

function volumePercentToPosition(volumePercent) {
  const v = Math.max(0, Math.min(100, Number(volumePercent) || 0));
  return 100 * Math.pow(v / 100, 0.25);
}

function closePopover() {
  popover.hidden = true;
  openPopoverTarget = null;
}

function openPopover(anchorEl, target, kind, volumePercent, gainDb) {
  if (openPopoverTarget && openPopoverTarget !== target) draggingTargets.delete(openPopoverTarget);
  openPopoverTarget = target;
  draggingTargets.add(target);

  popVolume.value = volumePercentToPosition(volumePercent);
  popVolumeValue.textContent = Math.round(volumePercent) + '%';

  if (kind === 'input') {
    popGainRow.style.display = 'flex';
    popGain.value = gainDb;
    popGainValue.textContent = (gainDb >= 0 ? '+' : '') + Math.round(gainDb) + ' dB';
  } else {
    popGainRow.style.display = 'none';
  }

  const rect = anchorEl.getBoundingClientRect();
  popover.hidden = false;
  const popRect = popover.getBoundingClientRect();
  let left = rect.right - popRect.width;
  let top = rect.bottom + 6;
  if (top + popRect.height > window.innerHeight) top = rect.top - popRect.height - 6;
  if (left < 8) left = 8;
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
}

popVolume.addEventListener('input', () => {
  if (!openPopoverTarget) return;
  const position = Number(popVolume.value);
  popVolumeValue.textContent = Math.round(positionToVolumePercent(position)) + '%';
  sendControl({ type: 'setVolume', target: openPopoverTarget, value: position });
});

popGain.addEventListener('input', () => {
  if (!openPopoverTarget) return;
  const v = Number(popGain.value);
  popGainValue.textContent = (v >= 0 ? '+' : '') + v + ' dB';
  sendControl({ type: 'setGain', target: openPopoverTarget, value: v });
});

document.addEventListener('click', (ev) => {
  if (popover.hidden) return;
  if (popover.contains(ev.target) || ev.target.classList.contains('row__pct')) return;
  if (openPopoverTarget) draggingTargets.delete(openPopoverTarget);
  closePopover();
});

// --- Row rendering ------------------------------------------------------

function buildRow(container, key, kind) {
  const node = rowTemplate.content.cloneNode(true);
  const el = node.querySelector('.row');
  if (kind !== 'input') el.classList.add('row--bus');
  container.appendChild(el);
  const refs = {
    tally: el.querySelector('.row__tally'),
    check: el.querySelector('.row__check'),
    badge: el.querySelector('.row__badge'),
    icon: el.querySelector('.row__icon'),
    name: el.querySelector('.row__name'),
    number: el.querySelector('.row__number'),
    buses: el.querySelector('.row__buses'),
    auto: el.querySelector('.row__auto'),
    mute: el.querySelector('.row__mute'),
    pct: el.querySelector('.row__pct'),
    solo: el.querySelector('.row__solo'),
  };
  refs.auto.hidden = kind !== 'input';

  el.addEventListener('click', () => selectForMeter(key, refs.name.textContent, el));

  return { el, refs };
}

// --- Vumetro del canal seleccionado --------------------------------------

const METER_FLOOR_DB = -60;

// vMix reporta el nivel de audio en amplitud lineal (0 a 1, o 0 a 100 si
// ya viene como %). Un vumetro de verdad se mueve en escala de dB, no
// lineal, asi que se convierte antes de dibujar la barra.
function meterPct(v) {
  const n = Number(v) || 0;
  const amplitude = n > 1 ? n / 100 : n; // normaliza a 0-1
  const clamped = Math.max(0.001, Math.min(1, amplitude)); // 0.001 = -60dB
  const db = 20 * Math.log10(clamped);
  const pct = ((Math.max(METER_FLOOR_DB, db) - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
  return Math.max(0, Math.min(100, pct));
}

function selectForMeter(target, label, el) {
  selectedTarget = target;
  selectedLabel = label;
  selectedMeterLabel.textContent = label;
  selectedMeterLabel.classList.remove('vumeter__label--dim');
  document.querySelectorAll('.row--selected').forEach((r) => r.classList.remove('row--selected'));
  if (el) el.classList.add('row--selected');
  if (lastState) updateMeters(lastState);
}

function updateMeters(state) {
  if (state.master) {
    masterMeterL.style.width = meterPct(state.master.meterF1) + '%';
    masterMeterR.style.width = meterPct(state.master.meterF2) + '%';
  }

  if (selectedTarget === null) return;

  let data = null;
  if (selectedTarget === 'Master') {
    data = state.master;
  } else if (typeof selectedTarget === 'string' && selectedTarget.startsWith('Bus ')) {
    const letter = selectedTarget.slice(4);
    data = (state.buses || {})[letter];
  } else {
    data = state.inputs.find((i) => i.number === selectedTarget);
  }

  if (data) {
    selectedMeterL.style.width = meterPct(data.meterF1) + '%';
    selectedMeterR.style.width = meterPct(data.meterF2) + '%';
  }
}

function ensureBusTags(container, inputNumber, letters) {
  const key = letters.join(',');
  if (container.dataset.letters === key) return;
  container.innerHTML = '';
  container.dataset.letters = key;
  for (const letter of letters) {
    const tag = document.createElement('span');
    tag.className = 'bus-tag';
    tag.textContent = letter;
    tag.dataset.bus = letter;
    tag.addEventListener('click', () => {
      const isActive = tag.classList.contains('bus-tag--active');
      sendControl({ type: 'setBusRouting', target: inputNumber, bus: letter, on: !isActive });
    });
    container.appendChild(tag);
  }
}

function renderState(state) {
  renderBuses(state.master, state.buses);
  // M (master) siempre existe; el resto son solo los buses habilitados en
  // vMix (Settings > Audio), no una lista fija de A a G.
  const busLetters = ['M', ...Object.keys(state.buses || {})];
  renderInputs(state.inputs, state.preview, state.active, busLetters);
  updateMeters(state);
}

function renderBuses(master, buses) {
  const list = [];
  if (master) list.push({ label: 'Master', target: 'Master', data: master, kind: 'master' });
  for (const [letter, b] of Object.entries(buses || {})) {
    list.push({ label: `Bus ${letter}`, target: `Bus ${letter}`, data: b, kind: 'bus' });
  }

  const seen = new Set();
  for (const { label, target, data, kind } of list) {
    seen.add(target);
    let entry = rowCache.get(target);
    if (!entry) {
      entry = buildRow(busListEl, target, kind);
      wireCommon(entry.refs, target, kind);
      entry.refs.solo.hidden = kind === 'master';
      entry.refs.check.hidden = true;
      rowCache.set(target, entry);
    }
    const { refs } = entry;
    refs.name.textContent = label;
    refs.number.textContent = '';
    refs.icon.textContent = data.muted ? '🔇' : '🔊';

    if (!draggingTargets.has(target)) {
      refs.pct.textContent = Math.round(data.volume) + '%';
    }
    refs.mute.textContent = data.muted ? '🔈' : '🔊';
    refs.mute.classList.toggle('muted', !!data.muted);
    if (kind === 'bus') refs.solo.classList.toggle('active', !!data.solo);
  }

  for (const [key, entry] of rowCache) {
    if (typeof key !== 'string') continue;
    if (key !== 'Master' && !key.startsWith('Bus ')) continue; // input rows handled elsewhere
    if (!seen.has(key)) {
      entry.el.remove();
      rowCache.delete(key);
    }
  }
}

function renderInputs(inputs, preview, active, busLetters) {
  const seen = new Set();
  detectNewInputs(inputs);
  updateCategoryTabs(inputs);

  for (const input of inputs) {
    const target = input.number;
    seen.add(target);
    let entry = rowCache.get('input-' + target);
    if (!entry) {
      entry = buildRow(inputListEl, target, 'input');
      wireCommon(entry.refs, target, 'input');
      wireCheckbox(entry.refs, target);
      rowCache.set('input-' + target, entry);
    }
    ensureBusTags(entry.refs.buses, target, busLetters);
    const { refs } = entry;

    refs.name.textContent = input.shortTitle || input.title || `Input ${target}`;
    refs.number.textContent = `Input #${target}`;
    refs.badge.textContent = target;
    refs.icon.textContent = input.muted ? '🔇' : '🔊';
    refs.mute.textContent = input.muted ? '🔈' : '🔊';
    refs.mute.classList.toggle('muted', !!input.muted);
    refs.solo.classList.toggle('active', !!input.solo);
    refs.check.checked = customSet.has(target);

    if (!draggingTargets.has(target)) {
      refs.pct.textContent = Math.round(input.volume) + '%';
    }

    refs.tally.className = 'row__tally';
    if (active === target) refs.tally.classList.add('row__tally--program');
    else if (preview === target) refs.tally.classList.add('row__tally--preview');

    for (const tag of refs.buses.children) {
      tag.classList.toggle('bus-tag--active', input.audiobusses.includes(tag.dataset.bus));
      tag.classList.toggle('bus-tag--available', !input.audiobusses.includes(tag.dataset.bus));
    }

    entry._data = input;
    applyTabVisibility(entry, target);
  }

  for (const [key, entry] of rowCache) {
    if (!key.startsWith('input-')) continue;
    const target = Number(key.slice(6));
    if (!seen.has(target)) {
      entry.el.remove();
      rowCache.delete(key);
    }
  }

  const anyVisible =
    activeTab === 'all' ||
    inputs.some((i) => customSet.has(i.number) && activeTab === 'cat:' + (i.type || 'Otros'));
  emptyCategoryEl.hidden = anyVisible;
}

function applyTabVisibility(entry, target) {
  entry.refs.check.hidden = activeTab !== 'all';
  if (activeTab === 'all') {
    entry.el.style.display = '';
    return;
  }
  const type = entry._data ? entry._data.type || 'Otros' : 'Otros';
  const matches = customSet.has(target) && activeTab === 'cat:' + type;
  entry.el.style.display = matches ? '' : 'none';
}

function wireCheckbox(refs, target) {
  refs.check.addEventListener('click', (ev) => ev.stopPropagation());
  refs.check.addEventListener('change', () => {
    if (refs.check.checked) customSet.add(target);
    else customSet.delete(target);
    saveCustom();
    if (lastState) renderState(lastState);
  });
}

function wireCommon(refs, target, kind) {
  refs.mute.addEventListener('click', () => {
    const nowMuted = !refs.mute.classList.contains('muted');
    sendControl({ type: 'setMute', target, muted: nowMuted });
  });

  refs.solo.addEventListener('click', () => {
    const nowSolo = !refs.solo.classList.contains('active');
    sendControl({ type: 'setSolo', target, on: nowSolo });
  });

  if (refs.auto) {
    refs.auto.addEventListener('click', () => {
      // vMix no informa el estado real de "Audio Auto" por XML, asi que
      // esto solo lleva la cuenta local de lo que se toco en el navegador.
      const nowOn = !refs.auto.classList.contains('active');
      refs.auto.classList.toggle('active', nowOn);
      sendControl({ type: 'setAudioAuto', target, on: nowOn });
    });
  }

  refs.pct.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectForMeter(target, refs.name.textContent, refs.pct.closest('.row'));
    const volumePercent = parseFloat(refs.pct.textContent) || 0;
    const gainDb = kind === 'input' && entryDataOf(target) ? entryDataOf(target).gainDb : 0;
    openPopover(refs.pct, target, kind, volumePercent, gainDb);
  });
}

function entryDataOf(target) {
  const entry = rowCache.get('input-' + target);
  return entry ? entry._data : null;
}

connect();
