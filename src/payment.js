const axios = require('axios');

const CARTFLOX_API = 'https://cartflox.com/api/v1/checkout/sessions';

// Montants en FCFA (XOF), cf. grille tarifaire définie avec l'utilisateur.
const PLANS = {
  semaine: { amount: 500, currency: 'XOF', label: 'Pass Semaine (7 jours, illimité multi-plateforme)', days: 7 },
  mensuel: { amount: 2000, currency: 'XOF', label: 'Pass Mensuel (30 jours, illimité + compression)', days: 30 },
  credits: { amount: 1000, currency: 'XOF', label: '50 Crédits (valables sur toutes les plateformes)', credits: 50 },
};

// Crée une session de paiement Cartflox et renvoie l'URL à envoyer au client.
// Le numéro et le plan voyagent dans `metadata`, repris tels quels dans le
// webhook de confirmation pour savoir quel compte créditer.
async function createPaymentLink(phoneNumber, planKey) {
  const plan = PLANS[planKey];
  if (!plan) {
    throw new Error(`Plan inconnu: ${planKey}`);
  }

  const response = await axios.post(
    CARTFLOX_API,
    {
      amount: plan.amount,
      currency: plan.currency,
      customer_phone: `+${phoneNumber}`,
      description: plan.label,
      metadata: { phone_number: phoneNumber, plan: planKey },
    },
    { headers: { Authorization: `Bearer ${process.env.CARTFLOX_SECRET_KEY}` } }
  );

  return response.data.url;
}

module.exports = { createPaymentLink, PLANS };
