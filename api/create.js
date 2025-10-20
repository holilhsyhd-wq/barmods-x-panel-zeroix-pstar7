// Muat variabel .env
require('dotenv').config();
// Gunakan 'axios' karena sudah ada di 'package.json' Anda
const axios = require('axios');

// 1. AMBIL KONFIGURASI (Berdasarkan file Anda, tapi DIPERBAIKI)
const config = {
    // Config untuk server Private
    private: {
        domain: process.env.PTERO_PANEL_URL_PRIVATE,
        apiKey: process.env.PTERO_API_KEY_PRIVATE,
        secretKey: process.env.MY_MEMBER_SECRET_KEY // <-- Kunci untuk Private
    },
    // Config untuk server Public
    public: {
        domain: process.env.PTERO_PANEL_URL_PUBLIC,
        apiKey: process.env.PTERO_API_KEY_PUBLIC,
        secretKey: process.env.PUBLIC_MEMBER_SECRET_KEY // <-- Kunci untuk Public
    },
    // Pengaturan server (dari .env)
    shared: {
        locationId: parseInt(process.env.DEFAULT_LOCATION_ID),
        nestId: parseInt(process.env.DEFAULT_NEST_ID),
        eggId: parseInt(process.env.DEFAULT_EGG_ID)
    }
};

// --- 2. FUNGSI HELPER (Menggunakan AXIOS dan Error Handling yang Benar) ---

function generatePassword(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * Fungsi membuat user (dinamis)
 */
async function createUser(serverName, pteroConfig) {
    const username = serverName.toLowerCase().replace(/[^a-z0-9]/g, '') + `_${Math.random().toString(36).substring(2, 6)}`;
    const email = `${username}@yourdomain.com`; 
    const password = generatePassword(12);

    const userData = {
        email: email,
        username: username,
        first_name: "User",
        last_name: serverName,
        password: password,
    };
    
    const headers = {
        'Authorization': `Bearer ${pteroConfig.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };

    try {
        const response = await axios.post(
            `${pteroConfig.domain}/api/application/users`, 
            userData,
            { headers: headers }
        );
        return { ...response.data.attributes, password: password };
    } catch (error) {
        // PERBAIKAN PENTING: Mengurai error Axios
        console.error("Gagal membuat user:", error.response ? error.response.data : error.message);
        if (error.response && error.response.data && error.response.data.errors) {
            const errorMsg = error.response.data.errors.map(e => e.detail).join(' ');
            throw new Error(errorMsg); // Lempar error agar ditangkap handler utama
        }
        throw new Error("Gagal membuat user di panel.");
    }
}

/**
 * Fungsi membuat server (dinamis)
 */
async function createServer(user, serverName, ram, pteroConfig, sharedConfig) {
    const memoryLimit = parseInt(ram); 
    
    const serverData = {
        name: serverName,
        user: user.id,
        nest: sharedConfig.nestId,   // <-- Menggunakan config shared
        egg: sharedConfig.eggId,     // <-- Menggunakan config shared
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
            locations: [sharedConfig.locationId], // <-- Menggunakan config shared
            dedicated_ip: false,
            port_range: [],
        }
    };

    const headers = {
        'Authorization': `Bearer ${pteroConfig.apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    };

    try {
        const response = await axios.post(
            `${pteroConfig.domain}/api/application/servers`, 
            serverData,
            { headers: headers }
        );
        return response.data.attributes;
    } catch (error) {
        // PERBAIKAN PENTING: Mengurai error Axios
        console.error("Gagal membuat server:", error.response ? error.response.data.errors : error.message);
        if (error.response && error.response.data && error.response.data.errors) {
            const errorMsg = error.response.data.errors.map(e => e.detail).join(' ');
            throw new Error(errorMsg); // Lempar error agar ditangkap handler utama
        }
        throw new Error("Gagal membuat server di panel.");
    }
}

// --- 3. HANDLER UTAMA (Logika file Anda + perbaikan Saya) ---
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

    // Gunakan 'panelType' agar cocok dengan frontend
    const { serverName, ram, secretKey, panelType } = req.body;
    let targetConfig;

    try {
        // Validasi input
        if (!serverName || ram === undefined || ram === null || !panelType || !secretKey) {
             return res.status(400).json({ error: 'Data tidak lengkap: Nama Server, RAM, Tipe Panel, dan Secret Key wajib diisi.' });
        }

        // --- LOGIKA UTAMA (Ini yang Anda inginkan) ---
        if (panelType === 'private') {
            if (secretKey !== config.private.secretKey) {
                return res.status(403).json({ error: 'Secret Key untuk Panel Private salah.' });
            }
            targetConfig = config.private;

        } else if (panelType === 'public') {
            if (secretKey !== config.public.secretKey) {
                 return res.status(403).json({ error: 'Secret Key untuk Panel Public salah.' });
            }
            targetConfig = config.public;
            
        } else {
            return res.status(400).json({ error: 'Tipe panel tidak dikenal.' });
        }

        // Cek jika .env ada isinya
        if (!targetConfig.domain || !targetConfig.apiKey || !targetConfig.secretKey) {
             console.error(`Konfigurasi .env untuk '${panelType}' tidak lengkap.`);
             return res.status(500).json({ error: 'Kesalahan konfigurasi server.' });
        }
        // ===========================================

        // --- Proses Pembuatan ---
        const newUser = await createUser(serverName, targetConfig);
        const newServer = await createServer(newUser, serverName, ram, targetConfig, config.shared);
        
        // Kirim Respon Sukses (JSON)
        return res.status(201).json({
            message: 'Server dan User berhasil dibuat!',
            panelURL: targetConfig.domain, // <-- Mengirim domain yang benar
            user: { id: newUser.id, username: newUser.username, email: newUser.email },
            password: newUser.password,
            server: { id: newServer.id, uuid: newServer.uuid, name: newServer.name, limits: newServer.limits }
        });

    } catch (error) {
        // --- INI ADALAH PERBAIKAN ERROR JSON ANDA ---
        console.error("Handler Error:", error.message);
        
        // Kirim error Pterodactyl (seperti "nama sudah ada") sebagai 409 Conflict
        if (error.message.toLowerCase().includes("a server with this name already exists")) {
             return res.status(409).json({ error: "Nama server tersebut sudah dipakai." });
        }
        if (error.message.toLowerCase().includes("email has already been taken")) {
             return res.status(409).json({ error: "Terjadi konflik, nama user/email mungkin sudah ada." });
        }
        
        // Ini adalah penangkap error default
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan internal server.' });
    }
}
