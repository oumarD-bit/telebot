const Database = require('better-sqlite3');
const path = require('path');

// En production (Render), DB_PATH pointe vers le disque persistant monté
// (ex: /data/telebot.db) ; en local, le fichier reste à la racine du projet.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'telebot.db');
const db = new Database(DB_PATH);

const FREE_WEEKLY_DOWNLOADS = 1;
const RESET_PERIOD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    phone_number TEXT PRIMARY KEY,
    nom TEXT,
    statut TEXT NOT NULL DEFAULT 'gratuit',
    credits INTEGER NOT NULL DEFAULT 0,
    telechargements_restants INTEGER NOT NULL DEFAULT ${FREE_WEEKLY_DOWNLOADS},
    derniere_reinit TEXT NOT NULL DEFAULT (date('now')),
    premium_jusqua TEXT
  );
`);

// Migration légère : ajoute la colonne `nom` si la base existait déjà sans elle.
const existingColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!existingColumns.includes('nom')) {
  db.exec('ALTER TABLE users ADD COLUMN nom TEXT');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(dateISO) {
  return (new Date(todayISO()) - new Date(dateISO)) / MS_PER_DAY;
}

// Récupère l'utilisateur (le crée avec les valeurs par défaut s'il n'existe pas),
// et réinitialise son compteur de téléchargements gratuits si la période (7 jours)
// depuis la dernière réinitialisation est écoulée.
function getOrCreateUser(phoneNumber) {
  let user = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phoneNumber);

  if (!user) {
    db.prepare('INSERT INTO users (phone_number, derniere_reinit) VALUES (?, ?)').run(phoneNumber, todayISO());
    user = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phoneNumber);
  }

  if (daysSince(user.derniere_reinit) >= RESET_PERIOD_DAYS) {
    db.prepare('UPDATE users SET telechargements_restants = ?, derniere_reinit = ? WHERE phone_number = ?').run(
      FREE_WEEKLY_DOWNLOADS,
      todayISO(),
      phoneNumber
    );
    user = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(phoneNumber);
  }

  return user;
}

function isPremium(user) {
  return Boolean(user.premium_jusqua) && new Date(user.premium_jusqua) > new Date();
}

function decrementFreeDownload(phoneNumber) {
  db.prepare('UPDATE users SET telechargements_restants = telechargements_restants - 1 WHERE phone_number = ?').run(
    phoneNumber
  );
}

function decrementCredit(phoneNumber) {
  db.prepare('UPDATE users SET credits = credits - 1 WHERE phone_number = ?').run(phoneNumber);
}

// Prolonge le Premium à partir d'aujourd'hui OU de la date d'expiration actuelle
// si elle est encore dans le futur (un renouvellement s'ajoute au temps restant
// au lieu de l'écraser).
function activatePremium(phoneNumber, days) {
  const user = getOrCreateUser(phoneNumber);
  const base = isPremium(user) ? new Date(user.premium_jusqua) : new Date();
  const expiresAt = new Date(base.getTime() + days * MS_PER_DAY);
  db.prepare('UPDATE users SET statut = ?, premium_jusqua = ? WHERE phone_number = ?').run(
    'premium',
    expiresAt.toISOString(),
    phoneNumber
  );
}

function addCredits(phoneNumber, amount) {
  getOrCreateUser(phoneNumber);
  db.prepare('UPDATE users SET credits = credits + ? WHERE phone_number = ?').run(amount, phoneNumber);
}

// Enregistre le nom de profil WhatsApp (fourni par Meta sur les messages entrants,
// absent des webhooks de paiement) pour personnaliser les messages du bot.
function updateName(phoneNumber, name) {
  if (!name) return;
  getOrCreateUser(phoneNumber);
  db.prepare('UPDATE users SET nom = ? WHERE phone_number = ?').run(name, phoneNumber);
}

function firstName(user) {
  if (!user?.nom) return null;
  return user.nom.trim().split(/\s+/)[0];
}

module.exports = {
  getOrCreateUser,
  isPremium,
  decrementFreeDownload,
  decrementCredit,
  activatePremium,
  addCredits,
  updateName,
  firstName,
  FREE_WEEKLY_DOWNLOADS,
  RESET_PERIOD_DAYS,
};
