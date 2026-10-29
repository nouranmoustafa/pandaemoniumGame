# PANDEMONIUM

A cinematic 3D psychological horror chase with dark satire, built with **Three.js + TypeScript + Vite**.

A young woman goes to an old park at night to meet someone from a dating app. The park comes alive and herds her toward a haunted house. The Demon behind it is intelligent, sarcastic, and increasingly anxious that she might get away.

> **Stage 5 (this build): the window.** After the mirror, there's laughter outside. Her three friends stand on the lawn under a lamp, waving. The glass fogs, and an invisible finger draws their true faces on it, exactly over them. She wipes them away (SPACE); they come back, drawn harder. She chooses: leave through the window, or stay. Staying shows her a little more, then lets her choose again. The window opens, the gown catches on the sill, vines grow from the frame, and she tears free (SPACE) onto the lawn. The house reaches after her once, stops, and shuts the window. It says nothing more. Then the chase's own controls return for the run back along a park that has stopped attacking her, toward her friends, who look less and less right. Each friend becomes what she is, in her own body. She understands, turns toward the house, and is taken. The house stands alone. *It was never the house you should have feared.*
>
> Stage 4 is on branch `stage-4`.

> **Stage 4: the house.** The chase no longer stops at the door. White silk ribbons reach out of the doorway, take her by the wrists and waist, and draw her inside; the door slams. The front hall is laid out as a wedding with no guests: empty chairs, a crimson aisle, candles that light themselves, a dead-rose arch and a tall mirror under a sheet. The ribbons walk her down the aisle, and under the arch the wedding gown grows over her while her coat dissolves. The veil settles, her face is made to smile, and the sheet slips off the mirror. She can pull back (SPACE) the whole way. It changes nothing, but the house keeps count.
>
> Stage 3 is on branch `stage-3`.

> **Stage 3: the prologue and a new cast.** The game now opens on a 43-second cinematic. Four friends talk outside the gardens at dusk. The Visitor gets a match on a dating app ("Meet me by the old garden house?"), says goodbye, and walks in through the gate while the evening drains away around her. The camera settles behind her and the chase begins, with no cut.
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

Debug: `?stage5=window|choice|run|reveal` starts Stage 5 at that checkpoint (development only; it is not in any menu). `?house` starts at the foot of the porch, so Stage 4 begins at once. `?skipintro` goes straight to the chase. `?visitor=test` plays the Visitor as the CC0 GLB test model (`?visitor=generated` forces the generated one). `?lab` shows the cast in a studio view (`?lab&glb` also loads the GLB pipeline test model). `?x=280` starts further along the course. The false shortcut is at about x 124–166, the pavement hill starts around x 200, and the slide around x 290.

## Modes and controls

From the title screen, choose **PLAY ALONE** (vs the AI Demon) or **LOCAL 1V1**.

| Who | Input | Action |
|---|---|---|
| Visitor | **↑ / W**, **↓ / S** | Change lanes. Steering during a gust also braces against it. |
| Visitor | **Space** (tap) | Run faster; stop tapping and she tires back to a jog |
| Demon (1v1) | **Mouse** | Click a power (Grass, Wind, Water, Fire), then click the lit path ahead of her. Right-click cancels. |
| Either | **Esc / P** | Pause. **R** retries the chase from the gate (paused or end screen). The pause menu and end card also offer **Replay Story** (the prologue again); both keep the selected mode. **Enter** plays solo from the title. |
| Intro | **Hold Esc** (1 s) | Skip the prologue. During the intro, Esc only skips; **P** pauses. |
| The house | **Space** (tap) | Pull back against the ribbons. She stops for a moment, then they take up the slack. |
| The house | **Hold Esc** (1 s) | Skip ahead: from the house to the window, from the window to the run, from the reveal to the closing shot. **P** pauses. |
| The window | **Space** (tap) | Wipe the glass. Three wipes clear it. |
| The window | **↑ / ↓**, **Space** | Choose *Leave through the window* or *Stay inside*. Clicking an option also works. |
| The window | **Space** (tap) | Pull free of the frame: six hard pulls. If she stops pulling, the vines take a little back. |
| The run back | — | She runs to her friends on her own (about 8 s): no dodging, no tapping. Escape pauses. |

In 1v1, the Demon wins if she is caught 5 times before she reaches the house; otherwise the Visitor wins. Both modes then play the house sequence.

## Stage 5: the window, the false escape, the reveal

### The story beats (`story/finale/Finale.ts`)

