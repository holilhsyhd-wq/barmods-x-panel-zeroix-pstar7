// --- DEPENDENSI ---
// Tambahkan 'node-fetch' versi 2 (CommonJS)
const fetch = require('node-fetch');

// --- FUNGSI HELPER (SEKARANG MENERIMA 'config' SEBAGAI ARGUMEN) ---

async function createUser(serverName, config) {
    const url = `${config.domain}/api/application/users`; 
    
    const randomString = Math.random().toString(36).substring(7);
    const email = `${serverName.toLowerCase().replace(/\s+/g, '')}@${randomString}.com`;
    const username = `${serverName.toLowerCase().replace(/\s+/g, '')}_${randomString}`;
    const password = Math.random().toString(36).slice(-10);

    const userData = {
        email: email,
        username: username,
        first_name: serverName,
        last_name: "User",
        password: password,
        root_admin: false
    };

    try {
        const response = await fetch(url, { // 'fetch' ini sekarang merujuk ke 'node-fetch'
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (response.status === 201) {
            return { success: true, user: data.attributes, password: password };
        } else {
            console.error("Gagal membuat user:", JSON.stringify(data.errors, null, 2));
            return { success: false, error: data.errors ? data.errors[0].detail : 'Gagal membuat pengguna baru.' };
        }
    } catch (error) {
        console.error("Error saat fetch API user:", error);
        return { success: false, error: 'Gagal terhubung ke API Pterodactyl untuk membuat pengguna.' };
    }
}

async function createServer(serverName, memory, pterodactylUserId, config) {
    const url = `${config.domain}/api/application/servers`;

    const serverData = {
        name: serverName,
        user: pterodactylUserId,
        egg: config.eggId,
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
        startup: "if [[ -d .git ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ -f /home/container/package.json ]]; then /usr/local/bin/npm install; fi; {{CMD_RUN}}",
        environment: {
            USER_ID: 1, 
            CMD_RUN: "node index.js" 
        },
        limits: {
            memory: parseInt(memory),
            swap: 0,
            disk: config.disk,
            io: 500,
            cpu: config.cpu,
        },
        feature_limits: {
            databases: 1,
            allocations: 1,
            backups: 1
        },
        deploy: {
            locations: [config.locationId],
            dedicated_ip: false,
            port_range: []
        }
    };

    try {
        const response = await fetch(url, { // 'fetch' ini sekarang merujuk ke 'node-fetch'
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(serverData)
        });

        const data = await response.json();

        if (response.status === 201) {
            return { success: true, data: data.attributes };
        } else {
            console.error("Error Pterodactyl API Server:", JSON.stringify(data.errors, null, 2));
            return { success: false, error: data.errors ? data.errors[0].detail : 'Gagal membuat server.' };
        }
    } catch (error) {
        console.error("Error saat fetch API Server:", error);
        return { success: false, error: 'Gagal terhubung ke Pterodactyl API untuk membuat server.' };
    }
}

// --- API HANDLER UTAMA ---
// Gunakan 'module.exports' (CommonJS) agar sesuai dengan 'require'
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Metode tidak diizinkan' });
    }

    const { serverName, ram, secretKey, panelType } = req.body;

    let config;
    let APP_SECRET_KEY;

    if (panelType === 'private') {
        APP_SECRET_KEY = process.env.PRIVATE_APP_SECRET_KEY;
        config = {
            domain: process.env.PRIVATE_PTERODACTYL_DOMAIN,
            apiKey: process.env.PRIVATE_PTERODACTYL_API_KEY,
            eggId: parseInt(process.env.PRIVATE_PTERODACTYL_EGG_ID, 10),
            disk: parseInt(process.env.PRIVATE_PTERODACTYL_DISK, 10),
            cpu: parseInt(process.env.PRIVATE_PTERODACTYL_CPU, 10),
            locationId: parseInt(process.env.PRIVATE_PTERODACTYL_LOCATION_ID, 10),
        };
    } else if (panelType === 'public') {
        APP_SECRET_KEY = process.env.PUBLIC_APP_SECRET_KEY;
        config = {
            domain: process.env.PUBLIC_PTERODACTYL_DOMAIN,
            apiKey: process.env.PUBLIC_PTERODACTYL_API_KEY,
            eggId: parseInt(process.env.PUBLIC_PTERODACTYL_EGG_ID, 10),
            disk: parseInt(process.env.PUBLIC_PTERODACTYL_DISK, 10),
            cpu: parseInt(process.env.PUBLIC_PTERODACTYL_CPU, 10),
            locationId: parseInt(process.env.PUBLIC_PTERODACTYL_LOCATION_ID, 10),
        };
    } else {
        return res.status(400).json({ success: false, error: 'Tipe panel tidak valid.' });
    }
    
    if (secretKey !== APP_SECRET_KEY) {
        return res.status(403).json({ success: false, error: 'Kunci Rahasia salah.' });
    }

    if (!serverName || !ram || !config.domain || !config.apiKey || !config.eggId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Input tidak lengkap atau Konfigurasi Environment Variable di Vercel belum di-set.' 
        });
    }

    try {
        const userResult = await createUser(serverName, config);
        if (!userResult.success) {
            return res.status(500).json(userResult);
        }

        const newUser = userResult.user;
        const newUserPassword = userResult.password;

        const serverResult = await createServer(serverName, ram, newUser.id, config);
        if (!serverResult.success) {
            return res.status(500).json({ 
                success: false, 
                error: serverResult.error, 
                detail: "Server gagal dibuat, tapi akun panel mungkin sudah dibuat.",
                user: newUser,
                password: newUserPassword
            });
        }

        const serverInfo = serverResult.data;

        res.status(201).json({
            success: true,
            panelUrl: config.domain,
            username: newUser.username,
            email: newUser.email,
            password: newUserPassword,
            serverName: serverInfo.name,
            serverRam: serverInfo.limits.memory
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Terjadi kesalahan internal: ' + error.message });
    }
};
