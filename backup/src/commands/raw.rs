use crate::common::{
    signing::{
        sign_ingress, sign_ingress_with_request_status_query, Ingress, IngressWithRequestId,
    },
    AnyhowResult,
};
use anyhow::anyhow;
use candid::Principal;
use clap::Parser;
use ic_agent::Agent;
use std::path::PathBuf;
use std::str::FromStr;

/// Raw canister call
#[derive(Parser)]
pub struct Opts {
    /// Canister id
    canister_id: Principal,

    /// Canister method
    method: String,

    /// Method arguments as a Candid string
    #[clap(long)]
    args: Option<String>,

    /// Binary file
    #[clap(long)]
    args_file: Option<PathBuf>,

    /// Send a query
    #[clap(long)]
    query: bool,
}

pub enum IngressMessage {
    Ingress(Ingress),
    IngressWithRequestId(IngressWithRequestId),
}

pub fn exec(agent: Agent, opts: Opts) -> AnyhowResult<IngressMessage> {
    let bytes = match (&opts.args, &opts.args_file) {
        (Some(args), None) => candid::IDLArgs::from_str(args)?.to_bytes()?,
        (None, Some(path)) => {
            use std::{
                fs::File,
                io::{BufReader, Read},
            };
            let mut reader = BufReader::new(File::open(path)?);
            let mut buffer = Vec::new();
            reader.read_to_end(&mut buffer)?;
            buffer
        }
        _ => {
            return Err(anyhow!(
                "String args or a file with argument bytes should be specified".to_owned(),
            ))
        }
    };
    if opts.query {
        return Ok(IngressMessage::Ingress(sign_ingress(
            agent,
            opts.canister_id,
            &opts.method,
            true,
            bytes,
        )?));
    }
    Ok(IngressMessage::IngressWithRequestId(
        sign_ingress_with_request_status_query(agent, opts.canister_id, &opts.method, bytes)?,
    ))
}
