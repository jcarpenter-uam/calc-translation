FROM node:24-slim

RUN addgroup -S node && adduser -S -G node node

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

RUN chown -R node:node /app

USER node

EXPOSE 4173

CMD [ "npm", "run", "preview" ]
