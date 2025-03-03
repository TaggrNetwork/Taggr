#![warn(unused_extern_crates)]
mod commands;
mod common;
use clap::Parser;

#[derive(Parser)]
#[clap(name("backup"))]
pub struct CliOpts {
    #[clap(subcommand)]
    command: commands::Command,
}

fn main() {
    let opts = CliOpts::parse();
    let command = opts.command;
    if let Err(err) = commands::exec(command) {
        eprintln!("{}", err);
        std::process::exit(1);
    }
}
