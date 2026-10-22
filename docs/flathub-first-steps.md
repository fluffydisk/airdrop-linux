# Flathub: ilk kez paket hazırlayan bakımcı için

Flathub'a DEB veya RPM dosyası yüklemiyoruz. Flatpak manifesti, hangi kaynakların
alınacağını, bunların nasıl derleneceğini ve uygulamanın hangi izinlerle
çalışacağını anlatan paket tarifidir. Flathub'ın sunucuları bu tarifi kullanır.

Bu belge bir manifest veya başvuru metni değildir. AI desteğiyle hazırlanmış
teknik öğrenme rehberidir; başvuruya kopyalanacak bir şablon içermez.

## Önce ne öğrenmelisin?

1. [Flatpak'ın ilk paket rehberini](https://docs.flatpak.org/en/latest/first-build.html)
   oku. Uygulama kimliği, runtime, SDK, kaynaklar, derleme ve sandbox izinlerinin
   birbirinden farklı görevleri olduğunu öğren. JSON ve YAML, tarif yazmak için
   kullanılan iki dosya biçimidir.
2. [Flathub gereksinimlerini](https://docs.flathub.org/docs/for-app-authors/requirements/)
   oku. Özellikle kaynak koddan derleme, derleme sırasında ağ erişiminin olmaması,
   uygulama kimliği, portallar ve Generative AI policy bölümleri bu proje için
   belirleyici. Flatpak olarak çalışan her paket Flathub'a kabul edilmez.
3. Uygulamanın teknik hazırlığının tamamlanmasını bekle. Mevcut test tarifi,
   önceden derlenmiş Electron/Node/dufs paketlerini kullanıyor. Bu tarifin
   çalışması, kaynak koddan çevrimdışı derlemenin hazır olduğu anlamına gelmez.
4. Teknik engeller giderildikten sonra manifesti bağımsız olarak kendin yaz.
   AI tarafından üretilmiş tarifi yeniden yazarak veya yalnızca gözden geçirerek
   bu gerekliliğin karşılandığını varsayma. Gerekirse
   [Flathub topluluğundan](https://discourse.flathub.org/) insan paketleme desteği
   iste. Mevcut GitHub hesabın bu süreçte kullanılabilir; AUR veya Snap hesabı
   gerekmiyor.
5. İnsan tarafından hazırlanmış tarif bulut ortamında derlenip test edildikten
   sonra [resmî başvuru sürecini](https://docs.flathub.org/docs/for-app-authors/submission/)
   kendin yürüt. Manifestin bağımsız hazırlanması, diğer gereksinimlerden muafiyet
   veya kabul garantisi sağlamaz.

## AI desteğinin sınırı

Kurallar araştırma, tartışma ve hata ayıklamaya izin veriyor. Kavramların ne
anlama geldiği ve bir derleme hatasının nedeni açıklanabilir. Manifest metni,
başvuru PR'ının commit mesajı/açıklaması veya inceleme yanıtları AI tarafından
üretilmemeli. Flathub başvuru PR'ı AI ajanıyla açılmamalı ve ajan incelemesi
istenmemeli. Bilinen AI üretimi uygulama kodu, araçlar ve belgeler için insan
bakımcı kapsamı dürüstçe açıklamalı. Geçerli kuralları başvuru tarihinde yeniden
kontrol et; bu belge inceleyicinin kararı yerine geçmez.

## Şu an teknik olarak nerede duruyoruz?

Uygulama kimliği ve masaüstü entegrasyonu için çalışma uygulamanın kendi
deposunda yürütülüyor. Kilit dosyalarındaki npm üretim bağımlılıkları için
çevrimdışı kurulum önbelleği hazırlanıp doğrulanabiliyor. Electron, Node ve dufs
kaynak derlemeleri ile tüm uygulamanın ağsız Flatpak derlemesi henüz hazır değil.
Etkileşimli dosya/arka plan portalları ve gerçek Wayland clipboard oturumu da
ayrıca doğrulanmalı. Güncel teknik ayrıntılar [hazırlık raporunda](flathub-readiness.md).

Tüm geliştirme ve testler Codex Cloud/GitHub Actions üzerinde kalır. Şu aşamada
kişisel bilgisayarına bir geliştirme ortamı kurman veya hemen manifest yazman
gerekmiyor.
