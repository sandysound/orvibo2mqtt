const http = require('http');
const mqtt = require('mqtt');
const Orvibo = require('../vendor/orvibo-b25-server');
const { loadConfig } = require('./config');
const { Bridge } = require('./bridge');

const config = loadConfig();
const log = (msg) => console.log(`[orvibo2mqtt] ${msg}`);

const orvibo = new Orvibo({
  ORVIBO_KEY: config.orvibo.key,
  LOG_PACKET: config.orvibo.logPackets,
  plugInfo: [],
  port: config.orvibo.port,
  idleTimeoutMs: config.orvibo.idleTimeoutMs,
});

const client = mqtt.connect(config.mqtt.url, {
  clientId: config.mqtt.clientId,
  username: config.mqtt.username,
  password: config.mqtt.password,
  reconnectPeriod: 5000,
  will: { topic: `${config.statePrefix}/bridge/availability`, payload: 'offline', retain: true, qos: 1 },
});

const bridge = new Bridge({ mqtt: client, orvibo, config });
bridge.start();
orvibo.startServer();

const health = http.createServer((req, res) => {
  const status = bridge.status();
  res.writeHead(req.url === '/health' && status.mqttConnected ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
});
health.listen(config.healthPort);

log(`MQTT ${config.mqtt.url}, plugs on :${config.orvibo.port}, health on :${config.healthPort}`);

let stopping = false;
const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();
  try {
    await bridge.stop();
    await client.endAsync();
  } catch (err) {
    log(`shutdown error: ${err.message}`);
  }
  health.close();
  orvibo.stopServer(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
