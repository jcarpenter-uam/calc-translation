FROM node:24-slim

LABEL org.opencontainers.image.source="https://github.com/jcarpenter-uam/zoom-translation"

WORKDIR /app

COPY package*.json ./

USER root

RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 && \
  rm -rf /var/lib/apt/lists/*

RUN npm install

COPY . .

RUN chown -R node:node /app

USER node

EXPOSE 8080

CMD [ "node", "index.js" ]
