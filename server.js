const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg');
const redis = require('redis');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration Redis
const redisClient = redis.createClient({
  socket: {
    host: 'localhost',
    port: 6379
  }
});
redisClient.on('error', (err) => console.error('❌ Erreur Redis :', err));
redisClient.on('connect', () => console.log('✅ Redis connecté'));

// Configuration PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'quiz_db',
  password: 'chancia',
  port: 5432,
});

// Connexion aux bases de données
(async () => {
  try {
    await redisClient.connect();
    console.log("✅ Connexion Redis réussie");
    
    const client = await pool.connect();
    console.log("✅ Connexion PostgreSQL réussie");
    client.release();
  } catch (err) {
    console.error("❌ Erreur de connexion :", err);
  }
})();

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'quiz_secret_key_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Route pour la page principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route d'inscription
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  try {
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await pool.query(
      'SELECT * FROM utilisateurs WHERE nom_utilisateur = $1',
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Cet utilisateur existe déjà' });
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insérer le nouvel utilisateur
    const result = await pool.query(
      'INSERT INTO utilisateurs (nom_utilisateur, mot_de_passe) VALUES ($1, $2) RETURNING id, nom_utilisateur',
      [username, hashedPassword]
    );

    req.session.userId = result.rows[0].id;
    req.session.username = result.rows[0].nom_utilisateur;

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      user: {
        id: result.rows[0].id,
        username: result.rows[0].nom_utilisateur
      }
    });
  } catch (err) {
    console.error('Erreur lors de l\'inscription:', err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription' });
  }
});

// Route de connexion
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM utilisateurs WHERE nom_utilisateur = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.mot_de_passe);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    req.session.userId = user.id;
    req.session.username = user.nom_utilisateur;

    res.json({
      message: 'Connexion réussie',
      user: {
        id: user.id,
        username: user.nom_utilisateur
      }
    });
  } catch (err) {
    console.error('Erreur lors de la connexion:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion' });
  }
});

// Route de déconnexion
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
    }
    res.json({ message: 'Déconnexion réussie' });
  });
});

