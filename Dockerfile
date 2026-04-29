FROM --platform=linux/amd64 docker.io/library/ubuntu:22.04 AS release

ENV NVM_DIR=/root/.nvm
ENV NVM_VERSION=v0.39.1

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo

# Install a basic environment needed for our build tools
RUN apt-get -yq update && \
    apt-get -yqq install --no-install-recommends curl ca-certificates \
        build-essential pkg-config libssl-dev llvm-dev liblmdb-dev clang cmake rsync libunwind-dev jq xz-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js
COPY .node-version ./
RUN curl --fail -sSf https://raw.githubusercontent.com/creationix/nvm/${NVM_VERSION}/install.sh | bash && \
    . "${NVM_DIR}/nvm.sh" && \
    nvm install "$(cat .node-version | xargs)" && \
    nvm use "v$(cat .node-version | xargs)" && \
    nvm alias default "v$(cat .node-version | xargs)" && \
    ln -s "/root/.nvm/versions/node/v$(cat .node-version | xargs)" /root/.nvm/versions/node/default
ENV PATH="/root/.nvm/versions/node/default/bin/:${PATH}"

# Install Rust and Cargo
ENV PATH=/opt/cargo/bin:${PATH}
COPY rust-toolchain.toml ./
RUN curl --fail https://sh.rustup.rs -sSf | sh -s -- -y --no-modify-path

# Install ic-wasm
ENV PATH=/opt/ic-wasm:${PATH}
COPY .ic-wasm-version ./
RUN mkdir -p /opt/ic-wasm && \
    curl -L https://github.com/dfinity/ic-wasm/releases/download/$(cat .ic-wasm-version | xargs)/ic-wasm-x86_64-unknown-linux-gnu.tar.xz \
      | tar -xJ --strip-components=1 -C /opt/ic-wasm ic-wasm-x86_64-unknown-linux-gnu/ic-wasm && \
    chmod +x /opt/ic-wasm/ic-wasm

# Install dfx
ENV HOME=/root
COPY dfx.json ./
RUN DFXVM_INIT_YES=1 DFX_VERSION=$(cat dfx.json | jq -r .dfx) sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"
ENV PATH=${HOME}/.local/share/dfx/bin:${PATH}

# Install NPM dependencies
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENTRYPOINT [ "./release.sh" ]

# CI image: same toolchain as release, plus Playwright (Chromium + system deps)
# and the dfx NNS extension pre-installed so e2e setup needs less network.
FROM release AS ci

RUN npx playwright install chromium --with-deps

RUN dfx extension install nns --version "$(cat .nns-extension-version | xargs)"

ENTRYPOINT [ "./release.sh", "ci" ]
