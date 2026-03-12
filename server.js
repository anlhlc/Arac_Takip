const express = require('express');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Istanbul';
const DATA_DIR = process.env.DATA_DIR || process.env.RENDER_DISK_PATH || __dirname;
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function getDefaultSettings() {
    return {
        botToken: '',
        chatId: '',
        reminderDay: 5,
        reminderHour: 18,
        reminderMinute: 0,
        users: [],
        rotationStartWeek: 1,
        rotationStartYear: 2025,
        lastReminderDate: ''
    };
}

function normalizeSettings(raw = {}) {
    const defaults = getDefaultSettings();
    const users = Array.isArray(raw.users)
        ? raw.users
            .map((user) => ({ name: String(user?.name || '').trim() }))
            .filter((user) => user.name)
        : [];

    return {
        ...defaults,
        ...raw,
        botToken: String(raw.botToken || '').trim(),
        chatId: String(raw.chatId || '').trim(),
        reminderDay: Number.isInteger(raw.reminderDay) ? raw.reminderDay : parseInt(raw.reminderDay ?? defaults.reminderDay, 10),
        reminderHour: Number.isInteger(raw.reminderHour) ? raw.reminderHour : parseInt(raw.reminderHour ?? defaults.reminderHour, 10),
        reminderMinute: Number.isInteger(raw.reminderMinute) ? raw.reminderMinute : parseInt(raw.reminderMinute ?? defaults.reminderMinute, 10),
        rotationStartWeek: Number.isInteger(raw.rotationStartWeek) ? raw.rotationStartWeek : parseInt(raw.rotationStartWeek ?? defaults.rotationStartWeek, 10),
        rotationStartYear: Number.isInteger(raw.rotationStartYear) ? raw.rotationStartYear : parseInt(raw.rotationStartYear ?? defaults.rotationStartYear, 10),
        users,
        lastReminderDate: String(raw.lastReminderDate || '')
    };
}

function ensureSettingsFile() {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(getDefaultSettings(), null, 2));
    }
}

function readSettings() {
    ensureSettingsFile();
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const normalized = normalizeSettings(raw);

    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
        writeSettings(normalized);
    }

    return normalized;
}

function writeSettings(settings) {
    ensureDataDir();
    const normalized = normalizeSettings(settings);
    const tempFile = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(normalized, null, 2), 'utf8');
    fs.renameSync(tempFile, SETTINGS_FILE);
    return normalized;
}

function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatDate(date) {
    return new Intl.DateTimeFormat('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: APP_TIMEZONE
    }).format(date);
}

function getWeekDates(weekNum, year) {
    const simple = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
    const dow = simple.getUTCDay();
    const weekStart = new Date(simple);
    if (dow <= 4) {
        weekStart.setUTCDate(simple.getUTCDate() - dow + 1);
    } else {
        weekStart.setUTCDate(simple.getUTCDate() + 8 - dow);
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    return { start: weekStart, end: weekEnd };
}

function getCurrentDriver(settings, targetWeek, year) {
    if (!settings.users.length) return { name: 'Kullanıcı yok', index: -1 };

    const baseWeek = settings.rotationStartWeek || 1;
    const baseYear = settings.rotationStartYear || year;
    let effectiveWeek = targetWeek - baseWeek;

    if (year > baseYear) {
        effectiveWeek += (year - baseYear) * 52;
    }

    while (effectiveWeek < 0) {
        effectiveWeek += settings.users.length;
    }

    const driverIndex = effectiveWeek % settings.users.length;
    return { name: settings.users[driverIndex].name, index: driverIndex };
}

async function sendTelegramMessage(botToken, chatId, message) {
    if (!botToken || !chatId) {
        console.log('Bot Token veya Chat ID ayarlanmamış');
        return { ok: false, error: 'Bot Token veya Chat ID ayarlanmamış' };
    }

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();
        if (data.ok) {
            console.log('Telegram mesajı gönderildi');
            return { ok: true, data };
        }

        console.error('Telegram hatası:', data.description);
        return { ok: false, error: data.description || 'Mesaj gönderilemedi', data };
    } catch (error) {
        console.error('Telegram API hatası:', error.message);
        return { ok: false, error: error.message };
    }
}

ensureSettingsFile();

app.get('/api/settings', (req, res) => {
    try {
        res.json(readSettings());
    } catch (error) {
        res.status(500).json({ error: 'Ayarlar okunamadı: ' + error.message });
    }
});

app.post('/api/settings', (req, res) => {
    try {
        const saved = writeSettings(req.body || {});
        res.json({ success: true, message: 'Ayarlar kaydedildi', settings: saved });
    } catch (error) {
        res.status(500).json({ error: 'Ayarlar kaydedilemedi: ' + error.message });
    }
});

