FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone https://github.com/ggml-org/llama.cpp.git .

RUN mkdir build && cd build && \
    cmake .. -DGGML_NATIVE=OFF -DCMAKE_CXX_FLAGS="-march=armv8-a" -DCMAKE_C_FLAGS="-march=armv8-a" && \
    cmake --build . --config Release --target llama-server -j $(nproc)

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary and all shared libraries built alongside it
COPY --from=builder /app/build/bin/ /usr/local/bin/
RUN ldconfig /usr/local/bin

ENTRYPOINT ["llama-server"]
