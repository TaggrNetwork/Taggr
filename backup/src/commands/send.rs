use crate::common::{
    read_from_file, request_status, send_ingress,
    signing::{Ingress, IngressWithRequestId},
    AnyhowResult, IngressResult,
};
use anyhow::anyhow;
use clap::Parser;

/// Sends a signed message or a set of messages.
#[derive(Parser)]
pub struct Opts {
    /// Path to the signed message
    file_name: String,

    /// Skips confirmation and sends the message directly.
    #[clap(long)]
    yes: bool,
}

pub async fn exec(opts: Opts) -> AnyhowResult {
    let json = read_from_file(&opts.file_name)?;
    if let Ok(val) = serde_json::from_str::<Ingress>(&json) {
        send(&val, &opts).await?;
    } else if let Ok(vals) = serde_json::from_str::<Vec<Ingress>>(&json) {
        for msg in vals {
            send(&msg, &opts).await?;
        }
    } else if let Ok(vals) = serde_json::from_str::<Vec<IngressWithRequestId>>(&json) {
        for tx in vals {
            submit_ingress_and_check_status(&tx, &opts).await?;
        }
    } else {
        return Err(anyhow!("Invalid JSON content"));
    }
    Ok(())
}

async fn submit_ingress_and_check_status(
    message: &IngressWithRequestId,
    opts: &Opts,
) -> AnyhowResult {
    send(&message.ingress, opts).await?;
    match request_status::submit(&message.request_status).await {
        Ok(blob) => {
            use std::io::Write;
            let mut out = std::io::stdout();
            out.write_all(&blob)?;
            out.flush()?;
        }
        Err(err) => println!("{}\n", err),
    };
    Ok(())
}

async fn send(message: &Ingress, opts: &Opts) -> AnyhowResult {
    if message.call_type == "update" && !opts.yes {
        println!("\nDo you want to send this message? [y/N]");
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        if !["y", "yes"].contains(&input.to_lowercase().trim()) {
            std::process::exit(0);
        }
    }

    if let IngressResult::QueryResponse(response) = send_ingress(message).await? {
        write_to_stdout(&response)?;
    }
    Ok(())
}

fn write_to_stdout(blob: &[u8]) -> AnyhowResult {
    use std::io::Write;
    let mut out = std::io::stdout();
    out.write_all(blob)?;
    out.flush()?;
    Ok(())
}