app.post('/api/change-driver', async (req, res) => {
    try {
        const { newDriverIndex, changerName } = req.body || {};
        const settings = readSettings();

        if (!settings.users.length) {
            return res.status(400).json({ error: 'Kullanıcı yok' });
        }

        const parsedIndex = parseInt(newDriverIndex, 10);
        if (Number.isNaN(parsedIndex) || parsedIndex < 0 || parsedIndex >= settings.users.length) {
            return res.status(400).json({ error: 'Geçersiz sürücü seçimi' });
        }

        const currentYear = new Date().getFullYear();
        const currentWeekNum = getWeekNumber(new Date());
        const current = getCurrentDriver(settings, currentWeekNum, currentYear);
        const newDriverName = settings.users[parsedIndex].name;
        const changer = changerName || settings.users[current.index]?.name || 'Bilinmiyor';

        if (current.index === parsedIndex) {
            return res.status(400).json({ error: 'Bu kişi zaten bu haftanın sürücüsü' });
        }

        const newDriverUser = settings.users[parsedIndex];
        const changerUser = settings.users.find((u) => u.name === changer);
        const newOrder = [newDriverUser];

        if (changerUser && changerUser.name !== newDriverUser.name) {
            newOrder.push(changerUser);
        }

        for (const user of settings.users) {
            if (user.name !== newDriverUser.name && (!changerUser || user.name !== changerUser.name)) {
                newOrder.push(user);
            }
        }

        settings.users = newOrder;
        settings.rotationStartWeek = currentWeekNum;
        settings.rotationStartYear = currentYear;
        writeSettings(settings);

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
            message: `${changer}, ${newDriverName} kişisini bu haftanın sürücüsü olarak ayarladı!`,
            newOrder: settings.users.map((u) => u.name)
        });
    } catch (error) {
        res.status(500).json({ error: 'Sürücü değiştirilemedi: ' + error.message });
    }
});

app.post('/api/send-message', async (req, res) => {
    const payload = req.body || {};
    const currentSettings = readSettings();
    const botToken = String(payload.botToken || currentSettings.botToken || '').trim();
    const chatId = String(payload.chatId || currentSettings.chatId || '').trim();
    const message = String(payload.message || '').trim();

    if (!botToken || !chatId || !message) {
        return res.status(400).json({ error: 'Bot Token, Chat ID ve mesaj gerekli' });
    }

    const result = await sendTelegramMessage(botToken, chatId, message);
    if (!result.ok) {
        return res.status(400).json({ error: result.error || 'Mesaj gönderilemedi' });
    }

    res.json({ success: true, message: 'Mesaj gönderildi' });
});

app.post('/api/test-bot', async (req, res) => {
    const payload = req.body || {};
    const currentSettings = readSettings();
    const botToken = String(payload.botToken || currentSettings.botToken || '').trim();
    const chatId = String(payload.chatId || currentSettings.chatId || '').trim();

    if (!botToken) {
        return res.status(400).json({ error: 'Bot Token gerekli' });
    }

    try {
        const meUrl = `https://api.telegram.org/bot${botToken}/getMe`;
        const meResponse = await fetch(meUrl);
        const meData = await meResponse.json();

        if (!meData.ok) {
            return res.status(400).json({ error: meData.description || 'Bot doğrulanamadı' });
        }

        if (!chatId) {
            return res.json({
                success: true,
                botName: meData.result.username,
                message: 'Bot doğrulandı. Grup testi için Chat ID girmeniz gerekiyor.'
            });
        }

        const chatUrl = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`;
        const chatResponse = await fetch(chatUrl);
        const chatData = await chatResponse.json();

        if (!chatData.ok) {
            return res.status(400).json({ error: chatData.description || 'Grup doğrulanamadı' });
        }

        res.json({
            success: true,
            botName: meData.result.username,
            chatTitle: chatData.result.title || chatData.result.username || chatData.result.id,
            message: 'Bot ve grup bağlantısı başarılı!'
        });
    } catch (error) {
        res.status(500).json({ error: 'Bot test hatası: ' + error.message });
    }
});

function getLocalNowParts() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
        weekday: weekdayMap[parts.weekday],
        todayStr: `${parts.year}-${parts.month}-${parts.day}`
    };
}

function sendScheduledReminder() {
    try {
        const settings = readSettings();

        if (!settings.botToken || !settings.chatId || !settings.users.length) {
            console.log('Hatırlatma gönderilemiyor: Ayarlar eksik');
            return;
        }

        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        const nextWeekNum = getWeekNumber(currentDate) + 1;
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

        const localNow = getLocalNowParts();
        settings.lastReminderDate = localNow.todayStr;
        writeSettings(settings);
    } catch (error) {
        console.error('Hatırlatma hatası:', error.message);
    }
}

cron.schedule('* * * * *', () => {
    try {
        const settings = readSettings();
        const localNow = getLocalNowParts();
        const lastReminder = settings.lastReminderDate || '';

        if (lastReminder === localNow.todayStr) {
            return;
        }

        if (localNow.weekday === parseInt(settings.reminderDay, 10) &&
            localNow.hour === parseInt(settings.reminderHour, 10) &&
            localNow.minute === parseInt(settings.reminderMinute, 10)) {
            sendScheduledReminder();
            console.log(`Hatırlatma planlandı: ${settings.reminderDay} günü, ${settings.reminderHour}:${settings.reminderMinute}`);
        }
    } catch (error) {
        console.error('Cron kontrol hatası:', error.message);
    }
}, { timezone: APP_TIMEZONE });

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
    console.log(`Hatırlatma sistemi aktif (${APP_TIMEZONE})`);
    console.log(`Ayar dosyası: ${SETTINGS_FILE}`);
});
