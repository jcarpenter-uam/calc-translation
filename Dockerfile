# Stage 1: Build the Vite frontend
FROM node:24-slim AS builder

WORKDIR /app/web

COPY clients/web/package*.json ./

RUN npm install

COPY clients/web/ ./

RUN npm run build

# Stage 2: Run the python app
FROM python:3.13-slim

LABEL org.opencontainers.image.source="https://github.com/jcarpenter-uam/calc-translation"

ENV PYTHONUNBUFFERED=1 \
  PIP_NO_CACHE_DIR=off \
  PIP_DISABLE_PIP_VERSION_CHECK=on \
  PIP_DEFAULT_TIMEOUT=100

WORKDIR /app

COPY server/requirements.txt ./
RUN pip install -r requirements.txt

RUN addgroup --system calc-translator && adduser --system --ingroup calc-translator --shell /bin/sh calc-translator

COPY --from=builder /app/web/dist ./web/dist

# Explicialy copy files into container
# Removes need for .dockerignore
COPY server/main.py ./
COPY server/core ./core/
COPY server/api ./api/
COPY server/auth ./auth/
COPY server/integrations ./integrations/
COPY server/services ./services/
RUN mkdir -p /app/logs
RUN mkdir -p /app/output

RUN chown -R calc-translator:calc-translator /app

USER calc-translator

EXPOSE 8000

CMD [ "uvicorn", "main:app", "--host", "0.0.0.0" ]
