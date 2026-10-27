# THE HOUSE WANTS YOU

A cinematic 3D psychological horror chase with dark satire, built with **Three.js + TypeScript + Vite**.

A young woman goes to an old park at night to meet someone from a dating app. The park comes alive and herds her toward a haunted house. The house's Demon is dry, patient and passive-aggressive about it.

> **Stage 1 (this build):** the park chase. It has a title screen, three-lane auto-run, tap-to-sprint, grass and root attacks, tree attacks, pavement that rises into a hill and folds into a slide, an arrival at the house, an end screen and restart.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

Debug: `http://localhost:5173/?x=280` starts the run further along the course (the pavement set-piece starts around x≈200 and the slide around x≈290).

## Controls

| Key | Action |
|---|---|
| **↑ / W** | Move to the upper (far) lane |
| **↓ / S** | Move to the lower (near) lane |
| **Space** | Tap repeatedly to run faster; stop and she tires back to a jog. While sliding, a tap gives a small push. |
| **Esc / P** | Pause |
| **R** | Restart (when paused or on the end screen) |
| **Enter** | Play (title screen) |

## Project structure

```
src/
  main.ts                 entry point (+ ?x= debug start)
  config.ts               all tuning: lanes, speeds, course layout, camera, colours
  core/
    Game.ts               renderer, main loop, top-level states, dynamic resolution
    StateMachine.ts       title → playing ⇄ paused → ended
    Input.ts              edge-triggered keyboard input
    Events.ts             typed event bus (gameplay ↔ sound/UI/Demon)
    PostFX.ts             bloom, vignette, grain, colour grade, hurt flash
    math.ts               easing, damping, springs, deterministic noise
  visitor/
    VisitorController.ts  movement rules: auto-run, effort, lanes, slope, slide, stumble
    VisitorAnimator.ts    procedural animation layers and blending
    Pose.ts               engine-agnostic skeletal pose
    Avatar.ts             VisitorAvatar interface (swap in a rigged model here)
    ProceduralAvatar.ts   the current hand-built character
    Visitor.ts            ties controller + animator + avatar together
  camera/ChaseCamera.ts   2.5D oblique chase camera, title drift, arrival shot
  world/
    Environment.ts        builds and updates the park
    Pavement.ts           deformable height-field path (hill → slide); ground truth for heights
    Sky.ts  House.ts  Streetlights.ts  GrassField.ts  Particles.ts
    TreeBuilder.ts        procedural gothic trees
    Textures.ts           procedurally painted textures (no image assets yet)
    geometry.ts           tapered tubes, grass blades, instanced Tendril chains
  obstacles/
    Obstacle.ts           lifecycle: dormant → warning → striking → holding → retracting
    GrassAttack.ts        thrashing grass, red cracks, roots that grab her ankles
    TreeAttack.ts         living trees: "sweep" across lanes or "drop" onto one lane
    ObstacleManager.ts    builds obstacles from course data
  demon/
    DemonDirector.ts      interface: whoever controls the park
    AIDemonDirector.ts    Stage 1 AI: times attacks to her speed, runs the set-piece, gusts
    DemonVoice.ts         the house's lines (data) + rate-limited delivery
  story/
    Chapter.ts            chapter contract + story order
    park/course.ts        the park course as data
    park/ParkChapter.ts   Stage 1 chapter
  audio/AudioEngine.ts    synthesized Web Audio: wind, drone, music box, footsteps, creaks, impacts
  ui/                     title, how-to, tutorial hint, subtitles, pause/end cards
```

## How it fits together

- **Obstacles never decide when to attack.** A `DemonDirector` calls `warn()` and `strike()`. The AI director times these against the Visitor's real speed, so the warning window is fair whether she jogs or sprints. Local 1v1 needs a `HumanDemonDirector` that reads the second player's input and calls the same methods; no obstacle code has to change.
- **The pavement is gameplay, not decoration.** `Pavement.heightAt()` is the single source of ground height for the Visitor, obstacles and camera. Her speed responds to the real slope, and sliding is driven by gravity along it.
- **Animation is decoupled from rendering.** The animator produces a `Pose`, and any `VisitorAvatar` consumes it. Gait cadence and stride come from actual speed, so the feet stay in sync with movement.
- **Chapters** (`story/Chapter.ts`) own their world and rules. The house interior, wedding dress, mirror, window and reveal chapters slot into `CHAPTER_ORDER` without touching the engine.
- **Course and dialogue are data** (`course.ts`, `DemonVoice.ts`), so they can be tuned without code changes.

## Honest notes on Stage 1 quality

- **The character is procedural, not a skinned rig.** She is a jointed hierarchy of primitives driven by hand-written procedural animation: gait, stumble and recovery, slide, leans and layer blending. Her ponytail, scarf and coat panels use spring-based secondary motion. This is **not** skeletal skinning and **not** cloth simulation. To upgrade, write a `GltfAvatar` that implements `VisitorAvatar` and maps `Pose` joints onto bones, or drives an `AnimationMixer`.
- **All textures and sounds are generated at runtime**, so there are no asset files yet. Authored textures and samples can replace them behind the same interfaces.
- **Performance:** about 105–110 fps at 1600×900 on an RTX 4060 laptop GPU. On an integrated Intel GPU it drops to roughly 25 fps, and dynamic resolution scales the render size down to compensate. On a laptop with two GPUs, set your browser to *High performance* in Windows Graphics settings.

## Roadmap

1. ~~Stage 1: park chase~~
2. Prologue: the dating app and the match
3. House interior: forced inside, the wedding dress
4. Mirror: terrifying reflections
5. Window: friends outside, the escape
6. Reveal: the friends become demons; the house was protecting her
7. Local 1v1: human Demon vs Visitor
