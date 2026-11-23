# orvibo2mqtt

Runs your Orvibo B25 smart sockets locally and puts them in Home Assistant through
[MQTT discovery](https://www.home-assistant.io/integrations/mqtt/#mqtt-discovery). No cloud, no plug list:
plug a socket in and it appears in HA as a switch.

It embeds [orvibo-b25-server](https://github.com/sandysound/orvibo-b25-server) (vendored in `vendor/`),
which pretends to be Orvibo's cloud server. The plugs look up `homemate.orvibo.com` and connect to it on
TCP port 10001, so you point that name at this bridge with a DNS rewrite.

## How it works

1. A plug powers up, resolves `homemate.orvibo.com` to the bridge and connects on port 10001.
2. The bridge publishes a retained discovery config. HA creates a device called `Orvibo Plug 1a2b`
   (the last four digits of the plug's MAC) with one switch.
3. Rename the device in HA. If the socket powers a lamp, use the entity's **Show as** setting to make it a light.
4. Turning the switch on or off in HA, or pressing the button on the plug, updates both sides.

Everything is retained, so HA keeps its plugs and their last state across restarts of HA, the broker or the
bridge. If the bridge stops, every plug shows as unavailable.

## Running it with Docker

```sh
cp .env.example .env   # set MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD
docker compose up -d --build
docker compose logs -f
```

Then add a DNS rewrite so the plugs find the bridge. In AdGuard Home: **Filters → DNS rewrites → Add**,
domain `homemate.orvibo.com`, answer the IP of the Docker host. The plugs must use AdGuard as their DNS
server (normally via DHCP). Power-cycle each plug afterwards so it looks the name up again.

Check it with `docker compose logs`: you should see `plug <mac> connected` for each socket.

Note: once the DNS is rewritten, the Orvibo app can no longer reach these plugs, and adding a new plug
through the app will time out at the last step. The plug still joins your Wi-Fi and works with the bridge.

## Configuration

All settings are environment variables (see `.env.example`).

| Variable                 | Default                 | Notes                                                      |
| ------------------------ | ----------------------- | ---------------------------------------------------------- |
| `MQTT_BROKER`            | `mqtt://localhost:1883` | Use an IP: containers can't resolve `.local` names         |
| `MQTT_USERNAME`          |                         |                                                            |
| `MQTT_PASSWORD`          |                         |                                                            |
| `MQTT_CLIENT_ID`         | `orvibo2mqtt`           |                                                            |
| `MQTT_DISCOVERY_PREFIX`  | `homeassistant`         | Must match HA's MQTT discovery prefix                      |
| `MQTT_STATE_PREFIX`      | `orvibo2mqtt`           | Root of the state, command and availability topics         |
| `HA_STATUS_TOPIC`        | `homeassistant/status`  | HA's birth message; the bridge re-announces plugs on it    |
| `ORVIBO_KEY`             | `khggd54865SNJHGF`      | The PK key all B25s use for the opening handshake          |
| `ORVIBO_PORT`            | `10001`                 | The plugs always connect to 10001; change the host mapping |
| `ORVIBO_IDLE_TIMEOUT_MS` | `300000`                | Mark a silent plug unavailable after this long             |
| `LOG_PACKETS`            | `false`                 | Log every decoded packet from the plugs                    |
| `HEALTH_PORT`            | `8080`                  | `GET /health` returns MQTT status and the known plugs      |

## Topics

| Topic                                           | Payload                | Retained  |
| ----------------------------------------------- | ---------------------- | --------- |
| `homeassistant/switch/orvibo2mqtt/<mac>/config` | discovery JSON         | yes       |
| `orvibo2mqtt/<mac>/state`                       | `ON` / `OFF`           | yes       |
| `orvibo2mqtt/<mac>/availability`                | `online` / `offline`   | yes       |
| `orvibo2mqtt/<mac>/set`                         | `ON` / `OFF` (command) | no        |
| `orvibo2mqtt/bridge/availability`               | `online` / `offline`   | yes (LWT) |

`<mac>` is the plug's MAC address in lowercase without colons.

To remove a plug for good, delete its device in HA and clear the retained config:
`mosquitto_pub -r -n -t homeassistant/switch/orvibo2mqtt/<mac>/config`.

## Development

```sh
npm install
npm test        # unit and end-to-end tests against a fake plug
npm run lint
npm run vendor  # refresh vendor/ from a sibling ../orvibo-b25-server checkout
```