| Beat | What happens |
| --- | --- |
| `WINDOW_DISCOVERY` | Laughter outside. She turns from the mirror and goes to the tall window between the arch and the mirror. Her friends are on the lawn by a lamp, and Juno waves. She is relieved, puts her palms on the glass and knocks. |
| `WINDOW_CONDENSATION` | The frame creaks, the drapes stir in still air, the glass goes cold, and fog creeps in from the frame. |
| `WINDOW_WARNING` | A finger draws, first scratches nobody could read, then a face over each friend, exact from the camera's view: Odette smiling past her ears with a dragged jaw, Juno with four eyes and a long face, Wren with her head high on a stalk of neck and long jointed limbs. She recoils. |
| `WINDOW_WIPE` | TAP SPACE — WIPE GLASS. Her sleeve clears the fog wherever her arm actually is. After three wipes the glass is clear, and it's just her friends, waving. |
| `WINDOW_WARNING_RETURN` | The glass fogs again, fast, and the faces come back drawn twice as hard, with slashes and runs of water. She takes it as the house trying to frighten her off. |
| `WINDOW_CHOICE` | LEAVE THROUGH THE WINDOW / STAY INSIDE, set into the bottom of the frame. |
| `WINDOW_STAY_WARNING` | She steps back. The house goes still and exhales. Outside, the friends stop waving. Odette is too tall for a fraction of a second. While the Visitor looks away, Wren appears at the glass with fingers too long, and they leave marks in the fog. Then she's gone, and the choice returns. A second Stay is shorter: the three only take one step closer, together. |
| `WINDOW_ESCAPE` | The drapes thrash, and the frame and the door behind her groan. The latch resists, then gives, and the fog thins in the night air. She climbs onto the sill. |
| `WINDOW_STRUGGLE` | The gown catches on the sill, and vines come out of the frame. TAP SPACE — PULL FREE. The gown tears and she falls out. The hem stays ragged and the veil short from here on. |
| `OUTSIDE_LANDING` | She lands on the grass below the house's side window, gets up and looks back. A vine follows her out of the window, stops short of her and withdraws. The window shuts and the house dims. There is no line and no remark. |
| `FINAL_RUN` | She runs for her friends on her own, about 70 m (no dodging, no tapping). The park is calm: no hazards, no Demon, warm steady lamps, a few warm notes. Her friends wave and call. |
| `FINAL_UNEASE` | Odette stops waving and keeps smiling, Juno's head turns too far, and Wren goes still. Their shadows run up the path toward her from a light that isn't there: one with horns, one with extra arms, one a beat behind. The music goes, then the wind. All three turn to her at once, the camera lowers, and her legs slow. |
| `FRIENDS_REVEAL` | Directed, not playable. **Odette:** the smile keeps widening, her eyes sink, her neck lengthens, her fingers and arms grow, and she twists and rises. **Juno:** one step toward the Visitor, then a stop. A shoulder goes up and over, an elbow bends the wrong way, and her spine arches and folds while her face stays fixed on the Visitor. With four eyes and a long face, she unfolds tall. **Wren:** the most ordinary of the three. A slow step, a tilt, then her head keeps turning to show a second face. Her neck grows, and black limbs come out of her back. |
| `VISITOR_REALIZATION` | The phone in Odette's hand shows the same dating-app conversation. The Visitor looks from one friend to the next, her face moving through confusion, recognition, disbelief and terror, and she takes a step back. The camera finds the house far behind her, warm in every window. She turns toward it. |
| `FINAL_ATTACK` | They come: a tilt, an impossibly long step, a glide without walking. She backs away. Odette moves faster than anything that size should. A cut to the Visitor's face, black before contact, then silence. |
| `FINAL_ENDING` | The house alone under the moon, its door grown shut. A vine comes out from under the door toward the path, hesitates and stops. A creak like a sigh. *IT WAS NEVER THE HOUSE YOU SHOULD HAVE FEARED.* Black. Then REPLAY STORY / RETRY CHASE / MAIN MENU. |

