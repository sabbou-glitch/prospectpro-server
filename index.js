// Point d'entrée. La clé Google n'est plus écrite dans le code : voir .env.example.
const { createApp } = require('./src/server');
const config = require('./src/config');
const host = process.env.HOST || '0.0.0.0';
createApp().listen(config.port, host, () => console.log(`Serveur des agents démarré sur http://${host}:${config.port}`));
