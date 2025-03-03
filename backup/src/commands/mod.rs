//! This module implements the command-line API.

use crate::{
    commands::raw::IngressMessage,
    common::{get_agent, AnyhowResult},
};
use anyhow::anyhow;
use clap::Parser;
use std::io::{self, Write};
use tokio::runtime::Runtime;

mod raw;
mod send;

#[derive(Parser)]
pub enum Command {
    Send(send::Opts),
    Raw(raw::Opts),
}

pub fn exec(cmd: Command) -> AnyhowResult {
    let runtime = Runtime::new().expect("Unable to create a runtime");
    match cmd {
        Command::Send(opts) => runtime.block_on(async { send::exec(opts).await }),
        cmd => {
            let agent = runtime.block_on(async { get_agent().await })?;
            match cmd {
                Command::Raw(opts) => raw::exec(agent, opts).and_then(|out| match out {
                    IngressMessage::Ingress(msg) => print(&vec![msg]),
                    IngressMessage::IngressWithRequestId(msg) => print(&vec![msg]),
                }),
                _ => Err(anyhow!("command wrong or PEM file is missing")),
            }
        }
    }
}

// Using println! for printing to STDOUT and piping it to other tools leads to
// the problem that when the other tool closes its stream, the println! macro
// panics on the error and the whole binary crashes. This function provides a
// graceful handling of the error.
fn print<T>(arg: &T) -> AnyhowResult
where
    T: ?Sized + serde::ser::Serialize,
{
    if let Err(e) = io::stdout().write_all(serde_json::to_string(&arg)?.as_bytes()) {
        if e.kind() != std::io::ErrorKind::BrokenPipe {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    }
    Ok(())
}
