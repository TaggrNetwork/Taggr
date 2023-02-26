start:
	dfx start --background --host 127.0.0.1:55554

canisters:
	./build.sh bucket
	./build.sh upgrader
	./build.sh taggr

debug:
	FEATURES=dev dfx build

release:
	npm install
	NODE_ENV=production make fe
	rustup set profile minimal
	rustup toolchain install stable --component rustfmt --component clippy
	rustup override set stable
	make canisters
	cargo test
	# NODE_ENV=production dfx --identity prod deploy --network ic --no-wallet
	shasum -a 256 target/wasm32-unknown-unknown/release/taggr.wasm.gz

fe:
	rm -rf ./dist ./public
	npm run build

dev_reinstall:
	make fe
	FEATURES=dev dfx deploy --mode=reinstall taggr -y
