const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Settings file path
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

// Helper function to get current week number
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Helper function to format date in Turkish
function formatDate(date) {
    return date.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

// Helper function to get week dates
function getWeekDates(weekNum, year) {
    const simple = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
    const dow = simple.getDay();
    const weekStart = simple;
    if (dow <= 4) {
        weekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
        weekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return { start: weekStart, end: weekEnd };
}

// Helper function to get current driver
function getCurrentDriver(settings, targetWeek, year) {
    if (settings.users.length === 0) return { name: 'Kullanıcı yok', index: -1 };

    const baseWeek = settings.rotationStartWeek || 1;
    const baseYear = settings.rotationStartYear || year;
    
    let effectiveWeek = (targetWeek - baseWeek);
    if (year > baseYear) {
        effectiveWeek += (year - baseYear) * 52;
    }
    
    while (effectiveWeek < 0) {
        effectiveWeek += settings.users.length;
    }

    const driverIndex = effectiveWeek % settings.users.length;
    return { 
        name: settings.users[driverIndex].name, 
        index: driverIndex
    };
}

// Helper function to send Telegram message
async function sendTelegramMessage(botToken, chatId, message) {
    if (!botToken || !chatId) {
        console.log('Bot Token veya Chat ID ayarlanmamış');
        return false;
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();
        if (data.ok) {
            console.log('Telegram mesajı gönderildi');
            return true;
        } else {
            console.error('Telegram hatası:', data.description);
            return false;
        }
    } catch (error) {
        console.error('Telegram API hatası:', error.message);
        return false;
    }
}

// Initialize settings file if it doesn't exist
if (!fs.existsSync(SETTINGS_FILE)) {
    const initialSettings = {
        botToken: '',
        chatId: '',
        reminderDay: 5,
        reminderHour: 18,
        reminderMinute: 0,
        users: [],
        rotationStartWeek: 1,
        rotationStartYear: 2025
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(initialSettings, null, 2));
}

// API: Get settings
app.get('/api/settings', (req, res) => {
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Ayarlar okunamadı' });
    }
});

// API: Save settings
app.post('/api/settings', (req, res) => {
    try {
        const settings = req.body;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        res.json({ success: true, message: 'Ayarlar kaydedildi' });
    } catch (error) {
        res.status(500).json({ error: 'Ayarlar kaydedilemedi' });
    }
});

// API: Change driver with fair rotation
app.post('/api/change-driver', async (req, res) => {
    try {
        const { newDriverIndex, changerName } = req.body;
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        
        if (settings.users.length === 0) {
            return res.status(400).json({ error: 'Kullanıcı yok' });
        }
        
        if (newDriverIndex < 0 || newDriverIndex >= settings.users.length) {
            return res.status(400).json({ error: 'Geçersiz sürücü seçimi' });
        }
        
        const currentYear = new Date().getFullYear();
        const currentWeekNum = getWeekNumber(new Date());
        const current = getCurrentDriver(settings, currentWeekNum, currentYear);
        
        const newDriverName = settings.users[newDriverIndex].name;
        const changer = changerName || settings.users[current.index].name;
        
        // Aynı kişiyi seçerse
        if (current.index === newDriverIndex) {
            return res.status(400).json({ error: 'Bu kişi zaten bu haftanın sürücüsü' });
        }
        
        // ADİL ROTASYON SİSTEMİ - GÜVENLİ ALGORİTMA
        // Yeni sürücü bu haftanın sürücüsü olur (index 0)
        // Değişikliği yapan kişi gelecek hafta sürücü olur (index 1)
        // Diğer kişiler sırasıyla devam eder
        
        // Önce tüm kullanıcıları al
        const newDriverUser = settings.users[newDriverIndex];
        const changerUser = settings.users.find(u => u.name === changer);
        
        // Yeni sıralı listeyi oluştur:
        // 1. Yeni sürücü (başa)
        // 2. Değişikliği yapan (ikinci sıraya)
        // 3. Diğerleri (sırayla, yeni sürücü ve değiştiren hariç)
        const newOrder = [];
        newOrder.push(newDriverUser);
        
        if (changerUser && changerUser.name !== newDriverUser.name) {
            newOrder.push(changerUser);
        }
        
        // Diğer kullanıcıları ekle (yeni sürücü ve değiştiren hariç)
        for (const user of settings.users) {
            if (user.name !== newDriverUser.name && 
                (!changerUser || user.name !== changerUser.name)) {
                newOrder.push(user);
            }
        }
        
        settings.users = newOrder;
        
        // Rotasyon başlangıç haftasını sıfırla (bu haftadan itibaren)
        settings.rotationStartWeek = currentWeekNum;
        settings.rotationStartYear = currentYear;
        
        // Ayarları kaydet
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        
        // Telegram bildirimi gönder
        const weekDates = getWeekDates(currentWeekNum, currentYear);
        let notificationMessage = `🚗 *Sürücü Değişikliği Yapıldı!*\n\n`;
        notificationMessage += `📅 *Tarih:* ${formatDate(weekDates.start)} - ${formatDate(weekDates.end)}\n`;
        notificationMessage += `🔄 *Değiştiren:* ${changer}\n`;
        notificationMessage += `✅ *Yeni Sürücü:* ${newDriverName}\n\n`;
        
        notificationMessage += `📋 *Sonraki Sıra:*\n`;
        for (let i = 1; i < Math.min(settings.users.length, 5); i++) {
            notificationMessage += `${i + 1}. ${settings.users[i].name}\n`;
        }
        if (settings.users.length > 5) {
            notificationMessage += `... ve ${settings.users.length - 5} kişi daha`;
        }
        
        await sendTelegramMessage(settings.botToken, settings.chatId, notificationMessage);
        
        res.json({ 
            success: true, 
            message: `${changer}, ${newDriverName}'ni bu haftanın sürücüsü olarak ayarladı!`,
            newOrder: settings.users.map(u => u.name)
        });
    } catch (error) {
        res.status(500).json({ error: 'Sürücü değiştirilemedi: ' + error.message });
    }
});

// API: Send message to Telegram
app.post('/api/send-message', async (req, res) => {
    const { botToken, chatId, message } = req.body;

    if (!botToken || !chatId || !message) {
        return res.status(400).json({ error: 'Bot Token, Chat ID ve Mesaj gerekli' });
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: message
            })
        });

        const data = await response.json();

        if (data.ok) {
            res.json({ success: true, message: 'Mesaj gönderildi' });
        } else {
            res.status(400).json({ error: data.description || 'Mesaj gönderilemedi' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Telegram API hatası: ' + error.message });
    }
});

