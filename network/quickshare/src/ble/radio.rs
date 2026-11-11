// GPL-3.0-only. Native BlueZ integration, bounded independently of dormant upstream
// experimental network-management code. No power/pairing/policy changes.
use super::diagnostics::{self as diag, inc};
use super::protocol::*;
use crate::Event;
use anyhow::{Result, bail, ensure};
use bluer::adv::{Advertisement, SecondaryChannel, Type};
use bluer::gatt::{local::*, remote::Characteristic as RemoteCharacteristic};
use bluer::{Adapter, AdapterEvent, Address, AddressType, Uuid};
use futures::StreamExt;
use rqs_lib::channel::{ChannelMessage, Message, MessageClient, TransferKind};
use rqs_lib::hdl::{InboundRequest, OutboundRequest};
use rqs_lib::utils::RemoteDeviceInfo;
use rqs_lib::{EndpointInfo, OutboundPayload, TransferState};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream},
    sync::{Semaphore, broadcast, mpsc, watch},
    task::{JoinHandle, JoinSet},
    time::{Instant, timeout},
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
const DBUS: Duration = Duration::from_secs(5);
const PEER_TIMEOUT: Duration = Duration::from_secs(60);
const TTL: Duration = Duration::from_secs(35);
const SESSION_LIMIT: Duration = Duration::from_secs(15 * 60);
const SERVICE: Uuid = Uuid::from_u128(0x0000fef300001000800000805f9b34fb);

