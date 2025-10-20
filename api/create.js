// Muat variabel .env
require('dotenv').config();

const axios = require('axios');

// --- Ambil KEDUA set kredensial panel ---
const PTERO_PANEL_URL_PRIVATE = process.env.PTERO_PANEL_URL_PRIVATE;
const PTERO_API_KEY_PRIVATE = process.env.PTERO_API_KEY_PRIVATE;
const PTERO_PANEL_URL_PUBLIC = process.env.PTERO_PANEL_URL_PUBLIC;
const PTERO_API_KEY_PUBLIC = process.env.PTERO_API_KEY_PUBLIC;

// --- Ambil KEDUA secret key ---
const MY_MEMBER_SECRET_KEY = process.env.MY_MEMBER_SECRET_KEY;
const PUBLIC_MEMBER_SECRET_KEY = process.env.PUBLIC_MEMBER_SECRET_KEY; // <-- INI PENTING

// Konfigurasi server default (diambil dari .env)
const DEFAULT_LOCATION_ID = parseInt(process.env.DEFAULT_LOCATION_ID);
const DEFAULT_NEST_ID = parseInt(process.env.DEFAULT_NEST_ID);
const DEFAULT_EGG_ID = parseInt(process.env.DEFAULT_EGG_ID);

// --- Fungsi Helper (sekarang menerima panelUrl dan apiKey) ---

function generatePassword(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * Fungsi membuat user (sekarang dinamis)
 */
async function createUser(serverName, panelUrl, apiKey) {
    const username = serverName.toLowerCase().replace(/[^a-z0-9]/g, '') + `_${Math.random().toString(36).substring(2, 6)}`;
    const email = `${username}@yourdomain.com`; // Ganti @yourdomain.com jika perlu
    const password = generatePassword(12);

    const userData = {
        email: email,
        username: username,
        first_name: "User",
        last_name: serverName,
        password: password,
    };
    
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };

    try {
        const response = await axios.post(
            `${panelUrl}/api/application/users`, 
            userData,
            { headers: headers }
        );
        return { ...response.data.attributes, password: password };
    } catch (error) {
        console.error("Gagal membuat user:", error.response ? error.response.data : error.message);
        throw new Error("Gagal membuat user di panel.");
    }
}

/**
 * Fungsi membuat server (sekarang dinamis)
 */
async function createServer(user, serverName, ram, panelUrl, apiKey) {
    
    const memoryLimit = parseInt(ram); 
    
    const serverData = {
        name: serverName,
        user: user.id,
        nest: DEFAULT_NEST_ID,
        egg: DEFAULT_EGG_ID,
        docker_image: "ghcr.io/pterodactyl/yolks:nodejs_18", 
        startup: "node index.js", 
        environment: {},
        limits: {
            memory: memoryLimit, 
            swap: 0,
            disk: (memoryLimit > 0) ? memoryLimit * 3 : 5120, 
            io: 500,
            cpu: (memoryLimit > 0) ? (memoryLimit / 1024) * 100 : 400, 
        },
        feature_limits: { databases: 1, allocations: 1, backups: 1 },
        deploy: {
            locations: [DEFAULT_LOCATION_ID],
            dedicated_ip: false,
            port_range: [],
        }
    };

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };

    try {
        const response = await axios.post(
            `${panelUrl}/api/application/servers`, 
            serverData,
            { headers: headers }
        );
        return response.data.attributes;
    } catch (error) {
        console.error("Gagal membuat server:", error.response ? error.response.data.errors : error.message);
        if (error.response && error.response.data.errors) {
            const errorMsg = error.response.data.errors.map(e => e.detail).join(' ');
            throw new Error(`Gagal membuat server: ${errorMsg}`);
        }
        throw new Error("Gagal membuat server di panel.");
    }
}

// --- Handler Utama Serverless Function ---
export default async function handler(req, res) {

    // Setel Header CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Tangani request OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metode tidak diizinkan' });
    }

    const { serverName, ram, secretKey, panelType } = req.body;

    let targetPanelUrl = '';
    let targetApiKey = '';

    try {
        // Validasi input (SEKARANG SECRET KEY JUGA WAJIB)
        if (!serverName || ram === undefined || ram === null || !panelType || !secretKey) {
             return res.status(400).json({ error: 'Data tidak lengkap: Nama Server, RAM, Tipe Panel, dan Secret Key wajib diisi.' });
        }

        // --- LOGIKA UTAMA (BERUBAH) ---
        
        if (panelType === 'private') {
            // 1. Validasi Secret Key untuk Private
            if (secretKey !== MY_MEMBER_SECRET_KEY) {
                return res.status(403).json({ error: 'Secret Key untuk Panel Private salah.' });
            }
            // 2. Set kredensial ke panel PRIVATE
            targetPanelUrl = PTERO_PANEL_URL_PRIVATE;
            targetApiKey = PTERO_API_KEY_PRIVATE;

        } else if (panelType === 'public') {
            // 1. Validasi Secret Key untuk Public (INI PERUBAHANNYA)
            if (secretKey !== PUBLIC_MEMBER_SECRET_KEY) {
                 return res.status(403).json({ error: 'Secret Key untuk Panel Public salah.' });
            }
            // 2. Set kredensial ke panel PUBLIC
            targetPanelUrl = PTERO_PANEL_URL_PUBLIC;
            targetApiKey = PTERO_API_KEY_PUBLIC;
            
        } else {
            return res.status(400).json({ error: 'Tipe panel tidak dikenal.' });
        }

        // Cek jika kredensial panel ada
        if (!targetPanelUrl || !targetApiKey || !PUBLIC_MEMBER_SECRET_KEY) {
            console.error("Kesalahan Konfigurasi: Pastikan semua URL, API Key, dan Secret Key (Private & Public) diatur di .env");
            return res.status(500).json({ error: 'Kesalahan konfigurasi server.' });
        }

        // --- Proses Pembuatan ---
        const newUser = await createUser(serverName, targetPanelUrl, targetApiKey);
        const newServer = await createServer(newUser, serverName, ram, targetPanelUrl, targetApiKey);
        
        // Kirim Respon Sukses
        return res.status(201).json({
            message: 'Server dan User berhasil dibuat!',
            panelURL: targetPanelUrl, 
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email,
            },
            password: newUser.password,
            server: {
                id: newServer.id,
                uuid: newServer.uuid,
                name: newServer.name,
                limits: newServer.limits
            }
        });

    } catch (error) {
        // Tangani Error
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan internal server.' });
    }
}
