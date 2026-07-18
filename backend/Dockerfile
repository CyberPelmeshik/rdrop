# Stage 1: build Rust binary (needs nightly for edition 2024)
FROM rustlang/rust:nightly-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

# Stage 2: minimal runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates netcat-openbsd && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/rdrop /usr/local/bin/rdrop
EXPOSE 3000
CMD ["rdrop"]
