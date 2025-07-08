const express = require('express');
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const app = express();
const server = createServer(app);
const makeService = createEndpoint({server});
const opts = Object.assign({
  timestamp: () => `, "time": "${new Date().toISOString()}"`,
  level: process.env.LOGLEVEL || 'info'
});
const logger = require('pino')(opts);
const port = process.env.WS_PORT || 3000;

// Set up app locals
app.locals = {
  ...app.locals,
  logger
};

// Add middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up environment routes
app.use('/', require('./lib/env-vars'));

// Set up WebSocket routes
require('./lib/routes')({logger, makeService});

// Handle 404 - Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Handle other errors
app.use((err, req, res, next) => {
  logger.error(err, 'burped error');
  res.status(err.status || 500).json({msg: err.message});
});

server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});
