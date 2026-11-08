# Tavern Tour

Tavern Tour is a multiplayer board game inspired by property-trading classics and themed around tavern minions. Play locally against bots or host an online game for up to four players. Build a fortune through purchases, rent, upgrades, and strategic takeovers—or claim one of the game's immediate victory conditions.

## Features

- **Local games:** Play against one to three bots, with no room setup.
- **Online multiplayer:** Host a room and invite friends with a short room code. The host manages the game; players connect peer-to-peer through WebRTC.
- **Player profiles:** Choose a nickname and token in the lobby. If the nickname is left blank, a random name is selected.
- **Configurable match length:** Choose a 10-, 15-, 20-, or 30-minute game.
- **Timed turns:** Each turn lasts 30 seconds, with a visual fuse timer.
- **Strategic property system:** Buy minions, improve properties through four Tavern levels and a Golden Minion, collect rent, sell properties, and bid in bankruptcy auctions.
- **Special spaces and cards:** Visit A. F. KAH, draw Chance cards, use the Shadow Gift and Time-Twisted Portal, and collect Darkmoon Festival rent bonuses.
- **Board inspector:** Select any space to view its owner, purchase price, rent by upgrade level, and active effects beside the board.
- **Three immediate victory conditions:** Own all four neutral minions, every purchasable space on one side of the board, or three complete minion-family monopolies.

## Getting Started

Tavern Tour is a static web application and does not require a package installation or build step.

### Run locally

1. Clone or download this repository.
2. Start a local HTTP server from the project directory, then open the address below in a modern browser. Native JavaScript modules require HTTP; opening `index.html` directly with `file://` is not supported.

For example, with Python installed:

```powershell
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

Local play against bots works without creating a room. Online multiplayer requires an internet connection to load the PeerJS library and establish peer connections. The host must remain connected for the duration of an online match.

## How to Play

### Starting a game

- Select a token and optionally enter a nickname.
- Choose **Local Game** to play against bots, or create a room and share its code.
- Friends can join with the room code. The host can configure the match duration and choose whether empty seats are filled by bots.
- At the start of a match, every player rolls to determine turn order.

### Turns and properties

- Players roll two dice and move around the 32-space board. Each turn is limited to 30 seconds.
- Passing Start awards the salary; landing directly on Start awards twice the salary.
- Buy available properties and neutral minions, improve properties up to Tavern 4, and then upgrade to a Golden Minion.
- Completing a property family doubles its rent at every upgrade level.
- The Darkmoon Festival selects three purchasable spaces from different families at the beginning of each game. Their rent is doubled for the rest of the match; purchase prices are unaffected.
- Landing on an opponent's property requires paying rent. Eligible properties can then be bought out for 125% of their original investment. Neutral minions cannot be bought out.
- Players can sell an entire property, including its upgrades, for 75% of its total investment. A bankrupt player's properties and upgrades are auctioned, and the player receives 50% of each winning bid.
- A player sent to A. F. KAH must pay to leave, use a release card, or attempt to roll doubles.
- The Time-Twisted Portal activates on the player's next turn and replaces their normal dice roll.
- The Shadow Gift can increase rent on one of the player's properties.
- Darkmoon Festival spaces are marked with a bright violet halo; the Shadow Gift target is marked with a bright red halo.

### Winning

A player wins immediately by meeting any one of these conditions:

1. Own all four neutral minions: Brann, Drakkari, Titus, and Leeroy.
2. Own every purchasable space on one side of the board, including properties and neutral minions.
3. Own three complete property-family monopolies.

If no one meets an immediate victory condition, the game ends when the match timer expires. The player with the highest total fortune—cash plus the value of owned spaces and upgrades—wins. The game also ends if all but one player go bankrupt.

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html` | Application entry point and page structure |
| `style.css` | Layout, responsive styling, and animations |
| `app.js` | Composes controllers, connects callbacks, and starts the application |
| `src/runtime.js` | Shared application state and configuration references |
| `src/lobby.js` | Home screen, player profiles, and room setup |
| `src/connection.js` | Host/client messages, reconnection, and heartbeat |
| `src/session.js` | Match lifecycle, action dispatch, and bot scheduling |
| `src/ui/` | Board, actions, dialogs, rendering, and animations |
| `src/audio.js` | Procedural Web Audio effects |
| `engine.js` | Game state, rules, turn resolution, and bot decisions |
| `config.js` | Board layout, rules, property groups, and Chance cards |
| `content.json` | Editable board names, card text, and bot-name data |
| `net.js` | Peer-to-peer room networking |
| `sim.js` | Automated gameplay simulations and rule regression tests |

When deploying, publish the `src/` directory along with the root files and serve `.js` files with a JavaScript MIME type. No build step is required.

