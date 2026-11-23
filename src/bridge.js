// Connects the Orvibo socket server to MQTT and announces every plug to Home Assistant
// through MQTT discovery. Plugs need no configuration: any plug that connects shows up
// in HA as a switch named after the end of its MAC address, ready to rename there.

const { version } = require('../package.json');

const ON = 'ON';
const OFF = 'OFF';
const ONLINE = 'online';
const OFFLINE = 'offline';
const STATE_ON = 0; // Orvibo uses 0 for on, 1 for off

const RETAIN = { retain: true, qos: 1 };

class Bridge {
  constructor({ mqtt, orvibo, config, logger = console }) {
    this.mqtt = mqtt;
    this.orvibo = orvibo;
    this.config = config;
    this.logger = logger;
    // uid -> { online, state, modelId }
    this.plugs = new Map();

    const { discoveryPrefix, statePrefix } = config;
    this.topics = {
      bridgeAvailability: `${statePrefix}/bridge/availability`,
      commands: `${statePrefix}/+/set`,
      discovery: `${discoveryPrefix}/switch/${statePrefix}/+/config`,
      haStatus: config.haStatusTopic,
    };
  }

  log(msg) {
    this.logger.log(`[orvibo2mqtt] ${msg}`);
  }

  plugTopic(uid, leaf) {
    return `${this.config.statePrefix}/${uid}/${leaf}`;
  }

  discoveryTopic(uid) {
    return `${this.config.discoveryPrefix}/switch/${this.config.statePrefix}/${uid}/config`;
  }

