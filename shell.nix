{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.podman
    pkgs.gnumake
    pkgs.cargo
    pkgs.rustc
    pkgs.rustfmt
    pkgs.gcc
    pkgs.nodejs
  ];

  # Bypass the repo's rust-toolchain.toml so the nixpkgs-pinned
  # cargo/rustc are used instead of trying to invoke rustup.
  shellHook = ''
    export RUSTUP_TOOLCHAIN=
    exec zsh
  '';
}
