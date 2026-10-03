const { isPremium, decrementFreeDownload, decrementCredit, FREE_WEEKLY_DOWNLOADS } = require('./db');

// Détermine si l'utilisateur peut lancer ce téléchargement, et renvoie la fonction
// à appeler pour décompter le quota correspondant UNE FOIS le téléchargement réussi
// (on ne pénalise jamais un utilisateur pour un échec d'extraction de notre côté).
function checkAccess(user, platformName) {
  if (isPremium(user)) {
    return { allowed: true, consume: () => {} };
  }

  if (user.credits > 0) {
    return { allowed: true, consume: () => decrementCredit(user.phone_number) };
  }

  if (platformName !== 'TikTok') {
    return {
      allowed: false,
      reason:
        '🔒 Les téléchargements Instagram/Facebook/X sont réservés aux membres Premium ! Passe au Premium pour débloquer l’accès à toutes les plateformes.',
    };
  }

  if (user.telechargements_restants <= 0) {
    return {
      allowed: false,
      reason: `❌ Limite atteinte ! Tu as utilisé ton téléchargement TikTok gratuit de la semaine (${FREE_WEEKLY_DOWNLOADS}/semaine). Reviens la semaine prochaine, ou passe au Premium pour un accès illimité.`,
    };
  }

  return { allowed: true, consume: () => decrementFreeDownload(user.phone_number) };
}

module.exports = { checkAccess };
