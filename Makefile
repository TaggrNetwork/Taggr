start:
	dfx start --background -qqqq

deploy_staging:
	NODE_ENV=production DFX_NETWORK=staging make fe
	FEATURES=staging dfx build
	FEATURES=staging dfx --identity prod deploy --network staging taggr

deploy_local:
	FEATURES=dev dfx deploy

build_dev:
	FEATURES=dev ./build.sh bucket
	FEATURES=dev ./build.sh taggr
	FEATURES=dev dfx build

reinstall:
	make fe
	FEATURES=dev dfx deploy --mode=reinstall taggr -y

build:
	NODE_ENV=production make fe
	./build.sh bucket
	./build.sh taggr

test:
	cargo clippy --tests --benches -- -D clippy::all
	cargo test
	make run e2e_test

fe:
	npm run build --quiet

e2e_build:
	TEST_MODE=true NODE_ENV=production DFX_NETWORK=local npm run build
	FEATURES=dev ./build.sh bucket
	FEATURES=dev ./build.sh taggr

e2e_test:
	npm run install:e2e
	dfx canister create --all
	make e2e_build
	make start || true # don't fail if DFX is already running
	npm run test:e2e
	dfx stop

release:
	docker build -t taggr .
	docker run --rm -v $(shell pwd)/release-artifacts:/target/wasm32-unknown-unknown/release taggr
	make hashes

hashes:
	git rev-parse HEAD
	shasum -a 256 ./release-artifacts/taggr.wasm.gz  | cut -d ' ' -f 1
