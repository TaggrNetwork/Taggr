FROM --platform=linux/amd64 ubuntu:22.04

ENV NVM_DIR=/root/.nvm
ENV NVM_VERSION=v0.39.1

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo

# Install a basic environment needed for our build tools
RUN apt -yq update && \
    apt -yqq install --no-install-recommends curl ca-certificates \
        build-essential pkg-config libssl-dev llvm-dev liblmdb-dev clang cmake rsync libunwind-dev jq

# Install Node.js
COPY .node-version ./
RUN curl --fail -sSf https://raw.githubusercontent.com/creationix/nvm/${NVM_VERSION}/install.sh | bash
RUN . "${NVM_DIR}/nvm.sh" && nvm install "$(cat .node-version | xargs)"
RUN . "${NVM_DIR}/nvm.sh" && nvm use "v$(cat .node-version | xargs)"
RUN . "${NVM_DIR}/nvm.sh" && nvm alias default "v$(cat .node-version | xargs)"
RUN ln -s "/root/.nvm/versions/node/v$(cat .node-version | xargs)" /root/.nvm/versions/node/default
ENV PATH="/root/.nvm/versions/node/default/bin/:${PATH}"

# Install Rust and Cargo
ENV PATH=/opt/cargo/bin:${PATH}
COPY rust-toolchain.toml ./
RUN curl --fail https://sh.rustup.rs -sSf | sh -s -- -y --no-modify-path

# Install ic-wasm
ENV PATH=/opt/ic-wasm:${PATH}
COPY .ic-wasm-version ./
RUN mkdir -p /opt/ic-wasm && \
    curl -L https://github.com/dfinity/ic-wasm/releases/download/$(cat .ic-wasm-version | xargs)/ic-wasm-linux64 -o /opt/ic-wasm/ic-wasm && \
    chmod +x /opt/ic-wasm/ic-wasm

# Install dfx
COPY dfx.json ./
RUN DFX_VERSION=$(cat dfx.json | jq -r .dfx) sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"

# Install NPM dependencies
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build
RUN make build

ENTRYPOINT [ "./release.sh" ]
