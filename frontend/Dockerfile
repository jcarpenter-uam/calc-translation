FROM node:24-slim

LABEL org.opencontainers.image.source="https://github.com/jcarpenter-uam/zoom-translation"

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

RUN chown -R node:node /app

USER node

EXPOSE 4173

CMD [ "npm", "run", "preview" ]
