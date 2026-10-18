# Versailles Vivant — zero-dependency Node static site with a small form API.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

# Only what the server needs at run time (build tooling, tests and docs stay out of the image)
COPY package.json server.js ./
COPY server ./server
COPY *.html *.css lang-init.js script.js pages.js charts.js favicon.svg favicon.ico apple-touch-icon.png feed.xml ./
COPY i18n ./i18n
COPY downloads ./downloads
COPY fonts ./fonts
COPY images ./images

# Messages are written to DATA_DIR, which is a volume owned by the unprivileged "node" user
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "server.js"]
