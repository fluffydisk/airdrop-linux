# S24+ ve iPad Air 5 fiziksel cihaz testi

Test araçları Linux bilgisayarda çalışır. Her çalıştırma ev dizininde ayrı bir klasör ve paylaşılabilir bir `report.json` üretir. Deneme sırasında kurulu uygulamadaki Quick Share alıcısını kapat.

## Kurulum

x86_64 için [GitHub Actions test paketi](https://github.com/fluffydisk/airdrop-linux/actions/workflows/device-test-kit.yml) içindeki son başarılı çalışmanın **Artifacts → linux-device-tests-x64** dosyasını indir. GitHub indirme için oturum açmanı isteyebilir. ZIP içindeki `linux-device-tests-x64.tar.gz` dosyasını boş bir klasöre aç. Aşağıdaki komutları bu klasörde çalıştır. Samsung aracı Node.js 22 veya üstü ve çalışan BlueZ gerektirir.

Kaynak kodundan çalıştırmak için Linux üzerinde Node.js, git, protobuf derleyicisi, pkg-config, C derleyicisi ve rustup gereklidir. Depoyu klonladıktan sonra kök dizinde `node scripts/build-quickshare.js --ble-native` komutunu çalıştır. Rust sürümü depoda sabitlenmiştir.

## Samsung → Linux

İki cihazı aynı yerel ağa bağla. Bilgisayarda çalıştır:

```sh
node scripts/test-s24-receive.cjs
```

S24+ üzerinde Quick Share ile **Linux Quick Share Test** alıcısına önce tek bir dosya gönder. Telefonda görünen onay kodunu bilgisayarda gir. Ardından daha önce sorun çıkaran iki dosyayı birlikte gönder. Durursa yaklaşık bir dakika sonra Ctrl+C ile kapat ve raporu al. İkinci denemede şu komut Linux'un Classic servisini kaydetmeden BLE başlangıcını denetler. Doğrudan LAN yolu hâlâ kullanılabilir.

```sh
node scripts/test-s24-receive.cjs --ble-only
```

Raporda `route` ilk bağlantıyı, `bwu-lan-offered` Wi-Fi teklifini, `bwu-lan-active` kanal geçişini, `bwu-lan-file-data` ise yeni kanalda şifreli dosya verisinin çözüldüğünü gösterir. Doğrudan LAN bağlantısında geçiş olayı beklenmez. `firstFileBytesMs`, ilk dosya baytının testin başlangıcına göre zamanıdır. Onay anını çıkararak beklemeyi ölçebilirsin. Tamamlanan dosyalar yeni klasörün `Received` dizininde tutulur. Rapor dosya adı, telefon adı, IP, MAC ve onay kodu içermez. Raporun yanında cihaz modelini, One UI sürümünü ve yaklaşık dosya boyutlarını belirt.

## iPad Air 5 ↔ Linux

Bu, AWDL üstünde çalışan deneysel AirDrop protokol testidir. Desteklenen bir Wi-Fi kartı üzerinde çalışan OWL ve IPv6 link-local adresi olan `awdl0` gerekir. OWL’nin tek kartla çalışması bilgisayarın mevcut Wi-Fi bağlantısını kesebilir. Ayrı adaptör tercih edilir. Bağdaştırıcının uygunluğunu ve kurulumunu [OWL’nin donanım kılavuzundan](https://github.com/seemoo-lab/owl#requirements) kontrol et. `ip -6 addr show dev awdl0` çıktısında `fe80::` adresi bulunmalı. Linux tarafında Python 3, OpenSSL, iproute2 ve sistem libarchive kütüphanesi de gereklidir.

```sh
python3 -m venv .venv-device-test
.venv-device-test/bin/pip install 'zeroconf==0.154.0' 'libarchive-c==5.3'
.venv-device-test/bin/python scripts/test-ipad-airdrop.py send
```

iPad’de AirDrop görünürlüğünü **10 Dakika Boyunca Herkes** yap. Bilgisayarda bulduğu iPad’i seç, iPad’de kabul et ve Dosyalar’a kaydet. Araç yalnızca 53.248 baytlık `Linux-AirDrop-test.txt` gönderir. Raporun HTTP yükleme sonucu iPad’in son kullanıcıya kaydettiğini tek başına kanıtlamaz. Ardından ters yönü çalıştır:

```sh
.venv-device-test/bin/python scripts/test-ipad-airdrop.py receive
```

iPad’de aynı dosyayı aynı adla **Linux AirDrop Test** alıcısına geri paylaş. Bilgisayarda sorulduğunda onayla. Alıcı yalnızca bu dosyanın sabit içeriğini ve SHA-256 özetini doğrular. Farklı dosyalar, klasörler ve onaysız yüklemeler reddedilir. Gönderme başarısız olursa alıcının ekrana yazdığı örnek dosyayı başka bir yolla iPad’e kopyalayıp dönüş yönünü ayrıca test edebilirsin. İki raporu ve iPadOS sürümünü paylaş. AWDL arayüzü eksikse rapor yalnızca bu önkoşulun eksikliğini gösterir. Uygulamadaki kararlı AirDrop düğmesi fiziksel uyumluluk doğrulanana kadar deneysel aracın dışında tutulur.
