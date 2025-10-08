FROM python:3.13-slim

LABEL org.opencontainers.image.source="https://github.com/jcarpenter-uam/zoom-translation"

ENV PYTHONUNBUFFERED=1 \
  PIP_NO_CACHE_DIR=off \
  PIP_DISABLE_PIP_VERSION_CHECK=on \
  PIP_DEFAULT_TIMEOUT=100

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

RUN addgroup --system translator && adduser --system --ingroup translator --shell /bin/sh translator

COPY . .

RUN chown -R translator:translator /app

USER translator

EXPOSE 8000

CMD [ "uvicorn", "main:app", "--host", "0.0.0.0" ]
