FROM ubuntu:22.04

ENV NVM_DIR=/root/.nvm
ENV NVM_VERSION=v0.39.1
ENV NODE_VERSION=16.9.0

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo
ENV RUST_VERSION=1.67.1
ENV IC_CDK_OPTIMIZER_VERSION=0.3.5

ENV DFX_VERSION=0.12.1

# Install a basic environment needed for our build tools
RUN apt -yq update && \
    apt -yqq install --no-install-recommends curl ca-certificates \
        build-essential pkg-config libssl-dev llvm-dev liblmdb-dev clang cmake rsync

# Install Node.js using nvm
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin:${PATH}"
RUN curl --fail -sSf https://raw.githubusercontent.com/creationix/nvm/${NVM_VERSION}/install.sh | bash
RUN . "${NVM_DIR}/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "${NVM_DIR}/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "${NVM_DIR}/nvm.sh" && nvm alias default v${NODE_VERSION}

# Install Rust and Cargo
ENV PATH=/opt/cargo/bin:${PATH}
RUN curl --fail https://sh.rustup.rs -sSf \
        | sh -s -- -y --default-toolchain ${RUST_VERSION}-x86_64-unknown-linux-gnu --no-modify-path && \
    rustup default ${RUST_VERSION}-x86_64-unknown-linux-gnu && \
    rustup target add wasm32-unknown-unknown
RUN cargo install --version ${IC_CDK_OPTIMIZER_VERSION} ic-cdk-optimizer

# Install dfx
RUN sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"

COPY . /canister
WORKDIR /canister
RUN make build
