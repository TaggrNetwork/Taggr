//! All the common functionality.
use anyhow::anyhow;
use ic_agent::agent::ReplicaV2Transport;
use ic_agent::{agent::http_transport::ReqwestHttpReplicaV2Transport, RequestId};
use ic_agent::{identity::AnonymousIdentity, Agent, Identity};
use serde_cbor::Value;
use signing::Ingress;
use std::str::FromStr;

pub const IC_URL: &str = "https://ic0.app";

pub fn get_ic_url() -> String {
    std::env::var("IC_URL").unwrap_or_else(|_| IC_URL.to_string())
}

pub mod request_status;
pub mod signing;

pub type AnyhowResult<T = ()> = anyhow::Result<T>;

/// Reads from the file path or STDIN and returns the content.
pub fn read_from_file(path: &str) -> AnyhowResult<String> {
    use std::io::Read;
    let mut content = String::new();
    if path == "-" {
        std::io::stdin().read_to_string(&mut content)?;
    } else {
        let path = std::path::Path::new(&path);
        let mut file =
            std::fs::File::open(path).map_err(|_| anyhow!("Message file doesn't exist"))?;
        file.read_to_string(&mut content)
            .map_err(|_| anyhow!("Cannot read the message file."))?;
    }
    Ok(content)
}

/// Returns an agent with an identity derived from a private key if it was provided.
pub async fn get_agent() -> AnyhowResult<Agent> {
    let timeout = std::time::Duration::from_secs(60 * 5);
    let builder = Agent::builder()
        .with_transport(
            ic_agent::agent::http_transport::ReqwestHttpReplicaV2Transport::create({
                get_ic_url()
            })?,
        )
        .with_ingress_expiry(Some(timeout));
    let agent = builder
        .with_boxed_identity(get_identity())
        .build()
        .map_err(|err| anyhow!(err))?;
    agent.fetch_root_key().await?;
    Ok(agent)
}

/// Returns an identity derived from the private key.
pub fn get_identity() -> Box<dyn Identity + Sync + Send> {
    Box::new(AnonymousIdentity)
}

pub fn parse_query_response(response: Vec<u8>) -> AnyhowResult<Vec<u8>> {
    let cbor: Value = serde_cbor::from_slice(&response)
        .map_err(|_| anyhow!("Invalid cbor data in the content of the message."))?;
    if let Value::Map(m) = cbor {
        // Try to decode a rejected response.
        if let (_, Some(Value::Integer(reject_code)), Some(Value::Text(reject_message))) = (
            m.get(&Value::Text("status".to_string())),
            m.get(&Value::Text("reject_code".to_string())),
            m.get(&Value::Text("reject_message".to_string())),
        ) {
            return Ok(
                format!("Rejected (code {}): {}", reject_code, reject_message)
                    .as_bytes()
                    .to_vec(),
            );
        }

        // Try to decode a successful response.
        if let (_, Some(Value::Map(m))) = (
            m.get(&Value::Text("status".to_string())),
            m.get(&Value::Text("reply".to_string())),
        ) {
            if let Some(Value::Bytes(reply)) = m.get(&Value::Text("arg".to_string())) {
                return Ok(reply.clone());
            }
        }
    }
    Err(anyhow!("Invalid cbor content"))
}

pub enum IngressResult {
    RequestId,
    QueryResponse(Vec<u8>),
}

pub async fn send_ingress(message: &Ingress) -> AnyhowResult<IngressResult> {
    let (_, canister_id, _, _) = message.parse()?;

    let transport = ReqwestHttpReplicaV2Transport::create(get_ic_url())?;
    let content = hex::decode(&message.content)?;

    if message.call_type == "query" {
        let response = parse_query_response(transport.query(canister_id, content).await?)?;
        Ok(IngressResult::QueryResponse(response))
    } else {
        let request_id = RequestId::from_str(
            &message
                .clone()
                .request_id
                .expect("Cannot get request_id from the update message"),
        )?;
        transport.call(canister_id, content, request_id).await?;
        Ok(IngressResult::RequestId)
    }
}
