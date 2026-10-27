# PF2e Automatic Environment Resolution

This Foundry VTT module for PF2e puts GM Core's environment rules into play. Open the **Environment** window from the combat tracker or the token tools to set them up.

## Weather

Switch on each kind of weather at the level you pick:

- fog
- rain, sleet, snow or hail
- wind
- thunderstorms
- smoke
- volcanic ash
- sandstorms
- underwater, in clear or murky water
- currents
- temperature, from incredible cold to incredible heat

Each creature on the scene gets an Effect that matches the weather:

- **Perception:** sight and hearing penalties, which can be toggled on the check.
- **Concealment:** PF2e's concealed condition, or flat checks past a distance.
- **Wind:** ranged attack penalties, and impossible shots in a windstorm.
- **Underwater:** PF2e's Aquatic Combat effect.
- **Breath:** PF2e's Remaining Air for creatures that must hold their breath.

The scene shows the weather too: Foundry's rain, snow, fog or blizzard for the heaviest weather that's on. Each weather has a **Look** menu with every weather effect Foundry knows, including other modules' effects. A switch turns the look off for the scene.

The module also does the rest automatically:

- It rolls flat checks on attacks against concealed and hidden targets.
- At the start of each turn, it deals that turn's damage (heavy sandstorm, wildfire heat).
- It posts the wind's checks for fliers and small creatures.
- At the end of each turn, it lowers the creature's air and moves it with the current.
- On the world clock, it deals temperature, ash and burial damage, rolls lightning, and makes travellers fatigued.

## Ground

Give the whole scene, or any region you draw, one of GM Core's environmental features:

- ice and snow
- rubble and sand
- undergrowth, trees, hedges and canopy
- bogs
- cliffs, slopes and ledges
- stalagmites
- stairs, crowds, roofs and sewers
- water and currents
- lava, flames and vents

A feature can set PF2e's difficult terrain and environment types. It can also bring:

- Balance on uneven ground and narrow surfaces
- off-guard while standing there
- cover
- hazard damage
- a current's push

## Natural disasters

Post a save card to the tokens you select or target:

- avalanches and collapses
- earthquakes: tremors, fissures and liquefaction
- floods and tsunamis
- tornadoes
- lava bombs, pyroclastic flows and steam vents
- wildfire heat and flames
- lightning
- sewer gas explosions

You pick the damage category, the dice and the DC. Each creature rolls its own save, and your Apply handles the rest:

- damage
- burial, with dig-out cards
- being carried off
- falling
- conditions

## Doors, walls, windows and portcullises

Foundry's walls stay ordinary walls until you make one breakable. Only then does it do more than Foundry does.

- **Making one breakable:** tick **Breakable** in the wall's settings (the Structure section). Pick its kind (a GM Core door, wall or portcullis, or a window) and, if you like, its material, lock and AC. Or select walls on the Walls layer and use **Place** on the **Doors and walls** tab.
- **Materials:** a structure uses its kind's numbers from GM Core's table, or any material you pick:
  - GM Core's materials table, from paper to iron or steel structures. Windows default to Glass (Hardness 1, HP 4, BT 2).
  - Every precious material with structure numbers, at each grade: adamantine, cold iron, dawnsilver, duskwood, orichalcum, silver, abysium, djezet, inubrix, noqual, siccatite, peachwood, keep stone, sovereign steel, sisterstone, throneglass and warpglass.
- **Interacting with it:**
  - Players right-click a breakable door, or click the icon on a breakable wall or window. The GM uses Shift+right-click on doors, since the GM's plain right-click still locks and unlocks.
  - The menu offers **Strike it**, **Force it open** (Lift for a portcullis), **Pick the lock**, **Climb it**, and the GM's **Repair**.
  - Strike it puts a token on the wall and targets it, so the player Strikes from their sheet. The token is a PF2e hazard, and PF2e takes its Hardness off the damage. Its AC is 10 unless you change it, since no rule gives an object an AC.
- **Breaking:**
  - Broken: a locked door's lock no longer holds.
  - Destroyed: the wall stops blocking until it's repaired, and Repair puts back exactly what it blocked.
- **The cards:**
  - Force Open: a critical success opens it, a success breaks it open, and a critical failure jams it (−2 to later attempts).
  - Pick a Lock: the lock's successes are counted until it opens. A Foundry door that's locked has a simple lock unless you pick another.
  - The Force Open DC is the lock's DC + 5, or 15 for a stuck door or window (20 if exceptionally stuck).
- The tab's **Place** without walls selected puts a free token at the middle of the view. Its Climb and Force Open buttons post cards for the selected creatures.
- A setting hides the wall and window icons from players.

See `docs/design.md` for the rulings where GM Core leaves numbers to the GM.

## Install

Manifest URL: `https://github.com/Theholycole/pf2e-automatic-environment-resolution/releases/latest/download/module.json`

It needs [PF2e Automation Core](https://github.com/Theholycole/PF2e-Automation-Core) 0.7.6 or later. GM Core's rules live there, so the [Combat Simulator](https://github.com/Theholycole/pf2e-combat-simulator) plays the same ones in its fights.
