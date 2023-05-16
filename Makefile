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
	npm install --quiet
	NODE_ENV=production make fe
	./build.sh bucket
	./build.sh taggr

test:
	cargo clippy --tests --benches -- -D clippy::all
	cargo test

fe:
	rm -rf ./dist ./public
	npm run build --quiet

e2e_test:
	npm run install:e2e
	make build
	make start || true # don't fail if DFX is already running
	make dev_deploy
	npm run test:e2e
	dfx stop

release:
	docker build -t taggr .
	docker run --rm -v $(shell pwd)/release-artifacts:/target/wasm32-unknown-unknown/release taggr
	shasum -a 256 ./release-artifacts/taggr.wasm.gz
	git rev-parse HEAD
