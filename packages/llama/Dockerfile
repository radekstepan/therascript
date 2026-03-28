FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install llmster (LM Studio headless inference engine)
RUN curl -fsSL https://lmstudio.ai/install.sh | bash

ENV PATH="/root/.lmstudio/bin:${PATH}"

EXPOSE 1234

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
