use crate::common::AnyhowResult;
use anyhow::anyhow;
use ic_agent::agent::QueryBuilder;
use ic_agent::agent::UpdateBuilder;
use ic_agent::Agent;
use ic_agent::RequestId;
use ic_types::principal::Principal;
use serde::{Deserialize, Serialize};
use serde_cbor::Value;
use std::convert::TryFrom;
use std::time::Duration;

#[derive(Debug)]
pub struct MessageError(String);

impl std::fmt::Display for MessageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", &self.0)
    }
}
impl std::error::Error for MessageError {}

/// Represents a signed message with the corresponding request id.
#[derive(Clone)]
pub struct SignedMessageWithRequestId {
    pub message: Ingress,
    pub request_id: Option<RequestId>,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
pub struct RequestStatus {
    pub canister_id: String,
    pub request_id: String,
    pub content: String,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
pub struct Ingress {
    pub call_type: String,
    pub request_id: Option<String>,
    pub content: String,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
pub struct IngressWithRequestId {
    pub ingress: Ingress,
    pub request_status: RequestStatus,
}

impl Ingress {
    pub fn parse(&self) -> AnyhowResult<(Principal, Principal, String, Result<String, String>)> {
        let cbor: Value = serde_cbor::from_slice(&hex::decode(&self.content)?)
            .map_err(|_| anyhow!("Invalid cbor data in the content of the message."))?;
        if let Value::Map(m) = cbor {
            let cbor_content = m
                .get(&Value::Text("content".to_string()))
                .ok_or_else(|| anyhow!("Invalid cbor content"))?;
            if let Value::Map(m) = cbor_content {
                if let (
                    Some(Value::Bytes(sender)),
                    Some(Value::Bytes(canister_id)),
                    Some(Value::Text(method_name)),
                    Some(Value::Bytes(_)),
                ) = (
                    m.get(&Value::Text("sender".to_string())),
                    m.get(&Value::Text("canister_id".to_string())),
                    m.get(&Value::Text("method_name".to_string())),
                    m.get(&Value::Text("arg".to_string())),
                ) {
                    let sender = Principal::try_from(sender)?;
                    let canister_id = Principal::try_from(canister_id)?;
                    return Ok((
                        sender,
                        canister_id,
                        method_name.to_string(),
                        Ok(Default::default()),
                    ));
                }
            }
        }
        Err(anyhow!("Invalid cbor content"))
    }
}

pub fn request_status_sign(
    agent: Agent,
    request_id: RequestId,
    canister_id: Principal,
) -> AnyhowResult<RequestStatus> {
    let val = agent.sign_request_status(canister_id, request_id)?;
    Ok(RequestStatus {
        canister_id: canister_id.to_string(),
        request_id: request_id.into(),
        content: hex::encode(val.signed_request_status),
    })
}

pub fn sign(
    agent: Agent,
    canister_id: Principal,
    method_name: &str,
    is_query: bool,
    args: Vec<u8>,
) -> AnyhowResult<SignedMessageWithRequestId> {
    let ingress_expiry = Duration::from_secs(5 * 60);

    let (content, request_id) = if is_query {
        let bytes = QueryBuilder::new(&agent, canister_id, method_name.to_string())
            .with_arg(args)
            .expire_after(ingress_expiry)
            .sign()?
            .signed_query;
        (hex::encode(bytes), None)
    } else {
        let signed_update = UpdateBuilder::new(&agent, canister_id, method_name.to_string())
            .with_arg(args)
            .expire_after(ingress_expiry)
            .sign()?;

        (
            hex::encode(signed_update.signed_update),
            Some(signed_update.request_id),
        )
    };

    Ok(SignedMessageWithRequestId {
        message: Ingress {
            call_type: if is_query { "query" } else { "update" }.to_string(),
            request_id: request_id.map(|v| v.into()),
            content,
        },
        request_id,
    })
}

/// Generates a bundle of signed messages (ingress + request status query).
pub fn sign_ingress_with_request_status_query(
    agent: Agent,
    canister_id: Principal,
    method_name: &str,
    args: Vec<u8>,
) -> AnyhowResult<IngressWithRequestId> {
    let msg_with_req_id = sign(agent.clone(), canister_id, method_name, false, args)?;
    let request_id = msg_with_req_id
        .request_id
        .expect("No request id for transfer call found");
    let request_status = request_status_sign(agent, request_id, canister_id)?;
    let message = IngressWithRequestId {
        ingress: msg_with_req_id.message,
        request_status,
    };
    Ok(message)
}

/// Generates a signed ingress message.
pub fn sign_ingress(
    agent: Agent,
    canister_id: Principal,
    method_name: &str,
    is_query: bool,
    args: Vec<u8>,
) -> AnyhowResult<Ingress> {
    let msg = sign(agent, canister_id, method_name, is_query, args)?;
    Ok(msg.message)
}
