FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV WEB_HOST=0.0.0.0
ENV WEB_PORT=3099

EXPOSE 3099

CMD ["node", "server/index.js"]
