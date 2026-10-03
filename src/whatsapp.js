const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

function graphHeaders() {
  return { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
}

async function sendText(to, body) {
  await axios.post(
    `${GRAPH_URL}/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    },
    { headers: graphHeaders() }
  );
}

// Les vidéos téléchargées par yt-dlp sont locales : il n'y a pas d'URL publique
// à passer à l'API Meta. Il faut d'abord les uploader pour obtenir un media_id.
async function uploadMedia(filePath, mimeType = 'video/mp4') {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', fs.createReadStream(filePath), { contentType: mimeType });

  const response = await axios.post(
    `${GRAPH_URL}/${process.env.PHONE_NUMBER_ID}/media`,
    form,
    { headers: { ...graphHeaders(), ...form.getHeaders() } }
  );

  return response.data.id;
}

async function sendVideoByMediaId(to, mediaId, caption) {
  await axios.post(
    `${GRAPH_URL}/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'video',
      video: { id: mediaId, caption },
    },
    { headers: graphHeaders() }
  );
}

module.exports = { sendText, uploadMedia, sendVideoByMediaId };
