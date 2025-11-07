const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const socketIo = require('socket.io');
const redis = require('redis');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ⚙️ Configuration PostgreSQL (sans SSL)
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: process.env.DB_SSL === "true"
});

// ⚙️ Configuration Redis
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

redisClient.on('error', (err) => console.error('❌ Erreur Redis :', err));
redisClient.on('connect', () => console.log('✅ Redis connecté'));

// Connexion aux BDD
(async () => {
  try {
    await redisClient.connect();
    const client = await pool.connect();
    console.log('✅ Connexion PostgreSQL réussie');
    client.release();
  } catch (err) {
    console.error('❌ Erreur de connexion PostgreSQL :', err);
  }
})();

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// =======================
// ROUTES API
// =======================

// ➤ Récupérer les questions
app.get('/questions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM questions ORDER BY RANDOM() LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

// ➤ Soumettre un score
app.post('/submit-score', async (req, res) => {
  const { userId, score, gameId } = req.body;
  try {
    await pool.query(
      'INSERT INTO resultats (id_utilisateur, score, id_partie) VALUES ($1, $2, $3)',
      [userId, score, gameId]
    );
    res.status(200).send('Score enregistré');
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur');
  }
});

// =======================
// SOCKET.IO - MODE MULTIJOUEUR
// =======================
io.on('connection', (socket) => {
  console.log('👤 Un utilisateur connecté');

  socket.on('join-room', async (roomId) => {
    socket.join(roomId);
    io.to(roomId).emit('message', 'Un joueur a rejoint la room');
  });

  socket.on('answer-question', async (data) => {
    try {
      const result = await pool.query('SELECT reponse_correcte FROM questions WHERE id = $1', [data.questionId]);
      const isCorrect = result.rows[0].reponse_correcte === data.answer;

      if (isCorrect) {
        let scores = JSON.parse(await redisClient.get(`room:${data.roomId}:scores`) || '{}');
        scores[socket.id] = (scores[socket.id] || 0) + 1;
        await redisClient.set(`room:${data.roomId}:scores`, JSON.stringify(scores));
        io.to(data.roomId).emit('update-score', scores);
      }
    } catch (err) {
      console.error('Erreur lors du traitement de la réponse :', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('👋 Utilisateur déconnecté');
  });
});

// =======================
// LANCEMENT DU SERVEUR
// =======================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});