// Route pour récupérer les questions
app.get('/questions', async (req, res) => {
  try {
    // Compatible avec le schéma JSONB
    const result = await pool.query(`
      SELECT id, question, options, reponse_correcte 
      FROM questions 
      ORDER BY RANDOM() 
      LIMIT 10
    `);
    
    // Formater les données pour le frontend
    const formattedQuestions = result.rows.map(row => ({
      id: row.id,
      question: row.question,
      options: row.options, // Déjà au format JSON
      correctAnswer: row.reponse_correcte
    }));
    
    res.json(formattedQuestions);
  } catch (err) {
    console.error('Erreur lors de la récupération des questions:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour ajouter une question (admin)
app.post('/add-question', async (req, res) => {
  const { question, options, correctAnswer } = req.body;

  if (!question || !options || correctAnswer === undefined) {
    return res.status(400).json({ error: 'Données manquantes' });
  }

  try {
    await pool.query(
      'INSERT INTO questions (question, options, reponse_correcte) VALUES ($1, $2, $3)',
      [question, JSON.stringify(options), correctAnswer]
    );
    res.status(201).json({ message: 'Question ajoutée avec succès' });
  } catch (err) {
    console.error('Erreur lors de l\'ajout de la question:', err);
    res.status(500).json({ error: 'Erreur lors de l\'ajout' });
  }
});

// Route pour soumettre un score
app.post('/submit-score', async (req, res) => {
  const { userId, score, gameId } = req.body;
  try {
    await pool.query(
      'INSERT INTO resultats (id_utilisateur, score, id_partie) VALUES ($1, $2, $3)', 
      [userId, score, gameId]
    );
    res.status(200).json({ message: 'Score enregistré' });
  } catch (err) {
    console.error('Erreur lors de l\'enregistrement du score:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
  }
});

// Route pour récupérer le classement
app.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.nom_utilisateur, r.score, r.id_partie, 
             TO_CHAR(r.created_at, 'DD/MM/YYYY HH24:MI') as date
      FROM resultats r
      JOIN utilisateurs u ON r.id_utilisateur = u.id
      ORDER BY r.score DESC, r.created_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur lors de la récupération du classement:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Gestion des sockets
const rooms = new Map(); // Stocker les informations des rooms

io.on('connection', (socket) => {
  console.log('👤 Utilisateur connecté:', socket.id);

  socket.on('join-room', async (data) => {
    const { roomId, username } = data;
    socket.join(roomId);
    socket.username = username || `Joueur_${socket.id.substring(0, 4)}`;
    
    console.log(`🚪 ${socket.username} a rejoint la room ${roomId}`);
    
    // Ajouter le joueur à la room Redis avec son nom
    await redisClient.sAdd(`room:${roomId}:players`, socket.id);
    await redisClient.hSet(`room:${roomId}:usernames`, socket.id, socket.username);
    
    // Initialiser le score du joueur
    await redisClient.hSet(`room:${roomId}:scores`, socket.id, '0');
    
    // Récupérer la liste des joueurs avec leurs noms
    const playerIds = await redisClient.sMembers(`room:${roomId}:players`);
    const players = [];
    
    for (const playerId of playerIds) {
      const username = await redisClient.hGet(`room:${roomId}:usernames`, playerId);
      players.push({ id: playerId, username: username || 'Joueur' });
    }
    
    io.to(roomId).emit('player-joined', players);
    io.to(roomId).emit('message', `${socket.username} a rejoint la room`);
  });

  socket.on('answer-question', async (data) => {
    try {
      const result = await pool.query(
        'SELECT reponse_correcte FROM questions WHERE id = $1', 
        [data.questionId]
      );
      
      if (result.rows.length === 0) return;
      
      const isCorrect = result.rows[0].reponse_correcte === data.answer;
      
      if (isCorrect) {
        // Incrémenter le score
        const newScore = await redisClient.hIncrBy(`room:${data.roomId}:scores`, socket.id, 1);
        
        // Récupérer tous les scores avec les noms d'utilisateurs
        const scores = await redisClient.hGetAll(`room:${data.roomId}:scores`);
        const usernames = await redisClient.hGetAll(`room:${data.roomId}:usernames`);
        
        const scoresWithNames = {};
        for (const [playerId, score] of Object.entries(scores)) {
          scoresWithNames[playerId] = {
            score: parseInt(score),
            username: usernames[playerId] || 'Joueur'
          };
        }
        
        io.to(data.roomId).emit('update-score', scoresWithNames);
        socket.emit('answer-feedback', { correct: true, message: 'Bonne réponse! 🎉' });
      } else {
        socket.emit('answer-feedback', { correct: false, message: 'Mauvaise réponse!' });
      }
    } catch (err) {
      console.error('Erreur lors de la vérification de la réponse:', err);
    }
  });

  socket.on('start-game', async (roomId) => {
    console.log(`🎮 Début du jeu dans la room ${roomId}`);
    
    // Initialiser tous les scores à 0
    const playerIds = await redisClient.sMembers(`room:${roomId}:players`);
    for (const playerId of playerIds) {
      await redisClient.hSet(`room:${roomId}:scores`, playerId, '0');
    }
    
    io.to(roomId).emit('game-started');
  });

  socket.on('send-message', async (data) => {
    const { roomId, message } = data;
    const username = socket.username || 'Joueur';
    io.to(roomId).emit('chat-message', {
      username,
      message,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  socket.on('disconnect', async () => {
    console.log('👤 Utilisateur déconnecté:', socket.id);
    
    // Nettoyer les données Redis pour toutes les rooms
    const keys = await redisClient.keys('room:*:players');
    for (const key of keys) {
      const isMember = await redisClient.sIsMember(key, socket.id);
      if (isMember) {
        const roomId = key.split(':')[1];
        await redisClient.sRem(`room:${roomId}:players`, socket.id);
        await redisClient.hDel(`room:${roomId}:scores`, socket.id);
        await redisClient.hDel(`room:${roomId}:usernames`, socket.id);
        
        // Notifier les autres joueurs
        const players = await redisClient.sMembers(`room:${roomId}:players`);
        const usernames = await redisClient.hGetAll(`room:${roomId}:usernames`);
        const playersList = players.map(id => ({
          id,
          username: usernames[id] || 'Joueur'
        }));
        
        io.to(roomId).emit('player-left', playersList);
        io.to(roomId).emit('message', `${socket.username} a quitté la room`);
      }
    }
  });
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
  console.error('❌ Exception non capturée:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('❌ Rejet non géré:', err);
});

// Nettoyage lors de l'arrêt du serveur
process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du serveur...');
  await redisClient.quit();
  await pool.end();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur http://localhost:${PORT}`);
});