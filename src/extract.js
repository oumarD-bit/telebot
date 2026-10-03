const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TMP_DIR = path.join(__dirname, '..', 'tmp');

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000, maxBuffer: 1024 * 1024 * 10, ...options }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${cmd} a échoué: ${stderr || error.message}`));
      resolve(stdout);
    });
  });
}

const WHATSAPP_MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const AUDIO_BITRATE_BPS = 128000;
const MIN_VIDEO_BITRATE_BPS = 250000;

// Au-delà de cette durée, même au débit plancher (MIN_VIDEO_BITRATE_BPS), le fichier
// dépasserait quand même les 16 Mo de WhatsApp (16 Mo*8*0.92 / (250k+128k) ≈ 326s) —
// on garde une marge de sécurité en dessous de cette valeur théorique.
const MAX_DURATION_SECONDS = 300;

class VideoTooLongError extends Error {}

async function probe(filePath) {
  const stdout = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name',
    '-show_entries', 'format=duration,size',
    '-of', 'default=noprint_wrappers=1',
    filePath,
  ]);
  const info = {};
  for (const line of stdout.trim().split('\n')) {
    const [key, value] = line.split('=');
    info[key] = value;
  }
  return {
    codec: info.codec_name,
    duration: parseFloat(info.duration),
    size: parseInt(info.size, 10),
  };
}

// WhatsApp n'accepte que le H.264 pour les messages vidéo (le HEVC/H.265 souvent
// servi par TikTok/Instagram s'uploade sans erreur mais n'est jamais livrable), et
// limite les vidéos à 16 Mo. On réencode donc dès que le codec n'est pas H.264 OU
// que le fichier dépasse cette limite, avec un débit vidéo calculé pour tenir dans
// 16 Mo compte tenu de la durée réelle de la vidéo.
async function ensureWhatsAppCompatible(filePath) {
  const { codec, duration, size } = await probe(filePath);

  if (codec === 'h264' && size <= WHATSAPP_MAX_VIDEO_BYTES) {
    return filePath;
  }

  const targetTotalBitrate = (WHATSAPP_MAX_VIDEO_BYTES * 8 * 0.92) / duration;
  const videoBitrate = Math.max(targetTotalBitrate - AUDIO_BITRATE_BPS, MIN_VIDEO_BITRATE_BPS);

  const outputPath = filePath.replace(/\.[^.]+$/, '') + '.h264.mp4';
  await run('ffmpeg', [
    '-y',
    '-i', filePath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', String(Math.round(videoBitrate)),
    '-maxrate', String(Math.round(videoBitrate * 1.2)),
    '-bufsize', String(Math.round(videoBitrate * 2)),
    '-c:a', 'aac',
    '-b:a', String(AUDIO_BITRATE_BPS),
    '-movflags', '+faststart',
    outputPath,
  ]);

  fs.unlink(filePath, () => {});
  return outputPath;
}

// Télécharge la vidéo (sans filigrane) localement via yt-dlp et renvoie son chemin.
// execFile (pas exec) : les args sont passés en tableau, jamais interprétés par un
// shell, ce qui évite toute injection de commande via le lien envoyé par l'utilisateur.
async function extractVideo(url) {
  ensureTmpDir();

  // Vérification légère (sans télécharger) de la durée avant de lancer le
  // téléchargement complet, pour ne pas gaspiller bande passante et temps sur
  // une vidéo qu'on devra de toute façon refuser.
  const durationOutput = await run('yt-dlp', [
    '--no-playlist',
    '--skip-download',
    '--print', '%(duration)s',
    url,
  ]);
  const duration = parseFloat(durationOutput.trim());
  if (Number.isFinite(duration) && duration > MAX_DURATION_SECONDS) {
    throw new VideoTooLongError(
      `Vidéo trop longue (${Math.round(duration / 60)} min, max ${Math.round(MAX_DURATION_SECONDS / 60)} min).`
    );
  }

  const jobId = crypto.randomUUID();
  const outputTemplate = path.join(TMP_DIR, `${jobId}.%(ext)s`);

  await run('yt-dlp', [
    '--no-playlist',
    // On préfère explicitement une piste déjà en H.264 (avc1) quand TikTok/Instagram
    // la propose, pour éviter un réencodage inutile ; sinon on prend le meilleur
    // disponible et ensureH264() se charge de la conversion.
    '-f', 'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/best[vcodec^=avc1][ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    url,
  ]);

  const files = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith(jobId));
  if (files.length === 0) {
    throw new Error("yt-dlp n'a produit aucun fichier.");
  }

  const downloadedPath = path.join(TMP_DIR, files[0]);
  return ensureWhatsAppCompatible(downloadedPath);
}

function cleanup(filePath) {
  fs.unlink(filePath, () => {});
}

module.exports = { extractVideo, cleanup, VideoTooLongError };
