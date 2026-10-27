# THE HOUSE WANTS YOU

A cinematic 3D psychological horror chase with dark satire, built with **Three.js + TypeScript + Vite**.

A young woman goes to an old park at night to meet someone from a dating app. The park comes alive and herds her toward a haunted house. The Demon behind it is intelligent, sarcastic, and increasingly anxious that she might get away.

> **Stage 3 (this build): the prologue and a new cast.** The game now opens on a 43-second cinematic. Four friends talk outside the gardens at dusk. The Visitor gets a match on a dating app ("Meet me by the old garden house?"), says goodbye, and walks in through the gate while the evening drains away around her. The camera settles behind her and the chase begins, with no cut.
>
> The Visitor and her three friends are new, original, skinned characters. Stage 2's chase, Demon, powers, tricks and local 1v1 are unchanged.
>
> Stage 2 is on branch `stage-2`; Stage 1 is at tag `stage-1`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Debug: `?skipintro` goes straight to the chase. `?lab` shows the cast in a studio view (`?lab&glb` also loads the GLB pipeline test model). `?x=280` starts further along the course. The false shortcut is at about x 124–166, the pavement hill starts around x 200, and the slide around x 290.

## Modes and controls

From the title screen, choose **PLAY ALONE** (vs the AI Demon) or **LOCAL 1V1**.

| Who | Input | Action |
|---|---|---|
| Visitor | **↑ / W**, **↓ / S** | Change lanes. Steering during a gust also braces against it. |
| Visitor | **Space** (tap) | Run faster; stop tapping and she tires back to a jog |
| Demon (1v1) | **Mouse** | Click a power (Grass, Wind, Water, Fire), then click the lit path ahead of her. Right-click cancels. |
| Either | **Esc / P** | Pause. **R** restarts (paused or end screen). **Enter** plays solo from the title. |
| Intro | **Hold Esc** (1 s) | Skip the prologue. During the intro, Esc only skips; **P** pauses. |

In 1v1, the Demon wins if she is caught 5 times before she reaches the house; otherwise the Visitor wins.

## Stage 3: the prologue

### The story beats (`story/prologue/Prologue.ts`)

| Beat | Time | What happens |
| --- | --- | --- |
| `PROLOGUE_ESTABLISHING` | 0–7 s | A wide crane down onto the plaza outside **Ashgrove Gardens**: warm lamps, lit townhouses, four women talking. |
| `PROLOGUE_FRIENDS` | 7–15 s | Over-the-shoulder shots and their reverses. There is laughter. |
| `PROLOGUE_PHONE` | 15–25 s | Her pocket buzzes. Over her shoulder, the phone shows *hearth*: a match, then "Meet me by the old garden house?" and a shared location. On her reaction close-up she smiles and tucks her hair. She replies "On my way". |
| `PROLOGUE_GOODBYE` | 25–31 s | She thumbs toward the park, waves and walks. From inside the gate, the friends recede behind her. |
| `PROLOGUE_PARK_ENTRY` | 31–42.4 s | A side follow, then behind her. A lamp stutters, a swing creaks with nobody on it, a branch moves without wind, and the grass ripples against the wind. She hesitates and looks back, the camera settles into the chase framing, and she is yours. |

