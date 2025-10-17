// Connexion Socket.io
const socket = io();

// Variables globales
let currentRoom = null;
let currentQuestions = [];
let currentQuestionIndex = 0;
let score = 0;
let timer = null;
let timeLeft = 30;
let hasAnswered = false;
let currentUser = {
    id: 'user_' + Math.random().toString(36).substr(2, 9),
    username: ''
};

// ============================================
// FONCTIONS DE NAVIGATION
// ============================================

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showNotification(message, type = 'success') {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.className = `notification ${type} show`;
    setTimeout(() => notif.classList.remove('show'), 3000);
}

// ============================================
// GESTION DES ROOMS
// ============================================

async function createRoom() {
    const roomName = document.getElementById('room-name').value.trim();
    const username = document.getElementById('username-create')?.value.trim() || 'Joueur';
    
    if (!roomName) {
        showNotification('Veuillez entrer un nom de room', 'error');
        return;
    }
    
    currentRoom = roomName;
    currentUser.username = username;
    
    socket.emit('join-room', {
        roomId: currentRoom,
        username: currentUser.username
    });
    
    document.getElementById('current-room-code').textContent = currentRoom;
    showScreen('waiting-screen');
    showNotification('Room créée avec succès!');
}

function joinRoom() {
    const roomId = document.getElementById('join-room-id').value.trim();
    const username = document.getElementById('username-join')?.value.trim() || 'Joueur';
    
    if (!roomId) {
        showNotification('Veuillez entrer un code de room', 'error');
        return;
    }
    
    currentRoom = roomId;
    currentUser.username = username;
    
    socket.emit('join-room', {
        roomId: currentRoom,
        username: currentUser.username
    });
    
    document.getElementById('current-room-code').textContent = currentRoom;
    showScreen('waiting-screen');
    showNotification('Vous avez rejoint la room!');
}

function leaveRoom() {
    currentRoom = null;
    currentQuestionIndex = 0;
    score = 0;
    showScreen('home-screen');
}

// ============================================
// GESTION DU JEU
// ============================================

async function startGame() {
    if (!currentRoom) {
        showNotification('Erreur: Aucune room sélectionnée', 'error');
        return;
    }
    socket.emit('start-game', currentRoom);
}

async function loadQuestions() {
    try {
        const response = await fetch('/questions');
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des questions');
        }
        currentQuestions = await response.json();
        
        if (currentQuestions.length === 0) {
            showNotification('Aucune question disponible', 'error');
            return;
        }
        
        currentQuestionIndex = 0;
        score = 0;
        showQuestion();
    } catch (error) {
        console.error('Erreur lors du chargement des questions:', error);
        showNotification('Erreur lors du chargement des questions', 'error');
    }
}

function showQuestion() {
    if (currentQuestionIndex >= currentQuestions.length) {
        endGame();
        return;
    }

    hasAnswered = false;
    timeLeft = 30;
    const question = currentQuestions[currentQuestionIndex];
    
    // Mettre à jour le numéro de question
    document.getElementById('question-number').textContent = 
        `Question ${currentQuestionIndex + 1}/${currentQuestions.length}`;
    
    // Afficher la question
    document.getElementById('question-text').textContent = question.question;
    
    // Mettre à jour la barre de progression
    const progress = ((currentQuestionIndex + 1) / currentQuestions.length) * 100;
    document.getElementById('progress').style.width = progress + '%';

    // Afficher les options
    const optionsContainer = document.getElementById('options');
    optionsContainer.innerHTML = '';
    
    const options = Array.isArray(question.options) ? question.options : JSON.parse(question.options);
    
    options.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option';
        optionDiv.textContent = option;
        optionDiv.onclick = () => selectAnswer(index, optionDiv);
        optionsContainer.appendChild(optionDiv);
    });

    // Cacher le bouton "Question suivante"
    document.getElementById('next-btn').style.display = 'none';
    
    // Démarrer le timer
    startTimer();
}

// ============================================
// GESTION DU TIMER
// ============================================

function startTimer() {
    clearInterval(timer);
    const timerElement = document.getElementById('timer');
    timerElement.classList.remove('warning');
    timerElement.textContent = timeLeft;
    
    timer = setInterval(() => {
        timeLeft--;
        timerElement.textContent = timeLeft;
        
        if (timeLeft <= 10) {
            timerElement.classList.add('warning');
        }
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            if (!hasAnswered) {
                showNotification('Temps écoulé!', 'error');
                disableAllOptions();
                highlightCorrectAnswer();
                setTimeout(() => nextQuestion(), 2000);
            }
        }
    }, 1000);
}

// ============================================
// GESTION DES RÉPONSES
// ============================================

function selectAnswer(answerIndex, optionElement) {
    if (hasAnswered) return;
    
    hasAnswered = true;
    clearInterval(timer);
    
    const question = currentQuestions[currentQuestionIndex];
    const isCorrect = answerIndex === question.correctAnswer;
    
    // Émettre la réponse au serveur
    socket.emit('answer-question', {
        questionId: question.id,
        answer: answerIndex,
        roomId: currentRoom
    });
    
    // Désactiver toutes les options
    disableAllOptions();
    
    // Afficher le feedback visuel
    if (isCorrect) {
        score++;
        optionElement.classList.add('correct');
        showNotification('Bonne réponse! 🎉', 'success');
    } else {
        optionElement.classList.add('incorrect');
        highlightCorrectAnswer();
        showNotification('Mauvaise réponse!', 'error');
    }
    
    // Afficher le bouton "Question suivante"
    document.getElementById('next-btn').style.display = 'block';
}

