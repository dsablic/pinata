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

`humanoid.json` maps the clips' source skeleton onto the example humanoids' joints; each example's `retarget.json`
adds which of its joints hang from the chest and head.

A `retarget.json` may also carry a `style` (see `src/mocap/style.ts`): the knight's keeps its sword arm stiff and the
blade held low, as an arm carrying something does, instead of the capture's empty-handed swing.
