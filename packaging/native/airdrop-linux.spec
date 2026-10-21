Name: airdrop-linux
Version: @VERSION@
Release: 1
Summary: Private file and clipboard sharing over Tailscale
License: MIT
URL: https://github.com/fluffydisk/airdrop-linux
Source0: payload.tar.gz
AutoReqProv: no
Requires: glibc >= 2.39, systemd, dbus
Requires: libgtk-3.so.0()(64bit), libnss3.so()(64bit), libnspr4.so()(64bit), libasound.so.2()(64bit)
Requires: libatspi.so.0()(64bit)
Requires: libatk-1.0.so.0()(64bit), libatk-bridge-2.0.so.0()(64bit), libcups.so.2()(64bit)
Requires: libdrm.so.2()(64bit), libgbm.so.1()(64bit), libX11.so.6()(64bit), libxcb.so.1()(64bit)
Requires: libXcomposite.so.1()(64bit), libXdamage.so.1()(64bit), libXext.so.6()(64bit), libXfixes.so.3()(64bit)
Requires: libXrandr.so.2()(64bit), libxkbcommon.so.0()(64bit), libstdc++.so.6()(64bit), libgcc_s.so.1()(64bit)

%description
Electron desktop, local Node gateway, CLI and dufs file server.
Tailscale is configured separately on the host.

%prep
%build
%install
mkdir -p %{buildroot}
tar -xzf %{SOURCE0} -C %{buildroot}

%post
if command -v apparmor_parser >/dev/null && test -d /sys/kernel/security/apparmor; then
  apparmor_parser --replace /etc/apparmor.d/airdrop-linux
fi

%preun
if [ "$1" -eq 0 ] && command -v loginctl >/dev/null; then
  loginctl list-users --no-legend 2>/dev/null | while read -r uid user rest; do
    systemctl --user --machine="$user@.host" disable --now airdrop-linux.target || true
  done
fi

%posttrans
if command -v loginctl >/dev/null; then
  loginctl list-users --no-legend 2>/dev/null | while read -r uid user rest; do
    systemctl --user --machine="$user@.host" daemon-reload || true
    systemctl --user --machine="$user@.host" try-restart airdrop-linux-backend.service || true
  done
fi

%files
/usr/bin/airdrop
/usr/bin/airdrop-desktop
/usr/lib/airdrop-linux/
/usr/lib/systemd/user/airdrop-linux*
/usr/share/applications/io.github.fluffydisk.Airdrop.desktop
/usr/share/metainfo/io.github.fluffydisk.Airdrop.metainfo.xml
/usr/share/doc/airdrop-linux/
/usr/share/icons/hicolor/192x192/apps/io.github.fluffydisk.Airdrop.png
%license /usr/share/licenses/airdrop-linux/LICENSE
%config(noreplace) /etc/apparmor.d/airdrop-linux
