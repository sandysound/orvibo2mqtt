const mqtt = require('mqtt');
const _ = require('lodash');
const Orvibo = require('orvibo-b25-server');

const plugs = require('./plugs');
const {
  getSubscribePath,
  getConfigPath,
  getAvailabilityTopic,
  getStateTopic,
  getCommandTopic
} = require('./topic-getters');

const key = Buffer.from('6b686767643534383635534e4a484746', 'hex');
// set this to your MQTT server
const client = mqtt.connect('mqtt://localhost');
const settings = {
  LOG_PACKET: false,
  ORVIBO_KEY: key.toString('utf8'),
  plugInfo: plugs
};

let orvibo = new Orvibo(settings);

const birthTopic = 'hass/status';

const payload_on = 'ON';
const payload_off = 'OFF';
const payload_available = 'online';
const payload_not_available = 'offline';

let debug = 'console';

const getLogger = () => {
  const consoleLogger = msg => console.log('orvibo2mqtt', msg);
  if (debug === 'console') {
    return consoleLogger;
  }
  return _.noop;
};

const logger = getLogger();

const getDiscoveryResponse = plug => ({
  name: plug.name,
  state_topic: getStateTopic(plug),
  command_topic: getCommandTopic(plug),
  availability_topic: getAvailabilityTopic(plug),
  payload_on,
  payload_off,
  payload_available,
  payload_not_available,
  optimistic: false
});

const getPlugById = uid => plugs.find(plug => uid === plug.uid);

const makeProcessSocket = client => (socket, status) => {
  const plug = plugs.find(item => item.uid === socket.uid);
  if (plug == null) {
    logger(`processing socket with uid ${socket.uid} has no entry`);
    return;
  }
  logger(`processing socket ${plug.name} with uid ${plug.uid}`);
  client.publish(
    getConfigPath(plug),
    JSON.stringify(getDiscoveryResponse(plug))
  );
  client.publish(getAvailabilityTopic(plug), status);
};

const processAllSockets = processSocket => {
  const connectedSockets = orvibo.getConnectedSocket();

  _.each(plugs, plug => {
    const connectedSocket = _.find(
      connectedSockets,
      socket => socket.uid === plug.uid
    );
    const status =
      connectedSocket == null ? payload_not_available : payload_available;
    processSocket(plug, status);
  });
};

const processDisconnectedSocket = ({ uid, name }) => {
  const plug = plugs.find(item => item.uid === uid);
  if (plug == null) {
    logger(`socket with uid ${uid} has no entry`);
    return;
  }
  client.publish(getAvailabilityTopic(plug), payload_not_available);
  logger(`Plug ${uid} - ${name} disconnected`);
};

const connectionHandler = () => {
  logger('connected to MQTT');

  client.subscribe(getSubscribePath(), err => {
    if (err) {
      logger(`Error subscribing to ${getSubscribePath()}`, err);
    }
  });

  const processSocket = makeProcessSocket(client);

  client.subscribe(birthTopic, err => {
    if (err) {
      logger(`Error subscribing to ${birthTopic}`, err);
    }
  });

  orvibo.on('plugConnected', socket =>
    processSocket(socket, payload_available)
  );

  orvibo.on('gotHeartbeat', ({ uid, name }) => {
    logger(`Plug ${name} ${uid} sent heartbeat`);
    const plug = plugs.find(item => item.uid === uid);
    if (plug == null) {
      logger(`socket with uid ${uid} has no entry`);
      return;
    }
    client.publish(getAvailabilityTopic(plug), payload_available);
  });

  orvibo.on('plugStateUpdated', ({ uid, state, name }) => {
    const payload = state === 0 ? payload_on : payload_off;
    const plug = getPlugById(uid);
    if (!plug) {
      logger(
        `Plug ${name} ${uid} plugStateUpdated ${state} but does not exist`
      );
      return;
    }
    client.publish(getStateTopic(plug), payload);
    logger(`Plug ${name} ${uid} updated state ${state}`);
  });

  orvibo.on('plugDisconnected', processDisconnectedSocket);
  orvibo.on('plugDisconnectedWithError', processDisconnectedSocket);
};

client.on('connect', connectionHandler);

client.on('message', function(topic, message) {
  const command = message.toString();

  if (topic === birthTopic) {
    const processSocket = makeProcessSocket(client);
    processAllSockets(processSocket);
    logger(`birthTopic was sent ${topic}`);
    return;
  }

  if (
    _.includes(topic, 'set') &&
    _.includes([payload_on, payload_off], command)
  ) {
    logger(`got payload ${command} for topic ${topic}`);

    let socket = _.find(plugs, plug => getCommandTopic(plug) === topic);
    if (socket == null) {
      logger(`no socket exists for topic ${topic}`);
      return;
    }

    let plugToToggle = _.find(
      orvibo.getConnectedSocket(),
      plug => plug.uid === socket.uid
    );

    if (plugToToggle == null) {
      logger(`no orvibo socket connected with uid ${socket.uid}`);
      return;
    }

    const { state } = plugToToggle;

    if (state === 0 && command === payload_on) {
      logger(`socket ${plugToToggle.uid} - ${plugToToggle.name} is already ON`);
      client.publish(getStateTopic(plugToToggle), payload_on);
      return;
    }

    if (plugToToggle.state === 1 && command === payload_off) {
      logger(
        `socket ${plugToToggle.uid} - ${plugToToggle.name} is already OFF`
      );
      client.publish(getStateTopic(plugToToggle), payload_off);
      return;
    }

    orvibo.toggleSocket(socket.uid);
  }
});

orvibo.startServer();
