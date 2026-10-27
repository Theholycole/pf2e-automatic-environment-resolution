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

## Doors, walls and portcullises

The **Doors and walls** tab lists GM Core's structures and puts them into play:

- **Place** one as a token players can target and Strike. It's a PF2e hazard with the table's Hardness and Hit Points, and PF2e takes its Hardness off the damage. Its AC is 10 unless you change it, since no rule gives an object an AC.
- Select walls or doors on the Walls layer first, and the structure follows its wall:
  - Broken: a locked door's lock no longer holds.
  - Destroyed: the wall stops blocking until the structure is repaired.
- **Climb**, **Force Open** (or lift a portcullis) and **Pick the lock** post cards for the selected creatures:
  - Force Open: a critical success opens it, a success breaks it open, and a critical failure jams it (−2 to later attempts).
  - Pick a Lock: the lock's successes are counted until it opens.
- A placed door can carry a lock (poor to superior). Its Force Open DC is the lock's DC + 5.

See `docs/design.md` for the rulings where GM Core leaves numbers to the GM.

## Install

Manifest URL: `https://github.com/Theholycole/pf2e-automatic-environment-resolution/releases/latest/download/module.json`

It needs [PF2e Automation Core](https://github.com/Theholycole/PF2e-Automation-Core) 0.7.5 or later. GM Core's rules live there, so the [Combat Simulator](https://github.com/Theholycole/pf2e-combat-simulator) plays the same ones in its fights.
