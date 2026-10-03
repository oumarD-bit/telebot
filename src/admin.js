const express = require('express');
const { getAllUsers, addFamilyMember } = require('./db');

const router = express.Router();

// Authentification HTTP Basic simple : un seul mot de passe admin, pas de
// gestion de comptes/sessions nécessaire pour un outil interne mono-utilisateur.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [, password] = decoded.split(':');
    if (password === process.env.ADMIN_PASSWORD) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Telebot Admin"');
  return res.status(401).send('Authentification requise.');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function statutLabel(statut) {
  if (statut === 'premium') return '💳 Premium';
  if (statut === 'famille') return '👨‍👩‍👧 Famille';
  return '🆓 Gratuit';
}

router.use(requireAuth);

router.get('/', (req, res) => {
  const users = getAllUsers();

  const rows = users
    .map(
      (u) => `
        <tr>
          <td>${escapeHtml(u.phone_number)}</td>
          <td>${escapeHtml(u.nom) || '—'}</td>
          <td>${statutLabel(u.statut)}</td>
          <td>${u.credits}</td>
          <td>${u.telechargements_restants}</td>
          <td>${formatDate(u.premium_jusqua)}</td>
        </tr>`
    )
    .join('');

  res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Telebot — Dashboard</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
  h1 { font-size: 1.4rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #334155; text-align: left; font-size: 0.9rem; }
  th { color: #94a3b8; font-weight: 600; }
  form { margin-top: 2rem; padding: 1rem; background: #1e293b; border-radius: 8px; max-width: 400px; }
  input { padding: 0.5rem; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; width: 100%; box-sizing: border-box; margin-top: 0.25rem; }
  button { margin-top: 0.75rem; padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #22c55e; color: #052e16; font-weight: 600; cursor: pointer; }
  .count { color: #94a3b8; font-size: 0.85rem; }
</style>
</head>
<body>
  <h1>Clients Telebot</h1>
  <p class="count">${users.length} client(s)</p>
  <table>
    <thead>
      <tr><th>Numéro</th><th>Nom</th><th>Statut</th><th>Crédits</th><th>TikTok gratuit restant</th><th>Premium jusqu'au</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <form method="POST" action="/admin/family">
    <label>Ajouter un numéro famille (accès illimité, sans paiement)
      <input type="text" name="phone_number" placeholder="ex: 2250759928005" required>
    </label>
    <button type="submit">Ajouter</button>
  </form>
</body>
</html>
  `);
});

router.post('/family', express.urlencoded({ extended: true }), (req, res) => {
  const phoneNumber = (req.body.phone_number || '').replace(/[^0-9]/g, '');
  if (phoneNumber) {
    addFamilyMember(phoneNumber);
  }
  res.redirect('/admin');
});

module.exports = router;