function disableAllOptions() {
    document.querySelectorAll('.option').forEach(opt => {
        opt.style.pointerEvents = 'none';
    });
}

function highlightCorrectAnswer() {
    const question = currentQuestions[currentQuestionIndex];
    const options = document.querySelectorAll('.option');
    if (options[question.correctAnswer]) {
        options[question.correctAnswer].classList.add('correct');
    }
}

function nextQuestion() {
    currentQuestionIndex++;
    showQuestion();
}

// ============================================
// FIN DU JEU
// ============================================

async function endGame() {
    clearInterval(timer);
    showScreen('results-screen');
    
    // Afficher le score final
    document.getElementById('final-score').textContent = `${score}/${currentQuestions.length}`;
    
    // Calculer le pourcentage et afficher un message
    const percentage = (score / currentQuestions.length) * 100;
    let message = '';
    let trophy = '';
    
    if (percentage === 100) {
        message = 'Parfait! Vous êtes un champion! 🌟';
        trophy = '🏆';
    } else if (percentage >= 80) {
        message = 'Excellent travail! 👏';
        trophy = '🥇';
    } else if (percentage >= 60) {
        message = 'Bon travail! 👍';
        trophy = '🥈';
    } else if (percentage >= 40) {
        message = 'Pas mal, continuez! 💪';
        trophy = '🥉';
    } else {
        message = 'Continuez à vous entraîner! 📚';
        trophy = '📖';
    }
    
    document.getElementById('result-message').textContent = message;
    document.getElementById('trophy').textContent = trophy;
    
    // Soumettre le score au serveur
    try {
        await fetch('/submit-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser.id,
                score: score,
                gameId: currentRoom
            })
        });
    } catch (error) {
        console.error('Erreur lors de la soumission du score:', error);
    }
}

function restartGame() {
    currentQuestionIndex = 0;
    score = 0;
    showScreen('waiting-screen');
}

function goHome() {
    currentQuestionIndex = 0;
    score = 0;
    currentRoom = null;
    showScreen('home-screen');
}

// ============================================
// GESTION DES JOUEURS
// ============================================

function updatePlayersList(players) {
    const container = document.getElementById('players-waiting');
    container.innerHTML = '';
    
    players.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        const isMe = player.id === socket.id;
        playerDiv.innerHTML = `
            <span class="player-name">${isMe ? '👤 ' + player.username + ' (Vous)' : '👥 ' + player.username}</span>
            <span class="player-score">Prêt ✓</span>
        `;
        container.appendChild(playerDiv);
    });
}

function updateScores(scoresData) {
    const container = document.getElementById('players-scores');
    container.innerHTML = '';
    
    // Convertir l'objet en tableau et trier par score
    const sortedScores = Object.entries(scoresData)
        .sort((a, b) => b[1].score - a[1].score);
    
    sortedScores.forEach(([playerId, data]) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        const isMe = playerId === socket.id;
        playerDiv.innerHTML = `
            <span class="player-name">${isMe ? '👤 ' + data.username + ' (Vous)' : '👥 ' + data.username}</span>
            <span class="player-score">${data.score} pts</span>
        `;
        container.appendChild(playerDiv);
    });

    // Mettre à jour le classement final
    const finalRanking = document.getElementById('final-ranking');
    finalRanking.innerHTML = '';
    
    sortedScores.forEach(([playerId, data], index) => {
        const rankDiv = document.createElement('div');
        rankDiv.className = 'player-item';
        const medals = ['🥇', '🥈', '🥉'];
        const medal = medals[index] || '🎮';
        const isMe = playerId === socket.id;
        rankDiv.innerHTML = `
            <span class="player-name">${medal} ${isMe ? data.username + ' (Vous)' : data.username}</span>
            <span class="player-score">${data.score} pts</span>
        `;
        finalRanking.appendChild(rankDiv);
    });
}

// ============================================
// ÉVÉNEMENTS SOCKET.IO
// ============================================

socket.on('connect', () => {
    console.log('✅ Connecté au serveur');
});

socket.on('disconnect', () => {
    console.log('❌ Déconnecté du serveur');
    showNotification('Connexion perdue au serveur', 'error');
});

socket.on('player-joined', (players) => {
    console.log('Joueurs dans la room:', players);
    updatePlayersList(players);
});

socket.on('player-left', (players) => {
    console.log('Un joueur a quitté la room');
    updatePlayersList(players);
    showNotification('Un joueur a quitté la partie', 'error');
});

socket.on('update-score', (scoresData) => {
    console.log('Mise à jour des scores:', scoresData);
    updateScores(scoresData);
});

socket.on('game-started', () => {
    console.log('🎮 Le jeu commence!');
    showScreen('game-screen');
    loadQuestions();
});

socket.on('message', (msg) => {
    console.log('Message:', msg);
});

socket.on('answer-feedback', (data) => {
    console.log('Feedback:', data);
});

socket.on('chat-message', (data) => {
    console.log(`[${data.timestamp}] ${data.username}: ${data.message}`);
});

socket.on('error', (error) => {
    console.error('Erreur Socket.IO:', error);
    showNotification('Erreur de connexion', 'error');
});

// ============================================
// INITIALISATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🎮 Application Quiz Battle initialisée');
    
    // Vérifier la connexion Socket.io
    if (!socket.connected) {
        console.warn('Socket.io non connecté');
    }
    
    // Afficher l'écran d'accueil
    showScreen('home-screen');
});

// Gestion de la fermeture de la page
window.addEventListener('beforeunload', () => {
    if (currentRoom) {
        socket.disconnect();
    }
});