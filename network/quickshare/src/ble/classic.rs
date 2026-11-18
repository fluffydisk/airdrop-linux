// GPL-3.0-only. Native Nearby Bluetooth Classic listener. Own the RFCOMM socket
// ourselves; the BlueZ profile publishes only its matching SDP record. No radio,
// discoverability, pairing, agent or device-connection settings are changed.
use anyhow::{Result, ensure};
use bluer::{
    Adapter, Session, Uuid,
    rfcomm::{Listener, Profile, ProfileHandle, Role, Security, SecurityLevel, Socket, SocketAddr},
};
use tokio::time::{Duration, timeout};

// google/nearby Uuid("NearbySharing"): MD5 with Java name-UUID v3/variant bits.
pub(super) const SERVICE_UUID: &str = "a82efa21-ae5c-3dde-9bbc-f16da7b16c5a";
pub(super) fn profile(channel: u8) -> Result<Profile> {
    ensure!((1..=30).contains(&channel), "invalid RFCOMM channel");
    let uuid: Uuid = SERVICE_UUID.parse()?;
    Ok(Profile {
        uuid,
        name: Some("NearbySharing".into()),
        role: Some(Role::Server),
        require_authentication: Some(false),
        require_authorization: Some(false),
        auto_connect: Some(false),
        // Do not set Channel/PSM options: those would make BlueZ bind a second
        // listener. The application already owns this exact channel/socket.
        service_record: Some(format!(
            r#"<record>
<attribute id="0x0001"><sequence><uuid value="{SERVICE_UUID}"/></sequence></attribute>
<attribute id="0x0004"><sequence><sequence><uuid value="0x0100"/></sequence><sequence><uuid value="0x0003"/><uint8 value="0x{channel:02x}"/></sequence></sequence></attribute>
<attribute id="0x0005"><sequence><uuid value="0x1002"/></sequence></attribute>
<attribute id="0x0100"><text value="NearbySharing"/></attribute>
</record>"#
        )),
        ..Default::default()
    })
}
pub(super) struct Classic {
    pub listener: Listener,
    pub address: [u8; 6],
    _record: ProfileHandle,
}
async fn publish_record(session: &Session, channel: u8) -> Result<ProfileHandle> {
    Ok(timeout(
        Duration::from_secs(5),
        session.register_profile(profile(channel)?),
    )
    .await??)
}
impl Classic {
    pub async fn bind(session: &Session, adapter: &Adapter) -> Result<Self> {
        // ProfileManager publishes SDP on all adapters. Keep this first native
        // implementation scoped to a single-controller setup rather than
        // publishing an unusable channel on an unrelated adapter.
        ensure!(
            timeout(Duration::from_secs(5), session.adapter_names())
                .await??
                .len()
                == 1,
            "ambiguous classic adapter"
        );
        let address = timeout(Duration::from_secs(5), adapter.address()).await??;
        let socket = Socket::new()?;
        socket.set_security(Security {
            level: SecurityLevel::Low,
            key_size: 0,
        })?;
        socket.bind(SocketAddr::new(address, 0))?;
        let listener = socket.listen(4)?;
        let channel = listener.as_ref().local_addr()?.channel;
        let record = publish_record(session, channel).await?;
        Ok(Self {
            listener,
            address: address.0,
            _record: record,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_record_matches_nearby_uuid_and_owned_channel_without_auto_connection() {
        let p = profile(7).unwrap();
        assert_eq!(p.uuid.to_string(), SERVICE_UUID);
        assert_eq!(p.channel, None);
        assert_eq!(p.psm, None);
        assert_eq!(p.require_authentication, Some(false));
        assert_eq!(p.require_authorization, Some(false));
        assert_eq!(p.auto_connect, Some(false));
        let record = p.service_record.unwrap();
        assert!(
            record.contains(SERVICE_UUID) && record.contains("0x0003") && record.contains("0x07")
        );
        assert!(profile(0).is_err() && profile(31).is_err());
    }
}

#[cfg(test)]
#[path = "classic_test.rs"]
mod registration_tests;