## Testing

Node.js 22 or later is required for the automated tests. No npm dependencies need to be installed. Run the controller integration tests (with a simulated DOM and timers) and 100 gameplay simulations:

```powershell
npm test
```

Or run the integration tests directly:

```powershell
node --experimental-vm-modules --test tests/*.test.cjs
```

These tests do not replace visual checks or WebRTC testing in real browsers. To run only the automated simulations:

```powershell
node sim.js
```

Pass a number to choose how many complete games to simulate:

```powershell
node sim.js 30
```

The simulation runs gameplay invariants and focused regression tests for core rules, Chance cards, and victory conditions.

## Game State and Authority

The engine owns game-state writes: player actions through `apply`, turn expiration through `tick`, controller changes through `changeController`, and published clock updates through `refreshClock`. Turn deadlines are created by engine transitions; views must not invent them.

The session creates or replaces the match, calls the engine, updates the lobby after controller changes, broadcasts state, and schedules bots. `receiveState` installs a snapshot on a guest; guests cannot execute host transitions through `dispatch`, `afterChange`, or `changeController`.

Views read the match and only update presentation state, such as animations, selection, and the interpolated clock. Network handlers decode messages and call the session. Connection transitions clear previous transient events to prevent animation replay while preserving properties, cash, and deadlines. Controller changes are not player actions accepted by `apply`.

Pre-game lobby data and visual preferences remain managed by their controllers. Rendering and snapshot-reception tests accept frozen game state to detect accidental writes.

## Credits and Disclaimer

Tavern Tour is a fan-made, non-commercial project. It is not affiliated with or endorsed by Blizzard Entertainment. Game names and themed content belong to their respective owners.
## Optional mode: shared anomalies

The home screen and host lobby offer Classic (default), Random, Festival itinérant, Terres maudites and Dé du destin. One shared anomaly is selected at match creation, synchronized in the game snapshot, and displayed throughout the match. Replaying draws a fresh anomaly when Random is selected. Guests see the host's selection and cannot change it.

- **Festival itinérant:** redraw three Festival spaces from distinct families when play wraps around the turn order; bankrupt players are skipped.
- **Terres maudites:** three property spaces have a 25% discount on the land price and double rent. Construction prices stay unchanged; valuation, resale and buyouts use the discounted land value. Festival and family multipliers still apply.
- **Dé du destin:** outside initial ordering and prison, roll three dice and choose two. Only the chosen pair determines movement and doubles. Bots choose the largest sum; an expired choice is resolved automatically before normal timeout handling.

Mode rules are in `config.js`, transitions remain in `engine.js`. State stores the anomaly and Festival PRNG state so a serialized match can continue consistently.

## Optional mode: Tavern powers

A separate checkbox enables Tavern rewards, with or without shared anomalies. The host controls it; local games also support it. Classic games retain their salary and rule behavior.

At the first forward crossing of Start in a turn (including forward Chance moves and World Tour travel), resolve a reward choice before resolving the landing space: take the normal salary or one of two powers. Arriving exactly at Start offers 400,000 cash, or a power plus the extra 200,000. Backward moves do not grant rewards. Further crossings in the same turn increment laps but grant no further salary or power. A full two-slot reserve forces the cash choice; expired choices take cash. Offers, inventory, active effects and global legendary stock are serialized and shared by the host.

Use at most one power per turn, before a dice roll. Powers may be saved across turns:

- **Bouclier de Bob:** bank covers up to 200,000 of the next rent; the owner receives the full rent.
- **Seconde chance:** preview the next dice result, then keep it or reroll once. With Dé du destin, choose two of the three dice before deciding; rerolling gives a fresh three-dice choice without another reroll.
- **Coup de pouce:** add or subtract one from the next dice movement, without changing doubles.
- **Permis de construire:** discount up to 150,000 on a later improvement, including Golden Minion; unused discount is lost when building. It does not discount an initial purchase.

Each reward offer has a **5% chance** (configured in `POWER_RULES.legendaryChance`) of containing one legendary. Each legendary type is removed from the global pool **when first offered**, even if declined or inventory is full. It cannot appear again that game, including after disconnects or bankruptcy. A new match resets the pool:

- **Tournée légendaire:** bank covers the next rent without a cap.
- **Anéantissement:** send an enemy property and every upgrade, including Golden Minion, to the bank with no refund. Neutral minions cannot be targeted. Championships on the destroyed property are removed.
- **Toucher de Midas:** upgrade one owned property straight to Golden Minion for free.

Legendary strength and the initial 5% rate are deliberate first balancing values. The log announces legendary appearances and uses. Bots choose, store and use powers; timed-out dice/reward choices are resolved before the usual turn timeout handling.
