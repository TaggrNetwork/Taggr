# All pins below are required for a reproducible build. The build aborts loudly
# if a checksum fails; treat any mismatch as a signal that an upstream release
# was re-pushed or the snapshot rotated, and investigate before bumping.

# Base image pinned by digest. Refresh:
#   curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/debian:pull" | grep -oP '"token":"\K[^"]+' \
#     | xargs -I{} curl -sI -H "Authorization: Bearer {}" -H "Accept: application/vnd.oci.image.index.v1+json" \
#       https://registry-1.docker.io/v2/library/debian/manifests/trixie-slim | grep -i docker-content-digest
FROM docker.io/library/debian:trixie-slim@sha256:cedb1ef40439206b673ee8b33a46a03a0c9fa90bf3732f54704f99cb061d2c5a

ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo

# Reproducibility hardening: strip build paths so file!()/panic strings don't
# embed host-specific paths, and force-off incremental (default for release,
# but explicit guards against env overrides).
ENV CARGO_INCREMENTAL=0
ENV RUSTFLAGS="--remap-path-prefix=/app=. --remap-path-prefix=/opt/cargo=cargo-home"

# Pin apt to a Debian snapshot so toolchain packages are frozen in time.
# snapshot.debian.org serves over HTTP, so no ca-certificates bootstrap is
# needed — apt verifies the Release files via signed metadata.
# Refresh: bump APT_SNAPSHOT_DATE (format: YYYYMMDDTHHMMSSZ). Verify first:
#   curl -sIL http://snapshot.debian.org/archive/debian/<date>/dists/trixie/Release
ENV APT_SNAPSHOT_DATE=20260503T000000Z
RUN { \
        echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} trixie main"; \
        echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${APT_SNAPSHOT_DATE} trixie-security main"; \
        echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} trixie-updates main"; \
    } > /etc/apt/sources.list && \
    apt-get -yq update && \
    apt-get -yqq install --no-install-recommends curl ca-certificates build-essential jq xz-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Automatic platform ARG (populated by BuildKit per --platform); consumed by
# every arch-specific download below.
ARG TARGETARCH

# Install Node.js (version pinned by .node-version; tarball pinned by sha256 per
# arch). Refresh:
#   curl -s https://nodejs.org/dist/v$(cat .node-version)/SHASUMS256.txt | grep -E 'linux-(x64|arm64)\.tar\.xz'
ENV PATH=/opt/node/bin:${PATH}
COPY .node-version ./
RUN NODE_VERSION="$(cat .node-version | xargs)" && \
    case "${TARGETARCH:-$(uname -m)}" in \
        amd64|x86_64) NODE_ARCH=x64; NODE_SHA256=f52ec50e959d72d5c680d9731420b2661cd2a8070e94c7369b6ddfcd8b7278be ;; \
        arm64|aarch64) NODE_ARCH=arm64; NODE_SHA256=5a5b1dc4906e891a655d2f0689db664879724f2d9e63309486fd588172a052bc ;; \
        *) echo "Unsupported arch for node: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl --fail -L "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz && \
    echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - && \
    mkdir -p /opt/node && \
    tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node && \
    rm /tmp/node.tar.xz

# Install Rust (rustup-init pinned by version + sha256 per arch; rustc/cargo plus
# the components/target are pinned via rust-toolchain.toml and installed eagerly
# below so they land in this layer). Refresh:
#   curl -s https://static.rust-lang.org/rustup/release-stable.toml          # RUSTUP_VERSION
#   curl -s https://static.rust-lang.org/rustup/archive/<ver>/<triple>/rustup-init.sha256
ENV PATH=/opt/cargo/bin:${PATH}
ENV RUSTUP_VERSION=1.29.0
COPY rust-toolchain.toml ./
RUN case "${TARGETARCH:-$(uname -m)}" in \
        amd64|x86_64) RUSTUP_TRIPLE=x86_64-unknown-linux-gnu; RUSTUP_SHA256=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10 ;; \
        arm64|aarch64) RUSTUP_TRIPLE=aarch64-unknown-linux-gnu; RUSTUP_SHA256=9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792 ;; \
        *) echo "Unsupported arch for rustup: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl --fail -L "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${RUSTUP_TRIPLE}/rustup-init" -o /tmp/rustup-init && \
    echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum -c - && \
    chmod +x /tmp/rustup-init && \
    /tmp/rustup-init -y --no-modify-path --default-toolchain none && \
    rm /tmp/rustup-init && \
    rustc --version

