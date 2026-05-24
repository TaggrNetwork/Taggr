# Prefer podman if installed, else fall back to docker. Override with CONTAINER=docker.
CONTAINER ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)
HOST_ARCH := $(shell uname -m)
DOCKER_ARCH := $(patsubst x86_64,amd64,$(patsubst aarch64,arm64,$(HOST_ARCH)))
TEST_PLATFORM ?= linux/$(DOCKER_ARCH)

start:
	ulimit -n 65000 && dfx start --background -qqqq &

cycles:
	dfx --identity local-minter ledger fabricate-cycles --all --cycles 1000000000000000

staging_deploy:
	NODE_ENV=production DFX_NETWORK=$(if $(CANISTER),$(CANISTER),staging) make fe
	DFX_NETWORK=$(if $(CANISTER),$(CANISTER),staging) FEATURES=staging dfx build
	FEATURES=staging dfx --identity prod deploy --network $(if $(CANISTER),$(CANISTER),staging) taggr

local_deploy:
	FEATURES=dev dfx deploy taggr
	dfx deploy cmc_stub
	dfx ledger fabricate-cycles --canister cmc_stub --t 100

dev_build:
	FEATURES=dev ./build.sh bucket
	FEATURES=dev ./build.sh cmc_stub
	FEATURES=dev ./build.sh taggr
	FEATURES=dev dfx build

local_reinstall:
	make fe
	FEATURES=dev dfx deploy --mode=reinstall taggr -y

build:
	NODE_ENV=production make fe
	./build.sh bucket
	./build.sh taggr

check:
	cargo check --tests
	cargo fmt --check
	npx tsc --noEmit
	npm run format:check

format:
	cargo fmt
	npm run format

test:
	make e2e_build
	make local_deploy
	cargo clippy --tests --benches -- -D clippy::all
	cargo test -- --test-threads 1
	npm run test:e2e

fe:
	npm run build --quiet

frontend_bundle:
	NODE_ENV=production DFX_NETWORK=ic ./node_modules/.bin/webpack
	@echo ""
	@echo "Bundle built at dist/frontend/ (uncompressed, path-relative)."

e2e_build:
	NODE_ENV=production DFX_NETWORK=local npm run build
	./build.sh bucket
	./build.sh cmc_stub
	FEATURES=dev ./build.sh taggr

e2e_test:
	npm run install:e2e
	dfx canister create --all
	./e2e/import_local_minter.sh
	./e2e/install_icp_ledger.sh
	make e2e_build
	make start || true # don't fail if DFX is already running
	npm run test:e2e
	dfx stop

podman_machine:
ifeq ($(shell uname),Darwin)
	podman machine stop || true
	podman machine rm -f || true
	podman machine init --cpus 4 --memory 8192
	podman machine start
else
	@echo "podman runs natively on Linux — no machine needed"
endif

tests:
	mkdir -p $(shell pwd)/test-results $(shell pwd)/playwright-report
	$(CONTAINER) build --platform=$(TEST_PLATFORM) $(if $(VERBOSE),,--quiet) -t taggr-tests .
	$(CONTAINER) run --rm \
		--platform=$(TEST_PLATFORM) \
		--shm-size=1g \
		$(if $(VERBOSE),-e VERBOSE=1) \
		-v $(shell pwd)/test-results:/app/test-results \
		-v $(shell pwd)/playwright-report:/app/playwright-report \
		taggr-tests tests

release:
	mkdir -p $(shell pwd)/release-artifacts $(shell pwd)/test-results $(shell pwd)/playwright-report
ifeq ($(DOCKER_ARCH),amd64)
	# Single-container: tests warm target/, then run_release reuses it.
	$(CONTAINER) build --platform=linux/amd64 $(if $(VERBOSE),,--quiet) -t taggr-release .
	$(CONTAINER) run --rm \
		--platform=linux/amd64 \
		--shm-size=1g \
		$(if $(VERBOSE),-e VERBOSE=1) \
		-e RELEASE_ARTIFACT_DIR=/app/release-artifacts \
		-v $(shell pwd)/release-artifacts:/app/release-artifacts \
		-v $(shell pwd)/test-results:/app/test-results \
		-v $(shell pwd)/playwright-report:/app/playwright-report \
		taggr-release release
else
	# Split: host-native tests (dfx/PocketIC don't tolerate qemu), then
	# amd64 artifact stage with prime_release_target.
	$(CONTAINER) build --platform=$(TEST_PLATFORM) $(if $(VERBOSE),,--quiet) -t taggr-tests .
	$(CONTAINER) run --rm \
		--platform=$(TEST_PLATFORM) \
		--shm-size=1g \
		$(if $(VERBOSE),-e VERBOSE=1) \
		-v $(shell pwd)/test-results:/app/test-results \
		-v $(shell pwd)/playwright-report:/app/playwright-report \
		taggr-tests tests
	$(CONTAINER) build --platform=linux/amd64 $(if $(VERBOSE),,--quiet) -t taggr-release .
	$(CONTAINER) run --rm \
		--platform=linux/amd64 \
		$(if $(VERBOSE),-e VERBOSE=1) \
		-e RELEASE_ARTIFACT_DIR=/app/release-artifacts \
		-v $(shell pwd)/release-artifacts:/app/release-artifacts \
		taggr-release artifact
endif
	make hashes

hashes:
	git rev-parse HEAD
	shasum -a 256 $(shell pwd)/release-artifacts/taggr.wasm.gz  | cut -d ' ' -f 1

backup:
	cd backup && cargo build --release
	./backup.sh $(DIR)

.PHONY: backup
