# Prototype character

Neutral humanoid mannequin by Quaternius, Universal Animation Library (Standard).
Adult human proportions; displayed at 1.8 m tall. No facial features, hair, clothes or accessories.
License: Creative Commons Zero (CC0), included as CHARACTER-LICENSE.
Author and pack: https://quaternius.com/packs/universalanimationlibrary.html
Source mirror: https://github.com/NafisRayan/Animate-Rigged-Humanoid-No-Blender/blob/main/Universal%20Animation%20Library%5BStandard%5D/Universal%20Animation%20Library%5BStandard%5D/Unreal-Godot/UAL1_Standard.glb

Local derivative: one matte gray material, textures and unused animation data removed.
Kept Idle_Loop, Walk_Loop, Sprint_Loop and Jump_Loop with their original names.
Added compatible Swim_Fwd_Loop, Swim_Idle_Loop and Jump_Land from the same
Quaternius CC0 source. Gallop_Loop is a 1.35x cadence derivative of Sprint_Loop;
Fly_Loop and Fly_Idle_Loop are local hovering/flying pose derivatives of swim
clips, with mirrored arms and subtle body motion. Hovering legs use the tucked
Jump_Loop pose, with 12% of the water-idle joint motion layered around the
retained pose and a seamless loop. Hover upper arms move two thirds toward the
resting arms-down pose. Clips crossfade except flight-to-ground transitions, which
switch directly to avoid interpolating the horizontal body through the floor.

Rebuild these movement clips with:
`python3 scripts/build-character-movement.py /path/to/UAL1_Standard.glb`
The script keeps the local matte mannequin and copies only the necessary data;
no network access or animation retargeting is needed at runtime.
Runtime needs no remote decoder or CDN.
