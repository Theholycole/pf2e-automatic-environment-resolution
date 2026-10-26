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

## Reference

The window also lists the doors, walls and portcullises table and the Force Open DCs.

See `docs/design.md` for the rulings where GM Core leaves numbers to the GM.

## Install

Manifest URL: `https://github.com/Theholycole/pf2e-automatic-environment-resolution/releases/latest/download/module.json`

It needs [PF2e Automation Core](https://github.com/Theholycole/PF2e-Automation-Core) 0.7.4 or later. GM Core's rules live there, so the [Combat Simulator](https://github.com/Theholycole/pf2e-combat-simulator) plays the same ones in its fights.
