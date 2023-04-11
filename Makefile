start:
	dfx start --background --host 127.0.0.1:55554

dev_deploy:
	FEATURES=dev dfx deploy

dev_build:
	FEATURES=dev dfx build

dev_reinstall:
	make fe
	FEATURES=dev dfx deploy --mode=reinstall taggr -y

build:
	npm install
	NODE_ENV=production make fe
	./build.sh bucket
	./build.sh taggr
	cargo clippy --tests --benches -- -D clippy::all
	cargo test
	shasum -a 256 target/wasm32-unknown-unknown/release/taggr.wasm.gz

fe:
	rm -rf ./dist ./public
	npm run build

release:
	docker build -t taggr .
	docker run --rm --entrypoint cat taggr /target/wasm32-unknown-unknown/release/taggr.wasm.gz > release.wasm.gz
	shasum -a 256 release.wasm.gz
	git rev-parse HEAD
