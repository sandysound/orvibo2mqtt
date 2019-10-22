const discoveryPrefix = 'homeassistant';
const nodeId = 'orvibo-server';

const getSubscribePath = () => `${discoveryPrefix}/+/${nodeId}/#`;
const getPath = ({ uid, type }) =>
  `${discoveryPrefix}/${type}/${nodeId}/${uid}`;
const getConfigPath = plug => `${getPath(plug)}/config`;
const getAvailabilityTopic = plug => `${getPath(plug)}/availability`;
const getStateTopic = plug => `${getPath(plug)}/state`;
const getCommandTopic = plug => `${getPath(plug)}/set`;

module.exports = {
  getSubscribePath,
  getConfigPath,
  getAvailabilityTopic,
  getStateTopic,
  getCommandTopic
};