// API: Send test message
app.post('/api/test-bot', async (req, res) => {
    const { botToken, chatId } = req.body;

    if (!botToken || !chatId) {
        return res.status(400).json({ error: 'Bot Token ve Chat ID gerekli' });
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/getMe`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.ok) {
            res.json({ 
                success: true, 
                botName: data.result.username,
                message: 'Bot bağlantısı başarılı!'
            });
        } else {
            res.status(400).json({ error: data.description || 'Bot doğrulanamadı' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Bot test hatası: ' + error.message });
    }
});

// CRON Job: Hatırlatma mesajı gönderme
function sendScheduledReminder() {
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        
        if (!settings.botToken || !settings.chatId || settings.users.length === 0) {
            console.log('Hatırlatma gönderilemiyor: Ayarlar eksik');
            return;
        }
        
        const currentYear = new Date().getFullYear();
        const nextWeekNum = getWeekNumber(new Date()) + 1;
        const driver = getCurrentDriver(settings, nextWeekNum, currentYear);
        
        if (driver.index === -1) {
            console.log('Hatırlatma gönderilemiyor: Sürücü yok');
            return;
        }
        
        const weekDates = getWeekDates(nextWeekNum, currentYear);
        
        let message = `🔔 *Yaklaşan Haftanın Sürücüsü*\n\n`;
        message += `📅 *Tarih:* ${formatDate(weekDates.start)} - ${formatDate(weekDates.end)}\n`;
        message += `🚗 *Sürücü:* ${driver.name}\n\n`;
        message += `_Arabalı işe gidiş sistemi ile hazırlanmıştır._`;
        
        sendTelegramMessage(settings.botToken, settings.chatId, message);
        console.log(`Hatırlatma mesajı gönderildi: ${driver.name}`);
    } catch (error) {
        console.error('Hatırlatma hatası:', error.message);
    }
}

// Her dakika kontrol et ve hatırlatma zamanı geldiyse gönder
let lastReminderDate = '';
cron.schedule('* * * * *', () => {
    const now = new Date();
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    
    // Bugün hatırlatma gönderildi mi kontrol et
    const todayStr = now.toISOString().split('T')[0];
    if (lastReminderDate === todayStr) {
        return; // Bugün zaten gönderildi
    }
    
    // Hatırlatma günü ve saatini kontrol et
    if (now.getDay() === parseInt(settings.reminderDay) &&
        now.getHours() === parseInt(settings.reminderHour) &&
        now.getMinutes() === parseInt(settings.reminderMinute)) {
        
        sendScheduledReminder();
        lastReminderDate = todayStr;
        console.log(`Hatırlatma planlandı: ${settings.reminderDay} günü, ${settings.reminderHour}:${settings.reminderMinute}`);
    }
});

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
    console.log(`Hatırlatma sistemi aktif`);
});
