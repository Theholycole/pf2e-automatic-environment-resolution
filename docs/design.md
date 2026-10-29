# Design

The user's request (2026-10-25): weather effect toggles for a combat, applied automatically, covering everything in GM Core's Environment section (Chapter 2, pg. 90–98).

The user's answers:

- **Where:** both. Live Foundry combats use this module. The Combat Simulator uses the same rules as fight options.
- **Module:** a new module of its own, with a GM window. The other modules are unchanged.
- **Severity:** the GM picks a level for each weather toggle. The level sets the circumstance penalty (−1 to −4) and the distance past which creatures are concealed.
- **Disasters and timed damage:**
  - Disasters are GM buttons that post save cards. The GM picks the damage category.
  - Damage that comes each round or each minute ticks in a fight.
  - Damage that comes every 10 minutes or every hour ticks on the world clock.

## Layout

- The resolution core's `src/environment/`: the pure rules, tested in node. They live in the core so the Combat Simulator's fights use the same ones.
  - `catalog.js`: GM Core's tables as data.
  - `weather.js`: each creature's Effect, flat checks, and the temperature it feels.
  - `ticks.js`: what comes due over time.
  - `disasters.js`: the disaster cards.
  - `terrain.js`: what a region's feature does.
- `scripts/`: Foundry.
  - `sync.js`: the Effects on tokens, kept in step with the scene's toggles.
  - `attacks.js`: flat checks on attack rolls.
  - `ticks.js`: turn ticks and world-clock ticks.
  - `cards.js`: save and check cards.
  - `breath.js`: holding breath and suffocation.
  - `burial.js`: buried creatures.
  - `regions.js`: terrain regions.
  - `movement.js`: forced movement.
  - `panel.js`: the GM window.
  - `visuals.js`: Foundry's weather effect on the scene, set from the module's weather.
  - `structures.js`: structures — breakable walls and free tokens, their state, damage and cards (the rules in the core's `src/environment/structures.js`).
  - `structure-ui.js`: breakable Foundry walls: the wall settings' Structure section, the door control's right-click, the icons on walls and windows, and the menu.

## Structures

The user's requests (2026-10-26):

- Post checks and track damage done to structures, with a simple actor for players to target.
- Make Foundry's walls, doors and windows interactable, with Foundry's own behaviour the default ("so we dont flood any scenes with breakable walls").
- Windows use Glass. Precious materials are options.

How it works:

- **Opt-in:** a wall is breakable only when its flag `structure.on` is set, from its settings' Structure section or the tab's Place. Saving a wall's settings without ticking Breakable writes no flag (`preUpdateWall` strips it), and an unticked section's other fields are disabled, so a structure switched off keeps its settings.
- **Where the state lives:** on the wall (`flags["pf2e-automatic-environment-resolution"].structure`: `kind`, `material`, `lock`, `stuck`, `ac`, `successes`, `jammed`, `condition`, `hp`, `saved`). A wall's token carries only `{ wall }`. A token placed on no wall carries the whole state itself.
- **Its token:** made on the wall's middle when it's first wanted.
  - The GM's Strike it, or Place, makes it directly.
  - A player can't create tokens, so the player's client posts a whispered request (`structureRequest`). The active GM's client makes the token and deletes the request, and the player's client targets the token when it appears.
  - Without a token, the wall keeps its Hit Points itself (`hp`, null when full).
- **Numbers:** its kind's from GM Core's table, or its material's.
  - The materials are GM Core's Table 11-4 and the precious materials' structure rows: GM Core pg. 253–254, Grand Bazaar, Tian Xia Character Guide, Highhelm, Legends, Pathfinder #162 and #183, and The Dead God's Hand. Dragonhide, dreamweb and sloughstone give no structure numbers.
  - A window is Glass (1, 4, BT 2), as the user asked. GM Core's own example of a window pane is thin glass (0, 1), which is in the material menu.
- **Locks:** a Foundry door's lock is its door state. While it's locked, its lock is the one picked in its settings, or a simple one. Opening the lock (picked or forced) closes the door, and the successes start afresh.
- **Its door and icon:**
  - A player's right-click on its door control, or the GM's Shift+right-click, opens the menu (`DoorControl._onRightDown`, wrapped through libWrapper when it's active). The GM's plain right-click still locks and unlocks.
  - A player's left-click on it while it's locked tells them about the menu, once.
  - Walls and windows with no door get the module's own icon at their middle, on the controls layer. The GM always sees it. A player sees it when the wall is in sight (the door control's own test), unless the "Players see breakable walls" setting is off.
- **The actor:** a PF2e hazard for each kind and material, in the world's "Environment: structures" folder. It has GM Core's Hardness and Hit Points and object immunities. Its tokens are unlinked, so each keeps its own Hit Points. PF2e's own damage takes Hardness off (halved for adamantine). PF2e hazards don't store a Broken Threshold, so it comes from the structure's kind or material.
- **AC:** no rule gives an unattended object an AC (GM Core lists only Climb DC and Hardness, HP and BT), so it's 10 unless the GM sets another in the tab.
- **On a wall:**
  - At or below its Broken Threshold it gets PF2e's broken condition, and a locked door's lock no longer holds (locked becomes closed).
  - At 0 Hit Points it's destroyed (the dead marker), and the wall stops blocking: its movement, sight, light, sound and door settings are kept in `saved` and set to none.
  - Raised above 0 again (the tab's Repair), the wall gets them back.
- **Cards** (the selected creatures roll; the GM's Apply does the rest):
  - **Climb:** Athletics against the table's Climb DC. A critical failure falls from the height the GM enters, or lands prone from the ground.
  - **Force Open:** Athletics, with PF2e's `action:force-open` roll option, so a crowbar's bonus counts.
    - The DC is the lock's Thievery DC + 5 ("very hard"). Without a lock it's the table's (a stuck door's 15). Lifting a portcullis uses the higher of the two.
    - A critical success opens it undamaged.
    - A success breaks it open: Hit Points down to its Broken Threshold, and the door open.
    - A critical failure jams it: −2 circumstance to every later attempt.
  - **Pick a Lock:** Thievery against the lock's DC. A success counts 1 toward the lock's successes and a critical success 2. Locks are poor 15/2, simple 20/3, average 25/4, good 30/5 and superior 40/6. Once the count is reached the lock opens.
- **Its own numbers (2026-10-27, for the item module):** a structure's state can also carry `name`, `stats` `{ hardness, hp, bt }` (over its kind's or material's; BT half its HP when it gives none), `lockDC` and `lockSuccesses` (its lock's own: any `lock` key with a `lockDC` is a lock, and the wall settings show it as "Its own"), `forceDC` (its own Force Open DC, over the lock's + 5) and `height` (feet). Its token keeps the kind's actor and carries its own Hardness and Hit Points.
- **From a template (2026-10-27, the item module's Warding Escutcheon and Instant Fortress):** `api.placeStructure(scene, template)` (on a GM's client) makes breakable walls from `template = { name, at: { x, y } | token, shape: "square" | "line", feet, rotation?, height?, kind?, material?, stats?, door?: { side?, feet?, kind?, material?, stats?, lock? (a lock key, or { dc, successes }), forceOpen?, locked? }, pushOut?, source?, transparent? }`. `transparent` (or `invisible`; 2026-10-27, the item module's Cube of Force and Cube of Nex): walls of force that stop movement only, sight, light and sound passing. Checked live in `pftest` (2026-10-27): a 10-foot transparent square made four walls with movement 20 and sight, light and sound 0, and `removeStructure` took them away.
  - A square is a room `feet` on a side about its middle, its corners on the grid's lines; a line is one wall `feet` long (`rotation` 0 runs east–west, 90 north–south) on the nearest grid line. Each side is a wall; the door (5 feet wide unless `feet` says) is cut into the middle of its side (south unless `side` says), or a line's middle. The walls default to masonry and the door to iron; a door with a lock starts locked.
  - `pushOut` (a square's default): each creature in its space is moved just outside the nearest wall first (as a forced move, not a step), unless its token id is in `pushOut.except`. Where it lands isn't checked for other creatures.
  - It returns `{ id, walls, door, pushed }`. Every wall carries `placed: { id, name, source }`. `api.placedStructures(scene)` lists them, and `api.removeStructure(scene, id)` deletes its walls and their tokens.
  - Checked live in `pftest` (2026-10-27, PFTEST SIM data, deleted): a 20-foot adamantine fortress with its own numbers made six walls and a locked door; the creature inside was moved past the south wall (the world paused); the door's cards were Force Open DC 40 and Pick a Lock DC 40 with 6 successes; a wall's token had Hardness 20 and 80 HP; 50 bludgeoning on the door (Hardness 20) left it at its own BT 30, broken and unlocked; removal took all six walls and their tokens.

## The scene's weather look

The user's request (2026-10-26): apply a weather effect to the scene automatically, with a menu next to each weather listing every option, including ones other modules add.

- Foundry keeps one weather effect per scene (the Scene's `weather`, from `CONFIG.weatherEffects`). The module sets it from the heaviest weather that's on, in this order: thunderstorm, precipitation, sandstorm, ash, smoke, fog, wind, current, underwater.
- Each weather's **Look** menu lists Automatic, None, and every key in `CONFIG.weatherEffects` when the window opens, so effects other modules add there show up. A pick whose module is gone counts as Automatic.
- **Automatic:**
  - Rain and sleet: Rain, or Rain Storm when heavy or worse.
  - Snow: Snow, or Blizzard when heavy or worse.
  - Hail and thunderstorms: Rain Storm (a thunderstorm with snow: Blizzard).
  - Fog, smoke, ash and sandstorms: Fog.
  - Wind, currents and underwater: none (Autumn Leaves can be picked for wind).
- **None** gives that weather no look, so the next weather's look shows.
- **Show the weather on the scene** switches it off for the scene.
- The scene's own weather from before is kept in the flag `visuals.before` and comes back when the module's weather ends. If the GM picked another weather by hand in the meantime, that one stays.
- A new weather effect redraws the canvas on every client, so the module only changes it when the look changes.

## Rulings where GM Core leaves the numbers to the GM

The GM can change every number below in the window.

- **Fog and smoke levels:**
  - Light fog: −1, concealed beyond 60 ft.
  - Fog: −2, beyond 30 ft.
  - Thick fog: −3, beyond 10 ft.
  - Pea-soup fog: −4, every creature concealed (PF2e's condition on everyone).
  - Mist and haze have no effect in a fight.
- **Precipitation levels:**
  - Light: none.
  - Steady: −1.
  - Heavy: −2, beyond 120 ft.
  - Very heavy (a downpour, heavy snow): −3, beyond 60 ft.
  - Torrential (a deluge, a whiteout): −4, beyond 30 ft.
- **Precipitation kinds:**
  - Hail penalizes hearing instead of sight and doesn't conceal.
  - Snow Vision ignores falling snow.
  - Heavy wet precipitation soaks unsheltered creatures, so the temperature counts one step colder.
- **Wind levels:**
  - Moderate: −1 to hearing and to physical ranged attacks.
  - Strong: −2. Flying is difficult terrain, handheld flames go out.
  - Severe (gale): −3. Flying is greater difficult terrain. Fliers need Maneuver in Flight DC 20 each round or are blown 20 ft. Small and Tiny creatures need Athletics DC 15 to move.
  - Windstorm: physical ranged attacks are impossible. Maneuver in Flight DC 30, blown 40 ft. Every creature needs Athletics DC 20 to move.
  - On a ground critical failure, the creature is knocked back 10 ft and falls prone.
  - Small creatures take −1 on these checks, Tiny creatures −2.
  - In a fight, the ground check is asked when the creature first tries to move in a round (Foundry's preMoveToken stops the move and posts the card). A success lets it move for the rest of the round; a failure keeps it still that round. Only its own drags and key moves wait; pushes, teleports and other modules' moves don't.
- **Thunderstorms:**
  - A thunderstorm raises the wind and rain to at least strong and heavy. A severe one raises them to severe and downpour.
  - Lightning: each exposed creature has a 1 in 200 chance each minute.
  - Lightning damage is moderate, or major in a severe storm, with no save unless the GM gives a DC. The text names none.
- **Heavy sandstorms:** minor slashing damage at the start of each turn, holding breath, or both (the GM picks; both by default).
- **Volcanic ash:** like fog in its levels, plus minor fire damage every minute. Unbreathable is the GM's option. Ash lightning is 1 in 1000 each minute.
- **Wildfire heat:** a smoke option, from minor to massive fire damage at the start of each turn.
- **Perception penalties:** one toggle for sight, on by default, and one for hearing, off by default, on the Perception check. This follows the spell module's Confetti Cloud. Initiative is never penalized.
- **Concealment:**
  - Past a distance: the module rolls the DC 5 flat check on Strikes and spell attacks.
  - Everyone concealed: PF2e's condition is on each creature. The spell module rolls the flat check for spells, the module rolls it for Strikes.
  - An attacker with a precise sense other than sight (echolocation, tremorsense…) that reaches the target skips the check.
  - Spells aimed at creatures (not areas, not spell attacks): the module rolls the weather's flat check for each target past the distance as the spell is cast. A miss goes into the spell module's own list of missed targets on the cast message (`targetMisses`), so the spell leaves that creature out. Targets PF2e already marks concealed or hidden are the spell module's to roll.
- **Items that ignore part of the weather** (from the item module): `flags["pf2e-automatic-environment-resolution"].weatherIgnores = { ignores: [keys], source, weapon?, windUpTo? }` on an Effect (Ixamè's Eye), or `api.weatherIgnores(actor)` for worn and wielded items (a Cape of the Open Sky, Wintershot). The key is `weatherIgnores`, not `weather`, which marks the module's own Effects. Keys:
  - `sight`: no sight penalty.
  - `fog-mist`: fog's sight penalty and concealment don't apply to it.
  - `precipitation`: rain and snow don't conceal its targets.
  - `concealment`: no weather concealment for it as the viewer.
  - `wind-ranged`: no wind penalty on its ranged Strikes, up to `windUpTo` when given.
  - `wind-movement`: no wind checks, no blowing away, and no wind cost on its flying.
  - With `weapon` (an item id), the entry counts only for that weapon's Strikes.
  - PF2e's concealed condition in pea-soup fog still makes the spell module roll for spells; the module's own flat checks (Strikes, spell attacks, spells at a distance) follow the ignores.
- **Underwater:**
  - PF2e's own Effect: Aquatic Combat.
  - Murky water hides creatures beyond 10 ft (DC 11 flat check). Clear water hides them beyond 240 ft.
  - Creatures that can't breathe water get PF2e's Effect: Remaining Air.
- **Holding breath:**
  - The counter drops at the end of each turn, by 2 if the creature attacked or cast a spell that turn, and by 1 when it takes a critical hit.
  - Casting a spell that isn't subtle loses all the air.
  - Out of air, the creature is unconscious and makes the escalating Fortitude save at the end of each turn.
- **Temperature:**
  - Damage comes at the table's intervals.
  - Cold-weather clothing removes severe cold and makes extreme cold count as severe.
  - Environmental Endurance removes severe and extreme cold and heat.
  - Sheltered creatures, ticked in the window, feel none of it.
  - Items that protect from the temperature come from the item module, in one shape: `{ counts: { felt key: the key it counts as }, fatigueHours?, source }`. A consumable's or an activation's comes as a flag on the Effect it gives (`flags["pf2e-automatic-environment-resolution"].temperature`). A worn, invested or held item's comes from `game.modules.get("pf2e-automatic-item-resolution").api.temperatureProtections(actor)`. Soaking applies first, then the mildest of the gear, Environmental Endurance and each protection; protections don't chain. A protection's `fatigueHours` is added to the travel fatigue hours, the largest one only. A protection with `where: "underwater"` (2026-10-27, Faydhaan's Dallah's Brew) holds only while the scene's weather is underwater.
- **Clock damage:** each kind of damage is rolled once for all the creatures it hits, the way area damage is. A jump of more than an hour (a setting) is posted for the GM to apply.
- **Travel fatigue:** with "Travelling" on, the PCs become fatigued after the hours the temperature and precipitation allow, once per journey.
- **Disasters:**
  - Each damage category defaults to the middle of its range: minor 2d6, moderate 5d6, major 10d6, massive 20d6 (settings).
  - Disaster DCs default to the middle of the feature's Proficiency DC Band.
  - Avalanches, collapses and pyroclastic flows: Reflex. Success: half damage. Critical success: also not buried.
  - Tremors: failure knocks prone and deals damage, critical failure double damage.
  - Fissures: failure falls in (falling damage).
  - Liquefaction: failure immobilized, critical failure restrained.
  - Floods and tsunamis: Reflex, carried off on any but a critical success (tsunamis carry even then).
  - Tornadoes: an Athletics check against the wind. Failure knocks back and prone. Critical failure picks the creature up (massive damage plus falling).
  - Lava bombs, steam vents and sewer gas: basic Reflex.
  - Wildfire flames: basic Reflex, with moderate persistent fire on a failure.
  - Buried creatures are restrained, take minor damage each minute (and cold under snow), and can be dug out from a card.
  - Falls (a fissure, a tornado's drop) deal half the distance for falls of more than 5 feet, and the creature lands prone only if the fall hurts it. Items that ease a fall come from the item module as a flag on the Effect it gives: `flags["pf2e-automatic-environment-resolution"].fall = { shorter?: feet, noDamage?: true, landsOnFeet?: true, source }`, and from `game.modules.get("pf2e-automatic-item-resolution").api.fallEases(actor)` for worn or invested items, in the same shape. The largest `shorter` comes off (they don't add); any `noDamage` means no damage; any `landsOnFeet` (a Tumbler's Belt) means no prone even when the fall hurts. When a save's degree means a fall, the module calls the hook `pf2e-automatic-environment-resolution.falling` with `{ token, feet, message, targetId }` before the GM's Apply, so a reaction can be used in time. An entry can also take damage off (2026-10-26, an Impact Foam Chassis): `{ reduceBy: N, minFeet?, itemUuid?, source }` — the largest one, for a fall of at least `minFeet`, up to the damage left after the shorter fall. After the GM's Apply has dealt the fall's damage, the module calls `pf2e-automatic-environment-resolution.fell` with `{ token, feet, damage, applied, reductions }` on the applying client: `damage` before the reductions, `applied` after them, `reductions` `[{ source, itemUuid, amount }]`. An entry `{ halved: true, source }` (2026-10-27, a Parachute Mail deployed below 100 feet) halves the damage left after all the rest, rounded down; the hook then carries `halved`, its source (otherwise null). Two more (2026-10-29, the item module's Impact Jelly): `{ nonlethal: true, source }` makes the fall's damage nonlethal — dealt on its own after the card's other damage, and if it's what drops it to 0 Hit Points, it's knocked out (unconscious) instead of dying: no dying, dead mark or defeat; `{ landCheck: { statistics, dc, add?, per? }, source }` lets a creature the fall hurts and would leave prone roll its best of those statistics (PF2e's roll, on the GM's client) against `dc` plus `add` for every `per` feet fallen (before any `shorter`), the easiest such check when there are more; on a success it lands standing, the damage the same. The `fell` hook then also carries `nonlethal` (its source or null), `knockedOut` and `standing`. Checked live in `pftest` (2026-10-27): a 90-foot fissure fall on a creature with a halved Effect dealt 22 (45 halved), left it prone, and the GM's note and the `fell` hook said so; a `where: "underwater"` protection held only with the underwater weather on.
- **Terrain:**
  - Each feature gives PF2e's movement cost and environment types.
  - Uneven ground and narrow surfaces: off-guard while on them, and a Balance card for each move into or within them (not for a creature moved by force). A failure puts the creature back where its move started; a critical failure does that and leaves it prone.
  - Heavy undergrowth, hedges, large trees and canopy give standard cover inside.
  - Hazards deal their damage for each move into or through them (once a move, not each square), or at the start of each turn inside.
  - Stairs are difficult terrain only going up: the GM sets each stairs region's up direction, and a walking step with some of its way that direction costs double. (Foundry's region costs can't see direction, so the token's movement cost function is wrapped.) Enormous stairs stay greater difficult terrain both ways.
  - Flowing water pushes at the end of each turn.
  - A creature that ignores a feature's difficult terrain by PF2e's own entries naming it (`system.movement.terrain.difficult.ignored`, `.greater.ignored`, each `{ environment, feature }` — the item module's Winterstep Elixir, Underbrush Cloak…) moves through that region as if it weren't difficult (greater difficult as difficult when only difficult is ignored). PF2e itself applies only `{ environment: "all", feature: "all" }`; the rest is the module's, in the same wrapped cost function as the stairs. Feature keys map to PF2e's: ice; snow (snow, deep snow, snow crust); rubble; sand; crowd; sewer; lava; and "undergrowth" (the item module's: the undergrowths and roots). One that ignores ice, snow or undergrowth this way is sure-footed there too: no Balance, not off-guard.
  - Crowds can be parted with a check.
  - Sewer gas can be ignited.
