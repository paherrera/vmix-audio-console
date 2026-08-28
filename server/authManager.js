const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, '..', 'auth.json');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeCreds(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { user, salt, hash: hashPassword(password, salt) };
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    // primera vez: usuario/contraseña por defecto, pensados para
    // cambiarse desde la consola despues del primer login.
    const creds = makeCreds('admin', 'admin');
    fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2));
    return creds;
  }
}

let current = load();

function verify(user, pass) {
  if (typeof user !== 'string' || typeof pass !== 'string') return false;
  if (user !== current.user) return false;
  // largo constante para evitar timing attacks obvios
  const a = Buffer.from(hashPassword(pass, current.salt));
  const b = Buffer.from(current.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function changeCredentials(currentPassword, newUser, newPassword) {
  if (!verify(current.user, currentPassword)) {
    return { ok: false, error: 'La contraseña actual no es correcta.' };
  }
  const user = (newUser || current.user).trim();
  if (!user) return { ok: false, error: 'El usuario no puede quedar vacío.' };
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: 'La contraseña nueva tiene que tener al menos 4 caracteres.' };
  }
  current = makeCreds(user, newPassword);
  fs.writeFileSync(AUTH_FILE, JSON.stringify(current, null, 2));
  return { ok: true };
}

function getUser() {
  return current.user;
}

module.exports = { verify, changeCredentials, getUser };
