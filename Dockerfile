FROM node:22-slim

# ffmpeg (transcodage H.264 + contrôle de taille) + curl/ca-certificates pour
# récupérer le binaire autonome yt-dlp. python3/make/g++ : better-sqlite3 n'a
# pas toujours de binaire précompilé pour cette plateforme et doit alors
# compiler ses sources natives (node-gyp) au moment du `npm install`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && curl -L -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src/ ./src/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/app.js"]
