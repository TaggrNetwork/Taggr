# All pins below are required for a reproducible build. The build aborts loudly
# if a checksum fails; treat any mismatch as a signal that an upstream release
# was re-pushed or the snapshot rotated, and investigate before bumping.

# Base image pinned by digest. Refresh:
#   curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/debian:pull" | grep -oP '"token":"\K[^"]+' \
#     | xargs -I{} curl -sI -H "Authorization: Bearer {}" -H "Accept: application/vnd.oci.image.index.v1+json" \
#       https://registry-1.docker.io/v2/library/debian/manifests/bookworm-slim | grep -i docker-content-digest
FROM docker.io/library/debian:bookworm-slim@sha256:f9c6a2fd2ddbc23e336b6257a5245e31f996953ef06cd13a59fa0a1df2d5c252

ENV NVM_DIR=/root/.nvm
ENV NVM_VERSION=v0.39.1

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo

# Pin apt to a Debian snapshot so toolchain packages are frozen in time.
# snapshot.debian.org serves over HTTP, so no ca-certificates bootstrap is
# needed — apt verifies the Release files via signed metadata.
# Refresh: bump APT_SNAPSHOT_DATE (format: YYYYMMDDTHHMMSSZ). Verify first:
#   curl -sIL http://snapshot.debian.org/archive/debian/<date>/dists/bookworm/Release
ENV APT_SNAPSHOT_DATE=20260430T000000Z
RUN { \
        echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} bookworm main"; \
        echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${APT_SNAPSHOT_DATE} bookworm-security main"; \
        echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} bookworm-updates main"; \
    } > /etc/apt/sources.list && \
    apt-get -yq update && \
    apt-get -yqq install --no-install-recommends curl ca-certificates build-essential jq xz-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js (NVM_VERSION pins the bootstrap; .node-version pins the toolchain)
COPY .node-version ./
RUN curl --fail -sSf https://raw.githubusercontent.com/creationix/nvm/${NVM_VERSION}/install.sh | bash && \
    . "${NVM_DIR}/nvm.sh" && \
    nvm install "$(cat .node-version | xargs)" && \
    nvm use "v$(cat .node-version | xargs)" && \
    nvm alias default "v$(cat .node-version | xargs)" && \
    ln -s "/root/.nvm/versions/node/v$(cat .node-version | xargs)" /root/.nvm/versions/node/default
ENV PATH="/root/.nvm/versions/node/default/bin/:${PATH}"

# Install Rust (rustc/cargo pinned via rust-toolchain.toml; the wrapper script
# only bootstraps the pinned toolchain so it isn't itself reproducibility-critical)
ENV PATH=/opt/cargo/bin:${PATH}
COPY rust-toolchain.toml ./
RUN curl --fail https://sh.rustup.rs -sSf | sh -s -- -y --no-modify-path

# Install ic-wasm (binary release pinned by sha256). Refresh:
#   curl -sL https://github.com/dfinity/ic-wasm/releases/download/$(cat .ic-wasm-version | xargs)/ic-wasm-x86_64-unknown-linux-gnu.tar.xz | sha256sum
ENV PATH=/opt/ic-wasm:${PATH}
COPY .ic-wasm-version ./
ENV IC_WASM_SHA256=5aeea4ada46748a4b69e6d97d934074a64c45da4272882412103cce110aaf86b
RUN mkdir -p /opt/ic-wasm && \
    curl --fail -L \
        "https://github.com/dfinity/ic-wasm/releases/download/$(cat .ic-wasm-version | xargs)/ic-wasm-x86_64-unknown-linux-gnu.tar.xz" \
        -o /tmp/ic-wasm.tar.xz && \
    echo "${IC_WASM_SHA256}  /tmp/ic-wasm.tar.xz" | sha256sum -c - && \
    tar -xJf /tmp/ic-wasm.tar.xz --strip-components=1 -C /opt/ic-wasm ic-wasm-x86_64-unknown-linux-gnu/ic-wasm && \
    chmod +x /opt/ic-wasm/ic-wasm && \
    rm /tmp/ic-wasm.tar.xz

# Install dfx (dfx version pinned via dfx.json)
ENV HOME=/root
COPY dfx.json ./
RUN DFXVM_INIT_YES=1 DFX_VERSION=$(cat dfx.json | jq -r .dfx) sh -c "$(curl -fsSL https://internetcomputer.org/install.sh)"
ENV PATH=${HOME}/.local/share/dfx/bin:${PATH}

# Install NPM dependencies (lock file enforces a deterministic tree)
COPY package.json package-lock.json ./
RUN npm ci

# Test deps: Playwright (Chromium + system libs) for the e2e step.
# Not reproducibility-critical — chromium bytes don't end up in taggr.wasm.gz.
# Installed before `COPY . .` so source edits don't invalidate the ~150 MB
# chromium layer; only the lock file or playwright version bump retriggers it.
RUN npx playwright install chromium --with-deps

COPY . .

ENTRYPOINT [ "./release.sh" ]
