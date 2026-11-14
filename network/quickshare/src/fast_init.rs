// GPL-3.0-only. Airdrop Linux development FastInit experiment, 2026-11-10.
// Advertisement bytes/protocol reference: open-quickshare@fb9c8f9
// core_lib/src/hdl/blea.rs (GPL). No scanner, GATT, L2CAP or network management.
use bluer::UuidExt;
use bluer::adv::{Advertisement, AdvertisementHandle, Type};
use std::time::Duration;

const DATA: [u8; 24] = [
    252, 18, 142, 1, 66, 0, 0, 0, 0, 0, 0, 0, 0, 0, 191, 45, 91, 160, 225, 216, 117, 36, 202, 0,
];

pub struct FastInit {
    _session: bluer::Session,
    _advertisement: AdvertisementHandle,
}

fn advertisement() -> Advertisement {
    Advertisement {
        advertisement_type: Type::Broadcast,
        service_data: [(bluer::Uuid::from_u16(0xFE2C), DATA.to_vec())].into(),
        timeout: Some(Duration::from_secs(120)),
        ..Default::default()
    }
}

fn error_code(error: bluer::Error) -> &'static str {
    match error.kind {
        bluer::ErrorKind::NotAuthorized | bluer::ErrorKind::NotPermitted => "permission-denied",
        bluer::ErrorKind::NotSupported => "not-supported",
        bluer::ErrorKind::NotReady => "bluetooth-off",
        bluer::ErrorKind::InProgress => "adapter-busy",
        bluer::ErrorKind::DoesNotExist | bluer::ErrorKind::NotAvailable => "no-adapter",
        _ => "bluez-operation-failed",
    }
}

pub async fn register() -> Result<FastInit, &'static str> {
    let session = bluer::Session::new()
        .await
        .map_err(|_| "bluez-unavailable")?;
    let adapter = session.default_adapter().await.map_err(error_code)?;
    // Never power/unblock a controller or change discoverability/scanning.
    if !adapter.is_powered().await.map_err(error_code)? {
        return Err("bluetooth-off");
    }
    let handle = adapter
        .advertise(advertisement())
        .await
        .map_err(error_code)?;
    Ok(FastInit {
        _session: session,
        _advertisement: handle,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fastinit_is_bounded_broadcast_not_a_receiver_endpoint() {
        let value = advertisement();
        assert_eq!(value.advertisement_type, Type::Broadcast);
        assert_eq!(value.timeout, Some(Duration::from_secs(120)));
        assert_eq!(value.service_data.len(), 1);
        assert_eq!(value.service_data[&bluer::Uuid::from_u16(0xFE2C)].len(), 24);
        assert!(
            !value
                .service_data
                .contains_key(&bluer::Uuid::from_u16(0xFEF3))
        );
        assert!(value.local_name.is_none());
    }

    #[test]
    fn diagnostics_classify_policy_without_exporting_bluez_messages() {
        assert_eq!(
            error_code(bluer::Error {
                kind: bluer::ErrorKind::NotAuthorized,
                message: "private address and device name".into()
            }),
            "permission-denied"
        );
    }
}
