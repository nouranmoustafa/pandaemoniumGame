# Character assets: what to supply

Stage 3 ships **no third-party models for the cast**. The Visitor and her three
friends (Odette, Juno, Wren) are original characters, generated in code as real
skinned meshes (`src/characters/GeneratedCharacter.ts`). They are functional, but
they are not sculpted, artist-made models.

For premium quality, supply one rigged GLB per character. Drop it in this folder
and register it in `src/characters/gltf/manifest.ts` (`CAST_ASSETS`), with its
licence. Check it in the dev lab with `?lab&glb`. The loader prints a report of
the bones, clips and morphs it found.

## Requirements per character (`visitor.glb`, `odette.glb`, `juno.glb`, `wren.glb`)

**Licence:** original work, or CC0 / CC-BY with attribution recorded in
`CREDITS.md`. No rips of film or game characters.

**Mesh:** a single body, or a body plus clothing meshes, skinned to one skeleton.
Target 15–40k triangles. Real-world scale, facing +Z, Y-up.

**Skeleton:** humanoid, with names matching one of Mixamo, Unreal/Quaternius,
Rigify-export or VRM. See `BONE_ALIASES` in `src/characters/gltf/GltfAvatar.ts`.
Include fingers (3 joints each) and an optional chain of 3–4 hair bones.

**Outfits:** clothing as separate meshes on the same skeleton. Stage 4 swaps the
everyday outfit for a wedding gown, so the face, hair and body must stay the same.

**Facial morph targets:** the ARKit-52 names are ideal. The minimum set is
`mouthSmileLeft`/`Right`, `mouthFrownLeft`/`Right`, `jawOpen`, `browInnerUp`,
`browDownLeft`/`Right`, `eyeWideLeft`/`Right` and `eyeBlinkLeft`/`Right`.

**Animation clips** (names as in `CLIP_ALIASES`; extra names can be added there):

| Needed now | Clips |
| --- | --- |
| Locomotion | `Idle`, `Walk`, `Walk_Nervous`, `Jog`, `Run`, `Sprint` (in place, no root motion) |
| Chase reactions | `Stumble`, `Recover`, `Slide`, `LookBack`, `Fear` |
| Prologue | `Talk`, `Laugh`, `Wave`, `Phone_Out`, `Phone_Read`, `Phone_Away`, `Hesitate` |

## Pipeline test asset

`pipeline-test/RobotExpressive.glb` is the CC0 "RobotExpressive" model by Tomás
Laulhé (Quaternius), with morph targets by Don McCurdy. It comes from the
three.js repository (r170). It is only used to validate the loader, mixer and
morph mapping in `?lab&glb`, and it never appears in the game.