Then come `CHASE_GAMEPLAY`, `CHASE_ESCALATION` (the Demon's mood leaves *amused*), `PAVEMENT_SLIDE` and `STAGE_2_END`. These story states run beside the flow states (`title → prologue → playing ⇄ paused → ended`) in `core/StateMachine.ts`.

**Foreshadowing**, never pointed at:
- Juno's laugh-smile holds about two seconds after everyone else stops, then drops all at once.
- Odette doesn't blink while she watches the Visitor.
- Odette looks at the Visitor's pocket 0.6 s *before* the phone buzzes.
- Wren's shadow trails her head turn by 0.38 s. Her shadow is cast by an invisible twin that replays her pose late (`characters/ShadowTwin.ts`).
- Juno's goodbye wave freezes mid-swing and holds.

**One clock.** Cues fire once each, in order, from `update()`, with no timers. Pausing freezes the scene. Skipping (hold Esc) jumps the clock and settles the end state behind a fade. Every new run (Play, Run Again, Restart) starts with the prologue. Restarts reset the same objects instead of rebuilding them, so nothing duplicates.

**Warm → cold** is spatial, driven by her position, so it holds on a skip or a replay. Between the gate and the handoff mark, these all blend from dusk to night:
- fog and lights;
- the sky's sunset band;
- a low afterglow light;
- the colour grade;
- the grass (absent on the plaza, tended at the gate, wild beyond);
- the trees (ordinary rounded ones give way to the crooked ones);
- the audio (town traffic, murmured conversation and the dusk pad give way to wind, the drone and louder footsteps).

**Camera.** `camera/CinematicDirector.ts` lays the shots out on the prologue clock. Each shot tracks the live characters and eases in from the previous one while both keep moving, so there are no cuts. `ChaseCamera.beginHandoff` then eases from the last shot into the live chase framing over 2.2 s.

### The cast (`characters/`)

| | Silhouette | Clothes |
| --- | --- | --- |
| **The Visitor** | Shoulder-length dark hair, side fringe, low ponytail | Burgundy wool coat with a black velvet shawl collar, belt, dark tights, laced ankle boots |
| **Odette** | Tall, long straight black hair, very upright | Long charcoal coat with a stand collar, trousers, pointed boots |
| **Juno** | Shorter, a burst of copper curls, freckles, a hand on her hip | Cord jacket over an ochre knit, red A-line skirt, chunky boots |
| **Wren** | Asymmetric ash-silver sweep, reserved and a little hunched | Oversized grey knit, long dark skirt, a long oxblood scarf |

How the characters are built:
- **Rig.** Each character is a real `THREE.Skeleton` with about 50 bones: the body, 2-joint fingers, coat panels, and hair and scarf spring chains.
- **Skin and clothing.** `SkinnedMesh` body and clothing layers carry distance-weighted skinning, so joints bend smoothly.
- **Head.** A sculpted head carries six morph targets (smile, frown, jaw, brow raise, brow knit, fear-stretch).
- **Face.** The brows and lips are painted from expression parameters and redrawn 12 times a second, like stop-motion replacement faces.
- **Eyes.** Eyeballs with gaze, and eyelid shells for blinks, squints and wide eyes.
- **Expressions.** Neutral, smile, laugh, concern, fear, surprise, distress and determined.
- **Identity and outfit are separate.** `setOutfit()` rebuilds only the garment layers on the same skeleton, which is ready for the wedding gown.

**Animation** (`visitor/VisitorAnimator.ts`, `characters/Performer.ts`, `characters/gestures.ts`):
- **Gait.** One phase drives a walk (a stance sweep matched to stride length, so feet plant) that blends into the Stage 2 run, which is still synced to SPACE taps.
- **Idles.** Each woman has her own idle, with breathing and weight shifts.
- **Gestures.** Authored, layered gestures: talk, story, laugh, nod, tilt, wave, the wave that stops, thumb-back, hair tuck, arms folded, flinch and hesitate.
- **Phone.** A take-out / read / type / put-away sequence, with a prop constraint that turns the screen to her eyes or to the lens.
- **Look-at and blinks.** Look-at leads with the eyes. Blinking is automatic.
- **Chase expressions.** Her face reacts in the chase: concern, effort, fear on a catch, dread as the Demon grows anxious, relief on a dodge.

**GLB pipeline** (`characters/gltf/`):
- `GltfAvatar` loads a rigged GLB and maps humanoid bones (Mixamo, UE/Quaternius, Rigify, VRM).
- It drives the clips with an `AnimationMixer` (speed-blended locomotion plus one-shot gestures) and maps expressions onto the model's morph targets.
- It is validated in `?lab&glb` with a CC0 test model. `public/characters/README.md` specifies exactly what to supply, and `CREDITS.md` tracks the licences.

## The Demon

### How the AI decides (`demon/AIDemonDirector.ts`)

The AI uses no randomness for its own sake and makes no LLM calls. At each decision it scores every legal **(power × lane × distance)** combination against what it has observed (`VisitorObserver`):

- **Her habits:** which lanes she favours and how long she sits in one.
- **Where she's about to dodge:** if something already waits in her lane, it predicts the open neighbour she'll pick and targets *that*. A fire on the escape route is misdirection.
- **Her tapping rate:** heavy sprinting attracts slick puddles and headwinds.
- **What's already ahead:** a gust is most valuable when it can herd her into a hazard waiting just beyond it.
- **Variety:** it gets bored of repeating itself.
- **Adaptive intensity:** clean dodges raise its intensity, which brings shorter gaps and more misdirection. Repeated catches lower it and trigger a **mercy window** with longer warnings and pushes preferred over walls.

It then picks among the best few options with weighted randomness (intelligent, not predictable) and casts through the same rules a human Demon must obey.

### Moods (`demon/DemonMind.ts`)

| Phase | Triggered by | Behaviour |
|---|---|---|
| **Amused** | start | long gaps, subtle powers from far away, lamps confer, signs lie |
| **Irritated** | about 24% of the course, or she's dodging well | every power in play, tighter timing |
| **Desperate** | about 64% of the course, or 50% while she's performing well | fastest cadence, crowds her, more omens, the night thickens and reddens, the house glows harder, the drone tightens |

Phases never step back down. The final slide into the house is always a scripted event (`story/park/CourseDirector.ts`); no Demon can trigger it.

### The four powers (`obstacles/`)

| Power | Warning | Effect | Base cooldown |
|---|---|---|---|
| **Grass** | blades thrash, cobbles crack red | roots burst up and coil around her ankles: stumble and slowdown, quick recovery | 5.5 s |
| **Wind** | streaks and a leaf spiral gather in a stretch of path | lateral force plus drag, and she visibly leans into it. Unless she steers to brace, it shoves her one lane. Grass, trees and leaves all bend. | 9 s |
| **Water** | a puddle spreads, bubbling and rippling | erupts into a fountain that blocks the lane as she arrives, then leaves slick stone (loose steering, weak taps, arms flailing). Reflects the night, and sometimes shows three figures who aren't there. | 8 s |
| **Fire** | pale embers and a frost-blue scorch line | a wall of cold, ghostly flame across one lane, which sinks into drifting black ash | 10 s |

### Fairness rules (`demon/abilities/Fairness.ts`)

Every cast, AI or human, must pass these rules. Each refusal carries a stated reason, which the 1v1 panel shows to the player.

1. At least one lane always stays open around every hazard ("That would close every path. Even I play fair.").
2. Every attack has a minimum readable warning, computed for her *possible* top speed ("Too close — she'd have no warning.").
3. Nothing can be placed on top of her or behind her.
4. No new casts for 1.6 s after a catch, and she gets 1.7 s of grace ("Let her stand up first. Even you have standards.").
5. Two blocking hazards in one lane need clear space between them, so there are no stun-locks.
6. Cooldowns on every power, plus a minimum gap between any two casts.
7. The same power can't be used more than twice in a row.
8. At most 4 summoned hazards at once, and none in the final approach to the house.

### Psychological tricks (`demon/Tricks.ts`)

These run in both modes, because they belong to the park rather than to the Demon player's hand.

- **The lying signpost:** "EXIT" points back the way she came, then slowly turns, with an unnatural pause and twitch, to point at the house. When she gets close, it is innocent again. It turns to watch her go.
- **The recurring bench:** the same bench (cracked slat, red rose, brass plaque) appears three times. The plaque changes each time: *FOR THOSE WHO WAITED*, then *FOR THOSE WHO WAITED. STILL.*, then *YOU AGAIN.* The third appearance is beside the shortcut.
- **The watching streetlights:** lamp heads she has passed slowly turn their beams to follow her. A lamp ahead of her is perfectly still. Now and then two lamps lean together as if conferring, and freeze when she gets close.
- **The false shortcut:** an iron gateway, an honest-looking EXIT sign, and then calm. The fog thins, the lamps go warm and steady, a following breeze speeds her up, and the Demon stops attacking. Then the lying sign appears again. The shortcut has led straight to the house, which flares into view.
- **The sarcastic pavement:** sustained hard sprinting makes the path ahead tilt into a long incline.

### Sarcasm (`demon/Sarcasm.ts`)

At most **three remarks per run**, each at most once, at least 24 s apart, and only when earned. Remarks are written onto the world, never floated over her: a memorial stone rises out of the verge, the signpost's plaque, or the bench's plaque.

| Trigger | Remark |
|---|---|
| She changed lanes straight into a catch, twice | *A remarkable commitment to being wrong.* |
| The sarcastic incline | *All that effort. Impressive, really.* |
| A dodge streak of 5+ | *You're making this unnecessarily personal.* |
| Dawdling at jog speed for 6 s | *Take your time. Apparently we have all night.* |
| Bracing against its winds twice | *You seem determined to make this difficult.* |

The only subtitles are two narrative bookends: the opening line and the line at the door.

## Project structure (Stage 2 additions marked ★)

```
src/
  config.ts                      tuning: lanes, speeds, course, camera, ★POWERS, ★FAIRNESS, ★MODE_TUNING
  core/      Game.ts (★modes, shader prewarm) · StateMachine · Input · Events (★Stage 2 events) · PostFX · math
  visitor/   VisitorController (★wind, traction, dodge reward) · VisitorAnimator (★wind lean/shield, slip) · Pose · avatars
  camera/    ChaseCamera
  world/     Environment (★mood, tree sway) · Pavement (★inclines) · Streetlights (★watching, conferring)
             House (★glow/flare) · ★Inscriptions · ★TargetingOverlay · ★props/Signpost · ★props/Bench · …
  obstacles/ Obstacle (★shared lifecycle/disposal) · GrassAttack (★ankle coils) · TreeAttack (★bending trunk)
             ★WindGust · ★WaterHazard · ★FireLine · ObstacleManager
  demon/     ★abilities/DemonAbilitySystem · ★abilities/Fairness · DemonDirector · AIDemonDirector (★rewritten)
             ★HumanDemonDirector · ★DemonMind · ★VisitorObserver · ★Tricks · ★Sarcasm · DemonVoice
  story/     Chapter · park/ParkChapter (★both modes) · ★park/CourseDirector · park/course (★thinned, shortcut gap)
  audio/     AudioEngine (★gust, gurgle/fountain, cold ignition/ash, dodge relief, bells, lamp hum, phase swells)
  ui/        UI (★mode menu, 1v1 how-to, dodge flash, winner card) · ★DemonPanel · styles
```

## Honest notes

- **The characters are skinned rigs, but generated, not sculpted.** They are original and fully code-generated: real skeletons, skinned meshes and morph targets. They are not artist-modelled assets, so faces and cloth read as stylized puppets rather than film-quality models. The GLB pipeline is ready for supplied models (see `public/characters/README.md`).
- **Animation is procedural and authored in code**, not mocap or keyframed clips. `AnimationMixer` drives supplied GLB clips; it isn't used for the generated cast.
- **There is no cloth or hair simulation.** Coat panels, hair and scarves are spring-driven bone chains.
- **All textures and sounds are generated at runtime.** There are no asset files, and no voice acting: the Demon "speaks" in engraved text.
- **Puddles use `MeshPhongMaterial`, deliberately.** It samples the equirect night panorama directly. `MeshStandardMaterial` would trigger Three.js's PMREM prefilter, whose shader produced an (harmless) HLSL precision warning on Windows/ANGLE and a compile stall mid-chase. All hazard shaders are also precompiled at load (`DemonAbilitySystem.prewarm`).
- **Performance:** about 150–160 fps at 1600×900 on an RTX 4060 laptop GPU. On an integrated Intel GPU, expect much less; dynamic resolution compensates. On dual-GPU laptops, set the browser to *High performance* in Windows Graphics settings.

## Roadmap

1. ~~Stage 1: park chase~~
2. ~~Stage 2: the intelligent Demon, four powers, tricks, local 1v1~~
3. ~~Prologue: the dating app, the match, the friends~~
4. House interior: forced inside, the wedding dress
5. Mirror: terrifying reflections
6. Window: friends outside, the escape
7. Reveal: the friends become demons; the house was protecting her