async fn bounded<T>(f: impl std::future::Future<Output = Result<T, bluer::Error>>) -> Result<T> {
    match timeout(DBUS, f).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => {
            diag::dbus_error(&e.kind);
            Err(e.into())
        }
        Err(e) => {
            inc("dbus_timeout");
            Err(e.into())
        }
    }
}
fn emit(events: &mpsc::Sender<Event>, state: &Value) {
    let mut state = state.clone();
    state["diagnostics"] = diag::current().snapshot();
    if events.try_send(Event::Bluetooth(state)).is_err() {
        inc("diagnostic_event_dropped");
    }
}
fn phase(events: &mpsc::Sender<Event>, stage: &'static str) {
    if stage == "weave-established" {
        inc("weave_established")
    }
    let method = match stage {
        "weave-established" | "gatt-connection-pending" => Some("ble-gatt"),
        "l2cap-established" | "l2cap-connection-pending" => Some("ble-l2cap"),
        _ => None,
    };
    let mut value = json!({"stage":stage});
    if let Some(method) = method {
        value["selectedMethod"] = json!(method);
    }
    emit(events, &value);
}
fn initial() -> Value {
    json!({
    "bleScanning":false,"bleAdvertising":false,"gattBootstrap":false,"l2cap":false,"lanUpgrade":false,"directWireless":false,"mode":"off","stage":"starting","observed":0,"decoded":0,"resolved":0,"ready":0}
    )
}
pub async fn probe() -> Value {
    let result=timeout(DBUS,async {
        let session=bluer::Session::new().await?;
        let adapter=session.default_adapter().await?;
        let powered=adapter.is_powered().await?;
        let slots=adapter.supported_advertising_instances().await.ok();
        let active=adapter.active_advertising_instances().await.ok();
        let lengths=adapter.supported_advertising_capabilities().await.ok().flatten();
        let extended=adapter.supported_advertising_secondary_channels().await.ok().flatten().is_some_and(|s|s.contains(&SecondaryChannel::OneM));
        Ok::<_,bluer::Error>(json!({
        "bluez":true,"powered":powered,"maxAdvertisementLength":lengths.as_ref().map(|v|v.max_advertisement_length),"maxScanResponseLength":lengths.as_ref().map(|v|v.max_scan_response_length),"advertisingInstances":slots,"activeInstances":active,"extendedAdvertising":extended,"registrationTested":false}
        ))
    }).await;
    match result {
        Ok(Ok(v)) => v,
        _ => json!({"bluez":false,"registrationTested":false}),
    }
}
#[derive(Clone)]
struct Send {
    cancel: CancellationToken,
    deadline: Instant,
    key: String,
    files: Vec<String>,
    id: String,
}
#[derive(Clone, Default)]
struct Connections(Arc<Mutex<HashMap<Address, bluer::Device>>>);
impl Connections {
    fn claim(&self, device: &bluer::Device) -> Result<()> {
        let mut owned = self
            .0
            .lock()
            .map_err(|_| anyhow::anyhow!("ACL ownership lock"))?;
        ensure!(
            owned.len() < 5 && !owned.contains_key(&device.address()),
            "owned ACL limit"
        );
        owned.insert(device.address(), device.clone());
        Ok(())
    }
    async fn release(&self, device: &bluer::Device) {
        let released = bounded(device.disconnect()).await.is_ok();
        if !released {
            inc("gatt_disconnect_failed")
        }
        if released && let Ok(mut owned) = self.0.lock() {
            owned.remove(&device.address());
        }
    }
    async fn release_address(&self, address: Address) {
        let device = self
            .0
            .lock()
            .ok()
            .and_then(|owned| owned.get(&address).cloned());
        if let Some(device) = device {
            self.release(&device).await;
        }
    }
    async fn cleanup(&self) {
        let devices: Vec<_> = self
            .0
            .lock()
            .map(|mut owned| owned.drain().map(|(_, d)| d).collect())
            .unwrap_or_default();
        futures::future::join_all(devices.into_iter().map(|d| async move {
            let _ = timeout(DBUS, d.disconnect()).await;
        }))
        .await;
    }
}
pub struct Runtime {
    cancel: CancellationToken,
    task: JoinHandle<()>,
    tx: mpsc::Sender<Send>,
    visible: watch::Sender<bool>,
    connections: Connections,
    stopped: bool,
}
impl Runtime {
    pub fn start(
        endpoint: [u8; 4],
        name: String,
        sender: broadcast::Sender<ChannelMessage>,
        events: mpsc::Sender<Event>,
    ) -> Self {
        let cancel = CancellationToken::new();
        let c = cancel.clone();
        let (tx, mut rx) = mpsc::channel(4);
        let (visible, mut vis) = watch::channel(true);
        let connections = Connections::default();
        let owned = connections.clone();
        let task = tokio::spawn(async move {
            loop {
                let result = tokio::select! {
                _=c.cancelled()=>break,r=run((endpoint,&name),&sender,&events,&mut rx,&mut vis,c.child_token(),owned.clone())=>r};
                owned.cleanup().await;
                while let Ok(request) = rx.try_recv() {
                    failed(&sender, &request.id, TransferKind::Outbound);
                }
                if result.is_err() {
                    inc("runtime_failed")
                }
                let mut state = initial();
                state["stage"] = json!(if result.is_ok() {
                    "stopped"
                } else {
                    "adapter-unavailable"
                });
                emit(&events, &state);
                tokio::select! {_=c.cancelled()=>break,Some(request)=rx.recv()=>{failed(&sender,&request.id,TransferKind::Outbound);},_=tokio::time::sleep(Duration::from_secs(5))=>{}}
            }
        });
        Self {
            cancel,
            task,
            tx,
            visible,
            connections,
            stopped: false,
        }
    }
    pub fn send(&self, key: String, files: Vec<String>, id: String) -> Result<CancellationToken> {
        let cancel = self.cancel.child_token();
        self.tx
            .try_send(Send {
                key,
                files,
                id,
                cancel: cancel.clone(),
                deadline: Instant::now() + Duration::from_secs(30),
            })
            .map_err(|_| anyhow::anyhow!("BLE busy"))?;
        Ok(cancel)
    }
    pub fn visibility(&self, visible: bool) {
        let _ = self.visible.send(visible);
    }
    pub async fn stop(&mut self) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        self.cancel.cancel();
        if timeout(Duration::from_secs(2), &mut self.task)
            .await
            .is_err()
        {
            self.task.abort();
            let _ = (&mut self.task).await;
        }
        self.connections.cleanup().await;
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.task.abort();
    }
}
#[derive(Clone)]
struct Target {
    advert: Advert,
    addr: Address,
    addr_type: AddressType,
    gatt: bool,
    resolved: bool,
    seen: Instant,
}
fn endpoint(t: &Target, present: bool) -> EndpointInfo {
    let key = t.advert.key();
    EndpointInfo {
        fullname: key.clone(),
        discovery_key: Some(key.clone()),
        id: key,
        name: Some(if t.advert.name.is_empty() {
            "Nearby device".into()
        } else {
            t.advert.name.clone()
        }),
        rtype: Some(t.advert.kind.clone()),
        present: Some(present),
        transport: Some(
            if t.advert.psm.is_some() {
                "ble-l2cap"
            } else {
                "ble-gatt"
            }
            .into(),
        ),
        discovery_stage: Some(
            if t.resolved {
                "gatt-resolved"
            } else {
                "endpoint-decoded"
            }
            .into(),
        ),
        connectable: Some(t.advert.psm.is_some() || t.gatt),
        ..Default::default()
    }
}
fn report(events: &mpsc::Sender<Event>, t: &Target, present: bool) {
    inc(
        if events
            .try_send(Event::Recipient(endpoint(t, present)))
            .is_ok()
        {
            "recipient_ipc_queued"
        } else {
            "recipient_ipc_dropped"
        },
    );
}
struct Ingress {
    tx: mpsc::Sender<(Address, Vec<u8>)>,
    cancel: CancellationToken,
}
type Gate = Arc<Mutex<Option<Ingress>>>;
struct SessionGuard(Gate);
impl Drop for SessionGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            guard.take();
        }
    }
}
struct GattService {
    _handle: ApplicationHandle,
    workers: TaskTracker,
    cancel: CancellationToken,
}
impl Drop for GattService {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
async fn application(
    adapter: &Adapter,
    full: Vec<u8>,
    sender: broadcast::Sender<ChannelMessage>,
    events: mpsc::Sender<Event>,
    cancel: CancellationToken,
    permits: Arc<Semaphore>,
    visibility: watch::Receiver<bool>,
) -> Result<GattService> {
    inc("gatt_registration_requested");
    let workers = TaskTracker::new();
    let notification_workers = workers.clone();
    let shutdown = cancel.clone();
    let gate: Gate = Arc::new(Mutex::new(None));
    let writes = gate.clone();
    let read_visibility = visibility.clone();
    let write_visibility = visibility;
    let app = Application {
        services: vec![Service {
            uuid: SERVICE,
            primary: true,
            characteristics: vec![
                Characteristic {
                    uuid: SLOT.parse()?,
                    read: Some(CharacteristicRead {
                        read: true,
                        fun: Box::new(move |req| {
                            let full = full.clone();
                            let visible = read_visibility.clone();
                            Box::pin(async move {
                                inc("incoming_gatt_read");
                                if !*visible.borrow() {
                                    inc("incoming_gatt_read_rejected");
                                    return Err(ReqError::NotPermitted);
                                }
                                let at = req.offset as usize;
                                if at > full.len() {
                                    inc("incoming_gatt_read_rejected");
                                    return Err(ReqError::InvalidOffset);
                                }
                                Ok(full[at..].to_vec())
                            })
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Characteristic {
                    uuid: WRITE.parse()?,
                    write: Some(CharacteristicWrite {
                        write: true,
                        write_without_response: false,
                        method: CharacteristicWriteMethod::Fun(Box::new(move |data, req| {
                            let gate = writes.clone();
                            let visible = write_visibility.clone();
                            Box::pin(async move {
                                inc("incoming_gatt_write");
                                if !*visible.borrow() {
                                    inc("incoming_gatt_write_rejected");
                                    return Err(ReqError::NotPermitted);
                                }
                                if req.offset != 0
                                    || req.prepare_authorize
                                    || data.is_empty()
                                    || data.len() > 20
                                {
                                    inc("incoming_gatt_write_rejected");
                                    return Err(ReqError::InvalidValueLength);
                                }
                                let gate = gate.lock().map_err(|_| ReqError::Failed)?;
                                let ingress = gate.as_ref().ok_or_else(|| {
                                    inc("incoming_gatt_write_rejected");
                                    ReqError::NotPermitted
                                })?;
                                if ingress.tx.try_send((req.device_address, data)).is_err() {
                                    ingress.cancel.cancel();
                                    inc("gatt_ingress_overflow");
                                    return Err(ReqError::InProgress);
                                }
                                Ok(())
                            })
                        })),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Characteristic {
                    uuid: NOTIFY.parse()?,
                    notify: Some(CharacteristicNotify {
                        // Indications provide ATT confirmation/backpressure.
                        // With both flags bluer cannot wait for confirmations,
                        // which could queue an entire transfer inside BlueZ.
                        notify: false,
                        indicate: true,
                        method: CharacteristicNotifyMethod::Fun(Box::new(move |notifier| {
                            let gate = gate.clone();
                            let sender = sender.clone();
                            let events = events.clone();
                            let cancel = cancel.child_token();
                            let permits = permits.clone();
                            let workers = notification_workers.clone();
                            Box::pin(async move {
                                inc("incoming_notification_setup");
                                let Ok(permit) = permits.try_acquire_owned() else {
                                    inc("incoming_notification_busy");
                                    return;
                                };
                                let (tx, rx) = mpsc::channel(32);
                                {
                                    let Ok(mut g) = gate.lock() else { return };
                                    if g.is_some() {
                                        inc("incoming_notification_busy");
                                        return;
                                    }
                                    *g = Some(Ingress {
                                        tx,
                                        cancel: cancel.clone(),
                                    });
                                }
                                // bluer awaits this callback before replying to
                                // StartNotify. Return immediately after spawning
                                // an owned worker, so CCCD setup cannot deadlock
                                // waiting for the peer's subsequent request.
                                workers.spawn(async move {
                                let _permit=permit;
                                let _guard = SessionGuard(gate);
                                let id = format!("{:032x}", rand::random::<u128>());
                                let result = tokio::select! {
                                _=cancel.cancelled()=>Err(anyhow::anyhow!("cancelled")),r=timeout(SESSION_LIMIT,gatt_server(notifier,rx,sender.clone(),events.clone(),id.clone()))=>r.unwrap_or_else(|_|Err(anyhow::anyhow!("lifetime")))};
                                if result.is_err() {
                                    phase(&events, "gatt-session-failed");
                                    failed(&sender, &id, TransferKind::Inbound);
                                }
                                });
                            })
                        })),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };
    let handle = bounded(adapter.serve_gatt_application(app)).await?;
    Ok(GattService {
        _handle: handle,
        workers,
        cancel: shutdown,
    })
}
async fn gatt_server(
    mut notifier: CharacteristicNotifier,
    mut rx: mpsc::Receiver<(Address, Vec<u8>)>,
    sender: broadcast::Sender<ChannelMessage>,
    events: mpsc::Sender<Event>,
    id: String,
) -> Result<()> {
    phase(&events, "gatt-connection-pending");
    let (peer, packet) = timeout(Duration::from_secs(10), rx.recv())
        .await
        .inspect_err(|_| inc("weave_timeout"))?
        .ok_or_else(|| anyhow::anyhow!("closed"))?;
    inc("weave_requested");
    let mut weave = Weave::new();
    let confirm = weave
        .accept(&packet, true)
        .inspect_err(|_| inc("weave_failed"))?;
    timeout(DBUS, notifier.notify(confirm)).await??;
    phase(&events, "weave-established");
    let (core, bridge) = tokio::io::duplex(65536);
    let input = futures::stream::unfold(rx, move |mut rx| async move {
        rx.recv().await.map(|(addr, p)| {
            (
                if addr == peer {
                    Ok(p)
                } else {
                    Err(anyhow::anyhow!("foreign GATT peer"))
                },
                rx,
            )
        })
    })
    .boxed();
    let (output, mut packets) = mpsc::channel::<Vec<u8>>(8);
    let notifications = async {
        loop {
            tokio::select! {
                p=packets.recv()=>{let Some(p)=p else{return Ok(())};timeout(DBUS,notifier.notify(p)).await??;}
                _=tokio::time::sleep(Duration::from_secs(1))=>{ensure!(!notifier.is_stopped(),"notify stopped");}
            }
        }
    };
    session(inbound(core, sender, id, "ble-gatt"), async {
        tokio::try_join!(weave_bridge(weave, input, output, bridge), notifications)?;
        Ok(())
    })
    .await
}
/// Core completion can precede physical packet output. Drain the bounded
/// transport after the core closes its duplex, rather than dropping final
/// encrypted payload/decline/cancellation frames in a select race.
async fn session<C, T>(core: C, transport: T) -> Result<()>
where
    C: std::future::Future<Output = Result<()>>,
    T: std::future::Future<Output = Result<()>>,
{
    tokio::pin!(core, transport);
    tokio::select! {
        result=&mut core=>{result?;timeout(PEER_TIMEOUT,&mut transport).await?}
        result=&mut transport=>result,
    }
}
async fn inbound(
    core: DuplexStream,
    sender: broadcast::Sender<ChannelMessage>,
    id: String,
    method: &'static str,
) -> Result<()> {
    let _ = sender.send(ChannelMessage {
        id: id.clone(),
        msg: Message::Connection {
            kind: TransferKind::Inbound,
            method,
        },
    });
    let _outcome = OutcomeGuard {
        sender: sender.clone(),
        id: id.clone(),
        kind: TransferKind::Inbound,
        cancelled: None,
    };
    let mut r = InboundRequest::new(core, id, sender);
    loop {
        match timeout(PEER_TIMEOUT, r.handle()).await? {
            Ok(()) => {
                if matches!(
                    r.state.state,
                    TransferState::Finished
                        | TransferState::Sent
                        | TransferState::Cancelled
                        | TransferState::Rejected
                ) {
                    return Ok(());
                }
            }
            Err(e) => {
                if e.downcast_ref::<rqs_lib::errors::AppError>().is_some() {
                    return Ok(());
                }
                return Err(e);
            }
        }
    }
}
struct OutcomeGuard {
    sender: broadcast::Sender<ChannelMessage>,
    id: String,
    kind: TransferKind,
    cancelled: Option<CancellationToken>,
}
impl Drop for OutcomeGuard {
    fn drop(&mut self) {
        if self
            .cancelled
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
        {
            cancelled(&self.sender, &self.id, self.kind.clone());
        } else {
            failed(&self.sender, &self.id, self.kind.clone());
        }
    }
}
fn cancelled(sender: &broadcast::Sender<ChannelMessage>, id: &str, kind: TransferKind) {
    let _ = sender.send(ChannelMessage {
        id: id.into(),
        msg: Message::Client(MessageClient {
            kind,
            state: Some(TransferState::Cancelled),
            metadata: None,
        }),
    });
}
fn failed(sender: &broadcast::Sender<ChannelMessage>, id: &str, kind: TransferKind) {
    let _ = sender.send(ChannelMessage {
        id: id.into(),
        msg: Message::Client(MessageClient {
            kind,
            state: Some(TransferState::Disconnected),
            metadata: None,
        }),
    });
}
async fn outbound(
    core: DuplexStream,
    endpoint: [u8; 4],
    target: &Target,
    request: Send,
    sender: broadcast::Sender<ChannelMessage>,
) -> Result<()> {
    let _outcome = OutcomeGuard {
        sender: sender.clone(),
        id: request.id.clone(),
        kind: TransferKind::Outbound,
        cancelled: Some(request.cancel.clone()),
    };
    let mut r = OutboundRequest::new(
        endpoint,
        core,
        request.id,
        sender,
        OutboundPayload::Files(request.files),
        RemoteDeviceInfo {
            name: target.advert.name.clone(),
            device_type: target.advert.kind.clone(),
        },
    );
    r.set_mediums(vec![rqs_lib::location_nearby_connections::bandwidth_upgrade_negotiation_frame::upgrade_path_info::Medium::Ble as i32]);
    timeout(PEER_TIMEOUT, async {
        r.send_connection_request().await?;
        r.send_ukey2_client_init().await
    })
    .await??;
    loop {
        match timeout(PEER_TIMEOUT, r.handle()).await? {
            Ok(()) => {
                if matches!(
                    r.state.state,
                    TransferState::Finished
                        | TransferState::Sent
                        | TransferState::Cancelled
                        | TransferState::Rejected
                ) {
                    return Ok(());
                }
            }
            Err(e) => {
                if e.downcast_ref::<rqs_lib::errors::AppError>().is_some() {
                    return Ok(());
                }
                return Err(e);
            }
        }
    }
}
/// The same bounded state machine serves GATT client/server roles. Physical
/// characteristic I/O lives in the wrappers; tests exercise this state machine
/// with independent wire fixtures and adversarial fragment streams.
async fn weave_bridge<S: futures::Stream<Item = Result<Vec<u8>>> + Unpin>(
    mut weave: Weave,
    mut input: S,
    output: mpsc::Sender<Vec<u8>>,
    mut bridge: DuplexStream,
) -> Result<()> {
    for p in weave.packets(INTRO)? {
        timeout(DBUS, output.send(p)).await??;
    }
    let mut frames = Frames::default();
    let mut buffer = [0; 4096];
    let mut last_activity = Instant::now();
    let mut assembly_started = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tokio::select! {
            packet=input.next()=>{
                let packet=packet.ok_or_else(||anyhow::anyhow!("GATT closed"))??;
                last_activity=Instant::now();
                if packet.first().is_some_and(|h|h&8!=0) {assembly_started=Some(Instant::now());}
                if let Some(message)=weave.receive(&packet)? {
                    assembly_started=None;
                    if let Some(data)=socket_data(&message)? {
                        timeout(PEER_TIMEOUT,bridge.write_all(data)).await??;
                        for p in weave.packets(&acknowledgement(data.len())?)?{timeout(DBUS,output.send(p)).await??;}
                    }
                }
            }
            n=bridge.read(&mut buffer)=>{
                let n=n?;if n==0{return Ok(())}frames.push(&buffer[..n])?;last_activity=Instant::now();
                while let Some(frame)=frames.pop()?{
                    let mut message=HASH.to_vec();
                    message.extend(frame);
                    for p in weave.packets(&message)?{
                        timeout(DBUS,output.send(p)).await??;
                    }
                }
            }
            _=tick.tick()=>{
                ensure!(last_activity.elapsed()<PEER_TIMEOUT,"GATT idle timeout");
                ensure!(assembly_started.is_none_or(|t|t.elapsed()<Duration::from_secs(10)),"fragment assembly timeout");
            }
        }
    }
}
async fn characteristics(
    device: &bluer::Device,
    slots: u8,
) -> Result<(
    Option<Advert>,
    Option<(RemoteCharacteristic, RemoteCharacteristic)>,
)> {
    let mut found = None;
    let mut write = None;
    let mut notify = None;
    let mut service_found = false;
    for service in bounded(device.services()).await? {
        if bounded(service.uuid()).await? != SERVICE {
            continue;
        }
        service_found = true;
        inc("gatt_service_discovered");
        for c in bounded(service.characteristics()).await? {
            let uuid = bounded(c.uuid()).await?;
            let slot = (0..slots.min(15))
                .any(|s| uuid == Uuid::from_u128((s as u128) << 96 | 0x000030008000000000000000));
            if slot {
                inc("gatt_slot_found");
                match bounded(c.read()).await {
                    Ok(bytes) => {
                        inc("gatt_slot_read_success");
                        match Advert::decode(&bytes) {
                            Ok(a) if a.visible => {
                                inc("gatt_slot_decoded");
                                found = Some(a)
                            }
                            Ok(_) => {
                                inc("visibility_rejected");
                                inc("gatt_slot_rejected")
                            }
                            Err(e) => {
                                diag::reject("slot", &e);
                                inc("gatt_slot_rejected")
                            }
                        }
                    }
                    Err(_) => inc("gatt_slot_read_failure"),
                }
            }
            if uuid == WRITE.parse::<Uuid>()? && bounded(c.flags()).await?.write {
                inc("gatt_write_capability");
                write = Some(c.clone())
            }
            if uuid == NOTIFY.parse::<Uuid>()? {
                let flags = bounded(c.flags()).await?;
                if flags.notify {
                    inc("gatt_notify_capability")
                }
                if flags.indicate {
                    inc("gatt_indicate_capability")
                }
                if flags.notify || flags.indicate {
                    notify = Some(c)
                }
            }
        }
    }
    if !service_found {
        inc("gatt_service_missing")
    }
    inc(if write.is_some() && notify.is_some() {
        "gatt_characteristics_present"
    } else {
        "gatt_characteristics_missing"
    });
    Ok((found, write.zip(notify)))
}
async fn connect_gatt(device: &bluer::Device) -> Result<()> {
    inc("gatt_connection_attempted");
    match bounded(device.connect()).await {
        Ok(()) => {
            inc("gatt_connection_succeeded");
            Ok(())
        }
        Err(e) => {
            inc("gatt_connection_failed");
            Err(e)
        }
    }
}
async fn resolve(
    adapter: &Adapter,
    addr: Address,
    slots: u8,
    connections: &Connections,
) -> Result<(Option<Advert>, bool)> {
    let device = adapter.device(addr)?;
    ensure!(
        !{
            let connected = bounded(device.is_connected()).await?;
            if connected {
                inc("gatt_existing_acl_refused")
            }
            connected
        },
        "existing ACL not owned by us"
    );
    connections.claim(&device)?;
    let result = timeout(DBUS, async {
        connect_gatt(&device).await?;
        let (a, c) = characteristics(&device, slots).await?;
        Ok::<_, anyhow::Error>((a, c.is_some()))
    })
    .await;
    connections.release(&device).await;
    result.inspect_err(|_| {
        inc("gatt_resolution_timeout");
        inc("dbus_timeout");
    })?
}
async fn dial_gatt(
    adapter: Adapter,
    target: Target,
    endpoint: [u8; 4],
    request: Send,
    sender: broadcast::Sender<ChannelMessage>,
    events: mpsc::Sender<Event>,
    connections: Connections,
) -> Result<()> {
    phase(&events, "gatt-connection-pending");
    let device = adapter.device(target.addr)?;
    ensure!(
        !{
            let connected = bounded(device.is_connected()).await?;
            if connected {
                inc("gatt_existing_acl_refused")
            }
            connected
        },
        "existing ACL not owned by us"
    );
    connections.claim(&device)?;
    let result = timeout(SESSION_LIMIT, async {
        connect_gatt(&device).await?;
        let (advert, chars) = timeout(DBUS, characteristics(&device, 1)).await??;
        if let Some(a) = advert {
            ensure!(a.key() == target.advert.key(), "endpoint rotated");
        }
        let (write, notify) = chars.ok_or_else(|| anyhow::anyhow!("GATT transport missing"))?;
        let input = bounded(notify.notify()).await?;
        tokio::pin!(input);
        inc("weave_requested");
        bounded(write.write(&[0x80, 0, 1, 0, 1, 0, 20])).await?;
        let confirmation = timeout(Duration::from_secs(10), input.next())
            .await
            .inspect_err(|_| inc("weave_timeout"))?
            .ok_or_else(|| anyhow::anyhow!("GATT closed"))?;
        let mut weave = Weave::new();
        weave
            .accept(&confirmation, false)
            .inspect_err(|_| inc("weave_failed"))?;
        phase(&events, "weave-established");
        let _ = sender.send(ChannelMessage {
            id: request.id.clone(),
            msg: Message::Connection {
                kind: TransferKind::Outbound,
                method: "ble-gatt",
            },
        });
        let (core, bridge) = tokio::io::duplex(65536);
        let (output, mut packets) = mpsc::channel::<Vec<u8>>(8);
        let writes = async {
            while let Some(p) = packets.recv().await {
                bounded(write.write(&p)).await?;
            }
            Ok(())
        };
        session(outbound(core, endpoint, &target, request, sender), async {
            tokio::try_join!(weave_bridge(weave, input.map(Ok), output, bridge), writes)?;
            Ok(())
        })
        .await
    })
    .await;
    connections.release(&device).await;
    result?
}
fn advert(data: Vec<u8>, extended: bool) -> Advertisement {
    Advertisement {
        advertisement_type: Type::Peripheral,
        service_data: [(SERVICE, data)].into(),
        timeout: Some(Duration::from_secs(120)),
        secondary_channel: if extended {
            Some(SecondaryChannel::OneM)
        } else {
            None
        },
        ..Default::default()
    }
}
/// A partial dual registration must release its extended instance before
/// retrying a legacy-only header. The header never announces an extended
/// instance that was not successfully registered and retained.
async fn advertise_receiver<H, F, Fut>(
    full: &[u8],
    psm: Option<u16>,
    extended: bool,
    mut register: F,
) -> Result<(Vec<H>, &'static str)>
where
    F: FnMut(Advertisement) -> Fut,
    Fut: std::future::Future<Output = Result<H>>,
{
    let full_handle = if extended {
        register(advert(full.to_vec(), true)).await.ok()
    } else {
        None
    };
    if let Some(handle) = full_handle {
        if let Ok(legacy) = register(advert(header(full, true, psm), false)).await {
            return Ok((vec![handle, legacy], "dual"));
        }
        inc("advertisement_released");
        drop(handle);
        // Handle teardown schedules BlueZ UnregisterAdvertisement. Give that
        // task a turn before requesting the replacement instance.
        tokio::task::yield_now().await;
    }
    let legacy = register(advert(header(full, false, psm), false)).await?;
    Ok((vec![legacy], "compact-gatt"))
}

fn receiver_data_update(event: &bluer::DeviceEvent) -> bool {
    matches!(event,bluer::DeviceEvent::PropertyChanged(bluer::DeviceProperty::ServiceData(data)) if data.contains_key(&SERVICE))
}
type ScanStream = std::pin::Pin<Box<dyn futures::Stream<Item = AdapterEvent> + std::marker::Send>>;
/// Avoid bluer's unrestricted per-device watcher set and cache replay. Only
/// FEF3 ServiceData updates refresh known devices; at most 128 watchers live
/// during each short scan lease.
async fn scan_events(adapter: &Adapter) -> Result<ScanStream> {
    let addresses = bounded(adapter.device_addresses()).await?;
    if addresses.len() > 1024 {
        inc("scan_cache_limit")
    }
    ensure!(addresses.len() <= 1024, "Bluetooth cache limit");
    let known: HashSet<_> = addresses.into_iter().collect();
    let discovery = bounded(adapter.discover_devices()).await?.boxed();
    let changes: futures::stream::SelectAll<futures::stream::BoxStream<'static, Address>> =
        futures::stream::SelectAll::new();
    let adapter = adapter.clone();
    Ok(futures::stream::unfold((adapter,discovery,changes,HashSet::new(),known),|mut state|async move {
        loop {tokio::select! {
            event=state.1.next()=>match event {
                Some(AdapterEvent::DeviceAdded(addr))=>{
                    let cached=state.4.remove(&addr);if cached{inc("cache_replay_suppressed")}
                    if state.3.len()>=128{inc("scan_watcher_limit")}
                    if !state.3.contains(&addr) && state.3.len()<128
                        && let Ok(device)=state.0.device(addr) {
                            let relevant=!cached || bounded(device.service_data()).await.ok().flatten().is_some_and(|d|d.contains_key(&SERVICE));
                            if relevant && let Ok(events)=bounded(device.events()).await {
                                state.3.insert(addr);
                                state.2.push(events.filter_map(move |event|futures::future::ready(receiver_data_update(&event).then_some(addr))).boxed());
                            }
                        }
                    if !cached {return Some((AdapterEvent::DeviceAdded(addr),state));}
                }
                Some(AdapterEvent::DeviceRemoved(addr))=>{state.4.remove(&addr);return Some((AdapterEvent::DeviceRemoved(addr),state));}
                Some(_)=>{},None=>return None,
            },
            Some(addr)=state.2.next(),if !state.2.is_empty()=>return Some((AdapterEvent::DeviceAdded(addr),state)),
        }}
    }).boxed())
}

async fn run(
    local: ([u8; 4], &str),
    sender: &broadcast::Sender<ChannelMessage>,
    events: &mpsc::Sender<Event>,
    requests: &mut mpsc::Receiver<Send>,
    visibility: &mut watch::Receiver<bool>,
    cancel: CancellationToken,
    connections: Connections,
) -> Result<()> {
    let (endpoint_id, name) = local;
    let _cancel_on_return = cancel.clone().drop_guard();
    let session = bounded(bluer::Session::new()).await?;
    let adapter = bounded(session.default_adapter()).await?;
    if !bounded(adapter.is_powered()).await? {
        inc("adapter_powered_off");
        bail!("bluetooth off")
    }
    inc("adapter_ready");
    bounded(adapter.set_discovery_filter(bluer::DiscoveryFilter {
        // Some BlueZ/controller combinations omit ServiceData UUIDs from the
        // UUID discovery filter. Inspect FEF3 in received service data instead.
        uuids: Default::default(),
        transport: bluer::DiscoveryTransport::Le,
        duplicate_data: true,
        discoverable: false,
        ..Default::default()
    }))
    .await?;
    let mut state = initial();
    state["stage"] = json!("adapter-ready");
    let caps = probe().await;
    state["controller"] = caps.clone();
    let permits = Arc::new(Semaphore::new(4));
    let mut tasks = JoinSet::new();
    let l2cap = bind_l2cap(&adapter).await.ok();
    inc(if l2cap.is_some() {
        "l2cap_bind_success"
    } else {
        "l2cap_bind_failure"
    });
    let psm = l2cap.as_ref().map(|(_, p)| *p);
    let full = receiver(endpoint_id, name, psm)?;
    let app = application(
        &adapter,
        full.clone(),
        sender.clone(),
        events.clone(),
        cancel.clone(),
        permits.clone(),
        visibility.clone(),
    )
    .await
    .ok();
    inc(if app.is_some() {
        "gatt_registration_success"
    } else {
        "gatt_registration_failure"
    });
    state["gattBootstrap"] = json!(app.is_some());
    if app.is_none() {
        state["stage"] = json!("gatt-registration-failed");
    }
    state["l2cap"] = json!(psm.is_some());
    emit(events, &state);
    let mut advertisements = Vec::new();
    let mut scan: Option<
        std::pin::Pin<Box<dyn futures::Stream<Item = AdapterEvent> + std::marker::Send>>,
    > = None;
    let mut scan_started = Instant::now();
    let mut next_scan = Instant::now();
    let mut next_advert = Instant::now();
    // SupportedInstances already reports slots remaining, not a total.
    let mut extended_enabled = caps["extendedAdvertising"] == true
        && caps["advertisingInstances"].as_u64().unwrap_or(1) >= 2;
    let mut targets: HashMap<String, Target> = HashMap::new();
    let mut attempts: HashMap<Address, Instant> = HashMap::new();

    let mut headers: HashMap<Address, ([u8; 4], String)> = HashMap::new();
    let mut ticker = tokio::time::interval(Duration::from_millis(250));
    let mut last_health = Instant::now();
    loop {
        tokio::select! {
            _=cancel.cancelled()=>break,
            _=visibility.changed()=>{diag::current().count("advertisement_released",advertisements.len() as u64);advertisements.clear();next_advert=Instant::now();}
            _=tasks.join_next(),if !tasks.is_empty()=>{},
            _=ticker.tick()=>{
                let now=Instant::now();
                if now.duration_since(last_health)>=Duration::from_secs(2) {
                    match bounded(adapter.is_powered()).await{Ok(true)=>{},Ok(false)=>{inc("adapter_powered_off");bail!("adapter off")},Err(e)=>{if e.downcast_ref::<bluer::Error>().is_some_and(|e|matches!(e.kind,bluer::ErrorKind::DoesNotExist|bluer::ErrorKind::NotAvailable)){inc("adapter_disappeared")}else{inc("adapter_health_failed")}return Err(e)}}
                    last_health=now;
                }
                let expired:Vec<_>=targets.iter().filter(|(_,t)|now.duration_since(t.seen)>=TTL).map(|(k,_)|k.clone()).collect();
                for key in expired {
                    if let Some(t)=targets.remove(&key){inc("candidate_expired");
                    report(events,&t,false)}
                }
                state["ready"]=json!(targets.values().filter(|t|t.gatt||t.advert.psm.is_some()).count());
                attempts.retain(|_,at|now.duration_since(*at)<Duration::from_secs(10));headers.retain(|_,(_,key)|targets.contains_key(key));
                if now>=next_advert {
                    diag::current().count("advertisement_released",advertisements.len() as u64);advertisements.clear();state["bleAdvertising"]=json!(false);state["mode"]=json!("off");
                    if *visibility.borrow() && app.is_some() {
                        match advertise_receiver(&full,psm,extended_enabled,|a|async {inc("advertisement_registration_requested");let r=bounded(adapter.advertise(a)).await;inc(if r.is_ok(){"advertisement_registration_success"}else{"advertisement_registration_failure"});r}).await {
                            Ok((handles,mode))=>{
                                advertisements=handles;state["bleAdvertising"]=json!(true);state["mode"]=json!(mode);
                                if mode=="compact-gatt"{if extended_enabled{inc("advertisement_compact_fallback")}extended_enabled=false;}
                            }
                            Err(_)=>{extended_enabled=false;state["stage"]=json!("advertisement-registration-failed");}
                        }
                    }
                    next_advert=now+Duration::from_secs(if state["bleAdvertising"]==true || !*visibility.borrow(){30}else{2});emit(events,&state);
                }
                // Duty-cycle scanning to leave connection/advertising airtime. No
                // assumption that a controller can actively scan and advertise.
                if now>=next_scan {
                    if scan.is_some(){diag::current().scan_close(scan_started);inc("scan_pause_regular");scan=None;state["bleScanning"]=json!(false);next_scan=now+Duration::from_secs(7);}
                    else if permits.available_permits()==4 {
                        inc("scan_start_requested");match scan_events(&adapter).await{
                            Ok(s)=>{
                                inc("scan_start_success");diag::current().scan_open();scan_started=Instant::now();scan=Some(Box::pin(s));
                                state["bleScanning"]=json!(true);
                                next_scan=now+Duration::from_secs(3);
                            }
                            ,Err(_)=>{
                                inc("scan_start_failure");state["stage"]=json!("scan-start-failed");
                                next_scan=now+Duration::from_secs(7);
                            }
                        }
                    }
                    emit(events,&state);
                }
                if permits.available_permits()<4 && scan.is_some(){
                    diag::current().scan_close(scan_started);inc("scan_pause_session");scan=None;
                    state["bleScanning"]=json!(false);
                    next_scan=now+Duration::from_secs(7);
                    emit(events,&state);
                }
            }
            event=async{match scan.as_mut(){Some(s)=>s.next().await,None=>std::future::pending().await}}=>{
                let addr=match event{
                    Some(AdapterEvent::DeviceAdded(addr))=>addr,Some(AdapterEvent::DeviceRemoved(addr))=>{
                        let gone:Vec<_>=targets.iter().filter(|(_,t)|t.addr==addr).map(|(k,_)|k.clone()).collect();
                        for key in gone{
                            if let Some(t)=targets.remove(&key){inc("candidate_removed");
                            report(events,&t,false)}
                        }
                    continue}
                    ,Some(_)=>continue,None=>{inc("scan_event_stream_closed");diag::current().scan_close(scan_started);
                        scan=None;
                    continue}
                }
                ;
            let device=adapter.device(addr)?;
            let data=match bounded(device.service_data()).await{
            Ok(Some(data))=>data,_=>continue}
            ;
            let Some(bytes)=data.get(&SERVICE) else{
            continue}
            ;
                state["observed"]=json!(state["observed"].as_u64().unwrap_or(0).saturating_add(1));
                let (parsed,header_result)=diag::current().parse_observation(addr,bytes);
                let fast=parsed.is_ok()&&bytes.first().is_some_and(|b|b&2!=0);
                let h=header_result.ok();
                if parsed.is_err() && h.is_none(){emit(events,&state);continue}
                let now=Instant::now();let mut gatt=false;let mut resolved=false;
            if let Some(header)=&h
                && let Some((hash,key))=headers.get(&addr)
                    && *hash==header.hash&& let Some(target)=targets.get_mut(key){inc("header_cache_hit");target.seen=now;report(events,target,true);emit(events,&state);continue}
                let mut ad=parsed.ok();let fast_identity=if fast{ad.clone()}else{None};
                if fast{inc("fast_requires_gatt");}
                if ad.as_ref().is_none_or(|a|a.psm.is_none()) {
                    if attempts.contains_key(&addr) || attempts.len()>=100 {inc("gatt_resolution_throttled");emit(events,&state);continue}attempts.insert(addr,now);
                    // Drop our discovery lease during GATT resolution.
                    if scan.is_some(){diag::current().scan_close(scan_started)}inc("scan_pause_session");scan=None;state["bleScanning"]=json!(false);next_scan=now+Duration::from_secs(7);
                    inc("gatt_resolution_requested");phase(events,"gatt-resolution-pending");
                    match resolve(&adapter,addr,h.as_ref().map(|h|h.slots).unwrap_or(1),&connections).await {
                        Ok((slot,available))=>{
                            inc("gatt_resolution_success");gatt=available;resolved=slot.is_some();
                            if let Some(mut slot)=slot{
                                if fast_identity.as_ref().is_some_and(|f|!f.same_identity(&slot)){inc("fast_slot_mismatch");emit(events,&state);continue}
                                if let Some(h)=&h&& slot.psm.is_none(){
                                    slot.psm=h.psm;
                                }
                                ad=Some(slot);
                            }
                            if fast&&!resolved{inc("fast_metadata_unresolved");ad=None;}
                            if resolved{state["resolved"]=json!(state["resolved"].as_u64().unwrap_or(0).saturating_add(1));}
                        }
                        ,
                        Err(_)=>{inc("gatt_resolution_failure");phase(events,"gatt-resolution-failed");if fast{inc("fast_metadata_unresolved");ad=None;}
                        if ad.is_none(){continue}}
                    }
                }
                let Some(ad)=ad else{inc("transport_unavailable");emit(events,&state);continue};if !ad.visible{inc("visibility_rejected");emit(events,&state);continue}
                if ad.endpoint==endpoint_id{inc("self_suppressed");emit(events,&state);continue}inc("endpoint_decoded");inc(if ad.psm.is_some()||gatt{"transport_ready"}else{"transport_unavailable"});
                let key=ad.key();if targets.len()>=100 && !targets.contains_key(&key){inc("candidate_capacity_rejected");emit(events,&state);continue}
                let addr_type=match bounded(device.address_type()).await? {AddressType::BrEdr=>AddressType::LePublic,t=>t};
                let t=Target{
                advert:ad,addr,addr_type,gatt,resolved,seen:now}
                ;
                report(events,&t,true);
                if let Some(h)=h&& (headers.len()<100||headers.contains_key(&addr)){
                    headers.insert(addr,(h.hash,key.clone()));
                }
                targets.insert(key,t);
                state["decoded"]=json!(state["decoded"].as_u64().unwrap_or(0).saturating_add(1));
                state["ready"]=json!(targets.values().filter(|t|t.gatt||t.advert.psm.is_some()).count());
                emit(events,&state);
            }
            request=requests.recv()=>{
                let Some(request)=request else{break};
                if request.cancel.is_cancelled(){cancelled(sender,&request.id,TransferKind::Outbound);continue}
                if request.deadline<=Instant::now(){failed(sender,&request.id,TransferKind::Outbound);continue}
                let Some(target)=targets.get(&request.key).filter(|t|t.seen.elapsed()<TTL).cloned() else{
                    failed(sender,&request.id,TransferKind::Outbound);
                continue}
                ;
                let Ok(permit)=permits.clone().try_acquire_owned() else{failed(sender,&request.id,TransferKind::Outbound);continue};
                if scan.is_some(){diag::current().scan_close(scan_started)}inc("scan_pause_session");scan=None;state["bleScanning"]=json!(false);next_scan=Instant::now()+Duration::from_secs(7);
                let adapter=adapter.clone();
                let sender=sender.clone();
                let events=events.clone();
                let c=cancel.child_token();
                let connections=connections.clone();
                tasks.spawn(async move {
                    let _permit=permit;
                    let id=request.id.clone();let request_cancel=request.cancel.clone();let selected_address=target.addr;
                    let _outcome=OutcomeGuard{sender:sender.clone(),id:id.clone(),kind:TransferKind::Outbound,cancelled:Some(request_cancel.clone())};
                    phase(&events,if target.advert.psm.is_some(){
                    "l2cap-connection-pending"}
                    else{
                    "gatt-connection-pending"}
                    );
                    let result=tokio::select!{
                        _=c.cancelled()=>Err(anyhow::anyhow!("stopped")),_=request_cancel.cancelled()=>Err(anyhow::anyhow!("cancelled")),r=async {
                            if target.advert.psm.is_some(){
                            dial_l2cap(adapter,target,endpoint_id,request,sender.clone(),events.clone(),connections.clone()).await}
                            else{
                            dial_gatt(adapter,target,endpoint_id,request,sender.clone(),events.clone(),connections.clone()).await}
                        }
                    =>r}
                    ;
                    connections.release_address(selected_address).await;
                    if result.is_err(){phase(&events,"connection-failed");if request_cancel.is_cancelled(){cancelled(&sender,&id,TransferKind::Outbound);}else{failed(&sender,&id,TransferKind::Outbound);}}
                });
            }
            accepted=async{match &l2cap{Some((listener,_))=>listener.accept().await,None=>std::future::pending().await}}=>{
                let (socket,_)=accepted?;inc("l2cap_incoming");
                if !*visibility.borrow(){
                continue}
                let Ok(permit)=permits.clone().try_acquire_owned() else{
                continue}
                ;
                let full=full.clone();
                let sender=sender.clone();
                let events=events.clone();
                let c=cancel.child_token();
                tasks.spawn(async move {
                    let _permit=permit;
                    let id=format!("{:032x}",rand::random::<u128>());
                    let result=tokio::select!{
                    _=c.cancelled()=>Err(anyhow::anyhow!("stopped")),r=timeout(SESSION_LIMIT,serve_l2cap(socket,&full,sender.clone(),events.clone(),id.clone()))=>r.unwrap_or_else(|_|Err(anyhow::anyhow!("lifetime")))}
                    ;
                    if result.is_err(){
                        phase(&events,"l2cap-session-failed");
                        failed(&sender,&id,TransferKind::Inbound);
                    }
                }
                );
            }
        }
    }
    cancel.cancel();
    if scan.is_some() {
        diag::current().scan_close(scan_started)
    }
    drop(scan);
    diag::current().count("advertisement_released", advertisements.len() as u64);
    drop(advertisements);
    if let Some(app) = &app {
        app.cancel.cancel();
        app.workers.close();
        let _ = timeout(DBUS, app.workers.wait()).await;
    }
    drop(app);
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    for t in targets.values() {
        report(events, t, false)
    }
    Ok(())
}
async fn bind_l2cap(adapter: &Adapter) -> Result<(bluer::l2cap::StreamListener, u16)> {
    use bluer::l2cap::{Security, SecurityLevel};
    use bluer::l2cap::{Socket, SocketAddr, Stream};
    let socket = Socket::<Stream>::new_stream()?;
    socket.set_security(Security {
        level: SecurityLevel::Low,
        key_size: 0,
    })?;
    socket.set_recv_mtu(4096)?;
    socket.bind(SocketAddr::new(
        bounded(adapter.address()).await?,
        AddressType::LePublic,
        0,
    ))?;
    let listener = socket.listen(4)?;
    let psm = listener.as_ref().local_addr()?.psm;
    if !valid_psm(psm) {
        inc("l2cap_psm_rejected");
        bail!("invalid bound PSM")
    }
    inc("l2cap_psm_accepted");
    Ok((listener, psm))
}
async fn packet_read<S: AsyncRead + Unpin>(s: &mut S) -> Result<Vec<u8>> {
    let n = s.read_u32().await? as usize;
    ensure!(n > 0 && n <= MAX_MESSAGE, "medium packet length");
    let mut b = vec![0; n];
    s.read_exact(&mut b).await?;
    Ok(b)
}
async fn packet_write<S: AsyncWrite + Unpin>(s: &mut S, b: &[u8]) -> Result<()> {
    ensure!(b.len() <= MAX_MESSAGE, "medium packet size");
    s.write_u32(b.len() as u32).await?;
    s.write_all(b).await?;
    Ok(())
}
/// Public Nearby command grammar, with an additional Android u32 envelope.
/// The mode is fixed by the first byte and never guessed again mid-connection.
async fn l2cap_accept<S: AsyncRead + AsyncWrite + Unpin>(s: &mut S, full: &[u8]) -> Result<bool> {
    let first = s.read_u8().await?;
    let framed = first == 0;
    let mut first = Some(first);
    for _ in 0..8 {
        let packet = if framed {
            if first.take().is_some() {
                let mut suffix = [0; 3];
                s.read_exact(&mut suffix).await?;
                let n = u32::from_be_bytes([0, suffix[0], suffix[1], suffix[2]]) as usize;
                ensure!(n > 0 && n <= MAX_ADVERT + 3, "bootstrap packet length");
                let mut p = vec![0; n];
                s.read_exact(&mut p).await?;
                p
            } else {
                let p = packet_read(s).await?;
                ensure!(p.len() <= MAX_ADVERT + 3, "bootstrap packet length");
                p
            }
        } else {
            let cmd = match first.take() {
                Some(cmd) => cmd,
                None => s.read_u8().await?,
            };
            let mut p = vec![cmd];
            if cmd == 1 {
                let n = s.read_u16().await?;
                ensure!(n == 3, "service hash length");
                p.extend(n.to_be_bytes());
                let mut hash = [0; 3];
                s.read_exact(&mut hash).await?;
                p.extend(hash);
            }
            p
        };
        let response = match packet.as_slice() {
            [1, 0, 3, a, b, c] => {
                if [*a, *b, *c] == HASH {
                    let mut p = vec![21];
                    p.extend((full.len() as u16).to_be_bytes());
                    p.extend(full);
                    p
                } else {
                    vec![22]
                }
            }
            [2] => continue,
            [3] => {
                if framed {
                    packet_write(s, &[23]).await?
                } else {
                    s.write_all(&[23]).await?
                }
                return Ok(framed);
            }
            _ => bail!("invalid bootstrap state"),
        };
        if framed {
            packet_write(s, &response).await?
        } else {
            s.write_all(&response).await?
        }
    }
    bail!("bootstrap command limit")
}
async fn serve_l2cap(
    mut socket: bluer::l2cap::Stream,
    full: &[u8],
    sender: broadcast::Sender<ChannelMessage>,
    events: mpsc::Sender<Event>,
    id: String,
) -> Result<()> {
    let framed = timeout(Duration::from_secs(10), l2cap_accept(&mut socket, full))
        .await
        .inspect_err(|_| {
            inc("l2cap_bootstrap_rejected");
        })?
        .inspect_err(|_| inc("l2cap_bootstrap_rejected"))?;
    phase(&events, "l2cap-established");
    let (core, bridge) = tokio::io::duplex(65536);
    session(
        inbound(core, sender, id, "ble-l2cap"),
        socket_pump(socket, bridge, framed),
    )
    .await
}
async fn open_l2cap(
    adapter: &Adapter,
    target: &Target,
    framed: bool,
) -> Result<bluer::l2cap::Stream> {
    use bluer::l2cap::{Security, SecurityLevel};
    use bluer::l2cap::{Socket, SocketAddr, Stream};
    let psm = target
        .advert
        .psm
        .ok_or_else(|| anyhow::anyhow!("missing PSM"))?;
    if !valid_psm(psm) {
        inc("l2cap_psm_rejected");
        bail!("invalid PSM")
    }
    inc("l2cap_psm_accepted");
    let socket = Socket::<Stream>::new_stream()?;
    socket.set_security(Security {
        level: SecurityLevel::Low,
        key_size: 0,
    })?;
    socket.set_recv_mtu(4096)?;
    socket.bind(SocketAddr::new(
        bounded(adapter.address()).await?,
        AddressType::LePublic,
        0,
    ))?;
    inc("l2cap_connection_attempted");
    let connection = timeout(
        DBUS,
        socket.connect(SocketAddr::new(target.addr, target.addr_type, psm)),
    )
    .await;
    let mut stream = match connection {
        Ok(Ok(s)) => {
            inc("l2cap_connection_succeeded");
            s
        }
        Err(_) => {
            inc("l2cap_connection_failed");
            inc("l2cap_connection_timeout");
            bail!("LE CoC timeout")
        }
        Ok(Err(e)) => {
            inc("l2cap_connection_failed");
            inc(match e.kind() {
                std::io::ErrorKind::PermissionDenied => "l2cap_connection_permission_denied",
                std::io::ErrorKind::ConnectionRefused => "l2cap_connection_refused",
                _ => "l2cap_connection_io_error",
            });
            bail!("LE CoC connect failed")
        }
    };
    timeout(DBUS, async {
        if framed {
            packet_write(&mut stream, &[3]).await?;
            ensure!(
                packet_read(&mut stream).await? == [23],
                "data connection refused"
            );
        } else {
            stream.write_all(&[3]).await?;
            ensure!(stream.read_u8().await? == 23, "data connection refused");
        }
        Ok::<_, anyhow::Error>(())
    })
    .await??;
    Ok(stream)
}
async fn dial_l2cap(
    adapter: Adapter,
    target: Target,
    endpoint: [u8; 4],
    request: Send,
    sender: broadcast::Sender<ChannelMessage>,
    events: mpsc::Sender<Event>,
    connections: Connections,
) -> Result<()> {
    // Resolve the selected ephemeral identity, never a device name. A stale
    // PSM fails boundedly and requires fresh discovery; no arbitrary port scan.
    let (socket, framed) = match open_l2cap(&adapter, &target, true).await {
        Ok(s) => (s, true),
        Err(_) => match open_l2cap(&adapter, &target, false).await {
            Ok(s) => (s, false),
            Err(_) => {
                return dial_gatt(
                    adapter,
                    target,
                    endpoint,
                    request,
                    sender,
                    events,
                    connections,
                )
                .await;
            }
        },
    };
    phase(&events, "l2cap-established");
    let _ = sender.send(ChannelMessage {
        id: request.id.clone(),
        msg: Message::Connection {
            kind: TransferKind::Outbound,
            method: "ble-l2cap",
        },
    });
    let (core, bridge) = tokio::io::duplex(65536);
    timeout(
        SESSION_LIMIT,
        session(
            outbound(core, endpoint, &target, request, sender),
            socket_pump(socket, bridge, framed),
        ),
    )
    .await?
}
/// All reads in the select are cancellation-safe. Each complete frame is
/// validated before it crosses the bounded duplex into the existing session.
async fn socket_pump<S: AsyncRead + AsyncWrite + Unpin>(
    mut socket: S,
    mut bridge: DuplexStream,
    framed: bool,
) -> Result<()> {
    if framed {
        timeout(DBUS, packet_write(&mut socket, INTRO)).await??;
    }
    let mut incoming = Frames::default();
    let mut outgoing = Frames::default();
    let mut rx = [0; 4096];
    let mut tx = [0; 4096];
    loop {
        tokio::select! {
            n=timeout(PEER_TIMEOUT,socket.read(&mut rx))=>{
                let n=n??;
                ensure!(n>0,"socket closed");
                incoming.push(&rx[..n])?;
                while let Some(frame)=incoming.pop()?{
                let data=if framed{
                socket_data(&frame[4..])?}
                else{
                Some(frame.as_slice())}
                ;
                if let Some(data)=data{
                    timeout(PEER_TIMEOUT,bridge.write_all(data)).await??;
                    if framed{
                        timeout(DBUS,packet_write(&mut socket,&acknowledgement(data.len())?)).await??;
                    }
                }
            }}
            n=bridge.read(&mut tx)=>{let n=n?;if n==0{return Ok(())}outgoing.push(&tx[..n])?;while let Some(frame)=outgoing.pop()?{
                timeout(PEER_TIMEOUT,async {
                    if framed{
                        let mut message=HASH.to_vec();
                        message.extend(frame);
                    packet_write(&mut socket,&message).await}
                    else{
                        socket.write_all(&frame).await?;
                    Ok(())}
                }
                ).await??;
            }}
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(start_paused = true)]
    async fn dbus_errors_are_categorized_without_exporting_messages() {
        let before = diag::current().snapshot();
        let failure = bluer::Error {
            kind: bluer::ErrorKind::NotAuthorized,
            message: "AA:BB:CC:DD:EE:FF private-file.txt token-secret".into(),
        };
        assert!(bounded(async { Err::<(), _>(failure) }).await.is_err());
        assert!(
            bounded(std::future::pending::<Result<(), bluer::Error>>())
                .await
                .is_err()
        );
        let after = diag::current().snapshot();
        assert!(
            after["counters"]["dbus_permission_denied"]
                .as_u64()
                .unwrap()
                > before["counters"]["dbus_permission_denied"]
                    .as_u64()
                    .unwrap_or(0)
        );
        assert!(
            after["counters"]["dbus_timeout"].as_u64().unwrap()
                > before["counters"]["dbus_timeout"].as_u64().unwrap_or(0)
        );
        assert!(!after.to_string().contains("private"));
    }
    #[tokio::test]
    async fn independent_l2cap_command_peer() {
        for framed in [false, true] {
            let (mut server, mut peer) = tokio::io::duplex(1024);
            let full = receiver(*b"AB12", "Linux", None).unwrap();
            let expected = full.clone();
            let task = tokio::spawn(async move { l2cap_accept(&mut server, &full).await.unwrap() });
            // Fixed independently encoded Google command bytes.
            if framed {
                peer.write_all(&[0, 0, 0, 6, 1, 0, 3, 0xfc, 0x9f, 0x5e])
                    .await
                    .unwrap();
                let p = packet_read(&mut peer).await.unwrap();
                assert_eq!(&p[3..], &expected);
                peer.write_all(&[0, 0, 0, 1, 2, 0, 0, 0, 1, 3])
                    .await
                    .unwrap();
                assert_eq!(packet_read(&mut peer).await.unwrap(), [23]);
            } else {
                peer.write_all(&[1, 0, 3, 0xfc, 0x9f, 0x5e]).await.unwrap();
                assert_eq!(peer.read_u8().await.unwrap(), 21);
                let n = peer.read_u16().await.unwrap();
                let mut b = vec![0; n as usize];
                peer.read_exact(&mut b).await.unwrap();
                assert_eq!(b, expected);
                peer.write_all(&[2, 3]).await.unwrap();
                assert_eq!(peer.read_u8().await.unwrap(), 23);
            }
            assert_eq!(task.await.unwrap(), framed);
        }
    }
    #[tokio::test]
    async fn malformed_l2cap_bootstrap_fails_closed() {
        let (mut s, mut p) = tokio::io::duplex(32);
        p.write_all(&[1, 255, 255]).await.unwrap();
        assert!(l2cap_accept(&mut s, &[]).await.is_err());
    }
    #[test]
    fn legacy_advertisement_has_no_unserved_psm() {
        let f = receiver(*b"AB12", "Linux", None).unwrap();
        let a = advert(header(&f, false, None), false);
        assert_eq!(a.advertisement_type, Type::Peripheral);
        assert!(a.service_data[&SERVICE].len() + 4 + 3 <= 31);
        assert!(a.secondary_channel.is_none());
    }
    fn fixture_stream(
        rx: mpsc::Receiver<Result<Vec<u8>>>,
    ) -> impl futures::Stream<Item = Result<Vec<u8>>> + Unpin {
        futures::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|v| (v, rx)) })
            .boxed()
    }
    fn connected_weave() -> Weave {
        let mut w = Weave::new();
        w.accept(&[0x80, 0, 1, 0, 1, 0, 20], true).unwrap();
        w
    }
    #[tokio::test]
    async fn independent_fragments_cross_the_real_bounded_bridge_and_are_acknowledged() {
        let (tx, rx) = mpsc::channel(4);
        let (output, mut packets) = mpsc::channel(8);
        let (mut core, bridge) = tokio::io::duplex(1024);
        let task = tokio::spawn(weave_bridge(
            connected_weave(),
            fixture_stream(rx),
            output,
            bridge,
        ));
        let mut intro = vec![0x1c];
        intro.extend(INTRO);
        assert_eq!(packets.recv().await.unwrap(), intro);
        // Fixed Python-oracle packets, independent of the Rust packet encoder.
        tx.send(Ok(vec![
            0x18, 0xfc, 0x9f, 0x5e, 0, 0, 0, 17, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
        ]))
        .await
        .unwrap();
        tx.send(Ok(vec![0x24, 12, 13, 14, 15, 16])).await.unwrap();
        let mut received = [0; 21];
        core.read_exact(&mut received).await.unwrap();
        assert_eq!(&received[..4], &[0, 0, 0, 17]);
        assert_eq!(&received[4..], &(0..17).collect::<Vec<u8>>());
        assert_eq!(
            packets.recv().await.unwrap(),
            [
                0x2c, 0, 0, 0, 8, 3, 0x22, 7, 0xa, 3, 0xfc, 0x9f, 0x5e, 0x10, 21
            ]
        );
        core.write_all(&[0, 0]).await.unwrap();
        tokio::task::yield_now().await;
        core.write_all(&[0, 1, 9]).await.unwrap();
        assert_eq!(
            packets.recv().await.unwrap(),
            [0x3c, 0xfc, 0x9f, 0x5e, 0, 0, 0, 1, 9]
        );
        drop(core);
        assert!(task.await.unwrap().is_ok());
    }
    #[tokio::test(start_paused = true)]
    async fn incomplete_weave_message_has_a_fixed_deadline() {
        let (tx, rx) = mpsc::channel(4);
        let (output, mut packets) = mpsc::channel(8);
        let (_core, bridge) = tokio::io::duplex(1024);
        let task = tokio::spawn(weave_bridge(
            connected_weave(),
            fixture_stream(rx),
            output,
            bridge,
        ));
        packets.recv().await.unwrap();
        tx.send(Ok(vec![0x18, 1])).await.unwrap();
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(11)).await;
        assert!(
            task.await
                .unwrap()
                .unwrap_err()
                .to_string()
                .contains("assembly timeout")
        );
    }
    #[tokio::test(start_paused = true)]
    async fn silent_gatt_peer_and_closed_notifications_do_not_leak_sessions() {
        let (_tx, rx) = mpsc::channel(4);
        let (output, mut packets) = mpsc::channel(8);
        let (_core, bridge) = tokio::io::duplex(1024);
        let task = tokio::spawn(weave_bridge(
            connected_weave(),
            fixture_stream(rx),
            output,
            bridge,
        ));
        packets.recv().await.unwrap();
        tokio::time::advance(Duration::from_secs(61)).await;
        assert!(task.await.unwrap().is_err());
        let (_tx, rx) = mpsc::channel(4);
        let (output, packets) = mpsc::channel(8);
        drop(packets);
        let (_core, bridge) = tokio::io::duplex(1024);
        assert!(
            weave_bridge(connected_weave(), fixture_stream(rx), output, bridge)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn unsupported_bluez_start_stop_remains_bounded_and_repeatable() {
        // A real D-Bus attempt, not a mocked successful controller. On machines
        // without BlueZ it must fail gracefully; this is not radio validation.
        let (sender, _) = broadcast::channel(10);
        let (events, _) = mpsc::channel(128);
        for _ in 0..3 {
            let mut runtime =
                Runtime::start(*b"AB12", "Linux".into(), sender.clone(), events.clone());
            tokio::task::yield_now().await;
            timeout(Duration::from_secs(3), runtime.stop())
                .await
                .unwrap();
            runtime.stop().await;
        }
    }
    #[test]
    fn gatt_only_target_is_selectable_without_a_psm_and_expires() {
        let advert = Advert::decode(&receiver(*b"AB12", "Galaxy", None).unwrap()).unwrap();
        let mut target = Target {
            advert,
            addr: Address::any(),
            addr_type: AddressType::LeRandom,
            gatt: true,
            resolved: true,
            seen: Instant::now(),
        };
        let e = endpoint(&target, true);
        assert_eq!(e.connectable, Some(true));
        assert_eq!(e.transport.as_deref(), Some("ble-gatt"));
        assert!(e.ble_addr.is_none());
        assert!(e.ble_psm.is_none());
        target.seen = Instant::now() - TTL;
        assert!(target.seen.elapsed() >= TTL);
        target.resolved = false;
        assert_eq!(
            endpoint(&target, true).discovery_stage.as_deref(),
            Some("endpoint-decoded")
        );
        assert_eq!(endpoint(&target, true).connectable, Some(true));
        target.gatt = false;
        assert_eq!(endpoint(&target, true).connectable, Some(false));
    }
    #[tokio::test]
    async fn oversized_l2cap_frame_is_rejected_before_allocation() {
        let (socket, mut peer) = tokio::io::duplex(64);
        let (_core, bridge) = tokio::io::duplex(64);
        let task = tokio::spawn(socket_pump(socket, bridge, true));
        assert_eq!(packet_read(&mut peer).await.unwrap(), INTRO);
        peer.write_all(&u32::MAX.to_be_bytes()).await.unwrap();
        assert!(task.await.unwrap().is_err());
    }
    #[tokio::test]
    async fn session_completion_drains_final_bytes_before_closing_the_transport() {
        let (socket, mut peer) = tokio::io::duplex(64);
        let (mut core, bridge) = tokio::io::duplex(64);
        let bytes = vec![0x5a; 16384];
        let expected = bytes.clone();
        let task = tokio::spawn(session(
            async move {
                core.write_u32(bytes.len() as u32).await?;
                core.write_all(&bytes).await?;
                Ok(())
            },
            socket_pump(socket, bridge, true),
        ));
        assert_eq!(packet_read(&mut peer).await.unwrap(), INTRO);
        let message = packet_read(&mut peer).await.unwrap();
        let data = socket_data(&message).unwrap().unwrap();
        assert_eq!(&data[4..], &expected);
        assert!(task.await.unwrap().is_ok());
    }
    #[test]
    fn cancelling_a_pending_transport_preserves_cancelled_instead_of_failure() {
        let (sender, mut events) = broadcast::channel(8);
        let token = CancellationToken::new();
        let guard = OutcomeGuard {
            sender,
            id: "pending".into(),
            kind: TransferKind::Outbound,
            cancelled: Some(token.clone()),
        };
        token.cancel();
        drop(guard);
        let event = events.try_recv().unwrap();
        let Message::Client(message) = event.msg else {
            panic!("wrong event")
        };
        assert_eq!(message.state, Some(TransferState::Cancelled));
    }
    #[tokio::test]
    async fn partial_dual_registration_releases_full_before_compact_fallback() {
        struct Handle {
            number: usize,
            dropped: Arc<Mutex<Vec<usize>>>,
        }
        impl Drop for Handle {
            fn drop(&mut self) {
                self.dropped.lock().unwrap().push(self.number);
            }
        }
        let full = receiver(*b"AB12", "Linux", None).unwrap();
        let dropped = Arc::new(Mutex::new(Vec::new()));
        let mut calls = 0;
        let (handles, mode) = advertise_receiver(&full, None, true, |a| {
            calls += 1;
            if calls == 1 {
                assert!(a.secondary_channel.is_some());
            }
            if calls == 2 {
                assert_eq!(a.service_data[&SERVICE][0] & 16, 16);
                return std::future::ready(Err(anyhow::anyhow!("second instance unavailable")));
            }
            if calls == 3 {
                assert_eq!(*dropped.lock().unwrap(), [1]);
                assert!(a.secondary_channel.is_none());
                assert_eq!(a.service_data[&SERVICE][0] & 16, 0);
            }
            std::future::ready(Ok(Handle {
                number: calls,
                dropped: dropped.clone(),
            }))
        })
        .await
        .unwrap();
        assert_eq!(calls, 3);
        assert_eq!(mode, "compact-gatt");
        assert_eq!(handles.len(), 1);
        drop(handles);
        assert_eq!(*dropped.lock().unwrap(), [1, 3]);
    }
    #[tokio::test]
    async fn unsupported_controller_modes_never_claim_an_unregistered_advertisement() {
        let full = receiver(*b"AB12", "Linux", None).unwrap();
        let mut calls = 0;
        let (handles, mode) = advertise_receiver(&full, None, true, |a| {
            calls += 1;
            std::future::ready(if a.secondary_channel.is_some() {
                Err(anyhow::anyhow!("extended unsupported"))
            } else {
                Ok(calls)
            })
        })
        .await
        .unwrap();
        assert_eq!(calls, 2);
        assert_eq!(mode, "compact-gatt");
        assert_eq!(handles, [2]);
        let mut calls = 0;
        let result = advertise_receiver(&full, None, false, |a| {
            calls += 1;
            assert!(a.secondary_channel.is_none());
            std::future::ready(Err::<usize, _>(anyhow::anyhow!("advertising unsupported")))
        })
        .await;
        assert!(result.is_err());
        assert_eq!(calls, 1);
    }
    #[test]
    fn unrelated_rssi_changes_cannot_keep_a_cached_receiver_alive() {
        use bluer::{DeviceEvent, DeviceProperty};
        assert!(!receiver_data_update(&DeviceEvent::PropertyChanged(
            DeviceProperty::Rssi(-20)
        )));
        assert!(!receiver_data_update(&DeviceEvent::PropertyChanged(
            DeviceProperty::Connected(true)
        )));
        assert!(!receiver_data_update(&DeviceEvent::PropertyChanged(
            DeviceProperty::ServiceData([(Uuid::nil(), vec![1])].into())
        )));
        assert!(receiver_data_update(&DeviceEvent::PropertyChanged(
            DeviceProperty::ServiceData([(SERVICE, vec![0x41])].into())
        )));
    }
}