**How it's built:**
- **The fog** (`world/WindowFog.ts`) is a shader on the window's two leaves, so it swings with them when the window opens. It grows in from the frame by `cover`, with beads of water and a cold tint. Everything that clears it (finger lines, her sleeve, drips) is painted into a mask canvas that the shader reads. Strokes are drawn along their length at a finger's pace, and `refog()` lets the condensation close back over them.
- **Alignment.** Each face is designed in metres around that friend's own eyes and projected onto the glass along rays from the drawing shot's camera (`HouseWindow.project`), so the marks sit over the friends wherever they stand. The friends' positions on the lawn are chosen so each one falls on clear glass rather than a bar of the frame. The drawing is 2.1 times life size, a mask over each of them.
- **The window and the night outside it** (`world/HouseWindow.ts`) are part of the closed interior set: a hole in the far wall, casement leaves, drapes and frame vines, then a lawn, an iron fence, trees, a lamp and the sky. They are lit by the lamp, a cold moon and the hall's own light spilling out.
- **The tear** is a field in the gown's shader (`WeddingDress.tear` and `dirt`): a ragged line, deepest at the back, plus grass stains. The veil (cloth) is shortened. Both last through the run.
- **The transformations** (`characters/Corruption.ts`) work on each friend's own skeleton and head after the performer poses her:
  - bone positions (the neck);
  - bone scales (arms longer and thinner, fingers, legs);
  - joints rotated past their limits;
  - the head's morph targets (smile, jaw, wide eyes) driven beyond 1;
  - darkened eyes and pallor.

  A quaternion lock keeps a head facing forward while the body under it twists. Added parts grow out of existing bones: Juno's second pair of eyes; Wren's second face, which reuses her own head mesh and morphs with a face painted in the same UV layout; Wren's limbs (`world/Vine.ts`, in black); and horns and arms that are shadow-only, so they appear only in what the friends cast. `reset()` restores every bone, scale and material.
- **The wrong shadows.** `Environment.lightOverride` moves the moon's shadow light low behind the friends and tightens its frustum, so their shadows lengthen up the path toward her. Wren's `ShadowTwin` lags again.
- **The run** reuses `VisitorController` and `ChaseCamera` with a direction (`dir`), a speed cap (her legs slowing) and `menace` (a lower, tighter frame). The Demon's systems don't run: the AI stops in single player, and the human Demon's powers stay off in 1v1.
- **Sound** is all synthesized, with no audio assets:
  - at the window: distant laughter, frost crackling and a fingertip squealing on wet glass;
  - at the escape: the house exhaling, the latch, silk straining, a hard rip and the landing;
  - on the run: breath and a distant "hey—!";
  - at the reveal: dry bone cracks, wrong laughter, one long breath and a low rumble;
  - the lunge, then a hard cut to silence.

## Stage 4: the house

### The story beats (`story/house/HouseSequence.ts`)

| Beat | What happens |
| --- | --- |
| `HOUSE_THRESHOLD` | She stops at the foot of the porch and the door swings open on warm light. Three satin ribbons reach out: one for each wrist, one for her waist. *"Let me take your coat. And you."* They draw her up the path while she leans back against them. The camera stays ahead of her face, then swings behind her as the doorway fills the frame. |
| `HOUSE_INTERIOR` | The door slams behind her. She turns and tries it (*"Locked. For your safety. Mostly mine."*). Candles light themselves in pairs down the aisle, and a held, slightly out-of-tune organ chord starts somewhere upstairs. The ribbons come again from the arch and walk her down the aisle between the empty chairs. |
| `WEDDING_DRESS` | Under the arch the ribbons let go of her wrists, lift her arms and spiral down round her from the dark above. The gown grows over her from the right wrist and the waist outward, and her coat whitens and dissolves along the same field (`characters/WeddingDress.ts`). The chandelier lights. The veil settles from above. Her face is made to smile while her eyes stay frightened. The dust sheet slips from the mirror, and the glass is faintly lit: *"Not the mirror. Not yet."* |

Stage 5 follows straight on (see above). Before Stage 5, `STAGE_4_END` and the end card *The Dress Fits* came here.

**Pulling back.** Tapping SPACE while the ribbons pull makes her heave back: she stops dead, the camera jolts and the ribbons go slack, then they take up the slack again. The house remarks on her 1st, 2nd, 3rd, 5th and 8th tries (*"That's three. I'm writing them down for the speech."*).

**How it's built:**
- **The interior** (`world/HouseInterior.ts`) is a closed set, built away from the park. While she is inside, the park, sky and moon are hidden (`Environment.setIndoors`), so the two never share a frame or a light. All of its light is the house's own: aisle candles with one warm light that follows the lit pairs, a chandelier, a shadow-casting key light at the arch, and a cold spill from the windows. The wallpaper, boards and runner are painted on canvases at runtime, like everything else.
- **The ribbons** (`world/Ribbon.ts`) are flat strips laid along a curve the script moves every frame. Each one snakes while it reaches, pulls taut when it holds, loops once round the wrist or waist, twists and flutters along its length, and is drawn out from its root by `extent`.
- **The gown** is skinned to her own skeleton, so her face, hair and animation stay hers. The veil is a small verlet cloth that collides with her head, torso and skirt. With a GLB body attached, the generated body takes over for the house (the gown is built on it), and the GLB returns on retry.
- **One clock per phase**, with cues that fire once each, as in the prologue. Pausing freezes it, and a skip jumps to the final tableau behind a fade.
- **No stalls at the door.** The house's shaders, shadow passes, buffers and textures are warmed at load by rendering one offscreen frame of each. The Demon's prewarm now also compiles against the composer's render target. The screen-target variants it built before were never used, so load time roughly halved.