  // Pulls the uid out of a topic matching `pattern`, where '+' marks the uid.
  matchUid(pattern, topic) {
    const p = pattern.split('/');
    const t = topic.split('/');
    if (p.length !== t.length) return null;
    let uid = null;
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '+') uid = t[i];
      else if (p[i] !== t[i]) return null;
    }
    return uid;
  }

  publish(topic, payload, opts = RETAIN) {
    if (!this.mqtt.connected) return;
    this.mqtt.publish(topic, payload, opts, (err) => {
      if (err) this.log(`publish to ${topic} failed: ${err.message}`);
    });
  }

  plug(uid) {
    if (!this.plugs.has(uid)) this.plugs.set(uid, { online: false, state: undefined, modelId: undefined });
    return this.plugs.get(uid);
  }

  discoveryPayload(uid) {
    const mac = uid.match(/../g).join(':');
    return {
      // null: the entity takes the device's name, so renaming the device in HA renames the switch
      name: null,
      unique_id: `orvibo_${uid}`,
      state_topic: this.plugTopic(uid, 'state'),
      command_topic: this.plugTopic(uid, 'set'),
      payload_on: ON,
      payload_off: OFF,
      availability: [{ topic: this.topics.bridgeAvailability }, { topic: this.plugTopic(uid, 'availability') }],
      availability_mode: 'all',
      device: {
        identifiers: [`orvibo_${uid}`],
        name: `Orvibo Plug ${uid.slice(-4)}`,
        manufacturer: 'Orvibo',
        model: 'B25 smart socket',
        serial_number: mac,
      },
      origin: {
        name: 'orvibo2mqtt',
        sw_version: version,
        support_url: 'https://github.com/sandysound/orvibo2mqtt',
      },
    };
  }

  // Publishes everything HA needs for one plug. All retained, so HA picks it up after its
  // own restarts without asking.
  announce(uid) {
    const plug = this.plug(uid);
    this.publish(this.discoveryTopic(uid), JSON.stringify(this.discoveryPayload(uid)));
    this.publish(this.plugTopic(uid, 'availability'), plug.online ? ONLINE : OFFLINE);
    if (plug.state) this.publish(this.plugTopic(uid, 'state'), plug.state);
  }

  setOnline(uid, online) {
    const plug = this.plug(uid);
    if (plug.online === online) return;
    plug.online = online;
    this.publish(this.plugTopic(uid, 'availability'), online ? ONLINE : OFFLINE);
  }

  start() {
    const { orvibo, mqtt } = this;

    orvibo.on('plugConnected', ({ uid, modelId }) => {
      if (!this.validUid(uid)) return;
      const plug = this.plug(uid);
      plug.online = true;
      plug.modelId = modelId;
      this.log(`plug ${uid} connected`);
      this.announce(uid);
    });

    orvibo.on('gotHeartbeat', ({ uid }) => {
      if (this.validUid(uid)) this.setOnline(uid, true);
    });

    orvibo.on('plugStateUpdated', ({ uid, state }) => {
      if (!this.validUid(uid)) return;
      const payload = state === STATE_ON ? ON : OFF;
      this.plug(uid).state = payload;
      this.log(`plug ${uid} is ${payload}`);
      this.publish(this.plugTopic(uid, 'state'), payload);
    });

    const disconnected = ({ uid }) => {
      if (!this.validUid(uid)) return;
      this.log(`plug ${uid} disconnected`);
      this.setOnline(uid, false);
    };
    orvibo.on('plugDisconnected', disconnected);
    orvibo.on('plugDisconnectedWithError', disconnected);

    mqtt.on('connect', () => this.onMqttConnect());
    mqtt.on('message', (topic, message) => this.onMessage(topic, message.toString()));
    mqtt.on('error', (err) => this.log(`MQTT error: ${err.message}`));
    mqtt.on('offline', () => this.log('MQTT offline, reconnecting'));
  }

  validUid(uid) {
    // A uid is the plug's MAC: 12 hex digits. Anything else would make a broken topic.
    if (typeof uid === 'string' && /^[0-9a-fA-F]{12}$/.test(uid)) return true;
    this.log(`ignoring plug with unexpected uid ${JSON.stringify(uid)}`);
    return false;
  }

  onMqttConnect() {
    this.log('connected to MQTT');
    this.publish(this.topics.bridgeAvailability, ONLINE);
    this.mqtt.subscribe([this.topics.commands, this.topics.haStatus, this.topics.discovery], { qos: 1 }, (err) => {
      if (err) this.log(`subscribe failed: ${err.message}`);
    });
    // Re-announce plugs seen before an MQTT reconnect, in case the broker lost its retained messages.
    for (const uid of this.plugs.keys()) this.announce(uid);
  }

  onMessage(topic, message) {
    if (topic === this.topics.haStatus) {
      if (message === ONLINE) {
        this.log('Home Assistant came online, re-announcing plugs');
        for (const uid of this.plugs.keys()) this.announce(uid);
      }
      return;
    }

    const commandUid = this.matchUid(this.topics.commands, topic);
    if (commandUid) return this.onCommand(commandUid, message);

    // Retained discovery configs tell us about plugs announced before this process started.
    // Until one of them reconnects, mark it offline so HA doesn't show a stale "online".
    const knownUid = this.matchUid(this.topics.discovery, topic);
    if (knownUid && message && this.validUid(knownUid)) {
      const isNew = !this.plugs.has(knownUid);
      const plug = this.plug(knownUid);
      if (isNew && !plug.online) this.publish(this.plugTopic(knownUid, 'availability'), OFFLINE);
    }
  }

  onCommand(uid, command) {
    if (command !== ON && command !== OFF) {
      this.log(`ignoring command "${command}" for ${uid}`);
      return;
    }
    this.log(`turning plug ${uid} ${command}`);
    if (!this.orvibo.setState(uid, command === ON)) {
      this.log(`plug ${uid} is not connected`);
    }
  }

  // Marks the bridge offline before a clean shutdown. HA then shows every plug unavailable.
  async stop() {
    if (!this.mqtt.connected) return;
    await new Promise((resolve) => this.mqtt.publish(this.topics.bridgeAvailability, OFFLINE, RETAIN, () => resolve()));
  }

  status() {
    return {
      mqttConnected: Boolean(this.mqtt.connected),
      plugs: [...this.plugs].map(([uid, p]) => ({ uid, online: p.online, state: p.state ?? null })),
    };
  }
}

module.exports = { Bridge };
