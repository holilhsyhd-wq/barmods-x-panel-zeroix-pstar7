// --- FUNGSI DARI BOT ANDA (DIMODIFIKASI UNTUK ENV VARS) ---

// Fungsi ini membaca konfigurasi dari Environment Variables Vercel
function getPterodactylConfig() {
    return {
        domain: process.env.PTERODACTYL_DOMAIN,
        apiKey: process.env.PTERODACTYL_API_KEY,
        eggId: parseInt(process.env.PTERODACTYL_EGG_ID, 10),
        disk: parseInt(process.env.PTERODACTYL_DISK, 10),
        cpu: parseInt(process.env.PTERODACTYL_CPU, 10),
        locationId: parseInt(process.env.PTERODACTYL_LOCATION_ID, 10),
    };
}

async function createUser(serverName) {
    const pterodactyl = getPterodactylConfig();
    const url = `${pterodactyl.domain}/api/application/users`;
    
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
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pterodactyl.apiKey}`,
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

async function createServer(serverName, memory, pterodactylUserId) {
    const pterodactyl = getPterodactylConfig();
    const url = `${pterodactyl.domain}/api/application/servers`;

    const serverData = {
        name: serverName,
        user: pterodactylUserId,
        egg: pterodactyl.eggId,
        docker_image: "ghcr.io/parkervcp/yolks:nodejs_18",
        startup: "if [[ -d .git ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ -f /home/container/package.json ]]; then /usr/local/bin/npm install; fi; {{CMD_RUN}}",
        environment: {
            USER_ID: 1, // Diambil dari Telegram ID, di web kita set default saja
            CMD_RUN: "node index.js" 
        },
        limits: {
            memory: parseInt(memory),
            swap: 0,
            disk: pterodactyl.disk,
            io: 500,
            cpu: pterodactyl.cpu,
        },
        feature_limits: {
            databases: 1,
            allocations: 1,
            backups: 1
        },
        deploy: {
            locations: [pterodactyl.locationId],
            dedicated_ip: false,
            port_range: []
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pterodactyl.apiKey}`,
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
// Vercel akan otomatis membaca 'export default' ini
export default async function handler(req, res) {
    // 1. Hanya izinkan metode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Metode tidak diizinkan' });
    }

    const { serverName, ram, secretKey } = req.body;
    
    // 2. Autentikasi: Ganti 'authorizedUserId' dengan kunci rahasia dari env
    const APP_SECRET_KEY = process.env.APP_SECRET_KEY;
    if (secretKey !== APP_SECRET_KEY) {
        return res.status(403).json({ success: false, error: 'Kunci Rahasia salah.' });
    }

    // 3. Validasi input
    if (!serverName || !ram) {
        return res.status(400).json({ success: false, error: 'Nama Server dan RAM wajib diisi.' });
    }

    try {
        // 4. Langkah 1: Buat Pengguna
        const userResult = await createUser(serverName);
        if (!userResult.success) {
            return res.status(500).json(userResult);
        }

        const newUser = userResult.user;
        const newUserPassword = userResult.password;

        // 5. Langkah 2: Buat Server
        const serverResult = await createServer(serverName, ram, newUser.id);
        if (!serverResult.success) {
            // Jika server gagal dibuat, kita tetap kirim info user agar bisa dicek
            return res.status(500).json({ 
                success: false, 
                error: serverResult.error, 
                detail: "Server gagal dibuat, tapi akun panel mungkin sudah dibuat.",
                user: newUser,
                password: newUserPassword
            });
        }

        const serverInfo = serverResult.data;

        // 6. Kirim respon sukses
        res.status(201).json({
            success: true,
            panelUrl: getPterodactylConfig().domain,
            username: newUser.username,
            email: newUser.email,
            password: newUserPassword,
            serverName: serverInfo.name,
            serverRam: serverInfo.limits.memory
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Terjadi kesalahan internal: ' + error.message });
    }
}
