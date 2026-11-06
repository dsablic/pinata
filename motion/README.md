# Motion clips

`clips/` holds motion-capture clips converted from the
[CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu). The database's terms allow the data to be
copied, modified and redistributed without permission, including in products; the data itself may not be resold.
Each clip's `source` names the subject and trial it came from; [`takes.json`](takes.json) lists them all.

The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF
EIA-0196217.

To rebuild the clips:

```
npm run mocap -- fetch motion/takes.json <source-dir>
npm run mocap -- convert motion/takes.json <source-dir> motion/clips
```

A take in `takes.json` may also give `kind` and `range`. `kind: "jump"` marks a jump take: the converted clip carries
the kind, the player plays it when a character jumps, and it is never a candidate for walking. `kind` `idle`, `crouch`
or `attack` marks a behaviour take that the player plays on command (`perform`), likewise never matched: `idle-wait`
(subject 137, a standing take that keeps its feet down, looped), `crouch-squat` (subject 86, a squat down and up) and
`attack-punch` (subject 141, a punch). An idle take's first 12 frames are the overlap its loop cross-fades into.

A walking take may give `gait` (`walk` or `run`) and `loop: true`: the steady takes (`walk`, `walk-2`, `run`) are
looped by the player on one symmetric stride, and their speeds over their leg give each character's walk and run speeds
(Froude similarity). An attack take gives `attack`: `attack-punch` is a punch and `attack-swing` (subject 79, trial 1,
chopping wood: a two-handed overhead chop from a hold through a recovery to rest) a swing. A thrust or a cast has no
take here; the database composes one from the idle.

`range` is the first and last source frame (at `sourceFps`) to keep, so a take is cut to its useful part. The `jump-*`
takes are cut from
about 0.3 s before the crouch to just after the landing settles.

`humanoid.json` maps the clips' source skeleton onto the example humanoids' joints; each example's `retarget.json`
adds which of its joints hang from the chest and head.

A `retarget.json` may also carry a `style` (see `src/mocap/style.ts`): the knight's keeps its sword arm stiff and the
blade held low, as an arm carrying something does, instead of the capture's empty-handed swing.
