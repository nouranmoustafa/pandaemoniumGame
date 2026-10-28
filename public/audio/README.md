# Optional recorded audio

All of the game's sound is synthesized at runtime. If you add recordings here, the
game uses them **in place of** the matching synthesized sounds. Add a
`samples.json` listing each file. Entries without both `license` and `source`
are ignored.

```json
{
  "laugh":    [{ "url": "audio/laugh-group-1.ogg", "license": "CC0-1.0", "source": "https://…", "author": "…", "gain": 0.8 }],
  "footstep": [{ "url": "audio/step-1.ogg", "license": "CC0-1.0", "source": "https://…" },
               { "url": "audio/step-2.ogg", "license": "CC0-1.0", "source": "https://…" }],
  "notify":   { "url": "audio/notify.ogg", "license": "CC0-1.0", "source": "https://…" },
  "owl":      { "url": "audio/owl.ogg", "license": "CC0-1.0", "source": "https://…" }
}
```

Supported ids are `laugh`, `notify`, `footstep`, `owl`, `evening` and `park`.
The `evening` and `park` ids are reserved for ambience loops in a later stage.

## Wanted recordings

| id | What | Notes |
| --- | --- | --- |
| `laugh` | Two or three adult women laughing softly together, 1–2 s | This is the one sound the game can't synthesize believably. Without a recording, the prologue only swells the friends' murmur. |
| `footstep` | 4–6 variants of a low heel on stone | |
| `notify` | A short, soft phone chime | |
| `owl` | A distant tawny owl | |

Record each file's licence in `CREDITS.md`. Stage 3.1 ships with no recordings.
Freesound needs an account to download, and Kenney's packs block scripted
downloads. The Wikimedia Commons search turned up nothing suitable for the laugh,
and I couldn't listen to candidate files to vet them.
