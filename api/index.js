const backendHandler = require('../backend/server');

module.exports = function apiHandler(req, res) {
  return backendHandler(req, res);
};
