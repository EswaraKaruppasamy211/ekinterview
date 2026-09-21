const server = require('../server.js');

if (require.main === module) {
  server.startServer();
}

module.exports = server;
