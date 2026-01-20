FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    python3-pip \
    supervisor \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY packages/whisper/requirements.txt ./

RUN pip3 install --upgrade pip --break-system-packages

ARG TORCH_INDEX_URL="https://download.pytorch.org/whl/nightly/cu128"
ARG TORCH_FLAGS="--pre"

RUN echo "Installing PyTorch from ${TORCH_INDEX_URL} (flags: '${TORCH_FLAGS}')" \
    && pip3 install ${TORCH_FLAGS} torch torchvision torchaudio --index-url ${TORCH_INDEX_URL} --break-system-packages

RUN pip3 install -r requirements.txt --break-system-packages

COPY packages/whisper/package.json ./
COPY yarn.lock ./

RUN yarn install --production --frozen-lockfile

COPY packages/whisper/. .

RUN mkdir -p /app/temp_inputs /app/temp_outputs

ENV PYTHONUNBUFFERED=1

COPY packages/whisper/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8000 8001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
