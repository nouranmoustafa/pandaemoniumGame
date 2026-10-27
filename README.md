# THE HOUSE WANTS YOU

A cinematic 3D psychological horror chase with dark satire, built with **Three.js + TypeScript + Vite**.

A young woman goes to an old park at night to meet someone from a dating app. The park comes alive and herds her toward a haunted house. The Demon behind it is intelligent, sarcastic, and increasingly anxious that she might get away.

> **Stage 2 (this build): the intelligent Demon.** The park chase from Stage 1 now has a reactive AI Demon with three moods. It wields four elemental powers: grass, wind, water and fire. It also plays psychological tricks and makes rare, earned remarks. There is a local 1v1 mode where a second player is the Demon, using the mouse.
>
> Stage 1 is preserved at git tag `stage-1`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Debug: `?x=280` starts further along the course. The false shortcut is at about x 124–166, the pavement hill starts around x 200, and the slide around x 290.

## Modes and controls

From the title screen, choose **PLAY ALONE** (vs the AI Demon) or **LOCAL 1V1**.

| Who | Input | Action |
|---|---|---|
| Visitor | **↑ / W**, **↓ / S** | Change lanes. Steering during a gust also braces against it. |
| Visitor | **Space** (tap) | Run faster; stop tapping and she tires back to a jog |
| Demon (1v1) | **Mouse** | Click a power (Grass, Wind, Water, Fire), then click the lit path ahead of her. Right-click cancels. |
| Either | **Esc / P** | Pause. **R** restarts (paused or end screen). **Enter** plays solo from the title. |

In 1v1, the Demon wins if she is caught 5 times before she reaches the house; otherwise the Visitor wins.

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

- **The character is procedural, not a skinned rig.** She is a jointed figure with procedural animation and spring-driven secondary motion, not skeletal skinning or cloth simulation. A rigged model can replace her through `VisitorAvatar`.
- **All textures and sounds are generated at runtime.** There are no asset files, and no voice acting: the Demon "speaks" in engraved text.
- **Puddles use `MeshPhongMaterial`, deliberately.** It samples the equirect night panorama directly. `MeshStandardMaterial` would trigger Three.js's PMREM prefilter, whose shader produced an (harmless) HLSL precision warning on Windows/ANGLE and a compile stall mid-chase. All hazard shaders are also precompiled at load (`DemonAbilitySystem.prewarm`).
- **Performance:** about 150–160 fps at 1600×900 on an RTX 4060 laptop GPU. On an integrated Intel GPU, expect much less; dynamic resolution compensates. On dual-GPU laptops, set the browser to *High performance* in Windows Graphics settings.

## Roadmap

1. ~~Stage 1: park chase~~
2. ~~Stage 2: the intelligent Demon, four powers, tricks, local 1v1~~
3. Prologue: the dating app and the match
4. House interior: forced inside, the wedding dress
5. Mirror: terrifying reflections
6. Window: friends outside, the escape
7. Reveal: the friends become demons; the house was protecting her
