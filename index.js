// Arquivo index.js - Ponto de entrada para o servidor
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Iniciar o servidor Express para manter a aplicação ativa
app.get('/', (req, res) => {
  res.send('Bot financeiro está rodando!');
});

// Rota para verificar status
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

// Importar e iniciar o bot
require('./bot.js');
