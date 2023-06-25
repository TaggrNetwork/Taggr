start:
	dfx start --background --host 127.0.0.1:55554 -qqqq

dev_deploy:
	FEATURES=dev dfx deploy

dev_build:
	FEATURES=dev dfx build

dev_reinstall:
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

e2e_test:
	npm run install:e2e
	dfx canister create --all
	TEST_MODE=true npm run build
	./build.sh bucket
	./build.sh taggr
	make start || true # don't fail if DFX is already running
	make dev_deploy
	npm run test:e2e
	dfx stop

release:
	docker build -t taggr .
	docker run --rm -v $(shell pwd)/release-artifacts:/target/wasm32-unknown-unknown/release taggr

hashes:
	git rev-parse HEAD
	shasum -a 256 ./release-artifacts/taggr.wasm.gz  | cut -d ' ' -f 1
