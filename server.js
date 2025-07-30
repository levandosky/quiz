const express = require('express');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configure session middleware
app.use(session({
  secret: 'your-secret-key', // Replace with a secure key
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

let questions = [];
let currentIndex = 0;
let currentQuestion = null; // Initialize as null
let clicks = {}; // {username: timeTaken}
let startTime = null; // Timer start time
let szanse = {}; // {username: szanseValue}
let userScores = {}; // {username: scoreValue}
let usedQuestions = []; // Track used question indices

// Load questions from JSON
try {
  const data = fs.readFileSync(__dirname + '/public/questions.json', 'utf8');
  questions = JSON.parse(data);
} catch (err) {
  console.error("Błąd wczytywania questions.json", err);
}

// Serve static files (HTML + questions.json)
app.use(express.static('public'));

// View endpoints
app.get('/', (req, res) => res.sendFile(__dirname + '/public/user.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/public/admin.html'));
app.get('/question', (req, res) => res.sendFile(__dirname + '/public/question.html'));

// Endpoint to set username in session
app.post('/set-username', express.json(), (req, res) => {
  const { username } = req.body;
  if (username) {
    req.session.username = username;
    res.status(200).send({ message: 'Username saved in session.' });
  } else {
    res.status(400).send({ message: 'Username is required.' });
  }
});

// Endpoint to get username from session
app.get('/get-username', (req, res) => {
  if (req.session.username) {
    res.status(200).send({ username: req.session.username });
  } else {
    res.status(404).send({ message: 'No username found in session.' });
  }
});

io.on('connection', (socket) => {
  console.log('Nowy klient połączony');

  // Send current state on connection
  socket.emit('question', currentQuestion); // Send null initially
  socket.emit('clicks', clicks);
  socket.emit('questions', questions);
  socket.emit('userScores', userScores);
  socket.emit('usedQuestions', usedQuestions);

  // Send szanse value for this user if username is set in session
  if (socket.handshake.headers.cookie) {
    // Parse session cookie to get username (simple parsing, for demo)
    const match = socket.handshake.headers.cookie.match(/connect\.sid=[^;]+/);
    if (match && socket.request.session && socket.request.session.username) {
      const username = socket.request.session.username;
      socket.emit('user_szanse', szanse[username] !== undefined ? szanse[username] : 3);
      socket.emit('user_score', userScores[username] !== undefined ? userScores[username] : 0);
    }
  }

  // Admin manually changes the question
  socket.on('admin_new_question', (question) => {
    currentQuestion = question;
    Object.keys(clicks).forEach(username => {
      clicks[username] = ""; // Clear previous times
    });
    startTime = Date.now(); // Reset timer
    io.emit('question', currentQuestion);
    io.emit('clicks', clicks);
  });

  // Admin moves to the next question or selects a specific question
  socket.on('admin_next_question', (selectedIndex) => {
    if (selectedIndex !== undefined && questions[selectedIndex]) {
      currentIndex = selectedIndex;
    } else {
      currentIndex = (currentIndex + 1) % questions.length;
    }
    currentQuestion = questions[currentIndex];
    Object.keys(clicks).forEach(username => {
      clicks[username] = ""; // Clear previous times
    });
    startTime = Date.now(); // Reset timer
    // Mark question as used
    if (!usedQuestions.includes(currentIndex)) {
      usedQuestions.push(currentIndex);
    }
    io.emit('question', currentQuestion);
    io.emit('clicks', clicks);
    io.emit('usedQuestions', usedQuestions); // Notify admins
  });

  // User clicked
  socket.on('user_click', ({ username, timeTaken }) => {
    socket.username = username;
    if (timeTaken !== undefined) {
      clicks[username] = timeTaken; // Save time taken in seconds
      io.emit('clicks', clicks);
    } else {
      if (!clicks[username]) {
        clicks[username] = "-";
        io.emit('clicks', clicks);
      }
    }
    if (userScores[username] === undefined) {
      userScores[username] = 0;
      io.emit('userScores', userScores);
    }
  });

  // Handle szanse update from admin
  socket.on('admin_update_szanse', ({ username, delta }) => {
    if (szanse[username] === undefined) szanse[username] = 3;
    szanse[username] += delta;
    io.emit('szanse', szanse);
    // Emit updated szanse to the specific user
    for (const s of io.sockets.sockets.values()) {
      if (s.username === username) {
        s.emit('user_szanse', szanse[username]);
      }
    }
  });

  // Handle score update from admin
  socket.on('admin_update_score', ({ username, delta }) => {
    if (userScores[username] === undefined) userScores[username] = 0;
    userScores[username] += delta;
    io.emit('userScores', userScores);
    // Emit updated score to the specific user
    for (const s of io.sockets.sockets.values()) {
      if (s.username === username) {
        s.emit('user_score', userScores[username]);
      }
    }
  });

  // Allow admin to reset used questions if needed
  socket.on('admin_reset', () => {
    Object.keys(clicks).forEach(username => {
      clicks[username] = "";
    });
    usedQuestions = [];
    io.emit('clicks', clicks);
    io.emit('usedQuestions', usedQuestions);
  });

  socket.on('disconnect', () => {
    console.log('Klient się rozłączył');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
});