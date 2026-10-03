require('dotenv').config();

const express = require('express');
const { sendText, uploadMedia, sendVideoByMediaId } = require('./whatsapp');
const { extractVideo, cleanup, VideoTooLongError } = require('./extract');
const { getOrCreateUser, activatePremium, addCredits, updateName, firstName } = require('./db');
const { checkAccess } = require('./access');
const { createPaymentLink, PLANS } = require('./payment');
const { verifySignature } = require('./cartflox-webhook');
const adminRouter = require('./admin');
const { resolveRecipient } = require('./test-recipient-overrides');

const app = express();
app.use('/admin', adminRouter);

// yt-dlp gère nativement les 4 plateformes avec la même interface (extractVideo
// ne dépend pas du site) : seul le routage/libellé côté message change ici.
const PLATFORMS = [
  { name: 'TikTok', pattern: /tiktok\.com/i },
  { name: 'Instagram', pattern: /instagram\.com/i },
  { name: 'Facebook', pattern: /facebook\.com|fb\.watch/i },
  { name: 'X', pattern: /x\.com|twitter\.com/i },
];

function detectPlatform(text) {
  return PLATFORMS.find((p) => p.pattern.test(text));
}

// Vérification du webhook, exigée par Meta lors de la configuration du Callback URL.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook validé avec succès.');
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Réception des messages WhatsApp entrants.
app.post('/webhook', express.json(), async (req, res) => {
  const body = req.body;

  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  // Répondre immédiatement à Meta : le traitement se fait en tâche de fond.
  res.sendStatus(200);

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') {
    return;
  }

  // userId identifie le compte WhatsApp pour les quotas/la base de données ; to est
  // le destinataire réel des messages sortants (les deux diffèrent uniquement à
  // cause du correctif de liste blanche du mode Test, cf. TEST_RECIPIENT_OVERRIDES).
  const userId = message.from;
  const to = resolveRecipient(userId);
  const text = message.text.body.trim();

  // Le nom de profil WhatsApp n'arrive que sur les messages entrants (pas sur les
  // webhooks de paiement) : on le sauvegarde dès qu'on le voit pour le réutiliser
  // partout ailleurs (confirmation de paiement comprise).
  const profileName = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;
  updateName(userId, profileName);
  const name = firstName(getOrCreateUser(userId));

  try {
    const platform = detectPlatform(text);
    if (platform) {
      await handleVideoLink(userId, to, text, platform.name, name);
    } else {
      const greeting = name ? `👋 Bonjour ${name} !` : '👋 Bonjour !';
      await sendText(
        to,
        `${greeting} Envoyez-moi un lien de vidéo TikTok, Instagram, Facebook ou X et je vous la renverrai sans filigrane.\n\nCompte gratuit : 1 vidéo TikTok/semaine. Instagram/Facebook/X réservés au Premium.`
      );
    }
  } catch (error) {
    console.error('Erreur traitement message:', error.response?.data || error.message);
  }
});

// Webhook Cartflox : confirmation de paiement. La signature doit être vérifiée
// sur le corps BRUT (express.raw, pas express.json) — cf. src/cartflox-webhook.js.
app.post('/webhook/cartflox', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  const signature = req.headers['x-afriflow-signature'];

  if (!verifySignature(rawBody, signature, process.env.CARTFLOX_SECRET_KEY)) {
    console.error('Webhook Cartflox: signature invalide ou expirée');
    return res.sendStatus(401);
  }

  // Répondre vite (<5s recommandé par Cartflox) : le traitement continue après.
  res.sendStatus(200);

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    console.error('Webhook Cartflox: corps JSON invalide');
    return;
  }

  handleCartfloxPayment(payload).catch((error) => {
    console.error('Erreur traitement paiement Cartflox:', error.response?.data || error.message);
  });
});

async function handleCartfloxPayment(payload) {
  if (payload.event !== 'payment.completed') return;

  const { phone_number: phoneNumber, plan: planKey } = payload.data?.metadata || {};
  const plan = PLANS[planKey];
  if (!phoneNumber || !plan) {
    console.error('Webhook Cartflox: metadata manquante ou plan inconnu', payload.data?.metadata);
    return;
  }

  if (plan.days) {
    activatePremium(phoneNumber, plan.days);
  } else if (plan.credits) {
    addCredits(phoneNumber, plan.credits);
  }

  const to = resolveRecipient(phoneNumber);
  const name = firstName(getOrCreateUser(phoneNumber));
  const greeting = name ? `Merci ${name} !` : 'Merci !';
  await sendText(to, `✅ Paiement confirmé ! ${plan.label} activé. ${greeting} Bon visionnage 🎉`);
}

// Envoie les 3 offres Premium avec un lien de paiement Cartflox généré pour
// chacune. Les erreurs de génération ne doivent pas faire planter le flux
// principal (l'utilisateur a déjà reçu le message de blocage).
async function offerPremiumPlans(to, userId) {
  try {
    const [semaine, mensuel, credits] = await Promise.all([
      createPaymentLink(userId, 'semaine'),
      createPaymentLink(userId, 'mensuel'),
      createPaymentLink(userId, 'credits'),
    ]);

    await sendText(
      to,
      '💳 Débloquer l’accès :\n\n' +
        '📅 *Pass Semaine* — 500 FCFA\n' +
        '- Téléchargements illimités pendant 7 jours\n' +
        '- TikTok + Instagram + Facebook + X débloqués\n' +
        '- Vidéos HD sans filigrane\n' +
        `${semaine}\n\n` +
        '🗓️ *Pass Mensuel* — 2000 FCFA\n' +
        '- Tous les avantages du Pass Semaine, pendant 30 jours\n' +
        '- Meilleur rapport prix/durée\n' +
        `${mensuel}\n\n` +
        '🎟️ *50 Crédits* — 1000 FCFA\n' +
        '- 50 téléchargements à utiliser quand tu veux, sans date limite\n' +
        '- Valable sur toutes les plateformes\n' +
        `${credits}`
    );
  } catch (error) {
    console.error('Erreur génération liens de paiement:', error.response?.data || error.message);
  }
}

async function handleVideoLink(userId, to, url, platformName, name) {
  const user = getOrCreateUser(userId);
  const access = checkAccess(user, platformName);
  const greeting = name ? `Bien reçu ${name}` : 'Bien reçu';

  if (!access.allowed) {
    await sendText(to, access.reason);
    await offerPremiumPlans(to, userId);
    return;
  }

  await sendText(
    to,
    `✅ ${greeting}, je récupère ta vidéo ${platformName} sans filigrane, ça prend généralement 10 à 30 secondes selon sa taille. Je te l'envoie dès qu'elle est prête ✨`
  );

  let filePath;
  try {
    filePath = await extractVideo(url);
    const mediaId = await uploadMedia(filePath);
    await sendVideoByMediaId(to, mediaId, `${name ? `${name}, voici` : 'Voici'} ta vidéo propre ! ✨`);
    access.consume();
  } catch (error) {
    if (error instanceof VideoTooLongError) {
      await sendText(to, `❌ ${error.message}`);
      return;
    }

    console.error('Erreur extraction/envoi:', error.response?.data || error.message);
    await sendText(
      to,
      "❌ Désolé, je n'ai pas réussi à extraire cette vidéo. Vérifiez que le lien est valide et que le compte n'est pas privé."
    );
  } finally {
    if (filePath) cleanup(filePath);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur MVP actif sur le port ${PORT}`));