The house itself changed to let her in: the porch now sits level with the path, the hill is a low mound, and the side wing is set back so the front door is no longer buried inside it.

## Stage 3: the prologue

### The story beats (`story/prologue/Prologue.ts`)

| Beat | Time | What happens |
| --- | --- | --- |
| `PROLOGUE_ESTABLISHING` | 0–7 s | A wide crane down onto the plaza outside **Ashgrove Gardens**: warm lamps, lit townhouses, four women talking. |
| `PROLOGUE_FRIENDS` | 7–15 s | Over-the-shoulder shots and their reverses. There is laughter. |
| `PROLOGUE_PHONE` | 15–25 s | Her pocket buzzes. Over her shoulder, the phone shows *hearth*: a match, then "Meet me by the old garden house?" and a shared location. On her reaction close-up she smiles and tucks her hair. She replies "On my way". |
| `PROLOGUE_GOODBYE` | 25–31 s | She thumbs toward the park, waves and walks. From inside the gate, the friends recede behind her. |
| `PROLOGUE_PARK_ENTRY` | 31–42.4 s | A side follow, then behind her. A lamp stutters, a swing creaks with nobody on it, a branch moves without wind, and the grass ripples against the wind. She hesitates and looks back, the camera settles into the chase framing, and she is yours. |

