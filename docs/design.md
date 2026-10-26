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
  - Downpour: −3, beyond 60 ft.
  - Deluge: −4, beyond 30 ft.
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
  - Items that protect from the temperature come from the item module, in one shape: `{ counts: { felt key: the key it counts as }, fatigueHours?, source }`. A consumable's or an activation's comes as a flag on the Effect it gives (`flags["pf2e-automatic-environment-resolution"].temperature`). A worn, invested or held item's comes from `game.modules.get("pf2e-automatic-item-resolution").api.temperatureProtections(actor)`. Soaking applies first, then the mildest of the gear, Environmental Endurance and each protection; protections don't chain. A protection's `fatigueHours` is added to the travel fatigue hours, the largest one only.
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
  - Falls (a fissure, a tornado's drop) deal half the distance for falls of more than 5 feet, and the creature lands prone only if the fall hurts it. Items that ease a fall come from the item module as a flag on the Effect it gives: `flags["pf2e-automatic-environment-resolution"].fall = { shorter?: feet, noDamage?: true, source }`. The largest `shorter` comes off (they don't add); any `noDamage` means no damage. When a save's degree means a fall, the module calls the hook `pf2e-automatic-environment-resolution.falling` with `{ token, feet, message, targetId }` before the GM's Apply, so a reaction can be used in time.
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
