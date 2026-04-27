start:
	ulimit -n 65000 && dfx start --background -qqqq 2>&1 | grep -v sgymv &

cycles:
	dfx --identity local-minter ledger fabricate-cycles --all --cycles 1000000000000000

staging_deploy:
	NODE_ENV=production DFX_NETWORK=$(if $(CANISTER),$(CANISTER),staging) make fe
	DFX_NETWORK=$(if $(CANISTER),$(CANISTER),staging) FEATURES=staging dfx build
	FEATURES=staging dfx --identity prod deploy --network $(if $(CANISTER),$(CANISTER),staging) taggr

local_deploy:
	FEATURES=dev dfx deploy

dev_build:
	FEATURES=dev ./build.sh bucket
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
	npx prettier --check src/frontend/

format:
	cargo fmt
	npx prettier --write src/frontend/

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
	FEATURES=dev ./build.sh taggr

e2e_test:
	npm run install:e2e
	dfx canister create --all
	make e2e_build
	make start || true # don't fail if DFX is already running
	npm run test:e2e
	dfx stop

podman_machine:
	podman machine stop || true
	podman machine rm -f || true
	CONTAINERS_MACHINE_PROVIDER=qemu podman machine init --cpus 4 --memory 4096 --now

release:
	$(if $(PODMAN),podman,docker) build -t taggr .
	mkdir -p $(shell pwd)/release-artifacts
	$(if $(PODMAN),podman,docker) run --rm -v $(shell pwd)/release-artifacts:/target/wasm32-unknown-unknown/release taggr
	make hashes

hashes:
	git rev-parse HEAD
	shasum -a 256 $(shell pwd)/release-artifacts/taggr.wasm.gz  | cut -d ' ' -f 1

backup:
	cd backup && cargo build --release
	./backup.sh $(DIR)

.PHONY: backup


