// Real-game observation only. Installs a test-world datapack; the shipped mod jar is untouched.
const fs = require('node:fs/promises');
const path = require('node:path');

async function install(instance, creature) {
  const root = path.join(instance, 'saves/test_scene/datapacks/official-combat-probe');
  const target = '@e[tag=mm_probe_boss,limit=1]';
  const player = '@p';
  const setup = (distance, health = 1000) => [
    'gamerule doMobSpawning false', 'gamerule naturalRegeneration false', 'difficulty normal',
    'scoreboard objectives add mm_probe dummy', 'scoreboard players set tick mm_probe 0',
    'gamemode creative @a', 'kill @e[tag=mm_probe_boss]',
    `tp ${player} 100 -60 ${100 + distance} 180 ${distance === 11 ? 35 : 0}`,
    `attribute ${player} minecraft:generic.max_health base set ${health}`,
    `attribute ${player} minecraft:generic.knockback_resistance base set 1`,
    `effect clear ${player}`, `effect give ${player} minecraft:instant_health 1 20 true`,
    `summon ${creature} 100 -60 100 {Tags:["mm_probe_boss"],PersistenceRequired:1b,Rotation:[0f,0f]}`,
    `attribute ${target} minecraft:generic.movement_speed base set 0`,
    `attribute ${target} minecraft:generic.knockback_resistance base set 1`,
    'scoreboard players set old mm_probe 1000000', 'gamemode survival @a',
  ];
  const files = {
    'pack.mcmeta': JSON.stringify({pack:{pack_format:48,description:'Official naming real combat regression probe'}}),
    'data/mm_probe/function/start.mcfunction': [...setup(1.8), 'tellraw @a "MM_COMBAT_START"', 'schedule function mm_probe:sample 1t replace'].join('\n'),
    'data/mm_probe/function/sample.mcfunction': [
      'scoreboard players add tick mm_probe 1',
      'execute store result score hp mm_probe run data get entity @p Health 1000',
      'scoreboard players operation delta mm_probe = old mm_probe',
      'scoreboard players operation delta mm_probe -= hp mm_probe',
      'execute unless score hp mm_probe = old mm_probe run tellraw @a [{"text":"MM_DAMAGE tick="},{"score":{"name":"tick","objective":"mm_probe"}},{"text":" hp="},{"score":{"name":"hp","objective":"mm_probe"}},{"text":" delta="},{"score":{"name":"delta","objective":"mm_probe"}}]',
      'scoreboard players operation old mm_probe = hp mm_probe',
      'execute if score tick mm_probe matches ..599 run schedule function mm_probe:sample 1t replace',
      'execute if score tick mm_probe matches 600 run gamemode creative @a',
      'execute if score tick mm_probe matches 600 run tellraw @a "MM_COMBAT_END"',
    ].join('\n'),
    'data/mm_probe/function/warn.mcfunction': [...setup(11, 20), 'tellraw @a "MM_WARN_START"', 'schedule function mm_probe:cut 40t replace'].join('\n'),
    'data/mm_probe/function/cut.mcfunction': [`tellraw @a "MM_WARN_CUT"`, `damage ${target} 1 minecraft:player_attack by ${player}`].join('\n'),
  };
  for (const [name, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), {recursive:true});
    await fs.writeFile(path.join(root, name), text+'\n');
  }
  return root;
}
module.exports = {install};
if (require.main === module) install(process.argv[2], process.argv[3]).then(console.log);
