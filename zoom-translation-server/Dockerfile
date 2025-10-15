# Stage 1: Build the Vite frontend
FROM node:24-slim AS builder

WORKDIR /app/web

COPY web/package*.json ./

RUN npm install

COPY web/ ./

RUN npm run build

# Stage 2: Run the python app
FROM python:3.13-slim

LABEL org.opencontainers.image.source="https://github.com/jcarpenter-uam/zoom-translation"

ENV PYTHONUNBUFFERED=1 \
  PIP_NO_CACHE_DIR=off \
  PIP_DISABLE_PIP_VERSION_CHECK=on \
  PIP_DEFAULT_TIMEOUT=100

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

RUN addgroup --system zoom-translator && adduser --system --ingroup zoom-translator --shell /bin/sh zoom-translator

COPY . .

RUN chown -R zoom-translator:zoom-translator /app

USER zoom-translator

EXPOSE 8000

CMD [ "uvicorn", "main:app", "--host", "0.0.0.0" ]
