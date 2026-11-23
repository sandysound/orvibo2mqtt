const test = require('node:test');
const assert = require('node:assert');
const { once, EventEmitter } = require('events');
const Orvibo = require('../vendor/orvibo-b25-server');
const { Bridge } = require('../src/bridge');
const { loadConfig } = require('../src/config');
const FakePlug = require('./fake-plug');

const KEY = 'khggd54865SNJHGF';
const UID = '5ccf7f261a2b';
const quiet = { log() {} };

// Records what the bridge publishes and subscribes to; tests push messages in with deliver().
class FakeMqtt extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.published = [];
    this.subscribed = [];
  }
  publish(topic, payload, opts, cb) {
    this.published.push({ topic, payload: String(payload), retain: Boolean(opts && opts.retain) });
    this.emit('published', topic);
    if (cb) cb();
  }
  subscribe(topics, opts, cb) {
    this.subscribed.push(...topics);
    if (cb) cb(null);
  }
  goOnline() {
    this.connected = true;
    this.emit('connect');
  }
  deliver(topic, payload) {
    this.emit('message', topic, Buffer.from(payload));
  }
  last(topic) {
    const hits = this.published.filter((p) => p.topic === topic);
    return hits.length ? hits[hits.length - 1] : undefined;
  }
  async waitFor(topic, payload) {
    const matches = () => {
      const p = this.last(topic);
      return p && (payload === undefined || p.payload === payload);
    };
    while (!matches()) await once(this, 'published');
    return this.last(topic);
  }
}

const setup = async () => {
  const config = loadConfig({});
  const orvibo = new Orvibo({ ORVIBO_KEY: KEY, port: 0, bindHost: '127.0.0.1' });
  orvibo.setLogger(quiet);
  orvibo.startServer();
  await once(orvibo.server, 'listening');
  const mqtt = new FakeMqtt();
  const bridge = new Bridge({ mqtt, orvibo, config, logger: quiet });
  bridge.start();
  const port = orvibo.server.address().port;
  const teardown = () => new Promise((r) => orvibo.stopServer(r));
  return { orvibo, mqtt, bridge, port, teardown };
};

const T = {
  config: `homeassistant/switch/orvibo2mqtt/${UID}/config`,
  state: `orvibo2mqtt/${UID}/state`,
  set: `orvibo2mqtt/${UID}/set`,
  availability: `orvibo2mqtt/${UID}/availability`,
  bridge: 'orvibo2mqtt/bridge/availability',
};

test('config defaults and env overrides', () => {
  const d = loadConfig({});
  assert.strictEqual(d.orvibo.key, KEY);
  assert.strictEqual(d.haStatusTopic, 'homeassistant/status');
  const c = loadConfig({
    MQTT_BROKER: 'mqtt://broker:1883',
    MQTT_USERNAME: 'u',
    ORVIBO_PORT: '1234',
    LOG_PACKETS: 'true',
  });
  assert.strictEqual(c.mqtt.url, 'mqtt://broker:1883');
  assert.strictEqual(c.mqtt.username, 'u');
  assert.strictEqual(c.orvibo.port, 1234);
  assert.strictEqual(c.orvibo.logPackets, true);
  assert.throws(() => loadConfig({ ORVIBO_PORT: 'abc' }));
});

test('a new plug is discovered, reports state and obeys commands', async () => {
  const { mqtt, port, teardown } = await setup();
  mqtt.goOnline();
  assert.strictEqual(mqtt.last(T.bridge).payload, 'online');
  assert.ok(mqtt.subscribed.includes('orvibo2mqtt/+/set'));
  assert.ok(mqtt.subscribed.includes('homeassistant/status'));

  const plug = new FakePlug({ port, uid: UID, orviboKey: KEY });
  await plug.connect();
  await plug.hello();

  const config = await mqtt.waitFor(T.config);
  assert.ok(config.retain);
  const disc = JSON.parse(config.payload);
  assert.strictEqual(disc.unique_id, `orvibo_${UID}`);
  assert.strictEqual(disc.name, null);
  assert.strictEqual(disc.device.name, 'Orvibo Plug 1a2b');
  assert.strictEqual(disc.device.serial_number, '5c:cf:7f:26:1a:2b');
  assert.strictEqual(disc.command_topic, T.set);
  assert.deepStrictEqual(
    disc.availability.map((a) => a.topic),
    [T.bridge, T.availability],
  );
  assert.strictEqual(mqtt.last(T.availability).payload, 'online');

  // Button pressed on the plug
  plug.send({ cmd: 42, serial: 3, uid: UID, value1: 1 });
  assert.ok((await mqtt.waitFor(T.state, 'OFF')).retain);

  // HA turns it on
  mqtt.deliver(T.set, 'ON');
  const cmd = await plug.next((j) => j.cmd === 15);
  assert.strictEqual(cmd.value1, 0);
  plug.send({ cmd: 15, serial: cmd.serial, uid: UID, status: 0 });
  await mqtt.waitFor(T.state, 'ON');

  // Garbage commands are ignored
  mqtt.deliver(T.set, 'TOGGLE');

  plug.close();
  await mqtt.waitFor(T.availability, 'offline');
  await teardown();
});

test('HA restart re-announces known plugs with their last state', async () => {
  const { mqtt, port, teardown } = await setup();
  mqtt.goOnline();
  const plug = new FakePlug({ port, uid: UID, orviboKey: KEY });
  await plug.connect();
  await plug.hello();
  plug.send({ cmd: 42, serial: 3, uid: UID, value1: 0 });
  await mqtt.waitFor(T.state, 'ON');

  mqtt.published = [];
  mqtt.deliver('homeassistant/status', 'online');
  assert.ok(mqtt.last(T.config));
  assert.strictEqual(mqtt.last(T.availability).payload, 'online');
  assert.strictEqual(mqtt.last(T.state).payload, 'ON');

  plug.close();
  await teardown();
});

test('plugs remembered from retained discovery start offline until they reconnect', async () => {
  const { mqtt, bridge, teardown } = await setup();
  mqtt.goOnline();
  mqtt.deliver(T.config, '{"unique_id":"x"}');
  assert.strictEqual(mqtt.last(T.availability).payload, 'offline');
  assert.deepStrictEqual(bridge.status().plugs, [{ uid: UID, online: false, state: null }]);

  // Our own discovery echoing back must not flip a live plug offline
  mqtt.published = [];
  mqtt.deliver(T.config, '{"unique_id":"x"}');
  assert.strictEqual(mqtt.last(T.availability), undefined);
  await teardown();
});

test('a broker reconnect does not duplicate plug events', async () => {
  const { mqtt, port, teardown } = await setup();
  mqtt.goOnline();
  mqtt.goOnline();
  const plug = new FakePlug({ port, uid: UID, orviboKey: KEY });
  await plug.connect();
  await plug.hello();
  await mqtt.waitFor(T.config);
  mqtt.published = [];
  plug.send({ cmd: 42, serial: 3, uid: UID, value1: 1 });
  await mqtt.waitFor(T.state, 'OFF');
  assert.strictEqual(mqtt.published.filter((p) => p.topic === T.state).length, 1);
  plug.close();
  await teardown();
});

test('stop marks the bridge offline', async () => {
  const { mqtt, bridge, teardown } = await setup();
  mqtt.goOnline();
  await bridge.stop();
  assert.strictEqual(mqtt.last(T.bridge).payload, 'offline');
  await teardown();
});
