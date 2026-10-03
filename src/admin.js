const express = require('express');
const { getAllUsers, getOrCreateUser, addFamilyMember, activatePremium, addCredits, firstName } = require('./db');
const { sendText } = require('./whatsapp');
const { resolveRecipient, canonicalId } = require('./test-recipient-overrides');

const router = express.Router();

// Formules que l'admin peut accorder manuellement (sans paiement Cartflox),
// avec le libellé exact utilisé dans le message de confirmation WhatsApp.
const GRANT_PLANS = {
  famille: { label: 'un accès illimité permanent à toutes les plateformes (TikTok, Instagram, Facebook, X)' },
  semaine: { label: 'le Pass Semaine (7 jours, accès illimité multi-plateforme)', days: 7 },
  mensuel: { label: 'le Pass Mensuel (30 jours, accès illimité multi-plateforme)', days: 30 },
  credits: { label: '50 crédits de téléchargement, valables sur toutes les plateformes', credits: 50 },
};

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
  const erreur = req.query.erreur ? `<p style="color:#f87171;margin-top:1rem;">⚠️ ${escapeHtml(req.query.erreur)}</p>` : '';

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
  label { display: block; margin-top: 0.75rem; font-size: 0.85rem; }
  input, select { padding: 0.5rem; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; width: 100%; box-sizing: border-box; margin-top: 0.25rem; }
  button { margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 6px; border: none; background: #22c55e; color: #052e16; font-weight: 600; cursor: pointer; }
  .count { color: #94a3b8; font-size: 0.85rem; }
  .hint { color: #64748b; font-size: 0.75rem; margin-top: 0.5rem; }
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

  <form method="POST" action="/admin/grant">
    <label>Numéro WhatsApp
      <input type="text" name="phone_number" placeholder="ex: 2250759928005" required>
    </label>
    <label>Formule à activer
      <select name="plan" required>
        <option value="famille">Famille — illimité permanent</option>
        <option value="semaine">Pass Semaine (7 jours)</option>
        <option value="mensuel">Pass Mensuel (30 jours)</option>
        <option value="credits">50 Crédits</option>
      </select>
    </label>
    <button type="submit">Activer</button>
    <p class="hint">La personne reçoit automatiquement un message WhatsApp de confirmation.</p>
    ${erreur}
  </form>
</body>
</html>
  `);
});

router.post('/grant', express.urlencoded({ extended: true }), async (req, res) => {
  const rawNumber = (req.body.phone_number || '').replace(/[^0-9]/g, '');
  const plan = GRANT_PLANS[req.body.plan];

  if (!plan) {
    return res.redirect('/admin');
  }

  // L'indicatif pays (ex: 225) est obligatoire pour que WhatsApp puisse
  // livrer quoi que ce soit — un numéro local seul (ex: 0153785124, 10
  // chiffres) échoue silencieusement à l'envoi sans ce préfixe.
  if (rawNumber.length < 11) {
    return res.redirect('/admin?erreur=' + encodeURIComponent("Numéro invalide : inclus l'indicatif pays (ex: 2250153785124), pas juste le numéro local."));
  }

  // Les deux formats (wa_id ou numéro complet) doivent pointer vers le même
  // compte en base, qu'importe lequel l'admin a tapé.
  const phoneNumber = canonicalId(rawNumber);

  if (req.body.plan === 'famille') {
    addFamilyMember(phoneNumber);
  } else if (plan.days) {
    activatePremium(phoneNumber, plan.days);
  } else if (plan.credits) {
    addCredits(phoneNumber, plan.credits);
  }

  const user = getOrCreateUser(phoneNumber);
  const greeting = firstName(user) || 'Cher client';

  try {
    await sendText(
      resolveRecipient(phoneNumber),
      `${greeting}, votre compte vient d'être activé par l'administrateur pour ${plan.label}. 🎉`
    );
  } catch (error) {
    console.error('Erreur envoi confirmation activation admin:', error.response?.data || error.message);
  }

  res.redirect('/admin');
});

module.exports = router;
