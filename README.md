# Arabalı İşe Gidiş Takip Sistemi

Telegram grubunuzdaki araba paylaşımlı işe gidiş rotasyonunu takip etmek için web tabanlı bir sistem.

## Özellikler

- 🚗 Haftalık sürücü rotasyonu otomatik hesaplama
- 👥 Kullanıcı ekleme, düzenleme ve silme
- ⚙️ Telegram bot ayarları (Token ve Chat ID)
- ⏰ Hatırlatma günü ve saati ayarlama
- 📱 Mobil uyumlu arayüz
- ☁️ Render üzerinde 7/24 çalışma

## Kurulum

### Yerel Geliştirme

```bash
# Bağımlılıkları yükle
npm install

# Sunucuyu başlat
npm start
```

Tarayıcıda `http://localhost:3000` adresine gidin.

### Render Üzerine Dağıtım

1. **GitHub'da Repo Oluşturma**
   - Bu dosyaları bir GitHub reposuna yükleyin
   - `server.js`, `package.json` ve `public/` klasörünü içermeli

2. **Render'da Web Servis Oluşturma**
   - [Render Dashboard](https://dashboard.render.com) adresine gidin
   - "New" > "Web Service" seçin
   - GitHub reposunu bağlayın
   - Build Command: `npm install`
   - Start Command: `npm start`
   - "Create Web Service" butonuna tıklayın

3. **Ortam Değişkenleri (İsteğe Bağlı)**
   - Render dashboard'da "Environment" sekmesinde:
     - `PORT`: 3000 (varsayılan)

4. **Bot Token ve Chat ID Alma**

   **Bot Token:**
   - Telegram'da @BotFather ile konuşun
   - `/newbot` komutunu gönderin
   - Bot ismi ve kullanıcı adı verin
   - Aldığınız token'i kopyalayın

   **Chat ID:**
   - Gruba botu ekleyin
   - Gruba @usernameofyourbot olarak mesaj atın
   - Tarayıcıda şu adrese gidin:
     `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - `chat` objesindeki `id` değerini alın
   - ÖNEMLI: Grup ID'leri `-100` ile başlar (örn: -100123456789)

5. **Ayarları Yapılandırma**
   - Deploy tamamlandıktan sonra web sitesine gidin
   - "Ayarlar" butonuna tıklayın
   - Bot Token ve Chat ID'nizi girin
   - Hatırlatma günü ve saatini ayarlayın
   - "Kaydet" butonuna tıklayın

## Kullanım

### Sürücü Rotasyonu
- Sistem, kullanıcıları ekleme sırasına göre rotasyon yapar
- "Sürücüyü değiştir" bölümünden manuel değişiklik yapabilirsiniz
- Rotasyon başlangıç haftası ayarlardan değiştirilebilir

### Hatırlatma Mesajları
- Ayarlardan belirlediğiniz gün ve saatte Telegram grubuna mesaj gönderilir
- Not: Render'da ücretsiz plan "sleep" moduna girdiğinde hatırlatma çalışmayabilir
- Kesintisiz çalışma için ücretli plan önerilir

## Dosya Yapısı

```
├── server.js          # Node.js backend sunucusu
├── package.json       # npm bağımlılıkları
├── settings.json      # Ayarlar (sunucu tarafında saklanır)
├── public/
│   └── index.html     # Web arayüzü
└── README.md          # Bu dosya
```

## Sorun Giderme

### "Chat not found" Hatası
- Chat ID'nin `-100` ile başladığından emin olun
- Bot'un grupta yönetici olduğundan emin olun

### Hatırlatma Çalışmıyor
- Ücretsiz Render planında sunucu uyku moduna girebilir
- Ücretli plan kullanın veya harici cron servisi kullanın

### Bot Bağlantı Hatası
- Bot Token'i kontrol edin
- Bot'u tekrar @BotFather'dan oluşturmayı deneyin

## Lisans

MIT License
