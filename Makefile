start:
	dfx start --background -qqqq 2> /dev/null

staging_deploy:
	NODE_ENV=production DFX_NETWORK=staging make fe
	FEATURES=staging dfx build
	FEATURES=staging dfx --identity prod deploy --network staging taggr

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

test:
	make e2e_build
	make local_deploy
	cargo clippy --tests --benches -- -D clippy::all
	POCKET_IC_MUTE_SERVER=true cargo test
	npm run test:e2e

pocket_ic:
	cd tests && ./download-pocket-ic.sh

fe:
	npm run build --quiet

e2e_build:
	NODE_ENV=production DFX_NETWORK=local npm run build
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
