// Correspondance TEMPORAIRE, utile uniquement en mode Test : WhatsApp identifie
// certains numéros ivoiriens pré-2021 par leur ancien format 8 chiffres (wa_id,
// ex. 22559928005) dans message.from, alors que la liste blanche des destinataires
// de test attend le format complet à 10 chiffres (ex. 2250759928005). Les deux
// désignent le même compte, mais ne "matchent" pas tels quels côté API.
// Cette restriction de liste blanche n'existe qu'en mode Test : avec un vrai
// numéro de production (Phase 5), ce correctif devient inutile et sera supprimé.
//
// Partagé entre app.js (réponses automatiques du bot) et admin.js (dashboard,
// qui doit accepter indifféremment le wa_id ou le numéro complet tapé par
// l'administrateur et retrouver/enregistrer le même compte dans les deux cas).
const TEST_RECIPIENT_OVERRIDES = {
  '22559928005': '2250759928005',
  '22553785124': '2250153785124',
  // Hypothèse non vérifiée (même motif que les deux précédents, pas testée par
  // envoi réel) : à corriger si le wa_id réel diffère dans les logs d'erreur 131030.
  '22558757152': '2250758757152',
};

const REVERSE_OVERRIDES = Object.fromEntries(
  Object.entries(TEST_RECIPIENT_OVERRIDES).map(([waId, fullNumber]) => [fullNumber, waId])
);

// wa_id -> numéro complet à utiliser pour ENVOYER un message.
function resolveRecipient(waId) {
  return TEST_RECIPIENT_OVERRIDES[waId] || waId;
}

// N'importe quel format (wa_id ou numéro complet) -> wa_id canonique, pour que
// la base de données utilise toujours la même clé qu'à la réception d'un
// message réel (message.from), peu importe le format saisi par l'admin.
function canonicalId(anyFormat) {
  return REVERSE_OVERRIDES[anyFormat] || anyFormat;
}

module.exports = { resolveRecipient, canonicalId };
