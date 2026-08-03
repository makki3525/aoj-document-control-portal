'use strict';
// Local dev server. On Vercel, api/drive.js and public/ are served directly.
const express = require('express');
const path    = require('path');
const drive   = require('./api/drive');

const app = express();
app.use(express.json({ limit: '2mb' }));

// API
app.all('/api/drive', drive);

// Static
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Pretty routes
const send = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get('/',              send('index.html'));
app.get('/projects',      send('projects.html'));
app.get('/project/:id',   send('project.html'));
app.get('/about',         send('about.html'));
app.get('/contact',       send('contact.html'));
app.get('/login',         send('login.html'));
app.get('/admin',         send('admin.html'));

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AOJ Portal running → http://localhost:${PORT}`));
