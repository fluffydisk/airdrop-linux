// GPL-3.0-only. Opt-in experimental BLE bootstrap; unrelated upstream wireless
// modules remain disabled. See docs/quickshare-ble-implementation.md.
#![cfg_attr(not(feature = "ble-native"), allow(dead_code, unused_imports))]
mod bloom;
pub mod protocol;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod radio;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
pub use radio::*;

#[cfg(all(feature = "ble-native", target_os = "linux"))]
pub mod diagnostics;

#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod advertising;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod discovery;

#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod classic;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
#[allow(dead_code)]
mod classic_inquiry;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod l2cap_completion;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod l2cap_sdu;
#[cfg(all(feature = "ble-native", target_os = "linux"))]
mod l2cap_transport;
