FROM python:3.13-slim

LABEL org.opencontainers.image.source="https://github.com/jcarpenter-uam/calc-translation"

ENV PYTHONUNBUFFERED=1 \
  PIP_NO_CACHE_DIR=off \
  PIP_DISABLE_PIP_VERSION_CHECK=on \
  PIP_DEFAULT_TIMEOUT=100

WORKDIR /app

COPY requirements.txt .
RUN pip install --extra-index-url https://test.pypi.org/simple/ -r requirements.txt

ENV LD_LIBRARY_PATH="/usr/local/lib/python3.13/site-packages/rtms:${LD_LIBRARY_PATH}"

RUN addgroup --system zoom-rtms && adduser --system --ingroup zoom-rtms --shell /bin/sh zoom-rtms

COPY ./server.py ./
COPY ./worker.py ./

RUN chown -R zoom-rtms:zoom-rtms /app

USER zoom-rtms

EXPOSE 8080

CMD ["python", "server.py"]
