// All configuration comes from environment variables (see .env.example).

// The PK key every Orvibo B25 ships with. It only encrypts the opening hello; each
// connection then switches to a random session key.
const DEFAULT_ORVIBO_KEY = 'khggd54865SNJHGF';

const int = (value, fallback) => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`Expected an integer, got "${value}"`);
  return n;
};

const bool = (value) => /^(1|true|yes)$/i.test(value || '');

const loadConfig = (env = process.env) => {
  const discoveryPrefix = env.MQTT_DISCOVERY_PREFIX || 'homeassistant';
  return {
    mqtt: {
      url: env.MQTT_BROKER || 'mqtt://localhost:1883',
      username: env.MQTT_USERNAME || undefined,
      password: env.MQTT_PASSWORD || undefined,
      clientId: env.MQTT_CLIENT_ID || 'orvibo2mqtt',
    },
    discoveryPrefix,
    statePrefix: env.MQTT_STATE_PREFIX || 'orvibo2mqtt',
    haStatusTopic: env.HA_STATUS_TOPIC || `${discoveryPrefix}/status`,
    orvibo: {
      key: env.ORVIBO_KEY || DEFAULT_ORVIBO_KEY,
      port: int(env.ORVIBO_PORT, 10001),
      idleTimeoutMs: int(env.ORVIBO_IDLE_TIMEOUT_MS, 5 * 60 * 1000),
      logPackets: bool(env.LOG_PACKETS),
    },
    healthPort: int(env.HEALTH_PORT, 8080),
  };
};

module.exports = { loadConfig };
