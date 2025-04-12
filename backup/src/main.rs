use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use candid::{Decode, Encode};
use ic_agent::export::Principal;
use ic_agent::Agent;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

const MAINNET_URL: &str = "https://ic0.app";
const LOCAL_URL: &str = "http://localhost:8080";
const FETCH_PAGE_DELAY: Duration = Duration::from_secs(1);

enum Command {
    Backup,
    Restore,
}

struct Args {
    dir: PathBuf,
    command: Command,
    canister_id: Principal,
    start_page: u64,
}

async fn backup(
    Args {
        dir,
        command: _,
        canister_id,
        start_page,
    }: Args,
) -> Result<(), String> {
    let agent = Agent::builder()
        .with_url(MAINNET_URL)
        .build()
        .map_err(|e| e.to_string())?;

    let dir = dir.as_path();
    let mut page: u64 = start_page;
    loop {
        let response = agent
            .query(&canister_id, "stable_mem_read")
            .with_arg(Encode!(&page).map_err(|e| e.to_string())?)
            .await
            .map_err(|e| e.to_string())?;
        let result =
            Decode!(response.as_slice(), Vec<(u64, Vec<u8>)>).map_err(|e| e.to_string())?;
        if result.is_empty() {
            break;
        }
        let mut file = File::create(dir.join(format!("page{}.bin", page)))
            .await
            .map_err(|e| e.to_string())?;
        file.write_all(&result[0].1)
            .await
            .map_err(|e| e.to_string())?;
        println!("Fetched page {}", page);
        tokio::time::sleep(FETCH_PAGE_DELAY).await;
        page += 1;
    }
    Ok(())
}

async fn restore(
    Args {
        command: _,
        dir,
        canister_id,
        start_page,
    }: Args,
) -> Result<(), String> {
    let agent = Agent::builder()
        .with_url(LOCAL_URL)
        .build()
        .map_err(|e| e.to_string())?;

    agent.fetch_root_key().await.map_err(|e| e.to_string())?;

    let dir = dir.as_path();
    let mut page: u64 = start_page;
    let mut files = Vec::new();
    loop {
        let filename = dir.join(format!("page{}.bin", page));
        if !filename.exists() {
            break;
        }
        files.push(filename);
        page += 1;
    }

    use futures::future::join_all;

    let agent = Arc::new(agent);

    // Process files in batches of 10
    for chunk in files.chunks(10) {
        let tasks = chunk
            .iter()
            .map(|filename| {
                let canister_id_clone = canister_id.clone();
                let agent = agent.clone();
                let filename = filename.clone();

                tokio::spawn(async move {
                    let buffer = std::fs::read(&filename).map_err(|e| e.to_string())?;
                    let arg = vec![(page, buffer)];

                    agent
                        .update(&canister_id_clone, "stable_mem_write")
                        .with_arg(Encode!(&arg).map_err(|e| e.to_string())?)
                        .await
                        .map_err(|e| e.to_string())?;

                    println!("Restored page {:?}", filename);
                    Ok::<_, String>(())
                })
            })
            .collect::<Vec<_>>();

        let results = join_all(tasks).await;

        for result in results {
            match result {
                Ok(inner_result) => inner_result?,
                Err(e) => return Err(format!("Task join error: {}", e)),
            }
        }
    }

    Ok(())
}

fn parse_args() -> Result<Args, String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        let err = format!(
            "Usage: {} <directory> (backup|restore) <taggr-canister-id> [start page]",
            args[0]
        );
        return Err(err);
    }
    let dir = &args[1];
    let command = &args[2];
    let canister_id = &args[3];
    let start_page = args.get(4).cloned();

    let command = if command == "backup" {
        Command::Backup
    } else if command == "restore" {
        Command::Restore
    } else {
        let err = format!(
            "the command should be either 'backup' or 'restore', not {}",
            command
        );
        return Err(err);
    };

    let dst = Path::new(dir);

    if !dst.is_dir() {
        let err = format!("the directory doesn't exist: {}", dir);
        return Err(err);
    }

    let canister_id = Principal::from_text(canister_id).map_err(|e| e.to_string())?;

    let start_page = start_page
        .map(|s| {
            s.parse::<u64>()
                .map_err(|e| format!("the start page argument is not a number: {}", e))
        })
        .transpose()?;

    Ok(Args {
        command,
        dir: PathBuf::from(dir),
        canister_id,
        start_page: start_page.unwrap_or_default(),
    })
}

#[tokio::main]
async fn main() -> Result<(), String> {
    let args = parse_args()?;
    match args.command {
        Command::Backup => backup(args).await,
        Command::Restore => restore(args).await,
    }
}
