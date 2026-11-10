// GPL-3.0-only. Headless development adapter; physical Android acceptance pending.
use anyhow::{Result, bail};
use rqs_lib::channel::{ChannelMessage, Message, TransferAction, TransferKind};
use rqs_lib::{EndpointInfo, OutboundPayload, RQS, SendInfo, TransferState, Visibility};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, mpsc};

#[cfg(all(feature = "ble-fastinit", target_os = "linux"))]
mod fast_init;

#[cfg(any(feature = "ble-native", test))]
mod ble;

const IPC_LIMIT: usize = 64 * 1024;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    v: u8,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}
enum Event {
    Request(Request),
    Protocol(ChannelMessage),
    Recipient(EndpointInfo),
    #[cfg(all(feature = "ble-native", target_os = "linux"))]
    Bluetooth(Value),
    End,
}
struct Engine {
    service: Option<RQS>,
    sender: Option<mpsc::Sender<SendInfo>>,
    recipients: HashMap<String, EndpointInfo>,
    recipient_seen: HashMap<String, Instant>,
    transfers: HashMap<String, Value>,
    consent: HashMap<String, Instant>,
    staging: Option<PathBuf>,
    protocol_diagnostics: bool,
    bluetooth: Value,
    #[cfg(all(feature = "ble-native", target_os = "linux"))]
    ble: Option<ble::Runtime>,
    #[cfg(all(feature = "ble-native", target_os = "linux"))]
    ble_sessions: HashMap<String, tokio_util::sync::CancellationToken>,
    #[cfg(all(feature = "ble-fastinit", target_os = "linux"))]
    fast_init: Option<fast_init::FastInit>,
}
impl Engine {
    fn new() -> Self {
        Self {
            service: None,
            sender: None,
            recipients: HashMap::new(),
            recipient_seen: HashMap::new(),
            transfers: HashMap::new(),
            consent: HashMap::new(),
            staging: None,
            protocol_diagnostics: false,
            bluetooth: json!({"stage":"not-requested","bleScanning":false,"bleAdvertising":false,"gattBootstrap":false,"l2cap":false}),
            #[cfg(all(feature = "ble-native", target_os = "linux"))]
            ble: None,
            #[cfg(all(feature = "ble-native", target_os = "linux"))]
            ble_sessions: HashMap::new(),
            #[cfg(all(feature = "ble-fastinit", target_os = "linux"))]
            fast_init: None,
        }
    }
    fn make_room(&mut self, id: &str) -> bool {
        if self.transfers.contains_key(id) || self.transfers.len() < 100 {
            return true;
        }
        let oldest = self
            .transfers
            .iter()
            .filter(|(_, value)| {
                matches!(
                    value["phase"].as_str(),
                    Some("complete" | "interrupted" | "declined" | "cancelled" | "outcome-unknown")
                )
            })
            .min_by_key(|(_, value)| value["created"].as_u64().unwrap_or(0))
            .map(|(id, _)| id.clone());
        if let Some(oldest) = oldest {
            self.transfers.remove(&oldest);
            self.consent.remove(&oldest);
            true
        } else {
            false
        }
    }
    async fn command(&mut self, req: &Request, events: &mpsc::Sender<Event>) -> Result<Value> {
        if req.v != 1 || req.id.is_empty() || req.id.len() > 128 {
            bail!("INVALID_REQUEST");
        }
        match req.method.as_str() {
            "hello" => Ok(
                json!({"protocol":1,"version":env!("CARGO_PKG_VERSION"),"experimental":true,"license":"GPL-3.0-only",
                "capabilities":{"lan":true,"ble":cfg!(all(feature="ble-native",target_os="linux")),"bleScanning":cfg!(all(feature="ble-native",target_os="linux")),"bleAdvertising":cfg!(all(feature="ble-native",target_os="linux")),"gattBootstrap":cfg!(all(feature="ble-native",target_os="linux")),"l2cap":cfg!(all(feature="ble-native",target_os="linux")),"lanListening":true,"lanUpgrade":false,"directWireless":false,"protocolDiagnostics":true,"bleFastInit":cfg!(all(feature="ble-fastinit",target_os="linux")),"direct":false,"resume":false,"persistentTrust":false}}),
            ),
            "bluetooth-preflight" => {
                #[cfg(all(feature = "ble-native", target_os = "linux"))]
                {
                    Ok(ble::probe().await)
                }
                #[cfg(not(all(feature = "ble-native", target_os = "linux")))]
                {
                    Ok(json!({"compiled":false,"registrationTested":false}))
                }
            }
            "visibility" => {
                let visible = req.params["visible"]
                    .as_bool()
                    .ok_or_else(|| anyhow::anyhow!("INVALID_VISIBILITY"))?;
                self.service
                    .as_mut()
                    .ok_or_else(|| anyhow::anyhow!("NOT_STARTED"))?
                    .change_visibility(if visible {
                        Visibility::Visible
                    } else {
                        Visibility::Invisible
                    });
                #[cfg(all(feature = "ble-native", target_os = "linux"))]
                if let Some(ble) = &self.ble {
                    ble.visibility(visible);
                }
                Ok(json!({"visible":visible}))
            }
            "start" => {
                if self.service.is_some() {
                    bail!("ALREADY_STARTED");
                }
                let request_ble = req.params["bleNative"].as_bool().unwrap_or(false);
                if request_ble && !cfg!(all(feature = "ble-native", target_os = "linux")) {
                    bail!("BLE_NOT_COMPILED");
                }
                let request_fastinit = req.params["bleFastInit"].as_bool().unwrap_or(false);
                if request_fastinit && !cfg!(all(feature = "ble-fastinit", target_os = "linux")) {
                    bail!("FASTINIT_NOT_COMPILED");
                }
                let directory = req.params["staging"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("INVALID_STAGING"))?;
                let directory = PathBuf::from(directory);
                if !directory.is_absolute() {
                    bail!("INVALID_STAGING");
                }
                if !directory.exists() {
                    std::fs::DirBuilder::new()
                        .recursive(true)
                        .mode(0o700)
                        .create(&directory)?;
                }
                let meta = std::fs::symlink_metadata(&directory)?;
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    bail!("INVALID_STAGING");
                }
                let name = req.params["name"].as_str().unwrap_or("Airdrop Linux");
                if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) {
                    bail!("INVALID_NAME");
                }
                let port = req.params["port"].as_u64().unwrap_or(53319);
                if port > 65535 {
                    bail!("INVALID_PORT");
                }
                let mut service = RQS::new(
                    Visibility::Visible,
                    Some(port as u32),
                    Some(directory.clone()),
                    Some(name.to_owned()),
                );
                let (sender, _) = service.run().await?;
                let mut updates = service.message_sender.subscribe();
                let queue = events.clone();
                tokio::spawn(async move {
                    loop {
                        match updates.recv().await {
                            Ok(message) => {
                                if queue.send(Event::Protocol(message)).await.is_err() {
                                    break;
                                }
                            }
                            Err(broadcast::error::RecvError::Lagged(_)) => {
                                let _ = queue.send(Event::End).await;
                                break;
                            }
                            Err(_) => break,
                        }
                    }
                });
                let (discovery, mut observed) = broadcast::channel(100);
                service.discovery(discovery)?;
                let queue = events.clone();
                tokio::spawn(async move {
                    while let Ok(endpoint) = observed.recv().await {
                        if queue.send(Event::Recipient(endpoint)).await.is_err() {
                            break;
                        }
                    }
                });
                #[cfg(all(feature = "ble-native", target_os = "linux"))]
                if request_ble {
                    self.ble = Some(ble::Runtime::start(
                        service
                            .endpoint_id
                            .ok_or_else(|| anyhow::anyhow!("NO_ENDPOINT"))?,
                        name.to_owned(),
                        service.message_sender.clone(),
                        events.clone(),
                    ));
                }
                let port = service.port_number;
                self.staging = Some(directory);
                self.sender = Some(sender);
                self.service = Some(service);
                self.protocol_diagnostics =
                    req.params["protocolDiagnostics"].as_bool().unwrap_or(false);
                let fastinit_state = if request_fastinit {
                    #[cfg(all(feature = "ble-fastinit", target_os = "linux"))]
                    {
                        match tokio::time::timeout(Duration::from_secs(4), fast_init::register())
                            .await
                        {
                            Ok(Ok(handle)) => {
                                self.fast_init = Some(handle);
                                "registered-for-120s"
                            }
                            Ok(Err(code)) => code,
                            Err(_) => "bluez-timeout",
                        }
                    }
                    #[cfg(not(all(feature = "ble-fastinit", target_os = "linux")))]
                    {
                        "not-compiled"
                    }
                } else {
                    "not-requested"
                };
                Ok(json!({"started":true,"port":port,"bleFastInitState":fastinit_state}))
            }
            "snapshot" => Ok(
                json!({"recipients": self.recipients.values().collect::<Vec<_>>(), "transfers": self.transfers.values().collect::<Vec<_>>(), "bluetooth":self.bluetooth,"runtimeCapabilities":{"lanListening":self.service.is_some(),"lanUpgrade":false,"directWireless":false,"bleScanning":self.bluetooth["bleScanning"]==true,"bleAdvertising":self.bluetooth["bleAdvertising"]==true,"gattBootstrap":self.bluetooth["gattBootstrap"]==true,"l2cap":self.bluetooth["l2cap"]==true}}),
            ),
            "send" => {
                let target = req.params["recipientId"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("INVALID_RECIPIENT"))?;
                let endpoint = self
                    .recipients
                    .get(target)
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("RECIPIENT_UNAVAILABLE"))?;
                let paths: Vec<String> = serde_json::from_value(req.params["files"].clone())?;
                validate_sources(&paths)?;
                let id = req.params["transferId"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("INVALID_TRANSFER"))?;
                if id.is_empty()
                    || id.len() > 80
                    || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                    || self.transfers.contains_key(id)
                {
                    bail!("INVALID_TRANSFER");
                }
                if !self.make_room(id) {
                    bail!("HISTORY_FULL");
                }
                #[cfg(all(feature = "ble-native", target_os = "linux"))]
                if endpoint
                    .transport
                    .as_deref()
                    .is_some_and(|t| t.starts_with("ble-"))
                {
                    if endpoint.connectable != Some(true) {
                        bail!("RECIPIENT_NOT_CONNECTABLE");
                    }
                    let cancellation = self
                        .ble
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("BLE_NOT_STARTED"))?
                        .send(target.to_owned(), paths, id.to_owned())?;
                    self.ble_sessions.insert(id.to_owned(), cancellation);
                    self.transfers.insert(id.to_owned(),json!({"id":id,"phase":"connecting","direction":"outgoing","created":now_ms()}));
                    return Ok(json!({"transferId":id}));
                }
                let info = SendInfo {
                    id: id.to_owned(),
                    name: endpoint.name.clone().unwrap_or_default(),
                    addr: format!(
                        "{}:{}",
                        endpoint.ip.as_deref().unwrap_or_default(),
                        endpoint.port.as_deref().unwrap_or_default()
                    ),
                    ob: OutboundPayload::Files(paths),
                    ble: false,
                };
                self.sender
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("NOT_STARTED"))?
                    .send(info)
                    .await?;
                self.transfers.insert(
                    id.to_owned(),
                    json!({"id":id,"phase":"connecting","direction":"outgoing","created":now_ms()}),
                );
                Ok(json!({"transferId":id}))
            }
            "respond" | "cancel" => {
                let id = req.params["transferId"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("INVALID_TRANSFER"))?;
                if !self.transfers.contains_key(id) {
                    bail!("INVALID_TRANSFER");
                }
                let action = if req.method == "cancel" {
                    #[cfg(all(feature = "ble-native", target_os = "linux"))]
                    if let Some(token) = self.ble_sessions.remove(id) {
                        token.cancel();
                    }
                    TransferAction::TransferCancel
                } else {
                    if !self
                        .consent
                        .remove(id)
                        .is_some_and(|deadline| deadline > Instant::now())
                    {
                        bail!("CONSENT_EXPIRED");
                    }
                    if req.params["accept"].as_bool().unwrap_or(false) {
                        TransferAction::ConsentAccept
                    } else {
                        TransferAction::ConsentDecline
                    }
                };
                self.service
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("NOT_STARTED"))?
                    .message_sender
                    .send(ChannelMessage {
                        id: id.to_owned(),
                        msg: Message::Lib { action },
                    })?;
                Ok(json!({"accepted":true}))
            }
            _ => bail!("UNKNOWN_METHOD"),
        }
    }
    fn protocol(&mut self, event: ChannelMessage) -> Option<Value> {
        if let Message::Protocol { kind, stage } = &event.msg {
            #[cfg(all(feature = "ble-native", target_os = "linux"))]
            {
                let name = format!("{stage:?}");
                if name == "ReceivedConnectionRequest" {
                    ble::diagnostics::inc("nearby_connection_message")
                }
                if name.contains("Ukey") {
                    ble::diagnostics::inc("ukey2_progress")
                }
            }
            return self.protocol_diagnostics.then(|| json!({"v":1,"event":"protocol","data":{
                "id":event.id, "direction":if *kind == TransferKind::Inbound {"incoming"} else {"outgoing"},
                "protocolStage":format!("{stage:?}")
            }}));
        }
        let Message::Client(message) = event.msg else {
            return None;
        };
        if self.transfers.get(&event.id).is_some_and(|v| {
            matches!(
                v["phase"].as_str(),
                Some("complete" | "interrupted" | "declined" | "cancelled" | "outcome-unknown")
            )
        }) {
            return None;
        }
        let previous = self
            .transfers
            .get(&event.id)
            .cloned()
            .unwrap_or_else(|| json!({"id":event.id,"created":now_ms()}));
        let mut value = previous;
        value["direction"] = json!(if message.kind == TransferKind::Inbound {
            "incoming"
        } else {
            "outgoing"
        });
        if let Some(state) = message.state {
            #[cfg(all(feature = "ble-native", target_os = "linux"))]
            {
                let key = match state {
                    TransferState::Disconnected => "protocol_disconnected",
                    TransferState::Rejected => "protocol_rejected",
                    TransferState::Cancelled => "protocol_cancelled",
                    TransferState::ReceivingFiles => "protocol_receiving",
                    TransferState::SendingFiles => "protocol_sending",
                    TransferState::Finished => "protocol_complete",
                    TransferState::Sent => "protocol_completion_unconfirmed",
                    _ => "",
                };
                ble::diagnostics::inc(key);
            }
            value["protocolStage"] = json!(format!("{state:?}"));
            value["phase"] = json!(match state {
                TransferState::WaitingForUserConsent => "awaiting-acceptance",
                TransferState::ReceivingFiles | TransferState::SendingFiles => "transferring",
                TransferState::Finished => "complete",
                TransferState::Sent => "outcome-unknown",
                TransferState::Cancelled => "cancelled",
                TransferState::Rejected => "declined",
                TransferState::Disconnected => "interrupted",
                _ => "connecting",
            });
            if state == TransferState::WaitingForUserConsent {
                self.consent
                    .entry(event.id.clone())
                    .or_insert(Instant::now() + Duration::from_secs(60));
            }
            if matches!(
                state,
                TransferState::Finished
                    | TransferState::Sent
                    | TransferState::Disconnected
                    | TransferState::Rejected
                    | TransferState::Cancelled
            ) {
                self.consent.remove(&event.id);
                #[cfg(all(feature = "ble-native", target_os = "linux"))]
                self.ble_sessions.remove(&event.id);
            }
        }
        if let Some(meta) = message.metadata {
            value["name"] = json!(
                meta.source
                    .map(|s| s.name)
                    .unwrap_or_else(|| "Nearby device".into())
            );
            value["pinCode"] = json!(meta.pin_code);
            value["total"] = json!(meta.total_bytes);
            value["bytes"] = json!(meta.ack_bytes);
            if let Some(rqs_lib::hdl::info::TransferPayload::Files(files)) = meta.payload {
                value["files"] = json!(files);
            }
            value["stagedPaths"] = json!(meta.saved_paths);
        }
        if !self.make_room(&event.id) {
            return None;
        }
        self.transfers.insert(event.id, value.clone());
        Some(json!({"v":1,"event":"transfer","data":value}))
    }
    async fn stop(&mut self) {
        #[cfg(all(feature = "ble-native", target_os = "linux"))]
        if let Some(mut ble) = self.ble.take() {
            ble.stop().await;
        }

        #[cfg(all(feature = "ble-fastinit", target_os = "linux"))]
        {
            self.fast_init.take();
        }
        if let Some(mut service) = self.service.take() {
            let _ = tokio::time::timeout(Duration::from_secs(5), service.stop()).await;
        }
    }
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn validate_sources(paths: &[String]) -> Result<()> {
    if paths.is_empty() || paths.len() > rqs_lib::receive_safety::MAX_FILES {
        bail!("INVALID_FILES");
    }
    let mut total = 0u64;
    for path in paths {
        if !Path::new(path).is_absolute() {
            bail!("INVALID_FILES");
        }
        let meta = std::fs::symlink_metadata(path)?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            bail!("INVALID_FILES");
        }
        total = total
            .checked_add(meta.len())
            .ok_or_else(|| anyhow::anyhow!("SIZE_LIMIT"))?;
        if total > rqs_lib::receive_safety::MAX_BYTES {
            bail!("SIZE_LIMIT");
        }
    }
    Ok(())
}
async fn read_line<R: AsyncBufRead + Unpin>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return Ok(if line.is_empty() { None } else { Some(line) });
        }
        let end = buffer.iter().position(|b| *b == b'\n').map(|i| i + 1);
        let length = end.unwrap_or(buffer.len());
        if line.len() + length > IPC_LIMIT {
            bail!("IPC_LIMIT");
        }
        line.extend_from_slice(&buffer[..length]);
        reader.consume(length);
        if end.is_some() {
            return Ok(Some(line));
        }
    }
}
async fn output(value: Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(&value)?;
    if bytes.len() > 4 * 1024 * 1024 {
        bail!("IPC_OUTPUT_LIMIT");
    }
    bytes.push(b'\n');
    let mut stdout = tokio::io::stdout();
    stdout.write_all(&bytes).await?;
    stdout.flush().await?;
    Ok(())
}
#[tokio::main]
async fn main() -> Result<()> {
    if !rqs_lib::AIRDROP_LAN_ONLY {
        bail!("Wireless builds are not enabled for this development helper");
    }
    // Upstream log/tracing is deliberately unregistered: no PINs or payloads on
    // stdout/stderr. Only versioned JSON records are part of the IPC surface.
    let (events, mut received) = mpsc::channel(128);
    let input = events.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(tokio::io::stdin());
        while let Ok(Some(line)) = read_line(&mut reader).await {
            let Ok(request) = serde_json::from_slice::<Request>(&line) else {
                break;
            };
            if input.send(Event::Request(request)).await.is_err() {
                return;
            }
        }
        let _ = input.send(Event::End).await;
    });
    let mut engine = Engine::new();
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    loop {
        let event = tokio::select! { event = received.recv() => event, _ = ticker.tick() => {
            let stale:Vec<_>=engine.recipient_seen.iter().filter(|(_,at)|at.elapsed()>=Duration::from_secs(35)).map(|(id,_)|id.clone()).collect();
            for id in stale{
                #[cfg(all(feature="ble-native",target_os="linux"))] ble::diagnostics::inc("helper_recipient_expired");
                engine.recipient_seen.remove(&id);if let Some(mut endpoint)=engine.recipients.remove(&id){endpoint.present=Some(false);if output(json!({"v":1,"event":"recipient","data":endpoint})).await.is_err(){break;}}}
            let expired: Vec<_> = engine.consent.iter().filter(|(_, deadline)| **deadline <= Instant::now()).map(|(id, _)| id.clone()).collect();
            for id in expired {
                engine.consent.remove(&id);
                if let Some(service) = engine.service.as_ref() { let _ = service.message_sender.send(ChannelMessage { id, msg: Message::Lib { action: TransferAction::ConsentDecline } }); }
            }
            continue;
        }};
        let value = match event {
            Some(Event::Request(req)) => {
                if req.method == "stop" {
                    break;
                }
                match engine.command(&req, &events).await {
                    Ok(result) => Some(json!({"v":1,"id":req.id,"result":result})),
                    Err(_) => Some(
                        json!({"v":1,"id":req.id,"error":{"code":"REQUEST_FAILED","message":"Quick Share request failed; check the requested capability and retry."}}),
                    ),
                }
            }
            Some(Event::Recipient(endpoint)) => {
                #[cfg(all(feature = "ble-native", target_os = "linux"))]
                ble::diagnostics::inc("helper_recipient_received");
                if endpoint.present == Some(true) {
                    if endpoint
                        .transport
                        .as_deref()
                        .is_some_and(|t| t.starts_with("ble-"))
                        && (engine.recipient_seen.len() < 100
                            || engine.recipient_seen.contains_key(&endpoint.id))
                    {
                        engine
                            .recipient_seen
                            .insert(endpoint.id.clone(), Instant::now());
                    }
                    if engine.recipients.len() < 100 || engine.recipients.contains_key(&endpoint.id)
                    {
                        #[cfg(all(feature = "ble-native", target_os = "linux"))]
                        ble::diagnostics::inc("helper_recipient_published");
                        engine
                            .recipients
                            .insert(endpoint.id.clone(), endpoint.clone());
                    } else {
                        #[cfg(all(feature = "ble-native", target_os = "linux"))]
                        ble::diagnostics::inc("helper_recipient_capacity_rejected");
                    }
                } else {
                    engine.recipient_seen.remove(&endpoint.id);
                    engine.recipients.remove(&endpoint.id);
                }
                Some(json!({"v":1,"event":"recipient","data":endpoint}))
            }
            #[cfg(all(feature = "ble-native", target_os = "linux"))]
            Some(Event::Bluetooth(state)) => {
                if state["stage"] == "adapter-unavailable" {
                    let gone: Vec<_> = engine
                        .recipients
                        .values()
                        .filter(|e| {
                            e.transport
                                .as_deref()
                                .is_some_and(|t| t.starts_with("ble-"))
                        })
                        .cloned()
                        .collect();
                    for mut endpoint in gone {
                        engine.recipients.remove(&endpoint.id);
                        endpoint.present = Some(false);
                        output(json!({"v":1,"event":"recipient","data":endpoint})).await?;
                    }
                }
                if let Some(fields) = state.as_object() {
                    for (key, value) in fields {
                        engine.bluetooth[key] = value.clone();
                    }
                }
                engine.bluetooth["diagnostics"] = ble::diagnostics::current().snapshot();
                Some(json!({"v":1,"event":"bluetooth","data":engine.bluetooth}))
            }
            Some(Event::Protocol(message)) => engine.protocol(message),
            _ => break,
        };
        if let Some(value) = value
            && output(value).await.is_err()
        {
            break;
        }
    }
    engine.stop().await;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn ipc_is_bounded_and_handles_partial_input() {
        let mut input = BufReader::new(&b"one\ntwo"[..]);
        assert_eq!(read_line(&mut input).await.unwrap().unwrap(), b"one\n");
        assert_eq!(read_line(&mut input).await.unwrap().unwrap(), b"two");
        assert!(read_line(&mut input).await.unwrap().is_none());
        let bytes = vec![b'x'; IPC_LIMIT + 1];
        assert!(
            read_line(&mut BufReader::new(bytes.as_slice()))
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn capabilities_do_not_start_a_listener_or_grant_wireless() {
        let mut engine = Engine::new();
        let (events, _) = mpsc::channel(1);
        let request = Request {
            v: 1,
            id: "hello".into(),
            method: "hello".into(),
            params: Value::Null,
        };
        let reply = engine.command(&request, &events).await.unwrap();
        assert_eq!(reply["capabilities"]["direct"], false);
        assert!(engine.service.is_none());
    }
    #[test]
    fn diagnostics_are_opt_in_and_never_request_early_consent() {
        let mut engine = Engine::new();
        let event = ChannelMessage {
            id: "diagnostic-session".into(),
            msg: Message::Protocol {
                kind: TransferKind::Inbound,
                stage: TransferState::WaitingForUserConsent,
            },
        };
        assert!(engine.protocol(event.clone()).is_none());
        engine.protocol_diagnostics = true;
        let value = engine.protocol(event).unwrap();
        assert_eq!(value["event"], "protocol");
        assert_eq!(value["data"]["protocolStage"], "WaitingForUserConsent");
        assert!(engine.transfers.is_empty());
        assert!(engine.consent.is_empty());
        assert!(value["data"]["pinCode"].is_null());
    }
    #[test]
    fn history_evicts_terminal_records_without_aborting_active_transfers() {
        let mut engine = Engine::new();
        for i in 0..100 {
            engine
                .transfers
                .insert(i.to_string(), json!({"phase":"transferring", "created":i}));
        }
        assert!(!engine.make_room("new"));
        engine.transfers.get_mut("0").unwrap()["phase"] = json!("complete");
        assert!(engine.make_room("new"));
        assert!(!engine.transfers.contains_key("0"));
        assert_eq!(engine.transfers.len(), 99);
    }
    #[cfg(all(feature = "ble-native", target_os = "linux"))]
    #[tokio::test]
    async fn cancellation_reaches_a_queued_ble_bootstrap_before_the_session_subscribes() {
        let mut engine = Engine::new();
        let token = tokio_util::sync::CancellationToken::new();
        engine.ble_sessions.insert("pending".into(), token.clone());
        engine
            .transfers
            .insert("pending".into(), json!({"phase":"connecting"}));
        let service = RQS::new(Visibility::Invisible, None, None, Some("Linux".into()));
        let _receiver = service.message_sender.subscribe();
        engine.service = Some(service);
        let (events, _) = mpsc::channel(1);
        engine
            .command(
                &Request {
                    v: 1,
                    id: "cancel".into(),
                    method: "cancel".into(),
                    params: json!({"transferId":"pending"}),
                },
                &events,
            )
            .await
            .unwrap();
        assert!(token.is_cancelled());
        assert!(engine.ble_sessions.is_empty());
    }
}
