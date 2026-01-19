const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Settings file path
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

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

// Serve index.html for root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
