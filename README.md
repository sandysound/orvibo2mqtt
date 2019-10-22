# orvibo2mqtt
A bridge from the orvibo socket sever to MQTT for home assistant mqtt auto discovery integration

##More documentation to come but for now:

This server adds support for the newer orvibo sockets in home assistant by using [mqtt discovery](https://www.home-assistant.io/docs/mqtt/discovery/) 

For this to work you need to forward the orvibo sockets to this server by intercepting their dns requests.
You can use the instructions here [orvibo-b25-server](https://github.com/sandysound/orvibo-b25-server)

Clone and install dependencies using `npm install`

update your mqtt server in `client.js` and discoveryPrefix in `topics-getters.js` in 
add your plugs/sockets to `plugs.js` 

then run `npm start` to start the server. Your devices should start to appear in home assistant.