# Install ic-wasm (binary release pinned by sha256 for each supported arch). Refresh:
#   curl -sL https://github.com/dfinity/ic-wasm/releases/download/$(cat .ic-wasm-version | xargs)/sha256.sum
ENV PATH=/opt/ic-wasm:${PATH}
COPY .ic-wasm-version ./
RUN mkdir -p /opt/ic-wasm && \
    ARCH="${TARGETARCH:-$(uname -m)}" && \
    case "${ARCH}" in \
        amd64|x86_64) IC_WASM_TRIPLE=x86_64-unknown-linux-gnu; IC_WASM_SHA256=5aeea4ada46748a4b69e6d97d934074a64c45da4272882412103cce110aaf86b ;; \
        arm64|aarch64) IC_WASM_TRIPLE=aarch64-unknown-linux-gnu; IC_WASM_SHA256=56f150be3e413f9637df4b4fa41950c79d39cf738969be0231bfae37ac4f3b1a ;; \
        *) echo "Unsupported Docker target arch: ${ARCH}" >&2; exit 1 ;; \
    esac && \
    curl --fail -L \
        "https://github.com/dfinity/ic-wasm/releases/download/$(cat .ic-wasm-version | xargs)/ic-wasm-${IC_WASM_TRIPLE}.tar.xz" \
        -o /tmp/ic-wasm.tar.xz && \
    echo "${IC_WASM_SHA256}  /tmp/ic-wasm.tar.xz" | sha256sum -c - && \
    tar -xJf /tmp/ic-wasm.tar.xz --strip-components=1 -C /opt/ic-wasm "ic-wasm-${IC_WASM_TRIPLE}/ic-wasm" && \
    chmod +x /opt/ic-wasm/ic-wasm && \
    rm /tmp/ic-wasm.tar.xz

# Install dfx (version pinned via dfx.json; release tarball pinned by sha256 per
# arch). Refresh:
#   curl -sL https://github.com/dfinity/sdk/releases/download/<ver>/dfx-<ver>-<triple>.tar.gz.sha256
ENV HOME=/root
ENV PATH=${HOME}/.local/share/dfx/bin:${PATH}
COPY dfx.json ./
RUN DFX_VERSION="$(jq -r .dfx dfx.json)" && \
    case "${TARGETARCH:-$(uname -m)}" in \
        amd64|x86_64) DFX_TRIPLE=x86_64-linux; DFX_SHA256=218dad11e0519e11c7a310b5c7cb1eadff109bb5db1ea3432f08c870432a80fc ;; \
        arm64|aarch64) DFX_TRIPLE=aarch64-linux; DFX_SHA256=46e21e0e41a0e3d321f9f125851650205e0e38e4cf8ca98eeaea258074dafa89 ;; \
        *) echo "Unsupported arch for dfx: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    curl --fail -L "https://github.com/dfinity/sdk/releases/download/${DFX_VERSION}/dfx-${DFX_VERSION}-${DFX_TRIPLE}.tar.gz" -o /tmp/dfx.tar.gz && \
    echo "${DFX_SHA256}  /tmp/dfx.tar.gz" | sha256sum -c - && \
    mkdir -p ${HOME}/.local/share/dfx/bin && \
    tar -xzf /tmp/dfx.tar.gz -C ${HOME}/.local/share/dfx/bin && \
    chmod +x ${HOME}/.local/share/dfx/bin/dfx && \
    rm /tmp/dfx.tar.gz

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