Then come `CHASE_GAMEPLAY`, `CHASE_ESCALATION` (the Demon's mood leaves *amused*), `PAVEMENT_SLIDE`, the Stage 4 beats and `STAGE_4_END`. These story states run beside the flow states (`title → prologue → playing → house → ended`; the middle three can each pause) in `core/StateMachine.ts`.

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
- **Identity and outfit are separate.** `setOutfit()` rebuilds only the garment layers on the same skeleton, and the Stage 4 gown is bound to that same skeleton.

**Animation** (`visitor/VisitorAnimator.ts`, `characters/Performer.ts`, `characters/gestures.ts`):
- **Gait.** One phase drives a walk (a stance sweep matched to stride length, so feet plant) that blends into the Stage 2 run, which is still synced to SPACE taps.
- **Idles.** Each woman has her own idle, with breathing and weight shifts.
- **Gestures.** Authored, layered gestures: talk, story, laugh, nod, tilt, wave, the wave that stops, thumb-back, hair tuck, arms folded, flinch and hesitate.
- **Phone.** A take-out / read / type / put-away sequence, with a prop constraint that turns the screen to her eyes or to the lens.
- **Look-at and blinks.** Look-at leads with the eyes. Blinking is automatic.
- **Chase expressions.** Her face reacts in the chase: concern, effort, fear on a catch, dread as the Demon grows anxious, relief on a dodge.

**GLB characters in the game** (`characters/gltf/`, Stage 3.1):
- A rigged GLB can be the Visitor's actual body, in the prologue and the chase. `?visitor=test` plays with the CC0 RobotExpressive test model. A `CAST_ASSETS.visitor` entry in `characters/gltf/manifest.ts` uses a supplied model automatically. If the file is missing or fails to load, the game falls back to the generated Visitor.
- `GltfAvatar` maps humanoid bones (Mixamo, UE/Quaternius, Rigify, VRM) and normalises the model to the game's height, with its feet on the ground. It drives the `AnimationMixer` from the `VisitorController`:
  - idle / walk / run / sprint blend by real speed, with playback rate matched to that speed;
  - slide is a held clip;
  - stumble → recover is triggered by catches;
  - a dodge clip plays on lane changes (if the model has one);
  - gestures map from the prologue script.
- Leans for dodges, wind and slope are applied procedurally on the holder, so they work on any rig.
- Expressions drive whatever morph targets exist (ARKit, VRM or simple names).
- Each clip's weight is set explicitly every frame, so nothing snaps.
- Outfit layers can be toggled by mesh-name prefix (`setOutfitLayers`), ready for costume changes.
- The generated character keeps running hidden as the performance driver (gesture timing, gaze, face), so cameras and the script work with either body.
- `public/characters/README.md` specifies what to supply, and `CREDITS.md` tracks licences.

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
             House (★glow/flare) · HouseInterior, Ribbon (Stage 4) · ★Inscriptions · ★TargetingOverlay · ★props/Signpost · ★props/Bench · …
  obstacles/ Obstacle (★shared lifecycle/disposal) · GrassAttack (★ankle coils) · TreeAttack (★bending trunk)
             ★WindGust · ★WaterHazard · ★FireLine · ObstacleManager
  demon/     ★abilities/DemonAbilitySystem · ★abilities/Fairness · DemonDirector · AIDemonDirector (★rewritten)
             ★HumanDemonDirector · ★DemonMind · ★VisitorObserver · ★Tricks · ★Sarcasm · DemonVoice
  story/     Chapter · park/ParkChapter (★both modes) · ★park/CourseDirector · park/course (★thinned, shortcut gap)
             prologue/Prologue (Stage 3) · house/HouseSequence (Stage 4)
  audio/     AudioEngine (★gust, gurgle/fountain, cold ignition/ash, dodge relief, bells, lamp hum, phase swells)
  ui/        UI (★mode menu, 1v1 how-to, dodge flash, winner card) · ★DemonPanel · styles
```

## Honest notes

- **The characters are skinned rigs, but generated, not sculpted.** They are original and fully code-generated: real skeletons, skinned meshes and morph targets. They are not artist-modelled assets, so faces and cloth read as stylized puppets rather than film-quality models. The GLB pipeline is ready for supplied models (see `public/characters/README.md`).
- **Animation is procedural and authored in code**, not mocap or keyframed clips. `AnimationMixer` drives GLB bodies; it isn't used for the generated cast.
- **There is no recorded audio yet.** All sound is synthesized. A sample slot (`public/audio/README.md`) takes licensed recordings; laughter is left as a murmur swell until a real recording is supplied.
- **The GLB test model is a robot**, used only to prove the pipeline. Its oversized head breaks the humanoid eye anchor, so the phone close-ups frame badly with it. A humanoid model fits the anchors.
- **Cloth simulation is limited to the veil** (a small verlet grid). Coat panels, hair and scarves are spring-driven bone chains, and the gown is skinned.
- **All textures and sounds are generated at runtime.** There are no asset files, and no voice acting: the Demon "speaks" in engraved text.
- **Puddles use `MeshPhongMaterial`, deliberately.** It samples the equirect night panorama directly. `MeshStandardMaterial` would trigger Three.js's PMREM prefilter, whose shader produced an (harmless) HLSL precision warning on Windows/ANGLE and a compile stall mid-chase. All hazard shaders are also precompiled at load (`DemonAbilitySystem.prewarm`).
- **Performance:** about 150–160 fps at 1600×900 on an RTX 4060 laptop GPU. On an integrated Intel GPU, expect much less; dynamic resolution compensates. On dual-GPU laptops, set the browser to *High performance* in Windows Graphics settings.

## Stage 6 changes

- The chase is shorter (the hill follows the trees; the slide ends at x 412) and runs for the park's lit exit gate. The house is sunk out of sight until the slide, then rises where the exit was.
- Inside, vines grow across the front door when she tries it.
- The final run is automatic and about 8 s; the landing and reveal play faster.
- Textures are uploaded at load (the cut outside the window used to stall).

## Known Stage 5 problems (for Stage 6)

None of these blocks play; all are visual or a short stall.

- **Freeze at the cut outside.** About 0.6 s on a black frame when she falls from the window and the park comes back (it was 0.8 s before the gown was prewarmed for outdoor lighting). The pavement reset and veil settle are not the cause (3 ms and 19 ms).
- **The gown clips.** The skirt is a rigid, skinned bell, so it pushes through the sill when she crouches in the window and flares stiffly in the struggle.
- **The vines are hard to see.** The frame vines in the struggle shot, and the vine that reaches from under the door in the closing shot, barely read against the dark.
- **The window frames look flat.** The opened leaves of the house's escape window, seen from outside, read as flat orange slabs.
- **Fingers clip through the phone.** In the phone close-up, Odette's lengthened fingers pass through it.
- **The fog drawings are slightly off.** They sit over the friends, but a little high in places (Juno's drawn eyes are above her real ones), because the friends are still moving when the projection is taken.

## Roadmap

1. ~~Stage 1: park chase~~
2. ~~Stage 2: the intelligent Demon, four powers, tricks, local 1v1~~
3. ~~Prologue: the dating app, the match, the friends~~
4. ~~House interior: forced inside, the wedding dress~~
5. Mirror: terrifying reflections
6. Window: friends outside, the escape
7. Reveal: the friends become demons; the house was protecting her
