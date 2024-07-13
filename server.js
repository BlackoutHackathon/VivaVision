const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(cors());
app.use(express.json());

// Armazena as localizações dos clientes, POIs e informações de sessão
let clients = {};
let pois = {}; // POIs
let clientEntryTimes = {}; // Para armazenar tempos de entrada
let clientSessions = {}; // Para armazenar as sessões dos clientes
let clientTrails = {}; // Para armazenar rastros dos clientes

// Serve arquivos estáticos da pasta 'public'
app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('A client connected:', socket.id);

    // Inicializa a sessão do cliente
    clientSessions[socket.id] = {
        startTime: Date.now(),
        poisVisited: new Set(),
        trail: []
    };

    // Recebe atualizações de localização dos clientes
    socket.on('location', (data) => {
        const { id, latitude, longitude } = data;
        clients[id] = { latitude, longitude };

        // Atualiza o rastro do cliente
        if (clientTrails[id]) {
            clientTrails[id].push({ latitude, longitude, timestamp: Date.now() });
        } else {
            clientTrails[id] = [{ latitude, longitude, timestamp: Date.now() }];
        }

        // Verifica proximidade e atualiza tempos de permanência
        checkPOIProximity(id, latitude, longitude);

        io.emit('location', { id: socket.id, ...data });
    });

    // Adiciona um novo POI
    socket.on('box', (data) => {
        const { id, latitude, longitude, type, details } = data;
        pois[id] = { latitude, longitude, type, details };
        io.emit('box', data);
    });

    // Remove um POI
    socket.on('box_removed', (data) => {
        const { id } = data;
        delete pois[id];
        io.emit('box_removed', data);
    });

    // Trata desconexão dos clientes
    socket.on('disconnect', () => {
        console.log('A client disconnected:', socket.id);
        delete clients[socket.id];

        // Calcula o tempo total de permanência e salva a sessão
        const session = clientSessions[socket.id];
        if (session) {
            const endTime = Date.now();
            const duration = (endTime - session.startTime) / 1000; // Tempo em segundos
            saveSession(socket.id, duration, session.poisVisited, clientTrails[socket.id]);
            delete clientSessions[socket.id];
            delete clientTrails[socket.id];
        }

        io.emit('client_disconnect', { id: socket.id });
    });
});

function checkPOIProximity(clientId, lat, lon) {
    const radius = 10; // Distância máxima para considerar a proximidade (em metros)

    Object.keys(pois).forEach(poiId => {
        const { latitude, longitude } = pois[poiId];
        const distance = calculateDistance(lat, lon, latitude, longitude);

        if (distance < radius) {
            if (!clientEntryTimes[clientId]) {
                clientEntryTimes[clientId] = {};
            }
            if (!clientEntryTimes[clientId][poiId]) {
                clientEntryTimes[clientId][poiId] = Date.now();
                io.emit('entry', { clientId, poiId });

                // Registra o POI visitado
                if (clientSessions[clientId]) {
                    clientSessions[clientId].poisVisited.add(poiId);
                }
            }
        } else {
            if (clientEntryTimes[clientId] && clientEntryTimes[clientId][poiId]) {
                const enterTime = clientEntryTimes[clientId][poiId];
                const duration = (Date.now() - enterTime) / 1000; // Tempo em segundos
                io.emit('time_update', { clientId, poiId, duration });
                delete clientEntryTimes[clientId][poiId];
            }
        }
    });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Raio da Terra em metros
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function saveSession(clientId, duration, poisVisited, trail) {
    const sessionData = {
        clientId,
        duration,
        poisVisited: Array.from(poisVisited),
        trail
    };

    // Salva os dados em um arquivo JSON (ou pode usar um banco de dados)
    const filePath = path.join(__dirname, 'sessions', `${clientId}_${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
