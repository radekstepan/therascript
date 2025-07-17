FROM vllm/vllm-openai:latest

# Authenticate with Hugging Face Hub
ARG HUGGING_FACE_HUB_TOKEN
ENV HUGGING_FACE_HUB_TOKEN=${HUGGING_FACE_HUB_TOKEN}
RUN pip install --no-cache-dir huggingface-hub && \
    huggingface-cli login --token $HUGGING_FACE_HUB_TOKEN

# Install mistral_common for Voxtral support
RUN pip install --no-cache-dir "mistral_common[audio]>=1.8.1"

EXPOSE 8000

ENTRYPOINT []
CMD []
